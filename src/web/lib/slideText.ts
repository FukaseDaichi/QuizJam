/**
 * 説明スライド本文の文字サイズ（コンテナ幅基準の cqw）。長いほど小さくして 1000 文字でも 16:9 に収める。
 * 画像があるときは画像を主役にするため一段小さい。
 */
export function introBodySizeClass(length: number, hasImage: boolean): string {
  if (hasImage) return length <= 120 ? "text-[2.2cqw]" : length <= 300 ? "text-[1.8cqw]" : "text-[1.5cqw]";
  return length <= 200 ? "text-[3cqw]" : length <= 450 ? "text-[2.4cqw]" : length <= 700 ? "text-[1.9cqw]" : "text-[1.5cqw]";
}

/** 早押しの問題文（読み上げる一文）は長いので、長さに応じて段階的に小さくする。スライド（cqw）用 */
export function buzzerSlidePromptSizeClass(len: number): string {
  if (len <= 40) return "text-[5cqw]";
  if (len <= 100) return "text-[4cqw]";
  return "text-[3cqw]";
}

/** 同じ段階を GM 画面（rem 基準）で */
export function buzzerScreenPromptSizeClass(len: number): string {
  if (len <= 40) return "text-5xl";
  if (len <= 100) return "text-4xl";
  return "text-3xl";
}
