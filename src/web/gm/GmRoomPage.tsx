import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { ArrowRight, Crown, Home, Play, RotateCcw, Square, Users } from "lucide-react";
import { useRoomSocket } from "../lib/useRoomSocket";
import { api } from "../lib/api";
import { storage } from "../lib/storage";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Leaderboard } from "../components/Leaderboard";
import { CountdownTimer } from "../components/CountdownTimer";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { CorrectPopup } from "./CorrectPopup";
import { Confetti } from "./Confetti";
import type { QuestionSetSummary } from "../../shared/types";

export function GmRoomPage() {
  const { code = "" } = useParams();
  const roomCode = code.toUpperCase();
  const gmToken = useMemo(() => storage.getGmToken(roomCode), [roomCode]);
  const { state, send, dismissPopup, clearError } = useRoomSocket(roomCode, gmToken);
  const [sets, setSets] = useState<QuestionSetSummary[]>([]);
  const [setId, setSetId] = useState("");
  const [carryOver, setCarryOver] = useState(false);
  const [confettiSeed, setConfettiSeed] = useState(0);

  useEffect(() => {
    api.listQuestionSets().then((s) => {
      setSets(s);
      setSetId((cur) => cur || s[0]?.id || "");
    }).catch(() => {});
  }, []);
  useEffect(() => { if (state.popups.length) setConfettiSeed(state.popups[state.popups.length - 1].id); }, [state.popups]);
  useEffect(() => { if (state.lastError) { const t = setTimeout(clearError, 3000); return () => clearTimeout(t); } }, [state.lastError, clearError]);
  const onPopupDone = useCallback((id: number) => dismissPopup(id), [dismissPopup]);

  if (!gmToken) {
    return (
      <main className="flex min-h-full items-center justify-center bg-slate-900 text-slate-100">
        <p>このブラウザにはこのルームのGM権限がありません。<Link className="underline" to="/">トップへ</Link></p>
      </main>
    );
  }

  const joinUrl = `${location.origin}/play/${roomCode}`;
  const q = state.question;
  const connectedCount = state.participants.filter((p) => p.connected).length;

  return (
    <main className="grid min-h-full grid-rows-[auto_1fr_auto] bg-slate-900 text-slate-100">
      <ConnectionBanner connected={state.connected} />
      {confettiSeed > 0 && state.phase === "question" && <Confetti key={confettiSeed} seed={confettiSeed} />}

      <header className="flex items-center justify-between border-b border-slate-800 px-8 py-4">
        <h1 className="text-brand text-3xl font-black">QuizJam</h1>
        <div className="flex items-center gap-6 text-slate-300">
          <span className="font-mono text-2xl font-bold tracking-widest">{roomCode}</span>
          <span className="inline-flex items-center gap-1"><Users size={20} aria-hidden />{connectedCount}名</span>
          {state.questionSetName && <span>{state.questionSetName}</span>}
        </div>
      </header>

      <div className="grid grid-cols-[1fr_380px] gap-6 px-8 py-6">
        <section className="flex flex-col gap-6">
          {state.phase === "lobby" && (
            <div className="grid grid-cols-[auto_1fr] gap-8">
              <Card tone="dark" className="flex flex-col items-center">
                <div className="rounded-2xl bg-white p-4"><QRCodeSVG value={joinUrl} size={280} /></div>
                <p className="mt-4 break-all text-center text-sm text-slate-300">{joinUrl}</p>
                <p className="mt-1 font-mono text-4xl font-black tracking-widest">{roomCode}</p>
              </Card>
              <Card tone="dark" title="ゲーム設定" icon={Play}>
                <label className="block text-sm text-slate-400" htmlFor="question-set">問題セット</label>
                <select id="question-set" value={setId} onChange={(e) => setSetId(e.target.value)} className="mt-1 h-12 w-full rounded-xl bg-slate-700 px-3 text-lg">
                  {sets.map((s) => <option key={s.id} value={s.id}>{s.name}（{s.questionCount}問）</option>)}
                </select>
                <label className="mt-4 flex items-center gap-2 text-slate-300">
                  <input type="checkbox" checked={carryOver} onChange={(e) => setCarryOver(e.target.checked)} className="h-5 w-5" />
                  前のゲームのスコアを通算する
                </label>
                <Button className="mt-6 w-full" variant="brand" size="lg" icon={Play} disabled={!setId || connectedCount === 0} onClick={() => send({ type: "start", questionSetId: setId, carryOverScores: carryOver })}>開始する</Button>
                {connectedCount === 0 && <p className="mt-2 text-sm text-slate-400">参加者が入室すると開始できます</p>}
              </Card>
            </div>
          )}

          {(state.phase === "question" || state.phase === "questionResult") && q && (
            <Card tone="dark" className="flex flex-1 flex-col">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xl font-bold">第{q.index + 1}問 / {q.total}問</span>
                {state.phase === "question" && <CountdownTimer deadlineAt={q.deadlineAt} clockOffsetMs={state.clockOffsetMs} size="lg" />}
              </div>
              <div key={q.index} className="qj-pop my-auto flex min-h-0 flex-1 flex-col items-center justify-center gap-6 py-6">
                {q.imageUrl && <img src={q.imageUrl} alt="" className="min-h-0 max-h-[48vh] w-auto max-w-full flex-1 rounded-2xl object-contain" />}
                <p className={`break-all text-center font-black leading-tight tracking-widest ${q.imageUrl ? "text-5xl" : "text-7xl"}`}>{q.prompt}</p>
              </div>
              {state.phase === "question" && (
                <p className="text-center text-xl text-slate-300">正解者 {state.correctCountThisQuestion} / 参加者 {connectedCount}</p>
              )}
              {state.phase === "questionResult" && state.questionResult && (
                <div className="qj-slide-in rounded-2xl bg-slate-700/60 p-6 text-center">
                  <p className="text-sm font-bold text-slate-400">正解</p>
                  <p className="text-5xl font-black text-green-400">{state.questionResult.answers.join(" / ")}</p>
                  <ol className="mt-4 flex flex-wrap justify-center gap-3">
                    {state.questionResult.results.map((r) => (
                      <li key={r.participantId} className="rounded-xl bg-slate-800 px-4 py-2 text-lg"><b>{r.correctRank}.</b> {r.nickname} <span className="text-green-400">+{r.points}</span></li>
                    ))}
                    {state.questionResult.results.length === 0 && <li className="text-slate-400">正解者なし</li>}
                  </ol>
                </div>
              )}
            </Card>
          )}

          {state.phase === "finalResult" && (
            <Card tone="dark" title="最終結果" icon={Crown} className="flex-1">
              <Leaderboard entries={state.finalEntries ?? state.leaderboard} tone="dark" />
            </Card>
          )}
        </section>

        <aside>
          <Card tone="dark" title={state.phase === "lobby" ? "参加者" : "ランキング"} icon={state.phase === "lobby" ? Users : Crown} className="sticky top-6">
            {state.phase === "lobby" ? (
              <ul className="space-y-2">
                {state.participants.map((p) => (
                  <li key={p.id} className={`qj-slide-in rounded-xl bg-slate-700/60 px-3 py-2 text-lg ${p.connected ? "" : "opacity-40"}`}>{p.nickname}{!p.connected && "（切断）"}</li>
                ))}
                {state.participants.length === 0 && <li className="text-slate-400">QRコードを読み取って参加してもらいましょう</li>}
              </ul>
            ) : <Leaderboard entries={state.leaderboard} tone="dark" compact />}
          </Card>
        </aside>
      </div>

      <footer className="flex items-center justify-end gap-3 border-t border-slate-800 px-8 py-4">
        {state.phase === "question" && <Button variant="secondary" size="lg" icon={Square} onClick={() => send({ type: "close" })}>締切</Button>}
        {state.phase === "questionResult" && <Button variant="brand" size="lg" icon={ArrowRight} onClick={() => send({ type: "next" })}>{q && q.index + 1 >= q.total ? "最終結果へ" : "次の問題へ"}</Button>}
        {state.phase === "finalResult" && <Button variant="brand" size="lg" icon={RotateCcw} onClick={() => send({ type: "endGame" })}>もう1ゲーム</Button>}
        {(state.phase === "question" || state.phase === "questionResult") && <Button variant="secondary" size="lg" icon={Home} onClick={() => { if (confirm("ゲームを中断してロビーに戻りますか？")) send({ type: "endGame" }); }}>ロビーへ戻る</Button>}
        {state.phase === "lobby" && <Link to="/"><Button variant="secondary" size="lg">トップへ</Button></Link>}
      </footer>

      <div className="pointer-events-none fixed left-1/2 top-24 z-40 flex -translate-x-1/2 flex-col gap-3">
        {state.popups.map((p) => <CorrectPopup key={p.id} {...p} onDone={onPopupDone} />)}
      </div>
      {state.lastError && <p className="qj-slide-in fixed bottom-24 left-1/2 -translate-x-1/2 rounded-xl bg-red-600 px-4 py-3 font-bold text-white">{state.lastError.message}</p>}
    </main>
  );
}
