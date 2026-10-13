# 早押しモード 設計

## 目的

問題セット単位で「早押しモード」を選べるようにする。早押しモードでは、問題文が読み上げのように一文字ずつ GM 画面に表示され、参加者はスマホの早押しボタンを押して口頭で回答し、GM が正解・不正解を判定する。

- モードは問題セット全体で1つ。早押しモードのセットは全問が早押し
- 文字送りの位置はサーバーが決め、押された瞬間の位置はサーバー受信時刻で確定する。表示が止まる位置は全員で同じ
- 音声は今回は扱わない。表示の進み方を「区間の起点＋開始時刻×速度」でサーバーが持つので、後から音声（事前生成した音声ファイル）を同期して乗せられる
- 参加者のスマホには問題文を出さない。ボタン専用機として使う
- GM 画面に正解は出さない。GM は手元の資料で正解を把握している前提
- 不正解だった人はその問題では押せなくなる。減点は `wrongPenalty`
- 正解が出ないまま読み終えても自動では締め切らない。GM が「締切」を押すまで早押しを受け付ける。接続中の全員が押せなくなったら自動で締め切る
- 読み上げは問題を開いた直後には始めず、GM の「読み上げ開始」で始める

## 採用する方式

`question` フェーズの中に早押しの小さな状態（`BuzzerState`）を持たせる。フェーズの並び `lobby → intro → question → questionResult → … → finalResult` は変えない。正解・不正解は既存の `Answer` レコードに落とすので、順位表・問題結果・通算スコア・キック・ライブ設定など既存の仕組みがそのまま効く。

専用フェーズ（`reading` / `judging`）を増やす案は、`phase === "question"` を前提にした既存の判定（回答拒否・締切・キック時の自動締切・状態復元）をすべて直す必要があるため採らない。別エンジンに分ける案は、参加者・スコア・順位表・ライブ設定が二重になるため採らない。

## データモデル

### 問題セット

```ts
type QuestionSetMode = "anagram" | "buzzer";

interface QuestionSet {
  // ...既存
  mode?: QuestionSetMode;        // 省略時 "anagram"。buzzer なら全問が早押し
}

interface QuestionSettings {
  // ...既存 6 項目
  charsPerSecond: number;        // 文字送りの速さ（文字/秒）。既定 6。早押しモードでのみ使う
}
```

- `Question` は変えない。早押しでは `prompt` が読み上げる問題文、`answers` は GM の確認用（画面には出さない）、`hint` は使わない
- `DEFAULT_SETTINGS` に `charsPerSecond: 6` を加える。`resolveSettings` は既定値で補うので、旧データ（`charsPerSecond` なし）はそのまま動く
- 早押しで効く設定は `basePoints`・`wrongPenalty`・`charsPerSecond`。`timerMode` / `timerSeconds` / `rankBonus` / `maxAttempts` は保存されるが効かない
- JSON インポート／エクスポートに `mode` と `charsPerSecond` を含める。`QuestionSetSummary` は変えない

### バリデーション

`validateQuestionSetInput` に追加する。

- `mode` は省略可。指定するなら `"anagram"` か `"buzzer"`。`"anagram"` は保存時に省略する
- `settings.charsPerSecond` と `overrides.charsPerSecond` は 1 以上 30 以下の整数
- `mode: "buzzer"` のとき、各問題の `prompt` は必須（画像だけの問題は拒否する）。エラーは `questions[i].prompt is required`
- `updateSettings`（ライブ設定）の `charsPerSecond` も 1〜30 の整数

### ルーム状態

```ts
interface BuzzerState {
  status: "ready" | "reading" | "paused";
  readingStartedAt: number | null;  // reading のとき、今の区間を読み始めたサーバー時刻 (UNIX ms)
  revealedChars: number;            // 区間の起点。止めたときまでに表示済みの文字数
  queue: string[];                  // 早押しキュー（参加者 ID、サーバー受信順）。先頭が回答中
  lockedOut: string[];              // この問題で不正解になり、押せなくなった参加者 ID
}

interface EngineState {
  // ...既存
  buzzer: BuzzerState | null;       // 早押しモードで出題中（question）のときだけ持つ
}
```

- 文字数はコードポイント単位（`Array.from(prompt).length`）。サロゲートペアを途中で切らない
- 時刻 `t` の表示済み文字数は `revealedChars(view, t)` で求める（`src/shared/buzzer.ts`、サーバーとクライアントで共用）
  - `reading`: `min(promptLength, revealedChars + floor((t − readingStartedAt) × charsPerSecond / 1000))`
  - `ready` / `paused`: `revealedChars`
