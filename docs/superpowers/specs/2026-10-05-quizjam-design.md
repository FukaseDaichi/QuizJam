# QuizJam（リアルタイムクイズシステム）設計書

- 作成日: 2026-10-05
- ステータス: 承認済み（実装計画の作成前）
- 関連文書: [QuizJam デザインガイド](../../design-guide.md)（画面実装時の色・角丸・タイポグラフィ・アイコンの共通ルール）

## 1. 概要

QuizJam は、GM（ゲームマスター）がPCで進行し、参加者がスマートフォンで回答するリアルタイムクイズシステム。
参加者はQRコードを読み取ってルームに入室し、画面に表示された問題にフリーテキストで回答する。
正解が出るとGM画面にポップアップが表示され、順位表は常時更新される。

### 1.1 前提条件

| 項目 | 内容 |
|---|---|
| 同時参加者数 | 1ルームあたり最大10名程度（GM1名＋参加者） |
| 参加形態 | 常にオンライン。会場参加・遠隔参加の区別なし |
| ホスティング | Cloudflare 無料プラン（Workers / Durable Objects / D1） |
| 開発言語 | TypeScript（サーバー・フロント・共有コード） |
| 最初の問題形式 | アナグラム（日本語フリーテキスト回答） |
| 参加者識別 | ニックネームのみ。ログイン不要。スコアは1ルーム内で完結 |

### 1.2 スコープ外

- アナグラム以外の問題形式（型のみ拡張可能にしておく）
- 複数GMの同時操作
- 参加者のアカウント登録、ゲーム履歴の永続保存
- チーム対抗
- 独自ドメイン
- オフライン（会場Wi-Fiのみ）運用

## 2. ゲームルール

### 2.1 ゲームの流れ

1. GMがPCでルームを作成し、問題セット（1ゲーム分、約20問）を選ぶ。ルームコードとQRコードが表示される。
2. 参加者はQRを読み取り、ニックネームを入力して待機画面へ。GM画面の参加者一覧がリアルタイムに更新される。
3. GMが「開始」を押すと1問目が全員の画面に表示される。
4. 参加者が回答を送信する。
   - 正解: GM画面に「〇〇さんが正解しました！」のポップアップ。本人には「正解！（n番目）」。
   - 不正解: 本人に「不正解（残りn回）」。
5. 制限時間終了、全員が正解またはお手付き上限到達、またはGMの手動締切で問題終了。正解と現在の順位を全員に表示する。
6. GMが「次へ」で次の問題へ。最終問題の後に最終結果（順位表）を表示する。
7. GMは同じルームで続けて別の問題セットを開始できる。開始時にスコアを「通算する」か「リセットする」かを選ぶ。

### 2.2 制限時間

問題セット単位で設定し、問題ごとに上書きできる。

| モード | 動作 |
|---|---|
| `fixed`（固定カウントダウン） | 出題と同時にn秒のカウントダウンを開始し、0秒で締切 |
| `afterFirstCorrect`（正解者トリガー） | 出題時は無制限。最初の正解者が出た瞬間にm秒のカウントダウンを開始 |
| `none`（なし） | GMが手動で「締切」を押すまで受付 |

いずれのモードでもGMは手動で締切できる。

### 2.3 スコア

- 正解1問につき基本点（既定100点。問題セットで変更可）。
- 正解順ボーナス（任意）: 既定は1位+50、2位+30、3位+10。空にするとボーナスなし。
- 不正解ペナルティ: 既定0。設定で減点可。

### 2.4 お手付き（不正解回数の上限）

- 問題セット単位で「1問あたり最大n回まで回答可」を設定。既定3回。`null`で無制限。
- 上限到達でその問題は回答不可となり、本人画面に表示する。
- 正解後はその問題に再回答できない。

### 2.5 日本語フリーテキスト回答の判定

- 問題ごとに正解候補を複数登録できる（例: 「りんご」「リンゴ」「林檎」）。
- 判定前に以下を正規化する:
  - 前後の空白を除去
  - 全角・半角を統一（英数字・記号は半角、カナは全角）
  - カタカナをひらがなに変換
  - 濁点・半濁点の結合文字を合成済み文字に統一（Unicode NFKC）
  - 長音記号「ー」「－」「-」を統一
- 正規化後に正解候補のいずれかと完全一致すれば正解。正解候補側も同じ正規化を適用する。
- アナグラム問題では `prompt` にシャッフル済み文字列、`answers` に元の言葉を登録する。

### 2.6 接続断への対処

