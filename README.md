# QuizJam

GMがPCで進行し、参加者がスマートフォンからQRコードで入室して回答するリアルタイムクイズ。
設計: `docs/superpowers/specs/2026-10-05-quizjam-design.md` / デザイン: `docs/design-guide.md`

## 開発

```bash
npm install
npm run db:migrate:local          # ローカル D1 にスキーマ適用
printf 'ADMIN_PASSPHRASE=dev-pass\n' > .dev.vars
npm run dev                       # http://localhost:5173
npm test                          # Vitest（workerd 上で実行）
npm run typecheck
```

- GM トップ: `/`　管理画面: `/admin`（合言葉は `.dev.vars` の値）
- 参加者: GM 画面の QR か `/play/<ルームコード>`
- `wrangler.jsonc` を変更したら `npm run cf-typegen` で型を再生成する

## デプロイ

```bash
npx wrangler login
npx wrangler d1 create quizjam-db     # 初回のみ。出力の database_id を wrangler.jsonc に反映
npm run db:migrate:remote
npx wrangler secret put ADMIN_PASSPHRASE
npm run deploy
```

## 構成

- Cloudflare Workers（Hono）: 静的配信、HTTP API、WebSocket 転送
- Durable Object `Room`（SQLite）: ルームごとのゲーム進行。WebSocket Hibernation、Alarm で締切と24時間後の自動削除
- D1 `quizjam-db`: 問題セット
- React + Vite + Tailwind、lucide-react

```
src/
  shared/   型・回答正規化・メッセージ定義・バリデーション（サーバーとフロントで共用）
  room/     GameEngine（純粋ロジック）と Room Durable Object
  worker/   Hono ルーティング、D1 リポジトリ、認証
  web/      React SPA（player/ gm/ admin/）
test/       Vitest（GameEngine 単体、Room / API 統合、クライアント状態）
```

## 手動 E2E チェックリスト（デプロイ後）

GM 用 PC 1台、スマホ 2台以上で実施する。

- [ ] `/admin` に合言葉でログインし、問題セット（3問・固定20秒・お手付き2回）を作成できる
- [ ] 「生成」ボタンで正解からシャッフル文字列が作られ、JSON エクスポート→インポートで内容が復元される
- [ ] `/` から「新しいルームを作る」→ QR とルームコードが表示される
- [ ] スマホで QR を読み取り、ニックネーム入力で入室 → GM の参加者一覧に即時表示される
- [ ] 「開始する」で全スマホに第1問が表示され、残り時間が GM・スマホで同じ秒数を刻む
- [ ] 正解を送ると本人に「正解！」、GM にポップアップ＋紙吹雪、順位表が更新される
- [ ] 不正解で残り回数が減り、上限で入力が閉じる
- [ ] 全員が正解または上限到達で自動的に問題結果に進む／時間切れでも自動で進む
- [ ] 「正解者が出てからカウントダウン」の問題セットで、最初の正解後にだけタイマーが始まる
- [ ] 「締切」で手動締切できる。「次の問題へ」→ 最終問題後に「最終結果へ」で順位表が出る
- [ ] 「もう1ゲーム」→ 通算ON で開始するとスコアが引き継がれ、OFF で 0 から始まる
- [ ] スマホをスリープ→復帰、またはリロードしても同じ名前・スコア・現在の問題が復元される
- [ ] GM のブラウザをリロードしても進行中の画面が復元され、タイマーは止まらない
- [ ] 同じニックネームで2人入室すると、2人目が「名前 (2)」として表示される
- [ ] 存在しないルームコードの URL で「ルームが見つかりません」が表示される
- [ ] 絵文字アイコンが UI に無く、Noto Sans JP で表示されている
