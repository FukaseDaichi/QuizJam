# 早押しの問読み音声と文字送りの同期 設計

## 目的

早押しモードで、GM 画面の文字送りを問読み音声（quiz-tts が作る `Qnn.full.mp3`）に 1 文字単位で合わせる。音声を正とし、表示タイミングを音声から作る。音声は GM の PC から会場に流す。

今は音声をアプリで再生しておらず、文字は一律 `charsPerSecond`（既定 6 文字/秒）で出る。映画 20 問の音声の実効速度は 3.7〜6.3 文字/秒とばらつき、問題文の頭で同時に始めても文字が 2〜7 秒先に出きる。さらに mp3 の頭には「問題！」と間で 2.0 秒あり、文中には `<short pause>` や読点で 0.3〜1.4 秒の間が入るので、一定速度では合わない。

成功条件:

- 押した瞬間に GM 画面に出ている文字と、会場で聞こえた位置が ±0.2 秒以内で一致する
- サーバーが決める「止まった位置」も同じタイミング表で計算され、GM 画面の表示と一致する
- 不正解で再開すると、止まった文字の読み始めから音声が流れ、表示は止まった位置のまま続く
- 音声の付いていない問題は今までどおり `charsPerSecond` で文字送りする

## 決定事項

| 項目 | 決定 | 理由 |
|---|---|---|
| タイミングの作り方 | 台本の「読み」を `Qnn.wav` に強制アライメント（stable-ts + Whisper small）し、間の後の読み始めを無音の明けに寄せる | スパイクで中央値 0.12 秒・最大 0.27 秒（補正前）、間の後は補正でほぼ 0。medium は間の後に 0.3〜0.4 秒の外れが出て small より悪い。無音検出だけで区切る案は促音などの余計な無音で区切り数が合わず不採用 |
| 取り込み手順 | quiz-tts に `align` と `publish` を足す。publish が mp3 を R2 に上げ、問題セット JSON に書き込む。あとは管理画面の JSON インポート | 1 コマンドで済み、問題セット JSON がリポジトリで正になる |
| 時間軸 | サーバーが早押し状態に再生位置 `positionMs` を持つ。文字数も再生位置も同じ式で決める | サーバー・GM 画面・再接続後の画面がすべて同じ状態から決まる。音声を先に丸ごとデコードするので再生の詰まりでずれない |
| 再開位置 | 最後に表示していた文字の表示時刻まで戻して流す | 音の途中から始まらず自然に聞こえる。戻るのは 1 文字分だけ |
| 再生する端末 | GM の PC だけ。参加者のスマホでは鳴らさない | 会場のスピーカーで流す運用。参加者端末間の同期は不要 |

## 全体の流れ

```
台本 voice/sets/<セット>.md ─┐
問題セット question-sets/<セット>.json ─┤
                                         ▼
build → join → align（新）→ publish（新）→ 管理画面で JSON をインポートして保存
                  │              │
                  │              ├─ POST /api/audio（R2）
                  │              └─ question-sets/<セット>.json の各問に audio を書く
                  └─ voice/out/<セット>/timing.json
```

ゲーム中は、GM 画面が問題を開いた時点で mp3 をデコードしておき、「読み上げ開始」で「問題！」から流す。文字はタイミング表どおりに出る。

## quiz-tts: align

`npm run tts -- align <セット名> [--only Qnn] [--force]`

1. 問題セット JSON `question-sets/<セット名>.json` を読み、台本の各問と ID で対応させる。表示する問題文は JSON の `prompt`（アプリが実際に出す文）を使う。台本の `問題文` と食い違えば警告する
2. 問ごとに、`timing.json` の既存エントリが新しければ飛ばす（下記「やり直しの判定」）
3. 読み（`<short pause>` を除く）の数字をかなに直す（`1955` → `せんきゅうひゃくごじゅうご`）。数字のままだと Whisper が数字に長さ 0 を割り当てる。1〜9999 の整数だけを直し、それ以外の数字はそのまま残して警告する
4. Python に `Qnn.wav` とかな化した読みを渡し、単語ごとの開始・終了秒を受け取る
5. `ffmpeg silencedetect`（−40 dB、0.1 秒以上）で `Qnn.wav` の無音区間を取り、すき間が 0.05 秒未満の区間はつなぐ。単語ごとに、無音区間 [a, b] のうち「a ≤ 単語の頭 ＋ 0.05 秒」かつ「単語の頭 − 0.3 秒 ≤ b ≤ 単語の終わり」かつ「b が直前の単語の頭より 0.02 秒以上後」を満たすものがあれば、単語の頭を b（複数あれば単語の頭に最も近いもの）にする。無音の明け＝実際に声が出た時刻なので、Whisper が間の後で 0.1〜0.2 秒遅れる癖を消せる
6. 単語の中の文字は、単語の区間に等間隔で割り振る。これで読みの 1 文字ごとの開始時刻ができる
7. 表示の問題文と読みを文字単位で差分（LCS）で対応づけ、表示の各文字に時刻を付ける
   - 一致する文字: 対応する読みの文字の開始時刻
   - 置き換え（`瀧`↔`タキ`、`誠`↔`まこと`、`2016`↔`にせんじゅうろく`、`J`↔`ジェイ`）: 置き換え区間の読みに比例配分。区間の端にある読みだけの読点（`監督の、2016年` の `、`）は区間から外す
   - 表示にだけある文字（`『』「」`、`I'll be back（`）: 次に読む文字と同時に出す
   - 前の文字より早くならないよう単調にそろえる
