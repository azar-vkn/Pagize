import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowLeft,
  Download,
  Loader2,
  RotateCcw,
  Type,
  Palette,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IslandNav } from "@/components/IslandNav";
import { SiteFooter } from "@/components/SiteFooter";
import { DropZone, formatBytes } from "@/components/DropZone";
import { ImagePreview } from "@/components/ImagePreview";
import { SITE_URL } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CropViewer } from "@/components/CropViewer";
import { SignaturePlacer } from "@/components/SignaturePlacer";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import JSZip from "jszip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getTool } from "@/lib/tools";
import { track, totalBytes } from "@/lib/analytics";
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
  parsePageRanges,
} from "@/lib/pdf-ops";
import { getPageDimensions } from "@/lib/pdf-renderer";
import type { TextItemPosition } from "@/lib/pdf-renderer";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getSeoData } from "@/lib/seo-data";

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
  head: ({ loaderData, params }) => {
    const seo = getSeoData(params.slug);
    const url = `${SITE_URL}/tools/${params.slug}`;

    // Generate Structured Data
    const breadcrumbSchema = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "PDF Tools", item: `${SITE_URL}/#tools` },
        { "@type": "ListItem", position: 3, name: loaderData?.name ?? "Tool", item: url },
      ],
    };

    const faqSchema =
      seo.faqs.length > 0
        ? {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: seo.faqs.map((faq) => ({
              "@type": "Question",
              name: faq.q,
              acceptedAnswer: {
                "@type": "Answer",
                text: faq.a,
              },
            })),
          }
        : null;

    const webAppSchema = {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: loaderData?.name ?? "PDF Tool",
      applicationCategory: "BrowserApplication",
      operatingSystem: "All",
      description: seo.seoDescription,
      url: url,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    };

    const schemas = [breadcrumbSchema, webAppSchema, faqSchema].filter(Boolean);

    return {
      meta: [
        { title: seo.seoTitle },
        { name: "description", content: seo.seoDescription },
        { property: "og:title", content: seo.seoTitle },
        { property: "og:description", content: seo.seoDescription },
        { property: "og:url", content: url },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: seo.seoTitle },
        { name: "twitter:description", content: seo.seoDescription },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: schemas.map((schema) => ({
        type: "application/ld+json",
        children: JSON.stringify(schema),
      })),
    };
  },
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
  pageCrops: Record<number, { top: number; right: number; bottom: number; left: number }>;
  // Protect
  userPassword: string;
  ownerPassword: string;
  // Sign
  signatureDataUrl: string;
  signPage: number;
  /** Per-page signature placements (top-left rect in PDF points). A page is
   *  signed only if it has an entry here, so each page can have its own spot. */
  signPlacements: Record<number, { x: number; y: number; width: number; height: number }>;
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
  pageCrops: {},
  userPassword: "",
  ownerPassword: "",
  signatureDataUrl: "",
  signPage: 0,
  signPlacements: {},
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

/** Starting rectangle (top-left, PDF points) for a newly signed page. */
const DEFAULT_SIGN_RECT = { x: 50, y: 700, width: 150, height: 50 };

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

// Preview eligibility is derived from what a tool accepts rather than kept as a
// hand-maintained list, so a newly added tool gets a preview automatically.

