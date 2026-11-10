// Procedural canvas textures: lit windows, neon signs, billboards, arcade screens, environment map.
import * as THREE from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h, opts) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', opts)];
}

// --- CJK font detection: machines without Japanese fonts fall back to English-only signs.
let cjk = null;
export function hasCJK() {
  if (cjk !== null) return cjk;
  const [, g] = canvas(40, 40, { willReadFrequently: true });
  const draw = (ch) => {
    g.clearRect(0, 0, 40, 40); g.fillStyle = '#fff'; g.font = '32px sans-serif'; g.fillText(ch, 2, 32);
    return g.getImageData(0, 0, 40, 40).data.join(',');
  };
  // If two different kana render identically, there is no real glyph (tofu).
  cjk = draw('ア') !== draw('ネ') && draw('ア') !== draw('￿');
  return cjk;
}

export const SIGN_FONT = '"Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", Meiryo, "Arial Black", sans-serif';

// --- Building windows. One tile = 8 x 16 windows; mapped onto 16 x 32 world units.
export function windowTexture(seed, palette) {
  const r = rng(seed);
  const [c, g] = canvas(128, 256);
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 16; row++) {
    const floorDark = r() < 0.25;
    const floorColor = palette[Math.floor(r() * palette.length)];
    for (let col = 0; col < 8; col++) {
      if (floorDark && r() < 0.9) continue;
      if (r() > 0.42) continue;
      const color = r() < 0.7 ? floorColor : palette[Math.floor(r() * palette.length)];
      g.globalAlpha = 0.45 + r() * 0.55;
      g.fillStyle = color;
      g.fillRect(col * 16 + 3, row * 16 + 4, 10, 9);
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.magFilter = THREE.LinearFilter;
  return t;
}

// --- Neon sign. Returns {texture, aspect}.
export function signTexture({ text, sub, color = '#ff2bd6', vertical = false, bg = 'rgba(5,0,15,0.85)' }) {
  const cj = hasCJK();
  // Strip Japanese if no font can draw it.
  const clean = (s) => (s && !cj ? s.replace(/[^\x00-\x7F]/g, '').trim() : s);
  let main = clean(text), second = clean(sub);
  if (!main) { main = second || '•'; second = null; }

  let c, g;
  if (vertical) {
    const chars = [...main];
    [c, g] = canvas(96, Math.max(1, chars.length) * 84 + 24);
    frame(g, c.width, c.height, color, bg);
    g.font = `900 64px ${SIGN_FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    glowText(g, color, () => chars.forEach((ch, i) => g.fillText(ch, 48, 54 + i * 84)));
  } else {
    [c, g] = canvas(512, second ? 192 : 140);
    frame(g, c.width, c.height, color, bg);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${fit(g, main, 460, 84)}px ${SIGN_FONT}`;
    glowText(g, color, () => g.fillText(main, 256, second ? 72 : 72));
    if (second) {
      g.font = `700 ${fit(g, second, 440, 40)}px ${SIGN_FONT}`;
      glowText(g, '#ffffff', () => g.fillText(second, 256, 148), 8);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { texture: t, aspect: c.width / c.height };
}

function fit(g, text, maxW, size) {
  for (; size > 16; size -= 4) { g.font = `900 ${size}px ${SIGN_FONT}`; if (g.measureText(text).width <= maxW) break; }
  return size;
}
function frame(g, w, h, color, bg) {
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = color; g.lineWidth = 6; g.shadowColor = color; g.shadowBlur = 14;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.shadowBlur = 0;
}
function glowText(g, color, draw, blur = 18) {
  g.fillStyle = color; g.shadowColor = color; g.shadowBlur = blur; draw();
  g.shadowBlur = 0; g.fillStyle = '#fff'; g.globalAlpha = 0.55; draw(); g.globalAlpha = 1;
}

// --- Animated billboards: a handful of canvases redrawn a few times per second.
const BILLBOARD_ADS = [
  { a: 'DREAM BETTER', b: '夢 · SLEEP PODS', c1: '#00e5ff', c2: '#7a00ff' },
  { a: 'SYNTH RAMEN', b: '24H · 合成', c1: '#ff3b6b', c2: '#ffb300' },
  { a: 'REMEMBER MORE', b: 'MEMORY+ 記憶', c1: '#39ff88', c2: '#006aff' },
  { a: 'NOTHING TO DO?', b: 'DO NOTHING 無', c1: '#ff2bd6', c2: '#00e5ff' },
];
export function makeBillboard(index) {
  const ad = BILLBOARD_ADS[index % BILLBOARD_ADS.length];
  const [c, g] = canvas(256, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const cj = hasCJK();
  const b = cj ? ad.b : ad.b.replace(/[^\x00-\x7F]/g, '').trim();
  return {
    texture: t,
    update(time) {
      const s = time * 0.6 + index * 3;
      const grad = g.createLinearGradient(0, 0, 256, 128);
      grad.addColorStop(0, ad.c1); grad.addColorStop(1, ad.c2);
      g.fillStyle = '#05020c'; g.fillRect(0, 0, 256, 128);
      g.globalAlpha = 0.55; g.fillStyle = grad; g.fillRect(0, 0, 256, 128); g.globalAlpha = 1;
      // moving scan bars
      for (let i = 0; i < 6; i++) {
        const y = ((s * 40 + i * 24) % 160) - 16;
        g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, y, 256, 6);
      }
      const phase = Math.floor(s / 4) % 2;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#fff'; g.shadowColor = ad.c1; g.shadowBlur = 12;
      g.font = `900 ${phase ? 30 : 26}px ${SIGN_FONT}`;
      g.fillText(phase ? ad.a : b, 128, 58);
      g.shadowBlur = 0; g.font = `700 14px ${SIGN_FONT}`;
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillText('▲ ▲ ▲  ' + (phase ? b : ad.a) + '  ▲ ▲ ▲', 128 + Math.sin(s) * 10, 100);
      t.needsUpdate = true;
    },
  };
}

// --- Arcade cabinet screen (shared by all cabinets).
export function makeArcadeScreen() {
  const [c, g] = canvas(64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return {
    texture: t,
    update(time) {
      g.fillStyle = '#020010'; g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 10; i++) {
        const x = (i * 23 + time * 30 * (1 + (i % 3))) % 64;
        const y = (i * 37) % 54 + 4;
        g.fillStyle = ['#ff2bd6', '#00e5ff', '#ffe600'][i % 3];
        g.fillRect(x, y, 4, 4);
      }
      g.fillStyle = '#39ff88';
      g.fillRect(28 + Math.sin(time * 3) * 20, 56, 8, 4);
      t.needsUpdate = true;
    },
  };
}

// --- Equirectangular neon environment for wet reflections.
export function neonEnvironment(renderer) {
  const [c, g] = canvas(512, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#120a22'); grad.addColorStop(0.45, '#2a1440'); grad.addColorStop(0.55, '#140a1e'); grad.addColorStop(1, '#030206');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
  const r = rng(7);
  const cols = ['#ff2bd6', '#00e5ff', '#ff3b6b', '#7a00ff', '#ffb300', '#39ff88'];
  for (let i = 0; i < 70; i++) {
    g.fillStyle = cols[i % cols.length];
    g.globalAlpha = 0.35 + r() * 0.5;
    const w = 4 + r() * 18, h = 6 + r() * 40;
    g.fillRect(r() * 512, 70 + r() * 70, w, h);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(t).texture;
  t.dispose(); pm.dispose();
  return env;
}

// --- Soft radial glow (for neon puddle reflections and lamp halos).
let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
