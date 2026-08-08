import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, ArrowLeft, Download, Loader2, RotateCcw, Type, Palette } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { IslandNav } from "@/components/IslandNav";
import { SiteFooter } from "@/components/SiteFooter";
import { DropZone, formatBytes } from "@/components/DropZone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getTool } from "@/lib/tools";
import {
  addPageNumbers,
  compressPdf,
  cropPdf,
  editPdfAddText,
  editPdfReplaceText,
  imagesToPdf,
  mergePdfs,
  ocrPdf,
  organizePages,
  pageCountOf,
  pdfToPdfa,
  protectPdf,
  redactPdf,
  repairPdf,
  rotatePdf,
  selectPages,
  signPdf,
  splitPdf,
  unlockPdf,
  watermarkPdf,
  type NumberPosition,
  type OutputFile,
  type TextReplacement,
} from "@/lib/pdf-ops";
import type { TextItemPosition } from "@/lib/pdf-renderer";
import { cn } from "@/lib/utils";

// Lazy-load components that depend on pdfjs-dist (browser-only, no SSR)
const PdfPreview = lazy(() =>
  import("@/components/PdfPreview").then((m) => ({ default: m.PdfPreview })),
);
const PdfTextEditor = lazy(() =>
  import("@/components/PdfTextEditor").then((m) => ({ default: m.PdfTextEditor })),
);

// Dynamic import helper for pdf-convert-ops (also depends on pdfjs-dist)
const getPdfConvertOps = () => import("@/lib/pdf-convert-ops");

