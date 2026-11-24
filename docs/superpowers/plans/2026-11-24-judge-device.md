# 早押しの判定用端末 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GM が手元のスマホを使い捨て QR で「判定用端末」としてつなぎ、早押しの出題中に答え・別解・判定メモ・回答中の人を見ながら正解・不正解を押せるようにする。

**Architecture:** WebSocket の接続に 3 つ目の役割 `judge` を足す。Room DO が使い捨てのペアリングコードと判定用トークン（ルームに 1 つ）を持ち、`judge` の接続にだけ `JudgeView`（答え・判定メモなど）を送る。Web は `/judge/:code` に判定用画面を足し、GM の管理パネルに QR と接続状態を出す。問題には任意の `judgeNote` を足す。

**Tech Stack:** Cloudflare Workers + Durable Objects（hibernation WebSocket, SQLite kv）、Hono、React 19 + react-router、Tailwind v4、qrcode.react、vitest（`@cloudflare/vitest-pool-workers`）

**Spec:** `docs/superpowers/specs/2026-11-24-judge-device-design.md`

## Global Constraints

- 答え・判定メモは `judge` の接続にだけ送る。GM・参加者の `state`／`questionStarted` には載せない（GM の `QuestionView` にも足さない）
- `judge` が送れるのは `judge` メッセージだけ。他はすべて `forbidden`（`pickGenre` も）
- 判定用トークンはルームに 1 つ。新しいトークンを発行した時（QR が読み取られた時）に前のトークンを無効にし、つながっている `role:judge` のソケットを閉じる。QR を出しただけでは切らない
- ペアリングコードは 1 回だけ使える。有効期限は発行から 5 分。新しく発行すると前のコードは捨てる
- QR の URL は `/judge/:roomCode#pair=<コード>`（コードはフラグメント）
- `judgeNote` は前後の空白を除いて 1〜500 文字、複数行可。早押しでだけ使う
- 守る範囲は画面と WebSocket の通信まで。`GET /api/question-sets/:id` は変えない
- ユーザー向けの文言は日本語。ドキュメント（`docs/*.md`）は各タスクで一緒に直す

## Review Focus

1. 判定用端末から `pickGenre` を送る → 今のコードは `attachment.participantId` を読むので undefined で動いてしまう。`forbidden` を返すこと（Task 4 のテスト）
2. 同じ QR を 2 台目が読み取る／期限切れの QR を読み取る → 403、1 台目はつながったまま（Task 4）
3. 判定用端末が切られた後に再読み込みする → 401 で再接続を繰り返すだけにならず、「QR を読み取り直してください」と出る（Task 6）
4. GM が再読み込み・再接続する → `state` で判定端末の接続状態を受け取り直す（Task 4）
5. アナグラムのセット、または出題中でないフェーズ → 判定用端末の `judge` は `null`、答えを先出ししない（Task 3・4）

---

### Task 1: 問題の判定メモ（`judgeNote`）

**Files:**
- Modify: `src/shared/types.ts`（`Question` に `judgeNote?: string`）
- Modify: `src/shared/validateQuestionSet.ts`（genre と同じく `optionalText(qq.judgeNote, MAX_JUDGE_NOTE_LENGTH)`。複数行を許す）
- Modify: `src/web/admin/SlideInspector.tsx`（`QuestionInspector` に、`mode === "buzzer"` のときだけ複数行の「判定メモ」欄。ヒント文「GM の判定用端末にだけ出ます」）
- Modify: `docs/data-model.md`、`docs/screens.md`（管理画面の問題スライドの項）
- Test: `test/shared/validateQuestionSet.test.ts`

