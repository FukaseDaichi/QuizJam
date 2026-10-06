import { useRef, useState, type DragEvent } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { prepareImageForUpload } from "../lib/image";

/** 画像のドロップ／選択→縮小→R2 アップロードまでを担当する入力欄 */
export function ImageField({ value, onChange, passphrase, label = "画像" }: {
  value?: string; onChange: (url: string | undefined) => void; passphrase: string; label?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true); setError(null);
    try {
      const blob = await prepareImageForUpload(file);
      const { url } = await api.uploadImage(blob, passphrase);
      onChange(url);
    } catch (e) {
      if (e instanceof ApiError && e.code === "too_large") setError("画像が大きすぎます（5MBまで）");
      else if (e instanceof ApiError && e.code === "unsupported_type") setError("PNG / JPEG / WebP / GIF の画像を選んでください");
      else if (e instanceof ApiError && e.status === 401) setError("合言葉が無効です。再ログインしてください");
      else setError(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally { setBusy(false); }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  return (
    <div className="text-sm font-bold text-slate-300">
      <div className="flex items-center justify-between">
        <span>{label}</span>
        {value && !busy && (
          <button type="button" onClick={() => onChange(undefined)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-slate-400 hover:bg-slate-700 hover:text-red-300">
            <Trash2 size={14} aria-hidden />外す
          </button>
        )}
      </div>
      <div
        role="button" tabIndex={0}
        onClick={() => !busy && fileRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`mt-1 flex aspect-video w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition ${
          over ? "border-purple-400 bg-purple-500/10" : "border-slate-600 bg-slate-900 hover:border-slate-400"
        }`}
        aria-label={value ? "画像を差し替える" : "画像を追加する"}
      >
        {busy ? (
          <span className="inline-flex items-center gap-2 text-slate-400"><Loader2 size={20} className="animate-spin" aria-hidden />アップロード中…</span>
        ) : value ? (
          <img src={value} alt="" className="h-full w-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-slate-400">
            <ImagePlus size={28} aria-hidden />
            <span>クリックまたはドロップで追加</span>
            <span className="text-xs font-normal text-slate-500">PNG / JPEG / WebP / GIF・5MBまで</span>
          </span>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
      {error && <p className="mt-1 text-xs font-bold text-red-400">{error}</p>}
    </div>
  );
}
