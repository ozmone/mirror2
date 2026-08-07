import { v4 as uuid } from "uuid";

export const uid = () => uuid();
export const now = () => Date.now();

export const normaliseTag = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");

export const splitTags = (value: string) =>
  Array.from(new Set(value.split(",").map(normaliseTag).filter(Boolean)));

export const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.trim().length / 4));

export const fallbackChatTitle = (text: string) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 34 ? `${clean.slice(0, 31)}...` : clean || "New chat";
};

export const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(timestamp);