参加者のスマートフォンがスリープ等で切断しても、同じブラウザで再接続すればニックネームとスコアを引き継ぐ。
端末に発行した参加者トークンで識別する。

## 3. 画面構成

### 3.1 GM画面（PC・横画面。プロジェクター投影を想定）

| 画面 | 内容 |
|---|---|
| トップ | 「新しいルームを作る」ボタン。問題セット一覧（編集・追加へのリンク） |
| 問題セット編集 | セット名、制限時間モード、基本点、お手付き上限などの設定。問題の一覧と追加・編集・削除・並べ替え。アナグラム文字列の自動生成補助。JSONインポート／エクスポート |
| ルーム待機 | 大きなQRコードと参加URL・ルームコード。参加者一覧（リアルタイム更新）。問題セット選択と「スコアを通算する／リセットする」の切替。「開始」ボタン |
| 出題中 | 問題文（大きく表示）、残り時間、正解者数／回答者数。右側に順位表（常時表示）。正解者ポップアップ。「締切」「次へ」ボタン |
| 問題結果 | 正解の表示、この問題の正解者と正解順。「次へ」ボタン |
| 最終結果 | 1〜3位を強調した順位表。「もう1ゲーム」「ルームを閉じる」 |

### 3.2 参加者画面（スマートフォン・縦画面）

| 画面 | 内容 |
|---|---|
| 入室 | QRから開く。ニックネーム入力→「参加」 |
| 待機 | 「まもなく開始します」、参加者数 |
| 出題中 | 問題文、残り時間、回答入力欄と送信ボタン、残りお手付き回数、自分の現在順位と点数 |
| 回答結果 | 「正解！（n番目）」または「不正解（残りn回）」をその場に表示。正解後は入力欄を閉じる |
| 問題結果 | 正解、自分の順位と点数、上位3名 |
| 最終結果 | 全体順位と自分の順位 |

### 3.3 共通

- 画面の配色・角丸・タイポグラフィ・アイコン・演出は [QuizJam デザインガイド](../../design-guide.md) に従う。GM画面はダーク系＋「ヘッダー／メイン＋ランキング／操作ボタン」の3段構成、参加者画面は白基調で主要操作を48px以上にする。

- 接続が切れたら上部に「再接続中…」バナーを表示し、自動再接続する。
- GM画面と参加者画面は1つのReact SPAとし、ルート（`/gm/...` と `/play/...`）で出し分ける。

### 3.4 認証

| 対象 | 方式 |
|---|---|
| 問題セット管理画面 | 環境変数（Wrangler secret）で設定したパスフレーズでログイン |
| GMのルーム操作 | ルーム作成時に発行するGMトークン。ブラウザに保存し、WebSocket接続とGM操作に必須 |
| 参加者 | 入室時に発行する参加者トークン。ブラウザに保存し、再接続時の識別に使用 |

## 4. データモデル

### 4.1 保存先

| データ | 保存先 | 理由 |
|---|---|---|
| 問題セット（永続） | D1（SQLite） | ルームをまたいで再利用する |
| ルーム進行状態（参加者・現在の問題・回答・スコア） | ルームの Durable Object 内 SQLite ストレージ | 1ルーム1オブジェクトで強い整合性。再起動後も復元可能 |

### 4.2 問題セット

```ts
interface QuestionSet {
  id: string;
  name: string;
  settings: QuestionSettings;
  questions: Question[];
}

interface QuestionSettings {
  timerMode: "fixed" | "afterFirstCorrect" | "none";
  timerSeconds: number;        // fixed: 制限秒数 / afterFirstCorrect: 最初の正解後の猶予秒数
  basePoints: number;          // 既定 100
  rankBonus: number[];         // 既定 [50, 30, 10]。空配列でボーナスなし
  wrongPenalty: number;        // 既定 0
  maxAttempts: number | null;  // 既定 3。null で無制限
}

interface Question {
  id: string;
  type: "anagram";             // 将来 "choice" などを追加
  prompt: string;              // 表示する問題文（アナグラムならシャッフル済み文字列）
  answers: string[];           // 正解候補（複数可）
  hint?: string;
  overrides?: Partial<QuestionSettings>;
}
```

JSONインポート／エクスポートはこの `QuestionSet` と同じ形式を使う。

### 4.3 ルーム状態（Durable Object 内）

