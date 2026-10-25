# Manhunt

IRL hide-and-seek on your phone: hiders get a head start, seekers get pinged with hider locations on a live map. See [PLAN.md](PLAN.md) for the full design.

## Run it on your computer

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Testing without going outside (Phase 1)

- **Simulated GPS:** tap the **TEST** tab on the left edge and turn on *Simulated GPS*. Then click the map to teleport, or walk with **W A S D** / arrow keys (hold **Shift** to run).
- **Several players:** every browser tab is its own player. Open a second tab, turn on Simulated GPS there too, and join with the room code.
- **Bots:** in the lobby the host can add bots (+1 / +5). Bot hiders wander around and stop to "hide"; bot seekers chase the latest pings. Walk within 25 m of a pinged bot hider and a **Tag bot** button appears. Bots are for testing and get removed in Phase 2.
- **Quick games:** in the lobby, set Head start to 0:15, Ping every to 15 s and Game length to a few minutes.
- **QR tagging:** the browser can't use a webcam inside some previews; type the 4 digits under the hider's QR code instead.

## Other commands

| Command | What it does |
|---|---|
| `npm test` | Runs the game-rule tests (pings, visibility, tagging, win conditions, boundaries) |
| `npm run build` | Checks the code and builds the site into `dist/` |
| `npm run deploy` | Builds and publishes to Cloudflare (run `npx wrangler login` once first) |

## How it's put together

- `src/` is the website (React). `screens/` holds each screen, and `components/MapView.tsx` is the map.
- `worker/` is the server. `game.ts` holds all the game rules; `room.ts` is the live game room each phone connects to.
- `shared/` holds code both sides use: message types, settings and map maths.
