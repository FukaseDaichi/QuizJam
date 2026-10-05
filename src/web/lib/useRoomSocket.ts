import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ClientMessage, ServerMessage } from "../../shared/messages";
import { applyServerMessage, initialClientState, setConnected, type ClientState } from "./clientState";

type Action =
  | { kind: "message"; msg: ServerMessage; now: number }
  | { kind: "connected"; value: boolean }
  | { kind: "dismissPopup"; id: number }
  | { kind: "clearError" };

function reducer(s: ClientState, a: Action): ClientState {
  switch (a.kind) {
    case "message": return applyServerMessage(s, a.msg, a.now);
    case "connected": return setConnected(s, a.value);
    case "dismissPopup": return { ...s, popups: s.popups.filter((p) => p.id !== a.id) };
    case "clearError": return { ...s, lastError: null };
  }
}

export function useRoomSocket(roomCode: string | null, token: string | null) {
  const [state, dispatch] = useReducer(reducer, initialClientState);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    if (!roomCode || !token) return;
    // effect 実行ごとに閉じたフラグを持つ。共有 ref だと StrictMode の二重実行で
    // 古い接続の onclose が新しい effect の再接続を誘発し、接続が2本になる
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current: WebSocket | null = null;

    const connect = () => {
      if (cancelled) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/room/${encodeURIComponent(roomCode)}?token=${encodeURIComponent(token)}`);
      current = ws;
      wsRef.current = ws;
      ws.onopen = () => { if (!cancelled) { retryRef.current = 0; dispatch({ kind: "connected", value: true }); } };
      ws.onmessage = (ev) => {
        if (cancelled) return;
        try { dispatch({ kind: "message", msg: JSON.parse(ev.data as string) as ServerMessage, now: Date.now() }); } catch { /* ignore */ }
      };
      ws.onclose = () => {
        if (cancelled) return;
        dispatch({ kind: "connected", value: false });
        const delay = Math.min(10_000, 500 * 2 ** retryRef.current++);
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };
    connect();

    const onVisible = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible" && current?.readyState !== WebSocket.OPEN) {
        if (timer) clearTimeout(timer);
        retryRef.current = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
      current?.close();
      if (wsRef.current === current) wsRef.current = null;
    };
  }, [roomCode, token]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);
  const dismissPopup = useCallback((id: number) => dispatch({ kind: "dismissPopup", id }), []);
  const clearError = useCallback(() => dispatch({ kind: "clearError" }), []);

  return { state, send, dismissPopup, clearError };
}
