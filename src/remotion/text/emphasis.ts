const NUMBER = /\d/;
const QUOTED = /["“][^"”]+["”]/u;

// Which words of a headline sit on the accent block when the script names none: numbers and quoted words first,
// otherwise the last line (where a short punchline usually lands).
export function autoEmphasis(text: string, lines: readonly string[]): string[] {
  const words = text.split(/\s+/);
  const numbers = words.filter((word) => NUMBER.test(word));
  if (numbers.length > 0) return numbers;
  const quote = QUOTED.exec(text)?.[0];
  if (quote) return [quote.replace(/["“”]/gu, "")];
  return lines.length > 1 ? [lines.at(-1) ?? ""] : [];
}
