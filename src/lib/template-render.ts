import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { OutputFile } from "./pdf-ops";

/* ------------------------------------------------------------------ *
 * Page geometry + palette
 * ------------------------------------------------------------------ */

const A4_PORTRAIT = { width: 595.28, height: 841.89 };
const A4_LANDSCAPE = { width: 841.89, height: 595.28 };

const INK = rgb(0.09, 0.1, 0.13);
const MUTED = rgb(0.45, 0.46, 0.5);
const HAIRLINE = rgb(0.86, 0.86, 0.88);
const ACCENT = rgb(0.94, 0.46, 0.18);
const WASH = rgb(0.99, 0.96, 0.93);
const RULE_GREY = rgb(0.6, 0.6, 0.64);

/* ------------------------------------------------------------------ *
 * Text safety
 * ------------------------------------------------------------------ */

/**
 * The 14 standard PDF fonts are WinAnsi-encoded and pdf-lib throws on any glyph
 * the encoding has no slot for. People paste em dashes and curly quotes
 * constantly, so fold the common typographic characters down to ASCII and drop
 * anything still outside Latin-1 rather than letting the whole render blow up.
 */
function sanitize(input: string): string {
  return (input ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•●◦·]/g, "-")
    .replace(/ /g, " ")
    .replace(/\t/g, "    ")
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "");
}

/** Word-wraps to maxWidth, hard-breaking any single word too wide to fit. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];

  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      out.push("");
      continue;
    }

    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) out.push(line);

      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = "";
        for (const char of word) {
          if (chunk && font.widthOfTextAtSize(chunk + char, size) > maxWidth) {
            out.push(chunk);
            chunk = char;
          } else {
            chunk += char;
          }
        }
        line = chunk;
      } else {
        line = word;
      }
    }
    out.push(line);
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Value formatting
 * ------------------------------------------------------------------ */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** <input type="date"> yields YYYY-MM-DD; format long-form without timezone drift. */
function formatDate(value: string): string {
  const trimmed = (value ?? "").trim();
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return trimmed;
  const monthName = MONTHS[Number(m[2]) - 1];
  if (!monthName) return trimmed;
  return monthName + " " + Number(m[3]) + ", " + m[1];
}

