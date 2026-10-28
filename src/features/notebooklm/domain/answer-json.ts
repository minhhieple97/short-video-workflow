// NotebookLM answers in prose and may wrap the JSON it was asked for in a code fence or a sentence. This takes the first
// complete JSON object or array in the answer; null when there is none. Citation markers such as "[1]" outside strings
// would break JSON, so only the fenced block or the outermost brackets are tried, never a repaired guess.
export function extractJsonFromAnswer(answer: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(answer)?.[1];
  // Only the bracket that opens first is followed: an array inside a broken object is not the answer.
  const objectFirst =
    answer.indexOf("{") !== -1 && (answer.indexOf("[") === -1 || answer.indexOf("{") < answer.indexOf("["));
  const bare = objectFirst ? outermost(answer, "{", "}") : outermost(answer, "[", "]");
  for (const candidate of [fenced, bare]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
  }
  return null;
}

function outermost(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  return start !== -1 && end > start ? text.slice(start, end + 1) : null;
}
