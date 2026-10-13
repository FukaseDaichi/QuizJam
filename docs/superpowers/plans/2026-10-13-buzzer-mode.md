# 早押しモード 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 問題セット単位の「早押しモード」を追加する。GM 画面に問題文が一文字ずつ表示され、参加者はスマホの早押しボタンで押し、GM が口頭回答を正解／不正解で判定する。

**Architecture:** `question` フェーズの中に `BuzzerState`（読み上げ区間の起点・キュー・押せなくなった人）を持たせ、フェーズ構成は変えない。表示済み文字数は共有関数 `revealedCount` でサーバーとクライアントが同じ式で計算し、押された瞬間の位置はサーバー受信時刻で確定する。正解／不正解は既存の `Answer` に落とし、順位表・問題結果・ライブ設定・キックの仕組みをそのまま使う。

**Tech Stack:** TypeScript、Cloudflare Workers + Durable Objects（Hono）、React 19 + Tailwind v4 + lucide-react、Vitest（`@cloudflare/vitest-plugin`、workerd 上で実行）

**Spec:** `docs/superpowers/specs/2026-10-13-buzzer-mode-design.md`

## Global Constraints

- 時刻は常に引数で注入する（`GameEngine` は `Date.now()` を呼ばない）
- 文字数はコードポイント単位（`Array.from(text).length`）
- `charsPerSecond` は 1〜30 の整数、既定 6
- `mode` は `"anagram" | "buzzer"`、省略時 `"anagram"`。保存時 `"anagram"` は省略する
- 参加者には早押しの問題文（`prompt`）とヒントを送らない
- UI の文言は日本語。アイコンは lucide-react のみ、絵文字は使わない
- 各タスクの最後に `npm test` を通す（テスト実行には `npm run db:migrate:local` 済みのローカル D1 は不要。vitest が自前でマイグレーションを当てる）。`npm run typecheck` は Task 1 で通り、Task 2〜4 の間は各 Step に書いた残りエラーだけが出る状態を経て、Task 5 以降は常に通す
- コミットメッセージの末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` を付ける
- コードの行末・インデントは既存ファイルに合わせる（2 スペース、ダブルクォート、セミコロンあり）

## Review Focus

spec が暗に求めるが、どのタスクのテストも素では触れない入力。各行のテストは所有タスクに追加済み。

1. 問題終了後（`questionResult`）に遅れて届いた `buzz` → `not_in_question` で拒否し、キューに入らない（Task 3）
2. 絵文字・サロゲートペアを含む問題文 → `promptLength` と表示の分割がコードポイント単位で一致し、文字が化けない（Task 1、Task 8）
3. GM が「回答中」の最中にブラウザを再読み込み → `state.buzzer` にキューと参加者名が入っていて、判定ボタンが復元される（Task 4）
4. GM が「正解」「不正解」を二度押し → 2 回目は `invalid_state`、点数は二重に入らない（Task 4）
5. 回答中ではなく「2番目以降」にいる人をキック → キューから消えるだけで、回答中の人と `status` は変わらない（Task 3）

---

### Task 1: 共有の型・既定値・バリデーション・表示位置の計算

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/defaults.ts`
- Modify: `src/shared/validateQuestionSet.ts`
- Create: `src/shared/buzzer.ts`
- Test: `test/shared/buzzer.test.ts`（新規）
- Test: `test/shared/validateQuestionSet.test.ts`

**Interfaces:**
- Produces:
  - `type QuestionSetMode = "anagram" | "buzzer"`、`QuestionSet.mode?: QuestionSetMode`、`QuestionSettings.charsPerSecond: number`
  - `type BuzzerStatus = "ready" | "reading" | "paused"`、`interface BuzzerState { status; readingStartedAt: number | null; revealedChars: number; queue: string[]; lockedOut: string[] }`
  - `DEFAULT_SETTINGS.charsPerSecond === 6`
  - `isValidCharsPerSecond(x: unknown): x is number`（1〜30 の整数）
  - `promptLength(prompt: string): number`、`revealedCount(t: RevealTimeline, now: number): number`、`interface RevealTimeline { status: BuzzerStatus; readingStartedAt: number | null; revealedChars: number; promptLength: number; charsPerSecond: number }`

- [ ] **Step 1: 型と既定値を追加する**

`src/shared/types.ts` の `QuestionSettings` に 1 行、`QuestionSet` に 1 行足し、末尾に早押しの型を追加する。

```ts
export interface QuestionSettings {
  timerMode: TimerMode;
  timerSeconds: number;
  basePoints: number;
  rankBonus: number[];
  wrongPenalty: number;
  maxAttempts: number | null;
  charsPerSecond: number;      // 早押しモードの文字送り（文字/秒）。既定 6。それ以外のモードでは使わない
}

/** 問題セット全体の出題形式。早押しなら全問が早押し */
export type QuestionSetMode = "anagram" | "buzzer";

export interface QuestionSet {
  id: string;
  name: string;                // 企画名
  mode?: QuestionSetMode;      // 省略時 "anagram"
  coverImageUrl?: string;      // タイトルスライドの画像
  slideBackground?: string;    // 問題スライドの背景色（#rrggbb）。画像の地の色に合わせる用途
  introSlides?: IntroSlide[];  // 省略時は無し。20枚まで
  settings: QuestionSettings;
  questions: Question[];
}
```

ファイル末尾に追加:

```ts
export type BuzzerStatus = "ready" | "reading" | "paused";

/** 早押しモードで出題中にだけ持つ状態。表示済み文字数は revealedCount()（shared/buzzer.ts）で求める */
export interface BuzzerState {
  status: BuzzerStatus;
  readingStartedAt: number | null;  // reading のとき、今の区間を読み始めたサーバー時刻 (UNIX ms)
  revealedChars: number;            // 区間の起点。止めたときまでに表示済みの文字数
  queue: string[];                  // 早押しキュー（参加者 ID、サーバー受信順）。先頭が回答中
  lockedOut: string[];              // この問題で不正解になり、押せなくなった参加者 ID
}
```

`src/shared/defaults.ts` の `DEFAULT_SETTINGS` に `charsPerSecond: 6,` を `maxAttempts: 3,` の次の行に追加する。

- [ ] **Step 2: `revealedCount` の失敗するテストを書く**

`test/shared/buzzer.test.ts` を新規作成:

```ts
import { describe, it, expect } from "vitest";
import { promptLength, revealedCount, type RevealTimeline } from "../../src/shared/buzzer";

const T0 = 1_700_000_000_000;

function reading(over: Partial<RevealTimeline> = {}): RevealTimeline {
  return { status: "reading", readingStartedAt: T0, revealedChars: 0, promptLength: 20, charsPerSecond: 6, ...over };
}

describe("promptLength", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(promptLength("あいう")).toBe(3);
    expect(promptLength("a😀b")).toBe(3);
    expect(promptLength("")).toBe(0);
  });
});

describe("revealedCount", () => {
  it("advances with elapsed time at charsPerSecond and floors", () => {
    expect(revealedCount(reading(), T0)).toBe(0);
    expect(revealedCount(reading(), T0 + 999)).toBe(5);
    expect(revealedCount(reading(), T0 + 1000)).toBe(6);
    expect(revealedCount(reading({ charsPerSecond: 10 }), T0 + 1500)).toBe(15);
  });
  it("adds the elapsed chars onto the segment start", () => {
    expect(revealedCount(reading({ revealedChars: 8 }), T0 + 1000)).toBe(14);
  });
  it("never exceeds the prompt length", () => {
    expect(revealedCount(reading(), T0 + 60_000)).toBe(20);
    expect(revealedCount(reading({ revealedChars: 25 }), T0)).toBe(20);
  });
  it("stays at the segment start while paused or ready, even with a stale readingStartedAt", () => {
    expect(revealedCount(reading({ status: "paused", revealedChars: 7 }), T0 + 10_000)).toBe(7);
    expect(revealedCount(reading({ status: "ready", readingStartedAt: null }), T0 + 10_000)).toBe(0);
  });
  it("treats a clock earlier than readingStartedAt as zero elapsed", () => {
    expect(revealedCount(reading({ revealedChars: 3 }), T0 - 5000)).toBe(3);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npx vitest run test/shared/buzzer.test.ts`
Expected: FAIL（`Failed to resolve import "../../src/shared/buzzer"`）

- [ ] **Step 4: `src/shared/buzzer.ts` を作る**

```ts
import type { BuzzerStatus } from "./types";

/** 表示済み文字数を求めるのに必要な情報。サーバーの BuzzerState とクライアントの BuzzerView の両方が満たす */
export interface RevealTimeline {
  status: BuzzerStatus;
  readingStartedAt: number | null;
  revealedChars: number;
  promptLength: number;
  charsPerSecond: number;
}

/** 文字数はコードポイント単位。サロゲートペア（絵文字など）を途中で切らない */
export function promptLength(prompt: string): number {
  return Array.from(prompt).length;
}

/**
 * 時刻 now に表示済みであるべき文字数。
 * reading: 区間の起点 + 経過秒 × 文字/秒（切り捨て）。ready / paused: 区間の起点のまま。
 * サーバーとクライアントが同じ式を使うので、押された瞬間の位置が全員で揃う
 */
export function revealedCount(t: RevealTimeline, now: number): number {
  const base = Math.min(t.revealedChars, t.promptLength);
  if (t.status !== "reading" || t.readingStartedAt === null) return base;
  const elapsed = Math.max(0, now - t.readingStartedAt);
  return Math.min(t.promptLength, base + Math.floor((elapsed * t.charsPerSecond) / 1000));
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run test/shared/buzzer.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 6: バリデーションの失敗するテストを書く**

`test/shared/validateQuestionSet.test.ts` の `describe("validateQuestionSetInput", …)` の中（最後の `it` の後）に追加:

```ts
  it("accepts mode buzzer and drops mode anagram", () => {
    const buzzer = validateQuestionSetInput({ ...base, mode: "buzzer", questions: [{ prompt: "日本一高い山は？", answers: ["富士山"] }] });
    expect("error" in buzzer ? buzzer.error : buzzer.mode).toBe("buzzer");
    const anagram = validateQuestionSetInput({ ...base, mode: "anagram", questions: [{ prompt: "ごんり", answers: ["りんご"] }] });
    expect("error" in anagram ? anagram.error : anagram.mode).toBeUndefined();
    expect(validateQuestionSetInput({ ...base, mode: "speed", questions: [{ prompt: "x", answers: ["y"] }] })).toEqual({ error: "mode invalid" });
  });

  it("requires a prompt on every question in buzzer mode even when it has an image", () => {
    const v = validateQuestionSetInput({ ...base, mode: "buzzer", questions: [{ prompt: "", answers: ["富士山"], imageUrl: "/api/images/a.webp" }] });
    expect(v).toEqual({ error: "questions[0].prompt is required" });
  });

  it("fills charsPerSecond with the default and validates its range", () => {
    const ok = validateQuestionSetInput({ ...base, questions: [{ prompt: "x", answers: ["y"] }] });
    expect("error" in ok ? ok.error : ok.settings.charsPerSecond).toBe(6);
    const custom = validateQuestionSetInput({ ...base, settings: { charsPerSecond: 12 }, questions: [{ prompt: "x", answers: ["y"] }] });
    expect("error" in custom ? custom.error : custom.settings.charsPerSecond).toBe(12);
    expect(validateQuestionSetInput({ ...base, settings: { charsPerSecond: 0 }, questions: [{ prompt: "x", answers: ["y"] }] })).toEqual({ error: "settings.charsPerSecond invalid" });
    expect(validateQuestionSetInput({ ...base, settings: { charsPerSecond: 31 }, questions: [{ prompt: "x", answers: ["y"] }] })).toEqual({ error: "settings.charsPerSecond invalid" });
    expect(validateQuestionSetInput({ ...base, settings: { charsPerSecond: 2.5 }, questions: [{ prompt: "x", answers: ["y"] }] })).toEqual({ error: "settings.charsPerSecond invalid" });
    expect(validateQuestionSetInput({ ...base, questions: [{ prompt: "x", answers: ["y"], overrides: { charsPerSecond: 40 } }] })).toEqual({ error: "questions[0].settings.charsPerSecond invalid" });
  });
```

- [ ] **Step 7: テストが失敗することを確認する**

Run: `npx vitest run test/shared/validateQuestionSet.test.ts`
Expected: FAIL（3 件。`mode` が `undefined` のまま、`charsPerSecond` が検証されない）

- [ ] **Step 8: バリデーションを実装する**

`src/shared/validateQuestionSet.ts` を編集する。

import 行を変更:

```ts
import type { IntroSlide, Question, QuestionSet, QuestionSetMode, QuestionSettings } from "./types";
```

`const TIMER_MODES` の下に追加:

```ts
const MODES = new Set<QuestionSetMode>(["anagram", "buzzer"]);

export const MIN_CHARS_PER_SECOND = 1;
export const MAX_CHARS_PER_SECOND = 30;

export function isValidCharsPerSecond(x: unknown): x is number {
  return Number.isInteger(x) && (x as number) >= MIN_CHARS_PER_SECOND && (x as number) <= MAX_CHARS_PER_SECOND;
}
```

`validateSettings` の `if ("maxAttempts" in o) …` の次の行に追加:

```ts
  if ("charsPerSecond" in o) { if (!isValidCharsPerSecond(o.charsPerSecond)) return { error: "settings.charsPerSecond invalid" }; out.charsPerSecond = o.charsPerSecond; }
```

`validateQuestionSetInput` の `const settings = validateSettings(...)` の直前に追加:

```ts
  let mode: QuestionSetMode | undefined;
  if (o.mode !== undefined && o.mode !== null) {
    if (!MODES.has(o.mode as QuestionSetMode)) return { error: "mode invalid" };
    if (o.mode === "buzzer") mode = "buzzer";   // anagram は既定なので省略する
  }
