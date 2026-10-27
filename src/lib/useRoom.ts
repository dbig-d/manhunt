import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ClientMessage, GameEvent, RoomView, ServerMessage } from "../../shared/protocol";
import { wsUrl } from "./api";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

type Listener = (e: { kind: "event"; event: GameEvent } | { kind: "error"; message: string }) => void;

// The rejoin token lives in sessionStorage: it survives a refresh, but each tab is
// its own player, so you can test with several tabs side by side.
const tokenKey = (code: string) => `mh:token:${code}`;
const CHAT_KEEP = 100;

/** Live connection to one game room, reconnecting automatically when the signal drops. */
export function useRoom(code: string | null, name: string) {
  const [view, setView] = useState<RoomView | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [fatal, setFatal] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const offsetRef = useRef(0);
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    if (!code) return;
    let stopped = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let keepAlive: ReturnType<typeof setInterval> | undefined;
    let ws: WebSocket;

    setView(null);
    setFatal(null);
    setMessages([]);
    setStatus("connecting");

    const emit: Listener = (e) => listeners.current.forEach((fn) => fn(e));
    const addMessages = (list: ChatMessage[]) =>
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const merged = [...prev, ...list.filter((m) => !seen.has(m.id))].sort((a, b) => a.at - b.at);
        return merged.slice(-CHAT_KEEP);
      });

    const connect = () => {
      ws = new WebSocket(wsUrl(`/api/rooms/${code}/ws`));
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setStatus("open");
        const token = sessionStorage.getItem(tokenKey(code)) ?? undefined;
        ws.send(JSON.stringify({ type: "join", name, token } satisfies ClientMessage));
        keepAlive = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
      };

      ws.onmessage = (e) => {
        if (e.data === "pong") return;
        const msg: ServerMessage = JSON.parse(e.data);
        switch (msg.type) {
          case "welcome":
            sessionStorage.setItem(tokenKey(code), msg.token);
            break;
          case "state":
            offsetRef.current = msg.now - Date.now();
            setView(msg.view);
            break;
          case "chatHistory":
            addMessages(msg.messages);
            break;
          case "event":
            if (msg.event.kind === "chat") addMessages([msg.event.msg]);
            emit({ kind: "event", event: msg.event });
            break;
          case "error":
            if (msg.fatal) {
              stopped = true;
              sessionStorage.removeItem(tokenKey(code));
              setFatal(msg.message);
              setStatus("closed");
            } else {
              emit({ kind: "error", message: msg.message });
            }
            break;
        }
      };

      ws.onclose = () => {
        clearInterval(keepAlive);
        if (stopped) return;
        setStatus("reconnecting");
        retryTimer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };

    connect();

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(keepAlive);
      ws.onclose = ws.onmessage = null;
      // Closing mid-handshake leaves a ghost connection on the server, so wait until it opens.
      if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
      else ws.close();
      wsRef.current = null;
    };
  }, [code, name]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return { view, status, fatal, send, subscribe, serverNow, messages };
}

export type Room = ReturnType<typeof useRoom>;

export function forgetRoom(code: string) {
  sessionStorage.removeItem(tokenKey(code));
}
