/**
 * pdf-convert-ops.ts
 * Office format conversions (DOCX/PPTX/XLSX ↔ PDF), PDF→JPG, HTML→PDF.
 * All browser-only using pdf-lib, JSZip, and canvas APIs.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import type { OutputFile } from "./pdf-ops";
import { renderPageToBlob, getPageCount, getPageDimensions, extractAllText } from "./pdf-renderer";

const baseName = (file: File) => file.name.replace(/\.[^.]+$/, "");

// ────────────── CONVERT TO PDF ──────────────

/**
 * Convert a Word document to PDF. Preferred path: render the DOCX faithfully to
 * HTML (real fonts, colours, tables, images) and rasterize each page, so the
 * output matches what Word itself would produce — the only pure-browser way to
 * do that. Falls back to a text/table reconstruction if rendering isn't
 * available or fails (e.g. during SSR).
 */
export async function wordToPdf(file: File): Promise<OutputFile[]> {
  if (typeof document !== "undefined") {
    try {
      return await wordToPdfViaRender(file);
    } catch (err) {
      console.error("Faithful Word render failed; using reconstruction fallback:", err);
    }
  }
  return wordToPdfReconstruct(file);
}

/** Render the DOCX to HTML, rasterize it, and slice it into PDF pages. */
async function wordToPdfViaRender(file: File): Promise<OutputFile[]> {
  const docxPreview = await import("docx-preview");

  // Page size from the section properties (twips → CSS px at 96 dpi).
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const docXml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const pg = /<w:pgSz\b[^>]*?\bw:w="(\d+)"[^>]*?\bw:h="(\d+)"/.exec(docXml);
  const PX_PER_TWIP = 96 / 72 / 20;
  const pageWpx = pg ? Number(pg[1]) * PX_PER_TWIP : 816; // letter default
  const pageHpx = pg ? Number(pg[2]) * PX_PER_TWIP : 1056;

  // Render into an isolated iframe so the app's Tailwind theme can't leak into
  // the document's layout or measurements — the frame carries only a plain
  // white page plus docx-preview's own styles.
  const iframe = document.createElement("iframe");
  iframe.style.cssText = `position:fixed;left:-99999px;top:0;width:${Math.ceil(pageWpx) + 40}px;height:${Math.ceil(pageHpx)}px;border:0;background:#ffffff;`;
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument;
  if (!idoc) {
    iframe.remove();
    throw new Error("Could not create an isolated rendering frame.");
  }
  idoc.open();
  idoc.write(
    '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#ffffff;"></body></html>',
  );
  idoc.close();
  const holder = idoc.createElement("div");
  idoc.body.appendChild(holder);
  try {
    await docxPreview.renderAsync(buf, holder, undefined, {
      className: "docx",
      inWrapper: true,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      useBase64URL: true, // embed media inline so it survives serialization
    });
    // Strip docx-preview's on-screen chrome (gray gutter, page shadows and the
    // margin between pages) so the measured height is exactly the content — an
    // empty one-page doc then stays one page instead of spilling onto a second.
    const override = idoc.createElement("style");
    let overrideCss =
      ".docx-wrapper{padding:0 !important;background:#ffffff !important;}" +
      ".docx-wrapper>section.docx{box-shadow:none !important;margin:0 !important;}";
    if (!pg) {
      // The DOCX declares no page geometry, so docx-preview lays it out as one
      // compact block with no margins — which would collapse the whole document
      // onto a single cramped page. Apply a default Letter page box (1" margins,
      // page-height floor) so text wraps and the content flows across pages the
      // way Word would, letting the paginator split it correctly.
      overrideCss +=
        ".docx-wrapper>section.docx{width:816px !important;min-height:1056px !important;" +
        "padding:96px !important;box-sizing:border-box !important;}";
    }
    override.textContent = overrideCss;
    idoc.head.appendChild(override);
    const wrapper = holder.querySelector<HTMLElement>(".docx-wrapper") ?? holder;

    // Wait for embedded images to finish decoding so the measured height and
    // the rasterized height agree (otherwise pages get miscounted).
    await Promise.all(
      Array.from(idoc.querySelectorAll("img")).map((im) =>
        im.complete
          ? Promise.resolve()
          : new Promise<void>((r) => {
              im.onload = im.onerror = () => r();
            }),
      ),
    );

    // docx-preview breaks only at explicit page breaks, so the body is usually
    // one tall block. Rasterize it once with the browser's own engine (via an
    // SVG <foreignObject>, which reproduces collapsed table borders and text
    // metrics exactly) and slice it into pages. Cap the
    // scale so long documents stay under the browser's max canvas dimension.
    const contentHpx = Math.max(wrapper.scrollHeight, pageHpx);
    // Cap the raster so its height never exceeds the browser's max canvas
    // dimension (~16384px). A long document gets a smaller scale (softer, but
    // still a full visual copy) instead of blank/truncated trailing pages.
    const scale = Math.min(2, 16000 / contentHpx);
    const full = await rasterizeViaForeignObject(wrapper, idoc, scale);

    // Choose page breaks that don't cut through a table row or an image: for
    // each page take up to one page-height of content, but if that boundary
    // would land inside a row/figure, snap it up to the top of that block so
    // the whole block moves to the next page (CSS px, later scaled to device).
    const cuts = computePageCuts(wrapper, pageHpx, contentHpx);

    const doc = await PDFDocument.create();
    const pageWpt = pageWpx * 0.75; // px (96 dpi) → pt (72 dpi)
    const pageHpt = pageHpx * 0.75;
    for (let i = 0; i < cuts.length - 1; i++) {
      const topPx = Math.round(cuts[i]! * scale);
      const sliceH = Math.round(cuts[i + 1]! * scale) - topPx;
      if (sliceH <= 2) continue; // skip an empty sliver
      const tmp = document.createElement("canvas");
      tmp.width = full.width;
      tmp.height = sliceH;
      const ctx = tmp.getContext("2d");
      if (!ctx) continue;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, tmp.width, tmp.height);
      ctx.drawImage(full, 0, topPx, full.width, sliceH, 0, 0, full.width, sliceH);
      const dataUrl = tmp.toDataURL("image/jpeg", 0.92);
      const jpgBytes = Uint8Array.from(atob(dataUrl.split(",")[1] ?? ""), (c) => c.charCodeAt(0));
      const img = await doc.embedJpg(jpgBytes);
      const page = doc.addPage([pageWpt, pageHpt]);
      const drawH = (sliceH / scale) * 0.75; // content sits at the top of the page
      page.drawImage(img, { x: 0, y: pageHpt - drawH, width: pageWpt, height: drawH });
    }
    const bytes = await doc.save();
    return [
      {
        name: `${baseName(file)}.pdf`,
        blob: new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
      },
    ];
  } finally {
    iframe.remove();
  }
}

