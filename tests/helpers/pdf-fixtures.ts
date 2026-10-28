import { createHash } from "node:crypto";

// Hand-built PDFs for tests: text written with a standard font (no embedding), full-page grey images standing in for
// scans, blank pages, and the standard 40-bit RC4 security handler for password and permission cases. Nothing here is
// meant to be a general PDF writer.

export interface FixturePage {
  // Lines written with Helvetica in WinAnsi encoding; characters outside Latin-1 are not representable.
  lines?: readonly string[];
  // Draws a grey picture over the whole page, as a scanned page would be.
  image?: boolean;
}

export interface FixtureEncryption {
  userPassword: string;
  ownerPassword: string;
  allowCopy: boolean;
}

const PADDING = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + (s[i] ?? 0) + (key[i % key.length] ?? 0)) & 255;
    [s[i], s[j]] = [s[j] ?? 0, s[i] ?? 0];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k += 1) {
    i = (i + 1) & 255;
    j = (j + (s[i] ?? 0)) & 255;
    [s[i], s[j]] = [s[j] ?? 0, s[i] ?? 0];
    out[k] = (data[k] ?? 0) ^ (s[((s[i] ?? 0) + (s[j] ?? 0)) & 255] ?? 0);
  }
  return out;
}

const md5 = (...parts: Buffer[]) => createHash("md5").update(Buffer.concat(parts)).digest();
const pad = (password: string) => Buffer.concat([Buffer.from(password, "latin1"), PADDING]).subarray(0, 32);

function escapeText(line: string): string {
  return line.replace(/[\\()]/g, (character) => `\\${character}`);
}

function int32le(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value);
  return buffer;
}

export function buildPdf(pages: readonly FixturePage[], encryption?: FixtureEncryption): Buffer {
  const objects: (Buffer | null)[] = [];
  const add = () => objects.push(null);
  const catalog = add();
  const pagesTree = add();
  const font = add();
  const pageObjects = pages.map((page) => ({ page: add(), content: add(), image: page.image ? add() : null }));
  const fileId = createHash("md5").update(JSON.stringify(pages)).digest();

  let fileKey: Buffer | null = null;
  let encryptDict = "";
  if (encryption) {
    // Permissions: everything allowed except, when asked, copying text (bit 5).
    const permissions = encryption.allowCopy ? -4 : -4 & ~16;
    const ownerKey = md5(pad(encryption.ownerPassword || encryption.userPassword)).subarray(0, 5);
    const owner = rc4(ownerKey, pad(encryption.userPassword));
    fileKey = md5(pad(encryption.userPassword), owner, int32le(permissions), fileId).subarray(0, 5);
    const user = rc4(fileKey, PADDING);
    encryptDict = `/Encrypt <</Filter/Standard/V 1/R 2/O <${owner.toString("hex")}>/U <${user.toString("hex")}>/P ${permissions}>>`;
  }

  const stream = (objectNumber: number, dictionary: string, data: Buffer): Buffer => {
    const body = fileKey
      ? rc4(
          md5(
            fileKey,
            Buffer.from([objectNumber & 255, (objectNumber >> 8) & 255, (objectNumber >> 16) & 255, 0, 0]),
          ).subarray(0, 10),
          data,
        )
      : data;
    return Buffer.concat([
      Buffer.from(`<<${dictionary}/Length ${body.length}>>\nstream\n`, "latin1"),
      body,
      Buffer.from("\nendstream", "latin1"),
    ]);
  };

  objects[catalog - 1] = Buffer.from(`<</Type/Catalog/Pages ${pagesTree} 0 R>>`);
  objects[pagesTree - 1] = Buffer.from(
    `<</Type/Pages/Kids[${pageObjects.map((entry) => `${entry.page} 0 R`).join(" ")}]/Count ${pages.length}>>`,
  );
  objects[font - 1] = Buffer.from("<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>");
  pages.forEach((page, index) => {
    const entry = pageObjects[index];
    if (!entry) return;
    const operations: string[] = [];
    if (page.image && entry.image) operations.push("q 595 0 0 842 0 0 cm /Im1 Do Q");
    if (page.lines?.length) {
      operations.push(
        `BT /F1 12 Tf 14 TL 56 780 Td ${page.lines.map((line) => `(${escapeText(line)}) Tj T*`).join(" ")} ET`,
      );
    }
    const resources = `/Resources<</Font<</F1 ${font} 0 R>>${entry.image ? `/XObject<</Im1 ${entry.image} 0 R>>` : ""}>>`;
    objects[entry.page - 1] = Buffer.from(
      `<</Type/Page/Parent ${pagesTree} 0 R/MediaBox[0 0 595 842]${resources}/Contents ${entry.content} 0 R>>`,
    );
    objects[entry.content - 1] = stream(entry.content, "", Buffer.from(operations.join("\n"), "latin1"));
    if (entry.image) {
      const pixels = Buffer.alloc(64 * 64, 0x99);
      objects[entry.image - 1] = stream(
        entry.image,
        "/Type/XObject/Subtype/Image/Width 64/Height 64/ColorSpace/DeviceGray/BitsPerComponent 8",
        pixels,
      );
    }
  });

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets: number[] = [];
  let length = parts[0]?.length ?? 0;
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object ?? Buffer.alloc(0),
      Buffer.from("\nendobj\n"),
    ]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = [
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
  ].join("");
  const id = fileId.toString("hex");
  const trailer = `trailer\n<</Size ${objects.length + 1}/Root ${catalog} 0 R/ID[<${id}><${id}>]${encryptDict}>>\nstartxref\n${length}\n%%EOF\n`;
  return Buffer.concat([...parts, Buffer.from(xref + trailer, "latin1")]);
}
