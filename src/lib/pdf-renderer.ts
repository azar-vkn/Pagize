import * as pdfjsLib from "pdfjs-dist";

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const docCache = new Map<string, pdfjsLib.PDFDocumentProxy>();

async function getDoc(file: File): Promise<pdfjsLib.PDFDocumentProxy> {
  const key = `${file.name}-${file.size}-${file.lastModified}`;
  const cached = docCache.get(key);
  if (cached) return cached;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data }).promise;
  docCache.set(key, doc);
  return doc;
}

/** Render a single PDF page to a data URL. */
export async function renderPage(file: File, pageIndex: number, scale = 1): Promise<string> {
  const doc = await getDoc(file);
  const page = await doc.getPage(pageIndex + 1); // pdfjs is 1-based
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  return canvas.toDataURL("image/png");
}

/** Render all pages of a PDF to data URLs. */
export async function renderAllPages(file: File, scale = 0.5): Promise<string[]> {
  const doc = await getDoc(file);
  const urls: string[] = [];
  for (let i = 0; i < doc.numPages; i++) {
    urls.push(await renderPage(file, i, scale));
  }
  return urls;
}

/** Get the number of pages in a PDF file. */
export async function getPageCount(file: File): Promise<number> {
  const doc = await getDoc(file);
  return doc.numPages;
}

/** Render a page to a Blob (JPEG) at a given DPI-equivalent scale. */
export async function renderPageToBlob(
  file: File,
  pageIndex: number,
  scale = 2,
  quality = 0.92,
): Promise<Blob> {
  const doc = await getDoc(file);
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))),
      "image/jpeg",
      quality,
    );
  });
}

/** A contiguous run of text with uniform formatting. */
export interface TextRun {
  text: string;
  fontSize: number;
  fontFamily: string;
  isBold: boolean;
  isItalic: boolean;
}

/** A single visual line extracted from a PDF page, with per-run formatting. */
export interface ExtractedLine {
  runs: TextRun[];
  /** True when there's a paragraph-sized gap before this line. */
  isNewParagraph: boolean;
}

/** Cached font metadata resolved once per page. */
interface FontMeta {
  fontFamily: string;
  isBold: boolean;
  isItalic: boolean;
}

/**
 * Build a map of fontName → { fontFamily, isBold, isItalic } by combining:
 *  1. content.styles (gives fontFamily)
 *  2. page.commonObjs (gives bold/italic flags from the actual font descriptor)
 *  3. String-pattern fallback on fontName/fontFamily
 */
function buildFontMetaMap(
  content: { styles?: Record<string, { fontFamily?: string }> },
  page: { commonObjs?: { has?(k: string): boolean; get?(k: string): unknown } },
): Map<string, FontMeta> {
  const map = new Map<string, FontMeta>();
  const styles = content.styles ?? {};

  for (const [fontName, style] of Object.entries(styles)) {
    const rawFamily = style?.fontFamily ?? "";
    let isBold = false;
    let isItalic = false;

    // ── Strategy 1: Check page.commonObjs for authoritative bold/italic ──
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const objs = page.commonObjs as any;
      if (objs && typeof objs.has === "function" && objs.has(fontName)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fontObj = objs.get(fontName) as any;
        if (fontObj) {
          // pdfjs stores bold/italic on the font data at various nesting levels
          const b = fontObj.bold ?? fontObj.data?.bold ?? false;
          const it = fontObj.italic ?? fontObj.data?.italic ?? false;
          if (b) isBold = true;
          if (it) isItalic = true;

          // The font object often has a readable name like "Arial-BoldMT"
          const actualName: string = fontObj.name ?? fontObj.data?.name ?? "";
          if (!isBold && /bold/i.test(actualName)) isBold = true;
          if (!isItalic && /italic|oblique/i.test(actualName)) isItalic = true;
        }
      }
    } catch {
      // commonObjs access may not work — fall through to string checks
    }

    // ── Strategy 2: String pattern matching on fontName & fontFamily ──
    if (!isBold) {
      isBold =
        /bold/i.test(fontName) ||
        /Bold/i.test(rawFamily) ||
        // Subset prefix pattern: ABCDEF+FontName-Bold
        /\+[^-]+-Bold/i.test(fontName);
    }
    if (!isItalic) {
      isItalic =
        /italic|oblique/i.test(fontName) ||
        /italic|oblique/i.test(rawFamily);
    }

    map.set(fontName, {
      fontFamily: normalizeFontFamily(rawFamily),
      isBold,
      isItalic,
    });
  }
  return map;
}

/**
 * Map CSS generic families and raw font names to standard Word font names.
 * Strips subset prefixes and style suffixes.
 */
function normalizeFontFamily(raw: string): string {
  // Remove subset prefix like "BCDEEE+"
  let name = raw.replace(/^[A-Z]{6}\+/, "");
  // Remove common style suffixes (keep the base family)
  name = name.replace(/[,-]?(Bold|Italic|BoldItalic|Regular|Light|Medium|Semibold|SemiBold|Heavy|Black|Thin|Condensed|Narrow|MT|PS|It)$/gi, "");
  name = name.trim();

  // Map CSS generic families → standard Word fonts
  if (!name || /^sans-?serif$/i.test(name)) return "Arial";
  if (/^serif$/i.test(name)) return "Times New Roman";
  if (/^mono(space)?$/i.test(name)) return "Courier New";
  if (/^cursive$/i.test(name)) return "Comic Sans MS";
  if (/^fantasy$/i.test(name)) return "Impact";
  return name;
}

