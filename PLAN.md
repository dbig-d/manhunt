# Manhunt — Project Plan

An IRL hide-and-seek game played through a mobile website. Hiders get a head start, then seekers hunt them using periodic location pings on a live map. Safe zones spawn during the game; hiders collect coins there and spend them on power-ups.

---

## 1. Decisions so far

| Area | Decision |
|---|---|
| Platform | Mobile website (PWA, installable to home screen) |
| Players per game | 10–25 |
| Joining | Room code + nickname, no accounts |
| Audience | Friends first, built so it can go public later |
| Builder | Claude builds; owner is a beginner → simple, well-explained stack |
| Budget | Free tier; willing to pay a few $/month only for a big upgrade (e.g. satellite map) |
| First release | Core loop only, playtest IRL, then add features |
| Visual style | Claude proposes 2–3 directions to pick from |

**Guiding principle:** almost everything is a **host setting** in the lobby, and **game modes are presets of those settings**. This keeps the game easy to expand with new modes later.

---

## 2. Game flow

```
Create room → Lobby (players join by code, host edits settings)
           → Roles assigned → Head start countdown
           → Hunt (pings, tags, zones, power-ups)
           → Game over → Results + movement recap → Play again (same lobby)
```

### Lobby (Among Us–style)
- Big room code at the top and a player list with role badges.
- Host-only **settings panel**: changes appear live for everyone.
- Host can kick players, start the game, and pass host to someone else.
- If the host disconnects, host automatically moves to the next player.

### Host settings (with defaults)

**Roles**
- Assignment: `Random` (host sets seeker count) / `Host picks` / `Players volunteer`
- Seeker count: 2

**Game mode** (see §3): Classic

**Timing**
- Head start: 5 min (seekers can see the map and boundary during it, but no hiders)
- Game length: 30 min
- Ping interval: 60 s (range 30 s – 5 min)
- Speed-up near the end: off / on (e.g. interval halves in the final 5 min)

**Pings & visibility**
- Ping style: `Exact dot` / `Fuzzy circle` (~25 m, with the real position offset from the center)
- What hiders see of seekers: `Nothing` / `Seekers pinged less often` (own interval) / `Proximity warning only`
- Teammate visibility: `Seekers see each other` / `Both teams see teammates` / `Nobody sees teammates`

**Boundary**
- Shape: `Circle` (center + radius) / `Rectangle` (width × height, movable/rotatable)
- Saved areas: reuse a boundary saved on the host's device ("School field", "Park")
- Out-of-bounds penalty: `Warn only` / `Warn → reveal location live` / `Warn → eliminated`, plus a grace period (15 s)
- Shrinking zone: off / on (shrinks in steps toward a random point inside)

**Tagging**
- `Honor`: hider taps "I got tagged" → confirms → out
- `QR scan`: hider's screen shows a QR code that changes every few seconds (so screenshots don't work); the seeker scans it with their camera

**Phone safety net**
- Keep the screen awake during games (Wake Lock API)
- "Location lost" banner on the player's screen
- Stale-location penalty: if no update for 90 s → `Flag to everyone` / `Auto-reveal` / `Off`

**Safe zones** (phase 2): count, spawn frequency, duration, coin rate, ping effect (see §4)

**Economy** (phase 3): enable/disable each power-up, prices, per-game limits, seeker economy on/off

### Win conditions (all active together)
- Timer runs out with ≥1 hider alive → **hiders win**
- All hiders tagged → **seekers win**
- Host presses "End game" → current standings
- Individual awards: last hider standing, most tags, longest survival, most coins

---

## 3. Game modes

Modes are setting presets plus a few special rules. New modes can be added without rewriting the game.

| Mode | What's different | Phase |
|---|---|---|
| **Classic** | Tagged hiders become spectators (they see everyone live) | 1 |
| **Infection** | Tagged hiders become seekers; the seeker team grows | 1 |
| **Night Time** | Hiders can't see each other, the remaining-hider count is hidden, and the UI shows only a timer | 4 |
| **Storm** | Shrinking boundary always on | 4 |
| *(future)* | Ideas: Juggernaut (1 hider vs everyone), Teams, Capture-the-flag | — |

---

## 4. Safe zones & coins (phase 2)

- **Everyone can see** zones on the map, so they're risky to visit.
- They spawn at random points inside the boundary. The host sets **how many are active at once, how often they spawn, and how long they last** (defaults: 1 at a time, a new one every 4 min, each lasting 3 min).
- On-map countdown ring shows each zone's remaining time.
- **Coins are split among the hiders inside a zone.** Each zone produces a fixed rate (default 6 coins/min) that's divided between everyone in it, which pushes hiders to spread out.
- **Zones don't protect you**: you can still be tagged inside one.
- Host toggle for ping effect inside a zone: `None` / `Entering a zone alerts seekers` / `Pings are fuzzier while inside`.

---

## 5. Power-ups (phase 3)

The shop can be opened anywhere. The host can toggle each item and edit prices and per-game limits. Proposed defaults (balanced against ~6 coins/min for a hider alone in a zone):

### Hider — stealth
| Item | Effect | Price |
|---|---|---|
| Jammer | Your next ping is sent 30 s late, so it shows where you *were* | 10 |
| Ghost | Skip your next ping (seekers keep seeing your old dot) | 15 |
| Decoy | Next ping shows you 50–100 m away at a random point in bounds | 20 |
| Static | Your pings are big fuzzy circles for 3 min | 20 |

### Hider — intel & disruption
| Item | Effect | Price |
|---|---|---|
| Proximity alarm | Alert if a seeker is within ~40 m, for 3 min | 15 |
| Radar | See all seekers' positions for 10 s | 25 |
| Blackout | All seekers' maps go dark for 20 s | 40 |
| Revive | Bring back one tagged hider (max 1 per game) | 60 |

