import { useEffect, useState, useRef, useCallback } from "react";
import { renderPage, extractTextItems, TextItemPosition } from "@/lib/pdf-renderer";
import { TextReplacement } from "@/lib/pdf-ops";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2, Check, X, RotateCcw, Minus, Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PageViewport } from "pdfjs-dist";

type PdfTextEditorProps = {
  file: File;
  edits: TextReplacement[];
  onEdit: (edit: TextReplacement | null) => void;
};

const COLOR_PRESETS = ["#000000", "#1e293b", "#dc2626", "#2563eb", "#16a34a", "#d97706", "#9333ea"];

/**
 * Map a text item to the closest standard PDF font for pdf-lib embedding.
 *
 * Uses two signals, in priority order:
 *   1. The `fontFamily` from pdf.js `content.styles` ("serif" / "sans-serif" / "monospace").
 *   2. The raw `fontName` string as a fallback heuristic (for PDFs where styles are missing).
 */
function detectStandardFont(item: TextItemPosition): "Helvetica" | "TimesRoman" | "Courier" {
  // 1. Use the authoritative fontFamily from pdf.js styles API
  const family = (item.fontFamily || "").toLowerCase();
  if (family.includes("monospace") || family.includes("mono")) return "Courier";
  if (family.includes("serif") && !family.includes("sans")) return "TimesRoman";
  if (family.includes("sans")) return "Helvetica";

  // 2. Fallback: heuristic matching on the raw PDF font name
  const cleaned = (item.fontName || "").replace(/^[A-Z]{6}\+/, "").toLowerCase();
  if (
    cleaned.includes("courier") ||
    cleaned.includes("consolas") ||
    cleaned.includes("mono") ||
    cleaned.includes("menlo") ||
    cleaned.includes("fira code") ||
    cleaned.includes("inconsolata")
  ) {
    return "Courier";
  }
  if (
    cleaned.includes("times") ||
    cleaned.includes("georgia") ||
    cleaned.includes("garamond") ||
    cleaned.includes("palatino") ||
    cleaned.includes("cambria") ||
    cleaned.includes("baskerville") ||
    cleaned.includes("bodoni") ||
    cleaned.includes("minion")
  ) {
    return "TimesRoman";
  }

  return "Helvetica";
}

/** Get the CSS font-family string for rendering in the browser overlay. */
function getCssFont(font?: string): string {
  if (font === "TimesRoman") return '"Times New Roman", Times, serif';
  if (font === "Courier") return '"Courier New", Courier, monospace';
  return '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
}

/** Human-readable label for the detected font. */
function fontLabel(item: TextItemPosition): string {
  const raw = (item.fontName || "").replace(/^[A-Z]{6}\+/, "");
  if (raw.length > 0 && raw.length <= 24) return raw;
  const family = item.fontFamily || "sans-serif";
  return family.charAt(0).toUpperCase() + family.slice(1);
}

