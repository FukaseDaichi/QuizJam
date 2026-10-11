# ゲーム冒頭のタイトル・説明スライド 設計

## 目的

GM が「開始する」を押したとき、いきなり第1問ではなく、まずタイトルスライドを映し、続けてルール説明などの説明スライド（0枚以上）を映してから第1問に入れるようにする。

- タイトルスライドは必ず表示する（問題セットごとに省略できない）
- 説明スライドは問題セットごとに任意枚数。中身は見出し・本文・画像の組み合わせ
- 説明スライドを挟めるのはゲーム冒頭だけ。問題と問題の間には挟まない
- 参加者のスマホには映さない。待機表示のまま第1問を待つ

## 採用する方式

サーバー側に `intro` フェーズを追加する。進行状態はルームの Durable Object が持つので、GM がブラウザを再読み込みしても同じスライドに復帰できる。ゲームの流れはすべて `GameEngine` に集約するという現行方針に沿う。

GM 画面だけでスライドを見せてから `start` を送る方式（サーバー変更なし）は、GM の再読み込みでロビーに戻ってしまうため採用しない。

## データモデル

```ts
interface IntroSlide {
  id: string;
  heading?: string;     // 見出し。100文字まで
  body?: string;        // 本文。複数行可。1000文字まで
  imageUrl?: string;    // 画像。/api/images/<key> か https://
}

interface QuestionSet {
  // ...既存
  introSlides?: IntroSlide[];   // 省略時は空。20枚まで
}
```

- タイトルスライド専用のデータは持たない。今まで通り `name` / `coverImageUrl` / `settings` から描画する
- 旧データ（`introSlides` なし）はそのまま動く。読み込み時に空配列として扱う
- JSON インポート／エクスポートにも `introSlides` を含める
- `QuestionSetSummary` は変えない

### バリデーション

`validateQuestionSetInput` に追加する。

- `introSlides` は省略可。指定する場合は配列で 20 件以下
- 各要素は見出し・本文・画像のうち少なくとも1つが空でない。すべて空の要素は拒否する
- `heading` は文字列で 100 文字以内、`body` は文字列で 1000 文字以内。空文字は `undefined` に正規化する
- `imageUrl` は問題画像と同じ規則（`isValidImageUrl`）
- `id` が無ければサーバーが UUID を採番する

## ゲームの流れ

フェーズに `intro` を追加する。

```
lobby → intro → question → questionResult → … → finalResult → lobby
```

`EngineState` に `introIndex: number` を追加する。`0` がタイトルスライド、`1..n` が `introSlides[n-1]`。旧スナップショットには無いので `fromSnapshot` で `0` を補う。

| 操作 | 動作 |
|---|---|
| `start` | 今まで通り問題セットのコピー・回答のクリア・スコアのリセット（通算しない場合）を行い、`phase = "intro"`, `introIndex = 0` にする。`openQuestion` は呼ばない |
| `next`（`intro` 中） | `introIndex` を1進める。`introIndex > introSlides.length` なら `openQuestion(0)` で第1問へ |
| `next`（`questionResult` 中） | 変更なし |
| `endGame` | `intro` からも使える。`introIndex` を 0 に戻す |
| `answer`（`intro` 中） | `not_in_question` で拒否 |
| `close`（`intro` 中） | `invalid_state` |
| `updateSettings` / `adjustScore` / `kick` | `intro` 中も使える。`reconcileDeadline` と `allParticipantsDone` は `question` 以外では何もしない（変更なし） |
| `start`（`intro` 中） | `invalid_state`（開始は `lobby` と `finalResult` のときだけ、は変更なし） |

`myStatus` は `intro` 中は `null`。`currentQuestionView` / `questionResult` / `correctCount` は `intro` 中は `null` / `0`（既存の `question` / `questionResult` 判定のままで満たす）。

### Alarm

`intro` には締切が無いので、`lobby` と同じく 24 時間後の `cleanup` を設定する。`start` では `armDeadline` ではなく `scheduleCleanup` を呼び、`intro` から第1問へ入る `next` で `armDeadline(question.deadlineAt)` を呼ぶ。

## プロトコル

### 追加する型

```ts
type IntroSlideView =
  | { kind: "title"; name: string; coverImageUrl?: string; questionCount: number; settings: QuestionSettings }
  | { kind: "slide"; heading?: string; body?: string; imageUrl?: string };

interface IntroView {
  index: number;          // 0 がタイトル
  total: number;          // 1 + introSlides.length
  slide: IntroSlideView;
}
```

タイトルの `settings` は第1問に実際に効く設定（`engine.settings(0)`。GM のライブ上書きを含む）。編集画面のタイトルプレビューと同じ項目（全n問・制限時間・お手付き上限）を描く。

### `state`

`intro: IntroView | null` を追加する。`intro` 中のみ非 null。

### サーバー → クライアント

