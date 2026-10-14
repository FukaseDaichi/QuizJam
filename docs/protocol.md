# 通信プロトコル

入室・ルーム作成・問題セット CRUD・画像は HTTP JSON API。WebSocket はゲーム進行の双方向通信に限定する。
メッセージ型は `src/shared/messages.ts` に置き、サーバーとフロントで共用する。

## HTTP API

| メソッド・パス | 認証 | 内容 |
|---|---|---|
| `GET /api/health` | なし | 死活確認 |
| `POST /api/admin/verify` | 管理者 | 合言葉の検証。管理画面のログインに使う |
| `GET /api/question-sets` | なし | 問題セット一覧（`QuestionSetSummary[]`） |
| `GET /api/question-sets/:id` | なし | 問題セット取得 |
| `POST /api/question-sets` | 管理者 | 作成。本文は `QuestionSetInput` |
| `PUT /api/question-sets/:id` | 管理者 | 更新 |
| `DELETE /api/question-sets/:id` | 管理者 | 削除 |
| `POST /api/images` | 管理者 | 画像アップロード。本文は画像バイナリ、`Content-Type` で形式を判定。`{ key, url }` を返す |
| `GET /api/images/:key` | なし | 画像配信（長期キャッシュ） |
| `DELETE /api/images/:key` | 管理者 | 画像削除 |
| `POST /api/rooms` | なし | ルーム作成。`{ roomCode, gmToken }` を返す。コード衝突時は再試行する |
| `GET /api/rooms/:code` | なし | ルームの存在確認（404 なら無い） |
| `POST /api/rooms/:code/join` | なし | 入室。`{ nickname }` を送り `{ participantId, participantToken, roomCode }` を返す |
| `GET /ws/room/:code?token=…` | GM／参加者トークン | WebSocket 接続 |

管理者認証は `Authorization: Bearer <ADMIN_PASSPHRASE>`。失敗は 401。
ルーム関連は Worker が該当ルームの Durable Object（ルームコードから `idFromName`）へ転送する。

## WebSocket

- 接続先: `wss://<host>/ws/room/<roomCode>?token=<gmToken | participantToken>`
- Durable Object がトークンを検証し、GM か参加者かを接続に紐付ける。無効なら 401。
- Durable Object は WebSocket Hibernation API を使い、メッセージがない間はスリープする。
- 接続直後にサーバーが `state` を送り、クライアントはそれで画面を復元する。
- 参加者が接続すると `connected: true` になり、同じ参加者のソケットがすべて閉じると `connected: false` になる。

## メッセージ形式

全メッセージは `{ type: string, ...payload }` の JSON。

### クライアント → サーバー

| type | 送信者 | payload | 内容 |
|---|---|---|---|
| `answer` | 参加者 | `{ text }` | 回答送信 |
| `start` | GM | `{ questionSetId, carryOverScores }` | ゲーム開始。`lobby` か `finalResult` のときのみ |
| `close` | GM | なし | 現在の問題を手動締切 |
| `next` | GM | なし | 次へ。`intro` 中は次の説明スライドか第1問へ、`questionResult` 中は次の問題か最終結果へ |
| `endGame` | GM | なし | ルームをロビーに戻す |
| `updateSettings` | GM | `{ settings: Partial<LiveSettings> }` | ライブ設定の上書き全体。送った内容で置き換え、`{}` で解除。`timerMode` は3モードのいずれか、`timerSeconds` は正の整数、`maxAttempts` は正の整数か `null`、`basePoints` / `wrongPenalty` は 0 以上の整数、`rankBonus` は 0 以上の整数の配列（20個まで）、`charsPerSecond` は 1〜30 の整数。出題中なら締切を合わせ直し、変われば `deadlineSet` を送る。早押しの読み上げ中なら区間の起点を取り直してから適用し、`buzzerUpdated` を送る |
| `adjustScore` | GM | `{ participantId, delta }` | 参加者の点数を加減 |
| `kick` | GM | `{ participantId }` | 参加者を退出させる |
| `startReading` | GM | なし | 早押しの読み上げ（文字送り）開始。`question` かつ早押しモードかつ `ready` のときだけ |
| `buzz` | 参加者 | なし | 早押し。受理は `buzzerUpdated` の `queue` で分かる |
| `judge` | GM | `{ participantId, correct: boolean }` | 回答中の参加者を判定。`participantId` が回答中の人（キューの先頭）と違えば `invalid_state`（ボタンの二度押しで次の人まで判定されないため） |

