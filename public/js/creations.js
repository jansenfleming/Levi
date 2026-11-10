// Things Levi makes on street corners, rendered procedurally from {kind, shape, color, size, title, text}.
// Text is drawn onto canvas textures (never inserted as HTML).
import * as THREE from 'three';
import { SLOTS, CURB_H } from '../shared/town.js';
import { SIGN_FONT } from './textures.js';

const SIZE = { small: 0.7, medium: 1.1, large: 1.6 };

function textTexture(title, text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(6,4,14,0.92)'; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = color; g.lineWidth = 6; g.shadowColor = color; g.shadowBlur = 14; g.strokeRect(8, 8, 496, 240); g.shadowBlur = 0;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const main = text || title;
  let size = 64;
  for (; size > 18; size -= 4) { g.font = `800 ${size}px ${SIGN_FONT}`; if (g.measureText(main).width < 470) break; }
  g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 16;
  // wrap into up to 3 lines if still too wide
  const words = String(main).split(/\s+/); const lines = []; let line = '';
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > 470 && line) { lines.push(line); line = w; } else line = t; }
  lines.push(line);
  const shown = lines.slice(0, 3);
  shown.forEach((l, i) => g.fillText(l, 256, 128 + (i - (shown.length - 1) / 2) * size * 1.1));
  g.shadowBlur = 0;
  if (text && title) { g.font = `600 22px ${SIGN_FONT}`; g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText(title.slice(0, 40), 256, 228); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shapeMesh(shape, color, s) {
  const glow = new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: color, emissiveIntensity: 1.2, roughness: 0.35, metalness: 0.4 });
  const neon = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2), toneMapped: false });
  const g = new THREE.Group();
  const add = (geo, mat, y, rot) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; if (rot) m.rotation.set(...rot); g.add(m); return m; };
  switch (shape) {
    case 'orb': add(new THREE.SphereGeometry(0.55 * s, 24, 16), glow, 0.6 * s + 0.4); add(new THREE.CylinderGeometry(0.08, 0.12, 0.5, 8), glow, 0.25); break;
    case 'spire': add(new THREE.ConeGeometry(0.4 * s, 2.6 * s, 6), glow, 1.3 * s); break;
    case 'cube': add(new THREE.BoxGeometry(0.9 * s, 0.9 * s, 0.9 * s), glow, 0.45 * s + 0.1, [0.6, 0.6, 0]); break;
    case 'ring': add(new THREE.TorusGeometry(0.7 * s, 0.08 * s, 8, 32), neon, 0.9 * s); break;
    case 'arch': add(new THREE.TorusGeometry(0.8 * s, 0.1 * s, 8, 24, Math.PI), neon, 0.05); break;
    case 'tree':
      add(new THREE.CylinderGeometry(0.08 * s, 0.14 * s, 1.4 * s, 6), new THREE.MeshStandardMaterial({ color: 0x1a1a22, metalness: 0.8 }), 0.7 * s);
      add(new THREE.IcosahedronGeometry(0.75 * s, 0), new THREE.MeshStandardMaterial({ color: 0x050510, emissive: color, emissiveIntensity: 0.9, flatShading: true }), 1.7 * s);
      break;
    case 'totem': for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.5 * s, 0.45 * s, 0.5 * s), i % 2 ? glow : neon, 0.25 * s + i * 0.5 * s, [0, i * 0.4, 0]); break;
    case 'helix':
      for (let i = 0; i < 18; i++) {
        const a = i * 0.7, y = 0.15 + i * 0.13 * s;
        const m = add(new THREE.SphereGeometry(0.09 * s, 8, 6), neon, y);
        m.position.x = Math.cos(a) * 0.35 * s; m.position.z = Math.sin(a) * 0.35 * s;
      }
      break;
    case 'pyramid': add(new THREE.ConeGeometry(0.75 * s, 1.3 * s, 4), glow, 0.65 * s); break;
    default: break; // 'panel' is just the text panel
  }
  return g;
}

export function createCreations(scene) {
  const root = new THREE.Group();
  scene.add(root);
  const built = new Map(); // id -> group
  const spinners = [];

  function build(c) {
    const slot = SLOTS.find((s) => s.id === c.slot);
    if (!slot) return null;
    const color = new THREE.Color(/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#33ffcc');
    const s = SIZE[c.size] || 1;
    const g = new THREE.Group();
    g.position.set(slot.x, CURB_H, slot.z);
    // face the street the slot sits on
    g.rotation.y = Math.atan2(slot.standX - slot.x, slot.standZ - slot.z);
    const isPanel = c.kind === 'sign' || c.kind === 'mural' || c.shape === 'panel';
    if (isPanel) {
      const w = c.kind === 'mural' ? 2.6 * s : 1.8 * s, h = w / 2;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: textTexture(c.title, c.text, c.color), toneMapped: false, color: new THREE.Color(1.5, 1.5, 1.5), side: THREE.DoubleSide }));
      panel.position.y = (c.kind === 'mural' ? 0.2 : 1.0) + h / 2;
      g.add(panel);
      if (c.kind !== 'mural') {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), new THREE.MeshStandardMaterial({ color: 0x222228, metalness: 0.8 }));
        pole.position.y = 0.5; g.add(pole);
      }
      if (c.shape !== 'panel') { const extra = shapeMesh(c.shape, color, s * 0.5); extra.position.set(w / 2 + 0.3, 0, 0); g.add(extra); }
    } else {
      const m = shapeMesh(c.shape, color, s);
      g.add(m);
      if (c.kind === 'sculpture' || c.kind === 'other') spinners.push({ m, owner: g });
      if (c.text) {
        const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshBasicMaterial({ map: textTexture(c.title, c.text, c.color), toneMapped: false, side: THREE.DoubleSide }));
        plaque.position.set(0, 0.3, 0.6); plaque.rotation.x = -0.4; g.add(plaque);
      }
    }
    if (c.kind === 'lights' || c.kind === 'plant' || c.kind === 'sculpture') {
      const l = new THREE.PointLight(color, 6, 6, 1.6); l.position.y = 1.4 * s; g.add(l);
    }
    // a little glow on the ground
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.0 * s, 24), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.25), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.02; g.add(pool);
    root.add(g);
    return g;
  }

  function dispose(g) {
    root.remove(g);
    g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
    for (let i = spinners.length - 1; i >= 0; i--) if (spinners[i].owner === g) spinners.splice(i, 1);
  }

  return {
    /** Sync with the server's list; builds new ones and removes replaced/hidden ones. */
    set(list) {
      const ids = new Set((list || []).map((c) => c.id));
      for (const [id, g] of built) if (!ids.has(id)) { dispose(g); built.delete(id); }
      for (const c of list || []) if (!built.has(c.id)) { const g = build(c); if (g) built.set(c.id, g); }
    },
    update(t) { spinners.forEach(({ m }, i) => { m.rotation.y = t * 0.4 + i; }); },
  };
}