### Seeker economy (host toggle, off by default)
Seekers earn coins per tag (default 20).
| Item | Effect | Price |
|---|---|---|
| Zone scan | See which zones currently have hiders inside | 15 |
| Instant ping | Trigger a ping right now | 20 |
| Tracker | See the nearest hider's position for 5 s | 30 |

---

## 6. Communication (phase 4)

- **Team chat**: seekers ↔ seekers, hiders ↔ hiders. Spectators/eliminated get their own channel.
- **Quick pings**: one-tap presets ("Going north", "Spotted one!", "Need help", "Zone is clear") that also drop a marker on your teammates' maps.

---

## 7. After the game

- **Results screen**: winner, awards, and per-player stats (tags, survival time, coins earned, power-ups used, distance run).
- **Movement recap** plays instantly alongside the results: everyone's paths animated on the map, with tags and power-up moments marked.
- **Privacy:** location history exists only for the recap and is **deleted once the recap is over** (with a safety auto-delete if the room is abandoned).
- **Play again**: one tap returns everyone to the same lobby with the same settings.

---

## 8. Tech plan

Chosen for: free hosting, real-time multiplayer, and a simple single-repo setup that Claude can build and explain.

| Piece | Choice | Why |
|---|---|---|
| Frontend | **React + TypeScript + Vite**, installable PWA | Standard and well documented |
| Map | **MapLibre GL** + **OpenFreeMap** tiles (free, no API key) | Free, and supports custom dark/bright styles. Paid upgrade path: MapTiler satellite view |
| Geometry | **Turf.js** | Point-in-circle/rectangle, distances, random points in bounds |
| Backend | **Cloudflare Workers + Durable Objects** | One Durable Object = one game room. It holds the game state, runs timers (pings, zones, game clock), and talks to phones over WebSockets. Free tier covers this group size easily |
| Hosting | Cloudflare (same deploy as backend) | One `deploy` command; free HTTPS (required for GPS on phones) |
| QR | Camera scanning library (e.g. `jsQR`) | Works on iOS + Android browsers |

### Key technical rules
1. **The server decides what each phone sees.** Phones send their GPS to the room every ~3–5 s, but the server only forwards hider positions to seekers at ping time, and only in the allowed form (exact or fuzzy). Otherwise a seeker could inspect network traffic and see everyone live.
2. **Reconnects are normal.** Players get a secret rejoin token saved on their device, so a refresh or a signal drop puts them right back in the game.
3. **All timers run on the server** so every phone agrees on when pings, zones and the game end happen.
4. **Phone limitations:**
   - Location can pause when the screen locks → wake lock, a warning banner, and the stale-location penalty.
   - **iPhones don't support vibration from websites**, so the proximity alarm and warnings use sound and a flashing screen on iOS.
   - GPS is often off by 5–15 m, which is why tagging is by honor or QR and never automatic.

---

## 9. Build phases

### Phase 0 — Setup & look (short)
- Project scaffold, Cloudflare account, first deploy of a "hello" page
- **2–3 visual style directions** (e.g. dark tactical, bright playful, clean outdoor-readable) to pick from

### Phase 1 — Core loop (first playtest) ⭐ — built
Visual style: **Night Ops** (dark tactical). Testing aids added in this phase: bots that move around (host adds them in the lobby) and simulated GPS (TEST tab). **Remove the bots in Phase 2** once the core logic is proven.

- Create/join room by code, nickname, rejoin token
- Lobby with live host settings panel, kick, host transfer
- Role assignment (all 3 methods)
- Boundary: circle + rectangle, saved areas on device
- Head start countdown
- Live map: own position, boundary, teammates (per setting)
- Pings: interval, speed-up, exact/fuzzy, hider view of seekers (3 options)
- Out-of-bounds warnings + penalties
- Tagging: honor + QR
- Modes: Classic + Infection
- Win conditions + host "End game"
- Wake lock + stale-location detection
- Results screen (basic stats) + Play again
- ➜ **Playtest IRL with friends, then tune the defaults**

### Phase 2 — Safe zones & coins
- Remove the Phase 1 test bots (keep simulated GPS behind a dev-only switch)
- Zone spawning with host settings, countdown rings, split-coin economy, zone ping-effect toggle

### Phase 3 — Power-ups
- Shop UI, all 8 hider items, host price/limit editor, optional seeker economy + 3 seeker items

### Phase 4 — Social & extras
- Team chat + quick pings
- Movement recap on the results screen (then auto-delete)
- Night Time mode, Storm (shrinking zone) mode
- Polish: sounds, animations, onboarding/how-to-play screen

### Phase 5 — Going public (later, optional)
- Safety notice (watch for roads/traffic, play in agreed areas), basic rate limiting/abuse protection, optional accounts for stats, nicer map tier if worth it

---

## 10. Location while the app is in the background

A website can't get the phone's location while another app is open or the screen is off. iPhones and Android both stop sending location updates to a page as soon as it's not on screen. What the website does instead:
- Keeps the screen on during games (Wake Lock API, with a silent-video fallback for older iPhones)
- Flags or reveals players whose location goes quiet (the stale-location setting)

Real background location needs a native app, e.g. wrapping this website with Capacitor plus a background-location plugin:
- **Android:** an installable app (APK) can be built for free, even from GitHub Actions.
- **iPhone:** needs a Mac to build and an Apple Developer account ($99/year) to install on phones beyond short-lived test installs.

## 11. Still open (decide later)
- Exact default numbers after the first playtest (ping interval, zone rates, prices)
- Which visual direction to use (Phase 0)
- Final name/branding and domain (a free `*.workers.dev` address works to start)
