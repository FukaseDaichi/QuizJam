# タイトル・説明スライド 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「開始する」でいきなり第1問ではなく、タイトルスライド → 説明スライド（0枚以上）→ 第1問の順で GM 画面に映すようにする。

**Architecture:** `GameEngine` に `intro` フェーズと `introIndex` を追加し、`start` はタイトルを、`next` は次の説明スライドか第1問を開く。サーバーは新メッセージ `introStarted` と `state.intro` でスライドを配る。GM 画面は編集画面と同じ 16:9 スライド部品（`components/Slides.tsx` に移動）で本番表示し、参加者画面は待機表示のまま。編集画面は説明スライドの追加・編集・並べ替えに対応する。

**Tech Stack:** TypeScript / Cloudflare Workers + Durable Objects / Hono / React 19 + Tailwind v4 / Vitest (`@cloudflare/vitest-plugin`, すべて workerd 上で実行)

**Spec:** `docs/superpowers/specs/2026-10-11-intro-slides-design.md`

## Global Constraints

- 説明スライドは1セット 20 枚まで。`heading` は 100 文字以内、`body` は 1000 文字以内、`imageUrl` は `/api/images/<key>` か `https://`（`isValidImageUrl`）
- 説明スライドは見出し・本文・画像のいずれか1つが必須。すべて空は拒否
- `introSlides` が無い旧データはそのまま動く。バリデータは空のとき `introSlides` を出力しない（`undefined`）
- `introIndex` が無い旧スナップショットは `0` として復元する
- `intro` 中の回答は `not_in_question`、`close` は `invalid_state`、Alarm は 24 時間後の `cleanup`
- 参加者画面にはスライドを出さない（待機表示のまま）
- UI 文言は日本語。アイコンは lucide-react（絵文字禁止）。docs/ は現在形で書き、実装と同じコミット群で更新する
- コミットメッセージ末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` を付ける
- テストは `npm test`（全体）または `npx vitest run <path>`。型チェックは `npm run typecheck`

## Review Focus

1. **`finalResult` からの「もう1ゲーム」→ `start`**: 2ゲーム目もタイトルから始まり、通算スコアが保たれること。→ Task 3 の Room テスト「start from finalResult shows the title again and keeps scores when carrying over」
2. **`intro` 中のキック**: `allParticipantsDone` が `false` のままで問題が閉じないこと（`closeQuestion` が `intro` で呼ばれると例外になる）。→ Task 2 の GameEngine テスト「allParticipantsDone is false during intro」
3. **`intro` 中のライブ設定変更**: `reconcileDeadline` が何もせず、`settingsUpdated` だけが届くこと。タイトルの `settings` は再接続時の `state.intro` に反映されること。→ Task 3 の Room テスト「updateSettings during intro only broadcasts settingsUpdated」
4. **本文の改行と長文**: 1000 文字・改行入りの本文がスライドからはみ出さず、改行が保たれること。→ Task 5 でブラウザ確認（手動）
5. **編集画面で説明スライドを全部消したとき**: 選択が `title` に戻り、保存できること。→ Task 7 の手順に含める

---

### Task 1: `IntroSlide` 型とバリデーション

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/validateQuestionSet.ts`
- Test: `test/shared/validateQuestionSet.test.ts`

**Interfaces:**
- Produces: `IntroSlide { id: string; heading?: string; body?: string; imageUrl?: string }`、`QuestionSet.introSlides?: IntroSlide[]`。`validateQuestionSetInput` は `introSlides` が空のとき `undefined` を返す

- [ ] **Step 1: 失敗するテストを書く**

`test/shared/validateQuestionSet.test.ts` の末尾（`describe("validateQuestionSetInput", ...)` の閉じ括弧の後）に追加:

```ts
describe("validateQuestionSetInput introSlides", () => {
  const questions = [{ prompt: "ごんり", answers: ["りんご"] }];

  it("omits introSlides when not given", () => {
    const v = validateQuestionSetInput({ ...base, questions });
    expect("error" in v ? v.error : v.introSlides).toBeUndefined();
  });

  it("accepts slides with any of heading, body or image and assigns ids", () => {
    const v = validateQuestionSetInput({ ...base, questions, introSlides: [
      { heading: "ルール" },
      { body: "3問です\n早い者勝ち" },
      { imageUrl: "/api/images/a.png" },
      { id: "s4", heading: "見出し", body: "本文", imageUrl: "https://example.com/x.png" },
    ] });
    expect("error" in v).toBe(false);
    if ("error" in v) return;
    expect(v.introSlides).toHaveLength(4);
    expect(v.introSlides![0]).toMatchObject({ heading: "ルール", body: undefined, imageUrl: undefined });
    expect(v.introSlides![0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(v.introSlides![1].body).toBe("3問です\n早い者勝ち");
    expect(v.introSlides![3].id).toBe("s4");
  });

  it("rejects an empty slide", () => {
    expect(validateQuestionSetInput({ ...base, questions, introSlides: [{ heading: "", body: "" }] })).toEqual({ error: "introSlides[0] is empty" });
  });

  it("rejects too many slides, long text, bad image URLs and non-arrays", () => {
    const many = Array.from({ length: 21 }, () => ({ heading: "x" }));
    expect(validateQuestionSetInput({ ...base, questions, introSlides: many })).toEqual({ error: "introSlides must have at most 20 items" });
    expect(validateQuestionSetInput({ ...base, questions, introSlides: [{ heading: "x".repeat(101) }] })).toEqual({ error: "introSlides[0].heading invalid" });
    expect(validateQuestionSetInput({ ...base, questions, introSlides: [{ body: "x".repeat(1001) }] })).toEqual({ error: "introSlides[0].body invalid" });
    expect(validateQuestionSetInput({ ...base, questions, introSlides: [{ imageUrl: "javascript:alert(1)" }] })).toEqual({ error: "introSlides[0].imageUrl invalid" });
    expect(validateQuestionSetInput({ ...base, questions, introSlides: "nope" })).toEqual({ error: "introSlides must be an array" });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/shared/validateQuestionSet.test.ts`
Expected: FAIL（`introSlides` が検証されず素通りするため、`rejects ...` 系が失敗し、`accepts ...` は `v.introSlides![0].id` が無く失敗）

- [ ] **Step 3: 型を追加**

`src/shared/types.ts` の `QuestionSet` の直前に追加し、`QuestionSet` に `introSlides` を足す:

```ts
/** ゲーム冒頭、タイトルの後に映す説明スライド。見出し・本文・画像のどれか1つは必須 */
export interface IntroSlide {
  id: string;
  heading?: string;            // 100文字まで
  body?: string;               // 複数行可。1000文字まで
  imageUrl?: string;           // /api/images/<key> か https://
}

export interface QuestionSet {
  id: string;
  name: string;                // 企画名
  coverImageUrl?: string;      // タイトルスライドの画像
  slideBackground?: string;    // 問題スライドの背景色（#rrggbb）。画像の地の色に合わせる用途
  introSlides?: IntroSlide[];  // 省略時は無し。20枚まで
  settings: QuestionSettings;
  questions: Question[];
}
```

- [ ] **Step 4: バリデーションを実装**

`src/shared/validateQuestionSet.ts`:

import 行を `import type { IntroSlide, Question, QuestionSet, QuestionSettings } from "./types";` に変更。

`optionalImageUrl` の後に追加:

```ts
const MAX_INTRO_SLIDES = 20;

/** 省略・空文字は undefined。文字列でないか長すぎれば null */
function optionalText(x: unknown, max: number): string | undefined | null {
  if (x === undefined || x === null || x === "") return undefined;
  if (typeof x !== "string" || x.length > max) return null;
  return x;
}

function validateIntroSlides(x: unknown): IntroSlide[] | { error: string } {
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x)) return { error: "introSlides must be an array" };
  if (x.length > MAX_INTRO_SLIDES) return { error: `introSlides must have at most ${MAX_INTRO_SLIDES} items` };
  const out: IntroSlide[] = [];
  for (const [i, s] of (x as unknown[]).entries()) {
    if (typeof s !== "object" || s === null) return { error: `introSlides[${i}] invalid` };
    const o = s as Record<string, unknown>;
    const heading = optionalText(o.heading, 100);
    if (heading === null) return { error: `introSlides[${i}].heading invalid` };
    const body = optionalText(o.body, 1000);
    if (body === null) return { error: `introSlides[${i}].body invalid` };
    const imageUrl = optionalImageUrl(o.imageUrl, "imageUrl");
    if (typeof imageUrl === "object") return { error: `introSlides[${i}].${imageUrl.error}` };
    if (!heading && !body && !imageUrl) return { error: `introSlides[${i}] is empty` };
    out.push({ id: typeof o.id === "string" && o.id ? o.id : crypto.randomUUID(), heading, body, imageUrl });
  }
  return out;
}
```

