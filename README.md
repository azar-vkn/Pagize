# PDF Palooza

Master Prompt: PDF Tools SaaS

Use this as a single prompt to feed into an AI coding tool (Claude Code, Cursor, v0, Bolt, etc.) or as a build spec for your dev team. It covers every core iLovePDF feature, the tech approach, and the exact UI direction you asked for (light orange theme, island-style navigation).

1. Product Summary

Build a web-based SaaS platform called [PRODUCT_NAME] that lets users upload, convert, edit, and manage PDF files entirely in the browser — functionally equivalent to iLovePDF, with a cleaner, more modern UI.

Core principles:

Every tool must actually work end-to-end (upload → process → download), not just be a UI mockup.

Fast, drag-and-drop first UX.

Files processed securely, auto-deleted after a set time (e.g. 1–2 hours).

Freemium model: free tier with limits (file size, daily conversions), paid tier removes limits + adds batch processing, API access, no ads.

2. Full Feature List (organize into these categories)

Organize PDF

Merge PDF (combine multiple PDFs into one, reorder pages via drag-and-drop thumbnails)

Split PDF (by page ranges, or extract every page as separate file)

Remove pages

Extract pages

Organize/reorder/rotate pages visually

Scan to PDF (camera/mobile capture → PDF)

Convert to PDF

JPG/PNG to PDF

Word (DOCX) to PDF

PowerPoint (PPTX) to PDF

Excel (XLSX) to PDF

HTML to PDF (URL or file input)

Convert from PDF

PDF to JPG (per page or all pages as ZIP)

PDF to Word (editable DOCX, preserve layout as closely as possible)

PDF to PowerPoint

PDF to Excel (table extraction)

PDF to PDF/A (archival format)

Edit PDF

Edit PDF (add text, shapes, images, freehand annotation directly on pages)

Rotate PDF

Add page numbers

Add watermark (text/image, position, opacity, rotation controls)

Crop PDF

PDF Security

Unlock PDF (remove password, when user has permission)

Protect PDF (add password + permissions: no print, no copy, no edit)

Sign PDF (draw/type/upload signature, place on page)

Redact PDF (permanently black out sensitive text/areas)

Compare PDF (diff two versions, highlight changes)

Optimize PDF

Compress PDF (low/recommended/extreme compression presets with size preview)

Repair PDF (fix corrupted files)

OCR PDF (make scanned PDFs searchable/selectable, multi-language)

3. Recommended Tech Stack

Frontend: Next.js (App Router) + TypeScript + Tailwind CSS + Framer Motion (for the island nav and drag-drop transitions)

Backend/Processing:

Node.js API routes (or a separate Fastify/Express service) for orchestration

pdf-lib for merge/split/rotate/watermark/page numbers/protect (lightweight, works well in Node)

pdf2pic / pdf-poppler or ghostscript for PDF→image and compression

LibreOffice headless (via unoconv or libreoffice --headless) for Office↔PDF conversions — this is what iLovePDF itself relies on under the hood

Tesseract.js or server-side Tesseract for OCR

Ghostscript/qpdf for compression and repair

Queue system: BullMQ + Redis for async processing of large files (don't block the request thread)

Storage: S3-compatible object storage (files auto-expire via lifecycle rules — e.g. 2 hour TTL)

Auth & Billing: Clerk/Auth.js for auth, Stripe for subscriptions (metered + flat tiers)

Infra: Deploy processing workers on a container platform (Fly.io, Render, or AWS ECS) since LibreOffice/Ghostscript need a real filesystem — not pure serverless edge functions.

4. UI/UX Direction (your specifications)

Theme: Light orange as the primary accent

Background: off-white / very light warm gray (#FAF9F7 or similar)

Primary accent: warm light orange (#FF8A4C or #FFA366 range)

Secondary accent: soft peach for hover/active states (#FFE8D6)

Text: dark charcoal, not pure black, for softness

Success/error states: keep standard green/red but muted to match the warm palette

Navigation — "Island" style:

Nav is NOT a traditional full-width bar. Instead, render it as a floating rounded-pill/rounded-rectangle container ("island") with padding and a soft shadow, detached from the screen edges (like a floating dock).

Each nav section (e.g. "Merge", "Split", "Compress", "Convert", "Security") is its own pill/button inside the island, with icon + label.

Active tool gets a filled orange pill background; inactive ones are ghost/outline style.

On scroll, the island can shrink slightly and stick (sticky floating position), similar to macOS dock behavior — subtle, not gimmicky.

On the homepage, the full tool grid also uses "island cards" — each tool is a rounded card with icon, sitting with breathing room (not a dense grid), grouped by category with soft dividers.

Homepage layout:

Hero with a big drag-and-drop zone (this is the #1 conversion driver on iLovePDF — most users land and want to just drop a file immediately) + a search bar to filter tools by keyword.

Tool categories below, each as an island-card grid (Organize / Convert / Edit / Security / Optimize).

Simple, uncluttered footer.

Tool page layout:

Upload zone (drag-drop + "select from device" + optionally cloud import from Google Drive/Dropbox).

Once uploaded, show page thumbnails (for tools needing page-level action) with inline controls.

Tool-specific options panel (e.g. compression level, watermark settings) in a clean sidebar or bottom sheet on mobile.

Big clear primary CTA button in the orange accent (e.g. "Merge PDF →").

Processing state with progress indicator → download screen with "Download," "Save to Drive," and "Start new task" options.

General UI rules:

Generous whitespace, rounded corners (12–20px radius) throughout for the "island" aesthetic.

Icons: consistent line-icon set (Lucide or Phosphor icons) recolored to match theme.

Mobile-first responsive: island nav collapses into a bottom floating dock on mobile.

Micro-interactions: subtle scale/shadow on hover for cards and pills, smooth page-thumbnail drag reordering.

5. Non-Functional Requirements

Security: All uploaded files encrypted at rest, deleted automatically after processing window; no permanent storage without explicit user save.

Performance: Large file handling via chunked upload; async job processing with real-time status (WebSocket or polling) so the UI isn't blocked.

Accessibility: Keyboard navigable, proper contrast ratios even within the light-orange palette (check WCAG AA).

Scalability: Processing workers should scale horizontally and independently from the web frontend.

6. Suggested Build Order (MVP → full parity)

Auth + file upload/storage pipeline + island nav + homepage shell

Core "Organize" tools: Merge, Split, Rotate, Remove/Extract pages

Convert tools: JPG↔PDF, then Office↔PDF (LibreOffice integration is the heaviest lift — start early)

Optimize tools: Compress, Repair

Security tools: Protect, Unlock, Sign, Watermark, Page numbers

Edit PDF (in-browser page editor — most complex feature, build last)

OCR + Compare + Redact

Billing, usage limits, dashboard, API access for paid tier

Feed this whole document to your coding assistant one section at a time (start with Section 6, Step 1) rather than all at once — it'll produce better-scoped code than asking for the entire platform in one shot.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/1ad3a5c3-dff5-4565-aae9-391b8e904131).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
