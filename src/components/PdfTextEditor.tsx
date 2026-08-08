import { useEffect, useState, useRef } from "react";
import { renderPage, extractTextItems, TextItemPosition } from "@/lib/pdf-renderer";
import { TextReplacement } from "@/lib/pdf-ops";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2, Check, X, Type } from "lucide-react";
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

export function PdfTextEditor({ file, edits, onEdit }: PdfTextEditorProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [numPages, setNumPages] = useState<number | null>(null);

  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [items, setItems] = useState<TextItemPosition[]>([]);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [loading, setLoading] = useState(true);

  const [editingKey, setEditingKey] = useState<string | null>(null);

  // Local state for the currently active edit (for the toolbar)
  const [activeEditVal, setActiveEditVal] = useState<string>("");
  const [activeFont, setActiveFont] = useState<"Helvetica" | "TimesRoman" | "Courier">("Helvetica");
  const [activeColor, setActiveColor] = useState<string>("#000000");

  const editableRef = useRef<HTMLDivElement>(null);

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

  // Focus the editable div when editing starts
  useEffect(() => {
    if (editingKey && editableRef.current) {
      // Focus and move cursor to end
      const el = editableRef.current;
      if (el.textContent !== activeEditVal) {
        el.textContent = activeEditVal;
      }
      el.focus();
      if (
        typeof window.getSelection !== "undefined" &&
        typeof document.createRange !== "undefined"
      ) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false); // true for start, false for end
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingKey]);

  if (loading && !bgUrl) {
    return (
      <div className="flex min-h-[500px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="mt-4 text-sm text-muted-foreground">Loading page content…</p>
      </div>
    );
  }

  const editMap = new Map<string, TextReplacement>();
  for (const edit of edits) {
    const key = `${edit.pageIndex}-${edit.x}-${edit.y}`;
    editMap.set(key, edit);
  }

  const saveCurrentEdit = (item: TextItemPosition) => {
    if (activeEditVal === item.str && activeFont === "Helvetica" && activeColor === "#000000") {
      onEdit(null); // Actually, we pass a replacement with original values and the parent component removes it
      onEdit({
        pageIndex,
        x: item.x,
        y: item.y,
        pdfX: item.pdfX,
        pdfY: item.pdfY,
        width: item.width,
        height: item.height,
        fontSize: item.fontSize,
        fontFamily: activeFont,
        color: activeColor,
        originalText: item.str,
        newText: item.str, // same as original means remove
      });
      return;
    }

    onEdit({
      pageIndex,
      x: item.x,
      y: item.y,
      pdfX: item.pdfX,
      pdfY: item.pdfY,
      width: item.width,
      height: item.height,
      fontSize: item.fontSize,
      fontFamily: activeFont,
      color: activeColor,
      originalText: item.str,
      newText: activeEditVal,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium">Click any text block to edit it seamlessly</p>
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
              className="size-8"
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

      <div
        className="relative mx-auto overflow-hidden rounded-xl border shadow-sm transition-opacity"
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
              className="absolute inset-0 size-full object-contain pointer-events-none"
            />

            {items.map((item, idx) => {
              const itemKey = `${pageIndex}-${idx}`;
              const matchKey = `${pageIndex}-${item.x}-${item.y}`;
              const currentEdit = editMap.get(matchKey);

              const isEditing = editingKey === itemKey;
              const isModified = !!currentEdit;

              // Only read displayText if not currently editing it to avoid overriding user input on re-renders
              const displayText = isEditing
                ? activeEditVal
                : currentEdit
                  ? currentEdit.newText
                  : item.str;

              // Get CSS font family string based on active selection
              const getCssFont = (font?: string) => {
                if (font === "TimesRoman") return "Times New Roman, serif";
                if (font === "Courier") return "Courier New, monospace";
                return "Helvetica, Arial, sans-serif";
              };

              const appliedFont = isEditing ? activeFont : currentEdit?.fontFamily || "Helvetica";
              const appliedColor = isEditing
                ? activeColor
                : currentEdit?.color || item.color || "#000000";

              const style = {
                left: `${(item.x / viewport.width) * 100}%`,
                top: `${(item.y / viewport.height) * 100}%`,
                // Original width is kept as a reference, but we let it flow if editing
                width: isEditing ? "auto" : `${(item.width / viewport.width) * 100}%`,
                minWidth: isEditing ? `${(item.width / viewport.width) * 100}%` : undefined,
                height: `${(item.height / viewport.height) * 100}%`,
              };

              if (isEditing) {
                return (
                  <div
                    key={itemKey}
                    className="absolute z-40 bg-background shadow-lg outline outline-1 outline-primary rounded-sm"
                    style={{
                      ...style,
                      padding: "0 2px", // Slight padding for caret
                      marginLeft: "-2px", // Offset padding
                    }}
                  >
                    {/* Floating Toolbar */}
                    <div
                      className="absolute bottom-full left-0 mb-2 flex items-center gap-1.5 rounded-lg border bg-popover p-1.5 shadow-md animate-in fade-in zoom-in-95"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      <Select
                        value={activeFont}
                        onValueChange={(val: "Helvetica" | "TimesRoman" | "Courier") =>
                          setActiveFont(val)
                        }
                      >
                        <SelectTrigger className="h-7 w-[120px] text-xs border-none shadow-none focus:ring-0">
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

                      <div className="h-4 w-px bg-border mx-1" />

                      <input
                        type="color"
                        value={activeColor}
                        onChange={(e) => setActiveColor(e.target.value)}
                        className="size-6 cursor-pointer rounded border-0 p-0 bg-transparent"
                        title="Text Color"
                      />

                      <div className="h-4 w-px bg-border mx-1" />

                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          saveCurrentEdit(item);
                          setEditingKey(null);
                        }}
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 h-7 w-7 text-muted-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingKey(null);
                        }}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>

                    {/* True Content Editable Editor */}
                    <div
                      ref={editableRef}
                      contentEditable
                      suppressContentEditableWarning
                      className="outline-none whitespace-nowrap overflow-visible"
                      style={{
                        fontSize: `${(item.fontSize / viewport.height) * 100}vh`,
                        fontFamily: getCssFont(appliedFont),
                        color: appliedColor,
                        lineHeight: 1,
                        minWidth: "10px",
                      }}
                      onBlur={(e) => {
                        // We do not auto-save on blur anymore, because clicking the toolbar triggers blur!
                        // The user MUST click the Checkmark or X, or we can use a timeout trick.
                        // Actually, requiring explicit Checkmark click is safer for floating toolbars.
                      }}
                      onInput={(e) => {
                        setActiveEditVal(e.currentTarget.textContent || "");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault(); // Prevent multi-line completely for safety
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

              // Normal display view (not actively editing)
              return (
                <button
                  key={itemKey}
                  type="button"
                  className={cn(
                    "group absolute flex items-end overflow-visible rounded-sm transition-all text-left",
                    "z-10 hover:z-20 cursor-text",
                    isModified
                      ? "bg-white"
                      : "hover:bg-blue-500/10 hover:outline hover:outline-1 hover:outline-blue-400 text-transparent hover:text-transparent",
                  )}
                  style={style}
                  onClick={() => {
                    setActiveEditVal(currentEdit ? currentEdit.newText : item.str);
                    setActiveFont(currentEdit?.fontFamily || "Helvetica");
                    setActiveColor(currentEdit?.color || item.color || "#000000");
                    setEditingKey(itemKey);
                  }}
                >
                  {isModified && (
                    <span
                      className="relative block whitespace-nowrap w-full"
                      style={{
                        fontSize: "100%", // Fit naturally
                        lineHeight: 1,
                        fontFamily: getCssFont(appliedFont),
                        color: appliedColor,
                      }}
                    >
                      {displayText}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