`validateQuestionSetInput` 内、`slideBackground` の検証の直後に追加:

```ts
  const introSlides = validateIntroSlides(o.introSlides);
  if (!Array.isArray(introSlides)) return introSlides;
```

末尾の return を次に変更（空なら `undefined` にして旧データと同じ形を保つ）:

```ts
  return {
    name: o.name.trim(), coverImageUrl, slideBackground,
    introSlides: introSlides.length ? introSlides : undefined,
    settings: settings as QuestionSettings, questions,
  };
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run test/shared/validateQuestionSet.test.ts test/worker/questionSets.test.ts`
Expected: PASS（`questionSets.test.ts` の `toEqual({ id, ...input })` は `introSlides` が `undefined` のため影響なし）

- [ ] **Step 6: コミット**

```bash
git add src/shared/types.ts src/shared/validateQuestionSet.ts test/shared/validateQuestionSet.test.ts
git commit -m "feat(shared): add introSlides to question sets with validation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `GameEngine` の `intro` フェーズ

**Files:**
- Modify: `src/shared/types.ts`（`Phase`）
- Modify: `src/shared/messages.ts`（`IntroSlideView` / `IntroView` 型の追加のみ）
- Modify: `src/room/GameEngine.ts`
- Test: `test/room/GameEngine.test.ts`

**Interfaces:**
- Consumes: Task 1 の `IntroSlide`、`QuestionSet.introSlides`
- Produces:
  - `Phase = "lobby" | "intro" | "question" | "questionResult" | "finalResult"`
  - `IntroSlideView`、`IntroView { index: number; total: number; slide: IntroSlideView }`（`src/shared/messages.ts`）
  - `EngineState.introIndex: number`
  - `GameEngine.start(set: QuestionSet, carryOverScores: boolean): IntroView`（`now` 引数は廃止）
  - `GameEngine.next(now: number): NextOutcome` で `NextOutcome = { kind: "intro"; intro: IntroView } | { kind: "question"; question: QuestionView } | { kind: "final"; entries: LeaderboardEntry[] }`
  - `GameEngine.introView(): IntroView | null`、`get introIndex(): number`

- [ ] **Step 1: 既存テストを新しい `start` に合わせる**

`test/room/GameEngine.test.ts` の import を次にする:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { GameEngine, type EngineState } from "../../src/room/GameEngine";
import type { QuestionSet } from "../../src/shared/types";
import type { QuestionView } from "../../src/shared/messages";
import { DEFAULT_SETTINGS } from "../../src/shared/defaults";
```

`makeSet` の直後にヘルパーを追加:

```ts
/** タイトルスライドを飛ばして第1問を開く（説明スライドの無いセット用） */
function startQuestions(e: GameEngine, set: QuestionSet, carryOverScores: boolean, now: number): QuestionView {
  e.start(set, carryOverScores);
  const r = e.next(now);
  if (r.kind !== "question") throw new Error(`expected question, got ${r.kind}`);
  return r.question;
}
```

既存の `e.start(` / `e2.start(` 呼び出しをすべて `startQuestions(e, ` / `startQuestions(e2, ` に置き換える:

```bash
sed -i '' -E 's/(^|[^A-Za-z0-9_])(e2?)\.start\(/\1startQuestions(\2, /g' test/room/GameEngine.test.ts
grep -n "\.start(" test/room/GameEngine.test.ts
```

Expected: grep が何も出さない（置換漏れ無し）。`rejects start with an empty question set` は `start` が先に例外を投げるので `startQuestions` 経由でも `toThrow` を満たす。

- [ ] **Step 2: 新しいテストを追加**

`test/room/GameEngine.test.ts` の末尾に追加:

```ts
function makeSetWithIntro(): QuestionSet {
  return {
    ...makeSet(),
    coverImageUrl: "/api/images/cover.png",
    introSlides: [
      { id: "s1", heading: "ルール", body: "3回まで回答できます" },
      { id: "s2", imageUrl: "/api/images/rules.png" },
    ],
  };
}

describe("GameEngine intro", () => {
  let e: GameEngine;
  beforeEach(() => {
    e = GameEngine.create("ABC123");
    e.addParticipant("p1", "みさき");
  });

  it("start shows the title slide with the effective settings of question 1", () => {
    e.setSettingsOverride({ maxAttempts: 5 });
    const intro = e.start(makeSetWithIntro(), false);
    expect(e.phase).toBe("intro");
    expect(e.introIndex).toBe(0);
    expect(intro).toEqual({
      index: 0, total: 3,
      slide: { kind: "title", name: "テスト", coverImageUrl: "/api/images/cover.png", questionCount: 2, settings: { ...DEFAULT_SETTINGS, maxAttempts: 5 } },
    });
    expect(e.introView()).toEqual(intro);
    expect(e.currentQuestionView()).toBeNull();
    expect(e.questionResult()).toBeNull();
    expect(e.correctCount()).toBe(0);
    expect(e.myStatus("p1")).toBeNull();
  });

  it("next walks through the intro slides and then opens question 1", () => {
    e.start(makeSetWithIntro(), false);
    expect(e.next(T0)).toEqual({ kind: "intro", intro: { index: 1, total: 3, slide: { kind: "slide", heading: "ルール", body: "3回まで回答できます", imageUrl: undefined } } });
    expect(e.next(T0)).toMatchObject({ kind: "intro", intro: { index: 2, total: 3, slide: { kind: "slide", imageUrl: "/api/images/rules.png" } } });
    const q = e.next(T0);
    expect(q).toMatchObject({ kind: "question", question: { index: 0, prompt: "ごんり", deadlineAt: T0 + 30_000 } });
    expect(e.phase).toBe("question");
    expect(e.introView()).toBeNull();
  });

  it("without intro slides the title is followed directly by question 1", () => {
    expect(e.start(makeSet(), false).total).toBe(1);
    expect(e.next(T0).kind).toBe("question");
  });

  it("rejects answers during intro and keeps scores", () => {
    e.start(makeSet(), false);
    expect(e.submitAnswer("p1", "りんご", T0)).toEqual({ kind: "rejected", code: "not_in_question" });
    expect(e.leaderboard()[0].score).toBe(0);
  });

  it("allParticipantsDone is false during intro", () => {
    e.start(makeSet(), false);
    expect(e.allParticipantsDone()).toBe(false);
    expect(() => e.closeQuestion(T0)).toThrow();
  });

  it("endGame from intro returns to lobby and resets the intro index", () => {
    e.start(makeSetWithIntro(), false);
    e.next(T0);
    e.endGame();
    expect(e.phase).toBe("lobby");
    expect(e.introIndex).toBe(0);
    expect(e.introView()).toBeNull();
  });

  it("restores a snapshot without introIndex as 0", () => {
    const snap = e.snapshot() as Partial<EngineState>;
    delete snap.introIndex;
    expect(GameEngine.fromSnapshot(snap as EngineState).introIndex).toBe(0);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run test/room/GameEngine.test.ts`
Expected: FAIL（型エラーか、`start` が `question` に入り `intro` 系の期待と一致しない）

- [ ] **Step 4: `Phase` と `IntroView` 型を追加**

`src/shared/types.ts`:

```ts
export type Phase = "lobby" | "intro" | "question" | "questionResult" | "finalResult";
```

`src/shared/messages.ts` の import を `import type { LeaderboardEntry, LiveSettings, Participant, Phase, QuestionSettings, TimerMode } from "./types";` に変更し、`QuestionView` の直前に追加:

```ts
/** ゲーム冒頭に GM 画面へ映すスライド。index 0 がタイトル、以降が問題セットの introSlides */
export type IntroSlideView =
  | { kind: "title"; name: string; coverImageUrl?: string; questionCount: number; settings: QuestionSettings }
  | { kind: "slide"; heading?: string; body?: string; imageUrl?: string };

export interface IntroView {
  index: number;
  total: number;          // 1 + introSlides.length
  slide: IntroSlideView;
}
```

- [ ] **Step 5: `GameEngine` を実装**

`src/room/GameEngine.ts`:

import 行を変更:

```ts
import type { ErrorCode, IntroSlideView, IntroView, MyAnswerStatus, QuestionResultView, QuestionView } from "../shared/messages";
```

`EngineState` に追加（`currentIndex` の次）:

```ts
  /** intro フェーズで映しているスライド。0 がタイトル、1..n が introSlides[n-1] */
  introIndex: number;
```

`AnswerOutcome` の後に追加:

