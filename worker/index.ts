export { GameRoom } from "./room";

// No 0/O or 1/I, so codes are easy to read out loud.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_WS_PATH = /^\/api\/rooms\/([A-Z0-9]{4})\/ws$/;

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

// The website may be hosted elsewhere (GitHub Pages), so let it call us from any origin.
// Nothing here uses cookies or logins, so this is safe.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true }, { headers: CORS });
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = randomCode();
        if (await env.GAME_ROOM.getByName(code).create(code)) return Response.json({ code }, { headers: CORS });
      }
      return Response.json({ error: "Couldn't create a room, try again" }, { status: 503, headers: CORS });
    }

    const match = url.pathname.match(ROOM_WS_PATH);
    if (match) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      return env.GAME_ROOM.getByName(match[1]).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
