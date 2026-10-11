# QuizJam

GMがPCで進行し、参加者がスマートフォンからQRコードで入室して回答するリアルタイムクイズ。
設計書: `docs/`（入口は `docs/AGENTS.md`）/ デザイン: `docs/design-guide.md`

本番: https://quizjam.franc-app.workers.dev/ （管理画面: https://quizjam.franc-app.workers.dev/admin ）

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
- 管理画面はスライド形式のエディタ。左にスライド一覧、中央に GM 画面と同じ見た目のプレビュー、右に選択中スライドの内容。タイトルスライド（企画名・表紙画像・全問共通の設定）のあと、1問ずつスライドを追加して正解・出題文・画像・ヒント・個別設定を入力する
- 画像に問題の文字が描かれている問題は、出題文を空欄にできる（画像だけを大きく表示する）。タイトルスライドの「問題スライドの背景色」を画像の地の色に合わせると、GM 画面で画像が背景になじむ
- 画像は R2（`quizjam-images`）に保存される。ローカルでは wrangler がエミュレートするので追加設定は不要
- 参加者: GM 画面の QR か `/play/<ルームコード>`
- `wrangler.jsonc` を変更したら `npm run cf-typegen` で型を再生成する

## デプロイ

```bash
npx wrangler login
npx wrangler d1 create quizjam-db     # 初回のみ。出力の database_id を wrangler.jsonc に反映
npx wrangler r2 bucket create quizjam-images   # 初回のみ。問題画像の保存先
npm run db:migrate:remote
npx wrangler secret put ADMIN_PASSPHRASE
npm run deploy
```

### 自動デプロイ（GitHub Actions）

`.github/workflows/deploy.yml` が main への push（と Actions 画面からの手動実行）で、型チェック・テスト・ビルドのあと D1 マイグレーション適用 → `wrangler deploy` を行う。PR では型チェック・テスト・ビルドだけ実行する。

初回のみ以下を設定する（D1・R2 の作成と `ADMIN_PASSPHRASE` の登録は上の手順で済ませておく。シークレットはデプロイしても消えない）。

1. Cloudflare ダッシュボード → My Profile → API Tokens で「Edit Cloudflare Workers」テンプレートからトークンを作り、権限に「Account / D1 / Edit」を追加する
2. GitHub リポジトリの Settings → Secrets and variables → Actions に `CLOUDFLARE_API_TOKEN` として登録する

## 構成

- Cloudflare Workers（Hono）: 静的配信、HTTP API、WebSocket 転送
- Durable Object `Room`（SQLite）: ルームごとのゲーム進行。WebSocket Hibernation、Alarm で締切と24時間後の自動削除
- D1 `quizjam-db`: 問題セット（企画名・設定・問題。画像は URL で参照）
- R2 `quizjam-images`: 問題・解説・表紙の画像。`POST /api/images`（合言葉必須）でアップロードし `GET /api/images/<key>` で配信。ブラウザ側で長辺 1600px に縮小してから送る
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

- [ ] `/admin` に合言葉でログインし、タイトルスライドで企画名・表紙画像・共通設定（固定20秒・お手付き2回）を入力できる
- [ ] 「問題を追加」で1問ずつスライドが増え、中央のプレビューが右側の入力に追従する。↑↓キーでスライドを移動できる
- [ ] 問題に画像をドロップするとアップロードされ、サムネイルとプレビューに表示される。保存→リロードしても画像が残る
- [ ] 「生成」ボタンで正解からシャッフル文字列が作られ、JSON エクスポート→インポートで内容（画像 URL を含む）が復元される
- [ ] 未保存のまま一覧へ戻ろうとすると警告が出る。正解や出題文が空のまま保存すると該当スライドに移動してエラーが出る
- [ ] `/` から「新しいルームを作る」→ QR とルームコードが表示される
- [ ] スマホで QR を読み取り、ニックネーム入力で入室 → GM の参加者一覧に即時表示される
- [ ] 「開始する」で全スマホに第1問が表示され、残り時間が GM・スマホで同じ秒数を刻む
- [ ] 画像付きの問題では GM 画面（プロジェクター）とスマホの両方に画像が表示され、出題文が画像の下に出る
- [ ] 正解を送ると本人に「正解！」、GM にポップアップ＋紙吹雪、順位表が更新される
- [ ] 不正解で残り回数が減り、上限で入力が閉じる
- [ ] 全員が正解または上限到達で自動的に問題結果に進む／時間切れでも自動で進む
- [ ] 「正解者が出てからカウントダウン」の問題セットで、最初の正解後にだけタイマーが始まる
- [ ] 解説画像を設定した問題では、締切後の問題結果で GM 画面・スマホの両方に解説画像が出る（出題中には出ない）
- [ ] 「締切」で手動締切できる。「次の問題へ」→ 最終問題後に「最終結果へ」で順位表が出る
- [ ] 「もう1ゲーム」→ 通算ON で開始するとスコアが引き継がれ、OFF で 0 から始まる
- [ ] スマホをスリープ→復帰、またはリロードしても同じ名前・スコア・現在の問題が復元される
- [ ] GM のブラウザをリロードしても進行中の画面が復元され、タイマーは止まらない
- [ ] 出題中に「管理」を開き、制限時間・お手付き上限・ペナルティを変えて適用すると、次の問題から反映される
- [ ] 「管理」で参加者の点数を＋／－すると GM の順位表とスマホの点数が即時に変わる
- [ ] 「管理」の QR をゲーム中にスマホで読み取って途中参加できる
- [ ] 「管理」でキックするとスマホは参加画面に戻り「退出されました」と出る。同じ端末から入り直すと新規参加になる
- [ ] 同じニックネームで2人入室すると、2人目が「名前 (2)」として表示される
- [ ] 存在しないルームコードの URL で「ルームが見つかりません」が表示される
- [ ] 絵文字アイコンが UI に無く、Noto Sans JP で表示されている