```ts
export type NextOutcome =
  | { kind: "intro"; intro: IntroView }
  | { kind: "question"; question: QuestionView }
  | { kind: "final"; entries: LeaderboardEntry[] };
```

`create` の初期値に `introIndex: 0,` を追加（`currentIndex: 0,` の次）。

`fromSnapshot` を変更:

```ts
  static fromSnapshot(state: EngineState): GameEngine {
    // 旧スナップショットには settingsOverride / introIndex が無い
    return new GameEngine({
      ...structuredClone(state),
      settingsOverride: structuredClone(state.settingsOverride ?? {}),
      introIndex: state.introIndex ?? 0,
    });
  }
```

getter に追加: `get introIndex(): number { return this.s.introIndex; }`

`start` を置き換え:

```ts
  /** 問題セットを読み込み、タイトルスライド（intro フェーズ）から始める。第1問は next() で開く */
  start(set: QuestionSet, carryOverScores: boolean): IntroView {
    if (set.questions.length === 0) throw new Error("question set is empty");
    this.s.questionSet = structuredClone(set);
    this.s.carryOverScores = carryOverScores;
    this.s.answers = [];
    if (!carryOverScores) {
      for (const p of Object.values(this.s.participants)) p.score = 0;
    }
    this.s.phase = "intro";
    this.s.introIndex = 0;
    this.s.currentIndex = 0;
    this.s.questionStartedAt = null;
    this.s.deadlineAt = null;
    return this.introView()!;
  }

  introView(): IntroView | null {
    const set = this.s.questionSet;
    if (!set || this.s.phase !== "intro") return null;
    const slides = set.introSlides ?? [];
    const i = this.s.introIndex;
    const slide: IntroSlideView = i === 0
      ? { kind: "title", name: set.name, coverImageUrl: set.coverImageUrl, questionCount: set.questions.length, settings: this.settings(0) }
      : { kind: "slide", heading: slides[i - 1].heading, body: slides[i - 1].body, imageUrl: slides[i - 1].imageUrl };
    return { index: i, total: 1 + slides.length, slide };
  }
```

`myStatus` の先頭行を変更:

```ts
    if (!this.s.questionSet || this.s.phase === "lobby" || this.s.phase === "intro" || this.s.phase === "finalResult") return null;
```

`next` を置き換え:

```ts
  next(now: number): NextOutcome {
    if (!this.s.questionSet) throw new Error("no question set");
    if (this.s.phase === "intro") {
      const slideCount = (this.s.questionSet.introSlides ?? []).length;
      if (this.s.introIndex < slideCount) {
        this.s.introIndex += 1;
        return { kind: "intro", intro: this.introView()! };
      }
      this.openQuestion(0, now);
      return { kind: "question", question: this.currentQuestionView()! };
    }
    if (this.s.phase !== "questionResult") throw new Error("not in intro or questionResult phase");
    const nextIndex = this.s.currentIndex + 1;
    if (nextIndex >= this.s.questionSet.questions.length) {
      this.s.phase = "finalResult";
      this.s.deadlineAt = null;
      this.s.questionStartedAt = null;
      return { kind: "final", entries: this.leaderboard() };
    }
    this.openQuestion(nextIndex, now);
    return { kind: "question", question: this.currentQuestionView()! };
  }
```

`endGame` に `this.s.introIndex = 0;` を追加。

- [ ] **Step 6: テストが通ることを確認**

Run: `npx vitest run test/room/GameEngine.test.ts`
Expected: PASS（既存の全ケース＋`GameEngine intro` 7件）。`Room.ts` はこの時点で型エラーになるが、vitest は `GameEngine.test.ts` だけなら実行できる。型エラーは Task 3 で解消する。

- [ ] **Step 7: コミット**