- 正解・不正解は `Answer` に `text: ""` で記録する。正解は `correct: true, correctRank: 1, points: basePoints`。不正解は `correct: false, correctRank: null, points: −wrongPenalty`（ペナルティ 0 なら 0）
- `closeQuestion` と `endGame` で `buzzer` を `null` にする
- 旧スナップショットには `buzzer` が無いので `fromSnapshot` で `null` を補う

## ゲームのルール（GameEngine）

早押しモードかどうかは `questionSet.mode === "buzzer"` で判断する。

| 操作 | 動作 |
|---|---|
| `openQuestion` | 早押しモードなら `buzzer = { status: "ready", readingStartedAt: null, revealedChars: 0, queue: [], lockedOut: [] }`、`deadlineAt = null`（`timerMode` は見ない） |
| `startReading(now)` | `ready` → `reading`、`readingStartedAt = now`。出題中かつ早押しモードかつ `ready` 以外は `invalid_state` |
| `buzz(pid, now)` | 出題中かつ早押しモード以外は `not_in_question`。`ready` なら `not_reading`。`lockedOut` に居れば `locked_out`。`queue` に居れば `already_buzzed`。それ以外は `queue` の末尾に追加する。`reading` だったら `revealedChars = revealedChars(now)`、`readingStartedAt = null`、`status = "paused"` にする（`paused` 中の追加は位置を変えない） |
| `judge(correct, now)` | `paused` かつ `queue` が空でないときだけ。それ以外は `invalid_state`。回答者は `queue[0]`。正解: `basePoints` を加点し `Answer` を記録して `closeQuestion(now)`。不正解: `wrongPenalty` を減点し `Answer` を記録、`queue` から外して `lockedOut` に加える。`queue` が残っていれば `paused` のまま（次の人が回答中）。空なら `status = "reading"`、`readingStartedAt = now` で続きから再開する（すでに全文表示済みでも同じ。式が上限で止まる） |
| `rebaseReading(now)` | `reading` 中なら `revealedChars = revealedChars(now)`、`readingStartedAt = now`。`updateSettings` の直前に呼び、`charsPerSecond` を変えても表示済みの位置が飛ばないようにする |
| `submitAnswer`（文字回答） | 早押しモードでは `not_in_question` で拒否 |
| `closeQuestion` | 既存どおり。`buzzer = null` |
| `removeParticipant`（キック） | `queue` と `lockedOut` から外す。回答中（`queue[0]`）だった人を外した場合は不正解と同じ進め方（次の人へ、居なければ再開）。ただし減点も `Answer` の記録もしない |
| `allParticipantsDone` | 早押しモードでは「接続中の参加者が1名以上居て、全員が `lockedOut` に居て、`queue` が空」のとき true |
| `reconcileDeadline` | 早押しモードでは何もしない（締切は常に `null`） |
| `myStatus` | 既存どおり `Answer` から求める。早押しでは不正解1回で `attemptsUsed: 1` |
| `currentQuestionView(role)` | 早押しモードで `role: "player"` なら `prompt: ""`、`hint: undefined` にする。問題文は GM にだけ届く |
| `buzzerView()` | 出題中の早押し状態を参加者名付きで返す（下記 `BuzzerView`）。それ以外は `null` |

切断は何も変えない。回答中の人が切断しても GM の判定で進める。

## プロトコル

### クライアント → サーバー（追加）

| type | 送信者 | payload | 内容 |
|---|---|---|---|
| `startReading` | GM | なし | 読み上げ開始。`question` かつ早押しモードかつ `ready` のときだけ |
| `buzz` | 参加者 | なし | 早押し |
| `judge` | GM | `{ participantId, correct: boolean }` | 回答中の参加者を判定。`participantId` が回答中の人（キューの先頭）と違えば `invalid_state`。ボタンの二度押しで次の人まで判定されないため |

### サーバー → クライアント（追加）

| type | 宛先 | payload | 内容 |
|---|---|---|---|
| `buzzerUpdated` | 全員 | `{ buzzer: BuzzerView }` | 早押し状態の変化。`startReading`・`buzz`・`judge`（不正解）・キューに居た人のキック・`charsPerSecond` の変更で送る。出題（`questionStarted`）の直後にも送る |

