# ジャンル選択つき早押し Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 早押しの問題にジャンルを付け、正解者が次のジャンルを選び、得意ジャンル以外の正解を 2 倍にする「ジャンル制」を QuizJam に足す。

**Architecture:** 専用の mode は増やさず、「`mode: "buzzer"` で全問に `genre` があるセット」をジャンル制として扱う。ルールは `GameEngine` に集約し、フェーズ `genreSelect` を `questionResult` と `question` のあいだに足す。読み上げ・音声・判定は既存の早押しをそのまま使う。

**Tech Stack:** TypeScript / React 19 / Tailwind 4 / Cloudflare Workers + Durable Objects / Vitest（`@cloudflare/vitest-plugin`）

**Spec:** `docs/superpowers/specs/2026-11-23-genre-select-buzzer-design.md`

## Global Constraints

- ルールはすべて `src/room/GameEngine.ts`。`Room.ts` は結果を配るだけ
- ジャンルの無い早押しセットとアナグラムの挙動・既存テストを変えない
- 古いスナップショット（`asked` / `genrePick` / `randomGenre` / `buzzer.sittingOut` が無い）を復元できる
- `genre` は前後の空白を除いて 1〜30 文字。ジャンル制はジャンル 3 種類以上
- 得意ジャンルは 2 つ。正解の加点は得意以外で 2 倍、不正解の減点は等倍
- 画面の文言は日本語。見た目は `docs/design-guide.md` に従う
- 作業は `main` から切ったブランチ `feat/genre-select-buzzer` で行う
- 各タスクの最後に `npm run typecheck` と `npm test` が通ること
- コミットメッセージは既存の形（`feat(quiz): …` / `test(…): …` / `docs: …`）、末尾に `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`

## Review Focus

1. **二重操作**: 正解者と GM が同時にジャンルを押す、GM が「次へ」を二度押す → 2 つ目は `invalid_state` で拒否され、問題が 2 問進まない（Task 2）
2. **選択中の再読み込み・再接続**: `genreSelect` 中に GM や選ぶ人がつなぎ直す → `state` に選ぶ人と残り数が入り、同じ場面に戻る（Task 5）
3. **ジャンル名の表記ゆれ**: `"海 "` と `"海"` は同じジャンル。前後空白を除いてから数える（Task 1）
4. **終盤の途中参加**: 残りのあるジャンルが 1 つ以下のときに入った人が、0〜1 個の申告で参加できる（Task 3）
5. **2 ゲーム目**: スコア通算で別のジャンル制セットを始める → 得意ジャンルと出題済みが消え、選び直しになる（Task 3）

---

## File Structure

| ファイル | 役割 |
|---|---|
| `src/shared/genre.ts`（新規） | ジャンルの定数と純関数（一覧・判定・件数） |
| `src/shared/types.ts` | `Question.genre` / `Participant.specialties` / `Phase` / `BuzzerState.sittingOut` / `Answer.multiplier` |
| `src/shared/validateQuestionSet.ts` | `genre` の検証 |
| `src/room/GameEngine.ts` | ジャンル制の進行・得意ジャンル・得点・途中終了 |
| `src/shared/messages.ts` | 新しいメッセージとビュー |
| `src/room/Room.ts` | 配線と配信 |
| `src/web/lib/clientState.ts` | reducer |
| `src/web/components/GenreButtons.tsx`（新規） | ジャンルのボタン群（GM・参加者・得意選択で共用） |
| `src/web/gm/GmRoomPage.tsx` / `BuzzerQuestion.tsx` / `GmControlPanel.tsx` / `CorrectPopup.tsx` | GM 画面 |
| `src/web/components/Leaderboard.tsx` / `Slides.tsx` | 得意ジャンルの表示、タイトルスライド |
| `src/web/player/SpecialtyPicker.tsx`（新規） / `PlayPage.tsx` / `BuzzerPanel.tsx` | 参加者画面 |
| `src/web/lib/editorChecks.ts` / `src/web/admin/SlideInspector.tsx` / `QuestionSetEditPage.tsx` | 管理画面 |
| `question-sets/genre-sample.json`（新規） | 動作確認用の小さなジャンル制セット（3 ジャンル × 2 問、音声なし） |

---

### Task 1: ジャンルの型・純関数・バリデーション

**Files:**
- Create: `src/shared/genre.ts`, `test/shared/genre.test.ts`, `question-sets/genre-sample.json`
- Modify: `src/shared/types.ts`, `src/shared/validateQuestionSet.ts`
- Test: `test/shared/validateQuestionSet.test.ts`