/**
 * Work out where to break a continuously-rendered document into pages so a cut
 * never lands inside an image, a table row, or a line of text. Each page takes
 * as much content as fits in a page height, then snaps the break up to the
 * nearest safe boundary (a gap between blocks). Returns cut offsets in CSS px,
 * from 0 to totalPx.
 */
function computePageCuts(
  wrapper: HTMLElement,
  pageHpx: number,
  totalPx: number,
): number[] {
  const wrapTop = wrapper.getBoundingClientRect().top;
  const edges = (el: Element): [number, number] => {
    const r = el.getBoundingClientRect();
    return [r.top - wrapTop, r.bottom - wrapTop];
  };

  // Images must never be split; record their spans so a cut is never placed
  // inside one even if a block boundary happens to fall there.
  const images = [...wrapper.querySelectorAll("img")].map(edges);
  const insideImage = (y: number) => images.some(([t, b]) => y > t + 0.5 && y < b - 0.5);

  const collect = (selector: string): number[] => {
    const set = new Set<number>();
    wrapper.querySelectorAll(selector).forEach((el) => {
      const [t, b] = edges(el);
      set.add(Math.round(t));
      set.add(Math.round(b));
    });
    return [...set].filter((y) => y >= 0 && y <= totalPx).sort((a, b) => a - b);
  };
  // Prefer breaks at an explicit page boundary (docx-preview renders one
  // <section> per page break), then whole table-row boundaries, and only fall
  // back to paragraph/line boundaries when a single row is taller than a page.
  const sectionEdges = collect("section.docx");
  const rowEdges = collect("section.docx, tr");
  const fineEdges = new Set<number>([0, totalPx]);
  collect("section.docx, tr, p, li, img, h1, h2, h3, h4, h5, h6").forEach((y) => fineEdges.add(y));
  const fine = [...fineEdges].sort((a, b) => a - b);

  // Largest boundary in (start, limit] that is not inside an image.
  const bestFit = (arr: number[], start: number, limit: number): number => {
    let best = -1;
    for (const y of arr) {
      if (y <= start) continue;
      if (y > limit) break;
      if (!insideImage(y)) best = y;
    }
    return best;
  };

  const cuts = [0];
  let start = 0;
  let guard = 0;
  while (start < totalPx - 1 && guard++ < 20000) {
    const limit = start + pageHpx;
    if (limit >= totalPx) {
      cuts.push(totalPx);
      break;
    }
    let cut = bestFit(sectionEdges, start, limit);
    if (cut <= start) cut = bestFit(rowEdges, start, limit);
    if (cut <= start) cut = bestFit(fine, start, limit);
    // A single block taller than a page: hard-cut at the page height, nudging
    // off an image edge if we somehow landed inside one.
    if (cut <= start) {
      cut = limit;
      while (cut > start + 1 && insideImage(cut)) cut -= 1;
      if (cut <= start) cut = limit;
    }
    cuts.push(cut);
    start = cut;
  }
  if (cuts[cuts.length - 1]! < totalPx) cuts.push(totalPx);
  return cuts;
}

/**
 * Rasterize a DOM element to a canvas using the browser's own rendering engine
 * via an SVG <foreignObject>. This reproduces table borders, collapsed borders
 * and text metrics exactly. All resources must be inlined (docx-preview's
 * useBase64URL) so the canvas is not tainted.
 */