```ts
interface BuzzerView {
  status: "ready" | "reading" | "paused";
  readingStartedAt: number | null;
  revealedChars: number;
  promptLength: number;                                  // 参加者は本文を受け取らないので長さだけ
  charsPerSecond: number;                                // 今効いている速さ
  queue: { participantId: string; nickname: string }[];  // 先頭が回答中
  lockedOut: string[];
}

interface StateMessage {
  // ...既存
  buzzer: BuzzerView | null;        // 早押しモードで出題中のみ
}

interface QuestionView {
  // ...既存
  mode: QuestionSetMode;            // 画面の出し分けに使う
}

// タイトルスライドにもモードを載せる
type IntroSlideView =
  | { kind: "title"; name: string; coverImageUrl?: string; questionCount: number; settings: QuestionSettings; mode: QuestionSetMode }
  | { kind: "slide"; ... };
```

- 早押しモードの `questionStarted` は GM と参加者で中身が違う（参加者は `prompt: ""`）。Room は接続ごとの役割を見て送り分ける
- `judge` 正解: 回答者本人に `answerResult { correct: true, correctRank: 1, remainingAttempts: null, points }`、全員に `someoneCorrect`、続けて既存の締切処理（`questionClosed`・`leaderboard`）
- `judge` 不正解: 回答者本人に `answerResult { correct: false, correctRank: null, remainingAttempts: 0, points }`、全員に `buzzerUpdated` と `leaderboard`。全員が押せなくなったら締切処理
- `buzz` が受理されたことは `buzzerUpdated` の `queue` で本人も知る。拒否は `error`
- `updateSettings` は早押しモードでは `reconcileDeadline` の代わりに `rebaseReading` を呼び、`charsPerSecond` が変わったら `buzzerUpdated` を送る

### エラーコード（追加）

| code | 状況 | 文言 |
|---|---|---|
| `not_reading` | 読み上げ開始前の早押し | まだ読み上げが始まっていません |
| `locked_out` | 不正解後の早押し | この問題はもう押せません |
| `already_buzzed` | キューに居る人の再押し | すでに押しています |

### Alarm

早押しモードの出題中は締切が無いので、`question` でも 24 時間後の `cleanup` を設定する（`armDeadline(null)` と同じ）。

## GM 画面（早押しモードの出題中）

問題カードの中身を早押し用に差し替える。ヘッダー・右カラム（順位表）・管理パネル・集中モードは共通。

- 上段: 「第n問 / 全m問」と状態（「読み上げ待ち」「読み上げ中」「回答中」「読み上げ終了・早押し待ち」）。残り時間は出さない
- 中央: 問題画像（あれば）と問題文。全文を描画しておき、未表示の文字は透明にする（レイアウトが動かない）。表示済み文字数は `revealedChars(view, 補正済みの今)` を 100ms ごとに計算する。改行は保つ。文字サイズは問題文の長さに応じて下げる（40 文字以下 5xl、100 文字以下 4xl、それ以上 3xl 程度）
- `paused` のとき、問題文の下に「○○さん 回答中」を大きく出し、2番目以降がいれば「次: △△ → □□」を添える
- 正解判定後は既存の正解ポップアップ・紙吹雪・問題結果（正解候補と正解者 1 名）をそのまま出す。問題結果では問題文を全文表示する
- フッターの操作
  - `ready`: 「読み上げ開始」（ブランド色、Play）、「締切」、「ロビーへ戻る」
  - `reading`: 「締切」、「ロビーへ戻る」
  - `paused`: 「正解」（緑、Check）「不正解」（赤、X）、「締切」、「ロビーへ戻る」
- 管理パネルの設定: 「読み上げ速度（文字/秒）」を追加する。効いている設定が早押しモードのときは制限時間・お手付き上限・正解順ボーナスの欄を出さない

タイトルスライドのルール表示は、早押しモードでは「全n問 ・ 早押し ・ 6文字/秒」とする（制限時間・お手付き上限は出さない）。問題スライドのプレビューでは残り時間のバッジを出さない。

## 参加者画面（早押しモードの出題中）

問題文・ヒント・残り時間・回答入力・残り回答回数は出さない。画面のほとんどを早押しボタンにする。

- 早押しボタン: 画面幅いっぱいの円形に近い大きなボタン（ブランドグラデーション、「早押し！」）。押せるときだけ有効。押下で `buzz` を送り、受理されたら可能なら `navigator.vibrate(50)`
- 状態ごとの表示（ボタンの上下に短い文言）

