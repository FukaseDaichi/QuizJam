"""quiz-tts align の Python 側。台本の読みを問題音声に強制アライメントし、単語ごとの時刻を返す。

標準入力: [{"id": "Q01", "wav": "<Qnn.wav のパス>", "text": "<読み>"}]（UTF-8 の JSON）
標準出力: {"Q01": [{"w": "東", "s": 0.36, "e": 0.72}, ...]}（秒）。失敗した問は {"Q01": {"error": "..."}}

無音への寄せ・問題文との対応づけなどの計算は Node 側（scripts/lib/timing.mjs）が持つ。
"""

import argparse
import contextlib
import json
import sys

import stable_whisper


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="small")
    args = parser.parse_args()
    jobs = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    out = {}
    # ライブラリの表示で標準出力の JSON を汚さないよう、処理中は標準エラーに回す
    with contextlib.redirect_stdout(sys.stderr):
        model = stable_whisper.load_model(args.model)
        for job in jobs:
            try:
                result = model.align(job["wav"], job["text"], language="ja")
                out[job["id"]] = [
                    {"w": w.word, "s": round(w.start, 3), "e": round(w.end, 3)} for w in result.all_words()
                ]
            except Exception as err:  # 1 問の失敗でほかの問を止めない
                out[job["id"]] = {"error": f"{type(err).__name__}: {err}"}
    sys.stdout.buffer.write(json.dumps(out, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    main()
