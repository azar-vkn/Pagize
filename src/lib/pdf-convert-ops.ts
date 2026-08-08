/**
 * pdf-convert-ops.ts
 * Office format conversions (DOCX/PPTX/XLSX ↔ PDF), PDF→JPG, HTML→PDF.
 * All browser-only using pdf-lib, JSZip, and canvas APIs.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import type { OutputFile } from "./pdf-ops";
import { renderPageToBlob, getPageCount, extractAllText, extractAllTextStructured } from "./pdf-renderer";

const baseName = (file: File) => file.name.replace(/\.[^.]+$/, "");

// ────────────── CONVERT TO PDF ──────────────

/** Parse DOCX (a ZIP of XML) and render the text content into a PDF. */
export async function wordToPdf(file: File): Promise<OutputFile[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) throw new Error("Could not read DOCX content. Make sure it's a valid .docx file.");

  // Extract text from XML paragraphs
  const paragraphs: string[] = [];
  const matches = docXml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g);
  for (const match of matches) {
    const texts: string[] = [];
    const runs = match[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
    for (const run of runs) {
      texts.push(run[1] ?? "");
    }
    paragraphs.push(texts.join(""));
  }

  return renderTextToPdf(paragraphs, `${baseName(file)}.pdf`);
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
export async function excelToPdf(file: File): Promise<OutputFile[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  // Read shared strings
  const sharedStringsXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const sharedStrings: string[] = [];
  const ssMatches = sharedStringsXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g);
  for (const m of ssMatches) {
    sharedStrings.push(m[1] ?? "");
  }

  // Read first sheet
  const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
  if (!sheetXml) throw new Error("Could not read XLSX data. Make sure it's a valid .xlsx file.");

  const rows: string[][] = [];
  const rowMatches = sheetXml.matchAll(/<row[\s>][\s\S]*?<\/row>/g);
  for (const rowMatch of rowMatches) {
    const cells: string[] = [];
    const cellMatches = rowMatch[0].matchAll(
      /<c[\s][^>]*?(?:t="s"[^>]*)?>[\s\S]*?<v>([\s\S]*?)<\/v>[\s\S]*?<\/c>|<c[\s][^>]*?>[\s\S]*?<v>([\s\S]*?)<\/v>[\s\S]*?<\/c>/g,
    );
    for (const cm of cellMatches) {
      const isShared = rowMatch[0].includes('t="s"');
      const val = cm[1] ?? cm[2] ?? "";
      if (isShared && sharedStrings[parseInt(val, 10)] !== undefined) {
        cells.push(sharedStrings[parseInt(val, 10)]!);
      } else {
        cells.push(val);
      }
    }
    if (cells.length > 0) rows.push(cells);
  }

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
    for (let col = 0; col < row.length; col++) {
      const x = margin + col * colWidth;
      const cellText = (row[col] ?? "").substring(0, 20);
      page.drawText(cellText, {
        x: x + cellPadding,
        y: yPos - fontSize - cellPadding,
        size: fontSize,
        font: rowIdx === 0 ? boldFont : font,
        color: rgb(0.1, 0.1, 0.1),
      });
      // Draw cell border
      page.drawRectangle({
        x,
        y: yPos - rowHeight,
        width: colWidth,
        height: rowHeight,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 0.5,
        color: rowIdx === 0 ? rgb(0.95, 0.95, 0.95) : rgb(1, 1, 1),
      });
    }
    yPos -= rowHeight;
  }

  const bytes = await doc.save();
  return [{ name: `${baseName(file)}.pdf`, blob: new Blob([bytes], { type: "application/pdf" }) }];
}

