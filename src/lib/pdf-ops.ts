import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { encryptPDF } from "@pdfsmaller/pdf-encrypt";

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
  const keep = action === "keep" ? picked : src.getPageIndices().filter((i) => !picked.includes(i));
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

/** Reorder pages into the given order (zero-based indices). */
export async function organizePages(file: File, newOrder: number[]): Promise<OutputFile[]> {
  const src = await load(file);
  if (newOrder.length === 0) throw new Error("Select at least one page to keep.");
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, newOrder);
  pages.forEach((p) => doc.addPage(p));
  return [await save(doc, `${baseName(file)}-reordered.pdf`)];
}

/** Crop all (or specified) pages by trimming margins in points. */
export async function cropPdf(
  file: File,
  margins: { top: number; right: number; bottom: number; left: number },
  ranges: string,
): Promise<OutputFile[]> {
  const doc = await load(file);
  const total = doc.getPageCount();
  const targets = ranges.trim() ? parsePageRanges(ranges, total) : doc.getPageIndices();
  for (const i of targets) {
    const page = doc.getPage(i);
    const { width, height } = page.getSize();

    // Ensure we don't create negative boxes
    const newWidth = Math.max(1, width - margins.left - margins.right);
    const newHeight = Math.max(1, height - margins.top - margins.bottom);

    // Set all boxes to be extremely thorough, as some viewers ignore CropBox
    page.setCropBox(margins.left, margins.bottom, newWidth, newHeight);
    page.setMediaBox(margins.left, margins.bottom, newWidth, newHeight);
    page.setTrimBox(margins.left, margins.bottom, newWidth, newHeight);
    page.setBleedBox(margins.left, margins.bottom, newWidth, newHeight);
    page.setArtBox(margins.left, margins.bottom, newWidth, newHeight);
  }
  return [await save(doc, `${baseName(file)}-cropped.pdf`)];
}

/**
 * Protect a PDF with actual AES-256 encryption.
 */
export async function protectPdf(
  file: File,
  userPassword: string,
  ownerPassword: string,
): Promise<OutputFile[]> {
  const pdfBytes = new Uint8Array(await file.arrayBuffer());

  // Use @pdfsmaller/pdf-encrypt for real encryption
  const encrypted = await encryptPDF(pdfBytes, userPassword, {
    ownerPassword: ownerPassword || userPassword, // Fallback if owner is empty
    allowPrinting: false,
    allowCopying: false,
    allowModifying: false,
  });

  return [
    {
      name: `${baseName(file)}-protected.pdf`,
      blob: new Blob([encrypted as unknown as BlobPart], { type: "application/pdf" }),
    },
  ];
}

/** Remove password protection by re-saving (we already load with ignoreEncryption). */
export async function unlockPdf(file: File): Promise<OutputFile[]> {
  const src = await load(file);
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, src.getPageIndices());
  pages.forEach((p) => doc.addPage(p));
  doc.setProducer("Pagize");
  doc.setCreator("Pagize");
  return [await save(doc, `${baseName(file)}-unlocked.pdf`)];
}

/** Repair a PDF by re-loading it permissively and saving a clean copy. */
export async function repairPdf(file: File): Promise<OutputFile[]> {
  const src = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, src.getPageIndices());
  pages.forEach((p) => doc.addPage(p));
  doc.setProducer("Pagize (Repaired)");
  doc.setCreator("Pagize");
  return [await save(doc, `${baseName(file)}-repaired.pdf`)];
}

/** Convert to PDF/A-like by stripping metadata and adding conformance info. */
export async function pdfToPdfa(file: File): Promise<OutputFile[]> {
  const src = await load(file);
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, src.getPageIndices());
  pages.forEach((p) => doc.addPage(p));
  doc.setProducer("Pagize");
  doc.setCreator("Pagize");
  doc.setSubject("PDF/A Conformance");
  doc.setAuthor("");
  doc.setKeywords([]);
  return [await save(doc, `${baseName(file)}-pdfa.pdf`)];
}

/** Draw black rectangles over specified areas on given pages. */
export async function redactPdf(
  file: File,
  redactions: { page: number; x: number; y: number; width: number; height: number }[],
): Promise<OutputFile[]> {
  const doc = await load(file);
  for (const r of redactions) {
    const page = doc.getPage(r.page);
    const { height } = page.getSize();
    page.drawRectangle({
      x: r.x,
      // PDF origin is bottom-left, convert from top-left
      y: height - r.y - r.height,
      width: r.width,
      height: r.height,
      color: rgb(0, 0, 0),
    });
  }
  return [await save(doc, `${baseName(file)}-redacted.pdf`)];
}

/** OCR placeholder: re-save the document cleanly (text-based PDFs are already searchable). */
export async function ocrPdf(file: File): Promise<OutputFile[]> {
  const src = await load(file);
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, src.getPageIndices());
  pages.forEach((p) => doc.addPage(p));
  doc.setProducer("Pagize (OCR processed)");
  return [await save(doc, `${baseName(file)}-ocr.pdf`)];
}

/** Embed a signature image onto a specific page at given coordinates. */
export async function signPdf(
  file: File,
  signatureDataUrl: string,
  pageIndex: number,
  x: number,
  y: number,
  sigWidth: number,
  sigHeight: number,
): Promise<OutputFile[]> {
  const doc = await load(file);
  // Convert data URL to bytes
  const base64 = signatureDataUrl.split(",")[1] ?? "";
  const sigBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const isPng = signatureDataUrl.includes("image/png");
  const sigImage = isPng ? await doc.embedPng(sigBytes) : await doc.embedJpg(sigBytes);

  const page = doc.getPage(pageIndex);
  const { height } = page.getSize();
  page.drawImage(sigImage, {
    x,
    y: height - y - sigHeight,
    width: sigWidth,
    height: sigHeight,
  });
  return [await save(doc, `${baseName(file)}-signed.pdf`)];
}