**Interfaces:**
- Produces: `Question.judgeNote?: string`、`export const MAX_JUDGE_NOTE_LENGTH = 500`（`src/shared/validateQuestionSet.ts` か `types.ts` のどちらか既存の定数の置き場に合わせる）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it("accepts a trimmed multi-line judgeNote and rejects one over 500 chars", () => {
  const ok = validateQuestionSet(buzzerSet({ judgeNote: "  8000点は不正解\n満貫と答えたら聞き直す  " }));
  expect(ok.value!.questions[0].judgeNote).toBe("8000点は不正解\n満貫と答えたら聞き直す");
  expect(validateQuestionSet(buzzerSet({ judgeNote: "あ".repeat(501) })).error).toBe("questions[0].judgeNote invalid");
  expect(validateQuestionSet(buzzerSet({ judgeNote: "   " })).value!.questions[0].judgeNote).toBeUndefined();
});
```
（`buzzerSet` はファイル内の既存ヘルパーに合わせる。無ければ 1 問の早押しセットを返す小さな関数を足す）

- [ ] **Step 2:** `npx vitest run test/shared/validateQuestionSet.test.ts` → FAIL
- [ ] **Step 3:** 型・検証・管理画面の欄を実装する。`optionalText` が改行を潰すなら、改行を残す版を使う
- [ ] **Step 4:** 同じテスト → PASS。`npm run typecheck` も通す
- [ ] **Step 5:** コミット `feat(quiz): judge note on buzzer questions`

### Task 2: プロトコル（型とメッセージ）

**Files:**
- Modify: `src/shared/messages.ts`
- Modify: `docs/protocol.md`
- Test: `test/shared/messages.test.ts`

**Interfaces:**
- Produces:
  - `export type Role = "gm" | "judge" | "player"`。`StateMessage.role: Role`
  - `export interface JudgeView { questionNumber: number; total: number; genre?: string; prompt: string; answers: string[]; judgeNote?: string; revealAtMs?: number[] }`
  - `StateMessage` に `judge: JudgeView | null`（`judge` の接続にだけ中身を入れ、他は `null`）と `judgeConnected: boolean`（GM にだけ意味がある。他は `false`）
  - クライアント → サーバー: `{ type: "issueJudgePairing" }`（GM のみ）。`CLIENT_TYPES` に足す
  - サーバー → クライアント（`SERVER_TYPES` に足す）:
    - `{ type: "judgePairing"; url: string; expiresAt: number }`（GM にだけ）
    - `{ type: "judgeStatus"; connected: boolean }`（GM にだけ）
    - `{ type: "judgeInfo"; judge: JudgeView | null }`（`judge` にだけ）
    - `{ type: "judgeRevoked" }`（切られる判定用端末にだけ。送ってから close）

- [ ] **Step 1: 失敗するテストを書く** — `parseClientMessage('{"type":"issueJudgePairing"}')` が `{ type: "issueJudgePairing" }` を返す。`isKnownServerMessage` が `judgePairing`・`judgeStatus`・`judgeInfo`・`judgeRevoked` で `true`
- [ ] **Step 2:** `npx vitest run test/shared/messages.test.ts` → FAIL
- [ ] **Step 3:** 型とセットを足す。`docs/protocol.md` に役割 `judge`、`POST /api/rooms/:code/judge-pair`（Task 4）、上の各メッセージを書く
- [ ] **Step 4:** テスト → PASS（`npm run typecheck` は Task 3・4 で `state` を作る側を直すまで落ちてよい。落ちる箇所が `judge`/`judgeConnected` の欠けだけであることを確かめる）
- [ ] **Step 5:** コミット `feat(room): judge role protocol types`

### Task 3: GameEngine の判定情報

**Files:**
- Modify: `src/room/GameEngine.ts`
- Test: `test/room/GameEngine.test.ts`

**Interfaces:**
- Consumes: `JudgeView`（Task 2）、`Question.judgeNote`（Task 1）
- Produces:
  - `judgeView(): JudgeView | null` — 早押しで `phase === "question"` のときだけ今の問題から作る（`questionNumber` は `QuestionView.number` と同じ値、`revealAtMs` は `q.audio?.revealAtMs`）。それ以外は `null`
  - `currentQuestionView(role: Role = "gm")` — `judge` は `player` と同じく問題文・ヒント・音声を隠す

- [ ] **Step 1: 失敗するテストを書く**

```ts
it("judgeView carries answers and judgeNote only while a buzzer question is open", () => {
  // 早押しセット（answers ["富士山","ふじさん"], judgeNote "山だけは不正解", audio 付き）で開始し第1問まで進める
  expect(engine.judgeView()).toEqual({ questionNumber: 1, total: 2, prompt: PROMPT, answers: ["富士山", "ふじさん"], judgeNote: "山だけは不正解", revealAtMs: REVEAL });
  expect(engine.currentQuestionView("judge")!.prompt).toBe("");
  expect(engine.currentQuestionView("judge")!.audio).toBeUndefined();
  engine.closeQuestion(now);
  expect(engine.judgeView()).toBeNull();
});
it("judgeView is null for anagram sets", () => { /* アナグラムで出題中 → null */ });
```

- [ ] **Step 2:** `npx vitest run test/room/GameEngine.test.ts` → FAIL
- [ ] **Step 3:** 実装する
- [ ] **Step 4:** テスト → PASS
- [ ] **Step 5:** コミット `feat(room): judge view in the game engine`

### Task 4: Room のペアリング・判定用接続・送り分け

**Files:**
- Modify: `src/room/Room.ts`
- Modify: `src/worker/routes/rooms.ts`（`POST /api/rooms/:code/judge-pair` を DO の `/judge-pair` へ転送。join と同じ形）
- Modify: `docs/game-rules.md`（早押しモードに判定用端末の節）
- Test: `test/room/Room.test.ts`（新しい `describe("Room DO judge device")`。既存の buzzer `setup` を流用）、`test/worker/rooms.test.ts`（転送の 1 本）

**Interfaces:**
- Consumes: Task 2 の型、Task 3 の `judgeView()`
- Produces:
  - `type Attachment = { role: "gm" } | { role: "judge" } | { role: "player"; participantId: string }`、タグ `role:judge`
  - kv: `judgeToken`、`judgePair`（`JSON { code, expiresAt }`）。コード・トークンは `randomToken()`（64 hex）
  - DO `POST /judge-pair` 本文 `{ pairCode }` → 200 `{ judgeToken }`／403 `{ error: "pair_invalid" }`／404（ルームなし）
  - `issueJudgePairing` → GM に `judgePairing { url: "/judge/<roomCode>#pair=<code>", expiresAt: now + 5 * 60_000 }`（url はパスだけ。オリジンは GM 画面が付ける）

振る舞い:
- `resolveToken`: GM トークン → 判定用トークン → 参加者の順
- ペアリング成功時: コードを消し、新トークンを保存し、既存の `role:judge` ソケットに `judgeRevoked` を送って close(4001)。GM に `judgePairing` の取り消しは要らない（GM 画面は `judgeStatus` で QR を閉じる）
- `judge` の接続・切断時: GM に `judgeStatus { connected }`（`role:judge` のソケットが残っているか）
- `stateFor`: `judge: att.role === "judge" ? engine.judgeView() : null`、`judgeConnected: role:judge のソケット数 > 0`、`me` は player のときだけ
- `announceQuestion` と `closeQuestion` 後と `start`・`finish`・`endGame` 後に、`role:judge` へ `judgeInfo { judge: engine.judgeView() }`
- `dispatch`: `answer`・`buzz`・`chooseSpecialties` の既存の player 判定はそのまま。`pickGenre` は `judge` なら `forbidden`。`judge` メッセージは `gm` と `judge` の両方を受け付け、他の GM 操作は `gm` だけ
- cleanup のアラームで `judgeToken` もメモリから消す

- [ ] **Step 1: 失敗するテストを書く**（`it` 名と要点）
  - `"pairs once: the QR code yields a judge token, a second use is 403"` — GM が `issueJudgePairing` → `judgePairing` の url からコードを取り `/judge-pair` に POST → 200 と `judgeToken`。同じコードでもう一度 → 403
  - `"an expired pairing code is 403"` — `vi.useFakeTimers` が DO で効かなければ、kv の `judgePair.expiresAt` を過去にして確かめる手段（DO の内部 fetch `/test-expire` は作らない。`runInDurableObject` で `ctx.storage.sql` を書き換える）
  - `"the judge sees answers and judgeNote; GM and players never do"` — 早押しセット（`judgeNote` 付き）で第1問へ。判定用ソケットの `judgeInfo.judge.answers` が `["富士山"]`、`judgeNote` が入る。GM・参加者が受け取ったすべてのメッセージの JSON に `"富士山"` と判定メモが含まれない（`questionClosed` は除く）
  - `"the judge can judge the answerer but nothing else"` — `buzz` 後に判定用端末が `judge` → 参加者に `answerResult`。`startReading`・`next`・`pickGenre`・`adjustScore` → それぞれ `forbidden`
  - `"pairing a new device revokes the old one"` — 2 回目のペアリング成功で旧ソケットに `judgeRevoked`、旧トークンで接続 → 401
  - `"GM gets judgeStatus and judgeConnected in state"` — 判定用端末の接続で GM に `judgeStatus { connected: true }`、切断で `false`。GM が再接続すると `state.judgeConnected` が今の値
  - `"judgeInfo is null outside a buzzer question"` — 結果フェーズで `judgeInfo.judge === null`、判定用端末の再接続の `state.judge === null`
  - `rooms.test.ts`: `"forwards judge-pair to the room"` — 存在しないコードで 403、無いルームで 404
- [ ] **Step 2:** `npx vitest run test/room/Room.test.ts test/worker/rooms.test.ts` → FAIL
- [ ] **Step 3:** 実装する
- [ ] **Step 4:** テスト → PASS、`npm test` 全体と `npm run typecheck` → PASS
- [ ] **Step 5:** コミット `feat(room): judge device pairing and judge-only answers`

### Task 5: クライアントの状態とトークン保存

**Files:**
- Modify: `src/web/lib/clientState.ts`、`src/web/lib/storage.ts`、`src/web/lib/api.ts`
- Test: `test/web/clientState.test.ts`

**Interfaces:**
- Consumes: Task 2 の型
- Produces:
  - `ClientState.role: Role | null`、`ClientState.judge: JudgeView | null`、`ClientState.judgeConnected: boolean`、`ClientState.judgePairing: { url: string; expiresAt: number } | null`、`ClientState.judgeRevoked: boolean`
  - reducer: `state` で `judge`・`judgeConnected` を置く。`judgeInfo` → `judge`。`judgeStatus` → `judgeConnected`、`connected: true` なら `judgePairing` を消す。`judgePairing` → 置く。`judgeRevoked` → `judgeRevoked: true`
  - `storage.getJudgeToken(code)` / `setJudgeToken(code, token | null)`（キー `judge:<code>`）
  - `api.judgePair(code: string, pairCode: string): Promise<{ judgeToken: string }>`（403 は既存の `call` のエラーとして投げる）

- [ ] **Step 1: 失敗するテストを書く** — `judgeStatus { connected: true }` で `judgeConnected` が true になり `judgePairing` が null に。`judgeInfo` で `judge` が置き換わる。`judgeRevoked` で `judgeRevoked` が true
- [ ] **Step 2:** `npx vitest run test/web/clientState.test.ts` → FAIL
- [ ] **Step 3:** 実装する
- [ ] **Step 4:** テスト → PASS
- [ ] **Step 5:** コミット `feat(web): judge state in the client reducer`

### Task 6: 判定用画面 `/judge/:code`

**Files:**
- Create: `src/web/judge/JudgePage.tsx`
- Modify: `src/web/main.tsx`（ルート `{ path: "/judge/:code", element: <JudgePage /> }`）
- Modify: `docs/screens.md`（ルート表と「判定用画面」の節）

**Interfaces:**
- Consumes: `useRoomSocket(code, token)`、`api.judgePair`、`storage.get/setJudgeToken`、`revealedCount`（`src/shared/buzzer.ts`）または `useRevealedCount`、ClientState（Task 5）

振る舞い（スマホ縦。見た目は `docs/design-guide.md` に合わせる）:
- 開いたとき URL に `#pair=` があれば `api.judgePair` → トークンを保存 → `history.replaceState` でフラグメントを消す。403 なら「この QR はもう使えません。GM 画面で出し直してください」
- フラグメントもトークンも無ければ同じ文言で案内
- `judgeRevoked` を受けたらトークンを消し「別の端末が判定用につながりました」
- 未接続が 5 秒続いたら「つながらない場合は GM 画面の QR を読み取り直してください」（Review Focus 3）
- 出題中（`judge` が非 null）: 第n問／全m問・ジャンル、答え（1 つ目を大きく、別解は小さく）、判定メモ（改行を保つ）、問題文（`prompt` が空なら出さない。読まれた所まで濃く）、回答中の人と「次: …」、画面下に大きな「正解」「不正解」（間を空ける）
- 「正解」「不正解」は `buzzer.status === "paused"` かつ待ち行列があるときだけ押せる。送るのは `{ type: "judge", participantId: queue[0].participantId, correct }`
- 出題中でない: 「次の問題を待っています」。アナグラムのセット（`settings.mode === "anagram"`）: 「このセットは自動判定です」
- 音は鳴らさない