export function PdfTextEditor({ file, edits, onEdit }: PdfTextEditorProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [numPages, setNumPages] = useState<number | null>(null);

  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [items, setItems] = useState<TextItemPosition[]>([]);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [loading, setLoading] = useState(true);

  const [editingKey, setEditingKey] = useState<string | null>(null);

  // Active edit state for toolbar
  const [activeEditVal, setActiveEditVal] = useState<string>("");
  const [activeFont, setActiveFont] = useState<"Helvetica" | "TimesRoman" | "Courier">("Helvetica");
  const [activeColor, setActiveColor] = useState<string>("#000000");
  const [activeFontSize, setActiveFontSize] = useState<number>(12);

  const containerRef = useRef<HTMLDivElement>(null);
  const editableRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(800);

  // Measure container width for pixel-perfect font scaling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fetch page count
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
    setEditingKey(null);

    Promise.all([renderPage(file, pageIndex, 2), extractTextItems(file, pageIndex)])
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

    return () => {
      cancelled = true;
    };
  }, [file, pageIndex]);

  // Focus the editable div ONLY when we start editing a new item.
  // CRITICAL: activeEditVal is intentionally NOT in the dependency array.
  // Including it would reset el.textContent on every keystroke, which
  // destroys the cursor position and prevents typing sentences.
  useEffect(() => {
    if (editingKey && editableRef.current) {
      const el = editableRef.current;
      el.textContent = activeEditVal;
      el.focus();
      // Move cursor to end so the user can continue typing
      if (
        typeof window.getSelection !== "undefined" &&
        typeof document.createRange !== "undefined"
      ) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false); // false = collapse to end
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingKey]);

  const editMap = new Map<string, TextReplacement>();
  for (const edit of edits) {
    const key = `${edit.pageIndex}-${edit.x}-${edit.y}`;
    editMap.set(key, edit);
  }

  const saveCurrentEdit = useCallback(
    (item: TextItemPosition) => {
      const detectedFont = detectStandardFont(item);
      if (
        activeEditVal === item.str &&
        activeFont === detectedFont &&
        activeColor === (item.color || "#000000") &&
        activeFontSize === item.fontSize
      ) {
        // No changes — revert
        onEdit({
          pageIndex,
          x: item.x,
          y: item.y,
          pdfX: item.pdfX,
          pdfY: item.pdfY,
          pdfWidth: item.pdfWidth,
          width: item.width,
          height: item.height,
          fontSize: item.fontSize,
          fontFamily: detectedFont,
          isBold: item.isBold,
          isItalic: item.isItalic,
          color: activeColor,
          bgColor: item.bgColor,
          originalText: item.str,
          newText: item.str,
        });
        return;
      }

      onEdit({
        pageIndex,
        x: item.x,
        y: item.y,
        pdfX: item.pdfX,
        pdfY: item.pdfY,
        pdfWidth: item.pdfWidth,
        width: item.width,
        height: item.height,
        fontSize: activeFontSize,
        fontFamily: activeFont,
        isBold: item.isBold,
        isItalic: item.isItalic,
        color: activeColor,
        bgColor: item.bgColor,
        originalText: item.str,
        newText: activeEditVal,
      });
    },
    [activeEditVal, activeFont, activeColor, activeFontSize, pageIndex, onEdit],
  );

  const revertEdit = (item: TextItemPosition) => {
    const detectedFont = detectStandardFont(item);
    onEdit({
      pageIndex,
      x: item.x,
      y: item.y,
      pdfX: item.pdfX,
      pdfY: item.pdfY,
      pdfWidth: item.pdfWidth,
      width: item.width,
      height: item.height,
      fontSize: item.fontSize,
      fontFamily: detectedFont,
      isBold: item.isBold,
      isItalic: item.isItalic,
      color: item.color || "#000000",
      bgColor: item.bgColor,
      originalText: item.str,
      newText: item.str,
    });
    setEditingKey(null);
  };

  // Compute live scale factor from viewport to container
  const scale = viewport && containerWidth > 0 ? containerWidth / viewport.width : 1;

  if (loading && !bgUrl) {
    return (
      <div className="flex min-h-[500px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="mt-4 text-sm text-muted-foreground">Loading page content…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Header Bar */}
      <div className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Click any text to edit it in-place</p>
          <p className="text-xs text-muted-foreground">
            Font style is auto-detected from the PDF. Edit freely — your changes will match the
            original layout.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            Page {pageIndex + 1} of {numPages ?? "?"}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8 rounded-lg"
              disabled={pageIndex === 0 || loading}
              onClick={() => {
                setPageIndex((p) => p - 1);
                setEditingKey(null);
              }}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8 rounded-lg"
              disabled={numPages === null || pageIndex >= numPages - 1 || loading}
              onClick={() => {
                setPageIndex((p) => p + 1);
                setEditingKey(null);
              }}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Editor Canvas Area */}
      <div
        ref={containerRef}
        className="relative mx-auto overflow-hidden rounded-xl border bg-neutral-100 shadow-sm transition-opacity dark:bg-neutral-900"
        style={{ opacity: loading ? 0.5 : 1 }}
      >
        {bgUrl && viewport && (
          <div
            className="relative mx-auto select-none"
            style={{
              aspectRatio: `${viewport.width} / ${viewport.height}`,
              maxWidth: "100%",
            }}
          >
            <img
              src={bgUrl}
              alt={`Page ${pageIndex + 1}`}
              className="pointer-events-none absolute inset-0 size-full object-contain"
            />

            {items.map((item, idx) => {
              const itemKey = `${pageIndex}-${idx}`;
              const matchKey = `${pageIndex}-${item.x}-${item.y}`;
              const currentEdit = editMap.get(matchKey);

              const isEditing = editingKey === itemKey;
              const isModified = !!currentEdit && currentEdit.newText !== currentEdit.originalText;

              // Auto-detect font from PDF metadata
              const detectedFont = detectStandardFont(item);

              const appliedFont = isEditing ? activeFont : currentEdit?.fontFamily || detectedFont;
              const appliedColor = isEditing
                ? activeColor
                : currentEdit?.color || item.color || "#000000";
              const appliedFontSize = isEditing
                ? activeFontSize
                : currentEdit?.fontSize || item.fontSize;

              const pixelFontSize = Math.max(8, appliedFontSize * scale);

              const isNearTop = item.y / viewport.height < 0.12;
              const isNearRight = item.x / viewport.width > 0.7;

              const style = {
                left: `${(item.x / viewport.width) * 100}%`,
                top: `${(item.y / viewport.height) * 100}%`,
                minWidth: `${(item.width / viewport.width) * 100}%`,
                height: `${(item.height / viewport.height) * 100}%`,
              };

              if (isEditing) {
                return (
                  <div
                    key={itemKey}
                    className="absolute z-40 rounded-xs shadow-lg ring-2 ring-primary"
                    style={{
                      ...style,
                      backgroundColor: currentEdit?.bgColor || item.bgColor || "#ffffff",
                      width: "auto",
                      minWidth: `${Math.max(40, item.width * scale)}px`,
                      padding: "0 2px",
                      marginLeft: "-2px",
                    }}
                  >
                    {/* Floating Toolbar */}
                    <div
                      className={cn(
                        "absolute z-50 flex items-center gap-1.5 rounded-xl border bg-popover/95 p-1.5 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95",
                        isNearTop ? "top-full mt-2" : "bottom-full mb-2",
                        isNearRight ? "right-0" : "left-0",
                      )}
                      style={{ whiteSpace: "nowrap" }}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      {/* Font Family */}
                      <Select
                        value={activeFont}
                        onValueChange={(val: "Helvetica" | "TimesRoman" | "Courier") =>
                          setActiveFont(val)
                        }
                      >
                        <SelectTrigger className="h-7 w-[110px] text-xs border-none shadow-none focus:ring-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Helvetica">
                            <span className="font-sans">Helvetica</span>
                          </SelectItem>
                          <SelectItem value="TimesRoman">
                            <span className="font-serif">Times Roman</span>
                          </SelectItem>
                          <SelectItem value="Courier">
                            <span className="font-mono">Courier</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      <div className="h-4 w-px bg-border mx-0.5" />

                      {/* Font Size Adjuster */}
                      <div className="flex items-center gap-0.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-6 h-6 w-6 text-muted-foreground"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setActiveFontSize((s) => Math.max(6, s - 1));
                          }}
                          title="Decrease font size"
                        >
                          <Minus className="size-3" />
                        </Button>
                        <span className="min-w-[20px] text-center text-xs font-semibold">
                          {Math.round(activeFontSize)}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-6 h-6 w-6 text-muted-foreground"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setActiveFontSize((s) => Math.min(72, s + 1));
                          }}
                          title="Increase font size"
                        >
                          <Plus className="size-3" />
                        </Button>
                      </div>

                      <div className="h-4 w-px bg-border mx-0.5" />

                      {/* Color Presets */}
                      <div className="flex items-center gap-1 px-1">
                        {COLOR_PRESETS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={cn(
                              "size-4.5 rounded-full border transition-transform",
                              activeColor.toLowerCase() === c.toLowerCase()
                                ? "scale-125 border-primary ring-1 ring-primary"
                                : "border-border hover:scale-110",
                            )}
                            style={{ backgroundColor: c }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setActiveColor(c);
                            }}
                          />
                        ))}
                        <input
                          type="color"
                          value={activeColor}
                          onChange={(e) => setActiveColor(e.target.value)}
                          className="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
                          title="Custom Color"
                        />
                      </div>

                      <div className="h-4 w-px bg-border mx-0.5" />

                      {/* Detected Font Badge */}
                      <span
                        className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        title={`PDF font: ${item.fontName} (${item.fontFamily})`}
                      >
                        {fontLabel(item)}
                      </span>

                      <div className="h-4 w-px bg-border mx-0.5" />

                      {/* Action Buttons */}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 h-7 w-7 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 dark:hover:bg-emerald-950"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          saveCurrentEdit(item);
                          setEditingKey(null);
                        }}
                        title="Save edit (Enter)"
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingKey(null);
                        }}
                        title="Cancel (Esc)"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>

                    {/* Content Editable Editor */}
                    <div
                      ref={editableRef}
                      contentEditable
                      suppressContentEditableWarning
                      className="min-w-[10px] overflow-visible whitespace-pre-wrap outline-none"
                      style={{
                        fontSize: `${pixelFontSize}px`,
                        fontFamily: getCssFont(appliedFont),
                        fontWeight: item.isBold ? "bold" : "normal",
                        fontStyle: item.isItalic ? "italic" : "normal",
                        color: appliedColor,
                        lineHeight: 1.15,
                        wordBreak: "break-word",
                      }}
                      onInput={(e) => {
                        setActiveEditVal(e.currentTarget.textContent || "");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          saveCurrentEdit(item);
                          setEditingKey(null);
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingKey(null);
                        }
                      }}
                    />
                  </div>
                );
              }

              // Normal display view
              return (
                <div
                  key={itemKey}
                  className={cn(
                    "group absolute flex items-center overflow-visible rounded-xs transition-all text-left",
                    "z-10 hover:z-20 cursor-text",
                    isModified
                      ? "ring-1 ring-primary/30 hover:ring-primary/60"
                      : "hover:bg-blue-500/15 hover:ring-1 hover:ring-blue-500/50",
                  )}
                  style={{
                    ...style,
                    backgroundColor: isModified
                      ? currentEdit?.bgColor || item.bgColor || "#ffffff"
                      : undefined,
                  }}
                  onClick={() => {
                    const detFont = detectStandardFont(item);
                    setActiveEditVal(currentEdit ? currentEdit.newText : item.str);
                    setActiveFont(currentEdit?.fontFamily || detFont);
                    setActiveColor(currentEdit?.color || item.color || "#000000");
                    setActiveFontSize(currentEdit?.fontSize || item.fontSize);
                    setEditingKey(itemKey);
                  }}
                >
                  {isModified && (
                    <>
                      <span
                        className="relative block w-full whitespace-nowrap px-0.5"
                        style={{
                          fontSize: `${pixelFontSize}px`,
                          lineHeight: 1,
                          fontFamily: getCssFont(appliedFont),
                          fontWeight: item.isBold ? "bold" : "normal",
                          fontStyle: item.isItalic ? "italic" : "normal",
                          color: appliedColor,
                        }}
                      >
                        {currentEdit.newText}
                      </span>
                      {/* Quick Revert Button on Hover */}
                      <button
                        type="button"
                        className="absolute -right-2 -top-2 hidden size-4 items-center justify-center rounded-full bg-destructive text-white shadow-xs group-hover:flex"
                        onClick={(e) => {
                          e.stopPropagation();
                          revertEdit(item);
                        }}
                        title="Revert to original"
                      >
                        <RotateCcw className="size-2.5" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
