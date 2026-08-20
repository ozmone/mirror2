import type React from "react";
import { memo } from "react";

function renderInlineMarkdown(text: string, inventoryMarkers = false) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\(\(.+?\)\)|\*\*\*.+?\*\*\*|\*\*.+?\*\*|\*[^*\n]+?\*|\[i\])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${match.index}-${token}`;
    if (token.startsWith("((") && token.endsWith("))")) {
      nodes.push(<span className="md-ooc" key={key}>{token.slice(2, -2)}</span>);
    } else if (token === "[i]") {
      nodes.push(inventoryMarkers ? <span className="md-inventory-marker" key={key}>[i]</span> : token);
    } else if (token.startsWith("***") && token.endsWith("***")) {
      nodes.push(<strong key={key}><em>{token.slice(3, -3)}</em></strong>);
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export const MarkdownText = memo(function MarkdownText({ text, emptyText, inventoryMarkers }: { text: string; emptyText?: string; inventoryMarkers?: boolean }) {
  const source = text || emptyText || "";
  if (!source) return null;
  return (
    <div className="markdown-text">
      {source.split(/\r?\n/).map((line, index) => {
        if (/^\s*---\s*$/.test(line)) return <hr key={index} />;
        const quote = /^(>{1,3})\s*(.*)$/.exec(line);
        if (quote) {
          const depth = quote[1].length;
          return <blockquote className={`md-quote depth-${depth}`} key={index}>{quote[2] ? renderInlineMarkdown(quote[2], inventoryMarkers) : "\u00a0"}</blockquote>;
        }
        const header = /^(#{1,3})\s+(.+)$/.exec(line);
        if (header) {
          const level = header[1].length;
          const Tag = (`h${level}` as "h1" | "h2" | "h3");
          return <Tag key={index}>{renderInlineMarkdown(header[2], inventoryMarkers)}</Tag>;
        }
        return <p key={index}>{line ? renderInlineMarkdown(line, inventoryMarkers) : "\u00a0"}</p>;
      })}
    </div>
  );
});
