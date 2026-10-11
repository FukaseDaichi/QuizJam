# QuizJam 概要

GM（ゲームマスター）が PC で進行し、参加者がスマートフォンで回答するリアルタイムクイズシステム。
参加者は QR コードを読み取ってルームに入室し、画面に表示された問題にフリーテキストで回答する。
正解が出ると GM 画面にポップアップが表示され、順位表は常時更新される。

関連: [ゲームルール](game-rules.md) / [データモデル](data-model.md) / [通信プロトコル](protocol.md) / [画面構成](screens.md) / [デザインガイド](design-guide.md)

## 前提条件

| 項目 | 内容 |
|---|---|
| 同時参加者数 | 1ルームあたり最大10名程度（GM1名＋参加者） |
| 参加形態 | 常にオンライン。会場参加・遠隔参加の区別なし |
| ホスティング | Cloudflare 無料プラン（Workers / Durable Objects / D1 / R2） |
| 開発言語 | TypeScript（サーバー・フロント・共有コード） |
| 問題形式 | アナグラム（日本語フリーテキスト回答）のみ。型は拡張可能 |
| 参加者識別 | ニックネームのみ。ログイン不要。スコアは1ルーム内で完結 |

## スコープ外

- アナグラム以外の問題形式
- 複数 GM の同時操作
- 参加者のアカウント登録、ゲーム履歴の永続保存
- チーム対抗
- 独自ドメイン
- オフライン（会場 Wi-Fi のみ）運用

## インフラ構成

```
参加者スマホ / GM PC（ブラウザ）
        │ HTTPS / WSS
        ▼
Cloudflare Workers（1つの Worker）
  ├─ Static Assets: React SPA を配信（SPA フォールバック。/api/* と /ws/* は Worker が先に処理）
  ├─ HTTP API: 入室、ルーム作成、問題セット CRUD、画像、管理者認証
  └─ /ws/room/:code → Durable Object「Room」へ転送
            │
            ├─ Durable Object: Room（ルームごとに1つ、SQLite ストレージ）
            │     GameEngine を保持、WebSocket Hibernation、Alarm で締切と自動削除
            ├─ D1 quizjam-db: 問題セットの永続化
            └─ R2 quizjam-images: 問題・表紙画像
```

Durable Objects は無料プランでは SQLite バックエンドのみ利用できるため、Room は `new_sqlite_classes` で定義する。

## 技術スタック

| 層 | 採用 | 理由 |
|---|---|---|
| ランタイム | Cloudflare Workers + Durable Objects (SQLite) + D1 + R2 | 無料枠、サーバー管理不要 |
| サーバーフレームワーク | Hono | Workers 向けに軽量。ルーティングと型付き API が簡潔 |
| フロントエンド | React 19 + Vite + `@cloudflare/vite-plugin` + react-router-dom | GM・参加者・管理を1つの SPA にまとめ、ルートで出し分ける |
| スタイル | Tailwind CSS v4 + Noto Sans JP（Google Fonts） | スマホ縦・プロジェクター横の両対応 |
| アイコン | lucide-react | 絵文字を UI アイコンに使わない（デザインガイド） |
| QR コード | qrcode.react | GM 画面でクライアント側生成 |
| 共有コード | `src/shared/` | 型、メッセージ定義、回答正規化、バリデーションをサーバーとフロントで共用 |
| テスト | Vitest + `@cloudflare/vitest-plugin` | すべて workerd 上で実行 |
| ビルド・デプロイ | Wrangler、GitHub Actions | main への push で型チェック・テスト・ビルド → D1 マイグレーション → deploy |

## リポジトリ構成

```
src/
  shared/   型・既定値・回答正規化・アナグラム生成・メッセージ定義・バリデーション
  room/     GameEngine（純粋ロジック）と Room Durable Object
  worker/   Hono ルーティング、D1 リポジトリ、認証、トークン生成
  web/      React SPA（player/ gm/ admin/ components/ lib/）
test/       Vitest（GameEngine 単体、Room / API 統合、クライアント状態）
migrations/ D1 スキーマ
docs/       設計書
```

## 設計方針: GameEngine の分離

ゲーム進行ロジック（出題・判定・制限時間・お手付き・スコア・順位・GM によるライブ設定）は通信層やストレージから切り離した純粋な TypeScript クラス `GameEngine` に集約する。
Durable Object はメッセージの受け渡し・永続化・Alarm のみを担当する。
時刻は常に引数で注入し、単体テストを決定的にする。

## 認証

| 対象 | 方式 |
|---|---|
| 問題セットの作成・更新・削除、画像のアップロード・削除 | `Authorization: Bearer <ADMIN_PASSPHRASE>`。Wrangler secret で設定し、定数時間比較で検証する |
| 問題セットの一覧・取得、画像の配信 | 認証不要（GM がルーム待機画面で選ぶため） |
| GM のルーム操作 | ルーム作成時に発行する GM トークン（64桁 hex）。WebSocket 接続時にクエリで渡す |
| 参加者 | 入室時に発行する参加者トークン（64桁 hex）。WebSocket 接続時にクエリで渡し、再接続時の識別に使う |

## 運用

- URL は `https://<プロジェクト名>.<アカウント名>.workers.dev` を使用する。
- 終了したルーム（ロビー・結果表示・締切なし出題中）は Room の Alarm で24時間後に削除する。
- 監視は Cloudflare ダッシュボードの Workers Logs を使う（observability 有効）。
- `wrangler.jsonc` を変更したら `npm run cf-typegen` で Env 型を再生成し、コミットする。

## 無料枠の見積もり（10名・1ゲーム20問）

| 項目 | 1ゲームあたり概算 | 無料枠（日） |
|---|---|---|
| Durable Object リクエスト | 約30 | 100,000 |
| Worker リクエスト（静的配信・API） | 約200 | 100,000 |
| D1 読み書き | 数十行 | 読み500万行・書き10万行 |

1日に数十ゲーム行っても無料枠内に収まる。

## テスト方針

| 層 | 対象 | 方法 |
|---|---|---|
| 単体 | GameEngine、回答正規化、アナグラム生成、バリデーション、クライアント状態 reducer | 時刻を注入して決定的にテストする |
| 統合 | Worker の HTTP API（問題セット・ルーム・画像）、Room との WebSocket やり取り | `@cloudflare/vitest-plugin`。D1 はテスト開始時にマイグレーションを適用する |
| 手動 E2E | GM 画面とスマホ画面を実機で通しプレイ | デプロイ後に README のチェックリストで確認する |

優先して固めるケース:

- 正解順ボーナスの付与順序（サーバー受信順）
- `afterFirstCorrect` で最初の正解時のみ締切が設定されること
- お手付き上限到達後の回答拒否、正解後の再回答拒否、締切後の回答拒否
- 通算モードとリセットモードでのスコア引き継ぎ
- 全角／半角・カタカナ／ひらがなの正規化一致
- GM によるライブ設定の優先順位、スコア調整、キック後の自動締切
- 開始でタイトルスライドに入り、`next` で説明スライド → 第1問と進むこと。説明スライドが無ければタイトルの次が第1問
- タイトル・説明スライド表示中の回答・締切の拒否、キックで問題が閉じないこと、2ゲーム目もタイトルから始まり通算スコアが保たれること
- `introIndex` や `introSlides` の無い旧データを復元できること
