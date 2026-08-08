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
        width: item.width * Math.abs(viewport.transform[0]),
        height: fontHeight,
        fontSize: fontHeight,
        fontName: item.fontName,
        pageIndex,
      });
    }
  }

  return { items, viewport };
}
