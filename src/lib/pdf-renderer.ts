import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";

// Dynamically load pdfjs to prevent SSR crashes (it accesses DOMMatrix on load)
let pdfjsLib: typeof import("pdfjs-dist") | null = null;
async function getPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  if (typeof window === "undefined") return null;
  pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjsLib;
}

const docCache = new Map<string, PDFDocumentProxy>();

async function getDoc(file: File): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfJs();
  if (!pdfjs) throw new Error("pdf.js cannot be used on the server");

  const key = `${file.name}-${file.size}-${file.lastModified}`;
  const cached = docCache.get(key);
  if (cached) return cached;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  docCache.set(key, doc);
  return doc;
}
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
      isItalic = /italic|oblique/i.test(fontName) || /italic|oblique/i.test(rawFamily);
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
  name = name.replace(
    /[,-]?(Bold|Italic|BoldItalic|Regular|Light|Medium|Semibold|SemiBold|Heavy|Black|Thin|Condensed|Narrow|MT|PS|It)$/gi,
    "",
  );
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
      const text = item.str;
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
export async function extractAllTextStructured(file: File): Promise<ExtractedLine[][]> {
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
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  /** Generic family from pdf.js styles: "serif", "sans-serif", "monospace", etc. */
  fontFamily: string;
  /** Whether the font appears to be bold (detected from font name). */
  isBold: boolean;
  /** Whether the font appears to be italic/oblique (detected from font name). */
  isItalic: boolean;
  color: string; // hex color
  bgColor: string; // hex background color (e.g., #ffffff, #f3f4f6, #f7f7f7)
  pageIndex: number;
}

function rgbToHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Sample the exact text color AND background color from rendered canvas pixels
 * by inspecting the bounding box and outer margins.
 */
function sampleTextAndBgColor(
  imgData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
): { color: string; bgColor: string } {
  const data = imgData.data;
  const imgW = imgData.width;
  const imgH = imgData.height;

  const startX = Math.max(0, Math.floor(x));
  const endX = Math.min(imgW - 1, Math.ceil(x + width));
  const startY = Math.max(0, Math.floor(y));
  const endY = Math.min(imgH - 1, Math.ceil(y + height));

  if (endX <= startX || endY <= startY) {
    return { color: "#000000", bgColor: "#ffffff" };
  }

  // Sample points just outside and at corners of the text box to get the pure background color
  const bgSamplePoints: [number, number][] = [
    [startX, Math.max(0, startY - 2)],
    [endX, Math.max(0, startY - 2)],
    [Math.floor((startX + endX) / 2), Math.max(0, startY - 2)],
    [startX, Math.min(imgH - 1, endY + 2)],
    [endX, Math.min(imgH - 1, endY + 2)],
    [Math.floor((startX + endX) / 2), Math.min(imgH - 1, endY + 2)],
    [Math.max(0, startX - 2), Math.floor((startY + endY) / 2)],
    [Math.min(imgW - 1, endX + 2), Math.floor((startY + endY) / 2)],
    [startX, startY],
    [endX, startY],
    [startX, endY],
    [endX, endY],
  ];

  let bgRSum = 0;
  let bgGSum = 0;
  let bgBSum = 0;
  let validBgPoints = 0;

  for (const [px, py] of bgSamplePoints) {
    const idx = (py * imgW + px) * 4;
    if (data[idx + 3]! >= 128) {
      bgRSum += data[idx]!;
      bgGSum += data[idx + 1]!;
      bgBSum += data[idx + 2]!;
      validBgPoints++;
    }
  }

  const bgR = validBgPoints > 0 ? bgRSum / validBgPoints : 255;
  const bgG = validBgPoints > 0 ? bgGSum / validBgPoints : 255;
  const bgB = validBgPoints > 0 ? bgBSum / validBgPoints : 255;
  const hexBg = rgbToHex(Math.round(bgR), Math.round(bgG), Math.round(bgB));

  // Collect candidate glyph pixels (those with significant contrast from background)
  type PixelCandidate = { r: number; g: number; b: number; dist: number };
  const candidates: PixelCandidate[] = [];

  for (let py = startY; py <= endY; py++) {
    for (let px = startX; px <= endX; px++) {
      const idx = (py * imgW + px) * 4;
      if (data[idx + 3]! < 128) continue; // skip transparent

      const r = data[idx]!;
      const g = data[idx + 1]!;
      const b = data[idx + 2]!;
      const dist = Math.hypot(r - bgR, g - bgG, b - bgB);

      // Contrast threshold to ignore subtle antialiasing / background noise
      if (dist > 30) {
        candidates.push({ r, g, b, dist });
      }
    }
  }

  if (candidates.length === 0) {
    const isBgDark = (bgR + bgG + bgB) / 3 < 128;
    return { color: isBgDark ? "#ffffff" : "#000000", bgColor: hexBg };
  }

  // Sort by contrast distance descending (core text glyph pixels)
  candidates.sort((a, b) => b.dist - a.dist);

  // Average the top 20% most saturated / highest contrast pixels
  const topCount = Math.max(1, Math.floor(candidates.length * 0.2));
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let i = 0; i < topCount; i++) {
    sumR += candidates[i]!.r;
    sumG += candidates[i]!.g;
    sumB += candidates[i]!.b;
  }

  const hexColor = rgbToHex(
    Math.round(sumR / topCount),
    Math.round(sumG / topCount),
    Math.round(sumB / topCount),
  );

  return { color: hexColor, bgColor: hexBg };
}

