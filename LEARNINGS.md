# Project Learnings

<!--
記法ルール:
- 1項目1洞察。複数の学びを1行に詰めない
- 各項目の先頭に日付を必ず入れる（例: - 2026-01-01: ...）
- 上4セクションは「生の観察」の置き場。Consolidated Principles には
  統合パスで抽出した原則だけを置く。両者を混ぜない
- 最終統合: （未実施）
-->

## Patterns That Work
（効いたやり方・型）

- 2026-11-23: 「選ぶまで参加できない」型のルールを設計したら、「遅く選ぶほうが得にならないか」も確かめる。得意ジャンル申告では、出題ジャンルが見えてから申告する・尽きたジャンルを申告する、の2つの抜け道が設計書の点検で見つかった
- 2026-11-23: 画面の実装をサブエージェントに任せたあと、型チェック・テスト・コードレビューが通っていても、自分でブラウザを通しで動かすと表示の不具合が見つかる。出題順が並び順と違うセットで、参加者画面だけ index+1 を使っていて「第6問」と出ていた。
- 2026-11-23: GM画面の効果音は、描画後の状態の差分ではなく reducer で数えた回数（state.se）の増分で鳴らす。buzzerUpdated の直後に questionClosed が来て描画がまとめられても、不正解SEを取りこぼさない。
- 2026-11-23: 自分では聞けない音の再生は、ブラウザで AudioBufferSourceNode.prototype.start を差し替えて buffer.duration を記録すると、どのSEが何回鳴ったかを長さで見分けて確かめられる。
- 2026-11-23: 本番デプロイの確認は curl に -L を付ける（本番 URL は 307 を返す）。トップ HTML の assets/index-*.js のハッシュが手元の npm run build の出力と同じかを比べると、新しいビルドが配信されているかを画面操作なしで確かめられる

## Mistakes to Avoid
（失敗と再発防止）

- 2026-11-23: ゲーム開始時にサーバーが参加者ごとの状態（得意ジャンルなど）を消しても、start で参加者を運ぶメッセージを配らないとクライアントに前ゲームの値が残る。エンジン単体のテストでは見つからず、Room 経由で2回目の start を通すテストと broadcastState() の追加で直った。
- 2026-11-23: push 直後に gh run list --commit <短縮SHA> で実行を探すと空が返り、gh run watch が HTTP 404 で落ちた。gh run list --branch main --json databaseId,headSha で ID を取ってから gh run watch <ID> --exit-status にすると待てた
- 2026-11-23: codex exec で -i/--image を付けると、後ろのプロンプトまで画像のパスとして読まれ「No prompt provided via stdin.」で止まる。--image <file> のあとに - を置き、プロンプトは標準入力から渡すと通った

## Domain Knowledge
（業務・仕様・環境の知識）

- 2026-11-23: 開きっぱなしの古いクライアントは、既知の state メッセージに新しいフェーズや項目が載っても再読み込みしない。再読み込みさせるには未知の type のメッセージを送る必要がある（isKnownServerMessage の判定は type だけ）
- 2026-11-23: auto モードでは .dev.vars の ADMIN_PASSPHRASE の値を表示するコマンドが分類器に拒否される。シェル変数に読んで curl のヘッダーに渡すだけなら通るので、ローカルへのセット投入は API でできるが、/admin 画面のログインが要る実機確認はユーザーに頼む必要がある。
- 2026-11-23: quiz-tts の align のログは tqdm の進捗行（Align: / Adjustment:）が \r 区切りで大量に混ざる。警告を探すときは tr '\r' '\n' してから進捗行と「Qnn: 揃え」を除くと、残りが警告だけになる
- 2026-11-23: QuizJam は main への push で GitHub Actions「CI / Deploy」が走り、test の後に D1 マイグレーションと wrangler deploy まで自動で行う。手で npm run deploy する必要はなく、push がそのまま本番反映になる
- 2026-11-23: auto モードでは、本番の DELETE /api/images/<key> を含む Bash コマンドは、1本にまとめた他の処理ごと分類器に拒否される。DELETE を外して実行し直すと、アップロードと PUT は通った

## Open Questions
（未解決の疑問）

## Consolidated Principles
（統合パスで抽出した原則。常時10個以内）
