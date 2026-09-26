/**
 * The structure of an agent reply: paragraphs, lists, tables and bold.
 *
 * The agent answers comparisons as Markdown tables ("| Fact | ALPHA |") and
 * steps as lists; the panel showed the pipes and dashes literally (Bench 04
 * L01, L04). Only this small subset is read — no links, no HTML, no images —
 * and every piece stays text, so React escapes it as before.
 */

export type ReplyInline = { text: string; strong?: boolean };
export type ReplyBlock =
  | { kind: "paragraph"; lines: ReplyInline[][] }
  | { kind: "list"; ordered: boolean; items: ReplyInline[][] }
  | { kind: "table"; header: ReplyInline[][]; rows: ReplyInline[][][] };

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;

/** "**bold** rest" → [{text: "bold", strong: true}, {text: " rest"}]; an unmatched "**" stays text. */
export function parseInline(text: string): ReplyInline[] {
  const parts: ReplyInline[] = [];
  const pattern = /\*\*([^*\n]+?)\*\*/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: match[1], strong: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.length ? parts : [{ text }];
}

function cells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

export function parseAgentReply(text: string): ReplyBlock[] {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReplyBlock[] = [];
  let paragraph: ReplyInline[][] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", lines: paragraph });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (TABLE_ROW.test(line) && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1])) {
      flush();
      const header = cells(line).map(parseInline);
      const rows: ReplyInline[][][] = [];
      index += 2;
      while (index < lines.length && TABLE_ROW.test(lines[index])) {
        rows.push(cells(lines[index]).map(parseInline));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    const bullet = line.match(BULLET);
    const numbered = bullet ? null : line.match(NUMBERED);
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const items: ReplyInline[][] = [];
      while (index < lines.length) {
        const item = ordered ? lines[index].match(NUMBERED) : lines[index].match(BULLET);
        if (!item) break;
        items.push(parseInline(item[1]));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(parseInline(line));
  }
  flush();
  return blocks;
}
