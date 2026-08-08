import { useEffect, useState } from "react";
import { renderPage, extractTextItems, TextItemPosition } from "@/lib/pdf-renderer";
import { TextReplacement } from "@/lib/pdf-ops";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PageViewport } from "pdfjs-dist";

type PdfTextEditorProps = {
  file: File;
  edits: TextReplacement[];
  selectedItemKey: string | null;
  onSelectTextItem: (item: TextItemPosition | null, pageIndex: number, itemIdx: number) => void;
};

export function PdfTextEditor({ file, edits, selectedItemKey, onSelectTextItem }: PdfTextEditorProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [numPages, setNumPages] = useState<number | null>(null);
  
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [items, setItems] = useState<TextItemPosition[]>([]);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch page count (quick way is via renderAllPages or getPageCount if available)
  useEffect(() => {
    import("@/lib/pdf-renderer").then((m) => {
      m.getPageCount(file).then(setNumPages).catch(console.error);
    });
  }, [file]);

  // Load page content
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBgUrl(null);
    setItems([]);
    onSelectTextItem(null, pageIndex, -1); // Deselect on page change

    Promise.all([
      renderPage(file, pageIndex, 2), // High-res background
      extractTextItems(file, pageIndex)
    ])
      .then(([url, { items: newItems, viewport: newViewport }]) => {
        if (!cancelled) {
          setBgUrl(url);
          setItems(newItems);
          setViewport(newViewport);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [file, pageIndex]);

  if (loading && !bgUrl) {
    return (
      <div className="flex min-h-[500px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="mt-4 text-sm text-muted-foreground">Loading page content…</p>
      </div>
    );
  }

  // Create a map for quick lookup of current edits by item key
  const editMap = new Map<string, TextReplacement>();
  for (const edit of edits) {
    // We can match edits by pageIndex, x, and y. A more robust way is to just use the key if we stored it,
    // but the edits array doesn't store the key.
    // Let's match by pageIndex + x + y since they are unique per item on a page.
    const key = `${edit.pageIndex}-${edit.x}-${edit.y}`;
    editMap.set(key, edit);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium">
          Select any text block to edit
        </p>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            Page {pageIndex + 1} of {numPages ?? "?"}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={pageIndex === 0 || loading}
              onClick={() => setPageIndex((p) => p - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={numPages === null || pageIndex >= numPages - 1 || loading}
              onClick={() => setPageIndex((p) => p + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="relative mx-auto overflow-hidden rounded-xl border shadow-sm transition-opacity"
           style={{ opacity: loading ? 0.5 : 1 }}>
        {bgUrl && viewport && (
          <div
            className="relative mx-auto select-none"
            style={{
              aspectRatio: `${viewport.width} / ${viewport.height}`,
              maxWidth: "100%",
            }}
          >
            {/* Background PDF render */}
            <img
              src={bgUrl}
              alt={`Page ${pageIndex + 1}`}
              className="absolute inset-0 size-full object-contain pointer-events-none"
            />

            {/* Interactive Text Overlays */}
            {items.map((item, idx) => {
              const itemKey = `${pageIndex}-${idx}`;
              const matchKey = `${pageIndex}-${item.x}-${item.y}`;
              const currentEdit = editMap.get(matchKey);
              
              const isSelected = selectedItemKey === itemKey;
              const isModified = !!currentEdit;
              const displayText = currentEdit ? currentEdit.newText : item.str;

              return (
                <button
                  key={itemKey}
                  type="button"
                  className={cn(
                    "group absolute flex items-end overflow-visible rounded-sm transition-all text-left",
                    isSelected ? "z-20 outline outline-2 outline-primary bg-primary/10 shadow-sm" : "z-10 hover:z-20",
                    !isSelected && isModified ? "bg-yellow-200/40 outline outline-1 outline-yellow-400 text-yellow-900 cursor-pointer hover:bg-yellow-200/60" : "",
                    !isSelected && !isModified ? "hover:bg-blue-500/10 hover:outline hover:outline-1 hover:outline-blue-400 cursor-pointer" : ""
                  )}
                  style={{
                    left: `${(item.x / viewport.width) * 100}%`,
                    top: `${(item.y / viewport.height) * 100}%`,
                    width: `${(item.width / viewport.width) * 100}%`,
                    height: `${(item.height / viewport.height) * 100}%`,
                  }}
                  onClick={() => onSelectTextItem(item, pageIndex, idx)}
                >
                  {isModified && (
                    <span 
                      className="absolute inset-0 flex items-end whitespace-nowrap bg-background text-foreground px-0.5"
                      style={{
                        fontSize: "100%", // Fit naturally
                        lineHeight: 1,
                      }}
                    >
                      {displayText}
                    </span>
                  )}
                </button>
              );
            })}
            
            {items.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm pointer-events-none">
                <p className="rounded-full bg-background px-4 py-2 text-sm font-medium shadow-sm">
                  No editable text found on this page.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