- [ ] **Step 1:** 実装する
- [ ] **Step 2:** `npm run typecheck` と `npm test` → PASS
- [ ] **Step 3:** コミット `feat(web): judge page for the GM's phone`

### Task 7: GM 画面の QR と接続表示

**Files:**
- Modify: `src/web/gm/GmControlPanel.tsx`（「判定用スマホをつなぐ」ボタン。早押しのセットを読み込んでいるときだけ）
- Create: `src/web/gm/JudgePairingModal.tsx`（QR モーダル。`state.judgePairing` があるあいだ表示。`expiresAt` を過ぎるか `judgeConnected` になったら閉じる。手で閉じられる）
- Modify: `src/web/gm/GmRoomPage.tsx`（早押しの出題画面の隅に「判定端末: 接続中／未接続」の小さな表示）
- Modify: `docs/screens.md`（GM 画面・管理パネルの項）

**Interfaces:**
- Consumes: `send({ type: "issueJudgePairing" })`、`state.judgePairing`、`state.judgeConnected`（Task 5）。QR の値は `location.origin + judgePairing.url`

- [ ] **Step 1:** 実装する
- [ ] **Step 2:** `npm run typecheck` と `npm test` → PASS
- [ ] **Step 3:** コミット `feat(web): pair the judge phone from the GM panel`

### Task 8: 通しの確認

- [ ] **Step 1:** `npm run dev` を preview で起動し、GM 画面でルームを作り、早押しのセット（`judgeNote` を 1 問に入れたもの）で開始する
- [ ] **Step 2:** 別タブを判定用端末に見立てて QR の URL を開く → GM 画面の QR が閉じ「接続中」になる。同じ URL を 3 つ目のタブで開く → 「この QR はもう使えません」
- [ ] **Step 3:** 参加者タブで早押し → 判定用タブで「不正解」→ 次の人 →「正解」。GM 画面の表示・効果音（`AudioBufferSourceNode.prototype.start` の差し替えで回数を確かめる）が今までどおり
- [ ] **Step 4:** GM と参加者のタブの WebSocket の受信に答え・判定メモが出題中に含まれないことを `read_network_requests` か受信ログで確かめる
- [ ] **Step 5:** 判定用タブを mobile 幅（375px）で見て、ボタンが押しやすく横スクロールが出ないこと