**Interfaces:**
- Produces（`src/shared/genre.ts`）:
  ```ts
  export const MAX_GENRE_LENGTH = 30;
  export const MIN_GENRES = 3;
  export const SPECIALTY_COUNT = 2;
  export const OFF_SPECIALTY_MULTIPLIER = 2;
  export interface GenreCount { genre: string; remaining: number }
  /** 最初に現れた順のジャンル名 */
  export function genresOf(questions: Pick<Question, "genre">[]): string[];
  /** 早押しで、1 問以上あり、全問に genre がある */
  export function isGenreSet(set: { mode?: QuestionSetMode; questions: Pick<Question, "genre">[] }): boolean;
  /** asked（出題済みの位置）を除いたジャンルごとの残り問題数。並びは genresOf と同じ */
  export function genreCounts(questions: Pick<Question, "genre">[], asked?: number[]): GenreCount[];
  ```
- Produces（`types.ts`）: `Question.genre?: string`、`Participant.specialties?: string[]`、`Phase` に `"genreSelect"`、`BuzzerState.sittingOut: string[]`（この問題を見送る参加者 ID）、`Answer.multiplier?: number`

- [ ] **Step 1: 失敗するテストを書く**

`test/shared/genre.test.ts`:
```ts
const qs = [{ genre: "海" }, { genre: "山" }, { genre: "海" }, { genre: "空" }];
expect(genresOf(qs)).toEqual(["海", "山", "空"]);
expect(genreCounts(qs)).toEqual([{ genre: "海", remaining: 2 }, { genre: "山", remaining: 1 }, { genre: "空", remaining: 1 }]);
expect(genreCounts(qs, [0, 1])).toEqual([{ genre: "海", remaining: 1 }, { genre: "山", remaining: 0 }, { genre: "空", remaining: 1 }]);
expect(isGenreSet({ mode: "buzzer", questions: qs })).toBe(true);
expect(isGenreSet({ mode: "buzzer", questions: [{ genre: "海" }, {}] })).toBe(false);
expect(isGenreSet({ questions: qs })).toBe(false);           // anagram
expect(isGenreSet({ mode: "buzzer", questions: [] })).toBe(false);
```

`test/shared/validateQuestionSet.test.ts` に追加（`q(genre?)` は `{ prompt: "問", answers: ["答"], genre }` を作るヘルパー）:
```ts
it("keeps trimmed genre on buzzer sets", …);
// mode buzzer, genres ["海 ", "山", "空"] → questions[0].genre === "海"
it("treats genres differing only by surrounding spaces as one", …);
// ["海 ", "海", "山"] → { error: "at least 3 genres are required" }
it("rejects mixed genre presence", …);
// ["海", undefined, "山"] → { error: "genre must be set on all questions or none" }
it("rejects fewer than 3 genres", …);          // ["海","山"] → { error: "at least 3 genres are required" }
it("rejects an invalid genre", …);
// genre: 31 文字 / 数値 / "   " のみ混在 → 31 文字と数値は { error: "questions[0].genre invalid" }
it("drops genre on anagram sets", …);          // mode 省略 → genre は undefined
it("accepts a buzzer set without any genre", …);
```
空白だけの `genre` は「無指定」として扱う（`prompt` と同じ流儀）。

- [ ] **Step 2: 落ちることを確認** — `npx vitest run test/shared` → 新規テストが FAIL
- [ ] **Step 3: `types.ts` に上の項目を足し、`genre.ts` を実装する**
- [ ] **Step 4: `validateQuestionSetInput` に `genre` を足す** — 問題ループで trim して検証し、ループ後に `mode === "buzzer"` のとき混在と種類数を検査する。`buzzer` 以外では保存しない
- [ ] **Step 5: `BuzzerState` を作っている箇所に `sittingOut: []` を足し、`GameEngine.fromSnapshot` で `sittingOut ?? []` を補う**（型を通すための最小変更。挙動は Task 3）
- [ ] **Step 6: `question-sets/genre-sample.json` を作る** — `name: "ジャンル制サンプル"`, `mode: "buzzer"`, `settings: {}`, ジャンル「動物」「植物」「天気」× 各 2 問（`id` は `G01`〜`G06`、`audio` なし）。テストでこの JSON を `validateQuestionSetInput` に通し、エラーにならないことを確かめる
- [ ] **Step 7: 通ることを確認** — `npx vitest run test/shared && npm run typecheck` → PASS
- [ ] **Step 8: Commit** — `feat(quiz): genre on buzzer questions and its validation`

---

### Task 2: エンジンのジャンル進行

**Files:**
- Modify: `src/room/GameEngine.ts`, `src/shared/messages.ts`（ビューの型だけ）
- Test: `test/room/GameEngine.test.ts`

