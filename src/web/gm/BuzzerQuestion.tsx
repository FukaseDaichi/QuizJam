import { Loader, Mic, Volume2, VolumeX, Zap } from "lucide-react";
import type { BuzzerView, QuestionView } from "../../shared/messages";
import { Button } from "../components/Button";
import { buzzerScreenPromptSizeClass } from "../lib/slideText";
import { useRevealedCount } from "../lib/useRevealedCount";
import { unlockAudio, useBuzzerAudio, useQuestionAudio } from "../lib/buzzerAudio";

const STATUS_LABEL: Record<BuzzerView["status"], string> = {
  ready: "読み上げ待ち",
  reading: "読み上げ中",
  paused: "回答中",
};

/**
 * GM 画面の早押し出題。問題文は全文を描画しておき、未表示の文字を透明にする（レイアウトが動かない）。
 * 画像はその上に出す。回答中は回答者と待ち行列を問題文の下に出す。
 * 問読み音声があれば読み込んでおき、早押しの状態に合わせて流す・止める。文字は音声のタイミング表で出す
 */
export function BuzzerQuestion({ question, buzzer, clockOffsetMs, light, imageHeight }: {
  question: QuestionView; buzzer: BuzzerView | null; clockOffsetMs: number; light: boolean; imageHeight: string;
}) {
  const revealed = useRevealedCount(buzzer, question.audio?.revealAtMs, clockOffsetMs);
  const audio = useQuestionAudio(question.audio?.url);
  const { blocked } = useBuzzerAudio(audio.buffer, buzzer, clockOffsetMs);
  const chars = Array.from(question.prompt);
  const finished = buzzer?.status === "reading" && revealed >= chars.length;
  const status = !buzzer ? "" : finished ? "読み上げ終了・早押し待ち" : STATUS_LABEL[buzzer.status];
  const answering = buzzer?.status === "paused" ? buzzer.queue[0] : undefined;
  const waiting = buzzer?.status === "paused" ? buzzer.queue.slice(1) : [];
  const muted = light ? "text-slate-500" : "text-slate-400";

  return (
    <>
      <div className={`flex items-center justify-between ${muted}`}>
        <span className="inline-flex items-center gap-4">
          <span className="text-xl font-bold">第{question.index + 1}問 / {question.total}問</span>
          {audio.status === "loading" && <span className="inline-flex items-center gap-1 text-base"><Loader size={18} className="animate-spin" aria-hidden />音声 準備中</span>}
          {audio.status === "error" && <span className="inline-flex items-center gap-1 text-base text-red-400"><VolumeX size={18} aria-hidden />音声を読み込めません</span>}
          {blocked && <Button variant="secondary" icon={Volume2} onClick={unlockAudio}>音声を有効にする</Button>}
        </span>
        <span className="inline-flex items-center gap-2 text-xl font-bold" aria-live="polite"><Zap size={20} aria-hidden />{status}</span>
      </div>
      <div key={question.index} className="qj-pop my-auto flex min-h-0 flex-1 flex-col items-center justify-center gap-6 py-4">
        {question.imageUrl && <img src={question.imageUrl} alt="" className={`min-h-0 ${imageHeight} w-auto max-w-full flex-1 rounded-2xl object-contain`} />}
        <p className={`w-full whitespace-pre-wrap break-words text-left font-bold leading-snug ${buzzerScreenPromptSizeClass(chars.length)}`} aria-label={chars.slice(0, revealed).join("")}>
          {chars.map((ch, i) => <span key={i} aria-hidden className={i < revealed ? "" : "opacity-0"}>{ch}</span>)}
        </p>
      </div>
      {answering && (
        <div className={`qj-slide-in rounded-2xl p-5 text-center ${light ? "bg-white/70" : "bg-slate-700/60"}`} aria-live="assertive">
          {/* text-brand は color: transparent で文字をグラデーション化するので、currentColor を使う Lucide には付けない */}
          <p className="inline-flex items-center gap-3 text-5xl font-black"><Mic size={40} className="text-purple-500" aria-hidden /><span className="text-brand">{answering.nickname}さん 回答中</span></p>
          {waiting.length > 0 && <p className={`mt-3 text-xl ${muted}`}>次: {waiting.map((w) => w.nickname).join(" → ")}</p>}
        </div>
      )}
    </>
  );
}