| type | 宛先 | payload | 内容 |
|---|---|---|---|
| `introStarted` | 全員 | `{ intro: IntroView }` | タイトル・説明スライドの表示。`start` と `intro` 中の `next` で送る |

`start` 時は今まで通り `leaderboard` と `settingsUpdated` も送る（スコアのリセットと実際に効く設定を知らせるため）。`intro` から第1問へ入る `next` は今まで通り `questionStarted` と `settingsUpdated` を送る。

### クライアント → サーバー

変更なし。`next` を `intro` でも受け付ける。

## クライアント側の状態

`ClientState` に `intro: IntroView | null` を追加する。

- `state`: `intro` を取り込む
- `introStarted`: `phase = "intro"`, `intro = msg.intro`, `question = null`, `questionResult = null`, `finalEntries = null`, `lastAnswerResult = null`, `correctCountThisQuestion = 0`
- `questionStarted`: 既存の処理に加えて `intro = null`

## 画面

### スライド描画の共通化

`src/web/admin/SlidePreview.tsx` の `TitleSlidePreview` / `QuestionSlidePreview` / `SlideFrame` を `src/web/components/Slides.tsx` に移し、`IntroSlidePreview`（見出し・本文・画像）を追加する。編集画面のプレビューと GM 画面の本番表示で同じコンポーネントを使う。

`IntroSlidePreview` のレイアウト:

- 画像があれば中央に大きく（`object-contain`）。見出し・本文があれば画像の上下に添える
- 画像が無ければ見出しを大きく、本文をその下に。本文は改行を保つ（`whitespace-pre-wrap`）
- `compact`（サムネイル）では本文を省略する

### GM 画面（`/gm/:code`）

| フェーズ | 内容 |
|---|---|
| `intro` | 出題カードの位置に、`IntroView.slide` に応じて `TitleSlidePreview` または `IntroSlidePreview` を 16:9 で大きく表示。右カラムは `lobby` と同じ参加者一覧（入室が続く時間帯のため）。フッターは「次へ」（最後のスライドでは「第1問へ」）と「ロビーへ戻る」（確認ダイアログ付き） |

ヘッダーの企画名表示・管理パネルは変更なし。

### 参加者画面（`/play/:code/game`）

`intro` は `lobby` と同じ待機カードを出す。企画名が分かるので「まもなく開始します」の上に企画名を表示する。回答欄は出さない。

### 編集画面（`/admin/:id`）

スライド一覧の順序を「T → 説明1, 説明2, … → 1, 2, …」にする。

- 選択状態 `Selection` を `"title" | { kind: "intro"; index: number } | { kind: "question"; index: number }` にする
- 左カラム下部のボタンを「問題を追加」と「説明スライドを追加」の2つにする。説明スライドは最後の説明スライドの後ろ（説明が無ければタイトルの直後）に追加し、追加したスライドを選択する
- 説明スライド選択中の中央下部の操作: 前へ／後ろへ移動（説明スライド内でのみ）、複製、削除。削除は内容があれば確認ダイアログを出す
- 右ペイン（`IntroInspector`）: 見出し（1行）、本文（複数行 textarea）、画像（`ImageField`）
- 中央プレビューは `IntroSlidePreview`
- ↑↓ / PageUp / PageDown はタイトル → 説明 → 問題の順で通しで移動する
- 保存前チェック（`findProblem`）に「説明スライドが空（見出し・本文・画像すべて無し）」を追加し、該当スライドに移動して表示する
- サムネイルの番号欄はタイトルが `T`、説明スライドが `説1` のような短い印、問題は今まで通り数字

## テスト

| 層 | 追加するケース |
|---|---|
| `GameEngine` | `start` で `intro` / `introIndex = 0` になる。`next` でタイトル → 説明スライド → 第1問と進み、説明スライドが無ければタイトルの次が第1問。`intro` 中の `submitAnswer` は `not_in_question`。`intro` から `endGame` でロビーに戻る。`introView()` の内容（タイトルの `settings` にライブ上書きが効く）。`introIndex` の無い旧スナップショットを復元できる |
| バリデーション | `introSlides` 省略可。空の要素・21件・長すぎる見出し／本文・不正な画像 URL を拒否。`id` 採番 |
| クライアント reducer | `introStarted` で `intro` と `phase` が入り問題がクリアされる。`questionStarted` で `intro` が消える。`state` の `intro` を取り込む |
| Room 統合 | `start` で `introStarted` が全員に届き Alarm が `cleanup`。`intro` 中の `next` で次の `introStarted`、最後は `questionStarted` と締切 Alarm。`intro` 中の `answer` は `not_in_question`。`intro` 中の `close` は `invalid_state` |

## 設計書の更新

実装と同じコミット群で `docs/data-model.md`・`docs/game-rules.md`・`docs/protocol.md`・`docs/screens.md` を現在形で更新し、本ファイルは削除する。
