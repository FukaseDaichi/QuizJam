import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Check, Clock, Gavel, Mic, NotebookPen, Tag, WifiOff, X } from "lucide-react";
import type { BuzzerView, ClientMessage, JudgeView } from "../../shared/messages";
import { useRoomSocket } from "../lib/useRoomSocket";
import { useRevealedCount } from "../lib/useRevealedCount";
import { api, ApiError } from "../lib/api";
import { storage } from "../lib/storage";
import { Card } from "../components/Card";
import { ConnectionBanner } from "../components/ConnectionBanner";

const QR_UNUSABLE = "この QR はもう使えません。GM 画面で出し直してください";

/** URL のフラグメント（`#pair=<コード>`）からペアリングコードを読む。無ければ null */
function readPairCode(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, "")).get("pair") || null;
}

/** フラグメントを消す。react-router の履歴の状態はそのまま残す */
function clearFragment() {
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
}

/**
 * GM の手元のスマホで開く判定用画面。GM 画面の使い捨て QR（`#pair=`）でトークンをもらい、
 * 以後は保存したトークンでつなぐ。早押しの出題中に答え・判定メモ・回答中の人を出し、正解・不正解を送る。音は鳴らさない
 */
export function JudgePage() {
  const { code = "" } = useParams();
  const roomCode = code.toUpperCase();
  const [pairCode] = useState(() => readPairCode(window.location.hash));
  const [token, setToken] = useState<string | null>(() => (pairCode ? null : storage.getJudgeToken(roomCode)));
  const [pairError, setPairError] = useState<"unusable" | "failed" | null>(null);
  // StrictMode の二重実行でコードを 2 回送ると 2 回目が 403 になるので、1 回だけ送る（結果は捨てない）
  const pairStarted = useRef(false);

  useEffect(() => {
    if (!pairCode || pairStarted.current) return;
    pairStarted.current = true;
    api.judgePair(roomCode, pairCode).then(
      ({ judgeToken }) => {
        storage.setJudgeToken(roomCode, judgeToken);
        clearFragment();
        setToken(judgeToken);
      },
      (e) => {
        if (e instanceof ApiError && e.status === 403) {
          clearFragment();
          // 使用済みの QR を開き直しただけなら、保存済みのトークンでつなぐ（切られていれば judgeRevoked や未接続の案内が出る）
          const saved = storage.getJudgeToken(roomCode);
          if (saved) setToken(saved);
          else setPairError("unusable");
        } else {
          // 通信の失敗などではコードはまだ使える。フラグメントを残し、再読み込みでやり直せるようにする
          setPairError("failed");
        }
      },
    );
  }, [roomCode, pairCode]);

  const { state, send } = useRoomSocket(roomCode, token);

  // 別の端末が判定用につながった。トークンを消して接続をやめる
  useEffect(() => {
    if (state.judgeRevoked) { storage.setJudgeToken(roomCode, null); setToken(null); }
  }, [state.judgeRevoked, roomCode]);

  // 未接続が 5 秒続いたら QR の読み取り直しを案内する（切られたトークンでは再接続を繰り返すだけになるため）
  const [longDisconnected, setLongDisconnected] = useState(false);
  useEffect(() => {
    setLongDisconnected(false);
    if (state.connected || !token) return;
    const t = setTimeout(() => setLongDisconnected(true), 5000);
    return () => clearTimeout(t);
  }, [state.connected, token]);

  const pairing = pairCode !== null && token === null && pairError === null;
  const judge = state.judge;
  const questioning = state.ready && state.phase === "question" && judge !== null && state.settings.mode !== "anagram";

  let body: ReactNode;
  if (state.judgeRevoked) {
    body = <Notice icon={WifiOff} text="別の端末が判定用につながりました" />;
  } else if (pairError === "unusable" || (!pairing && pairError === null && token === null)) {
    body = <Notice icon={X} text={QR_UNUSABLE} />;
  } else if (pairError === "failed") {
    body = <Notice icon={WifiOff} text="接続できませんでした。再読み込みしてください" />;
  } else if (pairing || !state.ready) {
    body = <p className="text-center text-slate-500">接続しています…</p>;
  } else if (state.settings.mode === "anagram") {
    body = <Notice icon={Gavel} text="このセットは自動判定です" />;
  } else if (questioning) {
    body = <JudgeQuestion judge={judge} buzzer={state.buzzer} clockOffsetMs={state.clockOffsetMs} send={send} />;
  } else {
    body = <Notice icon={Clock} text="次の問題を待っています" />;
  }

  return (
    <main className={`flex min-h-full flex-col gap-4 bg-slate-50 px-4 pt-6 ${questioning ? "" : "pb-8"}`}>
      {token && !state.judgeRevoked && <ConnectionBanner connected={state.connected} />}
      {token && !state.judgeRevoked && longDisconnected && (
        <p className="qj-slide-in rounded-xl bg-orange-50 px-4 py-3 text-center text-sm font-bold text-orange-700" role="status">
          つながらない場合は GM 画面の QR を読み取り直してください
        </p>
      )}
      {body}
    </main>
  );
}

