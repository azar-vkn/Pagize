import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, LayoutTemplate } from "lucide-react";
import { useMemo, useState } from "react";
import { IslandNav } from "@/components/IslandNav";
import { SiteFooter } from "@/components/SiteFooter";
import { Input } from "@/components/ui/input";
import { templates } from "@/lib/templates-data";

export const Route = createFileRoute("/templates/")({
  head: () => ({
    meta: [
      { title: "Templates — Pagize" },
      {
        name: "description",
        content: "Create professional documents instantly with our PDF templates.",
      },
    ],
  }),
  component: TemplatesIndex,
});

function TemplatesIndex() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
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
            <LayoutTemplate className="size-3.5 text-primary" /> Ready to use forms
          </span>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.05] md:text-6xl">
            Beautiful PDF templates,<br />
            <span className="text-primary">filled out in seconds.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
            Choose a template, fill out the form, and get a professional PDF instantly.
          </p>

          <div className="mx-auto mt-8 max-w-xl">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search templates — invoice, resume, nda…"
                className="h-12 rounded-full border-border bg-card pl-11 shadow-island"
              />
            </div>
          </div>
        </section>

        <section className="mt-16 scroll-mt-28">
          <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold">All Templates</h2>
              <p className="text-sm text-muted-foreground">Select a template to start filling it out.</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {filtered.length} templates
            </span>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((template) => (
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
                  <p className="flex items-center gap-2 font-semibold">
                    <span className="truncate">{template.name}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{template.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {filtered.length === 0 && (
          <p className="mt-16 text-center text-sm text-muted-foreground">
            No templates match “{query}”.
          </p>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