async function rasterizeViaForeignObject(
  el: HTMLElement,
  idoc: Document,
  scale: number,
): Promise<HTMLCanvasElement> {
  const w = Math.ceil(el.scrollWidth);
  const h = Math.ceil(el.scrollHeight);
  const styleText = Array.from(idoc.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
  // The SVG is parsed as XML, so raw CSS containing '&' or '<' would make it
  // malformed and the whole render would fail (and silently fall back to the
  // low-fidelity path). Wrap the CSS in CDATA, escaping any literal "]]>".
  const styleSafe = styleText.replace(/]]>/g, "]]]]><![CDATA[>");
  const clone = el.cloneNode(true) as HTMLElement;
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clone.style.margin = "0";
  const serialized = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;background:#ffffff;">` +
    `<style><![CDATA[${styleSafe}]]></style>${serialized}</div>` +
    `</foreignObject></svg>`;
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const img = new Image();
  img.width = w;
  img.height = h;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("foreignObject SVG failed to load"));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Parse DOCX (a ZIP of XML) and render its text and images into a PDF. */
async function wordToPdfReconstruct(file: File): Promise<OutputFile[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) throw new Error("Could not read DOCX content. Make sure it's a valid .docx file.");

  // Map relationship ids (rId…) to their media targets so <a:blip r:embed> and
  // VML <v:imagedata r:id> references can be resolved to files in word/media.
  const relsXml = (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
  const relTargets = new Map<string, string>();
  // Attribute order inside <Relationship> is not fixed, so pull Id and Target
  // out of each tag independently rather than assuming Id comes first.
  for (const tag of relsXml.matchAll(/<Relationship\b[^>]*?\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(tag[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag[0])?.[1];
    if (id && target) relTargets.set(id, target);
  }

  const imageCache = new Map<string, PdfBlock["image"] | null>();
  const loadImage = async (rId: string): Promise<PdfBlock["image"] | null> => {
    if (imageCache.has(rId)) return imageCache.get(rId)!;
    let result: PdfBlock["image"] | null = null;
    const target = relTargets.get(rId);
    if (target && !/^https?:/i.test(target)) {
      // Targets are relative to the word/ folder (e.g. "media/image1.png").
      const rel = target.replace(/^\/+/, "").replace(/^\.\.\//, "");
      const entry = zip.file(`word/${rel}`) ?? zip.file(rel);
      if (entry) {
        const bytes = await entry.async("uint8array");
        const ext = (target.split(".").pop() ?? "").toLowerCase();
        result = await normalizeImageForPdf(bytes, ext);
      }
    }
    imageCache.set(rId, result);
    return result;
  };

  const blocks: PdfBlock[] = [];
  // Walk the body in order. A <w:tbl> is consumed as a whole unit (its inner
  // <w:p> are cell content, not loose paragraphs); any other <w:p> is a normal
  // paragraph, which may also carry images. Only the top-level <a:blip> is
  // matched: an SVG picture also carries an <asvg:svgBlip>, but its <a:blip> is
  // the raster fallback we embed, so matching both would emit the image twice.
  for (const m of docXml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g)) {
    const chunk = m[0];
    if (chunk.startsWith("<w:tbl")) {
      const table = parseDocxTable(chunk);
      if (table.rows.length) blocks.push({ text: "", table });
      continue;
    }
    const text = extractParagraphText(chunk);
    if (text.trim()) blocks.push({ text });
    for (const bm of chunk.matchAll(/<a:blip\b[^>]*?r:embed="([^"]+)"/g)) {
      const img = await loadImage(bm[1]!);
      if (img) blocks.push({ text: "", image: img });
    }
    for (const vm of chunk.matchAll(/<v:imagedata\b[^>]*?r:id="([^"]+)"/g)) {
      const img = await loadImage(vm[1]!);
      if (img) blocks.push({ text: "", image: img });
    }
  }

  return renderBlocksToPdf(blocks, `${baseName(file)}.pdf`);
}

/** Parse a <w:tbl> into rows of cell text, with column widths (twips) if present. */
function parseDocxTable(tblXml: string): { rows: string[][]; colWidths?: number[] } {
  const rows: string[][] = [];
  for (const tr of tblXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
    const cells: string[] = [];
    for (const tc of tr[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)) {
      const paras: string[] = [];
      for (const p of tc[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
        paras.push(extractParagraphText(p[0]));
      }
      cells.push(
        paras
          .join("\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim(),
      );
    }
    if (cells.length) rows.push(cells);
  }
  const colWidths = [...tblXml.matchAll(/<w:gridCol\b[^>]*\bw:w="(\d+)"/g)].map((c) =>
    Number(c[1]),
  );
  return colWidths.length ? { rows, colWidths } : { rows };
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/**
 * pdf-lib can only embed PNG and JPEG. PNG/JPEG pass through untouched; any
 * other format the browser can decode (GIF, BMP, WEBP, ICO, and TIFF where the
 * browser supports it) is rasterized to PNG via a canvas. Vector metafiles that
 * no browser can decode (EMF/WMF) resolve to null and are skipped.
 */
async function normalizeImageForPdf(
  bytes: Uint8Array,
  ext: string,
): Promise<PdfBlock["image"] | null> {
  if (ext === "png") return { bytes, kind: "png" };
  if (ext === "jpg" || ext === "jpeg") return { bytes, kind: "jpg" };
  const png = await rasterizeToPng(bytes, IMAGE_MIME[ext] ?? "application/octet-stream");
  return png ? { bytes: png, kind: "png" } : null;
}

/** Decode an image with the browser and re-encode it as PNG, or null if it can't. */
async function rasterizeToPng(bytes: Uint8Array, mime: string): Promise<Uint8Array | null> {
  if (typeof createImageBitmap === "undefined") return null;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    const { width, height } = bitmap;
    let pngBlob: Blob | null = null;
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      pngBlob = await canvas.convertToBlob({ type: "image/png" });
    } else if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      pngBlob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    }
    bitmap.close?.();
    return pngBlob ? new Uint8Array(await pngBlob.arrayBuffer()) : null;
  } catch {
    return null; // format the browser can't decode (EMF/WMF, TIFF outside Safari)
  }
}