```

問題ループの `if (prompt.length === 0 && !imageUrl) return …` を次に変更（早押しは画像があっても問題文が必要）:

```ts
    if (prompt.length === 0 && (mode === "buzzer" || !imageUrl)) return { error: `questions[${i}].prompt is required` };
```

戻り値に `mode` を加える:

```ts
  return {
    name: o.name.trim(), mode, coverImageUrl, slideBackground,
    introSlides: introSlides.length ? introSlides : undefined,
    settings: settings as QuestionSettings, questions,
  };
```

- [ ] **Step 9: テストと型チェックを通す**

Run: `npx vitest run test/shared && npm run typecheck`
Expected: すべて PASS。typecheck は `charsPerSecond` を欠く `QuestionSettings` リテラルがあれば失敗する。失敗したら、そのリテラルが `DEFAULT_SETTINGS` を spread する形に直す（`test/` 内の `settings: { ...DEFAULT_SETTINGS, ... }` は既にその形なので通常は無い）

- [ ] **Step 10: コミット**

```bash
git add src/shared/types.ts src/shared/defaults.ts src/shared/validateQuestionSet.ts src/shared/buzzer.ts test/shared/buzzer.test.ts test/shared/validateQuestionSet.test.ts
git commit -m "feat(shared): question set mode, charsPerSecond and the reveal timeline for buzzer mode"
```

---

### Task 2: メッセージ定義（早押しの送受信・ビュー・エラーコード）

**Files:**
- Modify: `src/shared/messages.ts`
- Test: `test/shared/messages.test.ts`
- Test: `test/web/clientState.test.ts`（型を満たすようリテラルを直すだけ）

**Interfaces:**
- Consumes: `QuestionSetMode`, `BuzzerStatus`, `isValidCharsPerSecond`（Task 1）
- Produces:
  - `ClientMessage` に `{ type: "startReading" } | { type: "buzz" } | { type: "judge"; correct: boolean }`
  - `interface BuzzerView { status: BuzzerStatus; readingStartedAt: number | null; revealedChars: number; promptLength: number; charsPerSecond: number; queue: { participantId: string; nickname: string }[]; lockedOut: string[] }`
  - `ServerMessage` に `{ type: "buzzerUpdated"; buzzer: BuzzerView }`
  - `QuestionView.mode: QuestionSetMode`、タイトルスライドビューに `mode: QuestionSetMode`、`StateMessage.buzzer: BuzzerView | null`、`SettingsView.mode: QuestionSetMode | null`
  - `ErrorCode` に `"not_reading" | "locked_out" | "already_buzzed"`

- [ ] **Step 1: 失敗するテストを書く**

`test/shared/messages.test.ts` を次の内容に置き換える（既存 2 テストを保ち、追加する）:

```ts
import { describe, it, expect } from "vitest";
import { isKnownServerMessage, parseClientMessage } from "../../src/shared/messages";

describe("isKnownServerMessage", () => {
  it("accepts every type the client handles", () => {
    for (const type of ["state", "participantJoined", "participantLeft", "participantRemoved", "kicked", "settingsUpdated", "introStarted", "questionStarted", "deadlineSet", "answerResult", "someoneCorrect", "leaderboard", "questionClosed", "finalResult", "buzzerUpdated", "error"]) {
      expect(isKnownServerMessage({ type })).toBe(true);
    }
  });

  it("rejects unknown types and non-objects, so a stale client can tell the server is newer", () => {
    expect(isKnownServerMessage({ type: "somethingNew" })).toBe(false);
    expect(isKnownServerMessage({})).toBe(false);
    expect(isKnownServerMessage(null)).toBe(false);
    expect(isKnownServerMessage("state")).toBe(false);
  });
});

