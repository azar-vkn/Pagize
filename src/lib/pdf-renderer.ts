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

/** Extract text content from a PDF page. */
export async function extractPageText(file: File, pageIndex: number): Promise<string> {
  const doc = await getDoc(file);
  const page = await doc.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}

/** Extract text from all pages. */
export async function extractAllText(file: File): Promise<string[]> {
  const doc = await getDoc(file);
  const texts: string[] = [];
  for (let i = 0; i < doc.numPages; i++) {
    texts.push(await extractPageText(file, i));
  }
  return texts;
}

export interface TextItemPosition {
  str: string;
  x: number;
  y: number;
  pdfX: number;
  pdfY: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  color: string; // hex color
  pageIndex: number;
}

function rgbToHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Extract text items with exact positional data and smart grouping. */
export async function extractTextItems(
  file: File,
  pageIndex: number,
): Promise<{ items: TextItemPosition[]; viewport: pdfjsLib.PageViewport }> {
  const doc = await getDoc(file);
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();

  const rawItems: TextItemPosition[] = [];

  for (const item of content.items) {
    if ("str" in item && item.str.trim() !== "") {
      // Ignore purely whitespace items
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
      const pdfFontSize = Math.sqrt(
        item.transform[2] * item.transform[2] + item.transform[3] * item.transform[3],
      );

      // Attempt to extract color (pdf.js >v3 exposes color as RGB Uint8ClampedArray)
      let hexColor = "#000000";
      const colorArr = (item as Record<string, unknown>).color as Uint8ClampedArray | undefined;
      if (colorArr && colorArr.length >= 3) {
        hexColor = rgbToHex(colorArr[0], colorArr[1], colorArr[2]);
      } else if (content.styles && item.fontName) {
        // Sometimes color is attached to the style or we can infer it, but usually it's in item.color
        // We fallback to #000000 if not found
      }

      rawItems.push({
        str: item.str,
        x: tx[4],
        y: tx[5] - fontHeight,
        pdfX: item.transform[4],
        pdfY: item.transform[5],
        width: (item.width || 0) * Math.abs(viewport.transform[0]),
        height: fontHeight,
        fontSize: pdfFontSize, // store PDF font size for pdf-lib
        fontName: item.fontName,
        color: hexColor,
        pageIndex,
      });
    }
  }

  // Sort items top-to-bottom (canvas Y ascending) and then left-to-right (canvas X ascending)
  rawItems.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 5) return a.y - b.y;
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
    const sameLine = Math.abs(currentGroup.y - item.y) < 5;
    // Check if adjacent (X is close to the end of currentGroup)
    const gap = item.x - (currentGroup.x + currentGroup.width);
    const adjacent = gap >= -2 && gap < currentGroup.height * 2; // threshold based on font size (height)

    if (sameLine && adjacent) {
      // Merge
      // Calculate missing space to insert a space if necessary
      const needsSpace =
        gap > currentGroup.height * 0.2 &&
        !currentGroup.str.endsWith(" ") &&
        !item.str.startsWith(" ");
      currentGroup.str += (needsSpace ? " " : "") + item.str;
      // Expand width to encompass the new item
      currentGroup.width = item.x + item.width - currentGroup.x;
      // Do not change X or Y since it's the start of the group
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
