// An AI may reword its sources, but it may not add a number or a quotation that they do not contain. This is a mechanical
// backstop for the prompt rule, not a proof of faithfulness: it cannot see a made-up claim that uses no number and no
// quotation marks.
export interface UnsupportedClaims {
  numbers: string[];
  quotes: string[];
}

const NUMBER = /\d+(?:[.,]\d+)*/g;
const QUOTED = /[“"«]([^”"»]{3,})[”"»]/g;

// Only the words of a quotation count: a line whose comma became a full stop, or whose marks changed, is still the same line.
const normalize = (text: string): string =>
  text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const canonicalNumber = (token: string): string => token.replace(",", ".").replace(/\.0+$/, "");

export function findUnsupportedClaimsIn(texts: readonly string[], sources: readonly string[]): UnsupportedClaims {
  const sourceNumbers = new Set(sources.flatMap((text) => (text.match(NUMBER) ?? []).map(canonicalNumber)));
  const normalizedSources = sources.map(normalize);

  const numbers = new Set<string>();
  const quotes = new Set<string>();
  for (const text of texts) {
    for (const token of text.match(NUMBER) ?? []) {
      if (!sourceNumbers.has(canonicalNumber(token))) numbers.add(token);
    }
    for (const match of text.matchAll(QUOTED)) {
      const quote = match[1] ?? "";
      if (!normalizedSources.some((source) => source.includes(normalize(quote)))) quotes.add(quote);
    }
  }
  return { numbers: [...numbers], quotes: [...quotes] };
}

export function hasUnsupportedClaims(claims: UnsupportedClaims): boolean {
  return claims.numbers.length > 0 || claims.quotes.length > 0;
}
