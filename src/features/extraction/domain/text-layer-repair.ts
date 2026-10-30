// Word documents printed to PDF by some drivers (PrimoPDF/Nitro on a Times New Roman book) are drawn with the right đ and
// Đ glyphs but carry the wrong code for them in the text layer: đ is read as ñ (U+00F1) and Đ as ð (U+00F0), so pdftotext
// and any copy-paste give "ñiện tử". Neither letter exists in Vietnamese, so where they fill a text layer in place of
// đ/Đ the fix is exact; OCR would cost money and could misread other letters.

const MISENCODED = /[ñðÑÐ]/gu;
const D_STROKE = /[đĐ]/gu;

// A Spanish name in a Vietnamese book has a few ñ; below this a text layer proves nothing.
const MIN_MISENCODED_CHARACTERS = 20;
// A sound Vietnamese book has about one such letter per thousand đ/Đ. A book that mixes fonts can have only some of them
// misread, so the bad ones need not be the majority.
const MIN_MISENCODED_SHARE = 0.2;

// In the PDF this was written for, ñ is the lowercase letter (it never follows a full stop) and ð the capital (it starts
// sentences and names, and never follows a letter). Ñ and Ð are the capital đ of the VNI and Windows-1258 conventions.
const REPAIRED: Readonly<Record<string, string>> = { ñ: "đ", Ñ: "Đ", ð: "Đ", Ð: "Đ" };

const count = (text: string, pattern: RegExp) => text.normalize("NFC").match(pattern)?.length ?? 0;

function hasMisencodedDStroke(texts: readonly string[]): boolean {
  let misencoded = 0;
  let genuine = 0;
  for (const text of texts) {
    misencoded += count(text, MISENCODED);
    genuine += count(text, D_STROKE);
  }
  return misencoded >= MIN_MISENCODED_CHARACTERS && misencoded >= (misencoded + genuine) * MIN_MISENCODED_SHARE;
}

// One character for one character, so every offset into the text stays valid.
export function repairMisencodedDStroke(text: string): string {
  return text.normalize("NFC").replace(MISENCODED, (character) => REPAIRED[character] ?? character);
}

export interface TextLayerRepair {
  texts: string[];
  repairedCharacters: number;
}

// Decides for the whole book, not page by page: a short page (a chapter title) may hold a single ñ that proves nothing alone.
export function repairTextLayer(texts: readonly string[]): TextLayerRepair {
  if (!hasMisencodedDStroke(texts)) return { texts: [...texts], repairedCharacters: 0 };
  return {
    texts: texts.map(repairMisencodedDStroke),
    repairedCharacters: texts.reduce((total, text) => total + count(text, MISENCODED), 0),
  };
}