**Interfaces:**
- Consumes: Task 1 の `genre.ts` と型
- Produces（`messages.ts`）:
  ```ts
  export interface GenreSelectView { picker: { participantId: string; nickname: string }; genres: GenreCount[] }
  // QuestionView に追加
  number: number;          // 第 n 問（1 始まり）。ジャンル制では出題した数、それ以外は index + 1
  genre?: string;
  randomGenre?: boolean;   // サーバーがランダムで決めた問題
  // IntroSlideView の title に追加
  genreCount?: number;     // ジャンル制のときだけ
  // ErrorCode に追加
  | "genre_unavailable"
  ```
- Produces（`GameEngine`）:
  ```ts
  static create(roomCode: string, rng?: () => number): GameEngine;          // 既定 Math.random
  static fromSnapshot(state: EngineState, rng?: () => number): GameEngine;
  get isGenreMode(): boolean;
  genres(): GenreCount[] | null;                 // ジャンル制のセットを読み込み中（lobby 以外）なら残り数、それ以外は null
  genreSelectView(): GenreSelectView | null;     // genreSelect フェーズのみ
  /** by: "gm" か参加者 ID。genre: null は GM の「ランダムで決める」 */
  pickGenre(by: "gm" | { participantId: string }, genre: string | null, now: number): PickOutcome;
  export type PickOutcome = { kind: "question"; question: QuestionView } | { kind: "rejected"; code: ErrorCode };
  export type NextOutcome = … | { kind: "genreSelect"; select: GenreSelectView };
  ```
- `EngineState` に `asked: number[]`、`genrePick: { pickerId: string } | null`、`randomGenre: boolean` を足す

**ルール（仕様の「進行」）:**
- `start`: `asked = []`, `genrePick = null`, `randomGenre = false`
- ランダムの選び方: 残りのあるジャンルの配列 `g` から `g[Math.floor(rng() * g.length)]`、そのジャンルの未出題の位置の配列 `q` から `q[Math.floor(rng() * q.length)]`
- `openQuestion` は開いた位置を `asked` に積む（ジャンル制でなくても積んでよい）
- `next`（`intro` の最後、ジャンル制）: ランダムで開く。`randomGenre = true`
- `next`（`questionResult`、ジャンル制）:
  - 未出題なし → `final`
  - 残りのあるジャンルが 1 つ → そのジャンルから開く（`randomGenre = false`）
  - 今の問題に正解の `Answer` があり、その参加者が `participants` にいる → `phase = "genreSelect"`, `genrePick = { pickerId }`
  - それ以外 → ランダムで開く（`randomGenre = true`）
- `pickGenre`: `genreSelect` 以外は `invalid_state`。参加者で `pickerId` と違えば `forbidden`。参加者の `genre: null` は `forbidden`。残り 0・存在しないジャンルは `genre_unavailable`。成功で `genrePick = null`、指定ジャンル（`randomGenre = false`）か、`null` ならランダム（`randomGenre = true`）で開く
- `removeParticipant`: `genreSelect` 中に選ぶ人が消えたら、その場でランダムに開く（`randomGenre = true`）
- `endGame`: `genrePick = null`
- `fromSnapshot`: `asked ?? []`, `genrePick ?? null`, `randomGenre ?? false`
- `currentQuestionView`: `number`・`genre`・`randomGenre` を入れる。`total` は問題数のまま
- `introView` のタイトル: ジャンル制なら `genreCount`

- [ ] **Step 1: 失敗するテストを書く**

`describe("GameEngine genre mode")`。セットは 3 ジャンル（A: 位置 0,1 / B: 2,3 / C: 4）。`rng` は配列を順に返すスタブ。
```ts
it("opens question 1 from a random genre and marks it random", …);
// rng → [0.99, 0]: genre "C", index 4, number 1, total 5, randomGenre true
it("moves to genreSelect with the correct answerer as picker", …);
// p1 が正解 → next → { kind: "genreSelect" }, picker p1, genres は C の remaining 0
it("the picker's choice opens an unasked question of that genre", …);
// pickGenre({participantId:"p1"}, "A") → kind question, genre "A", randomGenre false, number 2
it("rejects exhausted and unknown genres, non-pickers, and picks outside genreSelect", …);
// "C" → genre_unavailable / "無い" → genre_unavailable / p2 → forbidden / 2 回目の pick → invalid_state（currentIndex が変わらない）
it("the GM can pick any genre or random", …);
it("goes random when nobody was correct", …);        // closeQuestion → next → kind question, randomGenre true
it("skips selection when only one genre has questions left", …);
it("never repeats a question and ends in final after all are asked", …);
// rng 固定で 5 問回し、asked が 0..4 の並べ替え、6 回目の next が final
it("goes random when the picker is kicked during genreSelect", …);
// removeParticipant("p1") 後 phase === "question", randomGenre true
it("a second next() during genreSelect throws and changes nothing", …);
it("restores old snapshots without asked/genrePick", …);
it("non-genre sets still advance in order with number = index + 1", …);
it("title slide carries genreCount only for genre sets", …);
```

