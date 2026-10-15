import { useEffect, useState } from "react";
import type { BuzzerView } from "../../shared/messages";
import { audioStartMs } from "./audioPlayback";

let ctx: AudioContext | null = null;

/** GM 画面で使い回す AudioContext。ブラウザの自動再生の制限で、クリックの中で unlockAudio() するまで suspended のことがある */
function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** クリックなどの操作の中で呼び、音声を流せる状態にする（「読み上げ開始」「音声を有効にする」） */
export function unlockAudio(): void {
  audioContext().resume().catch(() => {});
}

export type AudioLoadStatus = "loading" | "ready" | "error";

/** 問読み音声を取得して丸ごとデコードしておく。読み上げ中に再生が詰まらないよう、問題を開いた時点で読み込む */
export function useQuestionAudio(url: string | undefined): { status: AudioLoadStatus | null; buffer: AudioBuffer | null } {
  const [state, setState] = useState<{ status: AudioLoadStatus | null; buffer: AudioBuffer | null }>({ status: null, buffer: null });
  useEffect(() => {
    if (!url) { setState({ status: null, buffer: null }); return; }
    let cancelled = false;
    setState({ status: "loading", buffer: null });
    fetch(url)
      .then((res) => { if (!res.ok) throw new Error(`audio ${res.status}`); return res.arrayBuffer(); })
      .then((bytes) => audioContext().decodeAudioData(bytes))
      .then((buffer) => { if (!cancelled) setState({ status: "ready", buffer }); })
      .catch(() => { if (!cancelled) setState({ status: "error", buffer: null }); });
    return () => { cancelled = true; };
  }, [url]);
  return state;
}

/**
 * 早押しの状態に合わせて問読み音声を流す・止める。
 * 区間（status・開始時刻・再生位置）が変わるたびに今の再生を止め、audioStartMs() が位置を返せばそこから流し直す。
 * blocked は、流すべきなのに自動再生の制限で止まっていること（「音声を有効にする」を出す）
 */
export function useBuzzerAudio(buffer: AudioBuffer | null, buzzer: BuzzerView | null, clockOffsetMs: number): { blocked: boolean } {
  const [ctxState, setCtxState] = useState<AudioContextState>(() => audioContext().state);
  useEffect(() => {
    const c = audioContext();
    const onChange = () => setCtxState(c.state);
    c.addEventListener("statechange", onChange);
    onChange();
    return () => c.removeEventListener("statechange", onChange);
  }, []);

  useEffect(() => {
    if (!buffer || ctxState !== "running") return;
    const c = audioContext();
    // 出力の遅れ（Bluetooth では 0.1〜0.3 秒）の分だけ先から流す。取れない環境では 0
    const latencyMs = ((c.outputLatency || c.baseLatency || 0) as number) * 1000;
    const startMs = audioStartMs(buzzer, Date.now() + clockOffsetMs, latencyMs);
    if (startMs === null || startMs / 1000 >= buffer.duration) return;
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(c.destination);
    source.start(0, startMs / 1000);
    return () => {
      source.stop();
      source.disconnect();
    };
    // 区間を決める値だけで張り直す（キューの出入りなどでは流し直さない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer, ctxState, buzzer?.status, buzzer?.readingStartedAt, buzzer?.positionMs, buzzer?.revealedChars, buzzer?.promptLength, clockOffsetMs]);

  const wantsToPlay = !!buffer && audioStartMs(buzzer, Date.now() + clockOffsetMs) !== null;
  return { blocked: wantsToPlay && ctxState !== "running" };
}
