// Procedural cyberpunk town: streets, towers, signs, billboards, lamps and the seven places.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  GRID, BLOCK, BLOCK_HALF, CURB_H, STREET_W, PLACES, PLACE_BLOCKS, blockCenter, placeAngle,
} from '../shared/town.js';
import {
  rng, windowTexture, signTexture, makeBillboard, makeArcadeScreen, glowTexture,
} from './textures.js';

const PALETTES = [
  ['#ffd6a0', '#ffb070', '#fff0d0'],
  ['#9ad8ff', '#5ab0ff', '#d0f0ff'],
  ['#ff8ae0', '#c070ff', '#ffd0f4'],
  ['#80ffd8', '#a0fff0', '#ffd6a0'],
];
const NEON = ['#ff2bd6', '#00e5ff', '#ff3b6b', '#7a5cff', '#ffb300', '#39ff88'];
const DECOR_SIGNS = [
  ['酒', 'BAR'], ['ホテル', 'HOTEL'], ['薬', 'PHARMACY'], ['電脳', 'CYBER'], ['未来', 'FUTURE'],
  ['24H', 'OPEN'], ['ネオン', 'NEON'], ['夜市', 'NIGHT MARKET'], ['修理', 'REPAIR'], ['カラオケ', 'KARAOKE'],
  ['寿司', 'SUSHI'], ['休憩', 'REST'], ['データ', 'DATA'], ['夢', 'DREAMS'],
];

export function neonMat(color, intensity = 2.5) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: false });
}