- [ ] **Step 2: 落ちることを確認** — `npx vitest run test/room/GameEngine.test.ts` → FAIL
- [ ] **Step 3: 上のルールを実装する**
- [ ] **Step 4: 通ることを確認** — `npx vitest run test/room/GameEngine.test.ts && npm run typecheck` → PASS（`QuestionView.number` を足したので、型エラーになるテストの期待値には `number` を足す）
- [ ] **Step 5: Commit** — `feat(quiz): genre selection flow in the game engine`

---

### Task 3: 得意ジャンル・早押しの可否・2 倍

**Files:**
- Modify: `src/room/GameEngine.ts`, `src/shared/messages.ts`
- Test: `test/room/GameEngine.test.ts`

**Interfaces:**
- Produces（`messages.ts`）:
  ```ts
  // ErrorCode に追加
  | "specialties_required" | "sitting_out" | "specialties_already_set" | "bad_specialties"
  // BuzzerView に追加
  sittingOut: string[];
  // QuestionResultView.results の要素に追加
  multiplier?: number;     // 2 のときだけ入れる
  ```
- Produces（`GameEngine`）:
  ```ts
  chooseSpecialties(participantId: string, genres: string[]): SpecialtyOutcome;
  export type SpecialtyOutcome = { kind: "accepted"; participant: Participant } | { kind: "rejected"; code: ErrorCode };
  // JudgeOutcome の correct に追加
  multiplier: number;      // 1 か 2
  ```

**ルール（仕様の「得意ジャンル」「得点」）:**
- `chooseSpecialties`: ジャンル制でない、または `lobby` / `finalResult` → `invalid_state`。参加者がいない → `forbidden`。すでに `specialties` がある → `specialties_already_set`。必要な個数は `min(SPECIALTY_COUNT, 残りのあるジャンルの数)`。個数違い・重複・残り 0・存在しないジャンル → `bad_specialties`。成功で `specialties` を置き、`phase === "question"` なら `buzzer.sittingOut` に追加する
- `start`: 全員の `specialties` を消す
- `buzz`（ジャンル制のみ）: `specialties` が無ければ `specialties_required`、`sittingOut` に居れば `sitting_out`。既存の検査（`not_reading` など）より先に見る
- `allParticipantsDone`（ジャンル制）: 対象は「接続中 ∧ `specialties` あり ∧ `sittingOut` に居ない」。対象 0 人なら `false`
- `judge` 正解（ジャンル制）: `multiplier = 得意に含まれなければ OFF_SPECIALTY_MULTIPLIER、含まれれば 1`、`points = basePoints × multiplier`。`Answer.multiplier` に記録。不正解は今までどおり
- `questionResult`: 記録された `multiplier` が 2 のとき `results[].multiplier = 2`
- `removeParticipant`: `sittingOut` からも消す
- `buzzerView`: `sittingOut` を入れる

- [ ] **Step 1: 失敗するテストを書く**

```ts
it("accepts exactly two distinct genres once", …);
// ["A","B"] accepted / 2 回目 → specialties_already_set / ["A"] → bad_specialties / ["A","A"] → bad_specialties / ["A","無い"] → bad_specialties
it("rejects choosing in lobby, finalResult, and on non-genre sets", …);   // invalid_state
it("cannot choose an exhausted genre", …);                                  // bad_specialties
it("needs fewer picks when fewer genres remain", …);
// 残り 1 ジャンル → [そのジャンル] で accepted / 残り 0（最終問の出題中）→ [] で accepted
it("refuses buzzes until specialties are chosen", …);                       // specialties_required
it("choosing during a question sits that question out and plays from the next", …);
// reading 中に choose → buzz は sitting_out、buzzerView().sittingOut に ID、次の問題では accepted
it("choosing during intro / questionResult / genreSelect allows buzzing on the next question", …);
it("doubles points off-specialty and not on-specialty", …);
// basePoints 100: ジャンル A の問題、得意 ["A","B"] → points 100, multiplier 1 / 得意 ["B","C"] → points 200, multiplier 2, questionResult().results[0].multiplier === 2
it("does not double the wrong penalty", …);                                 // wrongPenalty 50 → -50
it("auto-close ignores participants who cannot press", …);
// p1 選択済み・p2 未選択: p1 が不正解 → allParticipantsDone() true / 全員未選択 → false
it("a new game clears specialties and asked", …);                           // start(set, true) 後 specialties undefined, スコアは保持
it("non-genre buzzer sets need no specialties and never double", …);
```

