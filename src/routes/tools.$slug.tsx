import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, ArrowLeft, Download, Loader2, RotateCcw, Construction } from "lucide-react";
import { useEffect, useState } from "react";
import { IslandNav } from "@/components/IslandNav";
import { SiteFooter } from "@/components/SiteFooter";
import { DropZone, formatBytes } from "@/components/DropZone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { getTool, tools } from "@/lib/tools";
import {
  addPageNumbers,
  compressPdf,
  imagesToPdf,
  mergePdfs,
  pageCountOf,
  rotatePdf,
  selectPages,
  splitPdf,
  watermarkPdf,
  type NumberPosition,
  type OutputFile,
} from "@/lib/pdf-ops";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tools/$slug")({
  loader: ({ params }) => {
    const tool = getTool(params.slug);
    if (!tool) throw notFound();
    return { name: tool.name, blurb: tool.blurb };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.name ?? "PDF tool"} — PaperKit` },
      { name: "description", content: loaderData?.blurb ?? "Browser-based PDF tools." },
      { property: "og:title", content: `${loaderData?.name ?? "PDF tool"} — PaperKit` },
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

function ToolPage() {
  const { slug } = Route.useParams();
  const tool = getTool(slug)!;
  const [files, setFiles] = useState<File[]>([]);
  const [pages, setPages] = useState<number | null>(null);
  const [opts, setOpts] = useState<Options>(defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<OutputFile[] | null>(null);

  const set = <K extends keyof Options>(key: K, value: Options[K]) =>
    setOpts((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    setFiles([]);
    setResults(null);
    setError(null);
    setPages(null);
  }, [slug]);

  useEffect(() => {
    const first = files[0];
    if (!first || tool.accepts !== "application/pdf") {
      setPages(null);
      return;
    }
    let active = true;
    pageCountOf(first)
      .then((n) => active && setPages(n))
      .catch(() => active && setPages(null));
    return () => {
      active = false;
    };
  }, [files, tool.accepts]);

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
        case "remove-pages":
          out = await selectPages(file, opts.ranges, "remove");
          break;
        case "extract-pages":
          out = await selectPages(file, opts.ranges, "keep");
          break;
        case "rotate-pdf":
          out = await rotatePdf(file, opts.angle, opts.ranges);
          break;
        case "jpg-to-pdf":
          out = await imagesToPdf(files);
          break;
        case "add-page-numbers":
          out = await addPageNumbers(file, opts.position, opts.startAt);
          break;
        case "watermark-pdf":
          out = await watermarkPdf(file, opts.text, opts.opacity, opts.wmAngle, opts.wmSize);
          break;
        case "compress-pdf":
          out = await compressPdf(file, opts.level);
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
        return rangeField("These pages will be deleted.");
      case "extract-pages":
        return rangeField("Only these pages are kept, in order.");
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
              Rebuilds the document and strips metadata. Original: {files[0] ? formatBytes(files[0].size) : "—"}
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
        return (
          <p className="text-sm text-muted-foreground">
            Each JPG or PNG becomes one page sized to the image.
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

        {!tool.ready ? (
          <div className="island mt-8 flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-foreground">
              <Construction className="size-6" />
            </span>
            <h2 className="text-lg font-semibold">This tool is on the way</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {tool.name} needs server-side rendering engines, which land in the next release. In
              the meantime, these tools already work end-to-end:
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {tools
                .filter((t) => t.ready)
                .map((t) => (
                  <Link key={t.slug} to="/tools/$slug" params={{ slug: t.slug }}>
                    <Button variant="secondary" className="rounded-full">
                      <t.icon className="size-4" /> {t.name}
                    </Button>
                  </Link>
                ))}
            </div>
          </div>
        ) : results ? (
          <div className="island mt-8 px-6 py-10 text-center">
            <h2 className="text-xl font-semibold">Done — {results.length} file ready</h2>
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
            <Button
              variant="secondary"
              className="mt-6 rounded-full"
              onClick={() => {
                setResults(null);
                setFiles([]);
              }}
            >
              <RotateCcw className="size-4" /> Start new task
            </Button>
          </div>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="island p-4 md:p-6">
              <DropZone
                accepts={tool.accepts}
                multiple={tool.multiple}
                files={files}
                onChange={(f) => {
                  setFiles(f);
                  setError(null);
                }}
                label={tool.multiple ? "Drop your files here" : "Drop your file here"}
              />
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