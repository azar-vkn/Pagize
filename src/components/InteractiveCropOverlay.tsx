import React, { useRef, useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

type Margins = { top: number; right: number; bottom: number; left: number };

type InteractiveCropOverlayProps = {
  pageDimensions: { width: number; height: number };
  cropMargins: Margins;
  onChange: (margins: Margins) => void;
  className?: string;
};

type DragState = {
  activeHandle: string | null;
  startX: number;
  startY: number;
  initialMargins: Margins;
  containerRect: DOMRect;
};

export function InteractiveCropOverlay({
  pageDimensions,
  cropMargins,
  onChange,
  className,
}: InteractiveCropOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  // Keep the latest onChange in a ref so we don't depend on it in useCallback
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Local state for smooth dragging without relying on parent re-render latency
  const [localMargins, setLocalMargins] = useState<Margins | null>(null);

  const displayMargins = localMargins || cropMargins;

  const handlePointerDown = (e: React.PointerEvent, handle: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    dragRef.current = {
      activeHandle: handle,
      startX: e.clientX,
      startY: e.clientY,
      initialMargins: { ...displayMargins },
      containerRect: rect,
    };

    setLocalMargins({ ...displayMargins });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;

    const { activeHandle, startX, startY, initialMargins, containerRect } = dragRef.current;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // Scale delta pixels back to PDF points
    const scaleX = pageDimensions.width / containerRect.width;
    const scaleY = pageDimensions.height / containerRect.height;

    const dxPts = dx * scaleX;
    const dyPts = dy * scaleY;

    const newMargins = { ...initialMargins };

    // Minimum distance between opposing edges (e.g. 10 points)
    const minWidth = 10;
    const minHeight = 10;

    if (activeHandle!.includes("n")) {
      newMargins.top = Math.max(
        0,
        Math.min(pageDimensions.height - newMargins.bottom - minHeight, initialMargins.top + dyPts),
      );
    }
    if (activeHandle!.includes("s")) {
      newMargins.bottom = Math.max(
        0,
        Math.min(pageDimensions.height - newMargins.top - minHeight, initialMargins.bottom - dyPts),
      );
    }
    if (activeHandle!.includes("w")) {
      newMargins.left = Math.max(
        0,
        Math.min(pageDimensions.width - newMargins.right - minWidth, initialMargins.left + dxPts),
      );
    }
    if (activeHandle!.includes("e")) {
      newMargins.right = Math.max(
        0,
        Math.min(pageDimensions.width - newMargins.left - minWidth, initialMargins.right - dxPts),
      );
    }

    setLocalMargins(newMargins);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (localMargins) {
        onChangeRef.current(localMargins);
      }
      dragRef.current = null;
      setLocalMargins(null);
    }
  };

  // Convert points to percentages for CSS
  const topPct = `${(displayMargins.top / pageDimensions.height) * 100}%`;
  const bottomPct = `${(displayMargins.bottom / pageDimensions.height) * 100}%`;
  const leftPct = `${(displayMargins.left / pageDimensions.width) * 100}%`;
  const rightPct = `${(displayMargins.right / pageDimensions.width) * 100}%`;

  return (
    <div
      ref={containerRef}
      className={cn("absolute inset-0 z-10 touch-none", className)}
      style={{
        // Darken outside the crop area
        clipPath: `polygon(
          0% 0%, 0% 100%, 100% 100%, 100% 0%, 0% 0%,
          ${leftPct} ${topPct}, ${leftPct} calc(100% - ${bottomPct}), 
          calc(100% - ${rightPct}) calc(100% - ${bottomPct}), 
          calc(100% - ${rightPct}) ${topPct}, ${leftPct} ${topPct}
        )`,
      }}
    >
      <div className="absolute inset-0 bg-black/40 pointer-events-none" />

      {/* The visible crop box */}
      <div
        className="absolute border-2 border-primary shadow-sm"
        style={{
          top: topPct,
          bottom: bottomPct,
          left: leftPct,
          right: rightPct,
        }}
      >
        {/* Handles */}
        <div
          className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-primary cursor-nwse-resize rounded-full"
          onPointerDown={(e) => handlePointerDown(e, "nw")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        <div
          className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border border-primary cursor-ns-resize rounded-full"
          onPointerDown={(e) => handlePointerDown(e, "n")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        <div
          className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-primary cursor-nesw-resize rounded-full"
          onPointerDown={(e) => handlePointerDown(e, "ne")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />

        <div
          className="absolute top-1/2 -translate-y-1/2 -left-1.5 w-3 h-3 bg-white border border-primary cursor-ew-resize rounded-full"
          onPointerDown={(e) => handlePointerDown(e, "w")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 -right-1.5 w-3 h-3 bg-white border border-primary cursor-ew-resize rounded-full"
          onPointerDown={(e) => handlePointerDown(e, "e")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />

        <div
          className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-primary cursor-nesw-resize rounded-full"
          onPointerDown={(e) => handlePointerDown(e, "sw")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        <div
          className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border border-primary cursor-ns-resize rounded-full"
          onPointerDown={(e) => handlePointerDown(e, "s")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        <div
          className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-primary cursor-nwse-resize rounded-full"
          onPointerDown={(e) => handlePointerDown(e, "se")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
    </div>
  );
}