/** Extract text items with exact positional data, color/bg detection, and smart grouping. */
export async function extractTextItems(
  file: File,
  pageIndex: number,
): Promise<{ items: TextItemPosition[]; viewport: PageViewport }> {
  const pdfjs = await getPdfJs();
  if (!pdfjs) throw new Error("pdf.js cannot be used on the server");
  const doc = await getDoc(file);
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();

  // Render page at scale 1 to sample real pixel colors
  let imgData: ImageData | null = null;
  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        await page.render({ canvasContext: ctx, canvas, viewport }).promise;
        imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    } catch (e) {
      console.warn("Could not sample canvas colors:", e);
    }
  }

  const rawItems: TextItemPosition[] = [];

  for (const item of content.items) {
    if ("str" in item && item.str.trim() !== "") {
      const tx = pdfjs.Util.transform(viewport.transform, item.transform);
      const pdfFontSize =
        Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) ||
        Math.hypot(item.transform[0] ?? 0, item.transform[1] ?? 0) ||
        12;
      const fontHeight =
        Math.hypot(tx[2] ?? 0, tx[3] ?? 0) || Math.hypot(tx[0] ?? 0, tx[1] ?? 0) || pdfFontSize;
      const pdfWidth = item.width || 0;
      const canvasWidth =
        pdfWidth * Math.hypot(viewport.transform[0] ?? 1, viewport.transform[1] ?? 0);

      // Extract accurate color & background color from rendered canvas pixels
      let hexColor = "#000000";
      let hexBg = "#ffffff";
      if (imgData) {
        const sampled = sampleTextAndBgColor(
          imgData,
          tx[4]!,
          tx[5]! - fontHeight,
          canvasWidth,
          fontHeight,
        );
        hexColor = sampled.color;
        hexBg = sampled.bgColor;
      }

      // Extract fontFamily from pdf.js styles map (serif / sans-serif / monospace)
      const styleEntry = (content.styles as Record<string, { fontFamily?: string }> | undefined)?.[
        item.fontName
      ];
      const fontFamily = styleEntry?.fontFamily || "sans-serif";

      // Detect bold/italic from font name (e.g., "ArialMT-Bold", "TimesNewRoman-BoldItalic")
      const fnLower = (item.fontName || "").toLowerCase();
      const isBold =
        fnLower.includes("bold") ||
        fnLower.includes("heavy") ||
        fnLower.includes("black") ||
        fnLower.includes("semibold") ||
        fnLower.includes("semi-bold") ||
        fnLower.includes("demi") ||
        fnLower.includes("medium") ||
        fnLower.includes("bld");
      const isItalic =
        fnLower.includes("italic") ||
        fnLower.includes("oblique") ||
        fnLower.includes("slant") ||
        fnLower.includes("ital") ||
        fnLower.includes("-it");

      rawItems.push({
        str: item.str,
        x: tx[4]!,
        y: tx[5]! - fontHeight,
        pdfX: item.transform[4]!,
        pdfY: item.transform[5]!,
        pdfWidth,
        width: canvasWidth,
        height: fontHeight,
        fontSize: pdfFontSize,
        fontName: item.fontName,
        fontFamily,
        isBold,
        isItalic,
        color: hexColor,
        bgColor: hexBg,
        pageIndex,
      });
    }
  }

  // Sort items top-to-bottom (canvas Y ascending) and then left-to-right (canvas X ascending)
  rawItems.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 4) return a.y - b.y;
    return a.x - b.x;
  });

  const groupedItems: TextItemPosition[] = [];
  let currentGroup: TextItemPosition | null = null;

  for (const item of rawItems) {
    if (!currentGroup) {
      currentGroup = { ...item };
      continue;
    }

    // Check if on same line (Y is very close)
    const sameLine = Math.abs(currentGroup.y - item.y) < Math.max(3, currentGroup.height * 0.35);
    // Check if adjacent horizontally
    const gap = item.x - (currentGroup.x + currentGroup.width);
    const adjacent = gap >= -2 && gap < currentGroup.height * 1.5;

    if (sameLine && adjacent) {
      // Merge
      const needsSpace =
        gap > currentGroup.height * 0.15 &&
        !currentGroup.str.endsWith(" ") &&
        !item.str.startsWith(" ");
      currentGroup.str += (needsSpace ? " " : "") + item.str;
      currentGroup.width = item.x + item.width - currentGroup.x;
      currentGroup.pdfWidth = item.pdfX + item.pdfWidth - currentGroup.pdfX;
      if (item.color !== "#000000" && currentGroup.color === "#000000") {
        currentGroup.color = item.color;
      }
      if (item.bgColor !== "#ffffff" && currentGroup.bgColor === "#ffffff") {
        currentGroup.bgColor = item.bgColor;
      }
      currentGroup.isBold = currentGroup.isBold || item.isBold;
      currentGroup.isItalic = currentGroup.isItalic || item.isItalic;
    } else {
      groupedItems.push(currentGroup);
      currentGroup = { ...item };
    }
  }

  if (currentGroup) {
    groupedItems.push(currentGroup);
  }

  return { items: groupedItems, viewport };
}