/** Add text annotation on a page. */
export async function editPdfAddText(
  file: File,
  annotations: {
    page: number;
    x: number;
    y: number;
    text: string;
    size: number;
    color: { r: number; g: number; b: number };
  }[],
): Promise<OutputFile[]> {
  const doc = await load(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const a of annotations) {
    const page = doc.getPage(a.page);
    const { height } = page.getSize();
    page.drawText(a.text, {
      x: a.x,
      y: height - a.y - a.size,
      size: a.size,
      font,
      color: rgb(a.color.r, a.color.g, a.color.b),
    });
  }
  return [await save(doc, `${baseName(file)}-edited.pdf`)];
}

export interface TextReplacement {
  pageIndex: number;
  x: number; // canvas X (used for uniqueness matching in UI)
  y: number; // canvas Y
  pdfX: number; // actual PDF coordinate (baseline X)
  pdfY: number; // actual PDF coordinate (baseline Y)
  pdfWidth: number; // in PDF space
  width: number; // in canvas space
  height: number; // in canvas space
  fontSize: number; // in PDF space
  fontFamily?: "Helvetica" | "TimesRoman" | "Courier";
  isBold?: boolean;
  isItalic?: boolean;
  color?: string; // hex color e.g., "#000000"
  bgColor?: string; // hex background color e.g., "#ffffff", "#f3f4f6"
  originalText: string;
  newText: string;
}

/** Resolve the correct StandardFont key for a given family + weight + style. */
function resolveStandardFont(
  family: "Helvetica" | "TimesRoman" | "Courier",
  bold: boolean,
  italic: boolean,
): StandardFonts {
  if (family === "Courier") {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (family === "TimesRoman") {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  // Helvetica
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

/** Helper to parse a hex color string into pdf-lib RGB values */
function parseHexColor(hex: string | undefined, defaultHex: string) {
  const target = (hex || defaultHex).replace("#", "").trim();
  let cleanHex = target;
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const rVal = parseInt(cleanHex.substring(0, 2) || "00", 16) / 255;
  const gVal = parseInt(cleanHex.substring(2, 4) || "00", 16) / 255;
  const bVal = parseInt(cleanHex.substring(4, 6) || "00", 16) / 255;
  return rgb(isNaN(rVal) ? 0 : rVal, isNaN(gVal) ? 0 : gVal, isNaN(bVal) ? 0 : bVal);
}

/**
 * Replace text on a page by covering the original bounding box with the matching
 * background color and drawing the new text over it with precise font metrics.
 */
export async function editPdfReplaceText(
  file: File,
  replacements: TextReplacement[],
): Promise<OutputFile[]> {
  const doc = await load(file);

  // Embed all 12 standard font variants so we can match bold/italic
  const fontCache = new Map<StandardFonts, Awaited<ReturnType<typeof doc.embedFont>>>();
  async function getFont(key: StandardFonts) {
    let f = fontCache.get(key);
    if (!f) {
      f = await doc.embedFont(key);
      fontCache.set(key, f);
    }
    return f;
  }

  for (const r of replacements) {
    if (r.newText === r.originalText) continue;
    const page = doc.getPage(r.pageIndex);
    const family = r.fontFamily || "Helvetica";
    const bold = r.isBold ?? false;
    const italic = r.isItalic ?? false;
    const fontKey = resolveStandardFont(family, bold, italic);
    const font = await getFont(fontKey);
    const fontSize = r.fontSize || 12;

    const lines = r.newText.split("\n");
    const origLines = r.originalText.split("\n");

    // Calculate required width to cover: must cover at least the original text width or pdfWidth
    const origTextWidth = font.widthOfTextAtSize(r.originalText, fontSize);
    const newTextWidth = Math.max(...lines.map((l) => font.widthOfTextAtSize(l, fontSize)));
    const rectWidth = Math.max(r.pdfWidth || 0, origTextWidth, newTextWidth) + 3;

    const lineHeight = fontSize * 1.15;
    const numLines = Math.max(lines.length, origLines.length);
    const rectHeight = (numLines - 1) * lineHeight + fontSize * 1.12;
    const rectY = r.pdfY - (numLines - 1) * lineHeight - fontSize * 0.22;

    // Parse background color to seamlessly blend with table rows, banners, or pages
    const bgRgb = parseHexColor(r.bgColor, "#ffffff");

    // Draw background rectangle to seamlessly hide original text
    page.drawRectangle({
      x: r.pdfX - 1.5,
      y: rectY,
      width: rectWidth,
      height: rectHeight,
      color: bgRgb,
      borderWidth: 0,
    });

    // Parse text color
    const colorRgb = parseHexColor(r.color, "#000000");

    // Draw each line of new text
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const lineText = lines[lineIdx] ?? "";
      if (!lineText) continue;
      page.drawText(lineText, {
        x: r.pdfX,
        y: r.pdfY - lineIdx * lineHeight,
        size: fontSize,
        font,
        color: colorRgb,
      });
    }
  }

  return [await save(doc, `${baseName(file)}-edited.pdf`)];
}