参加者からの GM 操作、GM からの `answer` は `forbidden` エラーになる。

### サーバー → クライアント

| type | 宛先 | payload | 内容 |
|---|---|---|---|
| `state` | 接続者本人（`endGame` 時は全員） | 下記 | 現在の全状態。接続・再接続時に送る |
| `participantJoined` | 全員 | `{ participant }` | 入室または再接続 |
| `participantLeft` | 全員 | `{ participant }` | 切断（`connected: false`） |
| `participantRemoved` | 全員 | `{ participant }` | キックで削除 |
| `kicked` | キックされた本人 | なし | 直後にサーバーがソケットを閉じる（code 4000） |
| `settingsUpdated` | 全員 | `{ settings: SettingsView }` | ライブ設定の変更。出題のたび（`start` / `next`）にも送り、実際に効く設定を知らせる |
| `introStarted` | 全員 | `{ intro: IntroView }` | タイトル・説明スライドの表示。`start` と `intro` 中の `next` で送る |
| `questionStarted` | 全員 | `{ question: QuestionView }` | 出題。早押しモードでは参加者向けの `prompt` は空、`hint` は無し（問題文は GM にだけ届く） |
| `buzzerUpdated` | 全員 | `{ buzzer: BuzzerView }` | 早押し状態の変化。出題直後・`startReading`・`buzz`・`judge`（不正解）・キューに居た人のキック・`updateSettings` で送る |
| `deadlineSet` | 全員 | `{ deadlineAt }` | 締切時刻が決まった・消えたとき（正解者トリガー、ライブ設定のタイマー変更）。`null` は締切なし |
| `answerResult` | 回答者本人 | `{ correct, correctRank, remainingAttempts, points }` | 回答判定結果。正解時の `remainingAttempts` は `null` |
| `someoneCorrect` | 全員 | `{ participantId, nickname, correctRank, points }` | GM 画面のポップアップ用 |
| `leaderboard` | 全員 | `{ entries: LeaderboardEntry[] }` | 入室・回答・スコア調整・キック・締切のたびに送る |
| `questionClosed` | 全員 | `{ result: QuestionResultView }` | 問題終了。正解候補・解説画像（あれば）・正解者一覧（正解順） |
| `finalResult` | 全員 | `{ entries }` | 最終順位表 |
| `error` | 本人 | `{ code, message }` | 拒否理由。`message` は日本語の表示用文言 |

```ts
interface StateMessage {
  type: "state";
  role: "gm" | "player";
  serverTime: number;              // クライアントの時計補正に使う
  roomCode: string;
  phase: Phase;
  participants: Participant[];
  leaderboard: LeaderboardEntry[];
  intro: IntroView | null;               // タイトル・説明スライド表示中のみ
  question: QuestionView | null;         // 出題中・結果表示中のみ
  questionResult: QuestionResultView | null;   // 結果表示中のみ
  me: (Participant & { status: MyAnswerStatus | null }) | null;   // 参加者のみ
  questionSetName: string | null;
  correctCount: number;            // 現在の問題の正解者数
  settings: SettingsView;          // GM の上書きと、実際に効く設定。mode に出題形式（未読込なら null）
  buzzer: BuzzerView | null;       // 早押しモードで出題中のみ
}

interface QuestionView {
  index: number; total: number;
  mode: "anagram" | "buzzer";      // 画面の出し分け
  prompt: string; hint?: string; imageUrl?: string;
  background?: string;             // 問題セットの slideBackground
  deadlineAt: number | null;
  maxAttempts: number | null;
}

interface QuestionResultView {
  answers: string[];
  explanationImageUrl?: string;    // 問題の解説画像。出題中の QuestionView には含めない
  results: { participantId: string; nickname: string; correctRank: number; points: number }[];
}

interface IntroView {
  index: number;                   // 0 がタイトル
  total: number;                   // 1 + introSlides.length
  slide:
    | { kind: "title"; name: string; coverImageUrl?: string; questionCount: number; settings: QuestionSettings; mode: "anagram" | "buzzer" }
    | { kind: "slide"; heading?: string; body?: string; imageUrl?: string };
}

/** 早押しモードの出題中の状態。表示済み文字数はクライアントも revealedCount()（shared/buzzer.ts）で求める */
interface BuzzerView {
  status: "ready" | "reading" | "paused";
  readingStartedAt: number | null;
  revealedChars: number;
  promptLength: number;                                  // 参加者は本文を受け取らないので長さだけ
  charsPerSecond: number;                                // 今効いている速さ
  queue: { participantId: string; nickname: string }[];  // 先頭が回答中
  lockedOut: string[];
}
```

