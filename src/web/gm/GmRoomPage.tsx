import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { ArrowRight, Check, Crown, Home, PanelRightClose, PanelRightOpen, Play, RotateCcw, Settings, Square, Users, X } from "lucide-react";
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
import { GmControlPanel } from "./GmControlPanel";
import { BuzzerQuestion } from "./BuzzerQuestion";
import { unlockAudio } from "../lib/buzzerAudio";
import { buzzerScreenPromptSizeClass } from "../lib/slideText";
import { isLightColor } from "../lib/color";
import { IntroSlidePreview, TitleSlidePreview } from "../components/Slides";
import type { QuestionSetSummary } from "../../shared/types";

export function GmRoomPage() {
  const { code = "" } = useParams();
  const roomCode = code.toUpperCase();
  const gmToken = useMemo(() => storage.getGmToken(roomCode), [roomCode]);
  const { state, send, dismissPopup, clearError } = useRoomSocket(roomCode, gmToken);
  const [sets, setSets] = useState<QuestionSetSummary[]>([]);
  const [setId, setSetId] = useState("");
  const [carryOver, setCarryOver] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  // 集中モード: 右カラムを外して問題を横幅いっぱいに映す。GM の好みとしてブラウザに保存する
  const [focus, setFocus] = useState(() => storage.getGmFocus());
  const toggleFocus = useCallback(() => setFocus((f) => { storage.setGmFocus(!f); return !f; }), []);

  useEffect(() => {
    api.listQuestionSets().then((s) => {
      setSets(s);
      setSetId((cur) => cur || s[0]?.id || "");
    }).catch(() => {});
  }, []);
  // 紙吹雪はポップアップごとに噴射する。早押しの正解は someoneCorrect の直後に問題結果へ移るので、フェーズには結び付けない
  const latestPopup = state.popups[state.popups.length - 1];
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
  const intro = state.intro;
  // ロビーと intro の間は入室が続くので、順位表ではなく参加者一覧を出す
  const showParticipants = state.phase === "lobby" || state.phase === "intro";
  const connectedCount = state.participants.filter((p) => p.connected).length;
  // 問題スライドの背景色が明るいときは、カード内の文字を濃い色にする
  const light = !!q?.background && isLightColor(q.background);
  // 画像はヘッダーやカード内の表示を除いた残りの高さいっぱいに。出題文・結果パネルがあるときはその分だけ縮める
  const imageHeight = state.phase === "questionResult" ? "max-h-[calc(100vh-36rem)]" : q?.prompt ? "max-h-[calc(100vh-30rem)]" : "max-h-[calc(100vh-24rem)]";
  // 結果表示中に解説画像があれば、問題画像と出題文の代わりに解説画像だけを映す
  const explanationImageUrl = state.phase === "questionResult" ? state.questionResult?.explanationImageUrl : undefined;
  const buzzerMode = q?.mode === "buzzer";
  const buzzer = state.buzzer;

  return (
    <main className="grid min-h-full grid-rows-[auto_1fr_auto] bg-slate-900 text-slate-100">
      <ConnectionBanner connected={state.connected} />
      <Confetti burst={latestPopup?.id ?? 0} />

      <header className="flex items-center justify-between border-b border-slate-800 px-8 py-4">
        <h1 className="text-brand text-3xl font-black">QuizJam</h1>
        <div className="flex items-center gap-6 text-slate-300">
          <span className="font-mono text-2xl font-bold tracking-widest">{roomCode}</span>
          <span className="inline-flex items-center gap-1"><Users size={20} aria-hidden />{connectedCount}名</span>
          {state.questionSetName && <span>{state.questionSetName}</span>}
          <Button variant="secondary" icon={focus ? PanelRightOpen : PanelRightClose} onClick={toggleFocus} aria-pressed={focus}>{focus ? "通常表示" : "集中モード"}</Button>
          <Button variant="secondary" icon={Settings} onClick={() => setPanelOpen(true)} aria-haspopup="dialog" aria-expanded={panelOpen}>管理</Button>
        </div>
      </header>

      <div className={`grid gap-6 px-8 py-6 ${focus ? "grid-cols-1" : "grid-cols-[1fr_380px]"}`}>
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

          {state.phase === "intro" && intro && (
            <div key={intro.index} className="qj-pop mx-auto my-auto w-full max-w-5xl">
              {intro.slide.kind === "title"
                ? <TitleSlidePreview name={intro.slide.name} coverImageUrl={intro.slide.coverImageUrl} questionCount={intro.slide.questionCount} settings={intro.slide.settings} mode={intro.slide.mode} audio={intro.slide.audio} />
                : <IntroSlidePreview heading={intro.slide.heading} body={intro.slide.body} imageUrl={intro.slide.imageUrl} />}
            </div>
          )}

          {(state.phase === "question" || state.phase === "questionResult") && q && (
            <Card tone={light ? "light" : "dark"} className="flex flex-1 flex-col" style={q.background ? { backgroundColor: q.background, borderColor: q.background } : undefined}>
              {buzzerMode && state.phase === "question" ? (
                <BuzzerQuestion question={q} buzzer={buzzer} clockOffsetMs={state.clockOffsetMs} light={light} imageHeight={imageHeight} />
              ) : (
                <>
                  <div className={`flex items-center justify-between ${light ? "text-slate-500" : "text-slate-400"}`}>
                    <span className="text-xl font-bold">第{q.index + 1}問 / {q.total}問</span>
                    {state.phase === "question" && <CountdownTimer deadlineAt={q.deadlineAt} clockOffsetMs={state.clockOffsetMs} size="lg" />}
                  </div>
                  <div key={explanationImageUrl ? `${q.index}-explanation` : q.index} className="qj-pop my-auto flex min-h-0 flex-1 flex-col items-center justify-center gap-6 py-4">
                    {explanationImageUrl ? (
                      <img src={explanationImageUrl} alt="解説" className={`min-h-0 ${imageHeight} w-auto max-w-full flex-1 rounded-2xl object-contain`} />
                    ) : (
                      <>
                        {q.imageUrl && <img src={q.imageUrl} alt="" className={`min-h-0 ${imageHeight} w-auto max-w-full flex-1 rounded-2xl object-contain`} />}
                        {q.prompt && (buzzerMode
                          ? <p className={`w-full whitespace-pre-wrap break-words text-left font-bold leading-snug ${buzzerScreenPromptSizeClass(Array.from(q.prompt).length)}`}>{q.prompt}</p>
                          : <p className={`break-all text-center font-black leading-tight tracking-widest ${q.imageUrl ? "text-5xl" : "text-7xl"}`}>{q.prompt}</p>)}
                      </>
                    )}
                  </div>
                  {state.phase === "question" && (
                    <p className={`text-center text-xl ${light ? "text-slate-600" : "text-slate-300"}`}>正解者 {state.correctCountThisQuestion} / 参加者 {connectedCount}</p>
                  )}
                </>
              )}
              {state.phase === "questionResult" && state.questionResult && (
                <div className={`qj-slide-in rounded-2xl p-6 text-center ${light ? "bg-white/70" : "bg-slate-700/60"}`}>
                  <p className={`text-sm font-bold ${light ? "text-slate-500" : "text-slate-400"}`}>正解</p>
                  <p className={`text-5xl font-black ${light ? "text-green-700" : "text-green-400"}`}>{state.questionResult.answers.join(" / ")}</p>
                  <ol className="mt-4 flex flex-wrap justify-center gap-3">
                    {state.questionResult.results.map((r) => (
                      <li key={r.participantId} className={`rounded-xl px-4 py-2 text-lg ${light ? "bg-white" : "bg-slate-800"}`}><b>{r.correctRank}.</b> {r.nickname} <span className={light ? "text-green-700" : "text-green-400"}>+{r.points}</span></li>
                    ))}
                    {state.questionResult.results.length === 0 && <li className={light ? "text-slate-500" : "text-slate-400"}>正解者なし</li>}
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

        {!focus && <aside>
          <Card tone="dark" title={showParticipants ? "参加者" : "ランキング"} icon={showParticipants ? Users : Crown} className="sticky top-6">
            {showParticipants ? (
              <ul className="space-y-2">
                {state.participants.map((p) => (
                  <li key={p.id} className={`qj-slide-in rounded-xl bg-slate-700/60 px-3 py-2 text-lg ${p.connected ? "" : "opacity-40"}`}>{p.nickname}{!p.connected && "（切断）"}</li>
                ))}
                {state.participants.length === 0 && <li className="text-slate-400">QRコードを読み取って参加してもらいましょう</li>}
              </ul>
            ) : <Leaderboard entries={state.leaderboard} tone="dark" compact />}
          </Card>
        </aside>}
      </div>

      <footer className="flex items-center justify-end gap-3 border-t border-slate-800 px-8 py-4">
        {state.phase === "intro" && intro && (
          <Button variant="brand" size="lg" icon={ArrowRight} onClick={() => send({ type: "next" })}>{intro.index + 1 >= intro.total ? "第1問へ" : "次へ"}</Button>
        )}
        {state.phase === "question" && buzzerMode && buzzer?.status === "ready" && (
          <Button variant="brand" size="lg" icon={Play} onClick={() => { unlockAudio(); send({ type: "startReading" }); }}>読み上げ開始</Button>
        )}
        {state.phase === "question" && buzzerMode && buzzer?.status === "paused" && buzzer.queue.length > 0 && (
          <>
            <Button variant="success" size="lg" icon={Check} onClick={() => send({ type: "judge", participantId: buzzer.queue[0].participantId, correct: true })}>正解</Button>
            <Button variant="danger" size="lg" icon={X} onClick={() => send({ type: "judge", participantId: buzzer.queue[0].participantId, correct: false })}>不正解</Button>
          </>
        )}
        {state.phase === "question" && <Button variant="secondary" size="lg" icon={Square} onClick={() => send({ type: "close" })}>締切</Button>}
        {state.phase === "questionResult" && <Button variant="brand" size="lg" icon={ArrowRight} onClick={() => send({ type: "next" })}>{q && q.index + 1 >= q.total ? "最終結果へ" : "次の問題へ"}</Button>}
        {state.phase === "finalResult" && <Button variant="brand" size="lg" icon={RotateCcw} onClick={() => send({ type: "endGame" })}>もう1ゲーム</Button>}
        {(state.phase === "intro" || state.phase === "question" || state.phase === "questionResult") && <Button variant="secondary" size="lg" icon={Home} onClick={() => { if (confirm("ゲームを中断してロビーに戻りますか？")) send({ type: "endGame" }); }}>ロビーへ戻る</Button>}
        {state.phase === "lobby" && <Link to="/"><Button variant="secondary" size="lg">トップへ</Button></Link>}
      </footer>

      <GmControlPanel open={panelOpen} onClose={closePanel} settings={state.settings} participants={state.participants} joinUrl={joinUrl} send={send} />

      <div className="pointer-events-none fixed left-1/2 top-24 z-40 flex -translate-x-1/2 flex-col gap-3">
        {state.popups.map((p) => <CorrectPopup key={p.id} {...p} onDone={onPopupDone} />)}
      </div>
      {state.lastError && <p className="qj-slide-in fixed bottom-24 left-1/2 -translate-x-1/2 rounded-xl bg-red-600 px-4 py-3 font-bold text-white">{state.lastError.message}</p>}
    </main>
  );
}
