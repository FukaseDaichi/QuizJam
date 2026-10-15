# 早押し問読み音声生成スキル（quiz-tts）設計

## 目的

早押しクイズの問題文から、問読み（読み上げ）音声を Gemini 3.8 Flash TTS で生成する Claude Code スキルを作る。生成物は手元の音声ファイル。QuizJam アプリへの組み込み（R2 へのアップロード、`audioUrl`、文字送りとの同期）は今回の対象外とし、後で組み込めるよう問題 ID と長さをマニフェストに残す。

成功条件:

- 台本ファイルに 20 問書いて `build` と `join` を実行すると、各問について「問題！ → 無音 → 問題文」の mp3 ができる
- 声・話し方が全問で同じ（声名と style を設定で固定）
- 台本を 1 問だけ直して再実行すると、その 1 問だけ再生成される
- 「問題！」は 1 回だけ生成し、全問で同じファイルを使い回す

## 決定事項

| 項目 | 決定 | 理由 |
|---|---|---|
| 再生先 | ファイルとして手元に置く。アプリは触らない | まず問題と音声を揃える。同期はサーバーが文字送り時刻を持つので後から可能 |
| 入力 | リポジトリ内の台本ファイル `voice/sets/<セット名>.md` | 作問・読み仮名・強調指示を 1 か所で管理し、git で差分を追える |
| 声 | プリセット声を `voice/config.json` で固定 | 有効期限・個数上限がなく、再作成で声が変わらない。Voice design（`voice_...` ID）は最終利用から 1 年で消えるため採らない |
| git 管理 | 台本・manifest.json・結合後 mp3 をコミット。中間 WAV は無視 | クローンだけで音声が揃い、リポジトリは軽い |
| 実装言語 | Node 22、依存なし（`fetch`） | リポジトリと同じランタイム。ffmpeg は結合・mp3 化にだけ使う |

## 構成

```
.claude/skills/quiz-tts/
  SKILL.md              いつ使うか・ワークフロー・台本の書き方ルール・コマンド
  scripts/tts.mjs       生成スクリプト（voices / mondai / build / join）
  scripts/tts.test.mjs  台本パーサと差分判定のテスト（node --test）
voice/
  config.json           モデル・声名・style・無音長・出力先
  sets/<セット名>.md    台本（人が書く・レビューする）
  out/mondai.wav        「問題！」（1 回だけ生成。コミットする）
  out/<セット名>/
    Q01.wav             問題文だけの音声（.gitignore）
    Q01.full.mp3        問題！＋無音＋問題文（コミット）
    manifest.json       問ごとのハッシュ・長さ・生成日時・声・モデル
.env                    GEMINI_API_KEY（.gitignore）
.env.example            GEMINI_API_KEY=
```

`.gitignore` に `.env`、`voice/out/*/Q*.wav`、`voice/out/voices/` を追加する。`mondai.wav` は小さく、作り直すと声が微妙に変わるのでコミットする。

## 台本ファイル

1 問 1 ブロック。見出しの ID が出力ファイル名になる。

```markdown
# 映画早押し20問

## Q01
- 答え: 『バック・トゥ・ザ・フューチャー』
- 問題文: 1955年にタイムスリップした高校生マーティが、若き日の両親を結びつけようと奮闘する、マイケル・J・フォックス主演の映画は何でしょう？
- 読み: 1955年にタイムスリップした高校生マーティが、<short pause>若き日の両親を結びつけようと奮闘する、<short pause>マイケル・ジェイ・フォックス主演の映画は、何でしょう？
- style: （省略可。config の既定を上書きする短い文）
```

- `答え` と `問題文` は表示・判定用。音声には使わない
- `読み` が TTS に渡す逐語テキスト。無ければ `問題文` をそのまま使う（警告を出す）
- ID は `Q` + 2 桁以上の数字。重複はエラー

### 読みの書き方ルール（SKILL.md に載せる。問読みのコツを音声用に変換したもの）

1. **下読み**: 固有名詞・数字・記号の読みを確認し、誤読しそうな語はカタカナや平易な表記に直す（例: `マイケル・J・フォックス` → `マイケル・ジェイ・フォックス`、`1955年` はそのまま。`II` → `ツー`）
2. **『』「」は外す**: API は text を逐語で読むため、括弧は読みに入れない。「」の中（セリフ・引用）は前後に `<short pause>` を置いて区切る
3. **フリの切れ目にポーズ**: 前フリ → 後フリ → 問いかけの境目に `<short pause>`。文末の「何でしょう？」の直前は読点で区切る
4. **パラレル（ですが問題）**: 対比する語（「日本で」「第1作」など）の直後に `<short pause>`。「ですが、」の後にも `<short pause>`。文字単位の強弱指定は Gemini TTS に無いので、ポーズで代用する
5. **速さ**: 既定 style を「落ち着いたクイズ番組のアナウンサー。ゆっくり、はっきり」とし、問ごとの style は原則空。速度の数値指定は無い
6. **確定ポイント付近で速さを変えない**: 読みに `<long pause>` を入れない（読み手の癖がヒントになる）
7. **タグは英語の既定語のみ**: `<short pause>` 以外の感情タグ（`<laugh>` など）は使わない

