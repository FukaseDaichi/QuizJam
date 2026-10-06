/** スライド用画像をアップロード前にブラウザ側で縮小・再圧縮する */

export const MAX_IMAGE_EDGE = 1600;
export const UPLOAD_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を読み込めません")); };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像を変換できません"))), type, quality));
}

/**
 * 長辺が MAX_IMAGE_EDGE を超える画像は縮小する。GIF はアニメーションを保つためそのまま返す。
 * PNG は透過を保つため PNG のまま、それ以外は JPEG にする。
 */
export async function prepareImageForUpload(file: File, maxEdge = MAX_IMAGE_EDGE): Promise<Blob> {
  if (!UPLOAD_MIME_TYPES.has(file.type)) throw new Error("PNG / JPEG / WebP / GIF の画像を選んでください");
  if (file.type === "image/gif") return file;
  const img = await loadImage(file);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return file.type === "image/png" ? canvasToBlob(canvas, "image/png") : canvasToBlob(canvas, "image/jpeg", 0.88);
}