- [ ] **Step 2: 落ちることを確認** — FAIL
- [ ] **Step 3: 上のルールを実装する**
- [ ] **Step 4: 通ることを確認** — `npx vitest run test/room/GameEngine.test.ts && npm run typecheck` → PASS
- [ ] **Step 5: Commit** — `feat(quiz): specialties gate buzzing and double off-specialty points`

---

### Task 4: 途中終了

**Files:**
- Modify: `src/room/GameEngine.ts`
- Test: `test/room/GameEngine.test.ts`

**Interfaces:**
- Produces: `finish(): LeaderboardEntry[]` — `question` / `questionResult` / `genreSelect` から `finalResult` へ。それ以外のフェーズでは `throw new Error("cannot finish in this phase")`。`buzzer = null`, `genrePick = null`, `deadlineAt = null`, `questionStartedAt = null`。スコアと `answers` は触らない

- [ ] **Step 1: 失敗するテストを書く**
```ts
it("finish() goes to finalResult from question, questionResult and genreSelect", …);
it("finish() keeps points already awarded (anagram mid-question)", …);
it("finish() throws in lobby, intro and finalResult", …);
it("a new game can start after finish()", …);     // phase finalResult → start OK
```
- [ ] **Step 2: 落ちることを確認** → **Step 3: 実装** → **Step 4: 通ることを確認**（`npx vitest run test/room/GameEngine.test.ts`）
- [ ] **Step 5: Commit** — `feat(quiz): GM can finish the game early`

---

### Task 5: メッセージと Room の配線

**Files:**
- Modify: `src/shared/messages.ts`, `src/room/Room.ts`
- Test: `test/shared/messages.test.ts`, `test/room/Room.test.ts`

**Interfaces:**
- Consumes: Task 2〜4 のエンジン API
- Produces（`messages.ts`）:
  ```ts
  // ClientMessage
  | { type: "chooseSpecialties"; genres: string[] }   // 参加者
  | { type: "pickGenre"; genre: string | null }       // 選ぶ人（文字列のみ）か GM（null = ランダム）
  | { type: "finish" }                                // GM: 途中終了して最終結果へ
  // ServerMessage
  | { type: "genreUpdated"; genres: GenreCount[] | null }            // ゲーム開始時（ジャンル制でなければ null）と、問題が開くたび
  | { type: "genreSelectStarted"; select: GenreSelectView }
  | { type: "specialtiesChosen"; participant: Participant }          // 全員へ
  // answerResult / someoneCorrect に追加
  multiplier?: number;
  // StateMessage に追加
  genres: GenreCount[] | null;
  genreSelect: GenreSelectView | null;
  ```
- `parseClientMessage`: `chooseSpecialties.genres` は長さ 0〜`SPECIALTY_COUNT` の文字列配列、`pickGenre.genre` は文字列か `null`。違えば `null`
- `CLIENT_TYPES` / `SERVER_TYPES` に追加

**Room の配線:**
- `chooseSpecialties`（参加者のみ。GM は `forbidden`）: 成功で `save` → `specialtiesChosen` を全員へ → `broadcastBuzzer()`（`sittingOut` が変わりうる）。拒否は `sendError`
- `pickGenre`: 参加者は `{ participantId }`、GM は `"gm"` で `engine.pickGenre`。成功で `next` の `question` と同じ配信（`broadcastQuestionStarted` → `settingsUpdated` → `broadcastBuzzer` → `armDeadline`）に `genreUpdated` を足す。この「問題が開いた後の配信」は `private async announceQuestion(): Promise<void>` にまとめ、`next` からも使う
- `pickGenre` と `chooseSpecialties` は `answer` / `buzz` と同じく、GM 専用チェックの前で処理する
- `next`: `genreSelect` が返ったら `genreSelectStarted` を全員へ。`scheduleCleanup`
- `start`: 既存の配信の後に `genreUpdated`（`engine.genres()`）を必ず送る。古いクライアントはこの未知の type で再読み込みされる
- `finish`（GM）: `question` / `questionResult` / `genreSelect` 以外は `invalid_state`。`engine.finish()` → `save` → `finalResult` を全員へ → `scheduleCleanup`
- `kick`: 呼ぶ前のフェーズが `genreSelect` で、後が `question` なら `announceQuestion()`
- `judge` 正解: `answerResult` と `someoneCorrect` に `multiplier`（2 のときだけ）
- `stateFor`: `genres: engine.genres()`, `genreSelect: engine.genreSelectView()`
- `errorText`: `genre_unavailable` →「そのジャンルは選べません」、`specialties_required` →「先に得意ジャンルを選んでください」、`sitting_out` →「次の問題から参加できます」、`specialties_already_set` →「得意ジャンルは変更できません」、`bad_specialties` →「得意ジャンルの選び方が正しくありません」
- `Room` は `GameEngine.create` / `fromSnapshot` に `rng` を渡さない（既定の `Math.random`）

