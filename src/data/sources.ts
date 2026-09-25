import { db } from "./db";
import type { SourceChunk, SourceFile } from "../types";

const chunkSize = 1_500;
const chunkOverlap = 180;

function headingBefore(text: string, offset: number) {
  const prior = text.slice(0, offset);
  const matches = Array.from(prior.matchAll(/^\s{0,3}#{1,6}\s+(.+)$/gm));
  return matches.length ? matches[matches.length - 1][1]?.trim().slice(0, 180) : undefined;
}

/** Split without altering source text. Markdown headings and paragraph boundaries are preferred. */
export function buildSourceChunks(text: string): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + chunkSize);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf("\n\n", end), text.lastIndexOf("\n", end));
      if (boundary > start + Math.floor(chunkSize * 0.45)) end = boundary;
    }
    const value = text.slice(start, end).trim();
    if (value) {
      const offset = text.indexOf(value, start);
      const ownHeading = value.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim().slice(0, 180);
      chunks.push({ id: `${offset}-${offset + value.length}`, order: chunks.length, start: offset, end: offset + value.length, heading: ownHeading || headingBefore(text, offset), text: value });
    }
    if (end >= text.length) break;
    start = Math.max(end - chunkOverlap, start + 1);
  }
  return chunks;
}

export async function ensureSourceIndex(file: SourceFile) {
  if (!file.textContent?.trim()) return [] as SourceChunk[];
  if (file.sourceChunks?.length && file.sourceIndexUpdatedAt === file.updatedAt) return file.sourceChunks;
  const chunks = buildSourceChunks(file.textContent);
  await db.sourceFiles.update(file.id, { sourceChunks: chunks, sourceIndexUpdatedAt: file.updatedAt });
  return chunks;
}

function queryTerms(query: string) {
  return Array.from(new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}'-]{2,}/gu) ?? []));
}

function scoreChunk(chunk: SourceChunk, file: SourceFile, query: string, terms: string[]) {
  const text = chunk.text.toLocaleLowerCase();
  const heading = chunk.heading?.toLocaleLowerCase() ?? "";
  const filename = file.name.toLocaleLowerCase();
  const phrase = query.toLocaleLowerCase();
  let score = text.includes(phrase) ? 10 : 0;
  for (const term of terms) {
    const occurrences = text.split(term).length - 1;
    score += Math.min(4, occurrences) * 2;
    if (heading.includes(term)) score += 5;
    if (filename.includes(term)) score += 4;
  }
  return score;
}

export async function runSourceTool(projectId: string, name: string, rawArguments: string) {
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawArguments || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    args = parsed as Record<string, unknown>;
  } catch { return { error: "Invalid source lookup arguments." }; }
  const files = await db.sourceFiles.where("projectId").equals(projectId).toArray();
  if (name === "list_sources") {
    const indexed = await Promise.all(files.map(async (file) => ({ file, chunks: await ensureSourceIndex(file) })));
    return { sources: indexed.map(({ file, chunks }) => ({ id: file.id, name: file.name, readable: Boolean(file.textContent?.trim()), characters: file.textContent?.length ?? 0, sections: chunks.length })) };
  }
  if (name === "read_source") {
    const file = files.find((item) => item.id === args.sourceId);
    if (!file) return { error: "Source not found in this project." };
    if (!file.textContent?.trim()) return { error: "This source has no extracted readable text." };
    const start = args.start === undefined ? 0 : args.start;
    const length = args.length === undefined ? 12000 : args.length;
    if (typeof start !== "number" || !Number.isInteger(start) || start < 0 || start > file.textContent.length || typeof length !== "number" || !Number.isInteger(length) || length < 1) return { error: "Use a valid character offset and positive integer length." };
    const end = Math.min(start + Math.min(length, 24000), file.textContent.length);
    return { id: file.id, name: file.name, start, end, totalCharacters: file.textContent.length, text: file.textContent.slice(start, end), nextStart: end < file.textContent.length ? end : null };
  }
  if (name !== "search_sources") return { error: "Unknown source lookup tool." };
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { error: "A search query is required." };
  const terms = queryTerms(query);
  const candidates = await Promise.all(files.filter((file) => !args.sourceId || file.id === args.sourceId).map(async (file) => ({ file, chunks: await ensureSourceIndex(file) })));
  const hits = candidates.flatMap(({ file, chunks }) => chunks.map((chunk) => ({ file, chunk, score: scoreChunk(chunk, file, query, terms) })))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name) || a.chunk.order - b.chunk.order)
    .slice(0, 8)
    .map(({ file, chunk, score }) => ({ id: file.id, name: file.name, score, heading: chunk.heading, passages: [{ start: chunk.start, end: chunk.end, text: chunk.text }] }));
  return { totalMatches: hits.length, hits };
}
