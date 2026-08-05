import { UploadCloud, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

type Props = {
  accepts: string;
  multiple: boolean;
  files: File[];
  onChange: (files: File[]) => void;
  label?: string;
  hint?: string;
};

export function DropZone({ accepts, multiple, files, onChange, label, hint }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const add = (incoming: FileList | null) => {
    if (!incoming?.length) return;
    const next = Array.from(incoming);
    onChange(multiple ? [...files, ...next] : next.slice(0, 1));
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          "rounded-3xl border-2 border-dashed bg-card/70 px-6 py-12 text-center transition-all",
          over ? "border-primary bg-accent shadow-island-hover" : "border-border",
        )}
      >
        <span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-accent text-accent-foreground">
          <UploadCloud className="size-7" />
        </span>
        <h3 className="text-lg font-semibold">{label ?? "Drop your files here"}</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {hint ?? "Everything is processed in your browser — files never leave your device."}
        </p>
        <Button className="mt-5 rounded-full px-6" onClick={() => inputRef.current?.click()}>
          Select from device
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={accepts}
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              draggable={multiple}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const from = Number(e.dataTransfer.getData("text/plain"));
                if (Number.isNaN(from) || from === i) return;
                const next = [...files];
                const [moved] = next.splice(from, 1);
                if (moved) next.splice(i, 0, moved);
                onChange(next);
              }}
              className="island flex items-center gap-3 px-4 py-3"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary-soft text-xs font-semibold text-accent-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
              <button
                aria-label={`Remove ${file.name}`}
                onClick={() => onChange(files.filter((_, idx) => idx !== i))}
                className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {multiple && files.length > 1 && (
        <p className="text-center text-xs text-muted-foreground">Drag the cards to reorder.</p>
      )}
    </div>
  );
}