```ts
interface RoomState {
  roomCode: string;            // 6桁英数
  phase: "lobby" | "question" | "questionResult" | "finalResult";
  questionSetId: string | null;
  currentIndex: number;
  carryOverScores: boolean;    // 通算モード
  questionStartedAt: number | null;
  deadlineAt: number | null;   // 締切時刻(UNIX ms)。afterFirstCorrect では最初の正解時に設定
}

interface Participant {
  id: string;                  // 参加者トークンと紐付く
  nickname: string;
  score: number;
  connected: boolean;
}

interface Answer {
  questionIndex: number;
  participantId: string;
  text: string;                // 正規化前の原文
  correct: boolean;
  submittedAt: number;         // サーバー受信時刻(UNIX ms)
  correctRank: number | null;  // 正解者の何番目か
}
```

### 4.4 判定に関する決定事項

- 回答の到着順は Durable Object が単一スレッドで処理するため、`submittedAt` はサーバー受信時刻を使い、クライアントの時計に依存しない。
- 締切後に届いた回答は「時間切れ」として拒否する。
- ニックネームの重複は許容し、GM画面では同名の後ろに番号を付けて区別する。

## 5. 通信プロトコル

### 5.1 接続

- 参加者: `wss://<host>/ws/room/<roomCode>?token=<participantToken>`
- GM: `wss://<host>/ws/room/<roomCode>?token=<gmToken>`
- Worker がトークンを検証し、該当ルームの Durable Object に接続を転送する。
- Durable Object は WebSocket Hibernation API を使い、メッセージがない間はスリープする。
- 入室（ニックネーム登録）、ルーム作成、問題セットCRUDは HTTP JSON API。WebSocket はゲーム進行の双方向通信に限定する。

### 5.2 メッセージ形式

全メッセージは `{ type: string, ...payload }` のJSON。型定義は `src/shared/` に置きサーバーとフロントで共用する。

#### クライアント → サーバー

| type | 送信者 | payload | 内容 |
|---|---|---|---|
| `answer` | 参加者 | `{ text }` | 回答送信 |
| `start` | GM | `{ questionSetId, carryOverScores }` | ゲーム開始 |
| `close` | GM | なし | 現在の問題を手動締切 |
| `next` | GM | なし | 次の問題へ。最終問題なら最終結果へ |
| `endGame` | GM | なし | ルームをロビーに戻す |

#### サーバー → クライアント

| type | 宛先 | payload | 内容 |
|---|---|---|---|
| `state` | 接続者本人 | 現在の全状態 | 接続・再接続時に送信。phase、問題、順位表、自分の回答状況を含み、画面を復元する |
| `participantJoined` / `participantLeft` | 全員 | `{ participant }` | 参加者一覧の更新 |
| `questionStarted` | 全員 | `{ index, total, prompt, deadlineAt, maxAttempts }` | 出題 |
| `deadlineSet` | 全員 | `{ deadlineAt }` | 正解者トリガーで締切時刻が決まったとき |
| `answerResult` | 回答者本人 | `{ correct, correctRank, remainingAttempts, points }` | 回答判定結果 |
| `someoneCorrect` | 全員 | `{ nickname, correctRank }` | GM画面ポップアップ用 |
| `leaderboard` | 全員 | `{ entries: [{ participantId, nickname, score, rank }] }` | スコア変動のたびに送信 |
| `questionClosed` | 全員 | `{ answers, results: [{ nickname, correctRank, points }] }` | 問題終了 |
| `finalResult` | 全員 | `{ entries }` | 最終順位表 |
| `error` | 本人 | `{ code, message }` | 例: 締切後の回答、お手付き上限 |

### 5.3 タイマー

- サーバーが締切時刻 `deadlineAt`（UNIX ms）を配信し、各クライアントは接続時にサーバー時刻との差を補正して残り時間を描画する。
- 締切の確定処理はサーバー側で行う。Durable Object の Alarm で `deadlineAt` に起床し `questionClosed` を送る。クライアント側の0秒表示は表示用にすぎない。

### 5.4 再接続

クライアントは切断を検知したら指数バックオフで再接続する。サーバーが `state` を返すためクライアント側の差分管理は不要。

## 6. インフラ構成と技術スタック

### 6.1 構成

```
参加者スマホ / GM PC（ブラウザ）
        │ HTTPS / WSS
        ▼
Cloudflare Workers（1つのWorker）
  ├─ Static Assets: フロントエンド（GM画面・参加者画面）を配信
  ├─ HTTP API: 入室、ルーム作成、問題セットCRUD、GM認証
  └─ /ws/room/:code → Durable Object「Room」へ転送
            │
            ├─ Durable Object: Room（ルームごとに1つ、SQLiteストレージ）
            │     GameEngine を保持、WebSocket Hibernation、Alarm でタイマー
            └─ D1: 問題セットの永続化
```

