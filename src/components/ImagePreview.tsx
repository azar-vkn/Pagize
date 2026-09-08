import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Thumbnail strip for image inputs.
 *
 * The PDF tools preview their pages with PdfPreview, but the image-to-PDF
 * tools have no PDF to read yet — each selected image *is* a page-to-be, so
 * showing them in order is the equivalent preview.
 */
export function ImagePreview({ files, className }: { files: File[]; className?: string }) {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const created = files.map((file) => URL.createObjectURL(file));
    setUrls(created);
    // Object URLs pin the file in memory until revoked.
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [files]);

  if (urls.length === 0) return null;

  return (
    <div className={cn("grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5", className)}>
      {urls.map((url, i) => (
        <div
          key={url}
          className="relative overflow-hidden rounded-xl border border-border bg-white p-1 shadow-sm"
        >
          <img
            src={url}
            alt={files[i]?.name ?? `Image ${i + 1}`}
            className="aspect-[3/4] w-full rounded-lg object-contain"
          />
          <p className="mt-1 truncate text-center text-xs font-medium text-muted-foreground">
            {i + 1}
          </p>
        </div>
      ))}
    </div>
  );
}