function Notice({ icon: Icon, text }: { icon: typeof Clock; text: string }) {
  return (
    <Card className="text-center">
      <Icon size={36} className="mx-auto text-slate-400" aria-hidden />
      <p className="mt-3 text-xl font-black leading-snug break-words">{text}</p>
    </Card>
  );
}

/** 出題中の判定。答え・判定メモ・問題文（読まれた所まで濃く）・回答中の人と、画面下の「正解」「不正解」 */
function JudgeQuestion({ judge, buzzer, clockOffsetMs, send }: {
  judge: JudgeView; buzzer: BuzzerView | null; clockOffsetMs: number; send: (msg: ClientMessage) => void;
}) {
  const revealed = useRevealedCount(buzzer, judge.revealAtMs, clockOffsetMs);
  const chars = Array.from(judge.prompt);
  const answering = buzzer?.status === "paused" ? buzzer.queue[0] : undefined;
  const waiting = buzzer?.status === "paused" ? buzzer.queue.slice(1) : [];
  const judgeAnswer = (correct: boolean) => {
    if (answering) send({ type: "judge", participantId: answering.participantId, correct });
  };

  return (
    <>
      <header className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-sm font-bold text-slate-500">第{judge.questionNumber}問 / {judge.total}問</span>
        {judge.genre && (
          <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-purple-600 px-3 py-1 text-sm font-black text-white">
            <Tag size={14} className="shrink-0" aria-hidden /><span className="truncate">{judge.genre}</span>
          </span>
        )}
      </header>

      <Card title="答え" icon={Check}>
        <p className="text-4xl font-black leading-tight break-words">{judge.answers[0]}</p>
        {judge.answers.length > 1 && (
          <p className="mt-2 text-base break-words text-slate-600">別解: {judge.answers.slice(1).join("、")}</p>
        )}
      </Card>

      {judge.judgeNote && (
        <Card title="判定メモ" icon={NotebookPen}>
          <p className="whitespace-pre-wrap break-words text-base leading-relaxed">{judge.judgeNote}</p>
        </Card>
      )}

      {chars.length > 0 && (
        <Card title="問題文">
          <p className="whitespace-pre-wrap break-words text-lg font-bold leading-relaxed" aria-label={judge.prompt}>
            {chars.map((ch, i) => <span key={i} aria-hidden className={i < revealed ? "text-slate-900" : "text-slate-300"}>{ch}</span>)}
          </p>
        </Card>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4" aria-live="assertive">
        {answering ? (
          <>
            <p className="inline-flex max-w-full items-center gap-2 text-2xl font-black">
              <Mic size={24} className="shrink-0 text-purple-500" aria-hidden />
              <span className="break-words">回答中: <span className="text-brand">{answering.nickname}</span></span>
            </p>
            {waiting.length > 0 && <p className="mt-1 break-words text-slate-500">次: {waiting.map((w) => w.nickname).join(" → ")}</p>}
          </>
        ) : (
          <p className="text-slate-500">回答中の人はいません</p>
        )}
      </div>

      {/* 誤タップを防ぐため、画面下に大きく、2 つの間を空ける */}
      <div className="sticky bottom-0 -mx-4 mt-auto flex gap-8 border-t border-slate-200 bg-slate-50/95 px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <JudgeButton tone="correct" disabled={!answering} onClick={() => judgeAnswer(true)} />
        <JudgeButton tone="incorrect" disabled={!answering} onClick={() => judgeAnswer(false)} />
      </div>
    </>
  );
}

function JudgeButton({ tone, disabled, onClick }: { tone: "correct" | "incorrect"; disabled: boolean; onClick: () => void }) {
  const correct = tone === "correct";
  const Icon = correct ? Check : X;
  return (
    <button
      type="button" disabled={disabled} onClick={onClick}
      className={`inline-flex h-24 flex-1 items-center justify-center gap-2 rounded-2xl text-3xl font-black text-white transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 ${correct ? "bg-green-600 hover:bg-green-500" : "bg-red-600 hover:bg-red-500"}`}
    >
      <Icon size={32} aria-hidden />{correct ? "正解" : "不正解"}
    </button>
  );
}
