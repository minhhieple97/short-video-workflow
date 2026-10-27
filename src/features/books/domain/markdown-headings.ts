import type { Root } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface MarkdownHeading {
  depth: number;
  text: string;
  start: number;
}

// Only top-level headings count: headings nested in lists or blockquotes never start a chapter.
export function extractMarkdownHeadings(markdown: string): MarkdownHeading[] {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const headings: MarkdownHeading[] = [];
  for (const node of tree.children) {
    const start = node.position?.start.offset;
    if (node.type !== "heading" || start === undefined) continue;
    const text = toString(node).replace(/\s+/g, " ").trim();
    if (text.length > 0) headings.push({ depth: node.depth, text, start });
  }
  return headings;
}