function ToolPage() {
  const { checkUsageLimit, session } = useAuth();
  const { slug } = Route.useParams();
  const tool = getTool(slug)!;
  const [files, setFiles] = useState<File[]>([]);
  const [pages, setPages] = useState<number | null>(null);
  const [opts, setOpts] = useState<Options>(defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<OutputFile[] | null>(null);
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [cropPreviewPage, setCropPreviewPage] = useState(0);
  // For organize / reorder
  const [pageOrder, setPageOrder] = useState<number[] | null>(null);

  const [batchMode, setBatchMode] = useState(false);
  const [batchProgress, setBatchProgress] = useState<
    Record<string, "queued" | "processing" | "done" | "failed">
  >({});

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
    setPageDimensions(null);
    setCropPreviewPage(0);
    setOpts(defaults);
    track("tool_opened", { tool: slug, category: tool.category });
  }, [slug, tool.category]);

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

    if (slug === "crop-pdf" || slug === "sign-pdf") {
      const previewPage = slug === "sign-pdf" ? opts.signPage : cropPreviewPage;
      getPageDimensions(first, previewPage)
        .then((dims) => {
          if (active) setPageDimensions(dims);
        })
        .catch(console.error);
    }

    return () => {
      active = false;
    };
  }, [files, tool.accepts, slug, cropPreviewPage, opts.signPage]);

  const selectedPages = useMemo(() => {
    if (!opts.ranges.trim() || !pages) return new Set<number>();
    return new Set(parsePageRanges(opts.ranges, pages));
  }, [opts.ranges, pages]);

  /**
   * Tools where clicking a thumbnail toggles that page in and out of
   * `opts.ranges`. Split only takes a page selection in "by ranges" mode —
   * "every page" splits the whole document and needs no input.
   */
  const pageSelectionEnabled =
    slug === "remove-pages" ||
    slug === "extract-pages" ||
    slug === "rotate-pdf" ||
    (slug === "split-pdf" && opts.splitMode === "ranges");

  const togglePage = useCallback(
    (pageIdx: number) => {
      if (!pages) return;
      const current = new Set(parsePageRanges(opts.ranges, pages));
      if (current.has(pageIdx)) current.delete(pageIdx);
      else current.add(pageIdx);

      const newRanges = Array.from(current)
        .map((p) => p + 1)
        .sort((a, b) => a - b)
        .join(",");

      setOpts((prev) => ({ ...prev, ranges: newRanges }));
    },
    [opts.ranges, pages],
  );

  const handlePageClick = (pageIdx: number) => {
    if (pageSelectionEnabled) {
      togglePage(pageIdx);
    } else if (slug === "crop-pdf") {
      setCropPreviewPage(pageIdx);
    }
  };

  // Signature drawing handlers. Pointer coordinates are in CSS pixels, so they
  // must be scaled to the canvas's internal buffer or strokes drift and lag.
  const sigPoint = (e: React.PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    const { x, y } = sigPoint(e, canvas);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = sigPoint(e, canvas);
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000";
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endDraw = () => {
    if (!isDrawing) return;
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
    if (!checkUsageLimit()) {
      return;
    }

    if (batchMode && files.length > 0) {
      const isPaid = !!session; // Assuming session means paid/authenticated for now
      const maxFiles = isPaid ? 50 : 3;
      if (files.length > maxFiles) {
        setError(
          `Batch limit exceeded. Free tier max is 3, Paid tier max is 50. You uploaded ${files.length}.`,
        );
        return;
      }

      setBusy(true);
      setError(null);

      const initialProgress: Record<string, "queued" | "processing" | "done" | "failed"> = {};
      files.forEach((f) => {
        initialProgress[f.name] = "queued";
      });
      setBatchProgress(initialProgress);

      const batchStartedAt = performance.now();
      track("tool_run", {
        tool: slug,
        file_count: files.length,
        total_bytes: totalBytes(files),
        batch: true,
      });

      const runSingleFile = async (file: File): Promise<OutputFile[]> => {
        let out: OutputFile[] = [];
        switch (slug) {
          case "split-pdf":
            out = await splitPdf(file, opts.splitMode, opts.ranges);
            break;
          case "remove-pages":
            out = await selectPages(file, opts.ranges, "remove");
            break;
          case "extract-pages":
            out = await selectPages(file, opts.ranges, "keep");
            break;
          case "rotate-pdf":
            out = await rotatePdf(file, opts.angle, opts.ranges);
            break;
          case "word-to-pdf":
            out = await (await getPdfConvertOps()).wordToPdf(file);
            break;
          case "powerpoint-to-pdf":
            out = await (await getPdfConvertOps()).powerpointToPdf(file);
            break;
          case "excel-to-pdf":
            out = await (await getPdfConvertOps()).excelToPdf(file);
            break;
          case "html-to-pdf":
            out = await (await getPdfConvertOps()).htmlToPdf(file);
            break;
          case "pdf-to-jpg":
            out = await (await getPdfConvertOps()).pdfToJpg(file, opts.jpgQuality / 100);
            break;
          case "pdf-to-word":
            out = await (await getPdfConvertOps()).pdfToWord(file);
            break;
          case "pdf-to-powerpoint":
            out = await (await getPdfConvertOps()).pdfToPowerpoint(file);
            break;
          case "pdf-to-excel":
            out = await (await getPdfConvertOps()).pdfToExcel(file);
            break;
          case "pdf-to-pdfa":
            out = await pdfToPdfa(file);
            break;
          case "add-page-numbers":
            out = await addPageNumbers(file, opts.position, opts.startAt);
            break;
          case "watermark-pdf":
            out = await watermarkPdf(file, opts.text, opts.opacity, opts.wmAngle, opts.wmSize);
            break;
          case "crop-pdf":
            out = await cropPdf(file, opts.pageCrops);
            break;
          case "protect-pdf":
            out = await protectPdf(file, opts.userPassword, opts.ownerPassword);
            break;
          case "unlock-pdf":
            out = await unlockPdf(file);
            break;
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
            throw new Error("This tool isn't available for batch mode.");
        }
        return out;
      };

      const MAX_CONCURRENT = 2;
      let currentIndex = 0;
      let allOut: OutputFile[] = [];

      const processNext = async () => {
        if (currentIndex >= files.length) return;
        const i = currentIndex++;
        const file = files[i]!;

        setBatchProgress((p) => ({ ...p, [file.name]: "processing" }));
        try {
          const res = await runSingleFile(file);
          allOut = allOut.concat(res);
          setBatchProgress((p) => ({ ...p, [file.name]: "done" }));
        } catch (e) {
          console.error(e);
          setBatchProgress((p) => ({ ...p, [file.name]: "failed" }));
        }
        await processNext();
      };

      const workers = Array.from({ length: Math.min(MAX_CONCURRENT, files.length) }).map(() =>
        processNext(),
      );
      await Promise.all(workers);

      setResults(allOut);
      track(allOut.length > 0 ? "tool_success" : "tool_error", {
        tool: slug,
        ms: Math.round(performance.now() - batchStartedAt),
        output_count: allOut.length,
        batch: true,
      });
      setBusy(false);
      return;
    }

    setBusy(true);
    setError(null);
    const startedAt = performance.now();
    track("tool_run", {
      tool: slug,
      file_count: files.length,
      total_bytes: totalBytes(files),
      batch: false,
    });
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
          if (!opts.ranges) throw new Error("Select pages to remove.");
          out = await selectPages(file, opts.ranges, "remove");
          break;
        }
        case "extract-pages": {
          if (!opts.ranges) throw new Error("Select pages to extract.");
          out = await selectPages(file, opts.ranges, "keep");
          break;
        }
        case "rotate-pdf": {
          out = await rotatePdf(file, opts.angle, opts.ranges);
          break;
        }
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
          out = await cropPdf(file, opts.pageCrops);
          break;
        case "protect-pdf":
          out = await protectPdf(file, opts.userPassword, opts.ownerPassword);
          break;
        case "unlock-pdf":
          out = await unlockPdf(file);
          break;
        case "sign-pdf": {
          if (!opts.signatureDataUrl) throw new Error("Draw or upload a signature first.");
          const placements = Object.entries(opts.signPlacements).map(([page, rect]) => ({
            page: Number(page),
            ...rect,
          }));
          if (placements.length === 0)
            throw new Error("Place your signature on at least one page.");
          out = await signPdf(file, opts.signatureDataUrl, placements);
          break;
        }
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
      track("tool_success", {
        tool: slug,
        ms: Math.round(performance.now() - startedAt),
        output_count: out.length,
        batch: false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong with that file.");
      track("tool_error", {
        tool: slug,
        message: (e instanceof Error ? e.message : "unknown").slice(0, 100),
      });
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
    track("output_downloaded", { tool: slug });
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

  // A tool taking PDFs previews its pages; one taking images previews the
  // images that are about to become pages. Everything else (.docx, .pptx,
  // .xlsx, .html) has no client-side page representation of its input, so it
  // relies on the result preview shown after processing instead.
  const acceptsPdf = tool.accepts.includes("application/pdf");
  const acceptsImages = tool.accepts.includes("image/");
  const showPreview = (acceptsPdf || acceptsImages) && files.length > 0 && !results;

  /** First PDF among the outputs, previewed once processing finishes. */
  const resultPreviewFile = useMemo(() => {
    const pdf = results?.find((out) => out.name.toLowerCase().endsWith(".pdf"));
    return pdf ? new File([pdf.blob], pdf.name, { type: "application/pdf" }) : null;
  }, [results]);

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
            {opts.splitMode === "ranges" ? (
              <>
                {rangeField("Each comma-separated group becomes its own file.")}
                {selectedPages.size > 0 && (
                  <p className="text-sm font-medium text-emerald-600">
                    {selectedPages.size} page{selectedPages.size > 1 ? "s" : ""} selected
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Click page thumbnails to select/deselect pages.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Every page becomes its own file
                {pages ? ` — ${pages} file${pages > 1 ? "s" : ""}` : ""}.
              </p>
            )}
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
                  { value: 0, label: "Default" },
                  { value: 90, label: "90°" },
                  { value: 180, label: "180°" },
                  { value: 270, label: "270°" },
                ]}
              />
            </div>
            <div className="space-y-4">
              {rangeField("Leave empty to rotate every page.")}
              {selectedPages.size > 0 && (
                <p className="text-sm font-medium text-blue-600">
                  {selectedPages.size} page{selectedPages.size > 1 ? "s" : ""} selected for rotation
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Click page thumbnails to select specific pages to rotate.
              </p>
            </div>
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
      case "crop-pdf": {
        const currentCrop = opts.pageCrops[cropPreviewPage] || {
          top: 20,
          right: 20,
          bottom: 20,
          left: 20,
        };
        const setCrop = (key: "top" | "right" | "bottom" | "left", val: number) => {
          setOpts((prev) => ({
            ...prev,
            pageCrops: {
              ...prev.pageCrops,
              [cropPreviewPage]: { ...currentCrop, [key]: val },
            },
          }));
        };

        const applyToAll = () => {
          if (!pages) return;
          const newCrops: typeof opts.pageCrops = {};
          for (let i = 0; i < pages; i++) {
            newCrops[i] = currentCrop;
          }
          setOpts((prev) => ({ ...prev, pageCrops: newCrops }));
        };

        return (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Set margins in points (72 pt = 1 inch) for page {cropPreviewPage + 1}.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="cropTop">Top</Label>
                <Input
                  id="cropTop"
                  type="number"
                  min={0}
                  value={currentCrop.top}
                  onChange={(e) => setCrop("top", Number(e.target.value))}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cropBottom">Bottom</Label>
                <Input
                  id="cropBottom"
                  type="number"
                  min={0}
                  value={currentCrop.bottom}
                  onChange={(e) => setCrop("bottom", Number(e.target.value))}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cropLeft">Left</Label>
                <Input
                  id="cropLeft"
                  type="number"
                  min={0}
                  value={currentCrop.left}
                  onChange={(e) => setCrop("left", Number(e.target.value))}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cropRight">Right</Label>
                <Input
                  id="cropRight"
                  type="number"
                  min={0}
                  value={currentCrop.right}
                  onChange={(e) => setCrop("right", Number(e.target.value))}
                  className="rounded-xl"
                />
              </div>
            </div>
            <Button variant="secondary" className="w-full rounded-xl" onClick={applyToAll}>
              Apply to all pages
            </Button>
          </div>
        );
      }
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
                  width={600}
                  height={200}
                  className="h-32 w-full cursor-crosshair touch-none rounded-lg"
                  onPointerDown={startDraw}
                  onPointerMove={draw}
                  onPointerUp={endDraw}
                  onPointerLeave={endDraw}
                  onPointerCancel={endDraw}
                />
              </div>
              <Button variant="ghost" size="sm" onClick={clearSignature} className="text-xs">
                Clear signature
              </Button>
            </div>

            {files.length > 0 && (
              <div className="space-y-2">
                <Label>Quick actions</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="rounded-xl"
                    onClick={() =>
                      setOpts((prev) => {
                        const base = prev.signPlacements[prev.signPage] ?? DEFAULT_SIGN_RECT;
                        const next: Options["signPlacements"] = {};
                        for (let i = 0; i < (pages ?? 1); i++) next[i] = { ...base };
                        return { ...prev, signPlacements: next };
                      })
                    }
                  >
                    Sign all pages (this position)
                  </Button>
                  {Object.keys(opts.signPlacements).length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => set("signPlacements", {})}
                    >
                      Clear all
                    </Button>
                  )}
                </div>
              </div>
            )}

            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              {files.length === 0
                ? "Upload a PDF, then use “Sign this page” on the preview and drag the box to place your signature. Each page can have its own position."
                : "On the preview, turn on “Sign this page” and drag the box to position your signature. Navigate pages to place it differently on each — or use “Sign all pages” to stamp the current position everywhere."}
            </p>
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
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "PDF Tools", href: "/#tools" },
            { label: tool.name },
          ]}
        />

        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:justify-between">
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
            {resultPreviewFile && (
              <div className="mx-auto mt-8 max-w-3xl text-left">
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                  Page Preview
                  {results.length > 1 ? ` — ${resultPreviewFile.name}` : ""}
                </h3>
                <Suspense
                  fallback={
                    <div className="flex justify-center py-8">
                      <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    </div>
                  }
                >
                  <PdfPreview file={resultPreviewFile} />
                </Suspense>
              </div>
            )}
            {results.length > 1 && (
              <Button
                variant="outline"
                className="mt-4 rounded-full"
                onClick={async () => {
                  if (batchMode) {
                    const zip = new JSZip();
                    for (const out of results) {
                      zip.file(out.name, out.blob);
                    }
                    const content = await zip.generateAsync({ type: "blob" });
                    const url = URL.createObjectURL(content);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `batch-results-${Date.now()}.zip`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } else {
                    downloadAll();
                  }
                }}
              >
                <Download className="size-4" /> Download all {batchMode ? "as ZIP" : ""}
              </Button>
            )}
            <div className="mt-4">
              <Button
                variant="secondary"
                className="rounded-full"
                onClick={() => {
                  setResults(null);
                  setFiles([]);
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
                    {!tool.multiple && (
                      <div className="flex items-center justify-between mb-4 rounded-xl bg-accent p-3">
                        <div className="space-y-0.5">
                          <Label htmlFor="batch-mode" className="text-sm font-medium">
                            Batch Mode
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Process multiple files at once
                          </p>
                        </div>
                        <Switch
                          id="batch-mode"
                          checked={batchMode}
                          onCheckedChange={setBatchMode}
                        />
                      </div>
                    )}
                    <DropZone
                      accepts={tool.accepts}
                      multiple={tool.multiple || batchMode}
                      files={files}
                      onChange={(f) => {
                        setFiles(f);
                        setError(null);
                      }}
                      label={
                        tool.multiple || batchMode ? "Drop your files here" : "Drop your file here"
                      }
                    />

                    {batchMode && files.length > 0 && Object.keys(batchProgress).length > 0 && (
                      <div className="mt-4 space-y-2">
                        <h4 className="text-sm font-semibold">Batch Progress</h4>
                        <ul className="space-y-1 text-sm">
                          {files.map((f) => (
                            <li key={f.name} className="flex justify-between border-b pb-1">
                              <span className="truncate w-3/4">{f.name}</span>
                              <span
                                className={cn(
                                  "capitalize text-xs font-medium",
                                  batchProgress[f.name] === "done"
                                    ? "text-emerald-600"
                                    : batchProgress[f.name] === "failed"
                                      ? "text-destructive"
                                      : batchProgress[f.name] === "processing"
                                        ? "text-blue-600"
                                        : "text-muted-foreground",
                                )}
                              >
                                {batchProgress[f.name]}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Real-time PDF Preview */}
                  {showPreview && files[0] && (
                    <div className="island p-4 md:p-6">
                      <h3 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center justify-between">
                        <span>Page Preview</span>
                        {slug === "crop-pdf" && pages && pages > 1 && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              disabled={cropPreviewPage === 0}
                              onClick={() => setCropPreviewPage((p) => Math.max(0, p - 1))}
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className="text-xs font-medium w-16 text-center">
                              {cropPreviewPage + 1} / {pages}
                            </span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              disabled={cropPreviewPage === pages - 1}
                              onClick={() => setCropPreviewPage((p) => Math.min(pages - 1, p + 1))}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </h3>
                      {!acceptsPdf ? (
                        // Image inputs: showPreview guarantees images here.
                        <ImagePreview files={files} />
                      ) : slug === "crop-pdf" ? (
                        <div className="space-y-6">
                          <CropViewer
                            file={files[0]}
                            pageIndex={cropPreviewPage}
                            pageDimensions={pageDimensions}
                            cropMargins={
                              opts.pageCrops[cropPreviewPage] || {
                                top: 20,
                                right: 20,
                                bottom: 20,
                                left: 20,
                              }
                            }
                            onCropChange={(margins) => {
                              setOpts((prev) => ({
                                ...prev,
                                pageCrops: {
                                  ...prev.pageCrops,
                                  [cropPreviewPage]: {
                                    top: Math.round(margins.top),
                                    right: Math.round(margins.right),
                                    bottom: Math.round(margins.bottom),
                                    left: Math.round(margins.left),
                                  },
                                },
                              }));
                            }}
                          />
                          <div className="space-y-3 border-t pt-4">
                            <h4 className="text-sm font-semibold">Select pages to crop</h4>
                            <PdfPreview
                              file={files[0]}
                              selectedPages={new Set([cropPreviewPage])}
                              selectionMode="keep"
                              onPageClick={handlePageClick}
                              pageCrops={opts.pageCrops}
                              pageDimensions={pageDimensions ?? undefined}
                            />
                          </div>
                        </div>
                      ) : slug === "sign-pdf" ? (
                        <SignaturePlacer
                          file={files[0]}
                          pageIndex={opts.signPage}
                          pageCount={pages ?? 1}
                          pageDimensions={pageDimensions}
                          signatureUrl={opts.signatureDataUrl}
                          rect={opts.signPlacements[opts.signPage] ?? null}
                          signedPages={Object.keys(opts.signPlacements)
                            .map(Number)
                            .sort((a, b) => a - b)}
                          onChange={(r) =>
                            setOpts((prev) => ({
                              ...prev,
                              signPlacements: {
                                ...prev.signPlacements,
                                [prev.signPage]: {
                                  x: Math.round(r.x),
                                  y: Math.round(r.y),
                                  width: Math.round(r.width),
                                  height: Math.round(r.height),
                                },
                              },
                            }))
                          }
                          onToggle={(enabled) =>
                            setOpts((prev) => {
                              const next = { ...prev.signPlacements };
                              if (enabled)
                                next[prev.signPage] = next[prev.signPage] ?? {
                                  ...DEFAULT_SIGN_RECT,
                                };
                              else delete next[prev.signPage];
                              return { ...prev, signPlacements: next };
                            })
                          }
                          onPageChange={(p) => set("signPage", p)}
                        />
                      ) : (
                        <PdfPreview
                          file={files[0]}
                          selectedPages={pageSelectionEnabled ? selectedPages : undefined}
                          selectionMode={slug === "remove-pages" ? "remove" : "keep"}
                          onPageClick={pageSelectionEnabled ? handlePageClick : undefined}
                          rotationAngle={slug === "rotate-pdf" ? opts.angle : 0}
                          draggable={slug === "organize-pages"}
                          pageOrder={
                            slug === "organize-pages" ? (pageOrder ?? undefined) : undefined
                          }
                          onReorder={slug === "organize-pages" ? setPageOrder : undefined}
                        />
                      )}
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

        {/* SEO Content Section */}
        {(() => {
          const seo = getSeoData(slug);
          return (
            <article className="mt-16 border-t border-border pt-12 pb-24 space-y-12 max-w-3xl">
              <section>
                <h2 className="text-xl font-semibold mb-4">About the {tool.name} tool</h2>
                <div className="text-muted-foreground space-y-4 text-sm leading-relaxed">
                  {seo.seoIntro.split("\n\n").map((paragraph, idx) => (
                    <p key={idx}>{paragraph}</p>
                  ))}
                </div>
              </section>

              {seo.howTo.length > 0 && (
                <section>
                  <h2 className="text-xl font-semibold mb-6">How to {slug.split("-").join(" ")}</h2>
                  <ol className="space-y-4">
                    {seo.howTo.map((step, idx) => (
                      <li key={idx} className="flex gap-4">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                          {idx + 1}
                        </span>
                        <div>
                          <h3 className="font-semibold text-foreground">{step.title}</h3>
                          <p className="text-sm text-muted-foreground mt-1">{step.step}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              <section className="rounded-2xl bg-primary/5 p-6 border border-primary/10">
                <h2 className="text-lg font-semibold text-primary mb-3">Why use Pagize?</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Pagize is designed to process supported documents directly in your browser. This
                  means your files remain securely on your device and are never unnecessarily
                  uploaded to a processing server. Experience blazing fast speeds and total privacy
                  for your sensitive documents.
                </p>
              </section>

              {seo.faqs.length > 0 && (
                <section>
                  <h2 className="text-xl font-semibold mb-6">Frequently Asked Questions</h2>
                  <div className="space-y-6">
                    {seo.faqs.map((faq, idx) => (
                      <div key={idx}>
                        <h3 className="font-semibold text-foreground">{faq.q}</h3>
                        <p className="text-sm text-muted-foreground mt-2">{faq.a}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {seo.relatedTools.length > 0 && (
                <section>
                  <h2 className="text-xl font-semibold mb-4">Related Tools</h2>
                  <div className="flex flex-wrap gap-3">
                    {seo.relatedTools.map((relatedSlug) => {
                      const relatedTool = getTool(relatedSlug);
                      if (!relatedTool) return null;
                      return (
                        <Link
                          key={relatedSlug}
                          to={`/tools/$slug`}
                          params={{ slug: relatedSlug }}
                          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                        >
                          <relatedTool.icon className="h-4 w-4" />
                          {relatedTool.name}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              )}
            </article>
          );
        })()}
      </main>
      <SiteFooter />
    </div>
  );
}