チェックリスト（台本レビュー時）:

- [ ] 読みに『』「」が残っていない
- [ ] 固有名詞の読みが確認済み
- [ ] 1 問につき `<short pause>` が 1〜3 個（多すぎると不自然）
- [ ] 答えが読みに含まれていない（前フリの言い換えで漏れていないか）

## スクリプト

`node .claude/skills/quiz-tts/scripts/tts.mjs <コマンド> [引数]`

| コマンド | 動作 |
|---|---|
| `voices [--text 文]` | `config.json` の `candidates`（声名の配列）それぞれで同一文を生成し `voice/out/voices/<声名>.wav` に保存。声を 1 回決めるための聴き比べ用 |
| `mondai` | 「問題！」を `voice/out/mondai.wav` に生成。既にあれば何もしない。`--force` で作り直す |
| `build <セット名> [--only Q03] [--force]` | 台本を読み、各問の WAV を生成。`manifest.json` のハッシュと一致する問は飛ばす |
| `join <セット名> [--only Q03]` | ffmpeg で `mondai.wav` → 無音（`config.pauseMs`、既定 600）→ `Qnn.wav` を結合し `Qnn.full.mp3` を出す。ffmpeg が無ければ警告して終了コード 0 |

### config.json

```json
{
  "model": "gemini-3.8-flash-tts",
  "voice": "Kore",
  "candidates": ["Kore", "Zephyr", "Charon", "Sulafat"],
  "style": "落ち着いたクイズ番組のアナウンサー。ゆっくり、はっきり読む",
  "mondaiText": "問題！",
  "pauseMs": 600,
  "outDir": "voice/out",
  "concurrency": 2
}
```

### API 呼び出し

- `POST https://generativelanguage.googleapis.com/v1beta/interactions`、ヘッダ `x-goog-api-key: <GEMINI_API_KEY>`
- 本文: `model`、`input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style }] }] }]`、`response_format: { type: "audio" }`、`generation_config: { speech_config: [{ voice }] }`
- 応答: `steps[]` のうち `model_output` の最後の audio content の `data`（base64 WAV、24kHz モノラル 16bit）を保存
- この JSON の形は公式ドキュメントの要約から起こしたもの。実装の最初に 1 問だけ投げて、本文と応答の形を確定する（計画の最初のタスク）

### 差分判定

ハッシュ = SHA-256(`model` + `voice` + 有効 style + 読み)。`manifest.json` に問ごとに `{ hash, durationMs, voice, model, generatedAt }` を書く。`build` はハッシュ一致なら飛ばす。`join` は `Qnn.full.mp3` が `Qnn.wav` と `mondai.wav` より新しければ飛ばす。

### エラー処理

- `GEMINI_API_KEY` 未設定: `.env` の作り方を出して終了コード 1
- API エラー: 429 / 5xx は 2 秒・4 秒・8 秒待って 3 回まで再試行。それでも失敗した問は記録して続行し、最後にまとめて表示、終了コード 1
- 台本の形式エラー（ID 重複・読みも問題文も無い）: 行番号付きで表示して終了コード 1。生成は始めない
- 生成した WAV が 1 秒未満または 60 秒超: 警告（台本の見直し候補として一覧に出す）

### テスト

- `node --test .claude/skills/quiz-tts/scripts/` で台本パーサ（正常・ID 重複・読み省略）とハッシュ／差分判定をフィクスチャで検証
- API と ffmpeg は手動確認: `mondai` と `build --only Q01` を実際に実行して聴く。SKILL.md の手順に含める
- リポジトリの vitest（workerd 向け）には混ぜない

## SKILL.md のワークフロー

1. 台本を書く／直す（`voice/sets/<セット名>.md`）。問題文から「読み」を上のルールで起こし、チェックリストで見直す
2. `voice/out/mondai.wav` が無ければ `mondai`
3. `build <セット名>`
4. `join <セット名>`
5. 出力の長さ一覧（manifest）を見て、極端に短い・長い問が無いか確認。あれば台本を直して 3 から

## スコープ外

- QuizJam への組み込み（R2 アップロード、`Question.audioUrl`、GM 画面での再生、文字送りとの同期）
- 文字単位のアクセント指定（Gemini TTS に手段が無い）
- Voice design / 音声複製による専用声
- 多話者
