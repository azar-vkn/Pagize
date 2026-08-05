import {
  Combine,
  Scissors,
  Trash2,
  FileOutput,
  RotateCw,
  ImagePlus,
  Hash,
  Droplets,
  Minimize2,
  FileText,
  FileSpreadsheet,
  Presentation,
  Image as ImageIcon,
  Lock,
  Unlock,
  PenTool,
  EyeOff,
  GitCompare,
  Wrench,
  ScanText,
  Crop,
  LayoutGrid,
  Globe,
  Camera,
  Archive,
  type LucideIcon,
} from "lucide-react";

export type ToolCategory = "organize" | "convert-to" | "convert-from" | "edit" | "security" | "optimize";

export type Tool = {
  slug: string;
  name: string;
  blurb: string;
  icon: LucideIcon;
  category: ToolCategory;
  accepts: string;
  multiple: boolean;
  ready: boolean;
};

export const categories: { id: ToolCategory; label: string; description: string }[] = [
  { id: "organize", label: "Organize PDF", description: "Merge, split and rearrange pages" },
  { id: "convert-to", label: "Convert to PDF", description: "Turn images and documents into PDFs" },
  { id: "convert-from", label: "Convert from PDF", description: "Export PDFs to other formats" },
  { id: "edit", label: "Edit PDF", description: "Marks, numbers and watermarks" },
  { id: "security", label: "PDF Security", description: "Protect, sign and review documents" },
  { id: "optimize", label: "Optimize PDF", description: "Shrink, repair and recognise text" },
];

export const tools: Tool[] = [
  { slug: "merge-pdf", name: "Merge PDF", blurb: "Combine PDFs in the order you want.", icon: Combine, category: "organize", accepts: "application/pdf", multiple: true, ready: true },
  { slug: "split-pdf", name: "Split PDF", blurb: "Split by ranges or extract every page.", icon: Scissors, category: "organize", accepts: "application/pdf", multiple: false, ready: true },
  { slug: "remove-pages", name: "Remove pages", blurb: "Delete the pages you don't need.", icon: Trash2, category: "organize", accepts: "application/pdf", multiple: false, ready: true },
  { slug: "extract-pages", name: "Extract pages", blurb: "Pull selected pages into a new PDF.", icon: FileOutput, category: "organize", accepts: "application/pdf", multiple: false, ready: true },
  { slug: "rotate-pdf", name: "Rotate PDF", blurb: "Turn pages 90°, 180° or 270°.", icon: RotateCw, category: "organize", accepts: "application/pdf", multiple: false, ready: true },
  { slug: "organize-pages", name: "Organize pages", blurb: "Reorder pages visually.", icon: LayoutGrid, category: "organize", accepts: "application/pdf", multiple: false, ready: false },
  { slug: "scan-to-pdf", name: "Scan to PDF", blurb: "Capture with your camera into a PDF.", icon: Camera, category: "organize", accepts: "image/*", multiple: true, ready: false },

  { slug: "jpg-to-pdf", name: "JPG to PDF", blurb: "Images into a single tidy PDF.", icon: ImagePlus, category: "convert-to", accepts: "image/jpeg,image/png", multiple: true, ready: true },
  { slug: "word-to-pdf", name: "Word to PDF", blurb: "DOCX documents into PDF.", icon: FileText, category: "convert-to", accepts: ".docx", multiple: false, ready: false },
  { slug: "powerpoint-to-pdf", name: "PowerPoint to PDF", blurb: "PPTX decks into PDF.", icon: Presentation, category: "convert-to", accepts: ".pptx", multiple: false, ready: false },
  { slug: "excel-to-pdf", name: "Excel to PDF", blurb: "XLSX sheets into PDF.", icon: FileSpreadsheet, category: "convert-to", accepts: ".xlsx", multiple: false, ready: false },
  { slug: "html-to-pdf", name: "HTML to PDF", blurb: "A URL or file rendered to PDF.", icon: Globe, category: "convert-to", accepts: ".html", multiple: false, ready: false },

  { slug: "pdf-to-jpg", name: "PDF to JPG", blurb: "Every page as an image.", icon: ImageIcon, category: "convert-from", accepts: "application/pdf", multiple: false, ready: false },
  { slug: "pdf-to-word", name: "PDF to Word", blurb: "Editable DOCX with layout kept.", icon: FileText, category: "convert-from", accepts: "application/pdf", multiple: false, ready: false },
  { slug: "pdf-to-powerpoint", name: "PDF to PowerPoint", blurb: "Pages as editable slides.", icon: Presentation, category: "convert-from", accepts: "application/pdf", multiple: false, ready: false },
  { slug: "pdf-to-excel", name: "PDF to Excel", blurb: "Extract tables into a sheet.", icon: FileSpreadsheet, category: "convert-from", accepts: "application/pdf", multiple: false, ready: false },
  { slug: "pdf-to-pdfa", name: "PDF to PDF/A", blurb: "Archival-ready conversion.", icon: Archive, category: "convert-from", accepts: "application/pdf", multiple: false, ready: false },

  { slug: "add-page-numbers", name: "Page numbers", blurb: "Number pages with position control.", icon: Hash, category: "edit", accepts: "application/pdf", multiple: false, ready: true },
  { slug: "watermark-pdf", name: "Watermark", blurb: "Stamp text with opacity and angle.", icon: Droplets, category: "edit", accepts: "application/pdf", multiple: false, ready: true },
  { slug: "edit-pdf", name: "Edit PDF", blurb: "Text, shapes and freehand on pages.", icon: PenTool, category: "edit", accepts: "application/pdf", multiple: false, ready: false },
  { slug: "crop-pdf", name: "Crop PDF", blurb: "Trim margins across pages.", icon: Crop, category: "edit", accepts: "application/pdf", multiple: false, ready: false },

  { slug: "protect-pdf", name: "Protect PDF", blurb: "Password and permissions.", icon: Lock, category: "security", accepts: "application/pdf", multiple: false, ready: false },
  { slug: "unlock-pdf", name: "Unlock PDF", blurb: "Remove a password you own.", icon: Unlock, category: "security", accepts: "application/pdf", multiple: false, ready: false },
  { slug: "sign-pdf", name: "Sign PDF", blurb: "Draw, type or upload a signature.", icon: PenTool, category: "security", accepts: "application/pdf", multiple: false, ready: false },
  { slug: "redact-pdf", name: "Redact PDF", blurb: "Permanently black out content.", icon: EyeOff, category: "security", accepts: "application/pdf", multiple: false, ready: false },
  { slug: "compare-pdf", name: "Compare PDF", blurb: "Diff two versions side by side.", icon: GitCompare, category: "security", accepts: "application/pdf", multiple: true, ready: false },

  { slug: "compress-pdf", name: "Compress PDF", blurb: "Shrink files with size preview.", icon: Minimize2, category: "optimize", accepts: "application/pdf", multiple: false, ready: true },
  { slug: "repair-pdf", name: "Repair PDF", blurb: "Recover damaged documents.", icon: Wrench, category: "optimize", accepts: "application/pdf", multiple: false, ready: false },
  { slug: "ocr-pdf", name: "OCR PDF", blurb: "Make scans searchable.", icon: ScanText, category: "optimize", accepts: "application/pdf", multiple: false, ready: false },
];

export const getTool = (slug: string) => tools.find((t) => t.slug === slug);

export const navTools = ["merge-pdf", "split-pdf", "compress-pdf", "jpg-to-pdf", "watermark-pdf"]
  .map((s) => getTool(s))
  .filter((t): t is Tool => Boolean(t));