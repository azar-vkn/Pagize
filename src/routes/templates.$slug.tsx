import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, ChevronLeft, Download, RotateCcw, Loader2 } from "lucide-react";
import { useState, useEffect, Suspense, lazy } from "react";
import { IslandNav } from "@/components/IslandNav";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { formatBytes } from "@/components/DropZone";
import { templates } from "@/lib/templates-data";
import { SITE_URL } from "@/lib/site";
import { generateTemplatePdf, type OutputFile } from "@/lib/pdf-ops";
import { useAuth } from "@/hooks/useAuth";

const PdfPreview = lazy(() =>
  import("@/components/PdfPreview").then((m) => ({ default: m.PdfPreview })),
);

export const Route = createFileRoute("/templates/$slug")({
  // Only plain, serializable data may cross the SSR boundary. The full config
  // carries an `icon` component and would fail serialization, so the component
  // looks it up from the static list instead.
  loader: ({ params }) => {
    const template = templates.find((t) => t.id === params.slug);
    if (!template) throw notFound();
    return { name: template.name, description: template.description };
  },
  head: ({ loaderData, params }) => {
    const name = loaderData?.name ?? "Template";
    const title = `${name} Template — Free PDF Generator | Pagize`;
    const description =
      loaderData?.description ??
      "Fill in a form and download a clean, ready-to-use PDF. Everything runs in your browser.";
    const url = `${SITE_URL}/templates/${params.slug}`;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
              { "@type": "ListItem", position: 2, name: "Templates", item: `${SITE_URL}/templates` },
              { "@type": "ListItem", position: 3, name, item: url },
            ],
          }),
        },
      ],
    };
  },
  component: TemplatePage,
});

function TemplatePage() {
  const { slug } = Route.useParams();
  // Safe to assert: the loader throws notFound() for an unknown slug.
  const template = templates.find((t) => t.id === slug)!;
  const { checkUsageLimit } = useAuth();
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [results, setResults] = useState<OutputFile | null>(null);
  const [busy, setBusy] = useState(false);

  // Initialize form data
  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const field of template.fields) {
      initial[field.name] = field.defaultValue || "";
    }
    setFormData(initial);
  }, [template]);

  // Debounced Live Preview Generation
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const out = await generateTemplatePdf(template.id, formData);
        const file = new File([out.blob], out.name, { type: "application/pdf" });
        setPreviewFile(file);
      } catch (e) {
        console.error("Preview generation failed", e);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [formData, template.id]);

  const handleChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleGenerate = async () => {
    if (!checkUsageLimit()) return;
    setBusy(true);
    try {
      const out = await generateTemplatePdf(template.id, formData);
      setResults(out);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!results) return;
    const url = URL.createObjectURL(results.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = results.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen">
      <IslandNav />
      <main className="mx-auto w-full max-w-7xl px-6 pt-28 md:pt-32">
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Templates", href: "/templates" },
            { label: template.name },
          ]}
        />

        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:justify-between mb-8">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
              <template.icon className="size-6" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold sm:text-3xl">{template.name}</h1>
              <p className="text-sm text-muted-foreground">{template.description}</p>
            </div>
          </div>
        </header>

        {results ? (
          <div className="island px-6 py-10 text-center">
            <h2 className="text-xl font-semibold">Done — Your template is ready</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your document was generated locally.
            </p>
            <div className="mx-auto mt-6 max-w-md">
              <div className="flex items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3">
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium">{results.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(results.blob.size)}</p>
                </div>
                <Button size="sm" className="shrink-0 rounded-full" onClick={download}>
                  <Download className="size-4" /> Download
                </Button>
              </div>
            </div>
            <div className="mt-4">
              <Button
                variant="secondary"
                className="rounded-full"
                onClick={() => {
                  setResults(null);
                }}
              >
                <RotateCcw className="size-4" /> Edit again
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
            <aside className="island h-fit space-y-6 p-6">
              <h2 className="text-lg font-semibold">Details</h2>
              <div className="space-y-4">
                {template.fields.map((field) => (
                  <div key={field.name} className="space-y-1.5">
                    <Label htmlFor={field.name}>{field.label}</Label>
                    {field.type === "textarea" ? (
                      <Textarea
                        id={field.name}
                        placeholder={field.placeholder}
                        value={formData[field.name] || ""}
                        onChange={(e) => handleChange(field.name, e.target.value)}
                        className="rounded-xl resize-none"
                        rows={4}
                      />
                    ) : (
                      <Input
                        id={field.name}
                        type={field.type}
                        placeholder={field.placeholder}
                        value={formData[field.name] || ""}
                        onChange={(e) => handleChange(field.name, e.target.value)}
                        className="rounded-xl"
                      />
                    )}
                  </div>
                ))}
              </div>
              <Button
                className="w-full rounded-full"
                size="lg"
                disabled={busy}
                onClick={handleGenerate}
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    Generate PDF <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </aside>

            <div className="island bg-accent/30 p-4 md:p-6 lg:sticky lg:top-28 lg:self-start lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto">
              <h3 className="mb-4 text-sm font-semibold text-muted-foreground">Live Preview</h3>
              {previewFile ? (
                <Suspense
                  fallback={
                    <div className="flex min-h-[600px] items-center justify-center">
                      <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    </div>
                  }
                >
                  <PdfPreview file={previewFile} variant="document" />
                </Suspense>
              ) : (
                <div className="flex min-h-[600px] items-center justify-center text-sm text-muted-foreground">
                  Generating preview...
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