/**
 * Text of one <w:p>, joined in document order and decoded. <w:tab/> becomes a
 * tab and <w:br/>/<w:cr/> a newline so runs don't collapse into each other.
 */
function extractParagraphText(pXml: string): string {
  let out = "";
  const tokens = pXml.matchAll(
    /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:cr\b[^>]*\/?>/g,
  );
  for (const t of tokens) {
    if (t[1] !== undefined) out += decodeXmlEntities(t[1]);
    else if (t[0].startsWith("<w:tab")) out += "\t";
    else out += "\n";
  }
  return out;
}

/** Parse PPTX and render slide text into a PDF (one page per slide). */
export async function powerpointToPdf(file: File): Promise<OutputFile[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slides: string[][] = [];

  let i = 1;
  while (true) {
    const slideFile = zip.file(`ppt/slides/slide${i}.xml`);
    if (!slideFile) break;
    const xml = await slideFile.async("string");
    const texts: string[] = [];
    const matches = xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g);
    for (const m of matches) {
      texts.push(m[1] ?? "");
    }
    slides.push(texts);
    i++;
  }

  if (slides.length === 0)
    throw new Error("Could not read PPTX slides. Make sure it's a valid .pptx file.");

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const [idx, slideTexts] of slides.entries()) {
    const page = doc.addPage([720, 540]); // landscape slide proportions
    // Slide number header
    page.drawText(`Slide ${idx + 1}`, {
      x: 40,
      y: 500,
      size: 20,
      font: boldFont,
      color: rgb(0.2, 0.2, 0.2),
    });
    // Content
    let yPos = 460;
    for (const text of slideTexts) {
      if (!text.trim()) continue;
      const lines = wrapText(text, font, 14, 640);
      for (const line of lines) {
        if (yPos < 40) break;
        page.drawText(line, { x: 40, y: yPos, size: 14, font, color: rgb(0.1, 0.1, 0.1) });
        yPos -= 20;
      }
      yPos -= 6;
    }
  }

  const bytes = await doc.save();
  return [{ name: `${baseName(file)}.pdf`, blob: new Blob([bytes], { type: "application/pdf" }) }];
}

/** Parse XLSX and render cell data as a table in a PDF. */
/** Reverses the XML escaping used throughout the XLSX parts. */
function decodeXmlEntities(text: string): string {
  return (
    text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
      // Last, so an escaped entity like &amp;lt; does not decode twice.
      .replace(/&amp;/g, "&")
  );
}

/**
 * One entry per <si>. A rich-text <si> holds several <t> runs that together
 * form a single string — treating each run as its own entry would shift every
 * subsequent index and mis-label the rest of the sheet.
 */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const runs = Array.from((si[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g));
    out.push(decodeXmlEntities(runs.map((r) => r[1] ?? "").join("")));
  }
  return out;
}

