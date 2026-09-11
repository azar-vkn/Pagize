import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { renderPage } from "@/lib/pdf-renderer";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type SignRect = { x: number; y: number; width: number; height: number };

type SignaturePlacerProps = {
  file: File;
  /** 0-based page index being placed on. */
  pageIndex: number;
  pageCount: number;
  /** Page size in PDF points, or null while loading. */
  pageDimensions: { width: number; height: number } | null;
  /** Signature image (data URL) to preview inside the box, if any. */
  signatureUrl: string;
  /** This page's placement rect (PDF points, top-left), or null if unsigned. */
  rect: SignRect | null;
  /** Pages that currently have a placement (for the "signed pages" summary). */
  signedPages: number[];
  onChange: (rect: SignRect) => void;
  /** Add a default placement to (true) or remove it from (false) this page. */
  onToggle: (enabled: boolean) => void;
  onPageChange: (page: number) => void;
  className?: string;
};

type DragState = {
  mode: "move" | "resize";
  startX: number;
  startY: number;
  init: SignRect;
  container: DOMRect;
};

/** Full-page preview where the user drags a box to place a signature per page. */
export function SignaturePlacer({
  file,
  pageIndex,
  pageCount,
  pageDimensions,
  signatureUrl,
  rect,
  signedPages,
  onChange,
  onToggle,
  onPageChange,
  className,
}: SignaturePlacerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [local, setLocal] = useState<SignRect | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let active = true;
    setLoading(true);
    renderPage(file, pageIndex, 1.5)
      .then((url) => {
        if (active) {
          setImageUrl(url);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to render preview", err);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [file, pageIndex]);

  // While dragging, `local` overrides; otherwise the committed rect for this page.
  const disp = local ?? rect;

  const onPointerDown = (e: React.PointerEvent, mode: "move" | "resize") => {
    e.preventDefault();
    e.stopPropagation();
    if (!pageDimensions || !containerRef.current || !disp) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      init: { ...disp },
      container: containerRef.current.getBoundingClientRect(),
    };
    setLocal({ ...disp });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !pageDimensions) return;
    const scaleX = pageDimensions.width / drag.container.width;
    const scaleY = pageDimensions.height / drag.container.height;
    const dx = (e.clientX - drag.startX) * scaleX;
    const dy = (e.clientY - drag.startY) * scaleY;
    const next = { ...drag.init };
    if (drag.mode === "move") {
      next.x = Math.max(0, Math.min(pageDimensions.width - drag.init.width, drag.init.x + dx));
      next.y = Math.max(0, Math.min(pageDimensions.height - drag.init.height, drag.init.y + dy));
    } else {
      next.width = Math.max(20, Math.min(pageDimensions.width - drag.init.x, drag.init.width + dx));
      next.height = Math.max(
        10,
        Math.min(pageDimensions.height - drag.init.y, drag.init.height + dy),
      );
    }
    setLocal(next);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (local) onChangeRef.current(local);
    dragRef.current = null;
    setLocal(null);
  };

  const signedLabel =
    signedPages.length === 0
      ? "No pages signed yet"
      : `Signing ${signedPages.length} page${signedPages.length > 1 ? "s" : ""}: ${signedPages
          .map((p) => p + 1)
          .join(", ")}`;

  if (loading || !imageUrl) {
    return (
      <div className={cn("flex items-center justify-center py-20", className)}>
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Rendering page…</p>
        </div>
      </div>
    );
  }

  const pw = pageDimensions?.width ?? 1;
  const ph = pageDimensions?.height ?? 1;
  const boxStyle = disp
    ? {
        left: `${(disp.x / pw) * 100}%`,
        top: `${(disp.y / ph) * 100}%`,
        width: `${(disp.width / pw) * 100}%`,
        height: `${(disp.height / ph) * 100}%`,
      }
    : undefined;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <Switch checked={rect !== null} onCheckedChange={onToggle} />
          Sign this page
        </label>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={pageIndex === 0}
              onClick={() => onPageChange(Math.max(0, pageIndex - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="w-16 text-center text-xs font-medium">
              {pageIndex + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={pageIndex === pageCount - 1}
              onClick={() => onPageChange(Math.min(pageCount - 1, pageIndex + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-xl border bg-gray-50 shadow-sm">
        <div ref={containerRef} className="relative inline-block w-full touch-none">
          <img
            src={imageUrl}
            alt={`Page ${pageIndex + 1}`}
            className="block w-full object-contain"
          />
          {pageDimensions && disp && boxStyle && (
            <div
              className="absolute cursor-move rounded-sm border-2 border-primary bg-primary/5"
              style={boxStyle}
              onPointerDown={(e) => onPointerDown(e, "move")}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {signatureUrl ? (
                <img
                  src={signatureUrl}
                  alt="Signature"
                  className="pointer-events-none h-full w-full object-contain"
                />
              ) : (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-medium text-primary">
                  Signature
                </span>
              )}
              <div
                className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-full border border-primary bg-white shadow"
                onPointerDown={(e) => onPointerDown(e, "resize")}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        {rect
          ? "Drag the box to position your signature; drag the corner to resize. Navigate pages to place it differently on each."
          : "Turn on “Sign this page” to add your signature here. Each page can have its own position."}
      </p>
      <p className="text-center text-xs font-medium text-primary">{signedLabel}</p>
    </div>
  );
}
