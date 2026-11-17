/**
 * A meeting summary's Markdown, read into blocks the Summary tab draws with
 * plain Svelte elements (never as HTML). The summarizer is asked for a small
 * subset: `## ` headings, `- ` bullets, `**bold**` and paragraphs. Anything
 * else it writes is shown as the text it is.
 */

export type Inline = { text: string; bold: boolean };
export type SummaryBlock = { kind: 'heading' | 'para'; parts: Inline[] } | { kind: 'list'; items: Inline[][] };

/** `**x**` runs as bold parts; an unclosed `**` stays literal. */
function inline(line: string): Inline[] {
  const parts: Inline[] = [];
  let rest = line;
  for (;;) {
    const open = rest.indexOf('**');
    const close = open < 0 ? -1 : rest.indexOf('**', open + 2);
    if (open < 0 || close < 0) break;
    if (open > 0) parts.push({ text: rest.slice(0, open), bold: false });
    if (close > open + 2) parts.push({ text: rest.slice(open + 2, close), bold: true });
    rest = rest.slice(close + 2);
  }
  if (rest || parts.length === 0) parts.push({ text: rest, bold: false });
  return parts;
}

export function parseSummary(md: string): SummaryBlock[] {
  const out: SummaryBlock[] = [];
  let list: Inline[][] | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*] (.*)$/.exec(line);
    if (bullet) {
      if (!list) out.push({ kind: 'list', items: (list = []) });
      list.push(inline(bullet[1].trim()));
      continue;
    }
    list = null;
    if (!line.trim()) continue;
    const heading = /^## (.+)$/.exec(line);
    if (heading) out.push({ kind: 'heading', parts: inline(heading[1].trim()) });
    else out.push({ kind: 'para', parts: inline(line.trim()) });
  }
  return out;
}