| 状態 | 表示 | ボタン |
|---|---|---|
| `ready` | 「読み上げを待っています」 | 無効 |
| `reading`、押せる | 「第n問」 | 有効 |
| `paused`、自分が `queue[0]` | 「あなたの番！ 口頭で答えてください」（ブランド色で大きく） | 隠す |
| `paused`、自分が `queue` の k 番目（k ≥ 2） | 「k番目に押しました。○○さんの回答を待っています」 | 隠す |
| `paused`、キューに居ない、押せる | 「○○さんが回答中。押すと次の順番に並びます」 | 有効 |
| `lockedOut` | 「不正解… この問題はもう押せません」（赤） | 無効 |
| 正解（`me.status.correct`） | 既存の「正解！ +n点」パネル | 隠す |

- 不正解の判定を受けたら既存の揺れ（`qj-shake`）を使う
- 問題結果・最終結果・待機の画面は共通

## 編集画面

- タイトルスライドに「出題形式」（アナグラム／早押し）のセレクトを追加する。早押しのときは共通設定の制限時間・お手付き上限・正解順ボーナスを隠し、「読み上げ速度（文字/秒）」を出す
- 問題スライド（早押し）: 正解候補は共通。「出題文」は「問題文（読み上げる文章）」として複数行のテキストエリアにし、「生成」ボタンとヒント欄を出さない。問題画像・解説画像は共通。「この問題だけの設定」は基本点と読み上げ速度だけ
- 保存前チェック（`findProblem`）: 早押しでは問題文が空なら「第n問の問題文を入力してください」
- 問題スライドのプレビュー（`QuestionSlidePreview`）: 早押しでは残り時間のバッジを出さず、問題文は改行を保って左寄せ・長さに応じた文字サイズで描く
- 形式を切り替えてもデータは消さない（隠れるだけ）

## クライアント側の状態

- `ClientState` に `buzzer: BuzzerView | null` を追加する。`state` と `buzzerUpdated` で置き、`questionStarted`・`questionClosed`・`introStarted`・`finalResult` で `null` にする
- 表示済み文字数はクライアントが `revealedChars(buzzer, Date.now() + clockOffsetMs)` で計算する。サーバーからの `buzzerUpdated` が来れば `revealedChars` / `readingStartedAt` が置き換わるので、押した位置で揃う

## テスト

- `shared/buzzer`: `revealedChars` の式（`reading` の進み、`paused` の固定、上限、コードポイント数）
- `GameEngine`
  - 早押しセットの `openQuestion` で `buzzer` が `ready`、`timerMode: fixed` でも `deadlineAt` が `null`
  - `startReading` 前の `buzz` は `not_reading`。`startReading` は `ready` 以外で失敗
  - 2 人が押したとき、1 人目の受信時刻で `revealedChars` が確定し、2 人目は位置を変えずキューの末尾に入る
  - `judge(true)` で `basePoints` が入り、`questionResult` に正解者 1 名（`correctRank: 1`）
  - `judge(false)` で `wrongPenalty` を減点し、`lockedOut` に入り、次の人が回答中になる。キューが空なら `reading` に戻り `readingStartedAt` が `now`
  - `lockedOut` の `buzz` は `locked_out`、キュー内の再押しは `already_buzzed`
  - 接続中の全員が `lockedOut` でキューが空なら `allParticipantsDone`
  - 回答中の人をキックすると次の人へ、居なければ再開。減点しない
  - `rebaseReading` で `charsPerSecond` を変えても表示済み文字数が連続する
  - 早押しモードの `submitAnswer` は `not_in_question`
  - 参加者向け `currentQuestionView` は `prompt: ""`
  - `buzzer` の無い旧スナップショットを復元できる
- `messages`: `startReading` / `buzz` / `judge` の解釈、`judge` の `correct` / `participantId` 欠落は拒否、ライブ設定の `charsPerSecond`
- `validateQuestionSet`: `mode` の値、`charsPerSecond` の範囲、早押しで問題文必須
- `clientState`: `buzzerUpdated` の反映、`questionStarted` / `questionClosed` でのクリア
- `Room`（統合）: GM の `startReading` → 参加者の `buzz` → 全員に `buzzerUpdated` → GM の `judge(true)` → `answerResult`・`someoneCorrect`・`questionClosed`。参加者が受け取る `questionStarted` の `prompt` が空。不正解の `judge` を同じ `participantId` で二度送ると 2 回目は `invalid_state` で、次の人は減点されない
- `editorChecks`: 早押しで問題文が空なら該当スライドを指す

## 設計書への反映

実装完了時に次を更新し、この spec を削除する: `overview.md`（問題形式・スコープ・テスト優先ケース）、`game-rules.md`（早押しモードの節）、`data-model.md`、`protocol.md`、`screens.md`、`design-guide.md`（早押しボタン）、`README.md`（E2E チェックリスト）。