/** Cell reference to zero-based column index: A -> 0, B -> 1, AA -> 26. */
function columnIndexFromRef(ref: string): number {
  const letters = /^[A-Za-z]+/.exec(ref)?.[0] ?? "";
  let index = 0;
  for (const ch of letters.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

/** Truncates to what actually fits the column, with an ellipsis when clipped. */
function fitText(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && font.widthOfTextAtSize(clipped + "...", size) > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return clipped + "...";
}

export async function excelToPdf(file: File): Promise<OutputFile[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const sharedStringsXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const sharedStrings = parseSharedStrings(sharedStringsXml);

  // The first sheet is not always literally sheet1.xml.
  const sheetPath = zip.file("xl/worksheets/sheet1.xml")
    ? "xl/worksheets/sheet1.xml"
    : Object.keys(zip.files)
        .filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n))
        .sort()[0];
  const sheetXml = sheetPath ? await zip.file(sheetPath)?.async("string") : undefined;
  if (!sheetXml) throw new Error("Could not read XLSX data. Make sure it's a valid .xlsx file.");

  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row[\s>][\s\S]*?<\/row>/g)) {
    const cells: string[] = [];

    // Matches both self-closing empty cells and cells with a body.
    for (const cell of rowMatch[0].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? "";
      const body = cell[2] ?? "";
      // Type is per cell, not per row: a row can mix text, numbers and formulas.
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";

      let value: string;
      if (type === "inlineStr") {
        // Text lives in <is><t>, never in <v>.
        const runs = Array.from(body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g));
        value = decodeXmlEntities(runs.map((r) => r[1] ?? "").join(""));
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        if (type === "s") {
          value = sharedStrings[Number(raw)] ?? "";
        } else if (type === "b") {
          value = raw === "1" ? "TRUE" : "FALSE";
        } else {
          value = decodeXmlEntities(raw);
        }
      }

      // Place by the cell's own reference so gaps keep their column.
      const ref = /\br="([A-Za-z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? columnIndexFromRef(ref) : cells.length;
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }

    if (cells.some((c) => c.trim() !== "")) rows.push(cells);
  }

  if (rows.length === 0) throw new Error("That sheet appears to be empty.");

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 10;
  const cellPadding = 6;
  const rowHeight = fontSize + cellPadding * 2;
  const maxCols = Math.max(...rows.map((r) => r.length), 1);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 40;
  const colWidth = (pageWidth - margin * 2) / maxCols;

  let page = doc.addPage([pageWidth, pageHeight]);
  let yPos = pageHeight - margin;

  for (const [rowIdx, row] of rows.entries()) {
    if (yPos < margin + rowHeight) {
      page = doc.addPage([pageWidth, pageHeight]);
      yPos = pageHeight - margin;
    }
    for (let col = 0; col < maxCols; col++) {
      const x = margin + col * colWidth;
      const cellFont = rowIdx === 0 ? boldFont : font;

      // The fill is opaque, so it has to be laid down before the text.
      // Drawing it afterwards paints over every value and empties the table.
      page.drawRectangle({
        x,
        y: yPos - rowHeight,
        width: colWidth,
        height: rowHeight,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 0.5,
        color: rowIdx === 0 ? rgb(0.95, 0.95, 0.95) : rgb(1, 1, 1),
      });

      const cellText = sanitizeForStandardFont(row[col] ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (!cellText) continue;
      page.drawText(fitText(cellText, cellFont, fontSize, colWidth - cellPadding * 2), {
        x: x + cellPadding,
        y: yPos - fontSize - cellPadding,
        size: fontSize,
        font: cellFont,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
    yPos -= rowHeight;
  }

  const bytes = await doc.save();
  return [{ name: `${baseName(file)}.pdf`, blob: new Blob([bytes], { type: "application/pdf" }) }];
}

/** Parse an HTML file and render its text content to PDF. */
/** Elements whose text is markup or machinery, never page content. */
const NON_CONTENT_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "SVG",
  "IFRAME",
  "OBJECT",
  "CANVAS",
  "HEAD",
]);

/** Elements that start a new paragraph in the output. */
const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "TD",
  "TH",
  "DT",
  "DD",
  "FIGCAPTION",
  "ADDRESS",
  "SECTION",
  "ARTICLE",
  "HEADER",
  "FOOTER",
  "MAIN",
  "ASIDE",
  "NAV",
  "SUMMARY",
]);

const HEADING_SIZES: Record<string, number> = {
  H1: 22,
  H2: 18,
  H3: 15,
  H4: 13,
  H5: 12,
  H6: 12,
};

function hasBlockDescendant(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (NON_CONTENT_TAGS.has(child.tagName)) continue;
    if (BLOCK_TAGS.has(child.tagName) || hasBlockDescendant(child)) return true;
  }
  return false;
}

/**
 * Collect one block per innermost block-level element.
 *
 * Taking `textContent` of a leaf block keeps a sentence together across its
 * inline markup — walking raw text nodes instead would split
 * `<p>Hello <b>world</b>!</p>` into three separate paragraphs.
 */
function collectHtmlBlocks(el: Element, out: PdfBlock[]): void {
  if (NON_CONTENT_TAGS.has(el.tagName)) return;

  if (BLOCK_TAGS.has(el.tagName) && !hasBlockDescendant(el)) {
    const text = normalizeWhitespace(el.textContent ?? "");
    if (!text) return;
    const headingSize = HEADING_SIZES[el.tagName];
    out.push({
      text,
      ...(headingSize ? { size: headingSize, bold: true, spaceBefore: 0.6 } : {}),
      ...(el.tagName === "LI" ? { bullet: true } : {}),
    });
    return;
  }

  for (const child of Array.from(el.children)) collectHtmlBlocks(child, out);
}

/** Parse an HTML file and render its readable content to PDF. */
export async function htmlToPdf(file: File): Promise<OutputFile[]> {
  const html = await file.text();
  const htmlDoc = new DOMParser().parseFromString(html, "text/html");

  const title = normalizeWhitespace(htmlDoc.title) || baseName(file);
  const blocks: PdfBlock[] = [];

  if (htmlDoc.body) {
    collectHtmlBlocks(htmlDoc.body, blocks);

    // A body with no block elements at all (bare text, or a wrapper we do not
    // treat as a block) still has readable content worth rendering.
    if (blocks.length === 0) {
      for (const el of Array.from(
        htmlDoc.body.querySelectorAll("script, style, noscript, template"),
      )) {
        el.remove();
      }
      const text = normalizeWhitespace(htmlDoc.body.textContent ?? "");
      if (text) blocks.push({ text });
    }
  }

  if (blocks.length === 0) blocks.push({ text: "(Empty document)" });

  // Lead with the document title, unless the page already opens with it as a
  // heading — <title> matching <h1> is the common case, not a special one.
  if (blocks[0]?.text.trim().toLowerCase() !== title.trim().toLowerCase()) {
    blocks.unshift({ text: title, size: 22, bold: true });
  }

  return renderBlocksToPdf(blocks, `${title}.pdf`);
}

// ────────────── CONVERT FROM PDF ──────────────

