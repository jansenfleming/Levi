# Levi: Alien Town

An experiment: an autonomous AI alien lives alone in a small procedural 3D cyberpunk town.
He has no tasks, no goals and nobody telling him what to do. Anyone can watch him live in a browser.

## Status

- **Phase 1 (done):** procedural 3D town (Three.js), the alien with walk/idle/sit/read/play/eat
  animations, street-grid pathfinding, follow/orbit camera, building fade, thought bubble,
  side panel, phone layout.
- **Phase 2 (done):** the server owns the world: real-time simulation (1 s tick), needs, simulated
  weather, state saved to `data/state.json`, one-way WebSocket at `/ws` with a full snapshot for
  late joiners. Decisions come from a random **placeholder decider** until the brain arrives.
- **Phase 3 (done):** the Ollama brain (`think: false`, JSON-schema `format`, validation, one
  retry, then a safe fallback), a timestamped memory stream with a rolling summary, a full
  decision log in SQLite (`data/alien.db`), early re-decisions when the weather changes while
  he's outdoors, and a brain-offline mode where he dozes/daydreams and recovers automatically.
  Phase 4: journal, reflection, `/stats`. Phase 5: deployment (systemd, Pi, Cloudflare Tunnel).

## Run

```bash
npm install
cp .env.example .env   # adjust if needed; .env is git-ignored
npm run dev            # dev mode: no caching, restarts on server changes
# or: npm start
```

Open http://localhost:8080.

Fast simulation for development: `SIM_SPEED=20 DATA_DIR=data-dev npm run dev` (the clock stays real;
walking, activities, needs and weather run faster).

Debug URL parameters: `?demo` (phase-1 scripted loop in the browser, no server state),
`?hour=13` (preview daytime lighting), `?debug` (exposes `window.__town`).

## What Levi can do

Nobody tells him what to do; these are the things the world lets him do. He picks freely.

- **Places in town:** sleep, rest, read, eat, play, recharge, sit, look at the pond, watch the hologram.
- **Anywhere:** wander, sit and think, do nothing, and `something_else` (anything not on the list, in his words).
- **Journal:** real entries he writes, shown on the site.
- **Make things in town:** sculptures, signs, murals, lights or plants on 18 street corners, rendered in 3D.
- **Websites:** HTML/CSS pages he writes, published at `/levi/sites/<slug>/` with a sandbox CSP:
  no scripts, no external loads, opaque origin, can't be framed.
- **Read the web:** search (Wikipedia by default, or your SearXNG via `SEARXNG_URL`) and read public
  pages. Private/LAN/loopback addresses are refused at connect time, so he can't reach Ollama or your
  network. Rate-limited (`WEB_FETCHES_PER_HOUR`); every request is in the `web_log` table.
- **Currency:** he can create and use a currency that only exists in town (public ledger, no real money).
- **His list:** every decision returns his own list of things he intends to do; it's shown on the site.

Everything he makes is public at `/levi` as soon as he makes it.

### Hiding something he published

```bash
npm run admin -- list
npm run admin -- hide site <slug>          # or: creation <id>, journal <id>, ledger <id>
npm run admin -- unhide site <slug>
```

Websites disappear immediately; things in town and the journal within 30 seconds.

## The brain

- System prompt: *"Your name is Levi. You are an alien who has arrived in this small town. You have no
  obligations and no one will tell you what to do."*, a factual list of what the world allows, and the
  answer format. See `server/brain/prompt.ts`.
- Each decision gets: town time and part of day, weather, location, needs, a summary of older
  memories, recent memories, and every action with walking time and allowed duration. The action
  list is shuffled each time to avoid position bias (the order is logged).
- Swap models with `OLLAMA_MODEL=...` (every decision records which brain made it), or run without
  a model using `BRAIN=placeholder`.

Inspect the experiment data:

```bash
sqlite3 -header data/alien.db "select datetime(t/1000,'unixepoch','localtime') t, brain, action, minutes, valid, fallback, latency_ms, thought from decisions order by id desc limit 20"
```

Tables: `decisions` (context, exact prompt, raw output, chosen action, needs before/after,
latency, retries, fallback), `work_log` (every follow-up generation: journal, website, build,
currency, browsing), `memories`, `summaries`, `plans`, `journal`, `sites`, `site_versions`,
`creations`, `currency`, `ledger`, `web_log`.

## Layout

- `server/index.ts`: HTTP server (Node runs the TypeScript directly; no build step). Strict CSP,
  serves `public/` plus Three.js from `node_modules`.
- `server/sim.ts`: the simulation. `server/actions.ts`: the action catalog, duration limits, need effects.
  `server/decider.ts`: the brain interface. `server/brain/`: Ollama implementation and prompts.
  `server/memory.ts`: memory stream and summaries. `server/db.ts`: SQLite.
  `server/weather.ts`, `server/hub.ts` (WebSocket).
- `public/shared/town.js`: town map, places, activity spots, pathfinding. Shared with the server later.
- `public/js/`: renderer (`main.js`), city (`city.js`), alien (`alien.js`), rain/cars/day-night
  (`effects.js`), procedural textures, UI, and the phase-1 scripted source (`scripted.js`).

## Security

- Ollama (port 11434) is never exposed; only this web server is public.
- All alien/model text is rendered with `textContent`.
- Visitors are watch-only; nothing they do reaches the simulation or the model.
