import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { IslandNav } from "@/components/IslandNav";
import { SiteFooter } from "@/components/SiteFooter";
import { Input } from "@/components/ui/input";
import { categories, tools } from "@/lib/tools";
import { templates } from "@/lib/templates-data";
import { SITE_URL } from "@/lib/site";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pagize — Simple PDF & Document Tools" },
      {
        name: "description",
        content:
          "Fast, privacy-conscious PDF and document tools designed to work directly in your browser. Merge, split, compress, and convert without uploading files to a server.",
      },
      { property: "og:title", content: "Pagize — Simple PDF & Document Tools" },
      {
        property: "og:description",
        content: "Fast, privacy-conscious PDF and document tools designed to work directly in your browser.",
      },
      { property: "og:url", content: SITE_URL },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Pagize — Simple PDF & Document Tools" },
      { name: "twitter:description", content: "Fast, privacy-conscious PDF tools." },
    ],
    links: [
      { rel: "canonical", href: SITE_URL }
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          "name": "Pagize",
          "url": SITE_URL,
          "potentialAction": {
            "@type": "SearchAction",
            "target": `${SITE_URL}/?q={search_term_string}`,
            "query-input": "required name=search_term_string"
          }
        })
      }
    ]
  }),
  component: Index,
});

function Index() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (t) => t.name.toLowerCase().includes(q) || t.blurb.toLowerCase().includes(q),
    );
  }, [query]);

  const filteredTemplates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
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
            Every PDF tool you need,<br />
            <span className="text-primary">one warm little toolbox.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
            Drop a file and pick a tool. Merging, splitting, compressing and converting happen instantly in your browser.
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

        {filteredTemplates.length > 0 && (
          <section id="templates" className="mt-16 scroll-mt-28">
            <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold">Templates</h2>
                <p className="text-sm text-muted-foreground">
                  Fill in a form and download a ready-made PDF.
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {filteredTemplates.length} templates
              </span>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredTemplates.map((template) => (
                <Link
                  key={template.id}
                  to="/templates/$slug"
                  params={{ slug: template.id }}
                  className="island group flex items-start gap-4 p-5 transition-all hover:-translate-y-0.5 hover:shadow-island-hover"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <template.icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{template.name}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{template.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {filtered.length === 0 && filteredTemplates.length === 0 && (
          <p className="mt-16 text-center text-sm text-muted-foreground">
            No tools match “{query}”.
          </p>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