/** Render every PDF page as a JPG image. */
export async function pdfToJpg(file: File, quality = 0.92): Promise<OutputFile[]> {
  const numPages = await getPageCount(file);
  const results: OutputFile[] = [];
  for (let i = 0; i < numPages; i++) {
    const blob = await renderPageToBlob(file, i, 2, quality);
    results.push({ name: `${baseName(file)}-page-${i + 1}.jpg`, blob });
  }
  return results;
}

/** Extract text from PDF and create a properly formatted DOCX file. */
export async function pdfToWord(file: File): Promise<OutputFile[]> {
  const numPages = await getPageCount(file);

  const media: { relId: string; name: string; bytes: Uint8Array }[] = [];
  const allParagraphs: string[] = [];

  // Make the Word page the same size as the source page, with no margins, so
  // each rendered page fills the sheet edge-to-edge instead of floating as a
  // small image inside wide default margins. Use the first page for the section
  // size (PDFs are almost always uniform); other sizes still fit, preserving
  // aspect. Dimensions from getPageDimensions are PDF points (= Word points).
  let sectionWpt = 612; // letter fallback
  let sectionHpt = 792;
  try {
    const d0 = await getPageDimensions(file, 0);
    if (d0.width > 0 && d0.height > 0) {
      sectionWpt = d0.width;
      sectionHpt = d0.height;
    }
  } catch {
    /* keep the letter fallback */
  }

  // Render every page to a high-resolution image and embed it one-per-page, so
  // the Word document is a faithful visual copy of the original. In a pure
  // browser tool this is the only way to preserve arbitrary layout, fonts,
  // tables and graphics exactly — the trade-off is that the result is a visual
  // copy, not editable text.
  for (let pageIdx = 0; pageIdx < numPages; pageIdx++) {
    const breakBefore = pageIdx > 0;
    try {
      const dims = await getPageDimensions(file, pageIdx);
      const blob = await renderPageToBlob(file, pageIdx, 2.5, 0.9);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const relId = `rId${media.length + 1}`;
      const name = `image${media.length + 1}.jpeg`;
      media.push({ relId, name, bytes });
      // Fill the page (a same-size page maps 1:1; a different size scales to
      // fit). 0.997 keeps it a hair under the edge so it can't spill over.
      const fit = Math.min(sectionWpt / dims.width, sectionHpt / dims.height) * 0.997;
      const cx = Math.round(dims.width * fit * EMU_PER_PT);
      const cy = Math.round(dims.height * fit * EMU_PER_PT);
      allParagraphs.push(docxImageParagraph(relId, cx, cy, `Page ${pageIdx + 1}`, breakBefore));
    } catch {
      allParagraphs.push(breakBefore ? `<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>` : `<w:p/>`);
    }
  }

  const pgW = Math.round(sectionWpt * 20); // points → twips
  const pgH = Math.round(sectionHpt * 20);
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${allParagraphs.join("")}
<w:sectPr>
  <w:pgSz w:w="${pgW}" w:h="${pgH}"/>
  <w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`;

  // One jpeg default + one image relationship per embedded page.
  const jpegDefault = media.length ? `<Default Extension="jpeg" ContentType="image/jpeg"/>\n` : "";
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${jpegDefault}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const imageRels = media
    .map(
      (m) =>
        `<Relationship Id="${m.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`,
    )
    .join("");
  const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${imageRels}</Relationships>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", relsDocx);
  zip.file("word/_rels/document.xml.rels", wordRels);
  zip.file("word/document.xml", docXml);
  for (const m of media) zip.file(`word/media/${m.name}`, m.bytes);

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  return [{ name: `${baseName(file)}.docx`, blob }];
}

// EMUs per point (914400 EMU per inch / 72 points per inch).
const EMU_PER_PT = 12700;

/** An inline-image paragraph (DrawingML) for an embedded page raster. */
function docxImageParagraph(
  relId: string,
  cxEmu: number,
  cyEmu: number,
  name: string,
  breakBefore = false,
): string {
  const safe = escapeXml(name);
  // Centre the image and zero paragraph spacing so a full-page image is balanced
  // between the margins and can't spill onto a blank page; page separation is
  // done with pageBreakBefore, not a standalone break run.
  const pPr = `<w:pPr>${breakBefore ? "<w:pageBreakBefore/>" : ""}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>`;
  return (
    `<w:p>${pPr}<w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cxEmu}" cy="${cyEmu}"/>` +
    `<wp:docPr id="1" name="${safe}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${safe}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cxEmu}" cy="${cyEmu}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic>` +
    `</wp:inline></w:drawing></w:r></w:p>`
  );
}

/** Extract text from PDF and create a simple PPTX file. */
export async function pdfToPowerpoint(file: File): Promise<OutputFile[]> {
  const texts = await extractAllText(file);
  // Always emit at least one slide so the deck is valid even for an empty PDF.
  const slideCount = Math.max(texts.length, 1);
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesPptx(slideCount));
  zip.file("_rels/.rels", relsPptx);
  zip.file("ppt/_rels/presentation.xml.rels", pptPresentationRels(slideCount));
  zip.file("ppt/presentation.xml", pptPresentation(slideCount));
  zip.file("ppt/theme/theme1.xml", themeXml);
  zip.file("ppt/slideMasters/slideMaster1.xml", slideMasterXml);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", slideMasterRels);
  // One shared layout for every slide (the previous per-slide layouts left the
  // master and content types out of sync, which is what corrupted the file).
  zip.file("ppt/slideLayouts/slideLayout1.xml", slideLayoutXml);
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", slideLayoutRels);

  for (let i = 0; i < slideCount; i++) {
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, slideRels);
    zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml(texts[i] ?? "", i + 1));
  }

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  return [{ name: `${baseName(file)}.pptx`, blob }];
}