```bash
git add src/shared/types.ts src/shared/messages.ts src/room/GameEngine.ts test/room/GameEngine.test.ts
git commit -m "feat(engine): intro phase shows the title and intro slides before question 1

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: プロトコルと Room Durable Object

**Files:**
- Modify: `src/shared/messages.ts`（`StateMessage.intro`、`introStarted`）
- Modify: `src/room/Room.ts`
- Test: `test/room/Room.test.ts`

**Interfaces:**
- Consumes: Task 2 の `GameEngine.start(set, carry): IntroView`、`next(now): NextOutcome`、`introView()`
- Produces: `StateMessage.intro: IntroView | null`、`ServerMessage` に `{ type: "introStarted"; intro: IntroView }`

- [ ] **Step 1: 既存テストを新しい開始フローに合わせる**

`test/room/Room.test.ts` の `seedSet` の直後にヘルパーを追加:

```ts
/** 開始してタイトルスライドを飛ばし、第1問が始まるまで進める（説明スライドの無いセット用） */
async function startGame(gm: Client, questionSetId: string, carryOverScores = false) {
  gm.send({ type: "start", questionSetId, carryOverScores });
  await gm.waitFor("introStarted");
  gm.send({ type: "next" });
}
```

`gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });` を `await startGame(gm, set.id);` に置き換える（権限エラー・存在しないセットのテストは `set.id` を使っていないので対象外）:

```bash
sed -i '' 's/gm\.send({ type: "start", questionSetId: set\.id, carryOverScores: false });/await startGame(gm, set.id);/' test/room/Room.test.ts
grep -n 'type: "start"' test/room/Room.test.ts
```

Expected: grep の結果は `c1.send({ type: "start", questionSetId: "x", ...` と `questionSetId: "does-not-exist"` の2行だけ。

- [ ] **Step 2: 新しいテストを追加**

`test/room/Room.test.ts` の末尾に追加:

```ts
describe("Room DO intro slides", () => {
  async function seedSetWithIntro() {
    return createQuestionSet(testEnv.DB, {
      name: "イントロ",
      settings: { ...DEFAULT_SETTINGS, timerMode: "fixed", timerSeconds: 1 },
      introSlides: [{ id: "s1", heading: "ルール", body: "3回まで" }],
      questions: [{ id: "q1", type: "anagram", prompt: "ごんり", answers: ["りんご"] }],
    });
  }

  it("start shows the title, next shows each slide, then question 1 arms the deadline alarm", async () => {
    const set = await seedSetWithIntro();
    await initRoom("INTR01");
    const gm = await connect("INTR01", "gm-token");
    await gm.waitFor("state");
    const p1 = await join("INTR01", "みさき");
    const c1 = await connect("INTR01", p1.participantToken);
    await c1.waitFor("state");

    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    const title = await c1.waitFor("introStarted");
    expect(title.intro).toMatchObject({ index: 0, total: 2, slide: { kind: "title", name: "イントロ", questionCount: 1, settings: { timerSeconds: 1 } } });
    expect((await gm.waitFor("introStarted")).intro.index).toBe(0);
    expect((await gm.waitFor("settingsUpdated")).settings.effective?.timerSeconds).toBe(1);

    // intro 中に再接続すると state に intro が入り、question は無い
    const gm2 = await connect("INTR01", "gm-token");
    const st = await gm2.waitFor("state");
    expect(st.phase).toBe("intro");
    expect(st.intro?.index).toBe(0);
    expect(st.question).toBeNull();

    // intro 中は回答も締切も再開始もできない
    c1.send({ type: "answer", text: "りんご" });
    expect((await c1.waitFor("error")).code).toBe("not_in_question");
    gm.send({ type: "close" });
    expect((await gm.waitFor("error")).code).toBe("invalid_state");
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    expect((await gm.waitFor("error")).code).toBe("invalid_state");

    gm.send({ type: "next" });
    const slide = await c1.waitFor("introStarted", (m) => m.intro.index === 1);
    expect(slide.intro.slide).toEqual({ kind: "slide", heading: "ルール", body: "3回まで", imageUrl: undefined });

    gm.send({ type: "next" });
    const qs = await c1.waitFor("questionStarted");
    expect(qs.question).toMatchObject({ index: 0, prompt: "ごんり" });
    expect(qs.question.deadlineAt).not.toBeNull();
    // 第1問に入った時点で締切アラームが張られている
    expect(await runDurableObjectAlarm(stubFor("INTR01"))).toBe(true);
    await c1.waitFor("questionClosed");
  });

  it("the alarm during intro is the 24h cleanup, not a deadline", async () => {
    const set = await seedSetWithIntro();
    await initRoom("INTR02");
    const gm = await connect("INTR02", "gm-token");
    await gm.waitFor("state");
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    await gm.waitFor("introStarted");
    expect(await runDurableObjectAlarm(stubFor("INTR02"))).toBe(true);
    // cleanup が走ったのでルームは消えている
    expect((await stubFor("INTR02").fetch("http://room/exists")).status).toBe(404);
  });

  it("updateSettings during intro only broadcasts settingsUpdated and the title reflects it", async () => {
    const set = await seedSetWithIntro();
    await initRoom("INTR03");
    const gm = await connect("INTR03", "gm-token");
    await gm.waitFor("state");
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    await gm.waitFor("introStarted");
    gm.send({ type: "updateSettings", settings: { maxAttempts: 5 } });
    const su = await gm.waitFor("settingsUpdated", (m) => m.settings.override.maxAttempts === 5);
    expect(su.settings.effective?.maxAttempts).toBe(5);
    expect(gm.received.some((m) => m.type === "deadlineSet")).toBe(false);
    const gm2 = await connect("INTR03", "gm-token");
    const st = await gm2.waitFor("state");
    expect(st.intro?.slide).toMatchObject({ kind: "title", settings: { maxAttempts: 5 } });
  });

  it("start from finalResult shows the title again and keeps scores when carrying over", async () => {
    const set = await seedSet({ timerMode: "none" });
    await initRoom("INTR04");
    const gm = await connect("INTR04", "gm-token");
    await gm.waitFor("state");
    const p1 = await join("INTR04", "みさき");
    const c1 = await connect("INTR04", p1.participantToken);
    await c1.waitFor("state");
    await startGame(gm, set.id);
    await c1.waitFor("questionStarted");
    c1.send({ type: "answer", text: "りんご" });
    await c1.waitFor("answerResult");
    gm.send({ type: "close" }); await gm.waitFor("questionClosed");
    gm.send({ type: "next" }); await gm.waitFor("questionStarted", (m) => m.question.index === 1);
    gm.send({ type: "close" }); await gm.waitFor("questionClosed", (m) => m.result.answers[0] === "ばなな");
    gm.send({ type: "next" }); await gm.waitFor("finalResult");

    // ここまでに届いた leaderboard を捨て、2ゲーム目の開始で届くものだけを見る
    gm.received.length = 0;
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: true });
    const title = await c1.waitFor("introStarted");
    expect(title.intro.slide.kind).toBe("title");
    const lb = await gm.waitFor("leaderboard", (m) => m.entries[0]?.nickname === "みさき");
    expect(lb.entries[0].score).toBe(150);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run test/room/Room.test.ts`
Expected: FAIL（`introStarted` が届かず timeout、または `Room.ts` の型エラー）

- [ ] **Step 4: メッセージ型を更新**

`src/shared/messages.ts`:

`StateMessage` の `question: QuestionView | null;` の直前に追加:

```ts
  intro: IntroView | null;               // intro フェーズのみ
```

`ServerMessage` の `questionStarted` の直前に追加:

```ts
  | { type: "introStarted"; intro: IntroView }
```

- [ ] **Step 5: `Room.ts` を更新**

`start` ケースを置き換え:

```ts
      case "start": {
        if (engine.phase !== "lobby" && engine.phase !== "finalResult") return this.sendError(ws, "invalid_state", "開始できる状態ではありません");
        const set = await getQuestionSet(this.env.DB, msg.questionSetId);
        if (!set || set.questions.length === 0) return this.sendError(ws, "question_set_not_found", "問題セットが見つかりません");
        const intro = engine.start(set, msg.carryOverScores);
        this.save();
        this.broadcast({ type: "introStarted", intro });
        this.broadcast({ type: "leaderboard", entries: engine.leaderboard() });
        // 開始で初めて「実際に効く設定」が決まるので配る（GM 管理パネルの表示用）
        this.broadcast({ type: "settingsUpdated", settings: this.settingsView() });
        // intro には締切が無い。第1問に入るときに armDeadline する
        await this.scheduleCleanup();
        return;
      }
```

`next` ケースを置き換え:

```ts
      case "next": {
        if (engine.phase !== "intro" && engine.phase !== "questionResult") return this.sendError(ws, "invalid_state", "次へ進める状態ではありません");
        const r = engine.next(now);
        this.save();
        if (r.kind === "intro") {
          this.broadcast({ type: "introStarted", intro: r.intro });
        } else if (r.kind === "question") {
          this.broadcast({ type: "questionStarted", question: r.question });
          // 問題ごとの上書きで効く設定が変わりうる
          this.broadcast({ type: "settingsUpdated", settings: this.settingsView() });
          await this.armDeadline(r.question.deadlineAt);
        } else {
          this.broadcast({ type: "finalResult", entries: r.entries });
          await this.scheduleCleanup();
        }
        return;
      }
```

`stateFor` の `question: engine.currentQuestionView(),` の直前に `intro: engine.introView(),` を追加。

- [ ] **Step 6: テストと型チェックが通ることを確認**

Run: `npx vitest run test/room && npx tsc -p tsconfig.worker.json --noEmit`
Expected: PASS。`tsc -p tsconfig.json`（フロント）は `clientState.ts` の `StateMessage` 不整合で失敗するが Task 4 で直す。

- [ ] **Step 7: コミット**

```bash
git add src/shared/messages.ts src/room/Room.ts test/room/Room.test.ts
git commit -m "feat(room): broadcast introStarted and carry intro in state; next advances through intro

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: クライアント状態 reducer

**Files:**
- Modify: `src/web/lib/clientState.ts`
- Test: `test/web/clientState.test.ts`

**Interfaces:**
- Consumes: Task 3 の `StateMessage.intro`、`introStarted`
- Produces: `ClientState.intro: IntroView | null`

- [ ] **Step 1: 失敗するテストを書く**

`test/web/clientState.test.ts`:

import に `IntroView` を追加: `import type { IntroView, StateMessage } from "../../src/shared/messages";`

`baseState` の `question: null, questionResult: null,` を `intro: null, question: null, questionResult: null,` にする（型が要求する）。

末尾に追加:

```ts
describe("intro slides", () => {
  const intro: IntroView = { index: 0, total: 1, slide: { kind: "title", name: "テスト", questionCount: 1, settings: DEFAULT_SETTINGS } };

  it("introStarted sets phase and intro and clears question state", () => {
    let s = applyServerMessage(withState(), { type: "questionStarted", question: { index: 0, total: 1, prompt: "x", deadlineAt: null, maxAttempts: 3 } }, T0);
    s = applyServerMessage(s, { type: "answerResult", correct: false, correctRank: null, remainingAttempts: 2, points: 0 }, T0);
    s = applyServerMessage(s, { type: "introStarted", intro }, T0);
    expect(s.phase).toBe("intro");
    expect(s.intro).toEqual(intro);
    expect(s.question).toBeNull();
    expect(s.questionResult).toBeNull();
    expect(s.lastAnswerResult).toBeNull();
    expect(s.finalEntries).toBeNull();
    expect(s.correctCountThisQuestion).toBe(0);
  });

  it("questionStarted clears intro", () => {
    let s = applyServerMessage(withState(), { type: "introStarted", intro }, T0);
    s = applyServerMessage(s, { type: "questionStarted", question: { index: 0, total: 1, prompt: "x", deadlineAt: null, maxAttempts: 3 } }, T0);
    expect(s.intro).toBeNull();
    expect(s.phase).toBe("question");
  });

  it("state message carries intro", () => {
    const s = applyServerMessage(initialClientState, { ...baseState, phase: "intro", intro }, T0);
    expect(s.phase).toBe("intro");
    expect(s.intro).toEqual(intro);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/web/clientState.test.ts`
Expected: FAIL（`s.intro` が `undefined`、`introStarted` が未処理）

- [ ] **Step 3: reducer を実装**

`src/web/lib/clientState.ts`:

import に `IntroView` を追加:

```ts
import type { ErrorCode, IntroView, MyAnswerStatus, QuestionResultView, QuestionView, ServerMessage, SettingsView } from "../../shared/messages";
```

`ClientState` の `question: QuestionView | null;` の直前に `intro: IntroView | null;` を追加。`initialClientState` の `question: null,` の直前に `intro: null,` を追加。

`case "state":` の返り値に `intro: msg.intro,` を追加（`question: msg.question,` の直前）。

`case "questionStarted":` の直前に追加:

```ts
    case "introStarted":
      return {
        ...s, phase: "intro", intro: msg.intro, question: null, questionResult: null, lastAnswerResult: null, finalEntries: null,
        correctCountThisQuestion: 0,
      };
```

`case "questionStarted":` の返り値に `intro: null,` を追加（`phase: "question",` の直後）。

- [ ] **Step 4: テストと型チェックが通ることを確認**

Run: `npx vitest run test/web/clientState.test.ts && npm run typecheck`
Expected: PASS。typecheck も全プロジェクトで通る（GM／参加者画面はまだ `intro` を描画しないだけで型は整合する）

- [ ] **Step 5: コミット**

```bash
git add src/web/lib/clientState.ts test/web/clientState.test.ts
git commit -m "feat(web): track intro slides in client state

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: スライド部品を共通化し `IntroSlidePreview` を追加

**Files:**
- Create: `src/web/components/Slides.tsx`
- Delete: `src/web/admin/SlidePreview.tsx`
- Modify: `src/web/admin/QuestionSetEditPage.tsx:12`（import 先の変更のみ）

**Interfaces:**
- Produces: `TitleSlidePreview`、`QuestionSlidePreview`（既存と同じ props）、`IntroSlidePreview({ heading?, body?, imageUrl?, compact? })` を `src/web/components/Slides.tsx` から export

- [ ] **Step 1: ファイルを移動**

```bash
git mv src/web/admin/SlidePreview.tsx src/web/components/Slides.tsx
sed -i '' 's#from "./SlidePreview"#from "../components/Slides"#' src/web/admin/QuestionSetEditPage.tsx
```

`src/web/components/Slides.tsx` の import 2行を相対パスに合わせて修正:

```ts
import { Timer } from "lucide-react";
import type { Question, QuestionSettings } from "../../shared/types";
import { isLightColor } from "../lib/color";
```

- [ ] **Step 2: `IntroSlidePreview` を追加**

`src/web/components/Slides.tsx` の `QuestionSlidePreview` の後、`SlideFrame` の前に追加:

```tsx
/** 説明スライド。画像があれば中央に大きく、見出し・本文はその上下に添える。本文は改行を保つ */
export function IntroSlidePreview({ heading, body, imageUrl, compact = false }: {
  heading?: string; body?: string; imageUrl?: string; compact?: boolean;
}) {
  const empty = !heading && !body && !imageUrl;
  return (
    <SlideFrame>
      <div className="flex h-full flex-col items-center justify-center gap-[2cqw] px-[6cqw] py-[4cqw] text-center">
        {heading && (
          <h2 className={`break-words font-black leading-tight ${imageUrl ? "text-[4cqw]" : "text-[6cqw]"}`}>{heading}</h2>
        )}
        {imageUrl && <img src={imageUrl} alt="" className="min-h-0 w-auto max-w-full flex-1 rounded-[1.5cqw] object-contain" />}
        {body && !compact && (
          <p className={`max-h-full overflow-hidden whitespace-pre-wrap break-words text-left leading-relaxed text-slate-200 ${imageUrl ? "text-[2.2cqw]" : "text-[3cqw]"}`}>{body}</p>
        )}
        {empty && <p className="text-[4cqw] text-slate-500">見出し・本文・画像のどれかを入力</p>}
      </div>
    </SlideFrame>
  );
}
```

- [ ] **Step 3: 型チェックとビルド**

Run: `npm run typecheck && npm run build`
Expected: どちらも成功。`src/web/admin/SlidePreview.tsx` が存在しないこと: `ls src/web/admin/SlidePreview.tsx` が `No such file`

- [ ] **Step 4: コミット**

```bash
git add -A src/web/components/Slides.tsx src/web/admin
git commit -m "refactor(web): move slide previews to components and add IntroSlidePreview

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: GM 画面と参加者画面の `intro` 表示

**Files:**
- Modify: `src/web/gm/GmRoomPage.tsx`
- Modify: `src/web/player/PlayPage.tsx`

**Interfaces:**
- Consumes: Task 4 の `state.intro`、`state.phase === "intro"`、Task 5 の `TitleSlidePreview` / `IntroSlidePreview`

- [ ] **Step 1: GM 画面に intro を描画**

`src/web/gm/GmRoomPage.tsx`:

import を追加: `import { IntroSlidePreview, TitleSlidePreview } from "../components/Slides";`

`const q = state.question;` の直後に追加:

```ts
  const intro = state.intro;
  // ロビーと intro の間は入室が続くので、順位表ではなく参加者一覧を出す
  const showParticipants = state.phase === "lobby" || state.phase === "intro";
```

`{(state.phase === "question" || state.phase === "questionResult") && q && (` のブロックの直前に追加:

```tsx
          {state.phase === "intro" && intro && (
            <div key={intro.index} className="qj-pop mx-auto w-full max-w-5xl">
              {intro.slide.kind === "title"
                ? <TitleSlidePreview name={intro.slide.name} coverImageUrl={intro.slide.coverImageUrl} questionCount={intro.slide.questionCount} settings={intro.slide.settings} />
                : <IntroSlidePreview heading={intro.slide.heading} body={intro.slide.body} imageUrl={intro.slide.imageUrl} />}
            </div>
          )}
```

右カラムの `Card` を次にする（`state.phase === "lobby"` を `showParticipants` に置き換え）:

```tsx
          <Card tone="dark" title={showParticipants ? "参加者" : "ランキング"} icon={showParticipants ? Users : Crown} className="sticky top-6">
            {showParticipants ? (
```

フッターの `締切` ボタンの直前に追加:

```tsx
        {state.phase === "intro" && intro && (
          <Button variant="brand" size="lg" icon={ArrowRight} onClick={() => send({ type: "next" })}>{intro.index + 1 >= intro.total ? "第1問へ" : "次へ"}</Button>
        )}
```

「ロビーへ戻る」の条件を `(state.phase === "intro" || state.phase === "question" || state.phase === "questionResult")` にする。

- [ ] **Step 2: 参加者画面に intro を描画**

`src/web/player/PlayPage.tsx` の待機カードを次に置き換え:

```tsx
      {state.ready && (state.phase === "lobby" || state.phase === "intro") && (
        <Card icon={Users} title="待機中">
          {state.phase === "intro" && state.questionSetName && <p className="text-brand text-sm font-bold">{state.questionSetName}</p>}
          <p className="text-2xl font-black">まもなく開始します</p>
          <p className="mt-2 text-slate-600">参加者 {state.participants.filter((p) => p.connected).length}名</p>
        </Card>
      )}
```

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: ブラウザで確認**

`preview_start` で `quizjam-dev`（`.claude/launch.json` 定義済み、port 5173）を起動し、次を確認する。開発サーバーの D1 はローカルなので、`npm run db:migrate:local` を先に1度実行しておく。

1. `/admin` で合言葉（`wrangler` のローカル secret。無ければ `.dev.vars` に `ADMIN_PASSPHRASE=dev` を置く）を入れ、問題セットを1つ保存する（この時点では説明スライドは作れない。Task 7 で再確認する）
2. `/` → 「新しいルームを作る」→ `/gm/:code`。別タブで `/play/:code` を開きニックネームで参加
3. GM で「開始する」→ GM 画面にタイトルスライド（企画名・全n問・制限時間）が 16:9 で表示され、右カラムは参加者一覧、フッターは「第1問へ」「ロビーへ戻る」
4. 参加者タブは「待機中」のまま、企画名と「まもなく開始します」が出ている
5. GM タブを再読み込み → タイトルスライドに戻る
6. 「第1問へ」→ 両画面が第1問になる。「ロビーへ戻る」が intro 中も動く
7. `read_console_messages` でエラーが無いこと。スクリーンショットを撮る

- [ ] **Step 5: コミット**

```bash
git add src/web/gm/GmRoomPage.tsx src/web/player/PlayPage.tsx
git commit -m "feat(gm): show title and intro slides before question 1; players keep waiting screen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 編集画面で説明スライドを作れるようにする

**Files:**
- Modify: `src/web/admin/SlideInspector.tsx`（`IntroInspector` 追加）
- Modify: `src/web/admin/QuestionSetEditPage.tsx`（全面的に変更。下に完成形を示す）

**Interfaces:**
- Consumes: Task 1 の `IntroSlide`、Task 5 の `IntroSlidePreview`
- Produces: `IntroInspector({ slide: IntroSlide; passphrase: string; onChange: (patch: Partial<IntroSlide>) => void })`

- [ ] **Step 1: `IntroInspector` を追加**

`src/web/admin/SlideInspector.tsx`:

import を `import type { IntroSlide, Question, QuestionSettings, TimerMode } from "../../shared/types";` に変更。

`TitleInspector` の後に追加:

```tsx
/** 説明スライド＝見出し・本文・画像。どれか1つは必要 */
export function IntroInspector({ slide, passphrase, onChange }: {
  slide: IntroSlide; passphrase: string; onChange: (patch: Partial<IntroSlide>) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="見出し（任意）">
        <input value={slide.heading ?? ""} onChange={(e) => onChange({ heading: e.target.value || undefined })} placeholder="例: ルール説明" maxLength={100} className={`${inputClass} text-lg font-bold`} autoFocus />
      </Field>
      <Field label="本文（任意）" hint="改行はそのまま表示。1000文字まで">
        <textarea rows={8} value={slide.body ?? ""} onChange={(e) => onChange({ body: e.target.value || undefined })} maxLength={1000}
          placeholder={"例: 1問につき3回まで回答できます\n早く正解するほど高得点"} className={textareaClass} />
      </Field>
      <ImageField label="画像（任意）" value={slide.imageUrl} onChange={(imageUrl) => onChange({ imageUrl })} passphrase={passphrase} />
      <p className="text-xs text-slate-500">見出し・本文・画像のどれか1つは必要です。</p>
    </div>
  );
}
```

- [ ] **Step 2: `QuestionSetEditPage.tsx` を書き換える**

ファイル全体を次の内容にする。選択状態は `"title" | number | { intro: number }` で、数値は問題、オブジェクトは説明スライド。

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle, ArrowDown, ArrowLeft, ArrowUp, Check, ChevronLeft, ChevronRight, Copy, Download, Plus, Presentation, Save, Trash2, Upload,
} from "lucide-react";
import { api } from "../lib/api";
import { Button } from "../components/Button";
import { AdminGate } from "./AdminGate";
import { DEFAULT_SETTINGS, resolveSettings } from "../../shared/defaults";
import { validateQuestionSetInput, type QuestionSetInput } from "../../shared/validateQuestionSet";
import type { IntroSlide, Question, QuestionSet, QuestionSettings } from "../../shared/types";
import { IntroSlidePreview, QuestionSlidePreview, TitleSlidePreview } from "../components/Slides";
import { IntroInspector, QuestionInspector, TitleInspector } from "./SlideInspector";

export function QuestionSetEditPage() {
  return <AdminGate>{(pass) => <Editor passphrase={pass} />}</AdminGate>;
}

/** 選択中のスライド。"title" がタイトル、{ intro } が説明スライド、数値が問題のインデックス */
type Selection = "title" | number | { intro: number };

const isIntroSel = (s: Selection): s is { intro: number } => typeof s === "object";

function newQuestion(): Question {
  return { id: crypto.randomUUID(), type: "anagram", prompt: "", answers: [""] };
}
function newIntroSlide(): IntroSlide {
  return { id: crypto.randomUUID() };
}

interface Draft { name: string; coverImageUrl?: string; slideBackground?: string; introSlides: IntroSlide[]; settings: QuestionSettings; questions: Question[] }

const EMPTY_DRAFT: Draft = { name: "", introSlides: [], settings: DEFAULT_SETTINGS, questions: [newQuestion()] };

function introEmpty(s: IntroSlide): boolean {
  return !s.heading?.trim() && !s.body?.trim() && !s.imageUrl;
}

/** 保存前チェック。問題のある最初のスライドを返す */
function findProblem(d: Draft): { slide: Selection; message: string } | null {
  if (!d.name.trim()) return { slide: "title", message: "企画名を入力してください" };
  if (d.questions.length === 0) return { slide: "title", message: "問題を1問以上追加してください" };
  for (const [i, s] of d.introSlides.entries()) {
    if (introEmpty(s)) return { slide: { intro: i }, message: `説明スライド${i + 1}に見出し・本文・画像のどれかを入れてください` };
  }
  for (const [i, q] of d.questions.entries()) {
    if (!q.answers.some((a) => a.trim())) return { slide: i, message: `第${i + 1}問の正解を入力してください` };
    if (!q.prompt.trim() && !q.imageUrl) return { slide: i, message: `第${i + 1}問の出題文か画像を入れてください（出題文は「生成」で正解から作れます）` };
  }
  return null;
}

function questionIncomplete(q: Question): boolean {
  return (!q.prompt.trim() && !q.imageUrl) || !q.answers.some((a) => a.trim());
}

function toInput(d: Draft): QuestionSetInput | { error: string } {
  return validateQuestionSetInput({
    ...d,
    name: d.name.trim(),
    introSlides: d.introSlides.map((s) => ({ ...s, heading: s.heading?.trim() || undefined, body: s.body?.trim() || undefined })),
    questions: d.questions.map((q) => ({ ...q, prompt: q.prompt.trim(), answers: q.answers.map((a) => a.trim()).filter(Boolean) })),
  });
}

function fromSet(s: QuestionSet | QuestionSetInput): Draft {
  return {
    name: s.name, coverImageUrl: s.coverImageUrl, slideBackground: s.slideBackground,
    introSlides: s.introSlides ?? [],
    settings: { ...DEFAULT_SETTINGS, ...s.settings },
    questions: s.questions.length ? s.questions : [newQuestion()],
  };
}

function Editor({ passphrase }: { passphrase: string }) {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const isNew = id === "new";
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [savedJson, setSavedJson] = useState<string>(() => JSON.stringify(EMPTY_DRAFT));
  const [loading, setLoading] = useState(!isNew);
  const [selected, setSelected] = useState<Selection>("title");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const thumbRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    if (isNew) return;
    api.getQuestionSet(id).then((s) => { const d = fromSet(s); setDraft(d); setSavedJson(JSON.stringify(d)); })
      .catch(() => setError("問題セットを読み込めませんでした")).finally(() => setLoading(false));
  }, [id, isNew]);

  const dirty = useMemo(() => JSON.stringify(draft) !== savedJson, [draft, savedJson]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const { questions, settings, introSlides } = draft;
  const total = questions.length;
  const introCount = introSlides.length;
  const current = typeof selected === "number" ? questions[selected] : undefined;
  const currentIntro = isIntroSel(selected) ? introSlides[selected.intro] : undefined;
  // 削除などで選択位置が範囲外になったら手前に寄せる
  useEffect(() => {
    if (typeof selected === "number" && selected >= total) setSelected(total ? total - 1 : "title");
    if (isIntroSel(selected) && selected.intro >= introCount) setSelected(introCount ? { intro: introCount - 1 } : "title");
  }, [selected, total, introCount]);

  // 選択したスライドのサムネイルを見える位置へ
  useEffect(() => {
    const key = selected === "title" ? "title" : isIntroSel(selected) ? introSlides[selected.intro]?.id : questions[selected]?.id;
    if (key) thumbRefs.current.get(key)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected, questions, introSlides]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const updateQuestion = (i: number, p: Partial<Question>) => setDraft((d) => ({ ...d, questions: d.questions.map((q, j) => (j === i ? { ...q, ...p } : q)) }));
  const updateIntro = (i: number, p: Partial<IntroSlide>) => setDraft((d) => ({ ...d, introSlides: d.introSlides.map((s, j) => (j === i ? { ...s, ...p } : s)) }));

  const addQuestion = (after: number = total - 1) => {
    const q = newQuestion();
    setDraft((d) => { const qs = [...d.questions]; qs.splice(after + 1, 0, q); return { ...d, questions: qs }; });
    setSelected(after + 1);
  };
  const duplicateQuestion = (i: number) => {
    setDraft((d) => { const qs = [...d.questions]; qs.splice(i + 1, 0, { ...structuredClone(d.questions[i]), id: crypto.randomUUID() }); return { ...d, questions: qs }; });
    setSelected(i + 1);
  };
  const removeQuestion = (i: number) => {
    const q = questions[i];
    if (!questionIncomplete(q) && !confirm(`第${i + 1}問「${q.answers[0] || q.prompt}」を削除しますか？`)) return;
    setDraft((d) => ({ ...d, questions: d.questions.filter((_, j) => j !== i) }));
    setSelected(i > 0 ? i - 1 : total > 1 ? 0 : "title");
  };
  const moveQuestion = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= total) return;
    setDraft((d) => { const qs = [...d.questions]; [qs[i], qs[j]] = [qs[j], qs[i]]; return { ...d, questions: qs }; });
    setSelected(j);
  };

  // 説明スライドは末尾（最後の説明スライドの後ろ）に追加する
  const addIntro = () => {
    const s = newIntroSlide();
    setDraft((d) => ({ ...d, introSlides: [...d.introSlides, s] }));
    setSelected({ intro: introCount });
  };
  const duplicateIntro = (i: number) => {
    setDraft((d) => { const ss = [...d.introSlides]; ss.splice(i + 1, 0, { ...structuredClone(d.introSlides[i]), id: crypto.randomUUID() }); return { ...d, introSlides: ss }; });
    setSelected({ intro: i + 1 });
  };
  const removeIntro = (i: number) => {
    const s = introSlides[i];
    if (!introEmpty(s) && !confirm(`説明スライド${i + 1}「${s.heading || s.body?.split("\n")[0] || "画像"}」を削除しますか？`)) return;
    setDraft((d) => ({ ...d, introSlides: d.introSlides.filter((_, j) => j !== i) }));
    setSelected(i > 0 ? { intro: i - 1 } : "title");
  };
  const moveIntro = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= introCount) return;
    setDraft((d) => { const ss = [...d.introSlides]; [ss[i], ss[j]] = [ss[j], ss[i]]; return { ...d, introSlides: ss }; });
    setSelected({ intro: j });
  };

  // 並び: タイトル → 説明1..k → 問題1..n
  const goPrev = useCallback(() => setSelected((s) => {
    if (s === "title") return "title";
    if (isIntroSel(s)) return s.intro === 0 ? "title" : { intro: s.intro - 1 };
    if (s === 0) return introCount ? { intro: introCount - 1 } : "title";
    return s - 1;
  }), [introCount]);
  const goNext = useCallback(() => setSelected((s) => {
    if (s === "title") return introCount ? { intro: 0 } : total ? 0 : "title";
    if (isIntroSel(s)) return s.intro + 1 < introCount ? { intro: s.intro + 1 } : total ? 0 : s;
    return Math.min(total - 1, s + 1);
  }), [introCount, total]);
  const atLast = selected !== "title" && (isIntroSel(selected) ? selected.intro >= introCount - 1 && total === 0 : selected >= total - 1);

  // 入力欄以外にフォーカスがあるときは ↑↓ / PageUp・PageDown でスライド移動
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); goPrev(); }
      if (e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); goNext(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext]);

  const save = async () => {
    const problem = findProblem(draft);
    if (problem) { setSelected(problem.slide); setError(problem.message); return; }
    const v = toInput(draft);
    if ("error" in v) { setError(v.error); return; }
    setSaving(true); setError(null);
    try {
      const saved = isNew ? await api.createQuestionSet(v, passphrase) : await api.updateQuestionSet(id, v, passphrase);
      const d = fromSet(saved);
      setDraft(d); setSavedJson(JSON.stringify(d)); setSavedAt(Date.now());
      if (isNew) navigate(`/admin/${saved.id}`, { replace: true });
    } catch { setError("保存に失敗しました"); } finally { setSaving(false); }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ ...draft, name: draft.name.trim() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.name.trim() || "question-set"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = async (file: File) => {
    try {
      const v = validateQuestionSetInput(JSON.parse(await file.text()));
      if ("error" in v) { setError(`インポート失敗: ${v.error}`); return; }
      if (dirty && !confirm("未保存の内容をインポートした内容で置き換えますか？")) return;
      setDraft(fromSet(v)); setSelected("title"); setError(null);
    } catch { setError("JSONを読み込めません"); }
  };

  const registerThumb = (key: string) => (el: HTMLElement | null) => { if (el) thumbRefs.current.set(key, el); else thumbRefs.current.delete(key); };
  const thumbClass = (active: boolean) =>
    `group relative flex w-full items-start gap-2 rounded-xl p-2 text-left transition ${active ? "bg-slate-700 ring-2 ring-purple-400" : "hover:bg-slate-700/50"}`;
  const toolBtn = "rounded-xl p-2 hover:bg-slate-800 disabled:opacity-30";

  if (loading) return <main className="flex min-h-full items-center justify-center bg-slate-900 text-slate-400">読み込んでいます…</main>;

  const heading = selected === "title" ? "タイトルスライド" : isIntroSel(selected) ? `説明スライド ${selected.intro + 1}` : `第${selected + 1}問`;
  const position = selected === "title" ? "タイトル" : isIntroSel(selected) ? `説明 ${selected.intro + 1} / ${introCount}` : `${selected + 1} / ${total}`;

  return (
    <main className="grid h-full grid-rows-[auto_1fr] bg-slate-900 text-slate-100">
      <header className="flex items-center gap-4 border-b border-slate-800 px-6 py-3">
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"><ArrowLeft size={16} aria-hidden />一覧へ</Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-black">
          {draft.name.trim() || (isNew ? "新しい企画" : "企画を編集")}
          <span className="ml-3 text-sm font-bold text-slate-500">{total}問{introCount > 0 && ` ・ 説明${introCount}枚`}</span>
        </h1>
        <span className="text-sm" aria-live="polite">
          {dirty ? <span className="inline-flex items-center gap-1 text-amber-300"><AlertCircle size={16} aria-hidden />未保存</span>
            : savedAt ? <span className="inline-flex items-center gap-1 text-green-300"><Check size={16} aria-hidden />保存済み</span> : null}
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>インポート</Button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ""; }} />
          <Button variant="secondary" icon={Download} onClick={exportJson}>エクスポート</Button>
          <Button variant="brand" icon={Save} onClick={save} disabled={saving || (!dirty && !isNew)}>{saving ? "保存中…" : "保存"}</Button>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[240px_1fr_380px]">
        {/* 左: スライド一覧（タイトル → 説明 → 問題） */}
        <nav className="flex min-h-0 flex-col border-r border-slate-800" aria-label="スライド一覧">
          <ol className="flex-1 space-y-1 overflow-y-auto p-3">
            <li ref={registerThumb("title")}>
              <button type="button" onClick={() => setSelected("title")} className={thumbClass(selected === "title")} aria-current={selected === "title" ? "true" : undefined}>
                <span className="w-5 shrink-0 pt-0.5 text-right text-xs font-bold text-slate-400">T</span>
                <span className="min-w-0 flex-1"><TitleSlidePreview name={draft.name} coverImageUrl={draft.coverImageUrl} questionCount={total} settings={settings} compact /></span>
              </button>
            </li>
            {introSlides.map((s, i) => {
              const active = isIntroSel(selected) && selected.intro === i;
              const empty = introEmpty(s);
              return (
                <li key={s.id} ref={registerThumb(s.id)}>
                  <button type="button" onClick={() => setSelected({ intro: i })} className={thumbClass(active)} aria-current={active ? "true" : undefined} aria-label={`説明スライド${i + 1}${empty ? "（未入力）" : ""}`}>
                    <span className="w-5 shrink-0 pt-0.5 text-right text-xs font-bold text-slate-400">説{i + 1}</span>
                    <span className="min-w-0 flex-1"><IntroSlidePreview heading={s.heading} body={s.body} imageUrl={s.imageUrl} compact /></span>
                    {empty && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-slate-900" aria-hidden />}
                  </button>
                </li>
              );
            })}
            {questions.map((q, i) => {
              const incomplete = questionIncomplete(q);
              return (
                <li key={q.id} ref={registerThumb(q.id)}>
                  <button type="button" onClick={() => setSelected(i)} className={thumbClass(selected === i)} aria-current={selected === i ? "true" : undefined} aria-label={`第${i + 1}問${incomplete ? "（未入力あり）" : ""}`}>
                    <span className="w-5 shrink-0 pt-0.5 text-right text-xs font-bold text-slate-400">{i + 1}</span>
                    <span className="min-w-0 flex-1"><QuestionSlidePreview question={q} index={i} total={total} settings={resolveSettings({ id: "", ...draft }, i)} background={draft.slideBackground} compact /></span>
                    {incomplete && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-slate-900" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-col gap-2 border-t border-slate-800 p-3">
            <Button type="button" variant="secondary" icon={Presentation} className="w-full" onClick={addIntro} disabled={introCount >= 20}>説明スライドを追加</Button>
            <Button type="button" variant="secondary" icon={Plus} className="w-full" onClick={() => addQuestion()}>問題を追加</Button>
          </div>
        </nav>

        {/* 中央: 大きなプレビュー */}
        <section className="flex min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto bg-slate-950/60 p-8">
          <div className="w-full max-w-4xl">
            {selected === "title"
              ? <TitleSlidePreview name={draft.name} coverImageUrl={draft.coverImageUrl} questionCount={total} settings={settings} />
              : isIntroSel(selected)
                ? currentIntro && <IntroSlidePreview heading={currentIntro.heading} body={currentIntro.body} imageUrl={currentIntro.imageUrl} />
                : current && <QuestionSlidePreview question={current} index={selected} total={total} settings={resolveSettings({ id: "", ...draft }, selected)} background={draft.slideBackground} />}
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <button type="button" onClick={goPrev} disabled={selected === "title"} className={toolBtn} aria-label="前のスライド"><ChevronLeft size={22} /></button>
            <span className="w-28 text-center text-sm font-bold tabular-nums">{position}</span>
            <button type="button" onClick={goNext} disabled={atLast} className={toolBtn} aria-label="次のスライド"><ChevronRight size={22} /></button>
            {isIntroSel(selected) && (
              <div className="ml-6 flex items-center gap-1 border-l border-slate-700 pl-6">
                <button type="button" onClick={() => moveIntro(selected.intro, -1)} disabled={selected.intro === 0} className={toolBtn} aria-label="前へ移動"><ArrowUp size={18} /></button>
                <button type="button" onClick={() => moveIntro(selected.intro, 1)} disabled={selected.intro >= introCount - 1} className={toolBtn} aria-label="後ろへ移動"><ArrowDown size={18} /></button>
                <button type="button" onClick={() => duplicateIntro(selected.intro)} className={toolBtn} aria-label="この説明スライドを複製"><Copy size={18} /></button>
                <button type="button" onClick={() => removeIntro(selected.intro)} className={`${toolBtn} text-red-300`} aria-label="この説明スライドを削除"><Trash2 size={18} /></button>
              </div>
            )}
            {typeof selected === "number" && (
              <div className="ml-6 flex items-center gap-1 border-l border-slate-700 pl-6">
                <button type="button" onClick={() => moveQuestion(selected, -1)} disabled={selected === 0} className={toolBtn} aria-label="前へ移動"><ArrowUp size={18} /></button>
                <button type="button" onClick={() => moveQuestion(selected, 1)} disabled={selected >= total - 1} className={toolBtn} aria-label="後ろへ移動"><ArrowDown size={18} /></button>
                <button type="button" onClick={() => duplicateQuestion(selected)} className={toolBtn} aria-label="この問題を複製"><Copy size={18} /></button>
                <button type="button" onClick={() => removeQuestion(selected)} className={`${toolBtn} text-red-300`} aria-label="この問題を削除"><Trash2 size={18} /></button>
                <Button type="button" variant="secondary" icon={Plus} className="ml-2 h-10 px-4 text-sm" onClick={() => addQuestion(selected)}>次に問題を追加</Button>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500">↑↓ キーでスライドを移動できます</p>
          {error && <p role="alert" className="qj-slide-in rounded-xl bg-red-600/20 px-4 py-2 font-bold text-red-300">{error}</p>}
        </section>

        {/* 右: 選択中スライドの内容 */}
        <aside className="min-h-0 overflow-y-auto border-l border-slate-800 p-5">
          <h2 className="mb-4 text-lg font-black">{heading}</h2>
          {selected === "title" ? (
            <TitleInspector name={draft.name} coverImageUrl={draft.coverImageUrl} slideBackground={draft.slideBackground} settings={settings} passphrase={passphrase}
              onName={(name) => patch({ name })} onCover={(coverImageUrl) => patch({ coverImageUrl })} onSlideBackground={(slideBackground) => patch({ slideBackground })}
              onSettings={(s) => patch({ settings: s })} />
          ) : isIntroSel(selected) ? (
            currentIntro && <IntroInspector key={currentIntro.id} slide={currentIntro} passphrase={passphrase} onChange={(p) => updateIntro(selected.intro, p)} />
          ) : current && (
            <QuestionInspector key={current.id} question={current} index={selected} baseSettings={settings} passphrase={passphrase} onChange={(p) => updateQuestion(selected, p)} />
          )}
        </aside>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: 型チェックとビルド**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 4: ブラウザで確認**

`preview_start` の `quizjam-dev` で `/admin/new` を開き:

1. 「説明スライドを追加」→ 一覧に「説1」がタイトルの直後に入り、右ペインが見出し・本文・画像になる。中央プレビューに入力が追従し、本文の改行が保たれる
2. もう1枚追加して「前へ移動」「後ろへ移動」「複製」「削除」が説明スライドの範囲内で動く。削除の確認ダイアログが出る
3. ↑↓キーでタイトル → 説1 → 説2 → 1問目 → … と通しで移動する
4. 説明スライドを空のまま「保存」→ そのスライドに移動して「説明スライド1に見出し・本文・画像のどれかを入れてください」
5. 見出しを入れて保存 → 「保存済み」。再読み込み後も説明スライドが残っている。エクスポートした JSON に `introSlides` が入り、インポートで戻せる
6. 説明スライドを全部削除すると選択がタイトルに戻り、保存できる
7. `/` からルームを作って開始 → タイトル → 説明スライド → 第1問の順で GM 画面に出る（Task 6 の確認と合わせる）。本文 1000 文字・改行入りでもスライドからはみ出さない
8. `read_console_messages` でエラー無し。スクリーンショットを撮る

- [ ] **Step 5: コミット**

```bash
git add src/web/admin/SlideInspector.tsx src/web/admin/QuestionSetEditPage.tsx
git commit -m "feat(admin): edit intro slides between the title and the questions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 設計書の更新と作業文書の削除

**Files:**
- Modify: `docs/data-model.md`, `docs/game-rules.md`, `docs/protocol.md`, `docs/screens.md`
- Delete: `docs/superpowers/specs/2026-10-11-intro-slides-design.md`, `docs/superpowers/plans/2026-10-11-intro-slides.md`

- [ ] **Step 1: `docs/data-model.md`**

`QuestionSet` の型に `introSlides?: IntroSlide[];   // 説明スライド。省略時は無し。20枚まで` を `slideBackground` の次に追加し、`Question` の前に次を追加:

```ts
/** ゲーム冒頭、タイトルの後に映す説明スライド */
interface IntroSlide {
  id: string;
  heading?: string;            // 100文字まで
  body?: string;               // 複数行可。1000文字まで
  imageUrl?: string;
}
```

バリデーション節に追加:

- `introSlides` は省略可。20件まで。各要素は `heading`（100文字以内）・`body`（1000文字以内）・`imageUrl` のいずれか1つが必須。空文字は無指定として扱う。空なら保存時に省略する
- `introSlides[].id` が無ければサーバーが UUID を採番する

`EngineState` の `phase` を `"lobby" | "intro" | "question" | "questionResult" | "finalResult";` にし、`currentIndex` の次に `introIndex: number;          // intro 中のスライド。0 がタイトル、1..n が introSlides[n-1]` を追加。

- [ ] **Step 2: `docs/game-rules.md`**

「ゲームの流れ」冒頭を `lobby → intro → question → questionResult → …` にし、手順 3 を次にする:

> 3. GM が問題セットを選び「開始する」を押すと、GM 画面にタイトルスライド（企画名・表紙・全n問・制限時間・お手付き上限）が表示される。続けて問題セットの説明スライドを「次へ」で順に表示し、最後の「第1問へ」で1問目が全員の画面に表示される。参加者の画面はその間「まもなく開始します」のまま。接続中の参加者が0名のときは開始できない。

「回答の受付」の拒否条件「出題中でない」はそのまま `intro` を含む。「GM のゲーム中操作」の表に `intro` 中も設定の上書き・スコア調整・キック・途中参加ができることを一行添える。

- [ ] **Step 3: `docs/protocol.md`**

- クライアント → サーバーの `next` を「次へ。`intro` 中は次の説明スライドか第1問へ、`questionResult` 中は次の問題か最終結果へ」にする
- サーバー → クライアントの表に `| introStarted | 全員 | { intro: IntroView } | タイトル・説明スライドの表示。start と intro 中の next で送る |` を `questionStarted` の上に追加
- `StateMessage` に `intro: IntroView | null;             // intro 中のみ` を追加し、`QuestionView` の後に `IntroView` / `IntroSlideView` の型を載せる（Task 2 と同じ定義）
- タイマー節の Alarm の説明「それ以外（ロビー・結果表示・…）」に「タイトル・説明スライド表示中」を加える
- エラーコード表の `invalid_state` 例に「`intro` 中の `close`」を添える

- [ ] **Step 4: `docs/screens.md`**

- GM 画面の表に `| タイトル・説明 | 企画名・表紙・全n問・制限時間・お手付き上限のタイトルスライド、続けて説明スライド（見出し・本文・画像）を 16:9 で表示。右カラムは参加者一覧。「次へ」（最後は「第1問へ」）「ロビーへ戻る」 |` をロビーの次に追加
- 参加者画面の「待機」を「「まもなく開始します」、参加者数。タイトル・説明スライド表示中は企画名も表示」にする
- 管理画面の左カラムを「タイトルスライド、説明スライド、各問題の 16:9 サムネイル」、右カラムに「説明スライド: 見出し・本文（複数行）・画像」を追加。箇条書きに「説明スライドの追加・複製・削除・並べ替え（説明スライド同士の中で）」を追加
- クライアント側の状態に「`introStarted` で `intro` を置き、問題と結果を消す。`questionStarted` で `intro` を消す」を追加
- 「GM 画面と編集画面のスライド描画は `components/Slides.tsx` を共用する」を GM 画面の箇条書きに添える

- [ ] **Step 5: 作業文書を削除し、全テストを通してコミット**

```bash
git rm docs/superpowers/specs/2026-10-11-intro-slides-design.md docs/superpowers/plans/2026-10-11-intro-slides.md
npm run typecheck && npm test
```

Expected: typecheck と全テストが PASS

```bash
git add docs
git commit -m "docs: describe the intro phase, intro slides and introStarted message

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
