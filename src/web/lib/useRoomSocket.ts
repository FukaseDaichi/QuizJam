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
  const closedByUser = useRef(false);

  useEffect(() => {
    if (!roomCode || !token) return;
    closedByUser.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/room/${encodeURIComponent(roomCode)}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      ws.onopen = () => { retryRef.current = 0; dispatch({ kind: "connected", value: true }); };
      ws.onmessage = (ev) => {
        try { dispatch({ kind: "message", msg: JSON.parse(ev.data as string) as ServerMessage, now: Date.now() }); } catch { /* ignore */ }
      };
      ws.onclose = () => {
        dispatch({ kind: "connected", value: false });
        if (closedByUser.current) return;
        const delay = Math.min(10_000, 500 * 2 ** retryRef.current++);
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };
    connect();

    const onVisible = () => {
      if (document.visibilityState === "visible" && wsRef.current?.readyState !== WebSocket.OPEN) {
        if (timer) clearTimeout(timer);
        retryRef.current = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closedByUser.current = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
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
