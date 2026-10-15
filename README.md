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

## 早押しの問読み音声

`voice/sets/<セット名>.md` に台本（問題文と読み）を書き、Gemini 3.8 Flash TTS で読み上げ音声を作る。音声から問題文の各文字の表示時刻を作ってアプリに上げると、GM 画面が音声を流しながら文字を合わせて出す。手順と台本の書き方は `.claude/skills/quiz-tts/SKILL.md`。

```bash
cp .env.example .env              # GEMINI_API_KEY（publish には QUIZJAM_URL・ADMIN_PASSPHRASE も）を入れる
npm run tts -- mondai             # 「問題！」を 1 回だけ生成
npm run tts -- build movie        # 台本から各問の WAV
npm run tts -- join movie         # 問題！＋無音＋問題文 の mp3（ffmpeg が必要）
npm run tts -- align movie        # 各文字の表示時刻（timing.json。uv が必要）
npm run tts -- publish movie      # mp3 をアプリに上げ、question-sets/movie.json に書き込む
npm run test:tts
```

## 構成

- Cloudflare Workers（Hono）: 静的配信、HTTP API、WebSocket 転送
- Durable Object `Room`（SQLite）: ルームごとのゲーム進行。WebSocket Hibernation、Alarm で締切と24時間後の自動削除
- D1 `quizjam-db`: 問題セット（企画名・設定・問題。画像は URL で参照）
- R2 `quizjam-images`: 問題・解説・表紙の画像。`POST /api/images`（合言葉必須）でアップロードし `GET /api/images/<key>` で配信。ブラウザ側で長辺 1600px に縮小してから送る。早押しの問読み音声も同じバケットに `POST /api/audio` で置く
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
- [ ] 早押しの問題セット（タイトルスライドの出題形式＝早押し）で開始すると、タイトルスライドに「早押し ・ 6文字/秒」と出る
- [ ] 第1問で「読み上げ開始」を押すと GM 画面の問題文が一文字ずつ現れる。スマホには問題文が出ず、大きな早押しボタンだけがある
- [ ] スマホ A で押すと GM の文字送りが止まり「Aさん 回答中」、A の画面は「あなたの番！」。続けて B が押すと B は「2番目に押しました」
- [ ] 「不正解」で A が減点されて押せなくなり、B の番になる。「正解」で B の問題結果に「正解しました +100点」、GM にポップアップと紙吹雪、問題結果に B だけが出る
- [ ] 誰も押さないまま不正解のあとキューが空になると、止まった位置から読み上げが再開する
- [ ] 読み上げ中に管理パネルで読み上げ速度を変えても、表示済みの位置が飛ばない
- [ ] 回答中に GM をリロードしても「Aさん 回答中」と判定ボタンが復元される
- [ ] publish した音声付きの問題セット（映画）をインポートして保存し開始すると、タイトルスライドに「早押し ・ 音声付き」と出る
- [ ] 「読み上げ開始」で GM の PC から「問題！」→問題文が流れ、問題文の文字が声に合わせて出る（2.0 秒ほど後に 1 文字目）
- [ ] 文の途中・間の直後・「問題！」の最中・全文表示後のそれぞれで押すと、音声と文字が同じ所で止まる
- [ ] 不正解で再開すると、止まった文字の読み始めから音声が流れ、表示済みの文字は消えない
- [ ] 読み上げ中に GM をリロードすると「音声を有効にする」が出て、押すと続きから流れる
- [ ] 絵文字アイコンが UI に無く、Noto Sans JP で表示されている
