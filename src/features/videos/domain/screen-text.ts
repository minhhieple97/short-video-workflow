const LIST_MARKER = /(?=(?:^|\s)\d{1,2}[).]\s)/u;

// "1) … 2) … 3) …" written in one line: one item per line, or null when the text is not such a list. A scene made before
// shots existed keeps its checklist in this form; shots carry their list lines as data.
export function listItems(text: string): string[] | null {
  const items = text
    .split(LIST_MARKER)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length >= 2 && items.every((item) => /^\d{1,2}[).]\s/u.test(item)) ? items : null;
}