- [ ] **Step 1: 失敗するテストを書く**

`test/shared/messages.test.ts`: 3 つの新しいクライアントメッセージの正常系と、`genres: "A"` / `genres: [1]` / `genres` 3 個 / `genre: 1` が `null` になること。新しいサーバー type が `isKnownServerMessage` を通ること。

`test/room/Room.test.ts` に `describe("Room DO genre mode")`（3 ジャンル × 2 問のセットを D1 に作る。ランダムなので、期待値は受け取った `question.genre` と `genres` から組み立てる）:
```ts
it("start broadcasts genreUpdated; question 1 carries genre, randomGenre and number 1", …);
it("players choose specialties, everyone gets specialtiesChosen, and state includes them", …);
it("a player without specialties gets specialties_required on buzz", …);
it("correct answer → next → genreSelectStarted; the picker's pickGenre opens that genre for everyone", …);
// questionStarted.genre === 選んだジャンル、genreUpdated の remaining が 1 減る
it("rejects pickGenre from a non-picker (forbidden) and a second pick (invalid_state)", …);
it("reconnecting during genreSelect restores picker and counts from state", …);
it("the GM picks on behalf, and null picks at random", …);
it("kicking the picker opens a random question", …);
it("a correct answer is doubled exactly when the question's genre is outside the answerer's specialties", …);
// 第 1 問のジャンルはランダムなので、受け取った question.genre が得意に含まれるかで期待値を分ける:
// 含まれない → someoneCorrect.multiplier === 2, points 200 / 含まれる → multiplier なし, points 100
it("finish from question goes to finalResult; players cannot finish", …);
it("starting a non-genre set broadcasts genreUpdated with null", …);
```

- [ ] **Step 2: 落ちることを確認** — `npx vitest run test/shared/messages.test.ts test/room/Room.test.ts` → FAIL
- [ ] **Step 3: `messages.ts` を実装する**
- [ ] **Step 4: `Room.ts` を配線する**
- [ ] **Step 5: 通ることを確認** — `npm test && npm run typecheck` → PASS
- [ ] **Step 6: Commit** — `feat(quiz): wire genre selection, specialties and finish through the room`

---

### Task 6: クライアントの状態

**Files:**
- Modify: `src/web/lib/clientState.ts`
- Test: `test/web/clientState.test.ts`

**Interfaces:**
- Produces（`ClientState` に追加）: `genres: GenreCount[] | null`、`genreSelect: GenreSelectView | null`。`popups` の要素に `multiplier?: number`

**reducer:**
- `state`: `genres` / `genreSelect` を取り込む
- `genreUpdated`: `genres` を置く
- `genreSelectStarted`: `phase = "genreSelect"`, `genreSelect` を置く。`question` / `questionResult` / `buzzer` / `lastAnswerResult` を消す
- `questionStarted` / `finalResult` / `introStarted`: `genreSelect = null`
- `specialtiesChosen`: `participants` を upsert。自分なら `me.specialties` も更新する
- `someoneCorrect`: `multiplier` をポップアップに運ぶ
- `participantJoined` などは `Participant` をそのまま持つので、`specialties` は自然に通る

- [ ] **Step 1: 失敗するテストを書く**（上の 6 項目それぞれ 1 件）
- [ ] **Step 2: 落ちることを確認** → **Step 3: 実装** → **Step 4: 通ることを確認**（`npx vitest run test/web/clientState.test.ts && npm run typecheck`）
- [ ] **Step 5: Commit** — `feat(web): client state for genre selection and specialties`

---

### Task 7: GM 画面

**Files:**
- Create: `src/web/components/GenreButtons.tsx`
- Modify: `src/web/gm/GmRoomPage.tsx`, `src/web/gm/BuzzerQuestion.tsx`, `src/web/gm/GmControlPanel.tsx`, `src/web/gm/CorrectPopup.tsx`, `src/web/components/Leaderboard.tsx`, `src/web/components/Slides.tsx`

**Interfaces:**
- Consumes: Task 6 の `ClientState`、Task 5 のメッセージ
- Produces:
  ```tsx
  /** ジャンルのボタン群。remaining が 0 のものと disabled のときは押せない */
  export function GenreButtons(props: {
    genres: GenreCount[];
    tone: "light" | "dark";
    selected?: string[];                    // 選択中（得意ジャンル選択用）
    marked?: string[];                      // 「得意」の印を付けるジャンル
    showRemaining?: boolean;                // 残り問題数を出す（既定 true）
    disabled?: boolean;
    onPick?: (genre: string) => void;
  }): JSX.Element;
  // Leaderboard に追加
  specialties?: Record<string, string[] | undefined>;   // 参加者 ID → 得意ジャンル。渡されたときだけ名前の下に出す
  showUnchosen?: boolean;                                // true なら未選択の人に「未選択」
  // TitleSlidePreview に追加
  genreCount?: number;
  ```