/** Extract text from PDF and create a simple XLSX file. */
export async function pdfToExcel(file: File): Promise<OutputFile[]> {
  const texts = await extractAllText(file);
  const rows: string[] = [];
  rows.push(
    `<row r="1"><c r="A1" t="inlineStr"><is><t>Page</t></is></c><c r="B1" t="inlineStr"><is><t>Content</t></is></c></row>`,
  );
  for (let i = 0; i < texts.length; i++) {
    const text = escapeXml((texts[i] ?? "").substring(0, 32000));
    rows.push(
      `<row r="${i + 2}"><c r="A${i + 2}" t="inlineStr"><is><t>${i + 1}</t></is></c><c r="B${i + 2}" t="inlineStr"><is><t>${text}</t></is></c></row>`,
    );
  }

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${rows.join("")}</sheetData>
</worksheet>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXlsx);
  zip.file("_rels/.rels", relsXlsx);
  zip.file("xl/_rels/workbook.xml.rels", xlWorkbookRels);
  zip.file("xl/workbook.xml", xlWorkbook);
  zip.file("xl/worksheets/sheet1.xml", sheetXml);

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  return [{ name: `${baseName(file)}.xlsx`, blob }];
}

// ────────────── HELPERS ──────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The standard PDF fonts are WinAnsi-encoded and pdf-lib throws on any glyph
 * the encoding lacks. WinAnsi covers Latin-1 plus the common typographic marks
 * (em dash, smart quotes, ellipsis, bullet), but not CJK, Cyrillic, Arabic or
 * emoji — all of which appear in real documents. Fold what maps cleanly and
 * drop the rest rather than failing the whole conversion.
 */
function sanitizeForStandardFont(input: string): string {
  return (
    (input ?? "")
      .replace(/\r\n?/g, "\n")
      // WinAnsi does have en and em dash, so keep those; fold only the ones it lacks.
      .replace(/[‐‑‒―]/g, "-")
      .replace(/ /g, " ")
      .replace(/\t/g, "    ")
      .replace(/[^\n\x20-\x7E\xA0-\xFF‘’“”–—…•™]/g, "")
  );
}

/** Collapses HTML's insignificant whitespace into single spaces. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function wrapText(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/** One rendered paragraph, optionally styled as a heading or list item. */
type PdfBlock = {
  text: string;
  size?: number;
  bold?: boolean;
  bullet?: boolean;
  /** Extra space above, as a multiple of the line height. */
  spaceBefore?: number;
  /** When set, the block renders an embedded image instead of text. */
  image?: { bytes: Uint8Array; kind: "png" | "jpg" };
  /** When set, the block renders a bordered table. colWidths are relative (twips). */
  table?: { rows: string[][]; colWidths?: number[] };
};

