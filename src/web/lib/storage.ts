const key = (k: string) => `quizjam:${k}`;

function read<T>(k: string): T | null {
  try { const v = localStorage.getItem(key(k)); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function write(k: string, v: unknown): void {
  try { v === null ? localStorage.removeItem(key(k)) : localStorage.setItem(key(k), JSON.stringify(v)); } catch { /* ignore */ }
}

export interface StoredPlayer { participantId: string; participantToken: string; nickname: string }

export const storage = {
  getGmToken: (code: string) => read<string>(`gm:${code}`),
  setGmToken: (code: string, token: string) => write(`gm:${code}`, token),
  getPlayer: (code: string) => read<StoredPlayer>(`player:${code}`),
  setPlayer: (code: string, v: StoredPlayer) => write(`player:${code}`, v),
  getPassphrase: () => read<string>("admin"),
  setPassphrase: (v: string | null) => write("admin", v),
};
