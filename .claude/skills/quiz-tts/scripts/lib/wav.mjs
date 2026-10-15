/** RIFF/WAVE のヘッダを読んで長さを求める。チャンクは順に走査する */
export function wavInfo(buf) {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("WAV ではありません");
  }
  let pos = 12;
  let fmt = null;
  let dataSize = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt " && pos + 24 <= buf.length) {
      fmt = {
        channels: buf.readUInt16LE(pos + 10),
        sampleRate: buf.readUInt32LE(pos + 12),
        byteRate: buf.readUInt32LE(pos + 16),
        bitsPerSample: buf.readUInt16LE(pos + 22),
      };
    }
    if (id === "data") {
      dataSize = Math.min(size, buf.length - pos - 8);
      break;
    }
    pos += 8 + size + (size % 2);
  }
  if (!fmt || dataSize === null || fmt.byteRate === 0) throw new Error("WAV の fmt/data チャンクが見つかりません");
  return { ...fmt, dataSize, durationMs: Math.round((dataSize / fmt.byteRate) * 1000) };
}