/** Parse an HTML file and render its text content to PDF. */
export async function htmlToPdf(file: File): Promise<OutputFile[]> {
  const html = await file.text();
  // Parse with DOMParser and extract text
  const parser = new DOMParser();
  const htmlDoc = parser.parseFromString(html, "text/html");

  const title = htmlDoc.title || baseName(file);
  const paragraphs: string[] = [];

  // Walk through body elements
  const walker = htmlDoc.createTreeWalker(htmlDoc.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent?.trim();
    if (text) paragraphs.push(text);
  }

  if (paragraphs.length === 0) paragraphs.push("(Empty document)");

  const result = await renderTextToPdf(paragraphs, `${title}.pdf`);
  return result;
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
  const pages = await extractAllTextStructured(file);

  // Determine the most common font size and font family to use as defaults
  const fontSizeCounts = new Map<number, number>();
  const fontFamilyCounts = new Map<string, number>();
  for (const page of pages) {
    for (const line of page) {
      for (const run of line.runs) {
        if (!run.text.trim()) continue;
        const rounded = Math.round(run.fontSize);
        fontSizeCounts.set(rounded, (fontSizeCounts.get(rounded) ?? 0) + 1);
        fontFamilyCounts.set(run.fontFamily, (fontFamilyCounts.get(run.fontFamily) ?? 0) + 1);
      }
    }
  }
  let bodyFontSize = 12;
  let bodyFontFamily = "Arial";
  let maxCount = 0;
  for (const [size, count] of fontSizeCounts) {
    if (count > maxCount) { maxCount = count; bodyFontSize = size; }
  }
  maxCount = 0;
  for (const [family, count] of fontFamilyCounts) {
    if (count > maxCount) { maxCount = count; bodyFontFamily = family; }
  }

  // Build DOCX XML paragraphs
  const allParagraphs: string[] = [];

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageLines = pages[pageIdx] ?? [];

    // Page break before every page except the first
    if (pageIdx > 0) {
      allParagraphs.push(
        `<w:p><w:pPr><w:rPr></w:rPr></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>`,
      );
    }

    for (const line of pageLines) {
      // Empty lines (no runs) become empty paragraphs for spacing
      if (line.runs.length === 0) {
        allParagraphs.push(`<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`);
        continue;
      }

      // Check if any run on this line is a heading candidate
      const firstRun = line.runs[0];
      const avgFontSize =
        line.runs.reduce((sum, r) => sum + r.fontSize, 0) / line.runs.length;
      const isLargeFont = avgFontSize > bodyFontSize * 1.25;
      const allBold = line.runs.every((r) => r.isBold);
      const isHeading = isLargeFont && allBold;
      const isSubheading = isLargeFont && !allBold;

      let pStyle = "";
      if (isHeading) {
        pStyle = `<w:pStyle w:val="Heading1"/>`;
      } else if (isSubheading) {
        pStyle = `<w:pStyle w:val="Heading2"/>`;
      }

      // Paragraph spacing
      const spacingBefore = line.isNewParagraph ? 120 : 0;
      const pSpacing = `<w:spacing w:before="${spacingBefore}" w:after="40" w:line="276" w:lineRule="auto"/>`;

      // Build one <w:r> per TextRun
      const runsXml = line.runs
        .map((run) => {
          const wordFontSize = Math.round(run.fontSize * 2);
          const boldPr = run.isBold ? `<w:b/><w:bCs/>` : "";
          const italicPr = run.isItalic ? `<w:i/><w:iCs/>` : "";
          const sizePr = `<w:sz w:val="${wordFontSize}"/><w:szCs w:val="${wordFontSize}"/>`;
          const fontPr = `<w:rFonts w:ascii="${escapeXml(run.fontFamily)}" w:hAnsi="${escapeXml(run.fontFamily)}" w:cs="${escapeXml(run.fontFamily)}"/>`;
          const rPr = `<w:rPr>${fontPr}${boldPr}${italicPr}${sizePr}</w:rPr>`;
          return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
        })
        .join("");

      allParagraphs.push(
        `<w:p><w:pPr>${pStyle}${pSpacing}</w:pPr>${runsXml}</w:p>`,
      );
    }
  }

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${allParagraphs.join("")}
<w:sectPr>
  <w:pgSz w:w="12240" w:h="15840"/>
  <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`;

  // Styles definition with default font
  const defaultFontXml = `<w:rFonts w:ascii="${escapeXml(bodyFontFamily)}" w:hAnsi="${escapeXml(bodyFontFamily)}" w:cs="${escapeXml(bodyFontFamily)}"/>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        ${defaultFontXml}
        <w:sz w:val="${Math.round(bodyFontSize * 2)}"/>
        <w:szCs w:val="${Math.round(bodyFontSize * 2)}"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr>${defaultFontXml}<w:sz w:val="${Math.round(bodyFontSize * 2)}"/><w:szCs w:val="${Math.round(bodyFontSize * 2)}"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr>
    <w:rPr><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
  </w:style>
</w:styles>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesDocxWithStyles);
  zip.file("_rels/.rels", relsDocx);
  zip.file("word/_rels/document.xml.rels", wordRelsWithStyles);
  zip.file("word/document.xml", docXml);
  zip.file("word/styles.xml", stylesXml);

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  return [{ name: `${baseName(file)}.docx`, blob }];
}

/** Extract text from PDF and create a simple PPTX file. */
export async function pdfToPowerpoint(file: File): Promise<OutputFile[]> {
  const texts = await extractAllText(file);
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesPptx(texts.length));
  zip.file("_rels/.rels", relsPptx);
  zip.file("ppt/_rels/presentation.xml.rels", pptPresentationRels(texts.length));
  zip.file("ppt/presentation.xml", pptPresentation(texts.length));

  for (let i = 0; i < texts.length; i++) {
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, slideRels);
    zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml(texts[i] ?? "", i + 1));
    zip.file(`ppt/slideLayouts/slideLayout${i + 1}.xml`, slideLayoutXml);
    zip.file(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, slideLayoutRels);
  }
  zip.file("ppt/slideMasters/slideMaster1.xml", slideMasterXml);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", slideMasterRels(texts.length));

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

async function renderTextToPdf(paragraphs: string[], filename: string): Promise<OutputFile[]> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 12;
  const lineHeight = size * 1.4;
  const margin = 50;
  const pageWidth = 612;
  const pageHeight = 792;
  const maxWidth = pageWidth - margin * 2;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  for (const para of paragraphs) {
    if (!para.trim()) {
      y -= lineHeight;
      continue;
    }
    const lines = wrapText(para, font, size, maxWidth);
    for (const line of lines) {
      if (y < margin) {
        page = doc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawText(line, { x: margin, y, size, font, color: rgb(0.1, 0.1, 0.1) });
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

const contentTypesDocxWithStyles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const relsDocx = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

const wordRelsWithStyles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

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

// PPTX helpers
function contentTypesPptx(slideCount: number) {
  const overrides = Array.from(
    { length: slideCount },
    (_, i) =>
      `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
${overrides}
</Types>`;
}

const relsPptx = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

function pptPresentationRels(slideCount: number) {
  const rels = Array.from(
    { length: slideCount },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function pptPresentation(slideCount: number) {
  const slideIds = Array.from(
    { length: slideCount },
    (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst>${slideIds}</p:sldIdLst></p:presentation>`;
}

const slideRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

function slideXml(text: string, slideNum: number) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="2800" b="1"/><a:t>Slide ${slideNum}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="4525963"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${escapeXml(text)}</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;
}

const slideLayoutXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="blank">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>`;

const slideLayoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const slideMasterXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldMaster>`;

function slideMasterRels(slideCount: number) {
  const rels = Array.from(
    { length: slideCount },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout${i + 1}.xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}