/** Extract text content from a PDF page, preserving line breaks using positional data. */
export async function extractPageText(file: File, pageIndex: number): Promise<string> {
  const doc = await getDoc(file);
  const page = await doc.getPage(pageIndex + 1);
  const content = await page.getTextContent();

  const lines: string[] = [];
  let currentLine = "";
  let lastY: number | null = null;

  for (const item of content.items) {
    if (!("str" in item)) continue;

    const ty = item.transform[5];
    const fontSize = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12;

    if (lastY !== null) {
      const yDelta = Math.abs(ty - lastY);
      if (yDelta > fontSize * 0.6) {
        lines.push(currentLine);
        currentLine = "";
        if (yDelta > fontSize * 1.8) {
          lines.push("");
        }
      }
    }

    if (currentLine && item.str && !currentLine.endsWith(" ") && !item.str.startsWith(" ")) {
      currentLine += " ";
    }
    currentLine += item.str;
    lastY = ty;

    if ((item as { hasEOL?: boolean }).hasEOL) {
      lines.push(currentLine);
      currentLine = "";
      lastY = null;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines.join("\n");
}

/** Extract text from all pages (plain text with line breaks preserved). */
export async function extractAllText(file: File): Promise<string[]> {
  const doc = await getDoc(file);
  const texts: string[] = [];
  for (let i = 0; i < doc.numPages; i++) {
    texts.push(await extractPageText(file, i));
  }
  return texts;
}

/**
 * Extract structured text from a single PDF page.
 * Returns lines, each containing one or more TextRuns with per-run formatting.
 */
export async function extractPageTextStructured(
  file: File,
  pageIndex: number,
): Promise<ExtractedLine[]> {
  const doc = await getDoc(file);
  const page = await doc.getPage(pageIndex + 1);
  const content = await page.getTextContent();

  // Build font metadata map once for the whole page
  const fontMeta = buildFontMetaMap(
    content as { styles?: Record<string, { fontFamily?: string }> },
    page as unknown as { commonObjs?: { has?(k: string): boolean; get?(k: string): unknown } },
  );

  const result: ExtractedLine[] = [];
  let currentRuns: TextRun[] = [];
  let lastY: number | null = null;
  let isFirstLine = true;

  const flushLine = (newParagraph: boolean) => {
    if (currentRuns.length > 0 || !isFirstLine) {
      result.push({
        runs: [...currentRuns],
        isNewParagraph: newParagraph && !isFirstLine,
      });
      isFirstLine = false;
    }
    currentRuns = [];
  };

  for (const item of content.items) {
    if (!("str" in item)) continue;
    if (!item.str) continue; // skip empty strings

    const ty = item.transform[5];
    const fontSize = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12;
    const meta = fontMeta.get(item.fontName) ?? {
      fontFamily: "Arial",
      isBold: false,
      isItalic: false,
    };

    // ── Detect line break ──
    if (lastY !== null) {
      const yDelta = Math.abs(ty - lastY);
      if (yDelta > fontSize * 0.6) {
        const isParagraph = yDelta > fontSize * 1.8;
        flushLine(isParagraph);
        if (isParagraph) {
          // empty paragraph entry for spacing
          result.push({ runs: [], isNewParagraph: true });
        }
      }
    }

    // ── Merge into current run or start new run ──
    const lastRun = currentRuns[currentRuns.length - 1];
    const sameStyle =
      lastRun &&
      lastRun.isBold === meta.isBold &&
      lastRun.isItalic === meta.isItalic &&
      lastRun.fontFamily === meta.fontFamily &&
      Math.abs(lastRun.fontSize - fontSize) < 0.5;

    if (sameStyle && lastRun) {
      // Same formatting → append to the current run
      if (!lastRun.text.endsWith(" ") && !item.str.startsWith(" ")) {
        lastRun.text += " ";
      }
      lastRun.text += item.str;
    } else {
      // Different formatting → new run (add space if continuing a line)
      let text = item.str;
      if (currentRuns.length > 0 && text && !text.startsWith(" ")) {
        const prev = currentRuns[currentRuns.length - 1];
        if (prev && !prev.text.endsWith(" ")) {
          prev.text += " ";
        }
      }
      currentRuns.push({
        text,
        fontSize,
        fontFamily: meta.fontFamily,
        isBold: meta.isBold,
        isItalic: meta.isItalic,
      });
    }

    lastY = ty;

    if ((item as { hasEOL?: boolean }).hasEOL) {
      flushLine(false);
      lastY = null;
    }
  }
  if (currentRuns.length > 0) flushLine(false);

  return result;
}

/** Extract structured text from all pages. */
export async function extractAllTextStructured(
  file: File,
): Promise<ExtractedLine[][]> {
  const doc = await getDoc(file);
  const pages: ExtractedLine[][] = [];
  for (let i = 0; i < doc.numPages; i++) {
    pages.push(await extractPageTextStructured(file, i));
  }
  return pages;
}

export interface TextItemPosition {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  pageIndex: number;
}

/** Extract text items with exact positional data. */
export async function extractTextItems(
  file: File,
  pageIndex: number,
): Promise<{ items: TextItemPosition[]; viewport: pdfjsLib.PageViewport }> {
  const doc = await getDoc(file);
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();

  const items: TextItemPosition[] = [];

  for (const item of content.items) {
    if ("str" in item) {
      // The transform matrix is [scaleX, skewX, skewY, scaleY, tx, ty]
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      // fontHeight is usually scaleY
      const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
      // The font width
      const fontWidth = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);

      items.push({
        str: item.str,
        x: tx[4],
        // tx[5] is the baseline y coordinate. We adjust it for the bounding box.
        y: tx[5] - fontHeight,
        width: item.width * Math.abs(viewport.transform[0] ?? 1),
        height: fontHeight,
        fontSize: fontHeight,
        fontName: item.fontName,
        pageIndex,
      });
    }
  }

  return { items, viewport };
}
