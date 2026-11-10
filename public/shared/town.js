// Shared town definition: street grid, places, activity spots and pathfinding.
// Used by the browser (rendering) and, from phase 2 on, by the server (simulation).
// Plain JS with no dependencies so both sides can import it as-is.

export const GRID = [-60, -30, 0, 30, 60]; // street centre lines, on both x and z
export const BLOCK = 30;                   // grid spacing
export const STREET_W = 8;                 // street width (curb to curb)
export const BLOCK_HALF = (BLOCK - STREET_W) / 2; // 11: half-size of a block's sidewalk slab
export const CURB_H = 0.3;                 // sidewalk height above the street
export const WALK_SPEED = 1.5;             // units per second

/** Block centre for block indices i (x) and j (z), 0..3 inside the walkable grid. */
export function blockCenter(i, j) {
  return [GRID[0] + BLOCK / 2 + i * BLOCK, GRID[0] + BLOCK / 2 + j * BLOCK];
}

// Which way a place's front faces. Rotation maps local +z (the front) to that world direction.
const SIDE_ANGLE = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };

/** Convert place-local coordinates to world coordinates. */
export function toWorld(place, lx, lz) {
  const a = SIDE_ANGLE[place.side];
  const [cx, cz] = blockCenter(place.block[0], place.block[1]);
  return [cx + lx * Math.cos(a) + lz * Math.sin(a), cz - lx * Math.sin(a) + lz * Math.cos(a)];
}
export function placeAngle(place) { return SIDE_ANGLE[place.side]; }

// Spots are [localX, localZ, yaw | {lookAt:[lx,lz]}]. yaw 0 = facing the street.
// pose: what the body does there. seat: seat height above the sidewalk (sitting poses).
export const PLACES = {
  pod: {
    name: 'HAB-7 Pod', block: [0, 2], side: 'E',
    activities: {
      sleep: { label: 'Sleeping', pose: 'sleep', spot: [0, 3.2, Math.PI], hidden: true },
      rest:  { label: 'Resting on the stoop', pose: 'sit', spot: [-3.5, 7.2, 0], seat: 0.45 },
    },
    generic: [3.5, 8, 0],
  },
  archive: {
    name: 'The Archive', block: [2, 1], side: 'N',
    activities: {
      read: { label: 'Reading', pose: 'read', spot: [-3, 7.2, 0], seat: 0.45 },
    },
    generic: [4, 8.5, 0],
  },
  noodle: {
    name: 'Noodle Bar', block: [1, 2], side: 'S',
    activities: {
      eat: { label: 'Eating noodles', pose: 'eat', spot: [-1.2, 6.3, Math.PI], seat: 0.6 },
    },
    generic: [6.5, 8.5, 0],
  },
  arcade: {
    name: 'Arcade', block: [1, 0], side: 'S',
    activities: {
      play: { label: 'Playing a game', pose: 'play', spot: [0, 6.4, Math.PI] },
    },
    generic: [6.5, 8.5, 0],
  },
  charge: {
    name: 'Charge Station', block: [3, 2], side: 'W',
    activities: {
      recharge: { label: 'Recharging', pose: 'charge', spot: [-2.2, 4.6, { lookAt: [-3.6, 3.2] }] },
    },
    generic: [5, 8.5, 0],
  },
  garden: {
    name: 'Neon Garden', block: [2, 2], side: 'S',
    activities: {
      sit:  { label: 'Sitting on the bench', pose: 'sit', spot: [0, 4.6, Math.PI], seat: 0.45 },
      pond: { label: 'Looking at the pond', pose: 'pond', spot: [3.6, 2.4, { lookAt: [0, -2] }] },
    },
    generic: [-6, 6, { lookAt: [0, -2] }],
  },
  plaza: {
    name: 'Hologram Plaza', block: [1, 1], side: 'E',
    activities: {
      watch: { label: 'Watching the hologram', pose: 'watch', spot: [2.5, 7.5, { lookAt: [0, 0] }] },
    },
    generic: [-5, 7, { lookAt: [0, 0] }],
  },
};

// Generic actions, available anywhere.
export const GENERIC_ACTIONS = {
  wander:  { label: 'Wandering', pose: 'walk' },
  think:   { label: 'Sitting and thinking', pose: 'think' },
  journal: { label: 'Writing in his journal', pose: 'journal' },
  nothing: { label: 'Doing nothing', pose: 'idle' },
};

// Blocks occupied by places (by "i,j"); everything else gets generic towers.
export const PLACE_BLOCKS = Object.fromEntries(
  Object.entries(PLACES).map(([id, p]) => [p.block.join(','), id]));

// ---------------------------------------------------------------------------
// Street graph: intersections + one door node per place, on the street in front of it.

function key(x, z) { return `${Math.round(x * 10) / 10},${Math.round(z * 10) / 10}`; }

function buildGraph() {
  const nodes = new Map(); // key -> {id, x, z}
  const add = (x, z, id) => {
    const k = key(x, z);
    if (!nodes.has(k)) nodes.set(k, { id: id || `n:${k}`, x, z, adj: [] });
    else if (id) nodes.get(k).id = id;
    return nodes.get(k);
  };
  for (const x of GRID) for (const z of GRID) add(x, z);

  // Door nodes split the street segment they sit on.
  const doors = {};
  for (const [id, p] of Object.entries(PLACES)) {
    const [dx, dz] = toWorld(p, 0, BLOCK / 2);
    doors[id] = add(dx, dz, `door:${id}`);
  }

  // Link consecutive points along every grid line.
  const all = [...nodes.values()];
  const link = (a, b) => { const d = Math.hypot(a.x - b.x, a.z - b.z); a.adj.push([b, d]); b.adj.push([a, d]); };
  for (const g of GRID) {
    const alongX = all.filter((n) => Math.abs(n.z - g) < 0.01).sort((a, b) => a.x - b.x);
    const alongZ = all.filter((n) => Math.abs(n.x - g) < 0.01).sort((a, b) => a.z - b.z);
    for (const line of [alongX, alongZ]) for (let k = 1; k < line.length; k++) link(line[k - 1], line[k]);
  }
  return { nodes: all, doors };
}

