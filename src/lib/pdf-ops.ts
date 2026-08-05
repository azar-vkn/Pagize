import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export type OutputFile = { name: string; blob: Blob };

const load = async (file: File) =>
  PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });

const save = async (doc: PDFDocument, name: string): Promise<OutputFile> => {
  const bytes = await doc.save();
  return { name, blob: new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }) };
};

const baseName = (file: File) => file.name.replace(/\.[^.]+$/, "");

/** Parses "1-3, 5, 8-" into zero-based page indices, clamped to pageCount. */
export function parsePageRanges(input: string, pageCount: number): number[] {
  const out = new Set<number>();
  for (const chunk of input.split(",")) {
    const part = chunk.trim();
    if (!part) continue;
    const m = part.match(/^(\d+)?\s*-\s*(\d+)?$/);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 1;
      const end = m[2] ? parseInt(m[2], 10) : pageCount;
      for (let p = start; p <= Math.min(end, pageCount); p++) if (p >= 1) out.add(p - 1);
    } else if (/^\d+$/.test(part)) {
      const p = parseInt(part, 10);
      if (p >= 1 && p <= pageCount) out.add(p - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export async function pageCountOf(file: File) {
  return (await load(file)).getPageCount();
}

export async function mergePdfs(files: File[]): Promise<OutputFile[]> {
  const out = await PDFDocument.create();
  for (const file of files) {
    const doc = await load(file);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return [await save(out, "merged.pdf")];
}

export async function splitPdf(
  file: File,
  mode: "ranges" | "every",
  ranges: string,
): Promise<OutputFile[]> {
  const src = await load(file);
  const total = src.getPageCount();
  const groups: number[][] =
    mode === "every"
      ? src.getPageIndices().map((i) => [i])
      : ranges
          .split(",")
          .map((chunk) => parsePageRanges(chunk, total))
          .filter((g) => g.length > 0);
  if (groups.length === 0) throw new Error("Enter at least one page range, e.g. 1-3, 4-6.");
  const results: OutputFile[] = [];
  for (const [i, group] of groups.entries()) {
    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(src, group);
    pages.forEach((p) => doc.addPage(p));
    results.push(await save(doc, `${baseName(file)}-part-${i + 1}.pdf`));
  }
  return results;
}

export async function selectPages(
  file: File,
  ranges: string,
  action: "keep" | "remove",
): Promise<OutputFile[]> {
  const src = await load(file);
  const total = src.getPageCount();
  const picked = parsePageRanges(ranges, total);
  const keep =
    action === "keep" ? picked : src.getPageIndices().filter((i) => !picked.includes(i));
  if (keep.length === 0) throw new Error("That selection would leave no pages.");
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, keep);
  pages.forEach((p) => doc.addPage(p));
  return [await save(doc, `${baseName(file)}-${action === "keep" ? "extracted" : "trimmed"}.pdf`)];
}

export async function rotatePdf(file: File, angle: number, ranges: string): Promise<OutputFile[]> {
  const doc = await load(file);
  const total = doc.getPageCount();
  const targets = ranges.trim() ? parsePageRanges(ranges, total) : doc.getPageIndices();
  targets.forEach((i) => {
    const page = doc.getPage(i);
    page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  });
  return [await save(doc, `${baseName(file)}-rotated.pdf`)];
}

export async function imagesToPdf(files: File[]): Promise<OutputFile[]> {
  const doc = await PDFDocument.create();
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const img =
      /\.png$/i.test(file.name) || file.type === "image/png"
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return [await save(doc, "images.pdf")];
}

export type NumberPosition = "bottom-center" | "bottom-right" | "top-center" | "top-right";

export async function addPageNumbers(
  file: File,
  position: NumberPosition,
  startAt: number,
): Promise<OutputFile[]> {
  const doc = await load(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 11;
  doc.getPages().forEach((page, i) => {
    const label = String(startAt + i);
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(label, size);
    const x = position.endsWith("right") ? width - textWidth - 40 : (width - textWidth) / 2;
    const y = position.startsWith("top") ? height - 40 : 28;
    page.drawText(label, { x, y, size, font, color: rgb(0.25, 0.22, 0.2) });
  });
  return [await save(doc, `${baseName(file)}-numbered.pdf`)];
}

export async function watermarkPdf(
  file: File,
  text: string,
  opacity: number,
  angle: number,
  size: number,
): Promise<OutputFile[]> {
  const doc = await load(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: width / 2 - (textWidth / 2) * Math.cos((angle * Math.PI) / 180),
      y: height / 2 - (textWidth / 2) * Math.sin((angle * Math.PI) / 180),
      size,
      font,
      color: rgb(1, 0.54, 0.3),
      opacity,
      rotate: degrees(angle),
    });
  }
  return [await save(doc, `${baseName(file)}-watermarked.pdf`)];
}

export async function compressPdf(
  file: File,
  level: "low" | "recommended" | "extreme",
): Promise<OutputFile[]> {
  const src = await load(file);
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, src.getPageIndices());
  pages.forEach((p) => doc.addPage(p));
  if (level !== "low") {
    doc.setAuthor("");
    doc.setSubject("");
    doc.setKeywords([]);
    doc.setProducer("");
    doc.setCreator("");
  }
  const bytes = await doc.save({ useObjectStreams: level === "extreme" });
  return [
    {
      name: `${baseName(file)}-compressed.pdf`,
      blob: new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
    },
  ];
}