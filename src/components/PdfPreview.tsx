import { useEffect, useRef, useState } from "react";
import { renderAllPages } from "@/lib/pdf-renderer";
import { cn } from "@/lib/utils";
import { InteractiveCropOverlay } from "@/components/InteractiveCropOverlay";

type PdfPreviewProps = {
  file: File;
  /** Which pages to highlight (zero-based). */
  selectedPages?: Set<number> | undefined;
  /** Selection mode styling: "keep" highlights green, "remove" highlights red. */
  selectionMode?: "keep" | "remove" | undefined;
  /** Callback when a page thumbnail is clicked. */
  onPageClick?: ((pageIndex: number) => void) | undefined;
  /** CSS rotation to apply to thumbnails (for rotate preview). */
  rotationAngle?: number | undefined;
  /** Whether pages can be reordered by drag. */
  draggable?: boolean | undefined;
  /** Callback when pages are reordered via drag-and-drop. Returns new order. */
  onReorder?: ((newOrder: number[]) => void) | undefined;
  /** Current page order (zero-based indices). */
  pageOrder?: number[] | undefined;
  /** Crop margins per page (in points, for visual overlay). */
  pageCrops?: Record<number, { top: number; right: number; bottom: number; left: number }> | undefined;
  /** Callback when crop margins change interactively. */
  onCropChange?:
    ((margins: { top: number; right: number; bottom: number; left: number }) => void) | undefined;
  /** Actual dimensions of the PDF page in points, required for interactive cropping. */
  pageDimensions?: { width: number; height: number } | undefined;
  /**
   * "grid" (default) is the compact page picker used by the tools pages.
   * "document" renders one large, readable page per row — for previewing a
   * document you are composing rather than choosing pages from.
   */
  variant?: "grid" | "document" | undefined;
  /** Overrides the render scale. Higher is crisper but slower. */
  renderScale?: number | undefined;
  className?: string | undefined;
};

export function PdfPreview({
  file,
  selectedPages,
  selectionMode = "keep",
  onPageClick,
  rotationAngle = 0,
  draggable = false,
  onReorder,
  pageOrder,
  pageCrops,
  onCropChange,
  pageDimensions,
  variant = "grid",
  renderScale,
  className,
}: PdfPreviewProps) {
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const dragIdx = useRef<number | null>(null);

  // Document previews are meant to be read, so they need far more resolution
  // than the page picker's thumbnails.
  const scale = renderScale ?? (variant === "document" ? 1.5 : 0.5);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    renderAllPages(file, scale)
      .then((urls) => {
        if (!cancelled) {
          setThumbnails(urls);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, scale]);

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center py-12", className)}>
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Rendering preview…</p>
        </div>
      </div>
    );
  }

  if (thumbnails.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Could not render preview for this file.
      </p>
    );
  }

  // Large, readable, one page per row. None of the picker affordances
  // (selection, drag-reorder, crop overlays) apply here.
  if (variant === "document") {
    return (
      <div className={cn("flex flex-col items-center gap-8", className)}>
        {thumbnails.map((thumb, i) => (
          <figure key={i} className="w-full">
            <img
              src={thumb}
              alt={`Page ${i + 1}`}
              className="w-full rounded-xl border border-border bg-white shadow-md"
            />
            <figcaption className="mt-2.5 text-center text-xs font-medium text-muted-foreground">
              Page {i + 1} of {thumbnails.length}
            </figcaption>
          </figure>
        ))}
      </div>
    );
  }

  // Use provided page order or default sequential order
  const order = pageOrder ?? thumbnails.map((_, i) => i);

  const handleDragStart = (visualIdx: number) => {
    dragIdx.current = visualIdx;
  };

  const handleDrop = (targetVisualIdx: number) => {
    if (dragIdx.current === null || dragIdx.current === targetVisualIdx) return;
    const newOrder = [...order];
    const [moved] = newOrder.splice(dragIdx.current, 1);
    if (moved !== undefined) newOrder.splice(targetVisualIdx, 0, moved);
    dragIdx.current = null;
    onReorder?.(newOrder);
  };

  return (
    <div className={cn("grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5", className)}>
      {order.map((pageIdx, visualIdx) => {
        const thumb = thumbnails[pageIdx];
        if (!thumb) return null;

        const isSelected = selectedPages?.has(pageIdx);
        const borderColor = isSelected
          ? selectionMode === "remove"
            ? "ring-2 ring-red-400 border-red-400"
            : "ring-2 ring-emerald-400 border-emerald-400"
          : "border-border";

        return (
          <button
            key={`${pageIdx}-${visualIdx}`}
            type="button"
            onClick={() => onPageClick?.(pageIdx)}
            draggable={draggable}
            onDragStart={() => handleDragStart(visualIdx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(visualIdx)}
            className={cn(
              "group relative overflow-hidden rounded-xl border bg-white p-1 shadow-sm transition-all hover:shadow-md",
              borderColor,
              draggable && "cursor-grab active:cursor-grabbing",
              onPageClick && "cursor-pointer",
            )}
          >
            <div className="relative overflow-hidden rounded-lg">
              <img
                src={thumb}
                alt={`Page ${pageIdx + 1}`}
                className="w-full object-contain transition-transform"
                style={{
                  transform:
                    rotationAngle && (!selectedPages || selectedPages.size === 0 || isSelected)
                      ? `rotate(${rotationAngle}deg)`
                      : undefined,
                }}
              />
              {/* Crop overlay */}
              {pageCrops?.[pageIdx] &&
                (onCropChange && pageDimensions && pageIdx === 0 ? (
                  <InteractiveCropOverlay
                    pageDimensions={pageDimensions}
                    cropMargins={pageCrops[pageIdx]!}
                    onChange={onCropChange}
                  />
                ) : (
                  <div
                    className="pointer-events-none absolute border-2 border-dashed border-primary/60 bg-primary/5"
                    style={{
                      top: `${(pageCrops[pageIdx]!.top / (pageDimensions?.height || 792)) * 100}%`,
                      left: `${(pageCrops[pageIdx]!.left / (pageDimensions?.width || 612)) * 100}%`,
                      right: `${(pageCrops[pageIdx]!.right / (pageDimensions?.width || 612)) * 100}%`,
                      bottom: `${(pageCrops[pageIdx]!.bottom / (pageDimensions?.height || 792)) * 100}%`,
                    }}
                  />
                ))}
              {/* Dim overlay for removed pages */}
              {isSelected && selectionMode === "remove" && (
                <div className="absolute inset-0 bg-red-500/20" />
              )}
            </div>
            <p className="mt-1 text-center text-xs font-medium text-muted-foreground">
              {pageIdx + 1}
            </p>
          </button>
        );
      })}
    </div>
  );
}
