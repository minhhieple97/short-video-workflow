// NotebookLM refuses a question of more than about 750 words with `invalid_argument`. Measured on a real account: 750 words
// pass and 800 do not, whatever the characters, bytes or punctuation. Only the words between spaces count. The margin
// below is for a count that is not exactly ours.
export const NOTEBOOKLM_QUERY_MAX_WORDS = 700;

export const countQueryWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;
