const LIST_MARKER = /(?=(?:^|\s)\d{1,2}[).]\s)/u;

// "1) … 2) … 3) …" written in one line: one item per line, or null when the text is not such a list.
export function listItems(text: string): string[] | null {
  const items = text
    .split(LIST_MARKER)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length >= 2 && items.every((item) => /^\d{1,2}[).]\s/u.test(item)) ? items : null;
}

// Breaks a headline into a few lines of similar length (about `lineChars` characters each), so big type wraps by meaning
// rather than leaving one word alone on the last line.
export function balanceLines(text: string, lineChars = 16, maxLines = 4): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const total = words.join(" ").length;
  const lines = Math.max(1, Math.min(maxLines, words.length, Math.ceil(total / lineChars)));
  const target = total / lines;
  const result: string[] = [];
  let current: string[] = [];
  for (const [index, word] of words.entries()) {
    const remainingWords = words.length - index;
    const remainingLines = lines - result.length;
    const length = [...current, word].join(" ").length;
    if (current.length > 0 && remainingLines > 1 && (length > target * 1.15 || remainingWords < remainingLines)) {
      result.push(current.join(" "));
      current = [];
    }
    current.push(word);
  }
  if (current.length > 0) result.push(current.join(" "));
  return result;
}
