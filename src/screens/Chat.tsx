import { useEffect, useRef, useState } from "react";
import type { Channel, ChatMessage, ClientMessage, RoomView } from "../../shared/protocol";
import Icon from "../components/Icon";
import { Sheet } from "../components/ui";

const CHANNEL_LABEL: Record<Channel, string> = {
  all: "Everyone in the room",
  seekers: "Seekers only",
  hiders: "Hiders only",
  out: "Spectators",
};

// One tap sends these, and in a game they also drop a flag on your teammates' maps.
const QUICK: Record<Channel, string[]> = {
  hiders: ["I'm hidden", "Seeker nearby!", "Heading to a zone", "Need help", "All clear"],
  seekers: ["Spotted one!", "On my way", "Cover the exits", "Check that zone", "Lost them"],
  out: ["So close!", "Nice hide", "GG"],
  all: ["Ready!", "One sec", "Let's go"],
};

export default function Chat({ view, messages, send, onClose }: { view: RoomView; messages: ChatMessage[]; send: (m: ClientMessage) => void; onClose: () => void }) {
  const channel = view.me.channel;
  const list = messages.filter((m) => m.channel === channel);
  const [text, setText] = useState("");
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [list.length]);

  const submit = () => {
    const clean = text.trim();
    if (!clean) return;
    send({ type: "chat", text: clean });
    setText("");
  };

  return (
    <Sheet title="Team chat" onClose={onClose}>
      <div className="chat">
        <div className="chat-channel">
          <Icon name="users" size={16} />
          {CHANNEL_LABEL[channel]}
        </div>
        <div className="chat-log" ref={log}>
          {list.length === 0 && <p className="chat-empty">No messages yet. Say hi, or use a quick ping below.</p>}
          {list.map((m) => (
            <div key={m.id} className={`chat-msg ${m.fromId === view.me.id ? "chat-msg--me" : ""} ${m.quick ? "chat-msg--quick" : ""}`}>
              <b>{m.fromId === view.me.id ? "You" : m.name}</b>
              <span>{m.text}</span>
            </div>
          ))}
        </div>
        <div className="chat-quick">
          {QUICK[channel].map((q) => (
            <button key={q} onClick={() => send({ type: "chat", text: q, quick: true })}>
              {q}
            </button>
          ))}
        </div>
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input value={text} maxLength={200} placeholder="Message your team" onChange={(e) => setText(e.target.value)} aria-label="Message" />
          <button className="btn btn--primary" disabled={!text.trim()} aria-label="Send">
            <Icon name="send" size={18} />
          </button>
        </form>
      </div>
    </Sheet>
  );
}
