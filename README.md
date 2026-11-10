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
- Phase 3: Ollama brain, memory, decision log.
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

## Layout

- `server/index.ts`: HTTP server (Node runs the TypeScript directly; no build step). Strict CSP,
  serves `public/` plus Three.js from `node_modules`.
- `server/sim.ts`: the simulation. `server/actions.ts`: the action catalog, duration limits, need effects.
  `server/decider.ts`: the swappable decision interface. `server/weather.ts`, `server/hub.ts` (WebSocket).
- `public/shared/town.js`: town map, places, activity spots, pathfinding. Shared with the server later.
- `public/js/`: renderer (`main.js`), city (`city.js`), alien (`alien.js`), rain/cars/day-night
  (`effects.js`), procedural textures, UI, and the phase-1 scripted source (`scripted.js`).

## Security

- Ollama (port 11434) is never exposed; only this web server is public.
- All alien/model text is rendered with `textContent`.
- Visitors are watch-only; nothing they do reaches the simulation or the model.