async function renderBlocksToPdf(blocks: PdfBlock[], filename: string): Promise<OutputFile[]> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  const pageWidth = 612;
  const pageHeight = 792;
  const bodySize = 12;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  for (const block of blocks) {
    const size = block.size ?? bodySize;
    const lineHeight = size * 1.4;
    const activeFont = block.bold ? boldFont : font;
    const indent = block.bullet ? 16 : 0;
    const maxWidth = pageWidth - margin * 2 - indent;

    // Image block: embed and draw scaled to fit the text column / page.
    if (block.image) {
      let embedded;
      try {
        embedded =
          block.image.kind === "png"
            ? await doc.embedPng(block.image.bytes)
            : await doc.embedJpg(block.image.bytes);
      } catch {
        continue; // skip images pdf-lib can't decode (e.g. EMF/WMF/GIF)
      }
      const availWidth = pageWidth - margin * 2;
      const availHeight = pageHeight - margin * 2;
      let scale = Math.min(1, availWidth / embedded.width);
      if (embedded.height * scale > availHeight) scale = availHeight / embedded.height;
      const drawW = embedded.width * scale;
      const drawH = embedded.height * scale;
      if (y - drawH < margin) {
        page = doc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      y -= drawH;
      page.drawImage(embedded, { x: margin, y, width: drawW, height: drawH });
      y -= lineHeight * 0.5; // spacing after image
      continue;
    }

    // Table block: draw a bordered grid with wrapped, multi-line cells.
    if (block.table) {
      const tableWidth = pageWidth - margin * 2;
      const nCols = Math.max(1, ...block.table.rows.map((r) => r.length));
      const cw = block.table.colWidths;
      let widths: number[];
      if (cw && cw.length === nCols && cw.some((w) => w > 0)) {
        const total = cw.reduce((a, b) => a + b, 0) || 1;
        widths = cw.map((w) => (w / total) * tableWidth);
      } else {
        widths = Array(nCols).fill(tableWidth / nCols);
      }
      const tSize = 9;
      const tLine = tSize * 1.3;
      const pad = 4;
      for (const [rowIdx, row] of block.table.rows.entries()) {
        const isHeader = rowIdx === 0;
        const cellFont = isHeader ? boldFont : font;
        // Wrap every cell first so the row can be sized to its tallest cell.
        const wrapped = Array.from({ length: nCols }, (_, c) => {
          const inner = widths[c]! - pad * 2;
          return sanitizeForStandardFont(row[c] ?? "")
            .split("\n")
            .flatMap((seg) => (seg.trim() ? wrapText(seg, cellFont, tSize, inner) : [""]));
        });
        const rowH = Math.max(tLine, ...wrapped.map((l) => l.length * tLine)) + pad * 2;
        if (y - rowH < margin) {
          page = doc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
        let x = margin;
        for (let c = 0; c < nCols; c++) {
          const w = widths[c]!;
          page.drawRectangle({
            x,
            y: y - rowH,
            width: w,
            height: rowH,
            borderColor: rgb(0.7, 0.7, 0.7),
            borderWidth: 0.75,
            color: isHeader ? rgb(0.95, 0.95, 0.95) : rgb(1, 1, 1),
          });
          let ty = y - pad - tSize;
          for (const ln of wrapped[c]!) {
            if (ln) {
              page.drawText(ln, {
                x: x + pad,
                y: ty,
                size: tSize,
                font: cellFont,
                color: rgb(0.1, 0.1, 0.1),
              });
            }
            ty -= tLine;
          }
          x += w;
        }
        y -= rowH;
      }
      y -= tLine * 0.5; // spacing after table
      continue;
    }

    const text = sanitizeForStandardFont(block.text);
    if (!text.trim()) {
      y -= lineHeight;
      continue;
    }

    y -= lineHeight * (block.spaceBefore ?? 0);

    const lines = wrapText(text, activeFont, size, maxWidth);
    for (const [i, line] of lines.entries()) {
      if (y < margin) {
        page = doc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      if (block.bullet && i === 0) {
        page.drawText("-", { x: margin, y, size, font: activeFont, color: rgb(0.4, 0.4, 0.4) });
      }
      page.drawText(line, {
        x: margin + indent,
        y,
        size,
        font: activeFont,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= lineHeight;
    }
    y -= lineHeight * 0.3; // paragraph spacing
  }

  const bytes = await doc.save();
  return [{ name: filename, blob: new Blob([bytes], { type: "application/pdf" }) }];
}

// ────────────── OFFICE XML TEMPLATES ──────────────

const contentTypesDocx = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const relsDocx = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

const contentTypesXlsx = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const relsXlsx = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const xlWorkbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

const xlWorkbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

// PPTX helpers — a minimal but spec-valid OOXML presentation package.
// OOXML is strict: a master needs a colour map, a layout list and a theme, the
// presentation needs a master reference and a slide size, and every slide needs
// a layout relationship. Missing any of these makes PowerPoint refuse the file.

const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

/** Remove characters that are illegal in XML 1.0 so the parts stay well-formed. */
function stripInvalidXmlChars(s: string): string {
  return (s ?? "").replace(/[^\x09\x0A\x0D\x20-퟿-�]/g, "");
}

function contentTypesPptx(slideCount: number) {
  const overrides = Array.from(
    { length: slideCount },
    (_, i) =>
      `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${overrides}
</Types>`;
}

const relsPptx = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

function pptPresentationRels(slideCount: number) {
  const slideRelsList = Array.from(
    { length: slideCount },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="${R_NS}/slide" Target="slides/slide${i + 1}.xml"/>`,
  ).join("");
  // Master relationship id follows the slide ids so they never collide.
  const masterRel = `<Relationship Id="rId${slideCount + 1}" Type="${R_NS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">${slideRelsList}${masterRel}</Relationships>`;
}

function pptPresentation(slideCount: number) {
  const slideIds = Array.from(
    { length: slideCount },
    (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId${slideCount + 1}"/></p:sldMasterIdLst>
<p:sldIdLst>${slideIds}</p:sldIdLst>
<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>
<p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

// Every slide points at the single shared layout.
const slideRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${R_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

function slideXml(text: string, slideNum: number) {
  // One paragraph per line so wrapping/line breaks survive; blank lines kept.
  const paragraphs =
    stripInvalidXmlChars(text)
      .split("\n")
      .map((line) => {
        const t = line.trim();
        return t
          ? `<a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${escapeXml(t)}</a:t></a:r></a:p>`
          : `<a:p/>`;
      })
      .join("") || `<a:p/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2800" b="1"/><a:t>Slide ${slideNum}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="4525963"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;
}

const slideLayoutXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}" type="blank" preserve="1">
<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const slideLayoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${R_NS}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const slideMasterXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const slideMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${R_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="${R_NS}/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

// A slide master requires a theme with a full colour/font/format scheme.
const themeXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${A_NS}" name="Office Theme">
<a:themeElements>
<a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="44546A"/></a:dk2>
<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1>
<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
<a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
<a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink>
<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Office">
<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Office">
<a:fillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
</a:fillStyleLst>
<a:lnStyleLst>
<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
</a:lnStyleLst>
<a:effectStyleLst>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle>
</a:effectStyleLst>
<a:bgFillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
</a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>`;
