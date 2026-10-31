// NotebookLM refuses a question of about 800 words or more with `invalid_argument`. Measured on a real account: 762 words of
// real Vietnamese (the largest lesson with a correction note) and 750 of filler pass, 800 of filler do not, whatever the
// characters, bytes or punctuation. Only the words between spaces count. The cap sits well under the largest question seen to
// pass, so a count that is not exactly ours cannot turn a good question into a refusal; a question over it is refused here, by
// name, instead of there as an opaque `invalid_argument`. It is never met by shortening what the question says.
export const NOTEBOOKLM_QUERY_MAX_WORDS = 740;

export const countQueryWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;
