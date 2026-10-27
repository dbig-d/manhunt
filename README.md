# Manhunt

IRL hide-and-seek on your phone: hiders get a head start, seekers get pinged with hider locations on a live map. See [PLAN.md](PLAN.md) for the full design.

**Play:** https://dbig-d.github.io/manhunt/

## Where it's hosted

| Part | Where | How it updates |
|---|---|---|
| Website | GitHub Pages: https://dbig-d.github.io/manhunt/ | Automatically on every push to `main` (see `.github/workflows/pages.yml`) |
| Game server | Cloudflare Workers: https://manhunt.netherite2022.workers.dev | Run `npm run deploy` after changing anything in `worker/` or `shared/` |

The website finds the game server through the repository variable `API_URL`. The game server also serves its own copy of the website, so the workers.dev link works for playing too.

## Run it on your computer

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Testing without going outside (Phase 1)

- **Simulated GPS:** open **Testing tools** (on the home screen, or in the lobby and in-game menus) and turn on *Simulated GPS*. Then click the map to teleport, or walk with **W A S D** / arrow keys (hold **Shift** to run).
- **Several players:** every browser tab is its own player. Open a second tab, turn on Simulated GPS there too, and join with the room code.
- **Bots:** in the lobby the host can add bots (+1 / +5). Bot hiders wander around and stop to "hide"; bot seekers chase the latest pings. Walk within 25 m of a pinged bot hider and a **Tag bot** button appears. Bots are for testing and get removed in Phase 2.
- **Quick games:** in the lobby open **All rules** and set Head start to 0:15, Ping every to 15 s and Game length to a few minutes. Under *Safe zones*, "New zone every" 0:30 gets coins flowing fast.
- **Bots and coins:** hider bots wander into safe zones and collect coins too, so you can see coins being split. Turn off *Seeker bots can tag* (Rules → Phone) if they keep catching you while you test.
- **QR tagging:** the browser can't use a webcam inside some previews; type the 4 digits under the hider's QR code instead.

## Other commands

| Command | What it does |
|---|---|
| `npm test` | Runs the game-rule tests (pings, visibility, tagging, zones, power-ups, chat, modes, recap) |
| `npm run build` | Checks the code and builds the site into `dist/` |
| `npm run deploy` | Builds and publishes the game server to Cloudflare (needs `npx wrangler login` first) |
| `npm run build:pages` | Builds just the website the way GitHub Pages serves it |

## Themes

Tap **Theme** on the home screen (or *Appearance* in any menu) to switch between Dark, Gray and Light, and pick one of 10 accent colors. The choice is saved on each phone. Hider green and seeker red never change, so teams always look the same. The colors live in `src/index.css` (top of the file) and `src/lib/theme.ts`.

## How it's put together

- `src/` is the website (React). `screens/` holds each screen (lobby, rules editor, game, shop, chat, results), `components/MapView.tsx` is the map, and `index.css` is the whole Night Ops design.
- `worker/` is the server. `game.ts` holds all the game rules; `room.ts` is the live game room each phone connects to.
- `shared/` holds code both sides use: message types, settings, game modes (`modes.ts`), power-ups (`items.ts`) and map maths.
