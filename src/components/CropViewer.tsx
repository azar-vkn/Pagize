import { useEffect, useState } from "react";
import { renderPage } from "@/lib/pdf-renderer";
import { InteractiveCropOverlay } from "./InteractiveCropOverlay";
import { cn } from "@/lib/utils";

type CropViewerProps = {
  file: File;
  pageIndex: number;
  pageDimensions: { width: number; height: number } | null;
  cropMargins: { top: number; right: number; bottom: number; left: number };
  onCropChange: (margins: { top: number; right: number; bottom: number; left: number }) => void;
  className?: string;
};

export function CropViewer({
  file,
  pageIndex,
  pageDimensions,
  cropMargins,
  onCropChange,
  className,
}: CropViewerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    // Render the specified page at a higher scale for a professional viewer
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

  if (loading || !imageUrl) {
    return (
      <div className={cn("flex items-center justify-center py-20", className)}>
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Rendering high-res preview…</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative mx-auto flex justify-center w-full max-w-3xl overflow-hidden rounded-xl border bg-gray-50 shadow-sm",
        className,
      )}
    >
      <div className="relative inline-block w-full">
        {/* The high resolution image of the first page */}
        <img src={imageUrl} alt="First page preview" className="w-full object-contain block" />
        {/* The interactive crop overlay that sits perfectly on top */}
        {pageDimensions && (
          <InteractiveCropOverlay
            pageDimensions={pageDimensions}
            cropMargins={cropMargins}
            onChange={onCropChange}
          />
        )}
      </div>
    </div>
  );
}
