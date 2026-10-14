import { useEffect, useRef, type ReactNode } from "react";
import { Crown, Mic, X, Zap } from "lucide-react";
import type { BuzzerView, ClientMessage, MyAnswerStatus, QuestionView } from "../../shared/messages";
import { Card } from "../components/Card";

/**
 * 早押しモードの参加者画面。問題文は出さず、画面の大半を早押しボタンにする。
 * 状態はサーバーの BuzzerView と自分の回答状況だけで決める
 */
export function BuzzerPanel({ question, buzzer, meId, status, lastPoints, shake, send }: {
  question: QuestionView; buzzer: BuzzerView | null; meId: string | undefined; status: MyAnswerStatus | null | undefined;
  lastPoints: number | null; shake: boolean; send: (msg: ClientMessage) => void;
}) {
  const position = meId && buzzer ? buzzer.queue.findIndex((x) => x.participantId === meId) + 1 : 0;   // 0 = キューに居ない
  const lockedOut = !!meId && !!buzzer?.lockedOut.includes(meId);
  const answering = buzzer?.status === "paused" ? buzzer.queue[0] : undefined;
  const canBuzz = !!buzzer && buzzer.status !== "ready" && position === 0 && !lockedOut && !status?.correct;

  // 自分がキューに入った瞬間に短く振動させる（対応端末のみ）
  const wasQueued = useRef(false);
  useEffect(() => {
    if (position > 0 && !wasQueued.current) navigator.vibrate?.(50);
    wasQueued.current = position > 0;
  }, [position]);

  if (status?.correct) {
    return (
      <Card className="qj-pop border-green-300 bg-green-50 text-center">
        <Crown size={40} className="mx-auto text-green-600" aria-hidden />
        <p className="mt-2 text-5xl font-black text-green-700">正解！</p>
        {lastPoints !== null && <p className="text-2xl font-black text-green-700">+{lastPoints}点</p>}
      </Card>
    );
  }

  let caption: ReactNode;
  if (!buzzer || buzzer.status === "ready") caption = <p className="text-xl font-bold text-slate-500">読み上げを待っています</p>;
  else if (lockedOut) caption = <p className="inline-flex items-center gap-1 text-xl font-bold text-red-600"><X size={20} aria-hidden />不正解… この問題はもう押せません</p>;
  else if (position === 1) caption = (
    <div className="qj-pop text-center">
      {/* text-brand は color: transparent なので Lucide には付けない（線が消える） */}
      <Mic size={48} className="mx-auto text-purple-500" aria-hidden />
      <p className="text-brand mt-2 text-4xl font-black">あなたの番！</p>
      <p className="mt-1 text-lg font-bold text-slate-700">口頭で答えてください</p>
    </div>
  );
  else if (position > 1) caption = <p className="text-xl font-bold text-slate-700">{position}番目に押しました。{answering?.nickname}さんの回答を待っています</p>;
  else if (answering) caption = <p className="text-lg text-slate-600">{answering.nickname}さんが回答中。押すと次の順番に並びます</p>;
  else caption = <p className="text-xl font-bold text-slate-700">第{question.index + 1}問</p>;

  return (
    <div className={`flex flex-1 flex-col items-center justify-center gap-8 ${shake ? "qj-shake" : ""}`}>
      <div className="min-h-16 text-center" aria-live="polite">{caption}</div>
      {position === 0 && (
        <button
          type="button" onClick={() => send({ type: "buzz" })} disabled={!canBuzz} aria-label="早押し"
          className="bg-brand flex aspect-square w-[min(80vw,22rem)] flex-col items-center justify-center gap-2 rounded-full text-4xl font-black text-white shadow-2xl shadow-purple-500/30 transition active:scale-95 disabled:opacity-30 disabled:shadow-none"
        >
          <Zap size={56} aria-hidden />早押し！
        </button>
      )}
    </div>
  );
}
