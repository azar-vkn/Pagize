import { Link } from "@tanstack/react-router";
import { categories } from "@/lib/tools";

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-6xl px-6 pb-28 pt-16 md:pb-16">
      <div className="island flex flex-col gap-4 px-6 py-6 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-muted-foreground">
          PaperKit — PDF tools that run in your browser. Files auto-clear when you close the tab.
        </p>
        <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {categories.map((c) => (
            <Link
              key={c.id}
              to="/"
              hash={c.id}
              className="text-muted-foreground transition-colors hover:text-primary"
            >
              {c.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}