describe("parseClientMessage buzzer messages", () => {
  it("parses startReading and buzz without payload", () => {
    expect(parseClientMessage(JSON.stringify({ type: "startReading" }))).toEqual({ type: "startReading" });
    expect(parseClientMessage(JSON.stringify({ type: "buzz" }))).toEqual({ type: "buzz" });
  });
  it("parses judge only with a boolean correct", () => {
    expect(parseClientMessage(JSON.stringify({ type: "judge", correct: true }))).toEqual({ type: "judge", correct: true });
    expect(parseClientMessage(JSON.stringify({ type: "judge", correct: false }))).toEqual({ type: "judge", correct: false });
    expect(parseClientMessage(JSON.stringify({ type: "judge" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "judge", correct: "yes" }))).toBeNull();
  });
  it("accepts charsPerSecond in live settings within 1..30 integers", () => {
    expect(parseClientMessage(JSON.stringify({ type: "updateSettings", settings: { charsPerSecond: 8 } }))).toEqual({ type: "updateSettings", settings: { charsPerSecond: 8 } });
    expect(parseClientMessage(JSON.stringify({ type: "updateSettings", settings: { charsPerSecond: 0 } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "updateSettings", settings: { charsPerSecond: 31 } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "updateSettings", settings: { charsPerSecond: 1.5 } }))).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/shared/messages.test.ts`
Expected: FAIL（`buzzerUpdated` が unknown、`startReading` などが `null`）

- [ ] **Step 3: `src/shared/messages.ts` を編集する**

import 行を変更:

```ts
import type { BuzzerStatus, LeaderboardEntry, LiveSettings, Participant, Phase, QuestionSetMode, QuestionSettings, TimerMode } from "./types";
import { isValidCharsPerSecond } from "./validateQuestionSet";
```

`ClientMessage` を変更:

```ts
export type ClientMessage =
  | { type: "answer"; text: string }
  | { type: "start"; questionSetId: string; carryOverScores: boolean }
  | { type: "close" }
  | { type: "next" }
  | { type: "endGame" }
  // GM がゲーム中にも使える操作
  | { type: "updateSettings"; settings: Partial<LiveSettings> }
  | { type: "adjustScore"; participantId: string; delta: number }
  | { type: "kick"; participantId: string }
  // 早押しモード
  | { type: "startReading" }                  // GM: 読み上げ（文字送り）開始
  | { type: "buzz" }                          // 参加者: 早押し
  | { type: "judge"; correct: boolean };      // GM: 回答中の参加者を判定

const CLIENT_TYPES = new Set(["answer", "start", "close", "next", "endGame", "updateSettings", "adjustScore", "kick", "startReading", "buzz", "judge"]);
```

`parseLiveSettings` の `else if (key === "rankBonus") …` の次に追加:

```ts
    else if (key === "charsPerSecond") { if (!isValidCharsPerSecond(val)) return null; out.charsPerSecond = val; }
```

`parseClientMessage` の `if (t === "kick" …)` の次に追加:

```ts
  if (t === "judge" && typeof (obj as { correct?: unknown }).correct !== "boolean") return null;
```

`IntroSlideView` の title に `mode` を足す:

```ts
export type IntroSlideView =
  | { kind: "title"; name: string; coverImageUrl?: string; questionCount: number; settings: QuestionSettings; mode: QuestionSetMode }
  | { kind: "slide"; heading?: string; body?: string; imageUrl?: string };
```

`QuestionView` に `mode` を足す:

```ts
export interface QuestionView {
  index: number;
  total: number;
  mode: QuestionSetMode;          // 画面の出し分け。buzzer では参加者の prompt / hint は空
  prompt: string;
  hint?: string;
  imageUrl?: string;
  background?: string;
  deadlineAt: number | null;
  maxAttempts: number | null;
}
```

`QuestionResultView` の後に追加:

```ts
/** 早押しモードの出題中の状態。表示済み文字数は revealedCount()（shared/buzzer.ts）で求める */
export interface BuzzerView {
  status: BuzzerStatus;
  readingStartedAt: number | null;
  revealedChars: number;
  promptLength: number;                                  // 参加者は本文を受け取らないので長さだけ
  charsPerSecond: number;                                // 今効いている速さ
  queue: { participantId: string; nickname: string }[];  // 先頭が回答中
  lockedOut: string[];
}
```

`SettingsView` に `mode` を足す:

```ts
export interface SettingsView {
  override: Partial<LiveSettings>;
  effective: LiveSettings | null;
  mode: QuestionSetMode | null;   // 読み込み中の問題セットの出題形式。管理パネルの欄の出し分けに使う
}
```

`StateMessage` の `settings: SettingsView;` の次に追加:

```ts
  buzzer: BuzzerView | null;       // 早押しモードで出題中のみ
```

`ErrorCode` に追加:

```ts
  | "not_reading"
  | "locked_out"
  | "already_buzzed"
```

`SERVER_TYPES` の `"questionClosed", "finalResult",` の後に `"buzzerUpdated",` を追加し、`ServerMessage` の `| { type: "finalResult"; entries: LeaderboardEntry[] }` の次に追加:

```ts
  | { type: "buzzerUpdated"; buzzer: BuzzerView }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run test/shared/messages.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: 型を満たすよう既存テストのリテラルを直す**

`test/web/clientState.test.ts`:

- `baseState` の `settings: { override: {}, effective: null },` を `settings: { override: {}, effective: null, mode: null },` に変え、その次の行に `buzzer: null,` を足す
- 163 行付近の `settings: { override: {}, effective: null }` を `settings: { override: {}, effective: null, mode: null }` に変える
- 157 行付近の `settings: { override: { maxAttempts: null }, effective }` を `settings: { override: { maxAttempts: null }, effective, mode: "anagram" }` に変える
- `questionStarted` の `question:` リテラルと `const question = { … }` すべてに `mode: "anagram" as const,` を足す。sed で一括:

```bash
sed -i 's/{ index: \([0-9]*\), total: \([0-9]*\), prompt: /{ index: \1, total: \2, mode: "anagram" as const, prompt: /g' test/web/clientState.test.ts
grep -c 'mode: "anagram" as const' test/web/clientState.test.ts
```

Expected: 8 以上（`questionStarted` のリテラルがすべて置き換わる）

- `const intro: IntroView = { index: 0, total: 1, slide: { kind: "title", name: "テスト", questionCount: 1, settings: DEFAULT_SETTINGS } };` の `settings: DEFAULT_SETTINGS` の後に `, mode: "anagram"` を足す。同じ形の title リテラルが他にもあれば同様に足す:

```bash
grep -n 'kind: "title"' test/web/clientState.test.ts
```

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: `src/room/GameEngine.ts` と `src/room/Room.ts` が `mode` / `buzzer` を欠くためエラーになる（Task 3・4 で直す）。`test/web/clientState.test.ts` 由来のエラーが無いことだけ確認する。`src/web` の `TitleSlidePreview` 呼び出しなど、`mode` を要求しない箇所はエラーにならない

- [ ] **Step 7: コミット**

```bash
git add src/shared/messages.ts test/shared/messages.test.ts test/web/clientState.test.ts
git commit -m "feat(shared): buzzer messages, BuzzerView and mode on question/title views"
```

---

### Task 3: GameEngine の早押しルール

**Files:**
- Modify: `src/room/GameEngine.ts`
- Test: `test/room/GameEngine.test.ts`

**Interfaces:**
- Consumes: `BuzzerState`, `promptLength`, `revealedCount`, `BuzzerView`, `QuestionSetMode`（Task 1・2）
- Produces（Room が使う）:
  - `EngineState.buzzer: BuzzerState | null`
  - `currentQuestionView(role: "gm" | "player" = "gm"): QuestionView | null`
  - `buzzerView(): BuzzerView | null`
  - `startReading(now: number): BuzzerView`（`ready` 以外は throw）
  - `buzz(participantId: string, now: number): BuzzOutcome` … `{ kind: "accepted"; position: number } | { kind: "rejected"; code: ErrorCode }`
  - `judge(correct: boolean, now: number): JudgeOutcome` … `{ kind: "correct"; participantId: string; points: number; result: QuestionResultView } | { kind: "wrong"; participantId: string; points: number }`（`paused` でなければ throw）
  - `rebaseReading(now: number): void`
  - `removeParticipant(id: string, now: number): Participant | null`（`now` が必須になる）

- [ ] **Step 1: 既存テストを新しいシグネチャに合わせる**

`test/room/GameEngine.test.ts`:

- `removeParticipant("p1")` / `removeParticipant("nobody")` の 4 か所を `removeParticipant("p1", T0)` / `removeParticipant("nobody", T0)` にする:

```bash
sed -i 's/removeParticipant("\([a-z0-9]*\)")/removeParticipant("\1", T0)/g' test/room/GameEngine.test.ts
grep -c 'removeParticipant("[a-z0-9]*", T0)' test/room/GameEngine.test.ts
```

Expected: 4

- `it("moves to question phase and sets a fixed deadline", …)` の `expect(view).toEqual({ index: 0, total: 2, prompt: "ごんり", hint: undefined, …` に `mode: "anagram",` を足す:

```ts
    expect(view).toEqual({
      index: 0, total: 2, mode: "anagram", prompt: "ごんり", hint: undefined,
      deadlineAt: T0 + 20_000, maxAttempts: 3,
    });
```

- [ ] **Step 2: 早押しの失敗するテストを書く**

`test/room/GameEngine.test.ts` の末尾に追加:

```ts
describe("GameEngine buzzer mode", () => {
  const PROMPT = "日本で一番高い山は何でしょう？";   // 15 文字
  function makeBuzzerSet(overrides: Partial<QuestionSet["settings"]> = {}, questions?: QuestionSet["questions"]): QuestionSet {
    return {
      id: "bz", name: "早押し", mode: "buzzer",
      settings: { ...DEFAULT_SETTINGS, charsPerSecond: 5, wrongPenalty: 20, ...overrides },
      questions: questions ?? [
        { id: "b1", type: "anagram", prompt: PROMPT, answers: ["富士山"], hint: "静岡と山梨" },
        { id: "b2", type: "anagram", prompt: "二番目は？", answers: ["北岳"] },
      ],
    };
  }
  let e: GameEngine;
  beforeEach(() => {
    e = GameEngine.create("BZ0001");
    e.addParticipant("p1", "みさき");
    e.addParticipant("p2", "たろう");
    e.addParticipant("p3", "ケン");
  });

  it("opens the question in ready state with no deadline even when timerMode is fixed", () => {
    const view = startQuestions(e, makeBuzzerSet({ timerMode: "fixed", timerSeconds: 20 }), false, T0);
    expect(view.mode).toBe("buzzer");
    expect(view.deadlineAt).toBeNull();
    expect(e.buzzerView()).toEqual({
      status: "ready", readingStartedAt: null, revealedChars: 0, promptLength: 15, charsPerSecond: 5, queue: [], lockedOut: [],
    });
    expect(e.reconcileDeadline(T0 + 1000)).toEqual({ changed: false, deadlineAt: null });
  });

  it("strips the prompt and hint from the player view but not from the GM view", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    expect(e.currentQuestionView("gm")).toMatchObject({ prompt: PROMPT, hint: "静岡と山梨" });
    expect(e.currentQuestionView("player")).toMatchObject({ prompt: "", hint: undefined, mode: "buzzer" });
    expect(e.currentQuestionView()).toMatchObject({ prompt: PROMPT });
  });

  it("the title slide carries the mode", () => {
    const intro = e.start(makeBuzzerSet(), false);
    expect(intro.slide).toMatchObject({ kind: "title", mode: "buzzer" });
    expect(e.start(makeSet(), false).slide).toMatchObject({ kind: "title", mode: "anagram" });
  });

  it("rejects buzzes before reading starts and text answers at any time", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    expect(e.buzz("p1", T0 + 100)).toEqual({ kind: "rejected", code: "not_reading" });
    expect(e.submitAnswer("p1", "富士山", T0 + 100)).toEqual({ kind: "rejected", code: "not_in_question" });
    expect(e.buzz("nobody", T0 + 100)).toEqual({ kind: "rejected", code: "forbidden" });
  });

  it("startReading moves to reading and only works from ready", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    const v = e.startReading(T0 + 2000);
    expect(v).toMatchObject({ status: "reading", readingStartedAt: T0 + 2000, revealedChars: 0 });
    expect(() => e.startReading(T0 + 3000)).toThrow();
  });

  it("the first buzz freezes the reveal at the server arrival time; later buzzes queue without moving it", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    expect(e.buzz("p2", T0 + 1400)).toEqual({ kind: "accepted", position: 1 });   // 1.4s × 5 = 7 文字
    expect(e.buzzerView()).toMatchObject({ status: "paused", readingStartedAt: null, revealedChars: 7 });
    expect(e.buzz("p1", T0 + 3000)).toEqual({ kind: "accepted", position: 2 });
    expect(e.buzzerView()).toMatchObject({ revealedChars: 7, queue: [{ participantId: "p2", nickname: "たろう" }, { participantId: "p1", nickname: "みさき" }] });
    expect(e.buzz("p2", T0 + 3100)).toEqual({ kind: "rejected", code: "already_buzzed" });
  });

  it("judge correct awards basePoints, records a rank-1 answer and closes the question", () => {
    startQuestions(e, makeBuzzerSet({ basePoints: 100, rankBonus: [50, 30, 10] }), false, T0);
    e.startReading(T0);
    e.buzz("p2", T0 + 1000);
    const r = e.judge(true, T0 + 5000);
    expect(r).toMatchObject({ kind: "correct", participantId: "p2", points: 100 });
    expect(e.phase).toBe("questionResult");
    expect(e.buzzerView()).toBeNull();
    expect(e.questionResult()?.results).toEqual([{ participantId: "p2", nickname: "たろう", correctRank: 1, points: 100 }]);
    expect(e.getParticipant("p2")?.score).toBe(100);
    expect(e.myStatus("p2")).toEqual({ attemptsUsed: 1, correct: true, correctRank: 1 });
    expect(e.buzz("p1", T0 + 6000)).toEqual({ kind: "rejected", code: "not_in_question" });
  });

  it("judge wrong deducts wrongPenalty, locks the answerer out and passes the turn to the next in queue", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    e.buzz("p2", T0 + 1000);
    e.buzz("p1", T0 + 1200);
    const r = e.judge(false, T0 + 4000);
    expect(r).toEqual({ kind: "wrong", participantId: "p2", points: -20 });
    expect(e.getParticipant("p2")?.score).toBe(-20);
    expect(e.buzzerView()).toMatchObject({ status: "paused", revealedChars: 5, queue: [{ participantId: "p1", nickname: "みさき" }], lockedOut: ["p2"] });
    expect(e.myStatus("p2")).toEqual({ attemptsUsed: 1, correct: false, correctRank: null });
    expect(e.buzz("p2", T0 + 4100)).toEqual({ kind: "rejected", code: "locked_out" });
  });

  it("judge wrong with an empty queue resumes reading from the frozen position", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    e.buzz("p2", T0 + 1000);
    e.judge(false, T0 + 4000);
    expect(e.buzzerView()).toMatchObject({ status: "reading", readingStartedAt: T0 + 4000, revealedChars: 5, queue: [] });
    // 再開後 1 秒で 5 + 5 文字
    expect(e.buzz("p1", T0 + 5000)).toEqual({ kind: "accepted", position: 1 });
    expect(e.buzzerView()).toMatchObject({ status: "paused", revealedChars: 10 });
  });

  it("judge throws unless someone is answering", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    expect(() => e.judge(true, T0)).toThrow();
    e.startReading(T0);
    expect(() => e.judge(false, T0 + 10)).toThrow();
  });

  it("allParticipantsDone is true only when every connected participant is locked out and the queue is empty", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    e.setConnected("p3", false);
    e.buzz("p1", T0 + 100); e.judge(false, T0 + 200);
    expect(e.allParticipantsDone()).toBe(false);
    e.buzz("p2", T0 + 300);
    expect(e.allParticipantsDone()).toBe(false);   // p2 はキューに居る
    e.judge(false, T0 + 400);
    expect(e.allParticipantsDone()).toBe(true);
  });

  it("kicking the answerer passes the turn without a penalty; kicking someone further back only drops them", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    e.buzz("p2", T0 + 1000); e.buzz("p1", T0 + 1100); e.buzz("p3", T0 + 1200);
    e.removeParticipant("p1", T0 + 2000);
    expect(e.buzzerView()).toMatchObject({ status: "paused", queue: [{ participantId: "p2", nickname: "たろう" }, { participantId: "p3", nickname: "ケン" }] });
    e.removeParticipant("p2", T0 + 3000);
    expect(e.buzzerView()).toMatchObject({ status: "paused", revealedChars: 5, queue: [{ participantId: "p3", nickname: "ケン" }], lockedOut: [] });
    expect(e.leaderboard().map((x) => x.score)).toEqual([0]);
    e.removeParticipant("p3", T0 + 4000);
    expect(e.buzzerView()).toMatchObject({ status: "reading", readingStartedAt: T0 + 4000, revealedChars: 5, queue: [] });
  });

  it("rebaseReading keeps the revealed count continuous when charsPerSecond changes", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    e.rebaseReading(T0 + 1000);                 // 5 文字表示済み
    e.setSettingsOverride({ charsPerSecond: 10 });
    expect(e.buzzerView()).toMatchObject({ status: "reading", readingStartedAt: T0 + 1000, revealedChars: 5, charsPerSecond: 10 });
    e.buzz("p1", T0 + 1500);                    // + 0.5s × 10 = 5
    expect(e.buzzerView()?.revealedChars).toBe(10);
  });

  it("rebaseReading does nothing outside reading", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.rebaseReading(T0 + 1000);
    expect(e.buzzerView()).toMatchObject({ status: "ready", readingStartedAt: null, revealedChars: 0 });
  });

  it("close, next and endGame clear the buzzer state; the next question starts ready again", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    e.buzz("p1", T0 + 500);
    e.closeQuestion(T0 + 1000);
    expect(e.buzzerView()).toBeNull();
    expect(e.snapshot().buzzer).toBeNull();
    const r = e.next(T0 + 2000);
    expect(r.kind).toBe("question");
    expect(e.buzzerView()).toMatchObject({ status: "ready", promptLength: 5, queue: [], lockedOut: [] });
    e.endGame();
    expect(e.snapshot().buzzer).toBeNull();
  });

  it("restores a snapshot without a buzzer field and round-trips one with it", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    e.buzz("p1", T0 + 500);
    const snap = JSON.parse(JSON.stringify(e.snapshot())) as EngineState;
    expect(GameEngine.fromSnapshot(snap).buzzerView()).toEqual(e.buzzerView());
    const legacy = { ...snap } as Partial<EngineState>;
    delete legacy.buzzer;
    expect(GameEngine.fromSnapshot(legacy as EngineState).snapshot().buzzer).toBeNull();
  });

  it("counts an emoji prompt by code points", () => {
    startQuestions(e, makeBuzzerSet({}, [{ id: "x", type: "anagram", prompt: "a😀b", answers: ["c"] }]), false, T0);
    expect(e.buzzerView()?.promptLength).toBe(3);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npx vitest run test/room/GameEngine.test.ts`
Expected: FAIL（`e.buzzerView is not a function` など）

- [ ] **Step 4: `src/room/GameEngine.ts` を実装する**

import を変更:

```ts
import type { Answer, BuzzerState, LeaderboardEntry, LiveSettings, Participant, Phase, QuestionSet, QuestionSetMode, QuestionSettings } from "../shared/types";
import { resolveSettings } from "../shared/defaults";
import { isCorrect } from "../shared/normalize";
import { promptLength, revealedCount, type RevealTimeline } from "../shared/buzzer";
import type { BuzzerView, ErrorCode, IntroSlideView, IntroView, MyAnswerStatus, QuestionResultView, QuestionView } from "../shared/messages";
```

`EngineState` の末尾に追加:

```ts
  /** 早押しモードで出題中にだけ持つ。それ以外は null */
  buzzer: BuzzerState | null;
```

`NextOutcome` の下に追加:

```ts
export type BuzzOutcome =
  | { kind: "accepted"; position: number }          // キュー内の順番（1 が回答中）
  | { kind: "rejected"; code: ErrorCode };

export type JudgeOutcome =
  | { kind: "correct"; participantId: string; points: number; result: QuestionResultView }
  | { kind: "wrong"; participantId: string; points: number };
```

`create` の初期値に `buzzer: null,` を足す。`fromSnapshot` を次にする:

```ts
  static fromSnapshot(state: EngineState): GameEngine {
    // 旧スナップショットには settingsOverride / introIndex / buzzer が無い
    return new GameEngine({
      ...structuredClone(state),
      settingsOverride: structuredClone(state.settingsOverride ?? {}),
      introIndex: state.introIndex ?? 0,
      buzzer: structuredClone(state.buzzer ?? null),
    });
  }
```

getter の並びに追加:

```ts
  get mode(): QuestionSetMode { return this.s.questionSet?.mode ?? "anagram"; }
  private get isBuzzer(): boolean { return this.mode === "buzzer"; }
```

`removeParticipant` を置き換える:

```ts
  removeParticipant(id: string, now: number): Participant | null {
    const p = this.s.participants[id];
    if (!p) return null;
    delete this.s.participants[id];
    this.s.answers = this.s.answers.filter((a) => a.participantId !== id);
    const b = this.s.buzzer;
    if (b) {
      const wasAnswering = b.status === "paused" && b.queue[0] === id;
      b.queue = b.queue.filter((x) => x !== id);
      b.lockedOut = b.lockedOut.filter((x) => x !== id);
      // 回答中の人が消えたら不正解と同じように次へ回す（減点はしない）
      if (wasAnswering) this.resumeIfQueueEmpty(now);
    }
    return { ...p };
  }
```

`reconcileDeadline` の先頭の guard を変更（早押しでは締切を持たない）:

```ts
    if (this.s.phase !== "question" || !this.s.questionSet || this.isBuzzer) return { changed: false, deadlineAt: before };
```

`introView` の title に `mode` を足す:

```ts
      ? { kind: "title", name: set.name, coverImageUrl: set.coverImageUrl, questionCount: set.questions.length, settings: this.settings(0), mode: this.mode }
```

`openQuestion` を置き換える:

```ts
  protected openQuestion(index: number, now: number): void {
    const settings = this.settings(index);
    this.s.currentIndex = index;
    this.s.phase = "question";
    this.s.questionStartedAt = now;
    if (this.isBuzzer) {
      // 早押しは締切を持たず、GM の「読み上げ開始」を待つ
      this.s.deadlineAt = null;
      this.s.buzzer = { status: "ready", readingStartedAt: null, revealedChars: 0, queue: [], lockedOut: [] };
    } else {
      this.s.deadlineAt = settings.timerMode === "fixed" ? now + settings.timerSeconds * 1000 : null;
      this.s.buzzer = null;
    }
  }
```

`currentQuestionView` を置き換える:

```ts
  /** 早押しモードでは参加者に問題文とヒントを渡さない（スマホはボタン専用機） */
  currentQuestionView(role: "gm" | "player" = "gm"): QuestionView | null {
    const set = this.s.questionSet;
    if (!set || (this.s.phase !== "question" && this.s.phase !== "questionResult")) return null;
    const q = set.questions[this.s.currentIndex];
    const hidden = this.isBuzzer && role === "player";
    return {
      index: this.s.currentIndex,
      total: set.questions.length,
      mode: this.mode,
      prompt: hidden ? "" : q.prompt,
      hint: hidden ? undefined : q.hint,
      imageUrl: q.imageUrl,
      background: set.slideBackground,
      deadlineAt: this.s.deadlineAt,
      maxAttempts: this.settings().maxAttempts,
    };
  }
```

`submitAnswer` の最初の guard の次に追加:

```ts
    if (this.isBuzzer) return { kind: "rejected", code: "not_in_question" };
```

`closeQuestion` の `this.s.phase = "questionResult";` の次に `this.s.buzzer = null;` を足す。`endGame` にも `this.s.buzzer = null;` を足す。

`allParticipantsDone` を置き換える:

```ts
  allParticipantsDone(): boolean {
    if (this.s.phase !== "question") return false;
    const active = Object.values(this.s.participants).filter((p) => p.connected);
    if (active.length === 0) return false;
    const b = this.s.buzzer;
    if (b) return b.queue.length === 0 && active.every((p) => b.lockedOut.includes(p.id));
    const settings = this.settings();
    return active.every((p) => {
      const st = this.myStatus(p.id)!;
      if (st.correct) return true;
      return settings.maxAttempts !== null && st.attemptsUsed >= settings.maxAttempts;
    });
  }
```

`leaderboard()` の前に早押しのメソッド群を追加:

```ts
  // ---- buzzer mode ----
  private timeline(b: BuzzerState): RevealTimeline {
    const q = this.s.questionSet!.questions[this.s.currentIndex];
    return { status: b.status, readingStartedAt: b.readingStartedAt, revealedChars: b.revealedChars, promptLength: promptLength(q.prompt), charsPerSecond: this.settings().charsPerSecond };
  }

  buzzerView(): BuzzerView | null {
    const b = this.s.buzzer;
    if (!b || this.s.phase !== "question" || !this.s.questionSet) return null;
    const t = this.timeline(b);
    return {
      status: t.status, readingStartedAt: t.readingStartedAt, revealedChars: t.revealedChars, promptLength: t.promptLength, charsPerSecond: t.charsPerSecond,
      queue: b.queue.map((id) => ({ participantId: id, nickname: this.s.participants[id]?.nickname ?? "?" })),
      lockedOut: [...b.lockedOut],
    };
  }

  /** GM の「読み上げ開始」。ready のときだけ */
  startReading(now: number): BuzzerView {
    const b = this.s.buzzer;
    if (!b || this.s.phase !== "question" || b.status !== "ready") throw new Error("not ready to read");
    b.status = "reading";
    b.readingStartedAt = now;
    return this.buzzerView()!;
  }

  /** 読み上げ中なら区間の起点を今に取り直す。charsPerSecond を変える直前に呼び、表示済みの位置が飛ばないようにする */
  rebaseReading(now: number): void {
    const b = this.s.buzzer;
    if (!b || this.s.phase !== "question" || b.status !== "reading") return;
    b.revealedChars = revealedCount(this.timeline(b), now);
    b.readingStartedAt = now;
  }

  /** 参加者の早押し。受信順にキューへ。最初の1人で読み上げが止まる */
  buzz(participantId: string, now: number): BuzzOutcome {
    const b = this.s.buzzer;
    if (!b || this.s.phase !== "question") return { kind: "rejected", code: "not_in_question" };
    if (!this.s.participants[participantId]) return { kind: "rejected", code: "forbidden" };
    if (b.status === "ready") return { kind: "rejected", code: "not_reading" };
    if (b.lockedOut.includes(participantId)) return { kind: "rejected", code: "locked_out" };
    if (b.queue.includes(participantId)) return { kind: "rejected", code: "already_buzzed" };
    if (b.status === "reading") {
      b.revealedChars = revealedCount(this.timeline(b), now);
      b.readingStartedAt = null;
      b.status = "paused";
    }
    b.queue.push(participantId);
    return { kind: "accepted", position: b.queue.length };
  }

  /** GM の判定。回答中（paused かつキューの先頭）の参加者に対して行う */
  judge(correct: boolean, now: number): JudgeOutcome {
    const b = this.s.buzzer;
    if (!b || this.s.phase !== "question" || b.status !== "paused" || b.queue.length === 0) throw new Error("nobody is answering");
    const participantId = b.queue[0];
    const p = this.s.participants[participantId];
    const idx = this.s.currentIndex;
    const settings = this.settings(idx);
    if (correct) {
      const points = settings.basePoints;
      if (p) p.score += points;
      this.s.answers.push({ questionIndex: idx, participantId, text: "", correct: true, submittedAt: now, correctRank: 1, points });
      const result = this.closeQuestion(now);
      return { kind: "correct", participantId, points, result };
    }
    const points = settings.wrongPenalty === 0 ? 0 : -settings.wrongPenalty;
    if (p) p.score += points;
    this.s.answers.push({ questionIndex: idx, participantId, text: "", correct: false, submittedAt: now, correctRank: null, points });
    b.queue.shift();
    b.lockedOut.push(participantId);
    this.resumeIfQueueEmpty(now);
    return { kind: "wrong", participantId, points };
  }

  /** 回答者が居なくなったら続きから読み上げを再開する。残っていれば次の人が回答中のまま */
  private resumeIfQueueEmpty(now: number): void {
    const b = this.s.buzzer;
    if (!b || b.status !== "paused" || b.queue.length > 0) return;
    b.status = "reading";
    b.readingStartedAt = now;
  }
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run test/room/GameEngine.test.ts`
Expected: PASS（既存 + 新規 17 tests）

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: `src/room/Room.ts` だけがエラー（`removeParticipant` の引数不足、`SettingsView.mode` と `StateMessage.buzzer` の欠落）。Task 4 で直す

- [ ] **Step 7: コミット**

```bash
git add src/room/GameEngine.ts test/room/GameEngine.test.ts
git commit -m "feat(engine): buzzer mode state, startReading/buzz/judge and role-aware question views"
```

---

### Task 4: Room（Durable Object）の配信

**Files:**
- Modify: `src/room/Room.ts`
- Test: `test/room/Room.test.ts`

**Interfaces:**
- Consumes: Task 3 のメソッド群、Task 2 のメッセージ型
- Produces: WebSocket プロトコル（`startReading` / `buzz` / `judge` → `buzzerUpdated` / `answerResult` / `someoneCorrect` / `questionClosed`）。`state` に `buzzer` と `settings.mode` が入る

- [ ] **Step 1: 失敗する統合テストを書く**

`test/room/Room.test.ts` の末尾に追加:

```ts
describe("Room DO buzzer mode", () => {
  const PROMPT = "日本で一番高い山は何でしょう？";
  async function seedBuzzerSet() {
    return createQuestionSet(testEnv.DB, {
      name: "早押し", mode: "buzzer",
      settings: { ...DEFAULT_SETTINGS, timerMode: "fixed", timerSeconds: 1, charsPerSecond: 5, wrongPenalty: 20 },
      questions: [
        { id: "b1", type: "anagram", prompt: PROMPT, answers: ["富士山"], hint: "静岡" },
        { id: "b2", type: "anagram", prompt: "二番目は？", answers: ["北岳"] },
      ],
    });
  }
  async function setup(code: string) {
    const set = await seedBuzzerSet();
    await initRoom(code);
    const gm = await connect(code, "gm-token");
    await gm.waitFor("state");
    const p1 = await join(code, "みさき");
    const p2 = await join(code, "たろう");
    const c1 = await connect(code, p1.participantToken);
    const c2 = await connect(code, p2.participantToken);
    await c1.waitFor("state"); await c2.waitFor("state");
    await startGame(gm, set.id);
    const qsGm = await gm.waitFor("questionStarted");
    const qs1 = await c1.waitFor("questionStarted");
    await c2.waitFor("questionStarted");
    return { set, gm, p1, p2, c1, c2, qsGm, qs1 };
  }

  it("sends the prompt only to the GM, starts ready without a deadline, and the alarm is the cleanup", async () => {
    const { gm, c1, qsGm, qs1 } = await setup("BUZZ01");
    expect(qsGm.question).toMatchObject({ mode: "buzzer", prompt: PROMPT, hint: "静岡", deadlineAt: null });
    expect(qs1.question).toMatchObject({ mode: "buzzer", prompt: "", deadlineAt: null });
    expect(qs1.question.hint).toBeUndefined();
    const bz = await c1.waitFor("buzzerUpdated");
    expect(bz.buzzer).toMatchObject({ status: "ready", promptLength: 15, charsPerSecond: 5, queue: [], lockedOut: [] });
    await gm.waitFor("buzzerUpdated");
    expect((await gm.waitFor("settingsUpdated")).settings.mode).toBe("buzzer");
    // 締切アラームではなく 24h の cleanup なので、発火するとルームが消える
    expect(await runDurableObjectAlarm(stubFor("BUZZ01"))).toBe(true);
    expect((await stubFor("BUZZ01").fetch("http://room/exists")).status).toBe(404);
  });

  it("runs a buzzer question: startReading, buzz, wrong, next answerer, correct, closed", async () => {
    const { gm, p1, p2, c1, c2 } = await setup("BUZZ02");
    c1.send({ type: "buzz" });
    expect((await c1.waitFor("error")).code).toBe("not_reading");
    c1.send({ type: "answer", text: "富士山" });
    expect((await c1.waitFor("error")).code).toBe("not_in_question");

    gm.send({ type: "startReading" });
    const reading = await c1.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    expect(reading.buzzer.readingStartedAt).not.toBeNull();

    c2.send({ type: "buzz" });
    const paused = await gm.waitFor("buzzerUpdated", (m) => m.buzzer.status === "paused");
    expect(paused.buzzer.queue).toEqual([{ participantId: p2.participantId, nickname: "たろう" }]);
    c1.send({ type: "buzz" });
    await gm.waitFor("buzzerUpdated", (m) => m.buzzer.queue.length === 2);
    c1.send({ type: "buzz" });
    expect((await c1.waitFor("error")).code).toBe("already_buzzed");

    gm.send({ type: "judge", correct: false });
    const wrong = await c2.waitFor("answerResult");
    expect(wrong).toEqual({ type: "answerResult", correct: false, correctRank: null, remainingAttempts: 0, points: -20 });
    const nextUp = await gm.waitFor("buzzerUpdated", (m) => m.buzzer.lockedOut.length === 1);
    expect(nextUp.buzzer).toMatchObject({ status: "paused", queue: [{ participantId: p1.participantId, nickname: "みさき" }], lockedOut: [p2.participantId] });
    expect((await gm.waitFor("leaderboard", (m) => m.entries.some((e) => e.score < 0))).entries.find((e) => e.participantId === p2.participantId)?.score).toBe(-20);
    c2.send({ type: "buzz" });
    expect((await c2.waitFor("error")).code).toBe("locked_out");

    gm.send({ type: "judge", correct: true });
    expect(await c1.waitFor("answerResult")).toEqual({ type: "answerResult", correct: true, correctRank: 1, remainingAttempts: null, points: 100 });
    expect(await gm.waitFor("someoneCorrect")).toMatchObject({ nickname: "みさき", correctRank: 1, points: 100 });
    const closed = await c2.waitFor("questionClosed");
    expect(closed.result.answers).toEqual(["富士山"]);
    expect(closed.result.results).toEqual([{ participantId: p1.participantId, nickname: "みさき", correctRank: 1, points: 100 }]);

    // 二度押し: すでに閉じているので invalid_state、点数は変わらない
    gm.send({ type: "judge", correct: true });
    expect((await gm.waitFor("error")).code).toBe("invalid_state");
    const gm2 = await connect("BUZZ02", "gm-token");
    const st = await gm2.waitFor("state");
    expect(st.phase).toBe("questionResult");
    expect(st.buzzer).toBeNull();
    expect(st.leaderboard.find((e) => e.participantId === p1.participantId)?.score).toBe(100);
  });

  it("rejects startReading/judge from players and buzz from the GM, and startReading twice", async () => {
    const { gm, c1 } = await setup("BUZZ03");
    c1.send({ type: "startReading" });
    expect((await c1.waitFor("error")).code).toBe("forbidden");
    c1.send({ type: "judge", correct: true });
    expect((await c1.waitFor("error")).code).toBe("forbidden");
    gm.send({ type: "buzz" });
    expect((await gm.waitFor("error")).code).toBe("forbidden");
    gm.send({ type: "judge", correct: true });
    expect((await gm.waitFor("error")).code).toBe("invalid_state");
    gm.send({ type: "startReading" });
    await gm.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    gm.send({ type: "startReading" });
    expect((await gm.waitFor("error")).code).toBe("invalid_state");
  });

  it("a GM reconnecting mid-answer gets the queue with nicknames in state", async () => {
    const { gm, p2, c2 } = await setup("BUZZ04");
    gm.send({ type: "startReading" });
    await c2.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    c2.send({ type: "buzz" });
    await gm.waitFor("buzzerUpdated", (m) => m.buzzer.status === "paused");
    const gm2 = await connect("BUZZ04", "gm-token");
    const st = await gm2.waitFor("state");
    expect(st.question?.prompt).toBe(PROMPT);
    expect(st.buzzer).toMatchObject({ status: "paused", queue: [{ participantId: p2.participantId, nickname: "たろう" }] });
    // 参加者の再接続では問題文は空のまま
    const c2b = await connect("BUZZ04", (await join("BUZZ04", "ゆい")).participantToken);
    expect((await c2b.waitFor("state")).question?.prompt).toBe("");
  });

  it("closes automatically when every connected participant is locked out", async () => {
    const { gm, c1, c2 } = await setup("BUZZ05");
    gm.send({ type: "startReading" });
    await c1.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    c1.send({ type: "buzz" }); await gm.waitFor("buzzerUpdated", (m) => m.buzzer.queue.length === 1);
    gm.send({ type: "judge", correct: false });
    await gm.waitFor("buzzerUpdated", (m) => m.buzzer.lockedOut.length === 1);
    c2.send({ type: "buzz" }); await gm.waitFor("buzzerUpdated", (m) => m.buzzer.queue.length === 1);
    gm.send({ type: "judge", correct: false });
    const closed = await gm.waitFor("questionClosed");
    expect(closed.result.results).toEqual([]);
  });

  it("kicking the answerer passes the turn and broadcasts buzzerUpdated", async () => {
    const { gm, p1, p2, c1, c2 } = await setup("BUZZ06");
    gm.send({ type: "startReading" });
    await c1.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    c1.send({ type: "buzz" }); await gm.waitFor("buzzerUpdated", (m) => m.buzzer.queue.length === 1);
    c2.send({ type: "buzz" }); await gm.waitFor("buzzerUpdated", (m) => m.buzzer.queue.length === 2);
    gm.send({ type: "kick", participantId: p1.participantId });
    await gm.waitFor("participantRemoved");
    const after = await gm.waitFor("buzzerUpdated", (m) => m.buzzer.queue.length === 1);
    expect(after.buzzer.queue[0].participantId).toBe(p2.participantId);
  });

  it("changing charsPerSecond mid-reading rebases the segment and broadcasts buzzerUpdated", async () => {
    const { gm, c1 } = await setup("BUZZ07");
    gm.send({ type: "startReading" });
    const reading = await gm.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    gm.send({ type: "updateSettings", settings: { charsPerSecond: 20 } });
    const rebased = await c1.waitFor("buzzerUpdated", (m) => m.buzzer.charsPerSecond === 20);
    expect(rebased.buzzer.status).toBe("reading");
    expect(rebased.buzzer.readingStartedAt!).toBeGreaterThanOrEqual(reading.buzzer.readingStartedAt!);
    expect((await gm.waitFor("settingsUpdated", (m) => m.settings.override.charsPerSecond === 20)).settings.effective?.charsPerSecond).toBe(20);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/room/Room.test.ts -t "buzzer"`
Expected: FAIL（`bad_message` が返る、`buzzerUpdated` が来ない）

- [ ] **Step 3: `src/room/Room.ts` を編集する**

`dispatch` の `answer` ブロックの直後、`if (attachment.role !== "gm") …` の前に参加者の `buzz` を追加:

```ts
    if (msg.type === "buzz") {
      if (attachment.role !== "player") return this.sendError(ws, "forbidden", "GMは早押しできません");
      const outcome = engine.buzz(attachment.participantId, now);
      if (outcome.kind === "rejected") return this.sendError(ws, outcome.code, this.errorText(outcome.code));
      this.save();
      this.broadcastBuzzer();
      return;
    }
```

`switch (msg.type)` に GM の 2 ケースを追加:

```ts
      case "startReading": {
        if (engine.buzzerView()?.status !== "ready") return this.sendError(ws, "invalid_state", "読み上げを開始できる状態ではありません");
        engine.startReading(now);
        this.save();
        this.broadcastBuzzer();
        return;
      }
      case "judge": {
        const view = engine.buzzerView();
        if (!view || view.status !== "paused" || view.queue.length === 0) return this.sendError(ws, "invalid_state", "回答中の参加者がいません");
        const outcome = engine.judge(msg.correct, now);
        this.save();
        const answerer = engine.getParticipant(outcome.participantId);
        if (outcome.kind === "correct") {
          this.sendToParticipant(outcome.participantId, { type: "answerResult", correct: true, correctRank: 1, remainingAttempts: null, points: outcome.points });
          if (answerer) this.broadcast({ type: "someoneCorrect", participantId: answerer.id, nickname: answerer.nickname, correctRank: 1, points: outcome.points });
          await this.afterClose(outcome.result);
          return;
        }
        this.sendToParticipant(outcome.participantId, { type: "answerResult", correct: false, correctRank: null, remainingAttempts: 0, points: outcome.points });
        this.broadcastBuzzer();
        this.broadcast({ type: "leaderboard", entries: engine.leaderboard() });
        if (engine.allParticipantsDone()) await this.closeQuestion(now);
        return;
      }
```

`next` ケースの `question` 分岐を、役割ごとに送り分けて早押し状態も配るよう変更:

```ts
        } else if (r.kind === "question") {
          this.broadcastQuestionStarted();
          // 問題ごとの上書きで効く設定が変わりうる
          this.broadcast({ type: "settingsUpdated", settings: this.settingsView() });
          this.broadcastBuzzer();
          await this.armDeadline(r.question.deadlineAt);
        } else {
```

`updateSettings` ケースを変更（読み上げ中なら起点を取り直してから上書きし、早押し状態を配る）:

```ts
      case "updateSettings": {
        engine.rebaseReading(now);
        engine.setSettingsOverride(msg.settings);
        // 出題中ならタイマーモードの変更を今の問題の締切に反映し、アラームを張り直す
        const dl = engine.reconcileDeadline(now);
        this.save();
        if (dl.changed) {
          this.broadcast({ type: "deadlineSet", deadlineAt: dl.deadlineAt });
          await this.armDeadline(dl.deadlineAt);
        }
        this.broadcast({ type: "settingsUpdated", settings: this.settingsView() });
        this.broadcastBuzzer();
        return;
      }
```

`kick` ケースの `engine.removeParticipant(msg.participantId)` を `engine.removeParticipant(msg.participantId, now)` にし、`this.broadcast({ type: "leaderboard", … })` の次の行に `this.broadcastBuzzer();` を足す。

`closeQuestion` を 2 つに分ける（`judge` 正解はエンジン側で閉じ済みなので後半だけ使う）:

```ts
  private async closeQuestion(now: number): Promise<void> {
    await this.afterClose(this.engine!.closeQuestion(now));
  }

  /** 問題が閉じた後の配信。エンジン側で閉じ済みの結果を受け取る */
  private async afterClose(result: QuestionResultView): Promise<void> {
    this.save();
    this.broadcast({ type: "questionClosed", result });
    this.broadcast({ type: "leaderboard", entries: this.engine!.leaderboard() });
    await this.scheduleCleanup();
  }
```

import に `QuestionResultView` を足す:

```ts
import { parseClientMessage, type ClientMessage, type QuestionResultView, type ServerMessage, type StateMessage, type SettingsView, type ErrorCode } from "../shared/messages";
```

`settingsView` に `mode` を足し、`stateFor` を役割対応にする:

```ts
  private settingsView(): SettingsView {
    const engine = this.engine!;
    const effective: LiveSettings | null = engine.questionSet ? engine.settings() : null;
    return { override: engine.settingsOverride(), effective, mode: engine.questionSet ? engine.mode : null };
  }
```

`stateFor` の `question: engine.currentQuestionView(),` を `question: engine.currentQuestionView(attachment.role),` にし、`settings: this.settingsView(),` の次に `buzzer: engine.buzzerView(),` を足す。

`broadcastState` の下に 3 つのヘルパーを追加:

```ts
  /** 早押しモードでは参加者に問題文を送らないので、役割ごとに中身を変えて配る */
  private broadcastQuestionStarted(): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment;
      this.send(ws, { type: "questionStarted", question: this.engine!.currentQuestionView(att.role)! });
    }
  }

  /** 早押しモードで出題中なら現在の早押し状態を全員に配る。それ以外は何もしない */
  private broadcastBuzzer(): void {
    const buzzer = this.engine!.buzzerView();
    if (buzzer) this.broadcast({ type: "buzzerUpdated", buzzer });
  }

  private sendToParticipant(participantId: string, msg: ServerMessage): void {
    for (const sock of this.ctx.getWebSockets(`pid:${participantId}`)) this.send(sock, msg);
  }
```

`errorText` に 3 件追加:

```ts
      case "not_reading": return "まだ読み上げが始まっていません";
      case "locked_out": return "この問題はもう押せません";
      case "already_buzzed": return "すでに押しています";
```

- [ ] **Step 4: テストと型チェックを通す**

Run: `npx vitest run test/room && npm run typecheck`
Expected: すべて PASS。typecheck は `src/web` 側で `SettingsView.mode` / `StateMessage.buzzer` 由来のエラーが出ることがある（`clientState.ts` の `initialClientState.settings` に `mode` が無い）。出たら Task 5 で直すので、`src/room` に残るエラーが無いことだけ確認する

- [ ] **Step 5: コミット**

```bash
git add src/room/Room.ts test/room/Room.test.ts
git commit -m "feat(room): relay buzzer messages, send prompts only to the GM and broadcast buzzerUpdated"
```

---

### Task 5: クライアント状態（reducer）

**Files:**
- Modify: `src/web/lib/clientState.ts`
- Test: `test/web/clientState.test.ts`

**Interfaces:**
- Produces: `ClientState.buzzer: BuzzerView | null`、`ClientState.settings.mode`

- [ ] **Step 1: 失敗するテストを書く**

`test/web/clientState.test.ts` の末尾に追加:

```ts
describe("buzzer mode", () => {
  const question = { index: 0, total: 2, mode: "buzzer" as const, prompt: "", deadlineAt: null, maxAttempts: 3 };
  const buzzer = { status: "reading" as const, readingStartedAt: T0, revealedChars: 0, promptLength: 15, charsPerSecond: 5, queue: [], lockedOut: [] };

  it("state carries the buzzer view", () => {
    const s = applyServerMessage(initialClientState, { ...baseState, phase: "question", question, buzzer }, T0);
    expect(s.buzzer).toEqual(buzzer);
  });

  it("buzzerUpdated replaces the view; questionStarted and questionClosed clear it", () => {
    let s = applyServerMessage(withState(), { type: "questionStarted", question }, T0);
    expect(s.buzzer).toBeNull();
    s = applyServerMessage(s, { type: "buzzerUpdated", buzzer }, T0);
    expect(s.buzzer?.status).toBe("reading");
    s = applyServerMessage(s, { type: "buzzerUpdated", buzzer: { ...buzzer, status: "paused", revealedChars: 7, readingStartedAt: null, queue: [{ participantId: "p1", nickname: "みさき" }] } }, T0);
    expect(s.buzzer).toMatchObject({ status: "paused", revealedChars: 7 });
    s = applyServerMessage(s, { type: "questionClosed", result: { answers: ["富士山"], results: [] } }, T0);
    expect(s.buzzer).toBeNull();
    s = applyServerMessage(s, { type: "buzzerUpdated", buzzer }, T0);
    s = applyServerMessage(s, { type: "questionStarted", question: { ...question, index: 1 } }, T0);
    expect(s.buzzer).toBeNull();
  });

  it("introStarted and finalResult clear the buzzer view", () => {
    const intro: IntroView = { index: 0, total: 1, slide: { kind: "title", name: "早押し", questionCount: 1, settings: DEFAULT_SETTINGS, mode: "buzzer" } };
    let s = applyServerMessage(withState(), { type: "buzzerUpdated", buzzer }, T0);
    expect(applyServerMessage(s, { type: "introStarted", intro }, T0).buzzer).toBeNull();
    s = applyServerMessage(s, { type: "finalResult", entries: [] }, T0);
    expect(s.buzzer).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/web/clientState.test.ts`
Expected: FAIL（`s.buzzer` が `undefined`）

- [ ] **Step 3: `src/web/lib/clientState.ts` を編集する**

import に `BuzzerView` を足す:

```ts
import type { BuzzerView, ErrorCode, IntroView, MyAnswerStatus, QuestionResultView, QuestionView, ServerMessage, SettingsView } from "../../shared/messages";
```

`ClientState` の `kicked: boolean;` の次に追加:

```ts
  buzzer: BuzzerView | null; // 早押しモードで出題中のみ
```

`initialClientState` の `settings: { override: {}, effective: null },` を `settings: { override: {}, effective: null, mode: null },` にし、`kicked: false,` の次に `buzzer: null,` を足す。

reducer:

- `case "state"` の戻り値に `buzzer: msg.buzzer,` を足す
- `case "introStarted"` の戻り値に `buzzer: null,` を足す
- `case "questionStarted"` の戻り値に `buzzer: null,` を足す
- `case "questionClosed"` を `return { ...s, phase: "questionResult", questionResult: msg.result, buzzer: null };` にする
- `case "finalResult"` の戻り値に `buzzer: null` を足す
- `case "error"` の前に追加:

```ts
    case "buzzerUpdated":
      return { ...s, buzzer: msg.buzzer };
```

- [ ] **Step 4: テストと型チェックを通す**

Run: `npx vitest run test/web && npm run typecheck`
Expected: PASS。typecheck もここで全体が通る（通らなければエラー箇所を直す。想定されるのは `src/web/gm/GmRoomPage.tsx` などではなく、`SettingsView` を組み立てている箇所のみ）

- [ ] **Step 5: コミット**

```bash
git add src/web/lib/clientState.ts test/web/clientState.test.ts
git commit -m "feat(web): track the buzzer view in client state"
```

---

### Task 6: スライド部品・ラベル・文字サイズ

**Files:**
- Modify: `src/web/lib/labels.ts`
- Modify: `src/web/lib/slideText.ts`
- Modify: `src/web/components/Slides.tsx`
- Modify: `src/web/gm/GmRoomPage.tsx`（タイトルスライドに `mode` を渡す 1 行だけ）
- Test: `test/web/slideText.test.ts`

**Interfaces:**
- Produces:
  - `MODE_LABELS: Record<QuestionSetMode, string>`
  - `buzzerSlidePromptSizeClass(len: number): string`（cqw 単位、スライド用）、`buzzerScreenPromptSizeClass(len: number): string`（GM 画面用）
  - `TitleSlidePreview` と `QuestionSlidePreview` に `mode?: QuestionSetMode` prop（省略時 `"anagram"`）

- [ ] **Step 1: 失敗するテストを書く**

`test/web/slideText.test.ts` の末尾に追加:

```ts
import { buzzerScreenPromptSizeClass, buzzerSlidePromptSizeClass } from "../../src/web/lib/slideText";

describe("buzzer prompt size", () => {
  it("steps down as the prompt gets longer (slide, cqw units)", () => {
    expect(buzzerSlidePromptSizeClass(0)).toBe("text-[5cqw]");
    expect(buzzerSlidePromptSizeClass(40)).toBe("text-[5cqw]");
    expect(buzzerSlidePromptSizeClass(41)).toBe("text-[4cqw]");
    expect(buzzerSlidePromptSizeClass(100)).toBe("text-[4cqw]");
    expect(buzzerSlidePromptSizeClass(101)).toBe("text-[3cqw]");
  });
  it("steps down as the prompt gets longer (GM screen)", () => {
    expect(buzzerScreenPromptSizeClass(40)).toBe("text-5xl");
    expect(buzzerScreenPromptSizeClass(100)).toBe("text-4xl");
    expect(buzzerScreenPromptSizeClass(101)).toBe("text-3xl");
  });
});
```

（ファイル先頭にすでに `describe, it, expect` の import がある。追加の import 文はファイル先頭の import 群の直後に移してもよい）

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/web/slideText.test.ts`
Expected: FAIL（export が無い）

- [ ] **Step 3: 実装する**

`src/web/lib/slideText.ts` の末尾に追加:

```ts
/** 早押しの問題文（読み上げる一文）は長いので、長さに応じて段階的に小さくする。スライド（cqw）用 */
export function buzzerSlidePromptSizeClass(len: number): string {
  if (len <= 40) return "text-[5cqw]";
  if (len <= 100) return "text-[4cqw]";
  return "text-[3cqw]";
}

/** 同じ段階を GM 画面（rem 基準）で */
export function buzzerScreenPromptSizeClass(len: number): string {
  if (len <= 40) return "text-5xl";
  if (len <= 100) return "text-4xl";
  return "text-3xl";
}
```

`src/web/lib/labels.ts` に追加:

```ts
import type { QuestionSetMode, TimerMode } from "../../shared/types";

export const MODE_LABELS: Record<QuestionSetMode, string> = {
  anagram: "アナグラム（文字で回答）",
  buzzer: "早押し（口頭で回答）",
};
```

（既存の `TIMER_MODE_LABELS` はそのまま。`import type { TimerMode }` の行を上の 1 行に置き換える）

`src/web/components/Slides.tsx`:

import を変更:

```ts
import { Timer, Zap } from "lucide-react";
import type { Question, QuestionSetMode, QuestionSettings } from "../../shared/types";
import { isLightColor } from "../lib/color";
import { buzzerSlidePromptSizeClass, introBodySizeClass } from "../lib/slideText";
import { promptLength } from "../../shared/buzzer";
```

`TitleSlidePreview` のシグネチャに `mode = "anagram"` を足し、`rules` を分岐する:

```ts
export function TitleSlidePreview({ name, coverImageUrl, questionCount, settings, mode = "anagram", compact = false }: {
  name: string; coverImageUrl?: string; questionCount: number; settings: QuestionSettings; mode?: QuestionSetMode; compact?: boolean;
}) {
  const timer = settings.timerMode === "none" ? "GMが締切" : settings.timerMode === "fixed" ? `${settings.timerSeconds}秒` : `正解後${settings.timerSeconds}秒`;
  const rules = mode === "buzzer" ? (
    <>
      全{questionCount}問 ・ <Zap className="inline h-[2.4cqw] w-[2.4cqw] align-[-0.15em]" aria-hidden /> 早押し ・ {settings.charsPerSecond}文字/秒
    </>
  ) : (
    <>
      全{questionCount}問 ・ <Timer className="inline h-[2.4cqw] w-[2.4cqw] align-[-0.15em]" aria-hidden /> {timer}
      {settings.maxAttempts !== null && ` ・ お手付き${settings.maxAttempts}回まで`}
    </>
  );
```

（関数の残りはそのまま）

`QuestionSlidePreview` のシグネチャに `mode = "anagram"` を足し、タイマーのバッジと問題文を分岐する:

```ts
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
```

`src/web/gm/GmRoomPage.tsx` のタイトルスライド呼び出しに `mode` を渡す:

```tsx
                ? <TitleSlidePreview name={intro.slide.name} coverImageUrl={intro.slide.coverImageUrl} questionCount={intro.slide.questionCount} settings={intro.slide.settings} mode={intro.slide.mode} />
```

- [ ] **Step 4: テストと型チェックを通す**

Run: `npx vitest run test/web/slideText.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/web/lib/labels.ts src/web/lib/slideText.ts src/web/components/Slides.tsx src/web/gm/GmRoomPage.tsx test/web/slideText.test.ts
git commit -m "feat(web): buzzer-aware title and question slides, mode labels and prompt sizing"
```

---

### Task 7: 編集画面（出題形式の切替・早押し用の入力）

**Files:**
- Modify: `src/web/lib/editorChecks.ts`
- Modify: `src/web/admin/SlideInspector.tsx`
- Modify: `src/web/admin/QuestionSetEditPage.tsx`
- Test: `test/web/editorChecks.test.ts`

**Interfaces:**
- Consumes: `MODE_LABELS`, `buzzer` 対応の `TitleSlidePreview` / `QuestionSlidePreview`（Task 6）、`MIN_CHARS_PER_SECOND` / `MAX_CHARS_PER_SECOND`（Task 1）
- Produces: `EditorDraft.mode: QuestionSetMode`、`questionIncomplete(q, mode)`、`findProblem(d)` の早押し分岐

- [ ] **Step 1: 失敗するテストを書く**

`test/web/editorChecks.test.ts` を次のように変える。`draft` 定数に `mode` を足す:

```ts
const draft = { name: "テスト", mode: "anagram" as const, introSlides: [] as IntroSlide[], settings: DEFAULT_SETTINGS, questions: [q] };
```

末尾に追加:

```ts
import { questionIncomplete } from "../../src/web/lib/editorChecks";

describe("buzzer mode checks", () => {
  it("an image-only question is complete for anagram but incomplete for buzzer", () => {
    const imageOnly = { ...q, prompt: "", imageUrl: "/api/images/a.png" };
    expect(questionIncomplete(imageOnly, "anagram")).toBe(false);
    expect(questionIncomplete(imageOnly, "buzzer")).toBe(true);
    expect(questionIncomplete({ ...q, prompt: "富士山は？" }, "buzzer")).toBe(false);
  });

  it("findProblem demands a prompt for every buzzer question", () => {
    const d = { ...draft, mode: "buzzer" as const, questions: [q, { ...q, id: "q2", prompt: "  ", imageUrl: "/api/images/a.png" }] };
    expect(findProblem(d)).toEqual({ slide: 1, message: "第2問の問題文を入力してください" });
    expect(findProblem({ ...draft, mode: "buzzer" as const })).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/web/editorChecks.test.ts`
Expected: FAIL（`questionIncomplete(imageOnly, "buzzer")` が `false`、`findProblem` が `null`）

- [ ] **Step 3: `src/web/lib/editorChecks.ts` を編集する**

```ts
import type { IntroSlide, Question, QuestionSetMode, QuestionSettings } from "../../shared/types";
```

`EditorDraft` に `mode: QuestionSetMode;` を `name` の次に足す。`questionIncomplete` を置き換える:

```ts
/** 早押しでは問題文が必須（画像だけでは読み上げられない）。アナグラムは画像があれば出題文を省略できる */
export function questionIncomplete(q: Question, mode: QuestionSetMode = "anagram"): boolean {
  const noPrompt = mode === "buzzer" ? !q.prompt.trim() : !q.prompt.trim() && !q.imageUrl;
  return noPrompt || !q.answers.some((a) => a.trim());
}
```

`findProblem` の問題ループを置き換える:

```ts
  for (const [i, q] of d.questions.entries()) {
    if (!q.answers.some((a) => a.trim())) return { slide: i, message: `第${i + 1}問の正解を入力してください` };
    if (d.mode === "buzzer") {
      if (!q.prompt.trim()) return { slide: i, message: `第${i + 1}問の問題文を入力してください` };
    } else if (!q.prompt.trim() && !q.imageUrl) {
      return { slide: i, message: `第${i + 1}問の出題文か画像を入れてください（出題文は「生成」で正解から作れます）` };
    }
  }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run test/web/editorChecks.test.ts`
Expected: PASS

- [ ] **Step 5: `src/web/admin/SlideInspector.tsx` を編集する**

import を変更:

```ts
import { useState } from "react";
import { MODE_LABELS, TIMER_MODE_LABELS } from "../lib/labels";
import { ChevronDown, ChevronRight, Plus, Shuffle, X } from "lucide-react";
import type { IntroSlide, Question, QuestionSetMode, QuestionSettings, TimerMode } from "../../shared/types";
import { MAX_CHARS_PER_SECOND, MIN_CHARS_PER_SECOND } from "../../shared/validateQuestionSet";
import { shuffleAnagram } from "../../shared/anagram";
import { Button } from "../components/Button";
import { Field, SectionTitle, inputClass, textareaClass } from "./fields";
import { ImageField } from "./ImageField";
```

`TitleInspector` のシグネチャに `mode` と `onMode` を足し、企画名の次に出題形式を置き、共通設定を分岐する:

```tsx
export function TitleInspector({ name, mode, coverImageUrl, slideBackground, settings, passphrase, onName, onMode, onCover, onSlideBackground, onSettings }: {
  name: string; mode: QuestionSetMode; coverImageUrl?: string; slideBackground?: string; settings: QuestionSettings; passphrase: string;
  onName: (v: string) => void; onMode: (v: QuestionSetMode) => void; onCover: (v: string | undefined) => void; onSlideBackground: (v: string | undefined) => void; onSettings: (s: QuestionSettings) => void;
}) {
  const buzzer = mode === "buzzer";
  return (
    <div className="flex flex-col gap-5">
      <Field label="企画名">
        <input value={name} onChange={(e) => onName(e.target.value)} placeholder="例: 新人歓迎会クイズ 2026" className={`${inputClass} text-lg`} autoFocus />
      </Field>
      <Field label="出題形式" hint="セット全体で1つ">
        <select value={mode} onChange={(e) => onMode(e.target.value as QuestionSetMode)} className={inputClass}>
          {(Object.keys(MODE_LABELS) as QuestionSetMode[]).map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
        </select>
        {buzzer && <p className="mt-1 text-xs font-normal text-slate-500">問題文が GM 画面に一文字ずつ表示され、参加者はスマホのボタンで早押しして口頭で答えます。正解・不正解は GM が判定します</p>}
      </Field>
```

（表紙画像・背景色の部分はそのまま）共通設定のブロックを置き換える:

```tsx
      <div className="border-t border-slate-700 pt-4">
        <SectionTitle>全問共通の設定</SectionTitle>
        <p className="mt-1 text-xs text-slate-500">各問題の「この問題だけの設定」で個別に上書きできます。</p>
        <div className="mt-3 flex flex-col gap-3">
          {!buzzer && (
            <Field label="制限時間">
              <select value={settings.timerMode} onChange={(e) => onSettings({ ...settings, timerMode: e.target.value as TimerMode })} className={inputClass}>
                {(Object.keys(TIMER_LABELS) as TimerMode[]).map((m) => <option key={m} value={m}>{TIMER_LABELS[m]}</option>)}
              </select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            {!buzzer && (
              <Field label="秒数">
                <input type="number" min={0} value={settings.timerSeconds} onChange={(e) => onSettings({ ...settings, timerSeconds: num(e.target.value) })} className={inputClass} disabled={settings.timerMode === "none"} />
              </Field>
            )}
            {!buzzer && (
              <Field label="お手付き上限" hint="空で無制限">
                <input type="number" min={1} value={settings.maxAttempts ?? ""} onChange={(e) => onSettings({ ...settings, maxAttempts: e.target.value === "" ? null : Number(e.target.value) })} className={inputClass} />
              </Field>
            )}
            {buzzer && (
              <Field label="読み上げ速度" hint="文字/秒">
                <input type="number" min={MIN_CHARS_PER_SECOND} max={MAX_CHARS_PER_SECOND} value={settings.charsPerSecond} onChange={(e) => onSettings({ ...settings, charsPerSecond: num(e.target.value) })} className={inputClass} />
              </Field>
            )}
            <Field label="基本点">
              <input type="number" value={settings.basePoints} onChange={(e) => onSettings({ ...settings, basePoints: num(e.target.value) })} className={inputClass} />
            </Field>
            <Field label="不正解ペナルティ">
              <input type="number" min={0} value={settings.wrongPenalty} onChange={(e) => onSettings({ ...settings, wrongPenalty: num(e.target.value) })} className={inputClass} />
            </Field>
          </div>
          {!buzzer && (
            <Field label="正解順ボーナス" hint="1位から順にカンマ区切り">
              <input value={settings.rankBonus.join(",")} onChange={(e) => onSettings({ ...settings, rankBonus: e.target.value.split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n)) })} className={inputClass} />
            </Field>
          )}
        </div>
      </div>
```

`QuestionInspector` のシグネチャに `mode` を足し、出題文とヒントを分岐する:

```tsx
export function QuestionInspector({ question, index, mode, baseSettings, passphrase, onChange }: {
  question: Question; index: number; mode: QuestionSetMode; baseSettings: QuestionSettings; passphrase: string; onChange: (patch: Partial<Question>) => void;
}) {
  const answers = question.answers.length ? question.answers : [""];
  const setAnswer = (i: number, v: string) => onChange({ answers: answers.map((a, j) => (j === i ? v : a)) });
  const removeAnswer = (i: number) => onChange({ answers: answers.length === 1 ? [""] : answers.filter((_, j) => j !== i) });
  const primary = answers[0]?.trim() ?? "";
  const buzzer = mode === "buzzer";
```

正解候補のブロックはそのまま。`<Field label="出題文" …>` を置き換える:

```tsx
      {buzzer ? (
        <Field label="問題文（読み上げる文章）" hint="GM 画面に一文字ずつ表示される。参加者には見せない">
          <textarea rows={4} value={question.prompt} onChange={(e) => onChange({ prompt: e.target.value })} placeholder="例: 日本で一番高い山は何でしょう？" className={`${textareaClass} text-lg`} />
        </Field>
      ) : (
        <Field label="出題文" hint="画面に大きく表示されるシャッフル済み文字列。画像に文字が描かれていれば空欄でよい">
          <div className="mt-1 flex gap-2">
            <input value={question.prompt} onChange={(e) => onChange({ prompt: e.target.value })} placeholder="例: ごんり" className={`${inputClass} mt-0 text-lg font-bold tracking-widest`} />
            <Button type="button" variant="secondary" icon={Shuffle} disabled={!primary} onClick={() => onChange({ prompt: shuffleAnagram(primary) })} aria-label="正解からシャッフル生成" className="shrink-0">生成</Button>
          </div>
        </Field>
      )}
```

ヒントの `<Field label="ヒント（任意）" …>` を `{!buzzer && ( … )}` で囲む。`OverridesPanel` 呼び出しに `mode={mode}` を足す。

`OverridesPanel` のシグネチャに `mode: QuestionSetMode` を足し、中身を分岐する:

```tsx
function OverridesPanel({ index, mode, overrides, base, onChange }: {
  index: number; mode: QuestionSetMode; overrides?: Partial<QuestionSettings>; base: QuestionSettings; onChange: (o: Partial<QuestionSettings> | undefined) => void;
}) {
  const active = !!overrides && Object.keys(overrides).length > 0;
  const [open, setOpen] = useState(active);
  const o = overrides ?? {};
  const set = (patch: Partial<QuestionSettings>, clear?: (keyof QuestionSettings)[]) => {
    const next: Partial<QuestionSettings> = { ...o, ...patch };
    for (const k of clear ?? []) delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  const timerMode = o.timerMode ?? base.timerMode;
  const buzzer = mode === "buzzer";

  return (
    <div className="rounded-xl border border-slate-700">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold text-slate-300 hover:bg-slate-700/50" aria-expanded={open}>
        {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        第{index + 1}問だけの設定
        {active && <span className="ml-auto rounded-full bg-purple-500/30 px-2 py-0.5 text-xs text-purple-200">上書き中</span>}
      </button>
      {open && buzzer && (
        <div className="grid grid-cols-2 gap-3 border-t border-slate-700 p-3">
          <Field label="基本点" hint={`共通: ${base.basePoints}`}>
            <input type="number" value={o.basePoints ?? ""} placeholder={String(base.basePoints)}
              onChange={(e) => (e.target.value === "" ? set({}, ["basePoints"]) : set({ basePoints: Number(e.target.value) }))} className={inputClass} />
          </Field>
          <Field label="読み上げ速度" hint={`共通: ${base.charsPerSecond}`}>
            <input type="number" min={MIN_CHARS_PER_SECOND} max={MAX_CHARS_PER_SECOND} value={o.charsPerSecond ?? ""} placeholder={String(base.charsPerSecond)}
              onChange={(e) => (e.target.value === "" ? set({}, ["charsPerSecond"]) : set({ charsPerSecond: Number(e.target.value) }))} className={inputClass} />
          </Field>
          {active && (
            <button type="button" onClick={() => onChange(undefined)} className="col-span-2 self-start text-xs font-bold text-slate-400 underline hover:text-slate-200">上書きをすべて解除</button>
          )}
        </div>
      )}
      {open && !buzzer && (
        <div className="flex flex-col gap-3 border-t border-slate-700 p-3">
```

（既存の `{open && (` 以下の中身を `{open && !buzzer && (` の中にそのまま残す）

- [ ] **Step 6: `src/web/admin/QuestionSetEditPage.tsx` を編集する**

- `EMPTY_DRAFT` を `{ name: "", mode: "anagram", introSlides: [], settings: DEFAULT_SETTINGS, questions: [newQuestion()] }` にする
- `fromSet` の戻り値に `mode: s.mode ?? "anagram",` を足す（`name: s.name,` の次）
- `toInput` は `...d` で `mode` が渡るので変更不要（`"anagram"` はバリデーションが落とす）
- `const { questions, settings, introSlides } = draft;` を `const { questions, settings, introSlides, mode } = draft;` にする
- サムネイルと中央プレビューの `TitleSlidePreview` 2 か所に `mode={mode}` を、`QuestionSlidePreview` 2 か所に `mode={mode}` を足す
- サムネイルの `questionIncomplete(q)` と `removeQuestion` 内の `questionIncomplete(q)` を `questionIncomplete(q, mode)` にする
- `TitleInspector` に `mode={mode} onMode={(mode) => patch({ mode })}` を足す
- `QuestionInspector` に `mode={mode}` を足す

- [ ] **Step 7: 型チェックとテスト、ブラウザで確認する**

Run: `npm run typecheck && npm test`
Expected: PASS

ブラウザ確認: `npm run dev` を起動し `/admin/new` を開く。出題形式を「早押し」にすると共通設定が「読み上げ速度・基本点・不正解ペナルティ」だけになり、問題スライドの出題文が複数行のテキストエリアになって「生成」とヒントが消える。プレビューに「早押し」バッジと左寄せの問題文が出る。保存→リロードで `mode` が保たれる。「アナグラム」に戻すと元の欄が出る。

- [ ] **Step 8: コミット**

```bash
git add src/web/lib/editorChecks.ts src/web/admin/SlideInspector.tsx src/web/admin/QuestionSetEditPage.tsx test/web/editorChecks.test.ts
git commit -m "feat(admin): choose the question set mode and edit buzzer questions"
```

---

### Task 8: GM 画面（文字送り・判定・管理パネル）

**Files:**
- Create: `src/web/lib/useRevealedCount.ts`
- Create: `src/web/gm/BuzzerQuestion.tsx`
- Modify: `src/web/gm/GmRoomPage.tsx`
- Modify: `src/web/gm/GmControlPanel.tsx`

**Interfaces:**
- Consumes: `ClientState.buzzer`、`revealedCount`、`buzzerScreenPromptSizeClass`、`SettingsView.mode`
- Produces: `useRevealedCount(buzzer: BuzzerView | null, clockOffsetMs: number): number`、`BuzzerQuestion` コンポーネント

- [ ] **Step 1: 表示済み文字数のフックを作る**

`src/web/lib/useRevealedCount.ts`:

```ts
import { useEffect, useState } from "react";
import type { BuzzerView } from "../../shared/messages";
import { revealedCount } from "../../shared/buzzer";

/**
 * 今表示すべき文字数。サーバーの時刻に補正した「今」で共有の式を評価する。
 * 読み上げ中は 100ms ごとに再計算し、全文表示に達したら止める。
 * buzzerUpdated で区間の起点が置き換わると、押された位置でぴたりと揃う
 */
export function useRevealedCount(buzzer: BuzzerView | null, clockOffsetMs: number): number {
  const compute = () => (buzzer ? revealedCount(buzzer, Date.now() + clockOffsetMs) : 0);
  const [count, setCount] = useState(compute);
  useEffect(() => {
    setCount(compute());
    if (!buzzer || buzzer.status !== "reading") return;
    const id = setInterval(() => {
      const n = compute();
      setCount(n);
      if (n >= buzzer.promptLength) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buzzer, clockOffsetMs]);
  return count;
}
```

- [ ] **Step 2: 早押し用の問題カード中身を作る**

`src/web/gm/BuzzerQuestion.tsx`:

```tsx
import { Mic, Zap } from "lucide-react";
import type { BuzzerView, QuestionView } from "../../shared/messages";
import { buzzerScreenPromptSizeClass } from "../lib/slideText";
import { useRevealedCount } from "../lib/useRevealedCount";

const STATUS_LABEL: Record<BuzzerView["status"], string> = {
  ready: "読み上げ待ち",
  reading: "読み上げ中",
  paused: "回答中",
};

/**
 * GM 画面の早押し出題。問題文は全文を描画しておき、未表示の文字を透明にする（レイアウトが動かない）。
 * 画像はその上に出す。回答中は回答者と待ち行列を問題文の下に出す
 */
export function BuzzerQuestion({ question, buzzer, clockOffsetMs, light, imageHeight }: {
  question: QuestionView; buzzer: BuzzerView | null; clockOffsetMs: number; light: boolean; imageHeight: string;
}) {
  const revealed = useRevealedCount(buzzer, clockOffsetMs);
  const chars = Array.from(question.prompt);
  const finished = buzzer?.status === "reading" && revealed >= chars.length;
  const status = !buzzer ? "" : finished ? "読み上げ終了・早押し待ち" : STATUS_LABEL[buzzer.status];
  const answering = buzzer?.status === "paused" ? buzzer.queue[0] : undefined;
  const waiting = buzzer?.status === "paused" ? buzzer.queue.slice(1) : [];
  const muted = light ? "text-slate-500" : "text-slate-400";

  return (
    <>
      <div className={`flex items-center justify-between ${muted}`}>
        <span className="text-xl font-bold">第{question.index + 1}問 / {question.total}問</span>
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
          <p className="text-brand inline-flex items-center gap-3 text-5xl font-black"><Mic size={40} aria-hidden />{answering.nickname}さん 回答中</p>
          {waiting.length > 0 && <p className={`mt-3 text-xl ${muted}`}>次: {waiting.map((w) => w.nickname).join(" → ")}</p>}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: `src/web/gm/GmRoomPage.tsx` を組み込む**

import を追加・変更:

```ts
import { ArrowRight, Check, Crown, Home, PanelRightClose, PanelRightOpen, Play, RotateCcw, Settings, Square, Users, X } from "lucide-react";
import { BuzzerQuestion } from "./BuzzerQuestion";
import { buzzerScreenPromptSizeClass } from "../lib/slideText";
```

`const explanationImageUrl = …` の次に追加:

```ts
  const buzzerMode = q?.mode === "buzzer";
  const buzzer = state.buzzer;
```

出題カードの中身を、早押しモードの出題中だけ `BuzzerQuestion` に差し替える。`<Card tone={light ? "light" : "dark"} …>` の直下を次の形にする:

```tsx
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
```

（問題結果のブロック以降はそのまま。結果表示では早押しでも全文を出す）

フッターの `{state.phase === "question" && <Button … icon={Square} …>締切</Button>}` を次に置き換える:

```tsx
        {state.phase === "question" && buzzerMode && buzzer?.status === "ready" && (
          <Button variant="brand" size="lg" icon={Play} onClick={() => send({ type: "startReading" })}>読み上げ開始</Button>
        )}
        {state.phase === "question" && buzzerMode && buzzer?.status === "paused" && (
          <>
            <Button variant="success" size="lg" icon={Check} onClick={() => send({ type: "judge", correct: true })}>正解</Button>
            <Button variant="danger" size="lg" icon={X} onClick={() => send({ type: "judge", correct: false })}>不正解</Button>
          </>
        )}
        {state.phase === "question" && <Button variant="secondary" size="lg" icon={Square} onClick={() => send({ type: "close" })}>締切</Button>}
```

緑の判定ボタン用に `src/web/components/Button.tsx` へ variant を 1 つ足す（既存 variant の className を上書きする形は Tailwind のクラス順で負けることがあるため、専用 variant にする）:

```ts
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "brand" | "primary" | "secondary" | "danger" | "success";
  size?: "md" | "lg";
  icon?: LucideIcon;
};

const variants = {
  brand: "bg-brand text-white shadow-lg shadow-purple-500/20 hover:brightness-110",
  primary: "bg-blue-600 text-white hover:bg-blue-500",
  secondary: "bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600",
  danger: "bg-red-600 text-white hover:bg-red-500",
  success: "bg-green-600 text-white hover:bg-green-500",
};
```

- [ ] **Step 4: 管理パネルに読み上げ速度を足し、早押しでは不要な欄を隠す**

`src/web/gm/GmControlPanel.tsx` の `SettingsForm`:

- 状態を追加: `const [charsPerSecond, setCharsPerSecond] = useState(o.charsPerSecond == null ? "" : String(o.charsPerSecond));`
- `const buzzer = settings.mode === "buzzer";`
- `submit` の `if (rankBonus.trim() !== "") { … }` の次に追加:

```ts
    const cps = Number(charsPerSecond);
    if (charsPerSecond !== "" && Number.isInteger(cps) && cps >= 1 && cps <= 30) next.charsPerSecond = cps;
```

- `clearAll` に `setCharsPerSecond("");` を足す
- JSX: 制限時間の `<label>` + `<select>` と「秒数」「お手付き上限」の 2 つの `<div>`、正解順ボーナスの `<label>` + `<input>` をそれぞれ `{!buzzer && ( … )}` で囲む。「基本点」の `<div>` の前に追加:

```tsx
        {buzzer && (
          <div>
            <label className="block text-sm text-slate-400" htmlFor="live-cps">読み上げ速度（文字/秒）</label>
            <input id="live-cps" type="number" min={1} max={30} step={1} inputMode="numeric" value={charsPerSecond} onChange={(e) => setCharsPerSecond(e.target.value)} className={inputClass} placeholder={ph(eff?.charsPerSecond)} />
          </div>
        )}
```

- 説明文の `今の問題にもすぐ反映され、制限時間は締切が無ければ今から数えます` を `{buzzer ? "読み上げ速度は今の問題にもすぐ反映されます" : "今の問題にもすぐ反映され、制限時間は締切が無ければ今から数えます"}` にする

- [ ] **Step 5: 型チェックとブラウザ確認**

Run: `npm run typecheck && npm test`
Expected: PASS

ブラウザ確認（`npm run dev`、GM 用タブ 1 つと参加者用タブ 2 つ。参加者は Task 9 まではボタンが無いので、確認は読み上げまで）: 早押しセットでルームを開始し、第1問で「読み上げ開始」を押すと問題文が左から一文字ずつ現れ、ヘッダー右に「読み上げ中」→ 全文で「読み上げ終了・早押し待ち」と出る。「締切」で問題結果に全文と「正解者なし」が出る。管理パネルに「読み上げ速度」があり、制限時間などの欄が無い。

- [ ] **Step 6: コミット**

```bash
git add src/web/lib/useRevealedCount.ts src/web/gm/BuzzerQuestion.tsx src/web/gm/GmRoomPage.tsx src/web/gm/GmControlPanel.tsx src/web/components/Button.tsx
git commit -m "feat(gm): reveal the buzzer prompt character by character and judge answers"
```

---

### Task 9: 参加者画面（早押しボタン）

**Files:**
- Create: `src/web/player/BuzzerPanel.tsx`
- Modify: `src/web/player/PlayPage.tsx`

**Interfaces:**
- Consumes: `ClientState.buzzer`、`ClientState.me`、`ClientState.lastAnswerResult`、`send`

- [ ] **Step 1: 早押しパネルを作る**

`src/web/player/BuzzerPanel.tsx`:

```tsx
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
      <Mic size={48} className="text-brand mx-auto" aria-hidden />
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
```

- [ ] **Step 2: `src/web/player/PlayPage.tsx` に組み込む**

import を追加:

```ts
import { BuzzerPanel } from "./BuzzerPanel";
```

`const canAnswer = …` の次に追加:

```ts
  const buzzerMode = q?.mode === "buzzer";
```

出題中のブロック `{state.ready && state.phase === "question" && q && ( <> … </> )}` を、早押しモードなら `BuzzerPanel` に差し替える。先頭を次の形にする:

```tsx
      {state.ready && state.phase === "question" && q && buzzerMode && (
        <>
          <p className="text-sm font-bold text-slate-500">第{q.index + 1}問 / {q.total}問</p>
          <BuzzerPanel question={q} buzzer={state.buzzer} meId={me?.id} status={status} lastPoints={state.lastAnswerResult?.correct ? state.lastAnswerResult.points : null} shake={shake} send={send} />
        </>
      )}

      {state.ready && state.phase === "question" && q && !buzzerMode && (
        <>
```

（既存の出題中ブロックは `!buzzerMode` 側にそのまま残す）

`<main className="flex min-h-full flex-col gap-4 …">` はそのまま。`BuzzerPanel` の `flex-1` で縦に広がる。

- [ ] **Step 3: 型チェックとブラウザ確認**

Run: `npm run typecheck && npm test`
Expected: PASS

ブラウザ確認（GM 1 タブ、参加者 2 タブ。参加者タブは `resize_window` の mobile で）:

1. 第1問を開くと参加者は「読み上げを待っています」で、ボタンが薄い
2. GM が「読み上げ開始」→ ボタンが有効になる。参加者 A が押すと GM の文字送りが止まり、「Aさん 回答中」。A の画面は「あなたの番！」
3. 参加者 B が押すと B の画面は「2番目に押しました。Aさんの回答を待っています」。GM の「次: B」
4. GM が「不正解」→ A は「不正解… この問題はもう押せません」で揺れ、B が「あなたの番！」。GM の順位表で A が減点
5. GM が「正解」→ B に「正解！ +100点」、GM に紙吹雪とポップアップ、問題結果に B が 1 位で出る
6. 「次の問題へ」→ また「読み上げ待ち」から。読み上げ中に誰も押さないまま全文が出たら「読み上げ終了・早押し待ち」。その後に押しても止まる（既に全文）
7. 参加者タブをリロードしても同じ状態（キューの位置・押せない状態）に戻る

- [ ] **Step 4: コミット**

```bash
git add src/web/player/BuzzerPanel.tsx src/web/player/PlayPage.tsx
git commit -m "feat(player): big buzzer button with queue and lock-out states"
```

---

### Task 10: 設計書・README の更新と作業ドキュメントの削除

**Files:**
- Modify: `docs/overview.md`, `docs/game-rules.md`, `docs/data-model.md`, `docs/protocol.md`, `docs/screens.md`, `docs/design-guide.md`, `README.md`
- Delete: `docs/superpowers/specs/2026-10-13-buzzer-mode-design.md`, `docs/superpowers/plans/2026-10-13-buzzer-mode.md`

`docs/AGENTS.md` の規則に従う: 現在形、日付や経緯を書かない、関数一覧を書かない。

- [ ] **Step 1: `docs/overview.md`**

- 前提条件の表の「問題形式」行を `アナグラム（日本語フリーテキスト回答）と早押し（口頭回答、GM 判定）。問題セット単位で選ぶ` にする
- スコープ外の「アナグラム以外の問題形式」を「アナグラム・早押し以外の問題形式、読み上げ音声（文字送りの時刻はサーバーが持つので、後から同期して乗せられる）」にする
- テスト方針の「優先して固めるケース」に追加:
  - `早押しの表示位置がサーバー受信時刻で確定し、2 人目以降は位置を変えずキューに並ぶこと`
  - `早押しの不正解で減点・押せなくなり、次の人へ回ること。キューが空なら続きから再開すること`
  - `早押しモードで参加者に問題文が届かないこと`

- [ ] **Step 2: `docs/game-rules.md`**

「ゲームの流れ」の前に出題形式の説明を足し、末尾に早押しの節を足す。

冒頭の段落の後に追加:

```markdown
## 出題形式

問題セットごとに `mode` で選ぶ。全問が同じ形式になる。

| mode | 回答 | 判定 |
|---|---|---|
| `anagram`（既定） | スマホのフリーテキスト | サーバーが正規化して自動判定 |
| `buzzer` | 早押しボタン → 口頭 | GM が正解・不正解を判定 |

以下の「制限時間」「スコア」「お手付き」はアナグラムの規則。早押しは [早押しモード](#早押しモード) を参照。
```

末尾に追加:

```markdown
## 早押しモード

出題中の流れは `question` フェーズの中で `BuzzerState` が持つ（[データモデル](data-model.md#ルーム状態durable-object-内)）。

1. 問題を開くと「読み上げ待ち」（`ready`）。GM が「読み上げ開始」を押すと、問題文が GM 画面に `charsPerSecond`（既定 6 文字/秒）で一文字ずつ表示される（`reading`）。参加者のスマホには問題文を出さない
2. 参加者が早押しボタンを押すと、サーバー受信時刻で表示位置が確定して止まる（`paused`）。押した人はサーバー受信順にキューに並び、先頭が回答中。読み上げが止まっている間も押してキューの末尾に並べる
3. 回答者は口頭で答え、GM が「正解」「不正解」で判定する
   - 正解: `basePoints` を加点し、その問題は終了（問題結果へ）。正解順ボーナスは使わない
   - 不正解: `wrongPenalty` を減点し、その人はこの問題でもう押せない。キューに次の人がいればその人が回答中になる。いなければ止まった位置から読み上げを再開する
4. 全文を表示し終えても自動では締め切らない。GM が「締切」を押すまで早押しを受け付ける
5. 接続中の参加者全員が押せなくなり、キューが空になったら自動で締め切る

- 回答中の人をキックすると、減点せずに次の人へ回す（いなければ再開）。キューの途中の人をキックするとキューから消えるだけ
- 切断は何も変えない。回答中の人が切断しても GM の判定で進める
- 表示済み文字数は「止めた位置 ＋ (今 − 再開時刻) × 文字/秒」でサーバーとクライアントが同じ式で計算する。GM がライブ設定で `charsPerSecond` を変えると、その時点の位置を起点に取り直すので表示が飛ばない
- `timerMode` / `timerSeconds` / `rankBonus` / `maxAttempts` は効かない。締切は常に無し
- 文字回答（`answer`）は `not_in_question` で拒否する
```

「GM のゲーム中操作」の表の「設定の上書き」行に「早押しでは読み上げ速度」を足す。

- [ ] **Step 3: `docs/data-model.md`**

- `QuestionSet` に `mode?: "anagram" | "buzzer";   // 省略時 anagram。buzzer なら全問が早押し` を足す
- `QuestionSettings` に `charsPerSecond: number;      // 既定 6。早押しの文字送り（文字/秒）` を足す
- バリデーションに追加: `mode` は 2 値のいずれかで `anagram` は省略する / `charsPerSecond` は 1〜30 の整数 / `mode: "buzzer"` のとき `questions[].prompt` は画像があっても必須
- `EngineState` に `buzzer: BuzzerState | null;   // 早押しモードで出題中のみ` を足し、その下に `BuzzerState` の定義（spec の「ルーム状態」の型と説明）を足す
- 「状態を変更するたびに…」の段落の次に `旧スナップショットに \`buzzer\` が無ければ \`null\` として復元する` を足す

- [ ] **Step 4: `docs/protocol.md`**

- クライアント → サーバーの表に `startReading` / `buzz` / `judge` の 3 行（spec の表をそのまま）
- `updateSettings` 行の末尾に「`charsPerSecond` は 1〜30 の整数。早押しの読み上げ中なら起点を取り直してから適用し `buzzerUpdated` を送る」
- サーバー → クライアントの表に `buzzerUpdated` 行。`questionStarted` 行に「早押しモードでは参加者向けの `prompt` は空、`hint` は無し」
- `StateMessage` に `buzzer: BuzzerView | null;`、`QuestionView` に `mode`、`SettingsView` に `mode`、`IntroView` のタイトルに `mode`、`BuzzerView` の定義（spec のとおり）
- エラーコードの表に `not_reading` / `locked_out` / `already_buzzed`
- タイマーの節に「早押しモードの出題中は締切が無いので `cleanup` を設定する」

- [ ] **Step 5: `docs/screens.md`**

- GM 画面の表に行を足す: `出題中（早押し）| 第n問、状態（読み上げ待ち／読み上げ中／回答中／読み上げ終了・早押し待ち）、問題画像、問題文（表示済みの文字だけ見え、未表示は透明でレイアウトが動かない）。回答中は「○○さん 回答中」と待ち行列。「読み上げ開始」（ready）／「正解」「不正解」（paused）／「締切」「ロビーへ戻る」`
- 管理パネルの設定に「早押しでは読み上げ速度を出し、制限時間・お手付き上限・正解順ボーナスを出さない」
- 参加者画面の表に行を足す: `出題中（早押し）| 問題文・ヒント・残り時間・入力欄は出さない。画面の大半が円形の早押しボタン。読み上げ待ち／押せる／あなたの番！／k番目に押しました／○○さんが回答中（押すと次の順番）／不正解で押せない／正解！ の各状態を文言で示す`
- 管理画面の右カラムの説明に「タイトルスライド: 出題形式（アナグラム／早押し）。早押しでは共通設定が読み上げ速度・基本点・不正解ペナルティになる。問題スライド（早押し）: 問題文は複数行、「生成」とヒントは無い」
- クライアント側の状態に「`buzzerUpdated` で `buzzer` を置き、`questionStarted` / `questionClosed` / `introStarted` / `finalResult` で消す。表示済み文字数はクライアントが補正済みの時刻で共有の式から計算する」

- [ ] **Step 6: `docs/design-guide.md`**

- アイコンの表に `Zap | 早押し` と `Mic | 口頭回答・回答中` を足す
- 参加者画面の節に追加:

```markdown
### 早押しボタン

早押しモードではボタンが画面の主役になる。

- 幅 `min(80vw, 22rem)` の円形、ブランドグラデーション、Zap アイコンと「早押し！」
- 押せないときは薄く（opacity 30%）してシャドウを消す。押した後はボタンを消して状態の文言を出す
- 「あなたの番！」はブランド色で大きく、Mic アイコンを添える
```

- スライドの表の「問題」行に「早押しでは残り時間の代わりに「早押し」バッジ、問題文は左寄せ・改行を保ち、長さで文字サイズを下げる」

- [ ] **Step 7: `README.md` の E2E チェックリストに追加**

```markdown
- [ ] 早押しの問題セット（タイトルスライドの出題形式＝早押し）で開始すると、タイトルスライドに「早押し ・ 6文字/秒」と出る
- [ ] 第1問で「読み上げ開始」を押すと GM 画面の問題文が一文字ずつ現れる。スマホには問題文が出ず、大きな早押しボタンだけがある
- [ ] スマホ A で押すと GM の文字送りが止まり「Aさん 回答中」、A の画面は「あなたの番！」。続けて B が押すと B は「2番目に押しました」
- [ ] 「不正解」で A が減点されて押せなくなり、B の番になる。「正解」で B に「正解！ +100点」、GM にポップアップと紙吹雪、問題結果に B だけが出る
- [ ] 誰も押さないまま不正解のあとキューが空になると、止まった位置から読み上げが再開する
- [ ] 読み上げ中に管理パネルで読み上げ速度を変えても、表示済みの位置が飛ばない
- [ ] 回答中に GM をリロードしても「Aさん 回答中」と判定ボタンが復元される
```

- [ ] **Step 8: 作業ドキュメントを削除し、コミット**

```bash
git rm docs/superpowers/specs/2026-10-13-buzzer-mode-design.md docs/superpowers/plans/2026-10-13-buzzer-mode.md
npm run typecheck && npm test
git add docs README.md
git commit -m "docs: describe buzzer mode and distill the design into the design docs"
```

---

## 自己レビュー結果

- spec の各節 → データモデル（Task 1）、ルール（Task 3）、プロトコル（Task 2・4）、GM 画面（Task 6・8）、参加者画面（Task 9）、編集画面（Task 6・7）、クライアント状態（Task 5）、テスト（各 Task）、設計書（Task 10）
- spec の「`judge` 不正解で `charsPerSecond` が変わったら `buzzerUpdated`」は、Room では早押しの出題中なら `updateSettings` のたびに `buzzerUpdated` を送る（変化の有無を調べない）。配信が 1 通増えるだけで、クライアントは置き換えるだけなので害はない
- spec の `revealedChars(view, t)` は関数名を `revealedCount` にした（フィールド名 `revealedChars` と区別するため）
- `removeParticipant` は `now` を必須引数にした（回答中の人を外したときに再開時刻が要る）