8. 「問題！」と間の長さ（`mondai.wav` の長さ ＋ `pauseMs`）を足し、mp3 の頭からのミリ秒（整数）にする
9. 長さ 0 の単語や 1.5 秒を超える単語があれば、その問を警告に出す（読みと表記が大きく違う箇所の目安）

### timing.json

`voice/out/<セット名>/timing.json`。コミットする。

```json
{
  "version": 1,
  "set": "movie",
  "entries": {
    "Q06": {
      "prompt": "1955年にタイムスリップした高校生マーティが、…何でしょう？",
      "mp3Sha256": "…",
      "revealAtMs": [2340, 2700, 3160, 3580, 3960, …]
    }
  }
}
```

- `revealAtMs.length` は `prompt` の文字数（コードポイント）と同じ
- エントリはキー順に並べる（manifest.json と同じ）。台本から消えた問は消す

### やり直しの判定

エントリの `prompt` が問題セット JSON の今の `prompt` と同じで、`mp3Sha256` が今の `Qnn.full.mp3` の SHA-256 と同じなら新しい。`--force` で全問やり直す。

### Python との分担

- Python（`.claude/skills/quiz-tts/align/`、`pyproject.toml` で stable-ts のバージョンを固定）は「wav と読みから単語ごとの時刻を返す」だけを持つ。標準入力で `[{ id, wav, text }]` を受け、モデルを 1 回だけ読み込んで全問を処理し、標準出力に `{ id: [{ w, s, e }] }` を返す
- Node から `uv run --project .claude/skills/quiz-tts/align python align.py` で呼ぶ。初回は uv が仮想環境を作り、Whisper small（約 460 MB）を `~/.cache/whisper` にダウンロードする
- 数字のかな化・無音への寄せ・文字の対応づけ・オフセット・警告・timing.json の読み書きは Node 側に置き、`node --test` でテストする
- `uv` が無ければ、入れ方を示して終了コード 2 で止まる

## quiz-tts: publish

`npm run tts -- publish <セット名>`

1. `.env` の `QUIZJAM_URL`（例 `https://quizjam.<アカウント>.workers.dev`）と `ADMIN_PASSPHRASE` を読む。無ければ `.env.example` を示して止まる
2. 問題セット JSON の各問について、timing.json のエントリが新しいか確かめる。古い・無い問が 1 つでもあれば、何も上げずに一覧を出して終了コード 1
3. 各問の `Qnn.full.mp3` を `POST /api/audio` に上げ、返った `url` と `revealAtMs` で `audio` を書き込む
4. 問題セット JSON を書き戻す。書式は今の「1 問 1 行」を保つ
5. 管理画面で、その問題セットの編集画面から JSON をインポートして保存するよう案内を出す

`.env.example` に `QUIZJAM_URL=` と `ADMIN_PASSPHRASE=` を足す。

## データモデル

```ts
interface Question {
  // …既存の項目
  audio?: QuestionAudio;      // 早押しモードでだけ使う
}

interface QuestionAudio {
  url: string;                // /api/audio/<key>
  revealAtMs: number[];       // 問題文の各文字（コードポイント）を出す時刻。音声の頭からの ms
}

interface BuzzerState {
  // …既存の項目
  positionMs: number;         // 区間の起点での再生位置（ms）。音声付きの問題でだけ使う
}
```

### バリデーション

- `audio.url` は `/api/audio/<key>` か `https://` で始まる 500 文字以内
- `audio.revealAtMs` は `promptLength(prompt)` と同じ長さ、0〜600000 の整数、前の要素以上
- `mode` が `buzzer` でなければ保存時に `audio` を落とす
- 旧スナップショットに `positionMs` が無ければ 0 で復元する

