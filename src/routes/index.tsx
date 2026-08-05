import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Search, ShieldCheck, Zap, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { IslandNav } from "@/components/IslandNav";
import { SiteFooter } from "@/components/SiteFooter";
import { DropZone } from "@/components/DropZone";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { categories, tools } from "@/lib/tools";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PaperKit — Free Browser PDF Tools" },
      {
        name: "description",
        content:
          "Merge, split, compress, rotate, watermark and convert PDFs right in your browser. No uploads, no waiting, no sign-up.",
      },
      { property: "og:title", content: "PaperKit — Free Browser PDF Tools" },
      {
        property: "og:description",
        content: "Merge, split, compress and convert PDFs privately in your browser.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (t) => t.name.toLowerCase().includes(q) || t.blurb.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="min-h-screen">
      <IslandNav />

      <main className="mx-auto w-full max-w-6xl px-6 pt-28 md:pt-32">
        <section className="text-center">
          <span className="island inline-flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" /> Runs locally — your files stay yours
          </span>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.05] md:text-6xl">
            Every PDF tool you need,
            <br />
            <span className="text-primary">one warm little toolbox.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
            Drop a file and pick a tool. Merging, splitting, compressing and converting happen
            instantly in your browser.
          </p>

          <div className="mx-auto mt-8 max-w-xl">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tools — merge, compress, watermark…"
                className="h-12 rounded-full border-border bg-card pl-11 shadow-island"
              />
            </div>
          </div>
        </section>

        <section className="island mt-10 p-4 md:p-6">
          <DropZone
            accepts="application/pdf,image/jpeg,image/png"
            multiple
            files={files}
            onChange={setFiles}
            label="Drop PDFs or images to get started"
          />
          {files.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {tools
                .filter((t) => t.ready)
                .slice(0, 5)
                .map((t) => (
                  <Button
                    key={t.slug}
                    variant="secondary"
                    className="rounded-full"
                    onClick={() => navigate({ to: "/tools/$slug", params: { slug: t.slug } })}
                  >
                    <t.icon className="size-4" /> {t.name}
                  </Button>
                ))}
            </div>
          )}
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { icon: Zap, title: "Instant", body: "No queues or uploads — processing starts on drop." },
            { icon: ShieldCheck, title: "Private", body: "Files are handled locally and never stored." },
            { icon: Sparkles, title: "Free tier", body: "Core tools free; batch and API on Pro." },
          ].map((f) => (
            <div key={f.title} className="island flex items-start gap-3 px-5 py-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                <f.icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="text-sm text-muted-foreground">{f.body}</p>
              </div>
            </div>
          ))}
        </section>

        {categories.map((cat) => {
          const catTools = filtered.filter((t) => t.category === cat.id);
          if (catTools.length === 0) return null;
          return (
            <section key={cat.id} id={cat.id} className="mt-16 scroll-mt-28">
              <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
                <div className="min-w-0">
                  <h2 className="text-2xl font-semibold">{cat.label}</h2>
                  <p className="text-sm text-muted-foreground">{cat.description}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {catTools.length} tools
                </span>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {catTools.map((tool) => (
                  <Link
                    key={tool.slug}
                    to="/tools/$slug"
                    params={{ slug: tool.slug }}
                    className="island group flex items-start gap-4 p-5 transition-all hover:-translate-y-0.5 hover:shadow-island-hover"
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <tool.icon className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-semibold">
                        <span className="truncate">{tool.name}</span>
                        {!tool.ready && (
                          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
                            soon
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{tool.blurb}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        {filtered.length === 0 && (
          <p className="mt-16 text-center text-sm text-muted-foreground">
            No tools match “{query}”.
          </p>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
