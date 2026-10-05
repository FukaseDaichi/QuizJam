import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LogIn } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { storage } from "../lib/storage";
import { Button } from "../components/Button";

export function JoinPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const roomCode = code.toUpperCase();
  const [nickname, setNickname] = useState("");
  const [exists, setExists] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (storage.getPlayer(roomCode)) { navigate(`/play/${roomCode}/game`, { replace: true }); return; }
    api.roomExists(roomCode).then(setExists).catch(() => setExists(false));
  }, [roomCode, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = nickname.trim();
    if (!name) return;
    setBusy(true); setError(null);
    try {
      const r = await api.join(roomCode, name);
      storage.setPlayer(roomCode, { participantId: r.participantId, participantToken: r.participantToken, nickname: name });
      navigate(`/play/${roomCode}/game`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? "ルームが見つかりません" : "参加できませんでした。もう一度お試しください");
    } finally { setBusy(false); }
  };

  if (exists === false) {
    return <main className="flex min-h-full flex-col items-center justify-center bg-slate-50 p-6 text-center">
      <h1 className="text-2xl font-black">ルームが見つかりません</h1>
      <p className="mt-2 text-slate-600">QRコードをもう一度読み取ってください。</p>
    </main>;
  }

  return (
    <main className="flex min-h-full flex-col bg-slate-50 px-6 py-10">
      <h1 className="text-brand text-center text-4xl font-black">QuizJam</h1>
      <p className="mt-2 text-center text-slate-500">ルーム <span className="font-mono font-bold text-slate-800">{roomCode}</span></p>
      <form onSubmit={submit} className="mt-10 flex flex-col gap-4">
        <label className="text-sm font-bold text-slate-700" htmlFor="nickname">ニックネーム</label>
        <input
          id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={20} autoFocus
          className="h-14 rounded-xl border border-slate-300 bg-white px-4 text-xl outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
          placeholder="例: みさき"
        />
        {error && <p className="text-sm font-bold text-red-600">{error}</p>}
        <Button type="submit" variant="brand" size="lg" icon={LogIn} disabled={!nickname.trim() || busy || exists === null}>参加する</Button>
      </form>
    </main>
  );
}