### 保存先と API

画像と同じ R2 バケット `quizjam-images` に置く。

| メソッド・パス | 認証 | 内容 |
|---|---|---|
| `POST /api/audio` | 管理者 | 本文は mp3（`Content-Type: audio/mpeg`）、2 MB まで。キーは本文の SHA-256（16 進）＋ `.mp3`。同じキーがあれば上書きせずに返す。`{ key, url }` を返す |
| `GET /api/audio/:key` | なし | `audio/mpeg` で配信。`Cache-Control: public, max-age=31536000, immutable` |

キーが中身で決まるので、同じ mp3 を何度 publish しても R2 は増えない。

## プロトコル

- GM に送る `QuestionView` に `audio?: { url: string; revealAtMs: number[] }` を足す。参加者には送らない（早押しでは問題文も送っていない）
- `BuzzerView` に `positionMs: number` を足す
- タイトルスライドの `IntroSlideView`（`kind: "title"`）に `audio: boolean`（全問に音声が付いているか）を足す

## サーバーの時間軸

`RevealTimeline` に `positionMs` と `revealAtMs?: number[]` を足し、`revealedCount` を次のようにする。サーバーと GM 画面は同じ関数を使う。

- `revealAtMs` が無い: 今と同じ（起点の文字数 ＋ 経過 × 文字/秒）
- `revealAtMs` がある:
  - 再生位置 `pos` = `reading` なら `positionMs ＋ (now − readingStartedAt)`、それ以外は `positionMs`
  - 文字数 = `max(revealedChars, revealAtMs のうち pos 以下の要素の数)`。上限は文字数

`playbackPositionMs(t, now)` も同じファイルに置く。

| 操作 | 音声付きの問題での変化 |
|---|---|
| `startReading` | `positionMs = 0`（「問題！」の頭から） |
| `buzz`（読み上げ中に 1 人目） | `revealedChars` と `positionMs` をその時点の値にして `paused` |
| 再開（不正解・回答中のキックでキューが空） | `revealedChars < promptLength` なら `positionMs = revealedChars > 0 ? revealAtMs[revealedChars − 1] : 0`。全文が出ていれば `positionMs` はそのまま。`readingStartedAt = now` |
| `updateSettings` の `charsPerSecond` | 起点の取り直しは今どおり行う（`positionMs` も取り直す）。表を使うので速さは効かない |

- 「問題！」の最中に押されると 0 文字で止まり、再開すると「問題！」から流れる
- 同じ時刻に複数の文字が出る場合（`「I'll be back（ア`）、再開で位置を戻しても `max` で文字数は減らない

## GM 画面

### 再生

- 問題を開いたら（`ready` の間に）`audio.url` を取得し、Web Audio の `decodeAudioData` で丸ごとデコードしておく。状態を問題文の上の行に小さく出す: 準備中／読み込めません（準備完了は出さない）
- `AudioContext` は 1 つを使い回す。「読み上げ開始」のクリックで `resume()` する（自動再生の制限）。読み上げ中に再読み込みなどで `suspended` のままなら「音声を有効にする」ボタンを出す
- 再生するかどうかと位置は、状態から決める純粋な関数で求める: `status === "reading"` かつ `revealedChars < promptLength` なら、`playbackPositionMs(buzzer, サーバーの今)` の位置から再生する。それ以外なら止める
- `status`・`readingStartedAt`・`positionMs` が変わるたびに今の `AudioBufferSourceNode` を止め、上の関数が再生と言えば新しいノードをその位置から始める。デコードが読み上げ開始に間に合わなければ、終わった時点で同じ関数で位置を求めて始める。位置が音声の長さ以上なら何もしない
- 押されてから GM 画面が止めるまでに、通信の遅れの分（0.05〜0.15 秒程度）音が余分に鳴る。再開時は文字の頭まで戻すので聞き取りには影響しない
- 音声を読み込めなくても、文字はタイミング表どおりに出る（GM が自分で読み上げることもできる）

### 表示

- `useRevealedCount` は `revealAtMs` を受け取り、読み上げ中は 100 ms ごとの再計算をやめて `requestAnimationFrame` で毎フレーム計算する。全文に達したら止める

### 管理パネル・タイトルスライド

- 管理パネルの「読み上げ速度」に「音声付きの問題には効きません」と添える
- タイトルスライドは、全問に音声があれば「n文字/秒」の代わりに「音声付き」と出す

## 管理画面（問題セット編集）

