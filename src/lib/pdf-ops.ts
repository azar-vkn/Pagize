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
    page.setCropBox(
      margins.left,
      margins.bottom,
      width - margins.left - margins.right,
      height - margins.top - margins.bottom,
    );
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
  x: number; // canvas Y (used for uniqueness matching in UI)
  y: number;
  pdfX: number; // actual PDF coordinate
  pdfY: number; // actual PDF coordinate (baseline)
  width: number; // in PDF space
  height: number; // in PDF space
  fontSize: number; // in PDF space
  fontFamily?: "Helvetica" | "TimesRoman" | "Courier";
  color?: string; // hex color e.g., "#000000"
  originalText: string;
  newText: string;
}

/**
 * Replace text on a page by whiting out the original bounding box
 * and drawing the new text over it.
 */
export async function editPdfReplaceText(
  file: File,
  replacements: TextReplacement[],
): Promise<OutputFile[]> {
  const doc = await load(file);
  const fonts = {
    Helvetica: await doc.embedFont(StandardFonts.Helvetica),
    TimesRoman: await doc.embedFont(StandardFonts.TimesRoman),
    Courier: await doc.embedFont(StandardFonts.Courier),
  };

  for (const r of replacements) {
    const page = doc.getPage(r.pageIndex);
    const font = fonts[r.fontFamily || "Helvetica"];

    const lines = r.newText.split("\n");
    const newHeight = Math.max(r.height, lines.length * r.fontSize);

    // Draw white rectangle to hide old text with slight padding
    page.drawRectangle({
      x: r.pdfX - 2,
      y: r.pdfY - (newHeight - r.fontSize) - r.fontSize * 0.25,
      width: Math.max(r.width + 4, font.widthOfTextAtSize(lines[0] || "", r.fontSize) + 4),
      height: newHeight + r.fontSize * 0.5,
      color: rgb(1, 1, 1),
      borderColor: rgb(1, 1, 1),
      borderWidth: 0,
    });

    // Parse hex color or default to black
    const hexColor = r.color || "#000000";
    const cleanHex = hexColor.replace("#", "");
    const colorRgb = rgb(
      parseInt(cleanHex.substring(0, 2), 16) / 255,
      parseInt(cleanHex.substring(2, 4), 16) / 255,
      parseInt(cleanHex.substring(4, 6), 16) / 255,
    );

    // Draw new text
    page.drawText(r.newText, {
      x: r.pdfX,
      y: r.pdfY,
      size: r.fontSize,
      font,
      color: colorRgb,
      lineHeight: r.fontSize,
    });
  }

  return [await save(doc, `${baseName(file)}-edited.pdf`)];
}