**画面（仕様の「GM 画面」）:**
- タイトルスライド: `genreCount` があればルール行を「早押し ・ ジャンル選択 ・ n ジャンル」にする（音声付きなら「 ・ 音声付き」を続ける）
- 右カラム: ジャンル制（`state.genres !== null`）のとき、参加者一覧と順位表の名前の下に得意ジャンルを「動物・天気」の形で小さく出す。未選択は「未選択」
- 出題中・問題結果: 問題カードの上部にジャンル名のチップ。`randomGenre` なら「ランダム」と添える。読み上げ待ち（`ready`）ではジャンル名を大きく出す
- 「第 n 問」は `q.number` を使う。「最終結果へ」の判定は `q.number >= q.total`
- `genreSelect`: 見出し「○○さんがジャンルを選んでいます」、`GenreButtons`（`tone="dark"`、押すと `pickGenre`）。フッターに「ランダムで決める」（`pickGenre` の `genre: null`）
- フッター: `question` / `questionResult` / `genreSelect` に「ここで終了」。`confirm("ここでゲームを終了して最終結果を表示しますか？")` の後に `finish`。「ロビーへ戻る」を `genreSelect` でも出す
- 正解ポップアップと問題結果の得点: `multiplier === 2` なら「×2」を添える
- 管理パネルの参加者一覧: 各自の得意ジャンル（未選択は「未選択」）。ジャンル制のときだけ

- [ ] **Step 1: `GenreButtons` と `Leaderboard` / `TitleSlidePreview` の追加 props を実装する**
- [ ] **Step 2: `GmRoomPage` ほかに上の画面を実装する**
- [ ] **Step 3: 型とテスト** — `npm run typecheck && npm test` → PASS
- [ ] **Step 4: ブラウザで確かめる** — `preview_start` で dev サーバーを起動（`.claude/launch.json`）。`/admin` で `question-sets/genre-sample.json` をインポートして保存し、ルームを作って別タブで参加者 2 人を入れ、次を見る: タイトルに「ジャンル選択 ・ 3 ジャンル」／第 1 問の読み上げ待ちにジャンル名と「ランダム」／正解後「次の問題へ」でジャンル選択画面／GM が押して出題／「ランダムで決める」／「ここで終了」で最終結果。集中モードと通常表示の両方でスクリーンショットを撮る（参加者側の操作は Task 8 まで `pickGenre` を GM から行う。得意ジャンルは未実装なので早押しは Task 8 の後に通しで確かめる）
- [ ] **Step 5: Commit** — `feat(gm): genre selection screen, genre chip, specialties and finish`

---

### Task 8: 参加者画面

**Files:**
- Create: `src/web/player/SpecialtyPicker.tsx`
- Modify: `src/web/player/PlayPage.tsx`, `src/web/player/BuzzerPanel.tsx`

**Interfaces:**
- Consumes: `GenreButtons`（Task 7）、Task 6 の `ClientState`
- Produces:
  ```tsx
  /** 得意ジャンルの選択。need 個そろうと「決定」が押せる */
  export function SpecialtyPicker(props: { genres: GenreCount[]; need: number; onDecide: (genres: string[]) => void }): JSX.Element;
  ```

**画面（仕様の「参加者画面」）:**
- 得意ジャンル選択: ジャンル制で `me.specialties` が無く、フェーズが `intro` / `question` / `questionResult` / `genreSelect` のとき、ほかの表示の代わりに出す。見出し「得意ジャンルを2つ選んでください」、補足「得意ジャンル以外で正解すると 2倍」。`need = min(SPECIALTY_COUNT, 残りのあるジャンルの数)`、`need` が 2 未満なら見出しの個数を合わせ、0 なら「決定」だけ出す。残り 0 のジャンルは押せない。残り問題数は出さない（`showRemaining={false}`）。3 つ目を押すと何も起きない。決定で `chooseSpecialties`
- 選択済みで `intro`: 「まもなく開始します」に自分の得意ジャンルを添える
- 出題中（早押し）: ジャンル名と、自分にとって「得意」か「2倍チャンス」かを出す。`buzzer.sittingOut` に自分が居れば、ボタンを無効にして「次の問題から参加できます」
- `genreSelect`（選ぶ人）: 「次のジャンルを選んでください」と `GenreButtons`（`marked` に自分の得意、押すと `pickGenre`）
- `genreSelect`（それ以外）: 「○○さんがジャンルを選んでいます」
- 問題結果: 加点に `lastAnswerResult.multiplier === 2` なら「×2」
- 主要操作は高さ 48px 以上

