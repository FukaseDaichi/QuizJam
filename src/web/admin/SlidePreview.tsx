import { Timer } from "lucide-react";
import type { Question, QuestionSettings } from "../../shared/types";

/**
 * GM 画面に映る見た目を模した 16:9 のスライドプレビュー。
 * 文字サイズはコンテナ幅（cqw）基準なので、サムネイルでも大画面でも同じ比率で表示される。
 */
export function TitleSlidePreview({ name, coverImageUrl, questionCount, settings, compact = false }: {
  name: string; coverImageUrl?: string; questionCount: number; settings: QuestionSettings; compact?: boolean;
}) {
  const timer = settings.timerMode === "none" ? "GMが締切" : settings.timerMode === "fixed" ? `${settings.timerSeconds}秒` : `正解後${settings.timerSeconds}秒`;
  return (
    <SlideFrame>
      {coverImageUrl && <img src={coverImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />}
      <div className="relative flex h-full flex-col items-center justify-center gap-[2cqw] px-[6cqw] text-center">
        <p className="text-[2.2cqw] font-bold tracking-[0.3em] text-slate-300">QuizJam</p>
        <h2 className={`text-brand break-all font-black leading-tight ${name ? "text-[7cqw]" : "text-[5cqw] opacity-40"}`}>{name || "企画名を入力"}</h2>
        {!compact && (
          <p className="text-[2.4cqw] text-slate-300">
            全{questionCount}問 ・ <Timer className="inline h-[2.4cqw] w-[2.4cqw] align-[-0.15em]" aria-hidden /> {timer}
            {settings.maxAttempts !== null && ` ・ お手付き${settings.maxAttempts}回まで`}
          </p>
        )}
      </div>
    </SlideFrame>
  );
}

export function QuestionSlidePreview({ question, index, total, settings, compact = false }: {
  question: Question; index: number; total: number; settings: QuestionSettings; compact?: boolean;
}) {
  const hasImage = !!question.imageUrl;
  return (
    <SlideFrame>
      <div className="flex h-full flex-col px-[4cqw] py-[3cqw]">
        <div className="flex items-center justify-between text-[2.4cqw] font-bold text-slate-400">
          <span>第{index + 1}問 / {total}問</span>
          {!compact && settings.timerMode !== "none" && (
            <span className="inline-flex items-center gap-[0.6cqw] rounded-[1.2cqw] bg-amber-100 px-[1.6cqw] py-[0.4cqw] text-amber-900">
              <Timer className="h-[2.4cqw] w-[2.4cqw]" aria-hidden />{settings.timerSeconds}<span className="text-[1.6cqw]">秒</span>
            </span>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[2cqw]">
          {hasImage && <img src={question.imageUrl} alt="" className="min-h-0 max-h-[52cqw] w-auto max-w-full flex-1 rounded-[1.5cqw] object-contain" />}
          <p className={`break-all text-center font-black leading-tight tracking-widest ${
            question.prompt ? (hasImage ? "text-[6cqw]" : "text-[9cqw]") : "text-[4cqw] text-slate-500"
          }`}>{question.prompt || "出題文を入力"}</p>
          {!compact && question.hint && <p className="text-[2.4cqw] text-slate-400">ヒント: {question.hint}</p>}
        </div>
      </div>
    </SlideFrame>
  );
}

function SlideFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-900 text-slate-100 ring-1 ring-slate-700">
      <div className="absolute inset-0">{children}</div>
    </div>
  );
}