function formatCurrency(value: string): string {
  const trimmed = String(value ?? "").trim();
  const n = Number(trimmed.replace(/[^0-9.-]/g, ""));
  if (!trimmed || !Number.isFinite(n)) return trimmed;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Splits a free-text block into entries, tolerating commas, newlines and existing bullets. */
function toList(value: string, splitOnCommas = false): string[] {
  const source = splitOnCommas && !value.includes("\n") ? value.split(",") : value.split("\n");
  return source
    .map((entry) => entry.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

/**
 * "OF COMPLETION" -> "O F   C O M P L E T I O N" (pdf-lib has no letter-spacing
 * option). Word gaps are widened so they still read as gaps once every letter
 * is separated by a space.
 */
function tracked(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.split("").join(" "))
    .join("     ");
}

function humanize(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/* ------------------------------------------------------------------ *
 * Layout engine
 * ------------------------------------------------------------------ */

type FontSet = { regular: PDFFont; bold: PDFFont; italic: PDFFont };

type TextOptions = {
  size?: number;
  font?: PDFFont;
  color?: RGB;
  align?: "left" | "center" | "right";
  x?: number;
  width?: number;
  lineHeight?: number;
};

class Layout {
  page: PDFPage;
  y: number;

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: FontSet,
    private readonly size: { width: number; height: number },
    readonly margin: number,
  ) {
    this.page = doc.addPage([size.width, size.height]);
    this.y = size.height - margin;
  }

  get left() { return this.margin; }
  get right() { return this.size.width - this.margin; }
  get contentWidth() { return this.size.width - this.margin * 2; }
  get pageWidth() { return this.size.width; }
  get pageHeight() { return this.size.height; }

  breakPage(): void {
    this.page = this.doc.addPage([this.size.width, this.size.height]);
    this.y = this.size.height - this.margin;
  }

  /** Starts a new page when `space` points would overrun the bottom margin. */
  ensure(space: number): void {
    if (this.y - space < this.margin) this.breakPage();
  }

  move(dy: number): void {
    this.y -= dy;
  }

  /** Draws wrapped, aligned text at the cursor and advances past it. */
  text(raw: string, options: TextOptions = {}): void {
    const {
      size = 10.5,
      font = this.fonts.regular,
      color = INK,
      align = "left",
      x = this.left,
      width = this.contentWidth,
      lineHeight = 1.45,
    } = options;

    const value = sanitize(raw);
    if (!value.trim()) return;

    const advance = size * lineHeight;
    for (const line of wrap(value, font, size, width)) {
      this.ensure(advance);
      if (line) {
        const lineWidth = font.widthOfTextAtSize(line, size);
        const drawX =
          align === "center" ? x + (width - lineWidth) / 2 :
          align === "right" ? x + width - lineWidth :
          x;
        this.page.drawText(line, { x: drawX, y: this.y - size, size, font, color });
      }
      this.y -= advance;
    }
  }

  /** Draws a single line at an explicit position, without wrapping or advancing. */
  raw(
    text: string,
    x: number,
    y: number,
    opts: { size?: number; font?: PDFFont; color?: RGB } = {},
  ): void {
    const { size = 10.5, font = this.fonts.regular, color = INK } = opts;
    this.page.drawText(sanitize(text), { x, y, size, font, color });
  }

  /** Right-aligns a single line ending at the right margin (or `rightEdge`). */
  rawRight(
    text: string,
    y: number,
    opts: { size?: number; font?: PDFFont; color?: RGB; rightEdge?: number } = {},
  ): void {
    const { size = 10.5, font = this.fonts.regular, color = INK, rightEdge = this.right } = opts;
    const clean = sanitize(text);
    this.page.drawText(clean, {
      x: rightEdge - font.widthOfTextAtSize(clean, size),
      y,
      size,
      font,
      color,
    });
  }

  /** Small uppercase section label with a hairline beneath it. */
  sectionHeading(label: string, options: { rule?: boolean; color?: RGB } = {}): void {
    const { rule = true, color = ACCENT } = options;
    this.ensure(34);
    this.text(label.toUpperCase(), { size: 9, font: this.fonts.bold, color });
    if (rule) {
      this.move(1);
      this.rule();
      this.move(10);
    } else {
      this.move(5);
    }
  }

  rule(options: { color?: RGB; thickness?: number; x?: number; width?: number } = {}): void {
    const { color = HAIRLINE, thickness = 1, x = this.left, width = this.contentWidth } = options;
    this.page.drawLine({
      start: { x, y: this.y },
      end: { x: x + width, y: this.y },
      thickness,
      color,
    });
  }

  /** Label left, value right, on one row. */
  row(label: string, value: string, options: { size?: number; bold?: boolean } = {}): void {
    const { size = 10.5, bold = false } = options;
    const advance = size * 2.1;
    this.ensure(advance);
    this.raw(label, this.left, this.y - size, { size, color: MUTED });
    this.rawRight(value, this.y - size, { size, font: bold ? this.fonts.bold : this.fonts.regular });
    this.y -= advance;
  }

  /** A list entry with an accent bullet. */
  bullet(entry: string, options: { size?: number } = {}): void {
    const { size = 10.5 } = options;
    this.ensure(size * 1.8);
    this.page.drawCircle({ x: this.left + 3, y: this.y - size * 0.55, size: 1.9, color: ACCENT });
    this.text(entry, { x: this.left + 15, width: this.contentWidth - 15, size });
    this.move(3);
  }

  /** An unticked checkbox followed by text. */
  checkbox(entry: string, options: { size?: number } = {}): void {
    const { size = 10.5 } = options;
    this.ensure(size * 2);
    this.page.drawRectangle({
      x: this.left + 1,
      y: this.y - size - 1,
      width: 9.5,
      height: 9.5,
      borderColor: RULE_GREY,
      borderWidth: 1,
    });
    this.text(entry, { x: this.left + 20, width: this.contentWidth - 20, size });
    this.move(5);
  }

  /** Signature rule with a caption below and an optional name written above it. */
  signature(caption: string, options: { x?: number; width?: number; value?: string } = {}): void {
    const { x = this.left, width = 210, value = "" } = options;
    if (value) {
      this.raw(value, x, this.y + 6, { size: 11, font: this.fonts.italic });
    }
    this.page.drawLine({
      start: { x, y: this.y },
      end: { x: x + width, y: this.y },
      thickness: 1,
      color: RULE_GREY,
    });
    this.raw(caption, x, this.y - 13, { size: 8.5, color: MUTED });
  }
}

async function fontSet(doc: PDFDocument, family: "sans" | "serif"): Promise<FontSet> {
  if (family === "serif") {
    return {
      regular: await doc.embedFont(StandardFonts.TimesRoman),
      bold: await doc.embedFont(StandardFonts.TimesRomanBold),
      italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
    };
  }
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
}

const LEGAL_NOTE =
  "This document was generated from a general-purpose template and is not legal advice. " +
  "Have a qualified professional review it before you rely on it.";

/** Numbered clause: bold heading on its own line, body beneath. */
function clause(l: Layout, index: number, heading: string, body: string): void {
  l.ensure(60);
  l.text(index + ". " + heading, { size: 11, font: l.fonts.bold });
  l.move(4);
  l.text(body, { size: 10.5, lineHeight: 1.6 });
  l.move(14);
}

/** Two side-by-side signature blocks. */
function signaturePair(
  l: Layout,
  left: { caption: string; value?: string },
  right: { caption: string; value?: string },
): void {
  l.ensure(90);
  l.move(40);
  const columnWidth = (l.contentWidth - 40) / 2;
  l.signature(left.caption, { x: l.left, width: columnWidth, value: left.value ?? "" });
  l.signature(right.caption, { x: l.left + columnWidth + 40, width: columnWidth, value: right.value ?? "" });
  l.move(34);
}

/* ------------------------------------------------------------------ *
 * Template specs
 * ------------------------------------------------------------------ */

type Getter = (key: string, fallback?: string) => string;

type TemplateSpec = {
  fileName: string;
  title: string;
  family: "sans" | "serif";
  landscape?: boolean;
  margin?: number;
  render: (l: Layout, get: Getter) => void;
};

const SPECS: Record<string, TemplateSpec> = {
  /* ------------------------------- Invoice ------------------------------ */
  invoice: {
    fileName: "invoice",
    title: "Invoice",
    family: "sans",
    margin: 54,
    render: (l, get) => {
      l.raw(get("companyName", "Your Company"), l.left, l.y - 18, { size: 18, font: l.fonts.bold });
      l.rawRight("INVOICE", l.y - 22, { size: 30, font: l.fonts.bold, color: ACCENT });
      l.move(44);

      l.rawRight("Invoice No.   " + get("invoiceNumber", "INV-001"), l.y, { size: 9.5, color: MUTED });
      l.move(14);
      const invoiceDate = formatDate(get("date"));
      if (invoiceDate) {
        l.rawRight("Date   " + invoiceDate, l.y, { size: 9.5, color: MUTED });
        l.move(14);
      }

      l.move(8);
      l.rule({ color: INK, thickness: 1.5 });
      l.move(26);

      l.text("BILL TO", { size: 9, font: l.fonts.bold, color: MUTED });
      l.move(3);
      l.text(get("clientName", "Client name"), { size: 13, font: l.fonts.bold });
      l.move(28);

      l.ensure(130);
      l.page.drawRectangle({ x: l.left, y: l.y - 20, width: l.contentWidth, height: 26, color: WASH });
      l.raw("DESCRIPTION", l.left + 12, l.y - 13, { size: 8.5, font: l.fonts.bold, color: MUTED });
      l.rawRight("AMOUNT", l.y - 13, {
        size: 8.5,
        font: l.fonts.bold,
        color: MUTED,
        rightEdge: l.right - 12,
      });
      l.move(34);

      // Single line item. Amount is drawn first so it stays beside the first
      // line of the description even if the description wraps onto a new page.
      const amount = formatCurrency(get("amount", "0"));
      const rowTop = l.y;
      l.rawRight(amount, rowTop - 10.5, { size: 10.5, rightEdge: l.right - 12 });
      l.text(get("description", "Professional services"), {
        x: l.left + 12,
        width: l.contentWidth - 148,
        size: 10.5,
      });
      if (l.y > rowTop - 24) l.y = rowTop - 24;

      l.move(10);
      l.rule();
      l.move(20);

      l.ensure(46);
      l.rawRight("Total Due", l.y - 13, { size: 13, font: l.fonts.bold, rightEdge: l.right - 130 });
      l.rawRight(amount, l.y - 13, { size: 13, font: l.fonts.bold, color: ACCENT });
      l.move(46);

      l.text("Thank you for your business.", { size: 9.5, font: l.fonts.italic, color: MUTED });
    },
  },

  /* -------------------------------- Resume ------------------------------ */
  resume: {
    fileName: "resume",
    title: "Resume",
    family: "sans",
    margin: 56,
    render: (l, get) => {
      l.text(get("fullName", "Your Name"), {
        size: 26,
        font: l.fonts.bold,
        align: "center",
        lineHeight: 1.2,
      });
      l.move(9);

      const contact = [get("email"), get("phone")].filter(Boolean).join("     |     ");
      if (contact) l.text(contact, { size: 10, color: MUTED, align: "center" });

      l.move(15);
      l.rule({ color: INK, thickness: 1.2 });
      l.move(26);

      const sections: Array<[string, string]> = [
        ["Professional Summary", get("summary")],
        ["Experience", get("experience")],
        ["Education", get("education")],
      ];

      for (const [heading, body] of sections) {
        if (!body.trim()) continue;
        l.sectionHeading(heading);
        for (const entry of toList(body)) {
          l.text(entry, { size: 10.5 });
          l.move(5);
        }
        l.move(14);
      }
    },
  },

  /* ----------------------------- Cover Letter --------------------------- */
  "cover-letter": {
    fileName: "cover-letter",
    title: "Cover Letter",
    family: "serif",
    margin: 64,
    render: (l, get) => {
      const sender = get("senderName", "Your Name");
      const recipient = get("recipientName", "Hiring Manager");
      const company = get("company");

      l.text(sender, { size: 15, font: l.fonts.bold });
      l.move(28);

      const letterDate = formatDate(get("date"));
      if (letterDate) {
        l.text(letterDate, { size: 11, color: MUTED });
        l.move(22);
      }

      l.text(recipient, { size: 11 });
      if (company) l.text(company, { size: 11 });
      l.move(26);

      l.text("Dear " + recipient + ",", { size: 11 });
      l.move(16);

      const body = get(
        "content",
        "I am writing to express my interest in this role. My background aligns closely with what your team is looking for, and I would welcome the opportunity to contribute.",
      );
      for (const paragraph of body.split("\n").filter((p) => p.trim())) {
        l.text(paragraph, { size: 11, lineHeight: 1.65 });
        l.move(13);
      }

      l.move(20);
      l.text("Sincerely,", { size: 11 });
      l.move(30);
      l.text(sender, { size: 11, font: l.fonts.bold });
    },
  },

  /* --------------------------------- NDA -------------------------------- */
  nda: {
    fileName: "nda",
    title: "Mutual Non-Disclosure Agreement",
    family: "serif",
    margin: 64,
    render: (l, get) => {
      const partyA = get("partyA", "Disclosing Party");
      const partyB = get("partyB", "Receiving Party");
      const state = get("state", "the applicable jurisdiction");
      const effective = formatDate(get("date")) || "the date last signed below";

      l.text("MUTUAL NON-DISCLOSURE AGREEMENT", { size: 16, font: l.fonts.bold, align: "center" });
      l.move(12);
      l.rule({ color: INK, thickness: 1.2 });
      l.move(26);

      l.text(
        'This Mutual Non-Disclosure Agreement (the "Agreement") is entered into as of ' +
          effective + ' by and between ' + partyA + ' ("Disclosing Party") and ' + partyB +
          ' ("Receiving Party"), together the "Parties".',
        { size: 11, lineHeight: 1.65 },
      );
      l.move(22);

      clause(l, 1, "Confidential Information",
        '"Confidential Information" means any non-public information disclosed by one Party to ' +
        "the other, whether orally, in writing or in any other form, that is designated as " +
        "confidential or that a reasonable person would understand to be confidential given its " +
        "nature and the circumstances of disclosure.");

      clause(l, 2, "Obligations of the Receiving Party",
        "The Receiving Party shall hold the Confidential Information in strict confidence, use it " +
        "solely for the purpose of evaluating or carrying out the business relationship between " +
        "the Parties, and shall not disclose it to any third party without the prior written " +
        "consent of the Disclosing Party. The Receiving Party shall protect it with no less than " +
        "the degree of care it uses for its own confidential information.");

      clause(l, 3, "Exclusions",
        "Confidential Information does not include information that: (a) is or becomes publicly " +
        "available through no fault of the Receiving Party; (b) was lawfully known to the " +
        "Receiving Party before disclosure; (c) is lawfully obtained from a third party without " +
        "restriction; or (d) is independently developed without reference to the Confidential " +
        "Information.");

      clause(l, 4, "Term",
        "This Agreement takes effect on " + effective + " and continues for two (2) years, except " +
        "that the confidentiality obligations survive for so long as the Confidential Information " +
        "remains a trade secret or otherwise confidential.");

      clause(l, 5, "Return of Materials",
        "Upon written request, the Receiving Party shall promptly return or destroy all materials " +
        "containing Confidential Information and, if asked, certify that it has done so.");

      clause(l, 6, "Governing Law",
        "This Agreement is governed by and construed in accordance with the laws of " + state +
        ", without regard to its conflict of laws principles.");

      clause(l, 7, "Entire Agreement",
        "This Agreement constitutes the entire understanding between the Parties on this subject " +
        "and supersedes all prior discussions. It may be amended only in writing signed by both " +
        "Parties.");

      l.move(10);
      l.text("IN WITNESS WHEREOF, the Parties have executed this Agreement as of the date first written above.",
        { size: 10.5, lineHeight: 1.6 });

      signaturePair(l, { caption: partyA, value: "" }, { caption: partyB, value: "" });
      signaturePair(l, { caption: "Date" }, { caption: "Date" });

      l.move(10);
      l.text(LEGAL_NOTE, { size: 8, color: MUTED, font: l.fonts.italic, lineHeight: 1.5 });
    },
  },

  /* ----------------------------- Meeting Notes -------------------------- */
  "meeting-notes": {
    fileName: "meeting-notes",
    title: "Meeting Notes",
    family: "sans",
    margin: 56,
    render: (l, get) => {
      l.text(get("meetingTitle", "Meeting Notes"), { size: 22, font: l.fonts.bold, lineHeight: 1.25 });
      l.move(6);

      const meetingDate = formatDate(get("date"));
      if (meetingDate) l.text(meetingDate, { size: 10.5, color: MUTED });

      l.move(14);
      l.rule({ color: INK, thickness: 1.2 });
      l.move(26);

      const attendees = get("attendees");
      if (attendees) {
        l.sectionHeading("Attendees");
        for (const person of toList(attendees, true)) l.bullet(person);
        l.move(16);
      }

      const agenda = get("agenda");
      if (agenda) {
        l.sectionHeading("Agenda");
        for (const item of toList(agenda)) l.bullet(item);
        l.move(16);
      }

      const actions = get("actionItems");
      if (actions) {
        l.sectionHeading("Action Items");
        for (const item of toList(actions)) l.checkbox(item);
      }
    },
  },

  /* ------------------------------ Rent Receipt -------------------------- */
  "rent-receipt": {
    fileName: "rent-receipt",
    title: "Rent Receipt",
    family: "sans",
    margin: 56,
    render: (l, get) => {
      l.raw("RENT RECEIPT", l.left, l.y - 22, { size: 24, font: l.fonts.bold, color: ACCENT });
      const received = formatDate(get("date"));
      if (received) l.rawRight(received, l.y - 16, { size: 10.5, color: MUTED });
      l.move(40);

      l.rule({ color: INK, thickness: 1.5 });
      l.move(34);

      // Amount panel
      const panelHeight = 74;
      l.ensure(panelHeight + 20);
      l.page.drawRectangle({
        x: l.left,
        y: l.y - panelHeight,
        width: l.contentWidth,
        height: panelHeight,
        color: WASH,
        borderColor: ACCENT,
        borderWidth: 1,
      });
      l.raw("AMOUNT RECEIVED", l.left + 20, l.y - 26, { size: 9, font: l.fonts.bold, color: MUTED });
      l.raw(formatCurrency(get("amount", "0")), l.left + 20, l.y - 56, {
        size: 26,
        font: l.fonts.bold,
        color: INK,
      });
      l.move(panelHeight + 34);

      l.row("Received from", get("tenantName", "Tenant name"), { bold: true });
      l.rule();
      l.move(12);
      l.row("Property", get("propertyAddress", "Property address"), { bold: true });
      l.rule();
      l.move(12);
      l.row("Date received", received || "-", { bold: true });
      l.rule();
      l.move(20);

      l.text(
        "This receipt confirms the rent payment described above has been received in full for the property listed.",
        { size: 9.5, color: MUTED, lineHeight: 1.55 },
      );

      l.move(56);
      l.ensure(60);
      l.signature("Landlord signature", { width: 230, value: get("landlordName") });
    },
  },

  /* ---------------------------- Simple Contract ------------------------- */
  "simple-contract": {
    fileName: "service-agreement",
    title: "Service Agreement",
    family: "serif",
    margin: 64,
    render: (l, get) => {
      const contractor = get("contractorName", "Contractor");
      const client = get("clientName", "Client");
      const services = get("serviceDescription", "the services agreed between the Parties");
      const compensation = get("compensation", "the amount agreed between the Parties");
      const signedOn = formatDate(get("date")) || "the date last signed below";

      l.text("SERVICE AGREEMENT", { size: 17, font: l.fonts.bold, align: "center" });
      l.move(12);
      l.rule({ color: INK, thickness: 1.2 });
      l.move(26);

      l.text(
        'This Service Agreement (the "Agreement") is made on ' + signedOn + ' between ' +
          contractor + ' ("Contractor") and ' + client + ' ("Client").',
        { size: 11, lineHeight: 1.65 },
      );
      l.move(22);

      clause(l, 1, "Services",
        "The Contractor shall provide the following services to the Client: " + services + ". The " +
        "Contractor shall perform the services in a professional and workmanlike manner.");

      clause(l, 2, "Compensation",
        "In consideration for the services, the Client shall pay the Contractor " + compensation +
        ". Unless otherwise agreed in writing, invoices are due within thirty (30) days of receipt.");

      clause(l, 3, "Term and Termination",
        "This Agreement begins on " + signedOn + " and continues until the services are complete, " +
        "unless terminated earlier. Either Party may terminate on fourteen (14) days written " +
        "notice. The Client shall pay for all work performed up to the date of termination.");

      clause(l, 4, "Independent Contractor",
        "The Contractor is an independent contractor, not an employee, partner or agent of the " +
        "Client, and is responsible for its own taxes, insurance and expenses.");

      clause(l, 5, "Confidentiality",
        "Each Party shall keep confidential any non-public information received from the other in " +
        "connection with this Agreement and shall use it only to perform under this Agreement.");

      clause(l, 6, "Ownership of Work Product",
        "Upon full payment, all deliverables produced specifically for the Client under this " +
        "Agreement become the property of the Client. The Contractor retains ownership of any " +
        "pre-existing materials and general know-how.");

      clause(l, 7, "Entire Agreement",
        "This Agreement is the entire agreement between the Parties on this subject and may be " +
        "amended only in writing signed by both Parties.");

      l.move(10);
      l.text("The Parties have signed this Agreement as of the date written above.",
        { size: 10.5, lineHeight: 1.6 });

      signaturePair(l, { caption: "Contractor - " + contractor }, { caption: "Client - " + client });
      signaturePair(l, { caption: "Date" }, { caption: "Date" });

      l.move(10);
      l.text(LEGAL_NOTE, { size: 8, color: MUTED, font: l.fonts.italic, lineHeight: 1.5 });
    },
  },

  /* ------------------------------ Certificate --------------------------- */
  certificate: {
    fileName: "certificate",
    title: "Certificate of Completion",
    family: "serif",
    landscape: true,
    margin: 54,
    render: (l, get) => {
      const recipient = get("recipientName", "Recipient Name");
      const course = get("courseName", "Course or Programme");
      const issuer = get("issuerName", "Issuing Organisation");
      const issued = formatDate(get("date"));

      // Decorative double border
      l.page.drawRectangle({
        x: 26,
        y: 26,
        width: l.pageWidth - 52,
        height: l.pageHeight - 52,
        borderColor: ACCENT,
        borderWidth: 3,
      });
      l.page.drawRectangle({
        x: 36,
        y: 36,
        width: l.pageWidth - 72,
        height: l.pageHeight - 72,
        borderColor: HAIRLINE,
        borderWidth: 1,
      });

      l.y = l.pageHeight - 108;

      l.text(tracked("CERTIFICATE"), { size: 30, font: l.fonts.bold, align: "center", lineHeight: 1.2 });
      l.move(2);
      l.text(tracked("OF COMPLETION"), { size: 12, align: "center", color: MUTED });
      l.move(34);

      l.text("This is to certify that", { size: 12, font: l.fonts.italic, align: "center", color: MUTED });
      l.move(20);

      l.text(recipient, { size: 34, font: l.fonts.bold, align: "center", color: ACCENT, lineHeight: 1.2 });
      l.move(6);

      // Rule sized to the middle half of the page, centred under the name.
      const nameRuleWidth = l.contentWidth * 0.5;
      l.rule({
        x: l.left + (l.contentWidth - nameRuleWidth) / 2,
        width: nameRuleWidth,
        color: HAIRLINE,
      });
      l.move(28);

      l.text("has successfully completed", { size: 12, font: l.fonts.italic, align: "center", color: MUTED });
      l.move(16);
      l.text(course, { size: 18, font: l.fonts.bold, align: "center", lineHeight: 1.3 });

      // Signature lines pinned to the foot of the certificate.
      l.y = 132;
      const columnWidth = 200;
      l.signature("Date", { x: l.left + 30, width: columnWidth, value: issued });
      l.signature("Issued by", {
        x: l.pageWidth - l.margin - 30 - columnWidth,
        width: columnWidth,
        value: issuer,
      });
    },
  },
};

/** Used for any template id without a bespoke layout. */
const FALLBACK: TemplateSpec = {
  fileName: "document",
  title: "Document",
  family: "sans",
  margin: 56,
  render: () => {
    /* replaced at call time - see generateTemplatePdf */
  },
};

/* ------------------------------------------------------------------ *
 * Custom (user-added) details
 * ------------------------------------------------------------------ */

/** A free-form label/value pair the user adds beyond the template's fields. */
export type CustomDetail = { label: string; value: string };

/** Appends an "Additional Details" section listing any user-added fields. */
function renderExtraDetails(l: Layout, details: CustomDetail[]): void {
  const clean = details.filter((d) => (d.label ?? "").trim() || (d.value ?? "").trim());
  if (!clean.length) return;

  l.move(14);
  l.sectionHeading("Additional Details");
  for (const d of clean) {
    const label = (d.label ?? "").trim();
    const value = (d.value ?? "").trim();
    if (label) {
      l.text(label, { size: 9.5, font: l.fonts.bold });
      l.move(2);
    }
    if (value) l.text(value, { size: 10.5, lineHeight: 1.5 });
    l.move(10);
  }
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export async function generateTemplatePdf(
  templateId: string,
  formData: Record<string, string>,
  customDetails: CustomDetail[] = [],
): Promise<OutputFile> {
  const spec = SPECS[templateId] ?? FALLBACK;

  const doc = await PDFDocument.create();
  const fonts = await fontSet(doc, spec.family);
  const pageSize = spec.landscape ? A4_LANDSCAPE : A4_PORTRAIT;
  const layout = new Layout(doc, fonts, pageSize, spec.margin ?? 56);

  const get: Getter = (key, fallback = "") => {
    const value = (formData[key] ?? "").trim();
    return value || fallback;
  };

  const hasExtras = customDetails.some((d) => (d.label ?? "").trim() || (d.value ?? "").trim());

  if (SPECS[templateId]) {
    spec.render(layout, get);
    // Fixed decorative layouts (e.g. the certificate) fill the page and pin
    // their footer, so give any extra details a clean page of their own.
    if (hasExtras && spec.landscape) layout.breakPage();
    renderExtraDetails(layout, customDetails);
  } else {
    // Unknown template: render whatever fields we were handed, readably.
    layout.text(humanize(templateId) || "Document", { size: 22, font: fonts.bold });
    layout.move(12);
    layout.rule({ color: INK, thickness: 1.2 });
    layout.move(24);
    for (const [key, value] of Object.entries(formData)) {
      if (!value?.trim()) continue;
      layout.text(humanize(key), { size: 9, font: fonts.bold, color: ACCENT });
      layout.move(3);
      layout.text(value, { size: 10.5 });
      layout.move(14);
    }
    renderExtraDetails(layout, customDetails);
  }

  doc.setTitle(spec.title);
  doc.setProducer("Pagize");
  doc.setCreator("Pagize");

  const bytes = await doc.save();
  return {
    name: spec.fileName + ".pdf",
    blob: new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
  };
}
