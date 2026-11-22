import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Crown, Lightbulb, Send, Tag, Users, X } from "lucide-react";
import { useRoomSocket } from "../lib/useRoomSocket";
import { storage } from "../lib/storage";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Leaderboard } from "../components/Leaderboard";
import { CountdownTimer } from "../components/CountdownTimer";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { GenreButtons, specialtiesText } from "../components/GenreButtons";
import { SPECIALTY_COUNT } from "../../shared/genre";
import { BuzzerPanel } from "./BuzzerPanel";
import { SpecialtyPicker } from "./SpecialtyPicker";

export function PlayPage() {
  const { code = "" } = useParams();
  const roomCode = code.toUpperCase();
  const navigate = useNavigate();
  const player = useMemo(() => storage.getPlayer(roomCode), [roomCode]);
  useEffect(() => { if (!player) navigate(`/play/${roomCode}`, { replace: true }); }, [player, roomCode, navigate]);

  const { state, send, clearError } = useRoomSocket(roomCode, player?.participantToken ?? null);
  // GM にキックされたら保存した参加情報を消して参加画面に戻す
  useEffect(() => {
    if (state.kicked) { storage.clearPlayer(roomCode); navigate(`/play/${roomCode}`, { replace: true, state: { kicked: true } }); }
  }, [state.kicked, roomCode, navigate]);
  const [text, setText] = useState("");
  const [shake, setShake] = useState(false);
  // ヒントは既定で隠し、参加者が「ヒントを見る」を押したときだけ表示する
  const [showHint, setShowHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 問題が切り替わったら入力をクリアしてフォーカス。ヒントは隠し直す
  useEffect(() => { setText(""); setShowHint(false); inputRef.current?.focus(); }, [state.question?.index]);
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
  const buzzerMode = q?.mode === "buzzer";
  // ジャンル制で得意ジャンルが未選択なら、ほかの表示の代わりに選択画面を出す（ロビー・最終結果では出さない）
  const picking = state.genres !== null && !!me && me.specialties === undefined
    && (state.phase === "intro" || state.phase === "question" || state.phase === "questionResult" || state.phase === "genreSelect");
  const phase = picking ? null : state.phase;
  const pickerNeed = Math.min(SPECIALTY_COUNT, (state.genres ?? []).filter((g) => g.remaining > 0).length);
  const bonusX2 = state.lastAnswerResult?.correct && state.lastAnswerResult.multiplier === 2;

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

      {state.ready && picking && state.genres && (
        <SpecialtyPicker genres={state.genres} need={pickerNeed} onDecide={(genres) => send({ type: "chooseSpecialties", genres })} />
      )}

      {state.ready && (phase === "lobby" || phase === "intro") && (
        <Card icon={Users} title="待機中">
          {state.phase === "intro" && state.questionSetName && <p className="text-brand text-sm font-bold">{state.questionSetName}</p>}
          <p className="text-2xl font-black">まもなく開始します</p>
          {state.genres !== null && me?.specialties && <p className="mt-2 font-bold text-slate-700">得意ジャンル: {specialtiesText(me.specialties)}</p>}
          <p className="mt-2 text-slate-600">参加者 {state.participants.filter((p) => p.connected).length}名</p>
        </Card>
      )}

      {state.ready && phase === "question" && q && buzzerMode && (
        <>
          <p className="text-sm font-bold text-slate-500">第{q.index + 1}問 / {q.total}問</p>
          <BuzzerPanel question={q} buzzer={state.buzzer} meId={me?.id} status={status} lastPoints={state.lastAnswerResult?.correct ? state.lastAnswerResult.points : null} multiplier={bonusX2 ? 2 : undefined} specialties={state.genres !== null ? me?.specialties : undefined} shake={shake} send={send} />
        </>
      )}

      {state.ready && phase === "question" && q && !buzzerMode && (
        <>
          <Card>
            <p className="text-sm font-bold text-slate-500">第{q.index + 1}問 / {q.total}問</p>
            {q.imageUrl && (
              <img key={q.index} src={q.imageUrl} alt="" style={q.background ? { backgroundColor: q.background } : undefined}
                className={`qj-pop mt-2 w-full rounded-xl bg-slate-100 object-contain ${q.prompt ? "max-h-56" : "max-h-[50vh]"}`} />
            )}
            {q.prompt && <p className="qj-pop mt-2 break-all text-4xl font-black leading-tight tracking-wider">{q.prompt}</p>}
            {q.hint && (
              <div className="mt-3">
                <button
                  type="button" onClick={() => setShowHint((v) => !v)} aria-expanded={showHint}
                  className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-600 active:scale-[0.98]"
                >
                  <Lightbulb size={16} aria-hidden />{showHint ? "ヒントを隠す" : "ヒントを見る"}
                </button>
                {showHint && <p className="qj-pop mt-2 text-slate-600">ヒント: {q.hint}</p>}
              </div>
            )}
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

      {state.ready && phase === "questionResult" && state.questionResult && (
        <Card className="text-center">
          {state.questionResult.explanationImageUrl && (
            <img src={state.questionResult.explanationImageUrl} alt="解説" className="qj-pop mb-3 max-h-64 w-full rounded-xl bg-slate-100 object-contain" />
          )}
          <p className="text-sm font-bold text-slate-500">正解</p>
          <p className="qj-pop mt-1 text-4xl font-black">{state.questionResult.answers[0]}</p>
          {state.questionResult.answers.length > 1 && <p className="text-slate-500">（{state.questionResult.answers.slice(1).join("、")}）</p>}
          <p className="mt-4 inline-flex items-center gap-1 text-lg">
            {status?.correct
              ? <><Check size={20} className="text-green-600" aria-hidden /><b className="text-green-700">正解しました</b></>
              : status && status.attemptsUsed > 0
                ? <><X size={20} className="text-red-500" aria-hidden /><b className="text-red-600">不正解でした</b></>
                // 一度も回答（早押し）していない人を「不正解」と言わない。早押しでは勝者以外のほとんどがこれ
                : <b className="text-slate-500">回答しませんでした</b>}
          </p>
          {status?.correct && state.lastAnswerResult?.correct && (
            <p className="qj-pop text-2xl font-black text-green-700">+{state.lastAnswerResult.points}点{bonusX2 && <span className="ml-2 rounded-lg bg-amber-400 px-2 py-0.5 align-middle text-base text-amber-950">×2</span>}</p>
          )}
          <p className="mt-2 text-slate-600">現在 <b className="text-slate-900">{myRank ?? "-"}位</b> / {me?.score ?? 0}点</p>
          <div className="mt-4 text-left"><Leaderboard entries={state.leaderboard.slice(0, 3)} meId={me?.id} compact /></div>
        </Card>
      )}

      {state.ready && phase === "genreSelect" && state.genreSelect && (
        state.genreSelect.picker.participantId === me?.id ? (
          <Card icon={Tag} title="ジャンル選択">
            <h2 className="mb-4 text-2xl font-black leading-tight">次のジャンルを選んでください</h2>
            <GenreButtons genres={state.genreSelect.genres} tone="light" marked={me?.specialties ?? []} onPick={(genre) => send({ type: "pickGenre", genre })} />
          </Card>
        ) : (
          <Card icon={Tag} title="ジャンル選択" className="text-center">
            <p className="text-2xl font-black leading-tight break-words"><span className="text-brand">{state.genreSelect.picker.nickname}</span>さんがジャンルを選んでいます</p>
          </Card>
        )
      )}

      {state.ready && phase === "finalResult" && (
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