- [ ] **Step 1: `SpecialtyPicker` を実装する**
- [ ] **Step 2: `PlayPage` と `BuzzerPanel` に上の画面を実装する**
- [ ] **Step 3: 型とテスト** — `npm run typecheck && npm test` → PASS
- [ ] **Step 4: ブラウザで通しで確かめる** — GM 1 タブ＋参加者 2 タブ（`resize_window` の mobile）。得意を選ぶ → 早押し → 得意以外で正解して「×2」と 2 倍の点 → 正解者のスマホでジャンルを選ぶ → 尽きたジャンルが押せない → 出題中に入った 3 人目が得意を決めて「次の問題から参加できます」→ 次の問題で押せる → 全問で最終結果。GM と参加者のスクリーンショットを撮る
- [ ] **Step 5: Commit** — `feat(player): choose specialties and pick the next genre`

---

### Task 9: 管理画面（問題セット編集）

**Files:**
- Modify: `src/web/lib/editorChecks.ts`, `src/web/admin/SlideInspector.tsx`, `src/web/admin/QuestionSetEditPage.tsx`, `src/web/components/Slides.tsx`
- Test: `test/web/editorChecks.test.ts`

**Interfaces:**
- Consumes: `genresOf` / `genreCounts` / `MIN_GENRES` / `MAX_GENRE_LENGTH`
- `findProblem` の追加（`mode === "buzzer"` のとき、既存の検査の後）:
  - 一部の問題だけにジャンルがある → ジャンルの無い最初の問題を `slide` に、文言「第n問のジャンルを入力してください（ジャンルは全問に付けるか、どの問題にも付けません）」
  - 全問にあるが種類が 3 未満 → `slide: "title"`、文言「ジャンルは3種類以上にしてください」

**画面（仕様の「管理画面」）:**
- 早押しの問題スライドに「ジャンル」入力欄（`maxLength` 30、`<datalist>` で同じセットのジャンル名を候補に）。`QuestionInspector` に `genres: string[]` を渡す
- 左のサムネイルと `QuestionSlidePreview` にジャンル名を出す
- タイトルスライドの欄に「ジャンル: 動物 5 ／ 植物 5 ／ …」の一覧（早押しでジャンルが 1 つでもあるとき）
- アナグラムに切り替えたときは入力欄を出さない（保存時にサーバーが落とす）

- [ ] **Step 1: `findProblem` の失敗するテストを書く**（混在・3 種類未満・全問あり 3 種類で `null`・ジャンル無しで `null`）
- [ ] **Step 2: 落ちることを確認** → **Step 3: `findProblem` を実装** → **Step 4: 通ることを確認**
- [ ] **Step 5: 編集画面を実装する**
- [ ] **Step 6: ブラウザで確かめる** — `/admin` で `genre-sample.json` をインポートし、ジャンル欄・候補・サムネイル・タイトルの一覧を見る。1 問のジャンルを消して保存し、その問題に移動して文言が出ることを見る
- [ ] **Step 7: Commit** — `feat(admin): edit question genres`

---

### Task 10: 設計書の更新と片付け

**Files:**
- Modify: `docs/game-rules.md`, `docs/data-model.md`, `docs/protocol.md`, `docs/screens.md`, `docs/overview.md`（リポジトリ構成に新規ファイルが載る場合）
- Delete: `docs/superpowers/specs/2026-11-23-genre-select-buzzer-design.md`, `docs/superpowers/plans/2026-11-23-genre-select-buzzer.md`

`docs/AGENTS.md` の決まりに従う（現在形・経緯を書かない・関数一覧を書かない）。

- [ ] **Step 1: `game-rules.md`** — フェーズの並びに `genreSelect`、「早押しモード」の下に「ジャンル制」の節（ジャンルの決まり方・得意ジャンル・2 倍・自動締切の対象・選ぶ人のキックと切断）、「GM のゲーム中操作」に途中終了
- [ ] **Step 2: `data-model.md`** — `Question.genre`、`Participant.specialties`、`EngineState.asked / genrePick / randomGenre`、`BuzzerState.sittingOut`、`Answer.multiplier`、バリデーション、旧スナップショットの補完
- [ ] **Step 3: `protocol.md`** — 新しいメッセージ・エラーコード・`state` の項目、開始時の `genreUpdated` で古いクライアントが再読み込みされること
- [ ] **Step 4: `screens.md`** — GM（タイトル・右カラム・ジャンル選択・「ここで終了」）、参加者（得意ジャンル選択・ジャンル選択・見送り表示）、管理画面（ジャンル欄）、クライアント側の状態
- [ ] **Step 5: 仕様と計画のファイルを削除する**
- [ ] **Step 6: 最終確認** — `npm run typecheck && npm test && npm run build` → すべて PASS
- [ ] **Step 7: Commit** — `docs: genre selection buzzer`