### 6.2 技術スタック

| 層 | 採用 | 理由 |
|---|---|---|
| ランタイム | Cloudflare Workers + Durable Objects (SQLite) + D1 | 無料枠、サーバー管理不要 |
| サーバーフレームワーク | Hono | Workers向けに軽量。ルーティングと型付きAPIが簡潔 |
| フロントエンド | React + Vite | GM画面と参加者画面を1つのSPAで、ルートで出し分け |
| スタイル | Tailwind CSS + Noto Sans JP | スマホ縦・プロジェクター横の両対応。配色・角丸・文字サイズはデザインガイドに従う |
| アイコン | lucide-react | デザインガイドで第一候補に指定。絵文字をUIアイコンに使わない |
| 共有コード | `src/shared/` | メッセージ型、QuestionSet型、回答正規化をサーバーとフロントで共用 |
| ビルド・デプロイ | Wrangler | `wrangler dev` でローカル開発、`wrangler deploy` で本番 |
| QRコード | `qrcode` | GM画面でクライアント側生成 |

### 6.3 リポジトリ構成

```
quiz/
  src/
    worker/      Worker本体（Hono ルーティング、認証、D1アクセス）
    room/        Durable Object Room と GameEngine（純粋ロジック）
    shared/      型定義・回答正規化・定数
    web/         React SPA（gm/ と player/ の画面）
  test/          GameEngine 単体テスト、Worker 統合テスト
  wrangler.jsonc
  package.json
```

### 6.4 設計方針: GameEngine の分離

ゲーム進行ロジック（出題・判定・制限時間・お手付き・スコア・順位）は通信層やストレージから切り離した純粋なTypeScriptモジュール `GameEngine` として実装する。
Durable Object はメッセージの受け渡しと永続化のみを担当し、ルールは GameEngine に集約する。
これにより単体テストでルールを網羅でき、将来のランタイム変更にも中核を保てる。

### 6.5 無料枠の見積もり（10名・1ゲーム20問）

| 項目 | 1ゲームあたり概算 | 無料枠（日） |
|---|---|---|
| Durable Object リクエスト（接続11回＋受信メッセージ約300通÷20） | 約30 | 100,000 |
| Worker リクエスト（静的配信・API） | 約200 | 100,000 |
| D1 読み書き | 数十行 | 読み500万行・書き10万行 |

1日に数十ゲーム行っても無料枠内に収まる。
Durable Objects は無料プランでは SQLite ストレージバックエンドのみ利用可能なため、Room は SQLite バックエンドで作成する。

### 6.6 運用

- URL は `https://<プロジェクト名>.<アカウント名>.workers.dev` を使用する。
- 問題セット管理画面のパスフレーズは Wrangler の secret として登録する。
- 終了したルームは Durable Object の Alarm で24時間後に自動削除する。
- 監視は Cloudflare ダッシュボードの Workers Logs を使う。

## 7. テスト方針

| 層 | 対象 | ツール |
|---|---|---|
| 単体 | GameEngine、回答正規化 | Vitest。時刻は注入して決定的にテスト |
| 統合 | Worker の HTTP API、Durable Object との WebSocket やり取り | `@cloudflare/vitest-pool-workers` |
| 手動E2E | GM画面とスマホ画面を実機で通しプレイ | デプロイ後にチェックリストで確認 |

優先して固めるケース:

- 正解順ボーナスの付与順序（サーバー受信順）
- `afterFirstCorrect` で最初の正解時のみ締切が設定されること
- お手付き上限到達後の回答拒否、正解後の再回答拒否
- 締切後の回答拒否
- 通算モードとリセットモードでのスコア引き継ぎ
- 全角／半角・カタカナ／ひらがなの正規化一致

## 8. エラー処理

| 状況 | 対応 |
|---|---|
| 存在しないルームコード・無効トークン | HTTP 404/401。画面に「ルームが見つかりません」 |
| 締切後・お手付き上限超過の回答 | `error` を本人に返し、スコアは変更しない |
| GM以外からのGM操作 | 無視して `error` を返す |
| 不正なJSON・未知の type | 無視してログ出力。接続は維持 |
| Durable Object の再起動 | 状態は SQLite に保存済み。接続者が再接続すれば継続 |
| GMのブラウザ切断 | ゲームは止めない。GMが再接続すれば `state` で復元。タイマーはサーバーで動き続ける |
