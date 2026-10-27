export type MarkerLevel = "chapter" | "part";

export interface ChapterMarker {
  level: MarkerLevel;
  keyword: string;
  numeral: string;
  title: string;
}

const CHAPTER_KEYWORDS = ["chương", "chuong", "chapter", "hồi"];
const PART_KEYWORDS = ["phần", "phan", "part", "quyển", "book"];

const VI_NUMBER_WORDS = ["một", "hai", "ba", "bốn", "tư", "năm", "lăm", "sáu", "bảy", "tám", "chín", "mười", "mươi"];
const EN_NUMBER_WORDS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
];

const MAX_MARKER_LINE_LENGTH = 120;
const NUMERAL_END = String.raw`(?=$|[\s.:\-–—)])`;
const KEYWORD_PATTERN = new RegExp(String.raw`^(${[...CHAPTER_KEYWORDS, ...PART_KEYWORDS].join("|")})\s+(.+)$`, "iu");
const DIGITS_PATTERN = new RegExp(String.raw`^\d{1,3}${NUMERAL_END}`, "u");
// Roman numerals must be upper case so words like "mix" or "did" are not mistaken for numbers.
const ROMAN_PATTERN = new RegExp(
  String.raw`^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})${NUMERAL_END}`,
  "u",
);
const NUMBER_WORD = `(?:${[...VI_NUMBER_WORDS, ...EN_NUMBER_WORDS].join("|")})`;
const WORDS_PATTERN = new RegExp(String.raw`^${NUMBER_WORD}(?:[\s-]+${NUMBER_WORD}){0,2}${NUMERAL_END}`, "iu");

function matchNumeral(rest: string): string | null {
  for (const pattern of [DIGITS_PATTERN, ROMAN_PATTERN, WORDS_PATTERN]) {
    const match = pattern.exec(rest);
    if (match && match[0].length > 0) return match[0];
  }
  return null;
}

export function parseChapterMarker(line: string): ChapterMarker | null {
  const trimmed = line.trim().replace(/^#+\s*/, "");
  if (trimmed.length === 0 || trimmed.length > MAX_MARKER_LINE_LENGTH) return null;

  const match = KEYWORD_PATTERN.exec(trimmed);
  const keyword = match?.[1];
  const rest = match?.[2];
  if (!keyword || !rest) return null;

  const numeral = matchNumeral(rest);
  if (!numeral) return null;

  const lowerKeyword = keyword.toLowerCase();
  return {
    level: CHAPTER_KEYWORDS.includes(lowerKeyword) ? "chapter" : "part",
    keyword,
    numeral,
    title: rest
      .slice(numeral.length)
      .replace(/^[\s.:\-–—)]+/, "")
      .trim(),
  };
}

export function compileExtraPatterns(sources: readonly string[]): RegExp[] {
  return sources.map((source) => new RegExp(source, "iu"));
}

// JavaScript's \b is ASCII-only, so titles ending in Vietnamese letters need an explicit terminator.
const TITLE_END = String.raw`(?=$|[\s.:\-–—,(])`;
const titlePattern = (alternatives: readonly string[]) =>
  new RegExp(`^(?:${alternatives.join("|")})${TITLE_END}`, "iu");

const TABLE_OF_CONTENTS_PATTERN = titlePattern(["mục lục", "muc luc", "table of contents", "contents"]);
const FRONT_MATTER_PATTERN = titlePattern([
  "lời nói đầu",
  "lời mở đầu",
  "lời giới thiệu",
  "lời cảm ơn",
  "lời cảm tạ",
  "lời tựa",
  "lời bạt",
  "lời tác giả",
  "preface",
  "foreword",
  "prologue",
  "acknowledgements?",
  "acknowledgments?",
]);
const BACK_MATTER_PATTERN = titlePattern([
  "phụ lục",
  "appendix",
  "index",
  "chú thích",
  "tài liệu tham khảo",
  "references",
  "bibliography",
  "về tác giả",
  "about the author",
]);

export type SpecialSectionKind = "table-of-contents" | "front-matter" | "back-matter";

export function classifySpecialTitle(title: string): SpecialSectionKind | null {
  const trimmed = title.trim();
  if (TABLE_OF_CONTENTS_PATTERN.test(trimmed)) return "table-of-contents";
  if (FRONT_MATTER_PATTERN.test(trimmed)) return "front-matter";
  if (BACK_MATTER_PATTERN.test(trimmed)) return "back-matter";
  return null;
}
