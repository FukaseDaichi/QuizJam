import { Timer, Zap } from "lucide-react";
import type { Question, QuestionSetMode, QuestionSettings } from "../../shared/types";
import { isLightColor } from "../lib/color";
import { buzzerSlidePromptSizeClass, introBodySizeClass } from "../lib/slideText";
import { promptLength } from "../../shared/buzzer";

/**
 * GM 画面に映る見た目を模した 16:9 のスライドプレビュー。
 * 文字サイズはコンテナ幅（cqw）基準なので、サムネイルでも大画面でも同じ比率で表示される。
 */
export function TitleSlidePreview({ name, coverImageUrl, questionCount, settings, mode = "anagram", audio = false, compact = false }: {
  name: string; coverImageUrl?: string; questionCount: number; settings: QuestionSettings; mode?: QuestionSetMode; audio?: boolean; compact?: boolean;
}) {
  const timer = settings.timerMode === "none" ? "GMが締切" : settings.timerMode === "fixed" ? `${settings.timerSeconds}秒` : `正解後${settings.timerSeconds}秒`;
  const rules = mode === "buzzer" ? (
    <>
      全{questionCount}問 ・ <Zap className="inline h-[2.4cqw] w-[2.4cqw] align-[-0.15em]" aria-hidden /> 早押し ・ {audio ? "音声付き" : `${settings.charsPerSecond}文字/秒`}
    </>
  ) : (
    <>
      全{questionCount}問 ・ <Timer className="inline h-[2.4cqw] w-[2.4cqw] align-[-0.15em]" aria-hidden /> {timer}
      {settings.maxAttempts !== null && ` ・ お手付き${settings.maxAttempts}回まで`}
    </>
  );
  // 表紙画像があるときはタイトル文字が画像に含まれている運用なので、画像をそのまま映し、ルールだけ下部に重ねる
  if (coverImageUrl) {
    return (
      <SlideFrame>
        <img src={coverImageUrl} alt={name} className="absolute inset-0 h-full w-full object-contain" />
        {!compact && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/60 to-transparent px-[6cqw] pb-[2.4cqw] pt-[6cqw] text-center">
            <p className="text-[2.4cqw] font-bold text-white drop-shadow-[0_0.2cqw_0.6cqw_rgba(0,0,0,0.9)]">{rules}</p>
          </div>
        )}
      </SlideFrame>
    );
  }
  return (
    <SlideFrame>
      <div className="relative flex h-full flex-col items-center justify-center gap-[2cqw] px-[6cqw] text-center">
        <p className="text-[2.2cqw] font-bold tracking-[0.3em] text-slate-300">QuizJam</p>
        <h2 className={`text-brand break-all font-black leading-tight ${name ? "text-[7cqw]" : "text-[5cqw] opacity-40"}`}>{name || "企画名を入力"}</h2>
        {!compact && <p className="text-[2.4cqw] text-slate-300">{rules}</p>}
      </div>
    </SlideFrame>
  );
}

export function QuestionSlidePreview({ question, index, total, settings, background, mode = "anagram", compact = false }: {
  question: Question; index: number; total: number; settings: QuestionSettings; background?: string; mode?: QuestionSetMode; compact?: boolean;
}) {
  const hasImage = !!question.imageUrl;
  const light = !!background && isLightColor(background);
  const buzzer = mode === "buzzer";
  return (
    <SlideFrame>
      <div className={`flex h-full flex-col px-[4cqw] py-[3cqw] ${light ? "text-slate-800" : ""}`} style={background ? { backgroundColor: background } : undefined}>
        <div className={`flex items-center justify-between text-[2.4cqw] font-bold ${light ? "text-slate-500" : "text-slate-400"}`}>
          <span>第{index + 1}問 / {total}問</span>
          {!compact && !buzzer && settings.timerMode !== "none" && (
            <span className="inline-flex items-center gap-[0.6cqw] rounded-[1.2cqw] bg-amber-100 px-[1.6cqw] py-[0.4cqw] text-amber-900">
              <Timer className="h-[2.4cqw] w-[2.4cqw]" aria-hidden />{settings.timerSeconds}<span className="text-[1.6cqw]">秒</span>
            </span>
          )}
          {!compact && buzzer && (
            <span className="inline-flex items-center gap-[0.6cqw] rounded-[1.2cqw] bg-purple-100 px-[1.6cqw] py-[0.4cqw] text-purple-900">
              <Zap className="h-[2.4cqw] w-[2.4cqw]" aria-hidden />早押し
            </span>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[2cqw]">
          {hasImage && <img src={question.imageUrl} alt="" className="min-h-0 w-auto max-w-full flex-1 rounded-[1.5cqw] object-contain" />}
          {buzzer ? (
            <p className={`w-full whitespace-pre-wrap break-words text-left font-bold leading-snug ${question.prompt ? buzzerSlidePromptSizeClass(promptLength(question.prompt)) : "text-[4cqw] text-slate-500"}`}>
              {question.prompt || "問題文を入力"}
            </p>
          ) : (question.prompt || !hasImage) && (
            <p className={`break-all text-center font-black leading-tight tracking-widest ${
              question.prompt ? (hasImage ? "text-[6cqw]" : "text-[9cqw]") : "text-[4cqw] text-slate-500"
            }`}>{question.prompt || "出題文を入力"}</p>
          )}
          {!compact && !buzzer && question.hint && <p className="text-[2.4cqw] text-slate-400">ヒント: {question.hint}</p>}
        </div>
      </div>
    </SlideFrame>
  );
}

/**
 * 説明スライド。画像があれば中央に大きく、見出し・本文はその上下に添える。本文は改行を保つ。
 * 本文は長さに応じて文字を小さくし、画像があるときは本文の高さを抑えて画像が潰れないようにする。
 */
export function IntroSlidePreview({ heading, body, imageUrl, compact = false }: {
  heading?: string; body?: string; imageUrl?: string; compact?: boolean;
}) {
  const empty = !heading && !body && !imageUrl;
  return (
    <SlideFrame>
      <div className="flex h-full flex-col items-center justify-center gap-[2cqw] px-[6cqw] py-[4cqw] text-center">
        {heading && (
          <h2 className={`shrink-0 break-words font-black leading-tight ${imageUrl ? "text-[4cqw]" : "text-[6cqw]"}`}>{heading}</h2>
        )}
        {imageUrl && <img src={imageUrl} alt="" className="min-h-[30%] w-auto max-w-full flex-1 rounded-[1.5cqw] object-contain" />}
        {body && !compact && (
          <p className={`overflow-hidden whitespace-pre-wrap break-words text-left leading-relaxed text-slate-200 ${imageUrl ? "max-h-[35%] shrink-0" : "max-h-full"} ${introBodySizeClass(body.length, !!imageUrl)}`}>{body}</p>
        )}
        {/* サムネイルでは本文を省くが、見出しも画像も無いスライドは本文の1行目で見分けられるようにする */}
        {body && compact && !heading && !imageUrl && (
          <p className="line-clamp-2 break-words text-[3.5cqw] font-bold text-slate-200">{body.split("\n").find((l) => l.trim()) ?? ""}</p>
        )}
        {empty && <p className="text-[4cqw] text-slate-500">見出し・本文・画像のどれかを入力</p>}
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
