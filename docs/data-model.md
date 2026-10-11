# データモデル

型定義は `src/shared/types.ts` に置き、サーバーとフロントで共用する。

## 保存先

| データ | 保存先 | 理由 |
|---|---|---|
| 問題セット（永続） | D1 `quizjam-db` | ルームをまたいで再利用する |
| 問題・表紙の画像 | R2 `quizjam-images` | D1 の行サイズ制限を避け、長期キャッシュで配信する |
| ルーム進行状態（参加者・現在の問題・回答・スコア・ライブ設定） | ルームの Durable Object 内 SQLite | 1ルーム1オブジェクトで強い整合性。再起動後も復元できる |
| GM トークン・参加者トークン（ブラウザ側） | localStorage | リロード・再接続時に同じ GM／参加者として復帰する |

## 問題セット

```ts
interface QuestionSet {
  id: string;
  name: string;                // 企画名（タイトルスライドに表示）
  coverImageUrl?: string;      // 表紙画像
  slideBackground?: string;    // 問題スライドの背景色（#rrggbb）。画像の地の色に合わせる用途
  introSlides?: IntroSlide[];  // 説明スライド。省略時は無し。20枚まで
  settings: QuestionSettings;
  questions: Question[];
}

/** ゲーム冒頭、タイトルの後に映す説明スライド */
interface IntroSlide {
  id: string;
  heading?: string;            // 100文字まで
  body?: string;               // 複数行可。1000文字まで
  imageUrl?: string;
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
  prompt: string;              // 表示する問題文。画像に文字が描かれている場合は空にできる
  answers: string[];           // 正解候補（複数可）
  hint?: string;
  imageUrl?: string;           // 問題画像。GM・参加者画面で出題文の上に表示
  overrides?: Partial<QuestionSettings>;
}

/** GM がゲーム中に上書きできる設定 */
type LiveSettings = QuestionSettings;
```

JSON インポート／エクスポートは `QuestionSet` から `id` を除いた形式（`QuestionSetInput`）を使う。

### バリデーション

API 受信時とインポート時に同じ検証を適用する。

- `name` は必須（前後空白を除いて1文字以上）
- `settings` は省略可。指定したキーだけ検証し、残りは既定値で補う。`timerMode` は3モードのいずれか、`timerSeconds` は 0 以上、`maxAttempts` は `null` か 1 以上
- `coverImageUrl` / `imageUrl` は `/api/images/<key>` か `https://` で始まる 500 文字以内の URL
- `slideBackground` は `#rrggbb`
- `introSlides` は省略可。20件まで。各要素は `heading`（100文字以内）・`body`（1000文字以内）・`imageUrl` のいずれか1つが必須。空文字は無指定として扱う。空なら保存時に省略する
- `introSlides[].id` が無ければサーバーが UUID を採番する
- `questions[].answers` は空でない文字列の配列（1件以上）
- `questions[].prompt` は `imageUrl` があれば空にできる。画像も出題文もない問題は拒否する
- `questions[].id` が無ければサーバーが UUID を採番する

### D1 スキーマ

```sql
CREATE TABLE question_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,            -- QuestionSet 全体の JSON（id を含む）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

一覧は `updated_at` の降順で返し、各行から `QuestionSetSummary`（id・名前・表紙 URL・問題数・更新時刻）を作る。

### 画像

- 受け付ける形式は PNG / JPEG / WebP / GIF、5MB まで。キーは `<uuid>.<拡張子>`。
- キーは内容ごとに一意なので、配信時は `Cache-Control: public, max-age=31536000, immutable` を付ける。
- ブラウザはアップロード前に長辺 1600px に縮小する。PNG は透過を保つため PNG のまま、GIF はアニメーションを保つためそのまま、それ以外は JPEG（品質 0.88）にする。縮小不要かつ 1.5MB 未満ならそのまま送る。

## ルーム状態（Durable Object 内）

```ts
interface EngineState {
  roomCode: string;            // 6文字。紛らわしい文字（0/O/1/I）を除いた英大文字と数字
  phase: "lobby" | "intro" | "question" | "questionResult" | "finalResult";
  questionSet: QuestionSet | null;   // 開始時に D1 から読み込んだコピー
  currentIndex: number;
  introIndex: number;          // intro 中のスライド。0 がタイトル、1..n が introSlides[n-1]
  carryOverScores: boolean;
  questionStartedAt: number | null;
  deadlineAt: number | null;   // 締切時刻 (UNIX ms)。afterFirstCorrect では最初の正解時に設定
  participants: Record<string, Participant>;
  answers: Answer[];
  settingsOverride: Partial<LiveSettings>;   // GM のライブ設定。ゲームをまたいで保持
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
  submittedAt: number;         // サーバー受信時刻 (UNIX ms)
  correctRank: number | null;  // 正解者の何番目か
  points?: number;             // 回答時に実際に加減した点数。設定をゲーム中に変えても結果表示を変えない
}
```

Durable Object の SQLite には次を保存する。

| テーブル | 内容 |
|---|---|
| `kv` | `snapshot`（`EngineState` の JSON）、`gmToken`、`alarmKind`（`deadline` か `cleanup`） |
| `tokens` | 参加者トークン → 参加者 ID |

状態を変更するたびにスナップショットを書き戻し、オブジェクト起動時に復元する。