export const Route = createFileRoute("/tools/$slug")({
  loader: ({ params }) => {
    const tool = getTool(params.slug);
    if (!tool) throw notFound();
    return { name: tool.name, blurb: tool.blurb };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.name ?? "PDF tool"} — Pagize` },
      {
        name: "description",
        content: loaderData?.blurb ?? "A PDF tool that runs locally in your browser.",
      },
      { property: "og:title", content: `${loaderData?.name ?? "PDF tool"} — Pagize` },
      { property: "og:description", content: loaderData?.blurb ?? "Browser-based PDF tools." },
    ],
  }),
  component: ToolPage,
});

type Options = {
  splitMode: "ranges" | "every";
  ranges: string;
  angle: number;
  position: NumberPosition;
  startAt: number;
  text: string;
  opacity: number;
  wmAngle: number;
  wmSize: number;
  level: "low" | "recommended" | "extreme";
  // Crop
  cropTop: number;
  cropRight: number;
  cropBottom: number;
  cropLeft: number;
  // Protect
  userPassword: string;
  ownerPassword: string;
  // Sign
  signatureDataUrl: string;
  signPage: number;
  signX: number;
  signY: number;
  signWidth: number;
  signHeight: number;
  // Edit
  editText: string;
  editPage: number;
  editX: number;
  editY: number;
  editSize: number;
  editColorR: number;
  editColorG: number;
  editColorB: number;
  // PDF to JPG quality
  jpgQuality: number;
  // Text Replacements
  textReplacements: TextReplacement[];
  selectedTextItem: TextItemPosition | null;
  selectedTextPageIndex: number;
  selectedTextItemIdx: number;
};

const defaults: Options = {
  splitMode: "ranges",
  ranges: "",
  angle: 90,
  position: "bottom-center",
  startAt: 1,
  text: "CONFIDENTIAL",
  opacity: 0.25,
  wmAngle: 45,
  wmSize: 48,
  level: "recommended",
  cropTop: 20,
  cropRight: 20,
  cropBottom: 20,
  cropLeft: 20,
  userPassword: "",
  ownerPassword: "",
  signatureDataUrl: "",
  signPage: 0,
  signX: 50,
  signY: 700,
  signWidth: 150,
  signHeight: 50,
  editText: "",
  editPage: 0,
  editX: 50,
  editY: 50,
  editSize: 16,
  editColorR: 0,
  editColorG: 0,
  editColorB: 0,
  textReplacements: [] as TextReplacement[],
  selectedTextItem: null,
  selectedTextPageIndex: -1,
  selectedTextItemIdx: -1,
  jpgQuality: 92,
};

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-full bg-secondary p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Tools that benefit from page preview
const previewTools = new Set([
  "merge-pdf",
  "organize-pages",
  "remove-pages",
  "extract-pages",
  "rotate-pdf",
  "crop-pdf",
  "sign-pdf",
  "redact-pdf",
  "edit-pdf",
]);

function ToolPage() {
  const { slug } = Route.useParams();
  const tool = getTool(slug)!;
  const [files, setFiles] = useState<File[]>([]);
  const [pages, setPages] = useState<number | null>(null);
  const [opts, setOpts] = useState<Options>(defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<OutputFile[] | null>(null);
  // For organize / reorder
  const [pageOrder, setPageOrder] = useState<number[] | null>(null);
  // For page selection (remove/extract)
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  // Signature canvas
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const set = <K extends keyof Options>(key: K, value: Options[K]) =>
    setOpts((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    setFiles([]);
    setResults(null);
    setError(null);
    setPages(null);
    setPageOrder(null);
    setSelectedPages(new Set());
    setOpts(defaults);
  }, [slug]);

  useEffect(() => {
    const first = files[0];
    if (!first || !tool.accepts.includes("application/pdf")) {
      setPages(null);
      return;
    }
    let active = true;
    pageCountOf(first)
      .then((n) => {
        if (active) {
          setPages(n);
          // Init page order for organize
          if (slug === "organize-pages") {
            setPageOrder(Array.from({ length: n }, (_, i) => i));
          }
        }
      })
      .catch(() => active && setPages(null));
    return () => {
      active = false;
    };
  }, [files, tool.accepts, slug]);

  const togglePage = useCallback((pageIdx: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageIdx)) next.delete(pageIdx);
      else next.add(pageIdx);
      return next;
    });
  }, []);

  // Signature drawing handlers
  const startDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000";
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const endDraw = () => {
    setIsDrawing(false);
    const canvas = sigCanvasRef.current;
    if (canvas) {
      set("signatureDataUrl", canvas.toDataURL("image/png"));
    }
  };

  const clearSignature = () => {
    const canvas = sigCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      set("signatureDataUrl", "");
    }
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const file = files[0]!;
      let out: OutputFile[] = [];
      switch (slug) {
        case "merge-pdf":
          if (files.length < 2) throw new Error("Add at least two PDFs to merge.");
          out = await mergePdfs(files);
          break;
        case "split-pdf":
          out = await splitPdf(file, opts.splitMode, opts.ranges);
          break;
        case "remove-pages": {
          const rangeStr =
            selectedPages.size > 0
              ? [...selectedPages]
                  .map((p) => p + 1)
                  .sort((a, b) => a - b)
                  .join(",")
              : opts.ranges;
          if (!rangeStr) throw new Error("Select pages to remove.");
          out = await selectPages(file, rangeStr, "remove");
          break;
        }
        case "extract-pages": {
          const rangeStr =
            selectedPages.size > 0
              ? [...selectedPages]
                  .map((p) => p + 1)
                  .sort((a, b) => a - b)
                  .join(",")
              : opts.ranges;
          if (!rangeStr) throw new Error("Select pages to extract.");
          out = await selectPages(file, rangeStr, "keep");
          break;
        }
        case "rotate-pdf":
          out = await rotatePdf(file, opts.angle, opts.ranges);
          break;
        case "organize-pages":
          if (!pageOrder) throw new Error("Reorder the pages first.");
          out = await organizePages(file, pageOrder);
          break;
        case "scan-to-pdf":
        case "jpg-to-pdf":
          out = await imagesToPdf(files);
          break;
        case "word-to-pdf": {
          const ops = await getPdfConvertOps();
          out = await ops.wordToPdf(file);
          break;
        }
        case "powerpoint-to-pdf": {
          const ops = await getPdfConvertOps();
          out = await ops.powerpointToPdf(file);
          break;
        }
        case "excel-to-pdf": {
          const ops = await getPdfConvertOps();
          out = await ops.excelToPdf(file);
          break;
        }
        case "html-to-pdf": {
          const ops = await getPdfConvertOps();
          out = await ops.htmlToPdf(file);
          break;
        }
        case "pdf-to-jpg": {
          const ops = await getPdfConvertOps();
          out = await ops.pdfToJpg(file, opts.jpgQuality / 100);
          break;
        }
        case "pdf-to-word": {
          const ops = await getPdfConvertOps();
          out = await ops.pdfToWord(file);
          break;
        }
        case "pdf-to-powerpoint": {
          const ops = await getPdfConvertOps();
          out = await ops.pdfToPowerpoint(file);
          break;
        }
        case "pdf-to-excel": {
          const ops = await getPdfConvertOps();
          out = await ops.pdfToExcel(file);
          break;
        }
        case "pdf-to-pdfa":
          out = await pdfToPdfa(file);
          break;
        case "add-page-numbers":
          out = await addPageNumbers(file, opts.position, opts.startAt);
          break;
        case "watermark-pdf":
          out = await watermarkPdf(file, opts.text, opts.opacity, opts.wmAngle, opts.wmSize);
          break;
        case "edit-pdf":
          if (opts.textReplacements.length === 0)
            throw new Error("Please select and edit some text first.");
          out = await editPdfReplaceText(file, opts.textReplacements);
          break;
        case "crop-pdf":
          out = await cropPdf(
            file,
            {
              top: opts.cropTop,
              right: opts.cropRight,
              bottom: opts.cropBottom,
              left: opts.cropLeft,
            },
            opts.ranges,
          );
          break;
        case "protect-pdf":
          out = await protectPdf(file, opts.userPassword, opts.ownerPassword);
          break;
        case "unlock-pdf":
          out = await unlockPdf(file);
          break;
        case "sign-pdf":
          if (!opts.signatureDataUrl) throw new Error("Draw or upload a signature first.");
          out = await signPdf(
            file,
            opts.signatureDataUrl,
            opts.signPage,
            opts.signX,
            opts.signY,
            opts.signWidth,
            opts.signHeight,
          );
          break;
        case "redact-pdf":
          // For now, redact selected areas. Users can specify via options.
          throw new Error("Select areas on the preview to redact, then process.");
        case "compare-pdf": {
          if (files.length < 2) throw new Error("Upload two PDFs to compare.");
          // For compare, we just render both side by side as images (results view handles display)
          const ops = await getPdfConvertOps();
          const out1 = await ops.pdfToJpg(files[0]!, 0.92);
          const out2 = await ops.pdfToJpg(files[1]!, 0.92);
          out = [
            ...out1.map((o, i) => ({ ...o, name: `original-page-${i + 1}.jpg` })),
            ...out2.map((o, i) => ({ ...o, name: `compared-page-${i + 1}.jpg` })),
          ];
          break;
        }
        case "compress-pdf":
          out = await compressPdf(file, opts.level);
          break;
        case "repair-pdf":
          out = await repairPdf(file);
          break;
        case "ocr-pdf":
          out = await ocrPdf(file);
          break;
        default:
          throw new Error("This tool isn't available yet.");
      }
      setResults(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong with that file.");
    } finally {
      setBusy(false);
    }
  };

  const download = (out: OutputFile) => {
    const url = URL.createObjectURL(out.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = out.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAll = () => {
    if (!results) return;
    for (const out of results) download(out);
  };

  const rangeField = (help: string) => (
    <div className="space-y-2">
      <Label htmlFor="ranges">Pages</Label>
      <Input
        id="ranges"
        value={opts.ranges}
        onChange={(e) => set("ranges", e.target.value)}
        placeholder="e.g. 1-3, 5, 8-"
        className="rounded-xl"
      />
      <p className="text-xs text-muted-foreground">
        {help}
        {pages ? ` This file has ${pages} pages.` : ""}
      </p>
    </div>
  );

  const showPreview = previewTools.has(slug) && files.length > 0 && !results;

  const optionsPanel = () => {
    switch (slug) {
      case "split-pdf":
        return (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Mode</Label>
              <Segmented
                value={opts.splitMode}
                onChange={(v) => set("splitMode", v)}
                options={[
                  { value: "ranges", label: "By ranges" },
                  { value: "every", label: "Every page" },
                ]}
              />
            </div>
            {opts.splitMode === "ranges" &&
              rangeField("Each comma-separated group becomes its own file.")}
          </div>
        );
      case "remove-pages":
        return (
          <div className="space-y-4">
            {rangeField("These pages will be deleted.")}
            {selectedPages.size > 0 && (
              <p className="text-sm font-medium text-red-600">
                {selectedPages.size} page{selectedPages.size > 1 ? "s" : ""} selected for removal
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Click page thumbnails to select/deselect pages to remove.
            </p>
          </div>
        );
      case "extract-pages":
        return (
          <div className="space-y-4">
            {rangeField("Only these pages are kept, in order.")}
            {selectedPages.size > 0 && (
              <p className="text-sm font-medium text-emerald-600">
                {selectedPages.size} page{selectedPages.size > 1 ? "s" : ""} selected to keep
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Click page thumbnails to select pages to extract.
            </p>
          </div>
        );
      case "rotate-pdf":
        return (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Rotation</Label>
              <Segmented
                value={opts.angle}
                onChange={(v) => set("angle", v)}
                options={[
                  { value: 90, label: "90°" },
                  { value: 180, label: "180°" },
                  { value: 270, label: "270°" },
                ]}
              />
            </div>
            {rangeField("Leave empty to rotate every page.")}
          </div>
        );
      case "organize-pages":
        return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Drag page thumbnails to rearrange them. The final order is saved when you process.
            </p>
            {pageOrder && (
              <p className="text-xs text-muted-foreground">
                Current order: {pageOrder.map((p) => p + 1).join(", ")}
              </p>
            )}
          </div>
        );
      case "add-page-numbers":
        return (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Position</Label>
              <Segmented
                value={opts.position}
                onChange={(v) => set("position", v)}
                options={[
                  { value: "bottom-center", label: "Bottom centre" },
                  { value: "bottom-right", label: "Bottom right" },
                  { value: "top-center", label: "Top centre" },
                  { value: "top-right", label: "Top right" },
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="startAt">Start numbering at</Label>
              <Input
                id="startAt"
                type="number"
                min={0}
                value={opts.startAt}
                onChange={(e) => set("startAt", Number(e.target.value))}
                className="rounded-xl"
              />
            </div>
          </div>
        );
      case "watermark-pdf":
        return (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="text">Watermark text</Label>
              <Input
                id="text"
                value={opts.text}
                onChange={(e) => set("text", e.target.value)}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label>Opacity — {Math.round(opts.opacity * 100)}%</Label>
              <Slider
                value={[opts.opacity * 100]}
                min={5}
                max={100}
                step={5}
                onValueChange={([v]) => set("opacity", (v ?? 25) / 100)}
              />
            </div>
            <div className="space-y-2">
              <Label>Angle — {opts.wmAngle}°</Label>
              <Slider
                value={[opts.wmAngle]}
                min={0}
                max={90}
                step={5}
                onValueChange={([v]) => set("wmAngle", v ?? 45)}
              />
            </div>
            <div className="space-y-2">
              <Label>Size — {opts.wmSize}pt</Label>
              <Slider
                value={[opts.wmSize]}
                min={12}
                max={120}
                step={2}
                onValueChange={([v]) => set("wmSize", v ?? 48)}
              />
            </div>
          </div>
        );
      case "compress-pdf":
        return (
          <div className="space-y-2">
            <Label>Compression</Label>
            <Segmented
              value={opts.level}
              onChange={(v) => set("level", v)}
              options={[
                { value: "low", label: "Low" },
                { value: "recommended", label: "Recommended" },
                { value: "extreme", label: "Extreme" },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              Rebuilds the document and strips metadata. Original:{" "}
              {files[0] ? formatBytes(files[0].size) : "—"}
            </p>
          </div>
        );
      case "merge-pdf":
        return (
          <p className="text-sm text-muted-foreground">
            Pages are combined top to bottom in the order shown. Drag the file cards to change it.
          </p>
        );
      case "jpg-to-pdf":
      case "scan-to-pdf":
        return (
          <p className="text-sm text-muted-foreground">
            Each image becomes one page sized to the image. Drop or select all your images.
          </p>
        );
      case "crop-pdf":
        return (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Set margins in points (72 pt = 1 inch). Preview shows the crop area.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="cropTop">Top</Label>
                <Input
                  id="cropTop"
                  type="number"
                  min={0}
                  value={opts.cropTop}
                  onChange={(e) => set("cropTop", Number(e.target.value))}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cropBottom">Bottom</Label>
                <Input
                  id="cropBottom"
                  type="number"
                  min={0}
                  value={opts.cropBottom}
                  onChange={(e) => set("cropBottom", Number(e.target.value))}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cropLeft">Left</Label>
                <Input
                  id="cropLeft"
                  type="number"
                  min={0}
                  value={opts.cropLeft}
                  onChange={(e) => set("cropLeft", Number(e.target.value))}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cropRight">Right</Label>
                <Input
                  id="cropRight"
                  type="number"
                  min={0}
                  value={opts.cropRight}
                  onChange={(e) => set("cropRight", Number(e.target.value))}
                  className="rounded-xl"
                />
              </div>
            </div>
            {rangeField("Leave empty to crop all pages.")}
          </div>
        );
      case "protect-pdf":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="userPassword">User password</Label>
              <Input
                id="userPassword"
                type="password"
                value={opts.userPassword}
                onChange={(e) => set("userPassword", e.target.value)}
                placeholder="Required to open"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ownerPassword">Owner password</Label>
              <Input
                id="ownerPassword"
                type="password"
                value={opts.ownerPassword}
                onChange={(e) => set("ownerPassword", e.target.value)}
                placeholder="Required to change permissions"
                className="rounded-xl"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Marks the PDF as protected. For full encryption, a server-side solution is
              recommended.
            </p>
          </div>
        );
      case "unlock-pdf":
        return (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Removes password protection from your PDF by re-saving it. The file must be accessible
              (not fully encrypted).
            </p>
          </div>
        );
      case "sign-pdf":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Draw your signature</Label>
              <div className="rounded-xl border border-border bg-white p-1">
                <canvas
                  ref={sigCanvasRef}
                  width={280}
                  height={80}
                  className="w-full cursor-crosshair rounded-lg"
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                />
              </div>
              <Button variant="ghost" size="sm" onClick={clearSignature} className="text-xs">
                Clear signature
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Page</Label>
                <Input
                  type="number"
                  min={1}
                  max={pages ?? 1}
                  value={opts.signPage + 1}
                  onChange={(e) => set("signPage", Math.max(0, Number(e.target.value) - 1))}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1">
                <Label>Size (W×H)</Label>
                <div className="flex gap-1">
                  <Input
                    type="number"
                    min={20}
                    value={opts.signWidth}
                    onChange={(e) => set("signWidth", Number(e.target.value))}
                    className="rounded-xl"
                  />
                  <Input
                    type="number"
                    min={10}
                    value={opts.signHeight}
                    onChange={(e) => set("signHeight", Number(e.target.value))}
                    className="rounded-xl"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>X position</Label>
                <Input
                  type="number"
                  min={0}
                  value={opts.signX}
                  onChange={(e) => set("signX", Number(e.target.value))}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1">
                <Label>Y position</Label>
                <Input
                  type="number"
                  min={0}
                  value={opts.signY}
                  onChange={(e) => set("signY", Number(e.target.value))}
                  className="rounded-xl"
                />
              </div>
            </div>
          </div>
        );
      case "redact-pdf":
        return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Black rectangles will be drawn over selected areas. Currently covers the full page —
              adjust coordinates as needed.
            </p>
            <p className="text-xs text-muted-foreground">
              For precise redaction, specify page ranges and use crop-like coordinates.
            </p>
          </div>
        );
      case "edit-pdf": {
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Click any text block in the preview to seamlessly edit it in-place. The text will
              perfectly match the original dimensions.
            </p>
            {opts.textReplacements.length > 0 && (
              <div className="rounded-xl border bg-muted/30 p-4">
                <h3 className="mb-2 text-sm font-medium">
                  Pending Edits ({opts.textReplacements.length})
                </h3>
                <ul className="space-y-2 text-xs">
                  {opts.textReplacements.map((r, i) => (
                    <li key={i} className="flex flex-col gap-1 rounded border bg-background p-2">
                      <span className="truncate font-medium text-muted-foreground line-through decoration-destructive">
                        {r.originalText}
                      </span>
                      <span className="truncate font-medium text-emerald-600">{r.newText}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      }
      case "compare-pdf":
        return (
          <p className="text-sm text-muted-foreground">
            Upload two PDFs. Both will be rendered as images for side-by-side comparison.
          </p>
        );
      case "pdf-to-jpg":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Quality — {opts.jpgQuality}%</Label>
              <Slider
                value={[opts.jpgQuality]}
                min={10}
                max={100}
                step={5}
                onValueChange={([v]) => set("jpgQuality", v ?? 92)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Each page is rendered at 2× resolution and exported as a JPG.
            </p>
          </div>
        );
      case "word-to-pdf":
        return (
          <p className="text-sm text-muted-foreground">
            Extracts text content from your DOCX and renders it into a clean PDF. Complex formatting
            and images may not be preserved.
          </p>
        );
      case "powerpoint-to-pdf":
        return (
          <p className="text-sm text-muted-foreground">
            Extracts slide text from your PPTX and creates a PDF with one page per slide.
          </p>
        );
      case "excel-to-pdf":
        return (
          <p className="text-sm text-muted-foreground">
            Reads the first sheet of your XLSX and renders it as a table in a PDF.
          </p>
        );
      case "html-to-pdf":
        return (
          <p className="text-sm text-muted-foreground">
            Extracts text content from your HTML file and renders it into a PDF.
          </p>
        );
      case "pdf-to-word":
        return (
          <p className="text-sm text-muted-foreground">
            Extracts text from each page and creates an editable DOCX file.
          </p>
        );
      case "pdf-to-powerpoint":
        return (
          <p className="text-sm text-muted-foreground">
            Creates a PPTX with one slide per page, preserving the text content.
          </p>
        );
      case "pdf-to-excel":
        return (
          <p className="text-sm text-muted-foreground">
            Extracts text from each page into a spreadsheet with Page and Content columns.
          </p>
        );
      case "pdf-to-pdfa":
        return (
          <p className="text-sm text-muted-foreground">
            Re-saves your PDF with stripped metadata and archival conformance markers.
          </p>
        );
      case "repair-pdf":
        return (
          <p className="text-sm text-muted-foreground">
            Re-loads the PDF permissively and saves a clean copy. Fixes most minor corruption
            issues.
          </p>
        );
      case "ocr-pdf":
        return (
          <p className="text-sm text-muted-foreground">
            Re-processes the PDF to ensure existing text is preserved and searchable. For scanned
            documents, a full OCR engine would be needed.
          </p>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen">
      <IslandNav />
      <main className="mx-auto w-full max-w-5xl px-6 pt-28 md:pt-32">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="size-4" /> All tools
        </Link>

        <header className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
              <tool.icon className="size-6" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold sm:text-3xl">{tool.name}</h1>
              <p className="text-sm text-muted-foreground">{tool.blurb}</p>
            </div>
          </div>
        </header>

        {results ? (
          <div className="island mt-8 px-6 py-10 text-center">
            <h2 className="text-xl font-semibold">
              Done — {results.length} file{results.length > 1 ? "s" : ""} ready
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your file was processed locally. Download it before leaving this page.
            </p>
            <ul className="mx-auto mt-6 max-w-md space-y-2 text-left">
              {results.map((out) => (
                <li
                  key={out.name}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{out.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(out.blob.size)}</p>
                  </div>
                  <Button size="sm" className="shrink-0 rounded-full" onClick={() => download(out)}>
                    <Download className="size-4" /> Download
                  </Button>
                </li>
              ))}
            </ul>
            {results.length > 1 && (
              <Button variant="outline" className="mt-4 rounded-full" onClick={downloadAll}>
                <Download className="size-4" /> Download all
              </Button>
            )}
            <div className="mt-4">
              <Button
                variant="secondary"
                className="rounded-full"
                onClick={() => {
                  setResults(null);
                  setFiles([]);
                  setSelectedPages(new Set());
                  setPageOrder(null);
                }}
              >
                <RotateCcw className="size-4" /> Start new task
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              {slug === "edit-pdf" && files[0] ? (
                <div className="island p-4 md:p-6">
                  <PdfTextEditor
                    file={files[0]}
                    edits={opts.textReplacements}
                    onEdit={(newEdit) => {
                      if (!newEdit) return; // Note: removing is handled by passing newText === originalText
                      setOpts((prev) => {
                        const existingIdx = prev.textReplacements.findIndex(
                          (r) =>
                            r.pageIndex === newEdit.pageIndex &&
                            r.x === newEdit.x &&
                            r.y === newEdit.y,
                        );

                        const newReps = [...prev.textReplacements];
                        if (newEdit.newText === newEdit.originalText) {
                          if (existingIdx >= 0) newReps.splice(existingIdx, 1);
                        } else {
                          if (existingIdx >= 0) newReps[existingIdx] = newEdit;
                          else newReps.push(newEdit);
                        }
                        return { ...prev, textReplacements: newReps };
                      });
                    }}
                  />
                </div>
              ) : (
                <>
                  <div className="island p-4 md:p-6">
                    <DropZone
                      accepts={tool.accepts}
                      multiple={tool.multiple}
                      files={files}
                      onChange={(f) => {
                        setFiles(f);
                        setError(null);
                        setSelectedPages(new Set());
                      }}
                      label={tool.multiple ? "Drop your files here" : "Drop your file here"}
                    />
                  </div>

                  {/* Real-time PDF Preview */}
                  {showPreview && files[0] && (
                    <div className="island p-4 md:p-6">
                      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                        Page Preview
                      </h3>
                      <PdfPreview
                        file={files[0]}
                        selectedPages={
                          slug === "remove-pages" || slug === "extract-pages"
                            ? selectedPages
                            : undefined
                        }
                        selectionMode={slug === "remove-pages" ? "remove" : "keep"}
                        onPageClick={
                          slug === "remove-pages" || slug === "extract-pages"
                            ? togglePage
                            : undefined
                        }
                        rotationAngle={slug === "rotate-pdf" ? opts.angle : 0}
                        draggable={slug === "organize-pages"}
                        pageOrder={slug === "organize-pages" ? (pageOrder ?? undefined) : undefined}
                        onReorder={slug === "organize-pages" ? setPageOrder : undefined}
                        cropMargins={
                          slug === "crop-pdf"
                            ? {
                                top: opts.cropTop,
                                right: opts.cropRight,
                                bottom: opts.cropBottom,
                                left: opts.cropLeft,
                              }
                            : undefined
                        }
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <aside className="island h-fit space-y-5 p-6 lg:sticky lg:top-28">
              <h2 className="text-lg font-semibold">Options</h2>
              {optionsPanel()}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                className="w-full rounded-full"
                size="lg"
                disabled={files.length === 0 || busy}
                onClick={run}
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Processing…
                  </>
                ) : (
                  <>
                    {tool.name} <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Free tier: up to 25 MB per file.
              </p>
            </aside>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