- 音声付きの問題は、問題文の欄の下に「音声あり」と「音声を外す」ボタンを出し、問題文の欄を読み取り専用にする。「音声を外す」で `audio` を消すと編集できる
- 音声付きの問題では、問題ごとの上書き設定の「読み上げ速度」を出さない
- JSON インポートは `audio` をそのまま取り込む（バリデーションを通す）。エクスポートも含める

## エラー処理

| 場面 | 振る舞い |
|---|---|
| align で `uv` が無い | 入れ方を示して終了コード 2 |
| align で Python が失敗 | 標準エラーを出して終了コード 1。timing.json は成功した問だけ更新する |
| align で単語の長さが不自然 | 問ごとに警告。timing.json には書く |
| publish で timing.json が古い・無い | 何も上げずに一覧を出して終了コード 1 |
| publish でアップロード失敗（401・413・通信） | その問を失敗として出し、JSON は書き戻さない。終了コード 1 |
| GM 画面で mp3 の取得・デコード失敗 | 「音声を読み込めません」を出し、文字はタイミング表どおり |
| GM 画面で AudioContext が有効にならない | 「音声を有効にする」ボタン |

## テスト

| 対象 | 内容 |
|---|---|
| `test/shared` | タイミング表での `revealedCount` と `playbackPositionMs`（区間の頭・同時刻の文字・上限・paused）。`audio` のバリデーション（長さの不一致、時刻の逆行、URL の形、anagram で落ちる） |
| `test/room`（GameEngine） | 開始で `positionMs = 0`、押した時点の位置と文字数の記録、再開で文字の頭まで戻る、全文表示後は戻さない、「問題！」中の早押し、`charsPerSecond` の変更で表示が変わらない、回答中のキックでも同じ再開、`positionMs` の無い旧スナップショット |
| `test/worker` | `/api/audio`: 認証、`audio/mpeg` 以外の拒否、2 MB 上限、キーが SHA-256、同じ本文で同じキー、配信ヘッダー |
| `test/web` | 再生判断の純粋関数（再生するか・どこから）。`audio` が GM の `QuestionView` にだけ載ること |
| quiz-tts（`npm run test:tts`） | 数字のかな化、無音への寄せ、表示と読みの対応づけ（Q10 の `2016`、Q13 の `I'll be back`、読みだけの読点）、オフセット、やり直しの判定、timing.json の読み書き、publish の JSON 書き戻し（`fetch` を差し替え）と失敗時に書き戻さないこと |
| 手動 | Python 側はスパイクと同じ Q06・Q10・Q13 で実行して、スパイクの値と近いことを確かめる。デプロイ後、README の E2E チェックリストに音声付き早押しの項目を足して通す（いろいろな位置で押す、不正解で再開、GM 画面の再読み込み） |

## ドキュメント

同じ変更の中で更新する。

- `docs/overview.md`: スコープ外から「早押しの読み上げ音声のアプリ内再生」を外す。インフラ構成の R2 に音声を足す
- `docs/data-model.md`: `QuestionAudio`、`BuzzerState.positionMs`、バリデーション、音声の保存
- `docs/game-rules.md`: 早押しモードの音声付きの流れ（再開位置、読み上げ速度が効かないこと）
- `docs/protocol.md`: `/api/audio`、`QuestionView.audio`、`BuzzerView.positionMs`、タイトルの `audio`
- `docs/screens.md`: GM 画面の音声状態と「音声を有効にする」、管理画面の「音声あり」「音声を外す」
- `.claude/skills/quiz-tts/SKILL.md` と README: align・publish、`.env` の追加項目、制限の節の「同期は対象外」を外す

## スコープ外

- 参加者のスマホでの再生
- 音量調整や音声オフの切り替え
- 管理画面からの音声のアップロード・タイミングの手直し
- R2 に残った使われない音声の削除
- 確認用の動画（文字と音声を重ねた mp4）を作るコマンド

## リスク

- アライメントの精度を確かめたのは 3 問だけ。数字と英語（表示だけ）は対処済み。記号や略語で読みと表記が大きく違う問は align の警告で気づけるようにし、残る問はデプロイ後の手動確認で見る
- ブラウザの mp3 デコードが LAME のギャップレス情報（エンコーダーの遅延）を無視すると、音声が 25〜50 ms 遅れて聞こえる。手動確認でずれを感じたら、`join` の mp3 化か `revealAtMs` に一定の補正を入れる
- GM 画面の時計補正は `state` の `serverTime` との差で、片道の遅れを含む。GM 画面の音と文字は同じ時計で動くので互いにはずれない。サーバーの止まる位置との差は数十 ms 程度