export const GRAPH = buildGraph();
export const INTERSECTIONS = GRAPH.nodes.filter((n) => n.id.startsWith('n:'));

function nearestNode(x, z) {
  let best = null, bd = Infinity;
  for (const n of GRAPH.nodes) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

function dijkstra(from, to) {
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const open = new Set([from]);
  while (open.size) {
    let u = null, ud = Infinity;
    for (const n of open) { const d = dist.get(n); if (d < ud) { ud = d; u = n; } }
    open.delete(u);
    if (u === to) break;
    for (const [v, w] of u.adj) {
      const nd = ud + w;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); open.add(v); }
    }
  }
  const out = [];
  for (let n = to; n; n = prev.get(n)) { out.unshift(n); if (n === from) break; }
  return out[0] === from ? out : [from, to];
}

// ---------------------------------------------------------------------------
// Locations. A location is where the alien is or is going:
//   { place: 'garden', activity: 'sit' }        -> that activity's spot
//   { place: 'garden', activity: null }         -> the place's generic spot
//   { node: 'n:0,30' }                          -> a street intersection

function resolveYaw(place, yawSpec, lx, lz) {
  if (typeof yawSpec === 'number') return yawSpec + placeAngle(place);
  const [tx, tz] = toWorld(place, yawSpec.lookAt[0], yawSpec.lookAt[1]);
  const [x, z] = toWorld(place, lx, lz);
  return Math.atan2(tx - x, tz - z);
}

/** World position + facing of a location: {x, z, yaw, attach} where attach is the graph node it connects to. */
export function locate(loc) {
  if (loc.place) {
    const p = PLACES[loc.place];
    const spot = loc.activity ? p.activities[loc.activity].spot : p.generic;
    const [x, z] = toWorld(p, spot[0], spot[1]);
    return { x, z, yaw: resolveYaw(p, spot[2], spot[0], spot[1]), attach: GRAPH.doors[loc.place] };
  }
  const n = GRAPH.nodes.find((q) => q.id === loc.node) || nearestNode(0, 0);
  // Sit on the sidewalk corner rather than in the middle of the intersection.
  return { x: n.x + 4.6, z: n.z + 4.6, yaw: Math.PI * 1.25, attach: n, corner: true, nx: n.x, nz: n.z };
}

/** Path (array of [x, z]) from one location to another along the streets. */
export function findPath(fromLoc, toLoc) {
  const a = locate(fromLoc), b = locate(toLoc);
  const pts = [[a.x, a.z]];
  // Leave the spot: step to the curb in front of it, then to the door node.
  if (fromLoc.place) {
    const p = PLACES[fromLoc.place];
    const curb = toWorld(p, fromLoc.activity ? p.activities[fromLoc.activity].spot[0] : p.generic[0], BLOCK_HALF - 0.5);
    pts.push(curb);
  } else if (a.corner) pts.push([a.nx + 3.4, a.nz + 3.4]);
  if (fromLoc.place && toLoc.place === fromLoc.place) {
    // Same place: walk along the frontage.
    const p = PLACES[toLoc.place];
    const s = toLoc.activity ? p.activities[toLoc.activity].spot : p.generic;
    pts.push(toWorld(p, s[0], BLOCK_HALF - 0.5));
    pts.push([b.x, b.z]);
    return dedupe(pts);
  }
  for (const n of dijkstra(a.attach, b.attach)) pts.push([n.x, n.z]);
  if (toLoc.place) {
    const p = PLACES[toLoc.place];
    const s = toLoc.activity ? p.activities[toLoc.activity].spot : p.generic;
    pts.push(toWorld(p, s[0], BLOCK_HALF - 0.5));
  } else if (b.corner) pts.push([b.nx + 3.4, b.nz + 3.4]);
  pts.push([b.x, b.z]);
  return dedupe(pts);
}

function dedupe(pts) {
  return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.05);
}

export function pathLength(path) {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return L;
}

/** Position and heading at distance d along a path. */
export function samplePath(path, d) {
  for (let i = 1; i < path.length; i++) {
    const [x0, z0] = path[i - 1], [x1, z1] = path[i];
    const seg = Math.hypot(x1 - x0, z1 - z0);
    if (d <= seg || i === path.length - 1) {
      const t = seg > 0 ? Math.min(1, Math.max(0, d / seg)) : 1;
      return { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, yaw: Math.atan2(x1 - x0, z1 - z0), done: d >= seg && i === path.length - 1 };
    }
    d -= seg;
  }
  const [x, z] = path[path.length - 1];
  return { x, z, yaw: 0, done: true };
}

/** Ground height: 0 on streets, CURB_H on sidewalks/blocks (smoothed at the curb). */
export function groundHeight(x, z) {
  const dist = (v) => { const r = ((v - GRID[0]) % BLOCK + BLOCK) % BLOCK; return Math.min(r, BLOCK - r); };
  const d = Math.min(dist(x), dist(z));
  const e = STREET_W / 2;
  if (Math.abs(x) > GRID[4] + e || Math.abs(z) > GRID[4] + e) return CURB_H;
  const t = Math.min(1, Math.max(0, (d - (e - 0.4)) / 0.8));
  return t * CURB_H;
}

/** Human-readable name of a location. */
export function locationName(loc) {
  if (!loc) return 'the streets';
  if (loc.place) return PLACES[loc.place].name;
  return 'a street corner';
}
