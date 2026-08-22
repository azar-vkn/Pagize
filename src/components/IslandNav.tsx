import { Link } from "@tanstack/react-router";
import { FileStack, LayoutTemplate } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { navTools } from "@/lib/tools";
import { useAuth } from "@/hooks/useAuth";

export function IslandNav() {
  const { session, loading, setAuthModalOpen, logout } = useAuth();
  const [shrunk, setShrunk] = useState(false);

  useEffect(() => {
    const onScroll = () => setShrunk(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4">
        <nav
          className={cn(
            "island pointer-events-auto flex items-center gap-1 transition-all duration-300",
            shrunk ? "scale-[0.97] px-2 py-1.5" : "px-3 py-2",
          )}
        >
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 rounded-full px-3 py-2 transition-colors hover:bg-accent"
          >
            <span className="grid size-7 place-items-center rounded-xl bg-primary text-primary-foreground">
              <FileStack className="size-4" />
            </span>
            <span className="font-display text-sm font-semibold">Pagize</span>
          </Link>
          <span className="mx-1 hidden h-6 w-px bg-border md:block" />
          <div className="hidden items-center gap-1 md:flex">
            {navTools.map((tool) => (
              <Link
                key={tool.slug}
                to="/tools/$slug"
                params={{ slug: tool.slug }}
                className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground data-[status=active]:bg-primary data-[status=active]:text-primary-foreground"
              >
                {tool.short}
              </Link>
            ))}
            <Link
              to="/templates"
              className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground data-[status=active]:bg-primary data-[status=active]:text-primary-foreground"
            >
              Templates
            </Link>
            <span className="mx-1 h-6 w-px bg-border" />
            {loading ? (
              // Placeholder keeps the nav from flicking "Sign In" at a user who
              // turns out to be signed in once the stored session is read.
              <span className="mx-2 h-5 w-16 animate-pulse rounded-full bg-muted" />
            ) : session ? (
              <>
                <span
                  className="max-w-[12rem] truncate px-2 text-sm font-medium text-foreground"
                  title={session.user.email ?? undefined}
                >
                  {session.user.email ?? "Signed in"}
                </span>
                <button
                  onClick={logout}
                  className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground"
                >
                  Log Out
                </button>
              </>
            ) : (
              <button
                onClick={() => setAuthModalOpen(true)}
                className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground"
              >
                Sign In
              </button>
            )}
          </div>
        </nav>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4 md:hidden">
        <nav className="island pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto px-2 py-2">
          {navTools.map((tool) => (
            <Link
              key={tool.slug}
              to="/tools/$slug"
              params={{ slug: tool.slug }}
              className="flex shrink-0 flex-col items-center gap-1 rounded-2xl px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors data-[status=active]:bg-primary data-[status=active]:text-primary-foreground"
            >
              <tool.icon className="size-4" />
              {tool.short}
            </Link>
          ))}
          <Link
            to="/templates"
            className="flex shrink-0 flex-col items-center gap-1 rounded-2xl px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors data-[status=active]:bg-primary data-[status=active]:text-primary-foreground"
          >
            <LayoutTemplate className="size-4" />
            Templates
          </Link>
        </nav>
      </div>
    </>
  );
}