export function buildCity(scene, { mobile }) {
  const R = rng(1337);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const fadeables = [];   // {box: Box3, mats: Material[], fade: number}
  const flickers = [];    // {mat, base: Color, rate}
  const animated = [];    // (time, dt) => void
  const windowMats = [];  // building materials whose emissive follows day/night
  const winTex = PALETTES.map((p, i) => windowTexture(100 + i, p));

  // ---------- ground ----------
  const puddles = puddleTexture();
  const asphalt = new THREE.MeshStandardMaterial({
    color: 0x16161f, roughness: 0.4, metalness: 0.5, roughnessMap: puddles,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), asphalt);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // lane markings along the walkable streets
  const lane = [];
  for (const g of GRID) {
    for (let t = GRID[0]; t < GRID[4]; t += 4) {
      lane.push(box(0.15, 0.01, 1.6, g, 0.005, t + 2));
      lane.push(box(1.6, 0.01, 0.15, t + 2, 0.005, g));
    }
  }
  scene.add(new THREE.Mesh(mergeGeometries(lane), neonMat('#2a6a80', 0.6)));

  // ---------- sidewalk slabs for every block (walkable + surrounding ring) ----------
  const concrete = new THREE.MeshStandardMaterial({ color: 0x26272f, roughness: 0.55, metalness: 0.3, roughnessMap: puddles });
  const slabs = [], curbs = [];
  for (let i = -1; i <= 4; i++) for (let j = -1; j <= 4; j++) {
    const [cx, cz] = blockCenter(i, j);
    if (PLACE_BLOCKS[`${i},${j}`] === 'garden') continue;
    slabs.push(box(BLOCK_HALF * 2, CURB_H, BLOCK_HALF * 2, cx, CURB_H / 2, cz));
    for (const [dx, dz, w, d] of [[0, BLOCK_HALF, BLOCK_HALF * 2, 0.12], [0, -BLOCK_HALF, BLOCK_HALF * 2, 0.12], [BLOCK_HALF, 0, 0.12, BLOCK_HALF * 2], [-BLOCK_HALF, 0, 0.12, BLOCK_HALF * 2]]) {
      curbs.push(box(w, 0.04, d, cx + dx, CURB_H + 0.01, cz + dz));
    }
  }
  scene.add(new THREE.Mesh(mergeGeometries(slabs), concrete));
  scene.add(new THREE.Mesh(mergeGeometries(curbs), neonMat('#00e5ff', 0.5)));

  // ---------- helpers ----------
  function buildingMat(variant) {
    const m = new THREE.MeshStandardMaterial({
      color: 0x14161e, roughness: 0.6, metalness: 0.45,
      emissive: 0xffffff, emissiveMap: winTex[variant], emissiveIntensity: 1.4,
    });
    windowMats.push(m);
    return m;
  }

  function addSign(parent, opts, w, pos, rotY = 0, { blade = false, flicker = false, glow = true } = {}) {
    const { texture, aspect } = signTexture(opts);
    const h = w / aspect;
    const mat = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, toneMapped: false, side: blade ? THREE.DoubleSide : THREE.FrontSide,
      color: new THREE.Color(1, 1, 1).multiplyScalar(1.7),
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.y = rotY;
    parent.add(m);
    if (flicker) flickers.push({ mat, base: mat.color.clone(), rate: 0.2 + R() * 0.6, off: 0 });
    if (glow) {
      // soft neon reflection on the wet ground below
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.6, w * 1.6), new THREE.MeshBasicMaterial({
        map: glowTexture(), color: new THREE.Color(opts.color || '#ff2bd6').multiplyScalar(0.35),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      gl.rotation.x = -Math.PI / 2;
      gl.position.set(pos[0], CURB_H + 0.02, pos[2] + (blade ? 0 : 1.2));
      if (!blade) { gl.position.x = pos[0]; }
      gl.renderOrder = 1;
      parent.add(gl);
    }
    return m;
  }

  function tower(parent, w, h, d, x, z, variant, { yBase = 0 } = {}) {
    const geo = buildingGeometry(w, h, d, R());
    const mesh = new THREE.Mesh(geo, buildingMat(variant));
    mesh.position.set(x, yBase + CURB_H, z);
    parent.add(mesh);
    // roof detail
    if (h > 25 && R() < 0.6) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 6, 5), new THREE.MeshStandardMaterial({ color: 0x222228 }));
      ant.position.set(x + (R() - 0.5) * w * 0.5, yBase + CURB_H + h + 3, z + (R() - 0.5) * d * 0.5);
      parent.add(ant);
      const blink = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), neonMat('#ff2030', 4));
      blink.position.set(ant.position.x, ant.position.y + 3.1, ant.position.z);
      parent.add(blink);
      const ph = R() * 6;
      animated.push((t) => { blink.visible = Math.sin(t * 2 + ph) > 0.3; });
    }
    return mesh;
  }

  function placeGroup(id) {
    const p = PLACES[id];
    const g = new THREE.Group();
    const [cx, cz] = blockCenter(p.block[0], p.block[1]);
    g.position.set(cx, 0, cz);
    g.rotation.y = placeAngle(p);
    scene.add(g);
    return g;
  }

  function registerFade(group) {
    group.updateMatrixWorld(true);
    const box3 = new THREE.Box3();
    const mats = [];
    group.traverse((o) => {
      if (!o.isMesh || o.userData.noFade) return;
      if (!o.userData.fadeOwn) { o.material = o.material.clone(); o.userData.fadeOwn = true; }
      const m = o.material;
      m.userData.baseOpacity = m.opacity;
      m.userData.baseTransparent = m.transparent;
      m.userData.baseDepthWrite = m.depthWrite;
      mats.push(m);
      if (o.userData.solid) box3.expandByObject(o);
    });
    if (box3.isEmpty()) box3.setFromObject(group);
    fadeables.push({ box: box3, mats, fade: 0 });
    // keep day/night tracking on cloned building materials
    for (const m of mats) if (m.emissiveMap && winTex.includes(m.emissiveMap)) windowMats.push(m);
  }

  // ---------- generic towers in walkable blocks and the surrounding ring ----------
  let bbIndex = 0;
  const billboards = [];
  for (let i = -1; i <= 4; i++) for (let j = -1; j <= 4; j++) {
    if (PLACE_BLOCKS[`${i},${j}`]) continue;
    const [cx, cz] = blockCenter(i, j);
    const ring = i < 0 || j < 0 || i > 3 || j > 3;
    const n = ring ? 2 : 1 + Math.floor(R() * 3);
    const lots = n === 1 ? [[0, 0, 18, 18]] : n === 2 ? [[-5, 0, 9, 18], [5, 0, 9, 18]] : [[-5, -5, 9, 9], [5, -5, 9, 9], [0, 5, 18, 8]];
    for (const [lx, lz, lw, ld] of lots) {
      const g = new THREE.Group();
      g.position.set(cx + lx, 0, cz + lz);
      const w = lw - R() * 2, d = ld - R() * 2;
      const h = ring ? 30 + R() * 70 : 14 + R() * 42;
      const variant = Math.floor(R() * winTex.length);
      const m = tower(g, w, h, d, 0, 0, variant);
      m.userData.solid = true;
      // blade sign on a corner facing the nearest walkable street
      const sides = [[0, d / 2, 0], [0, -d / 2, Math.PI], [w / 2, 0, Math.PI / 2], [-w / 2, 0, -Math.PI / 2]];
      for (let s = 0; s < 2; s++) {
        const [sx, sz, rot] = sides[Math.floor(R() * 4)];
        const [jp, en] = pick(DECOR_SIGNS);
        const color = pick(NEON);
        const vertical = R() < 0.6;
        const faceW = Math.abs(Math.sin(rot)) > 0.5 ? d : w;
        const along = (R() - 0.5) * faceW * 0.6;
        const nx = Math.sin(rot), nz = Math.cos(rot), tx = Math.cos(rot), tz = -Math.sin(rot);
        if (vertical) {
          const out = 0.85;
          addSign(g, { text: jp, color, vertical: true }, 1.4, [sx + nx * out + tx * along, 6 + R() * 6, sz + nz * out + tz * along], rot + Math.PI / 2, { blade: true, flicker: R() < 0.3, glow: !ring });
        } else {
          addSign(g, { text: en, sub: jp, color }, 4.5, [sx + nx * 0.06 + tx * along, CURB_H + 3.4, sz + nz * 0.06 + tz * along], rot, { flicker: R() < 0.25, glow: false });
        }
      }
      // ground-floor shop strip
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.12, 0.1), neonMat(pick(NEON), 2));
      strip.position.set(0, CURB_H + 2.4, d / 2 + 0.06);
      g.add(strip);
      // billboard on some taller towers
      if (h > 30 && R() < (mobile ? 0.25 : 0.4) && billboards.length < (mobile ? 3 : 6)) {
        const bb = makeBillboard(bbIndex++);
        billboards.push(bb);
        const bm = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshBasicMaterial({ map: bb.texture, toneMapped: false, color: new THREE.Color(1.4, 1.4, 1.4) }));
        const [sx, sz, rot] = sides[Math.floor(R() * 4)];
        bm.position.set(sx * 1.01 + Math.sin(rot) * 0.1, h * (0.55 + R() * 0.25), sz * 1.01 + Math.cos(rot) * 0.1);
        bm.rotation.y = rot;
        g.add(bm);
        flickers.push({ mat: bm.material, base: bm.material.color.clone(), rate: 0.15, off: 0 });
      }
      scene.add(g);
      registerFade(g);
    }
  }

  // ---------- far skyline (merged, not fadeable) ----------
  const far = winTex.map(() => []);
  for (let i = -4; i <= 7; i++) for (let j = -4; j <= 7; j++) {
    if (i >= -1 && i <= 4 && j >= -1 && j <= 4) continue;
    const [cx, cz] = blockCenter(i, j);
    for (let k = 0; k < 2; k++) {
      const w = 8 + R() * 10, d = 8 + R() * 10, h = 40 + R() * 120;
      const geo = buildingGeometry(w, h, d, R());
      geo.translate(cx + (k ? 5 : -5) + (R() - 0.5) * 4, CURB_H, cz + (R() - 0.5) * 8);
      far[Math.floor(R() * far.length)].push(geo);
    }
  }
  far.forEach((geos, v) => { if (geos.length) scene.add(new THREE.Mesh(mergeGeometries(geos), buildingMat(v))); });

  // ---------- street lamps at intersections ----------
  const poles = [], heads = [];
  for (const x of GRID) for (const z of GRID) {
    const px = x + STREET_W / 2 + 0.6, pz = z + STREET_W / 2 + 0.6;
    poles.push(cyl(0.07, 5, px, CURB_H + 2.5, pz));
    poles.push(box(1.6, 0.08, 0.08, px - 0.8, CURB_H + 5, pz));
    heads.push(box(0.7, 0.12, 0.3, px - 1.5, CURB_H + 4.95, pz));
  }
  scene.add(new THREE.Mesh(mergeGeometries(poles), new THREE.MeshStandardMaterial({ color: 0x202028, metalness: 0.8, roughness: 0.4 })));
  scene.add(new THREE.Mesh(mergeGeometries(heads), neonMat('#bfefff', 3)));
  const lampGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({
    map: glowTexture(), color: new THREE.Color('#5fb8ff').multiplyScalar(0.3), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }), GRID.length * GRID.length);
  {
    const o = new THREE.Object3D(); let k = 0;
    for (const x of GRID) for (const z of GRID) {
      o.position.set(x + STREET_W / 2 - 0.9, 0.02, z + STREET_W / 2 + 0.6); o.rotation.set(-Math.PI / 2, 0, 0); o.updateMatrix();
      lampGlow.setMatrixAt(k++, o.matrix);
    }
  }
  scene.add(lampGlow);

  // ---------- the places ----------
  const lights = [];
  const placeLight = (g, color, x, y, z, intensity = 30, dist = 22) => {
    const l = new THREE.PointLight(color, intensity, dist, 1.6);
    l.position.set(x, y, z);
    g.add(l);
    lights.push(l);
    return l;
  };
  const dark = new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.5, metalness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2c36, roughness: 0.35, metalness: 0.9 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a1c18, roughness: 0.7 });

  const bench = (g, x, z, rotY = 0) => {
    const b = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.6), wood); seat.position.y = CURB_H + 0.42;
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.06), wood); back.position.set(0, CURB_H + 0.75, -0.3);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.03, 0.03), neonMat('#00e5ff', 2)); trim.position.set(0, CURB_H + 0.38, 0.31);
    b.add(seat, back, trim);
    for (const sx of [-0.95, 0.95]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.5), metal); l.position.set(sx, CURB_H + 0.21, 0); b.add(l); }
    b.position.set(x, 0, z); b.rotation.y = rotY;
    g.add(b);
    return b;
  };

  // HAB-7 Pod — capsule apartment tower
  const pod = placeGroup('pod');
  let homeLight;
  {
    const front = new THREE.Group(); pod.add(front);
    const lobby = new THREE.Mesh(new THREE.BoxGeometry(18, 6, 13), dark); lobby.position.set(0, CURB_H + 3, -3); lobby.userData.solid = true; front.add(lobby);
    const caps = [], windows = [];
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
      const x = -7.2 + col * 3.6, y = CURB_H + 6 + row * 2.6 + 1.2;
      caps.push(box(3.3, 2.3, 9, x, y, -4));
      windows.push([x, y, 0.52 + R() * 0.2, R()]);
    }
    const capMesh = new THREE.Mesh(mergeGeometries(caps), new THREE.MeshStandardMaterial({ color: 0x1c1e28, roughness: 0.4, metalness: 0.7 }));
    capMesh.userData.solid = true;
    front.add(capMesh);
    const winGeo = new THREE.CircleGeometry(0.75, 20);
    const winMesh = new THREE.InstancedMesh(winGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), windows.length);
    const o = new THREE.Object3D(), c = new THREE.Color();
    windows.forEach(([x, y, , r], k) => {
      o.position.set(x, y, 0.52); o.updateMatrix(); winMesh.setMatrixAt(k, o.matrix);
      c.set(r < 0.35 ? '#000000' : r < 0.7 ? '#ffb070' : '#7ad8ff').multiplyScalar(r < 0.35 ? 0 : 1.6);
      winMesh.setColorAt(k, c);
    });
    front.add(winMesh);
    // his own pod: ground floor, right of the door. Lit when he is home asleep.
    homeLight = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), neonMat('#4060ff', 0.2));
    homeLight.position.set(3.2, CURB_H + 1.6, 3.52);
    front.add(homeLight);
    const homeRing = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.82, 24), neonMat('#00e5ff', 2)); homeRing.position.copy(homeLight.position); homeRing.position.z += 0.01; front.add(homeRing);
    // door
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 0.1), new THREE.MeshStandardMaterial({ color: 0x050508, metalness: 0.9, roughness: 0.2 }));
    door.position.set(0, CURB_H + 1.3, 3.55); front.add(door);
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.9, 0.05), neonMat('#00e5ff', 2.2));
    doorFrame.position.set(0, CURB_H + 1.45, 3.52); front.add(doorFrame);
    addSign(front, { text: 'HAB-7', sub: 'カプセル · CAPSULE', color: '#00e5ff' }, 5, [0, CURB_H + 4.3, 3.6], 0, { glow: true });
    addSign(front, { text: 'カプセル', color: '#ff2bd6', vertical: true }, 1.3, [8.4, CURB_H + 10, 4.2], Math.PI / 2, { blade: true });
    bench(front, -3.5, 7.0);
    placeLight(pod, '#4ab8ff', 0, 4, 7, 25);
    registerFade(front);
    homeLight.userData.noFade = true;
  }

  // The Archive — library with amber reading terrace
  const archive = placeGroup('archive');
  {
    const f = new THREE.Group(); archive.add(f);
    const body = new THREE.Mesh(buildingGeometry(18, 16, 14, 0.3), buildingMat(0)); body.position.set(0, CURB_H, -3); body.userData.solid = true; f.add(body);
    const top = new THREE.Mesh(buildingGeometry(10, 22, 9, 0.7), buildingMat(0)); top.position.set(-2, CURB_H + 16, -5); top.userData.solid = true; f.add(top);
    for (let k = 0; k < 6; k++) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), metal); col.position.set(-7.5 + k * 3, CURB_H + 3.5, 4.3); f.add(col);
      if (k < 5) { const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 6), neonMat('#ffb060', 0.9)); win.position.set(-6 + k * 3, CURB_H + 3.5, 4.02); f.add(win); }
    }
    bench(f, -3, 7.0);
    const books = [];
    for (let k = 0; k < 10; k++) books.push(box(0.5 + R() * 0.3, 0.12, 0.35, -0.7 + (R() - 0.5) * 0.4, CURB_H + 0.06 + k * 0.12, 7.2));
    const bookMesh = new THREE.Mesh(mergeGeometries(books), new THREE.MeshStandardMaterial({ color: 0x804030, roughness: 0.8 }));
    f.add(bookMesh);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 6), metal); lamp.position.set(-5, CURB_H + 1.5, 7.3); f.add(lamp);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), neonMat('#ffc070', 3)); bulb.position.set(-5, CURB_H + 3.1, 7.3); f.add(bulb);
    addSign(f, { text: 'THE ARCHIVE', sub: 'アーカイブ · 記録', color: '#ffb300' }, 7, [0, CURB_H + 8.2, 4.4], 0);
    placeLight(archive, '#ffaa55', -3, 3.5, 8, 30);
    registerFade(f);
  }

  // Noodle Bar — open counter with stools, awning and lanterns
  const noodle = placeGroup('noodle');
  {
    const f = new THREE.Group(); noodle.add(f);
    const body = new THREE.Mesh(buildingGeometry(18, 7, 12, 0.1), buildingMat(0)); body.position.set(0, CURB_H, -3); body.userData.solid = true; f.add(body);
    const t2 = new THREE.Mesh(buildingGeometry(14, 28, 8, 0.5), buildingMat(2)); t2.position.set(1, CURB_H + 7, -5); t2.userData.solid = true; f.add(t2);
    const kitchen = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.4), neonMat('#ffb070', 0.8)); kitchen.position.set(0, CURB_H + 1.6, 3.02); f.add(kitchen);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(10, 1.0, 1.0), wood); counter.position.set(0, CURB_H + 0.5, 4.6); f.add(counter);
    const top = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.08, 1.2), metal); top.position.set(0, CURB_H + 1.04, 4.6); f.add(top);
    const counterTrim = new THREE.Mesh(new THREE.BoxGeometry(10, 0.05, 0.05), neonMat('#ff3b6b', 2.5)); counterTrim.position.set(0, CURB_H + 0.95, 5.11); f.add(counterTrim);
    for (const x of [-3.6, -1.2, 1.2, 3.6]) {
      const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0xaa2030, roughness: 0.4 }));
      stool.position.set(x, CURB_H + 0.58, 6.3); f.add(stool);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.58, 6), metal); leg.position.set(x, CURB_H + 0.29, 6.3); f.add(leg);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.12, 0.14, 12), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.3 }));
      bowl.position.set(x, CURB_H + 1.15, 4.75); f.add(bowl);
    }
    const aw = new THREE.Group(); noodle.add(aw);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(11, 0.12, 3.4), new THREE.MeshStandardMaterial({ color: 0x401018, roughness: 0.6 }));
    awning.position.set(0, CURB_H + 3.0, 4.8); awning.rotation.x = 0.18; awning.userData.solid = true; aw.add(awning);
    const awTrim = new THREE.Mesh(new THREE.BoxGeometry(11, 0.06, 0.06), neonMat('#ff3b6b', 3)); awTrim.position.set(0, CURB_H + 2.72, 6.5); aw.add(awTrim);
    for (let k = 0; k < 4; k++) {
      const noren = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.9), new THREE.MeshStandardMaterial({ color: 0x601020, side: THREE.DoubleSide, emissive: 0x300008 }));
      noren.position.set(-3.6 + k * 2.4, CURB_H + 2.25, 6.35); aw.add(noren);
    }
    for (const x of [-5, 5]) {
      const lan = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), neonMat('#ff3030', 2.5)); lan.scale.y = 1.3; lan.position.set(x, CURB_H + 2.3, 6.6); aw.add(lan);
      const ph = R() * 9;
      animated.push((t) => { lan.position.y = CURB_H + 2.3 + Math.sin(t * 1.3 + ph) * 0.04; });
    }
    addSign(f, { text: 'ラーメン', color: '#ff3b6b', vertical: true }, 1.6, [8.2, CURB_H + 6.5, 4], Math.PI / 2, { blade: true, flicker: true });
    addSign(f, { text: 'NOODLE BAR', sub: '麺 · 24H', color: '#ff3b6b' }, 6, [0, CURB_H + 4.6, 3.1], 0);
    placeLight(noodle, '#ff6040', 0, 3, 7, 35);
    registerFade(f);
    registerFade(aw);
  }

  // Arcade — cabinets at the front
  const arcade = placeGroup('arcade');
  const screen = makeArcadeScreen();
  {
    const f = new THREE.Group(); arcade.add(f);
    const body = new THREE.Mesh(buildingGeometry(18, 10, 13, 0.2), buildingMat(2)); body.position.set(0, CURB_H, -3); body.userData.solid = true; f.add(body);
    const t2 = new THREE.Mesh(buildingGeometry(12, 34, 9, 0.6), buildingMat(1)); t2.position.set(-2, CURB_H + 10, -5); t2.userData.solid = true; f.add(t2);
    for (let k = 0; k < 5; k++) { const s = new THREE.Mesh(new THREE.BoxGeometry(18, 0.1, 0.1), neonMat(k % 2 ? '#ff2bd6' : '#7a5cff', 2.2)); s.position.set(0, CURB_H + 5 + k * 1, 3.56); f.add(s); }
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.6), neonMat('#5a1070', 1)); glass.position.set(0, CURB_H + 1.9, 3.52); f.add(glass);
    const scrMat = new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false, color: new THREE.Color(1.8, 1.8, 1.8) });
    for (const x of [-3, 0, 3]) {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.8, 0.8), new THREE.MeshStandardMaterial({ color: 0x1a0830, roughness: 0.4, metalness: 0.4 }));
      cab.position.set(x, CURB_H + 0.9, 5.2); f.add(cab);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), scrMat); scr.position.set(x, CURB_H + 1.3, 5.61); scr.rotation.x = -0.15; f.add(scr);
      const marquee = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, 0.3), neonMat(x === 0 ? '#ffe600' : '#ff2bd6', 2.5)); marquee.position.set(x, CURB_H + 1.9, 5.5); f.add(marquee);
    }
    addSign(f, { text: 'ゲーム', sub: 'ARCADE · 遊', color: '#ff2bd6' }, 6.5, [0, CURB_H + 7.6, 3.6], 0, { flicker: true });
    addSign(f, { text: 'ゲーム', color: '#7a5cff', vertical: true }, 1.4, [-8.4, CURB_H + 13, 4], -Math.PI / 2, { blade: true });
    placeLight(arcade, '#d040ff', 0, 3, 7.5, 35);
    registerFade(f);
  }

  // Charge Station — canopy and two pylons
  const charge = placeGroup('charge');
  {
    const f = new THREE.Group(); charge.add(f);
    const back = new THREE.Mesh(buildingGeometry(18, 24, 7, 0.4), buildingMat(1)); back.position.set(0, CURB_H, -7); back.userData.solid = true; f.add(back);
    const canopy = new THREE.Group(); charge.add(canopy);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(14, 0.3, 9), dark); roof.position.set(0, CURB_H + 4.2, 1.5); roof.userData.solid = true; canopy.add(roof);
    const roofEdge = new THREE.Mesh(new THREE.BoxGeometry(14.1, 0.08, 9.1), neonMat('#00e5ff', 2.4)); roofEdge.position.set(0, CURB_H + 4.02, 1.5); canopy.add(roofEdge);
    for (const [x, z] of [[-6.6, -2.6], [6.6, -2.6], [-6.6, 5.6], [6.6, 5.6]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.2, 0.3), metal); p.position.set(x, CURB_H + 2.1, z); f.add(p); }
    for (const x of [-3.6, 3.6]) {
      const py = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.2, 0.9), new THREE.MeshStandardMaterial({ color: 0x15202a, metalness: 0.8, roughness: 0.3 }));
      py.position.set(x, CURB_H + 1.1, 3.2); f.add(py);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), neonMat('#39ff88', 1.6)); scr.position.set(x, CURB_H + 1.6, 3.66); f.add(scr);
      for (let k = 0; k < 3; k++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.03, 6, 24), neonMat('#00e5ff', 3));
        ring.rotation.x = Math.PI / 2; ring.position.set(x, CURB_H + 0.5 + k * 0.7, 3.2); f.add(ring);
        animated.push((t) => { ring.position.y = CURB_H + 0.3 + ((t * 0.6 + k / 3) % 1) * 2.2; });
      }
    }
    addSign(f, { text: '充電', sub: 'CHARGE STATION', color: '#00e5ff' }, 6, [0, CURB_H + 5.4, 5.9], 0, { flicker: true });
    placeLight(charge, '#30e0ff', 0, 3.5, 3, 30);
    registerFade(f);
    registerFade(canopy);
  }

  // Neon Garden — synthetic trees, pond and a bench
  const garden = placeGroup('garden');
  {
    const grass = new THREE.Mesh(new THREE.BoxGeometry(BLOCK_HALF * 2, CURB_H, BLOCK_HALF * 2), new THREE.MeshStandardMaterial({ color: 0x0c2a24, roughness: 0.8 }));
    grass.position.y = CURB_H / 2; garden.add(grass);
    const water = new THREE.Mesh(new THREE.CircleGeometry(5, 40), new THREE.MeshStandardMaterial({ color: 0x020810, metalness: 1, roughness: 0.04 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, CURB_H + 0.02, -2); garden.add(water);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(5.05, 0.08, 6, 48), neonMat('#00ffc8', 2)); rim.rotation.x = Math.PI / 2; rim.position.set(0, CURB_H + 0.06, -2); garden.add(rim);
    const orbs = [];
    for (let k = 0; k < 7; k++) {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), neonMat(k % 2 ? '#ff4fd8' : '#7affff', 3));
      const a = R() * Math.PI * 2, rr = 1 + R() * 3;
      orb.position.set(Math.cos(a) * rr, CURB_H + 0.12, -2 + Math.sin(a) * rr); garden.add(orb);
      orbs.push([orb, a, rr]);
    }
    animated.push((t) => orbs.forEach(([o, a, rr], k) => {
      const aa = a + t * 0.05 * (k % 2 ? 1 : -1);
      o.position.set(Math.cos(aa) * rr, CURB_H + 0.12 + Math.sin(t * 2 + k) * 0.04, -2 + Math.sin(aa) * rr);
    }));
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, metalness: 0.9, roughness: 0.3 });
    const treeSpots = [[-8, -8], [-3, -9], [4, -9], [8.5, -6], [-8.5, -1], [8.5, 1.5], [-8, 5.5], [8, 7.5], [-4.5, 8.5]];
    treeSpots.forEach(([x, z], k) => {
      const h = 2.5 + R() * 2;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, h, 6), trunkMat); trunk.position.set(x, CURB_H + h / 2, z); garden.add(trunk);
      const color = ['#00ffc8', '#ff4fd8', '#7affff', '#b070ff'][k % 4];
      const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2 + R() * 0.7, 0), new THREE.MeshStandardMaterial({
        color: 0x050510, emissive: color, emissiveIntensity: 0.9, flatShading: true, roughness: 0.4,
      }));
      canopy.position.set(x, CURB_H + h + 0.8, z); canopy.rotation.set(R(), R(), R()); garden.add(canopy);
      const ph = R() * 6;
      animated.push((t) => { canopy.material.emissiveIntensity = 0.75 + Math.sin(t * 0.7 + ph) * 0.25; });
    });
    bench(garden, 0, 4.6, Math.PI);
    // entrance arch
    for (const x of [-4, 4]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), metal); p.position.set(x, CURB_H + 2, 10.2); garden.add(p); }
    addSign(garden, { text: 'ネオン庭園', sub: 'NEON GARDEN', color: '#00ffc8' }, 7.6, [0, CURB_H + 4.2, 10.2], 0);
    placeLight(garden, '#40ffd0', 0, 3, -2, 25, 18);
  }

  // Hologram Plaza — projector and a slowly turning hologram
  const plaza = placeGroup('plaza');
  {
    const tiles = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK_HALF * 2, BLOCK_HALF * 2), new THREE.MeshStandardMaterial({ color: 0x101018, metalness: 0.7, roughness: 0.15 }));
    tiles.rotation.x = -Math.PI / 2; tiles.position.y = CURB_H + 0.01; plaza.add(tiles);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.6, 32), metal); base.position.y = CURB_H + 0.3; plaza.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.06, 6, 48), neonMat('#00e5ff', 3)); ring.rotation.x = Math.PI / 2; ring.position.y = CURB_H + 0.62; plaza.add(ring);
    const floorRing = new THREE.Mesh(new THREE.RingGeometry(6, 6.15, 64), neonMat('#ff2bd6', 1.4)); floorRing.rotation.x = -Math.PI / 2; floorRing.position.y = CURB_H + 0.03; plaza.add(floorRing);
    const holo = hologram();
    holo.group.position.y = CURB_H + 7;
    plaza.add(holo.group);
    animated.push(holo.update);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 2.2, 6.5, 32, 1, true), new THREE.MeshBasicMaterial({
      color: new THREE.Color('#00e5ff').multiplyScalar(0.12), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    cone.position.y = CURB_H + 3.8; plaza.add(cone);
    bench(plaza, -6, 6.5, -Math.PI * 0.75);
    bench(plaza, 6.5, -6, Math.PI * 0.25);
    addSign(plaza, { text: 'ホログラム', sub: 'HOLOGRAM PLAZA', color: '#00e5ff' }, 5, [7.5, CURB_H + 2.6, 10], 0);
    const kiosk = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), metal); kiosk.position.set(7.5, CURB_H + 1.3, 9.9); plaza.add(kiosk);
    placeLight(plaza, '#40c0ff', 0, 4, 0, 40, 24);
  }

  // ---------- per-frame updates ----------
  let acc = 0;
  function update(time, dt) {
    for (const f of animated) f(time, dt);
    acc += dt;
    if (acc > 0.1) {
      acc = 0;
      for (const b of billboards) b.update(time);
      screen.update(time);
    }
    for (const fl of flickers) {
      if (fl.off > 0) { fl.off -= dt; if (fl.off <= 0) fl.mat.color.copy(fl.base); continue; }
      if (Math.random() < fl.rate * dt * 0.5) { fl.off = 0.05 + Math.random() * 0.25; fl.mat.color.copy(fl.base).multiplyScalar(0.15); }
    }
  }

  function setDaylight(day) {
    for (const m of windowMats) m.emissiveIntensity = 1.4 - day * 0.9;
    for (const l of lights) {
      if (l.userData.base === undefined) l.userData.base = l.intensity;
      l.intensity = l.userData.base * (1 - day * 0.6);
    }
  }

  function setHome(asleep) {
    homeLight.material.color.set('#4060ff').multiplyScalar(asleep ? 2.4 : 0.15);
  }

  return { fadeables, update, setDaylight, setHome };
}

