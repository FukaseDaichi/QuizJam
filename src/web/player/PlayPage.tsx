import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Crown, Send, Users, X } from "lucide-react";
import { useRoomSocket } from "../lib/useRoomSocket";
import { storage } from "../lib/storage";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Leaderboard } from "../components/Leaderboard";
import { CountdownTimer } from "../components/CountdownTimer";
import { ConnectionBanner } from "../components/ConnectionBanner";

export function PlayPage() {
  const { code = "" } = useParams();
  const roomCode = code.toUpperCase();
  const navigate = useNavigate();
  const player = useMemo(() => storage.getPlayer(roomCode), [roomCode]);
  useEffect(() => { if (!player) navigate(`/play/${roomCode}`, { replace: true }); }, [player, roomCode, navigate]);

  const { state, send, clearError } = useRoomSocket(roomCode, player?.participantToken ?? null);
  const [text, setText] = useState("");
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 問題が切り替わったら入力をクリアしてフォーカス
  useEffect(() => { setText(""); inputRef.current?.focus(); }, [state.question?.index]);
  // 不正解で揺らす
  useEffect(() => {
    if (state.lastAnswerResult && !state.lastAnswerResult.correct) {
      setShake(true);
      const t = setTimeout(() => setShake(false), 300);
      return () => clearTimeout(t);
    }
  }, [state.lastAnswerResult]);
  useEffect(() => {
    if (state.lastError) { const t = setTimeout(clearError, 2500); return () => clearTimeout(t); }
  }, [state.lastError, clearError]);

  if (!player) return null;
  const me = state.me;
  const myRank = state.leaderboard.find((e) => e.participantId === me?.id)?.rank;
  const status = me?.status;
  const q = state.question;
  const remaining = q?.maxAttempts == null ? null : Math.max(0, q.maxAttempts - (status?.attemptsUsed ?? 0));
  const canAnswer = state.phase === "question" && !status?.correct && (remaining === null || remaining > 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !canAnswer) return;
    send({ type: "answer", text });
    setText("");
  };

  return (
    <main className="flex min-h-full flex-col gap-4 bg-slate-50 px-4 pb-8 pt-6">
      <ConnectionBanner connected={state.connected} />
      <header className="flex items-center justify-between text-sm text-slate-500">
        <span className="font-bold text-slate-800">{me?.nickname ?? player.nickname}</span>
        <span>{myRank ? `${myRank}位` : "-"} / {me?.score ?? 0}点</span>
      </header>

      {!state.ready && <p className="text-center text-slate-500">接続しています…</p>}

      {state.ready && state.phase === "lobby" && (
        <Card icon={Users} title="待機中">
          <p className="text-2xl font-black">まもなく開始します</p>
          <p className="mt-2 text-slate-600">参加者 {state.participants.filter((p) => p.connected).length}名</p>
        </Card>
      )}

      {state.ready && state.phase === "question" && q && (
        <>
          <Card>
            <p className="text-sm font-bold text-slate-500">第{q.index + 1}問 / {q.total}問</p>
            {q.imageUrl && <img key={q.index} src={q.imageUrl} alt="" className="qj-pop mt-2 max-h-56 w-full rounded-xl bg-slate-100 object-contain" />}
            <p className="qj-pop mt-2 break-all text-4xl font-black leading-tight tracking-wider">{q.prompt}</p>
            {q.hint && <p className="mt-2 text-slate-500">ヒント: {q.hint}</p>}
            <div className="mt-4"><CountdownTimer deadlineAt={q.deadlineAt} clockOffsetMs={state.clockOffsetMs} /></div>
          </Card>

          {status?.correct ? (
            <Card className="qj-pop border-green-300 bg-green-50 text-center">
              <Crown size={40} className="mx-auto text-green-600" aria-hidden />
              <p className="mt-2 text-5xl font-black text-green-700">正解！</p>
              <p className="mt-1 text-lg font-bold text-green-800">{status.correctRank}番目の正解です！</p>
              {state.lastAnswerResult?.correct && <p className="text-2xl font-black text-green-700">+{state.lastAnswerResult.points}点</p>}
            </Card>
          ) : (
            <form onSubmit={submit} className={`flex flex-col gap-3 ${shake ? "qj-shake" : ""}`}>
              <input
                ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} disabled={!canAnswer}
                className="h-14 rounded-xl border border-slate-300 bg-white px-4 text-2xl outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-200 disabled:bg-slate-100"
                placeholder={canAnswer ? "答えを入力" : "回答できません"} autoComplete="off" enterKeyHint="send"
              />
              <Button type="submit" variant="brand" size="lg" icon={Send} disabled={!canAnswer || !text.trim()}>回答する</Button>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">残り回答回数: <b>{remaining === null ? "無制限" : `${remaining}回`}</b></span>
                {state.lastAnswerResult && !state.lastAnswerResult.correct && (
                  <span className="inline-flex items-center gap-1 font-bold text-red-600"><X size={16} aria-hidden />不正解…</span>
                )}
              </div>
              {remaining === 0 && <p className="text-center font-bold text-red-600">回答回数の上限に達しました</p>}
            </form>
          )}
        </>
      )}

      {state.ready && state.phase === "questionResult" && state.questionResult && (
        <Card className="text-center">
          <p className="text-sm font-bold text-slate-500">正解</p>
          <p className="qj-pop mt-1 text-4xl font-black">{state.questionResult.answers[0]}</p>
          {state.questionResult.answers.length > 1 && <p className="text-slate-500">（{state.questionResult.answers.slice(1).join("、")}）</p>}
          <p className="mt-4 inline-flex items-center gap-1 text-lg">
            {status?.correct
              ? <><Check size={20} className="text-green-600" aria-hidden /><b className="text-green-700">正解しました</b></>
              : <><X size={20} className="text-red-500" aria-hidden /><b className="text-red-600">不正解でした</b></>}
          </p>
          <p className="mt-2 text-slate-600">現在 <b className="text-slate-900">{myRank ?? "-"}位</b> / {me?.score ?? 0}点</p>
          <div className="mt-4 text-left"><Leaderboard entries={state.leaderboard.slice(0, 3)} meId={me?.id} compact /></div>
        </Card>
      )}

      {state.ready && state.phase === "finalResult" && (
        <Card title="最終結果" icon={Crown}>
          <p className="qj-pop text-center text-5xl font-black">{myRank ?? "-"}位</p>
          <p className="text-center text-slate-600">{me?.score ?? 0}点</p>
          <div className="mt-4"><Leaderboard entries={state.finalEntries ?? state.leaderboard} meId={me?.id} /></div>
        </Card>
      )}

      {state.lastError && (
        <p className="qj-slide-in fixed inset-x-4 bottom-4 rounded-xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white">{state.lastError.message}</p>
      )}
    </main>
  );
}