早押しの判定結果は `judge` を受けたサーバーが配る。正解なら回答者本人に `answerResult`（`correctRank: 1`）、全員に `someoneCorrect`、続けて `questionClosed` と `leaderboard`。不正解なら本人に `answerResult`（`remainingAttempts: 0`）、全員に `buzzerUpdated` と `leaderboard`。

タイトルの `settings` は第1問に実際に効く設定（GM のライブ上書きを含む）。

### エラーコード

| code | 状況 |
|---|---|
| `not_in_question` | 出題中以外の回答 |
| `deadline_passed` | 締切後の回答 |
| `already_correct` | 正解済みの再回答 |
| `no_attempts_left` | お手付き上限到達 |
| `forbidden` | 権限のない操作 |
| `invalid_state` | そのフェーズで行えない GM 操作（タイトル・説明スライド表示中の `close` など）、または内部エラー |
| `question_set_not_found` | 開始時に問題セットが無い、または問題が0件 |
| `participant_not_found` | スコア調整・キックの対象が居ない |
| `bad_message` | JSON として解釈できない、または未知の type・不正な payload |
| `not_reading` | 読み上げ開始前の早押し |
| `locked_out` | 不正解後の早押し |
| `already_buzzed` | キューに居る人の再押し |

## タイマー

- サーバーが締切時刻 `deadlineAt`（UNIX ms）を配信し、クライアントは `state` の `serverTime` との差で自分の時計を補正して残り秒数（切り上げ）を描画する。
- 締切の確定はサーバー側で行う。Durable Object の Alarm で `deadlineAt` に起床し `questionClosed` を送る。クライアントの 0 秒表示は表示用にすぎない。
- Alarm は1つしか持てないため、`alarmKind` で用途を区別する。締切待ちのときは `deadline`、それ以外（ロビー・タイトル・説明スライド表示中・結果表示・締切なしの出題中・早押しモードの出題中・最終結果）は24時間後の `cleanup` を設定する。
- `cleanup` の Alarm が発火すると全接続を閉じ、ストレージをすべて削除する。

## 再接続

- クライアントは切断を検知したら指数バックオフ（0.5秒から倍々、最大10秒）で再接続する。タブが再び表示されたときは即座に再接続する。
- サーバーが `state` を返すためクライアント側の差分管理は不要。
- GM のブラウザが切断してもゲームは止めない。タイマーはサーバーで動き続け、再接続すれば `state` で復元する。
- Durable Object が再起動しても状態は SQLite に保存済みで、接続者が再接続すれば継続する。

## エラー処理

| 状況 | 対応 |
|---|---|
| 存在しないルームコード・無効トークン | HTTP 404/401。画面に「ルームが見つかりません」 |
| 締切後・お手付き上限超過の回答 | `error` を本人に返し、スコアは変更しない |
| GM 以外からの GM 操作 | `forbidden` を返す |
| 不正な JSON・未知の type | `bad_message` を返し、接続は維持する |
| クライアントが知らない type のメッセージ | デプロイ前から開いていた古いビルドなので、ページを再読み込みして新しいビルドを取得する。reducer は未知のメッセージで状態を壊さない |
| 画面の描画中の例外 | 「画面の表示に失敗しました」と再読み込みボタンを出す。進行状況はサーバーにあるので再読み込みで復帰する |
| GM 操作中の例外 | `invalid_state` を返し、ログに出力する |