// ---------------------------------------------------------------------------
function box(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
function cyl(r, h, x, y, z) { const g = new THREE.CylinderGeometry(r, r, h, 6); g.translate(x, y, z); return g; }

/** Box with UVs scaled so the window texture keeps a constant size; origin at the bottom centre. */
function buildingGeometry(w, h, d, uOff) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const widths = [d, d, 0, 0, w, w];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (widths[f] === 0) { uv.setXY(i, 0.01, 0.01); continue; }
      uv.setXY(i, uv.getX(i) * widths[f] / 12 + uOff, uv.getY(i) * h / 24);
    }
  }
  geo.translate(0, h / 2, 0);
  return geo;
}

function puddleTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, 256, 256);
  const r = rng(42);
  for (let i = 0; i < 60; i++) {
    const x = r() * 256, y = r() * 256, rad = 6 + r() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(10,10,10,0.9)'); grad.addColorStop(1, 'rgba(10,10,10,0)');
    g.fillStyle = grad; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(40, 40);
  return t;
}

function hologram() {
  const group = new THREE.Group();
  const uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color('#00e5ff') } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vW; varying vec3 vV;
      void main(){
        vec4 w = modelMatrix * vec4(position,1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uColor;
      varying vec3 vN; varying vec3 vW; varying vec3 vV;
      void main(){
        float fres = pow(1.0 - abs(dot(normalize(vN), vV)), 2.0);
        float scan = 0.55 + 0.45 * sin(vW.y * 18.0 - uTime * 6.0);
        float flick = 0.85 + 0.15 * sin(uTime * 37.0) * sin(uTime * 13.0);
        vec3 col = mix(uColor, vec3(1.0, 0.2, 0.85), 0.5 + 0.5 * sin(vW.y * 0.7 + uTime * 0.5));
        gl_FragColor = vec4(col * (0.25 + fres * 1.8) * scan * flick * 1.6, 1.0);
      }`,
  });
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.6, 0.45, 120, 12, 2, 3), mat);
  group.add(knot);
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 1), new THREE.MeshBasicMaterial({
    color: new THREE.Color('#00e5ff').multiplyScalar(0.8), wireframe: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  group.add(shell);
  const rings = [];
  for (let k = 0; k < 3; k++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(3.8 + k * 0.4, 0.03, 6, 64), mat);
    r.rotation.x = Math.PI / 2 + k * 0.3; group.add(r); rings.push(r);
  }
  return {
    group,
    update(t) {
      uniforms.uTime.value = t;
      knot.rotation.y = t * 0.3; knot.rotation.x = Math.sin(t * 0.2) * 0.3;
      shell.rotation.y = -t * 0.1;
      rings.forEach((r, k) => { r.rotation.z = t * (0.2 + k * 0.1); });
      knot.position.y = Math.sin(t * 0.8) * 0.3;
    },
  };
}
