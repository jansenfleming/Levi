// The alien: a small procedural character with a procedural pose/animation system.
import * as THREE from 'three';
import { glowTexture } from './textures.js';

const SKIN = 0x5fd35a;
const STAND_HIP = 0.55;

export function createAlien(scene) {
  const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.45, metalness: 0.05, emissive: 0x15400f });
  const jacket = new THREE.MeshStandardMaterial({ color: 0x343848, roughness: 0.45, metalness: 0.35, emissive: 0x0a0b12 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2c2e3a, roughness: 0.6, emissive: 0x08080c });
  const eye = new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 0.06, metalness: 0.4 });
  const neon = (c, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });
  const trim = neon('#00e5ff', 1.5);
  const tipMat = neon('#ff2bd6', 4);

  const root = new THREE.Group();
  const hips = new THREE.Group(); root.add(hips);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), pants); hips.add(pelvis);

  // torso
  const torso = new THREE.Group(); torso.position.y = 0.02; hips.add(torso);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.16, 4, 14), jacket);
  body.position.y = 0.24; body.scale.set(1.05, 1, 0.85); torso.add(body);
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.178, 0.014, 6, 24), trim); hem.rotation.x = Math.PI / 2; hem.position.y = 0.05; hem.scale.set(1.05, 0.85, 1); torso.add(hem);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 6, 20), trim); collar.rotation.x = Math.PI / 2; collar.position.y = 0.47; torso.add(collar);
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.36, 0.01), neon('#ff2bd6', 2.2)); zip.position.set(0, 0.25, 0.158); torso.add(zip);

  // head
  const head = new THREE.Group(); head.position.y = 0.5; torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 18), skin);
  skull.position.y = 0.25; skull.scale.set(1, 0.95, 0.92); head.add(skull);
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), eye);
    e.position.set(s * 0.105, 0.24, 0.205); e.scale.set(0.85, 1.25, 0.5); e.rotation.set(0, s * 0.35, s * -0.35);
    head.add(e); eyes.push(e);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), neon('#ffffff', 1.5));
    hl.position.set(s * 0.085, 0.29, 0.245); head.add(hl); eyes.push(hl);
  }
  const tips = [];
  for (const s of [-1, 1]) {
    const ant = new THREE.Group(); ant.position.set(s * 0.08, 0.48, -0.02); ant.rotation.z = -s * 0.35; head.add(ant);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.28, 5), skin); stalk.position.y = 0.14; ant.add(stalk);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), tipMat); tip.position.y = 0.29; ant.add(tip);
    tips.push(ant);
  }

  // arms
  const arm = (s) => {
    const sh = new THREE.Group(); sh.position.set(s * 0.22, 0.4, 0); torso.add(sh);
    const up = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), jacket); up.position.y = -0.15; sh.add(up);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.01, 4, 12), trim); cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.28; sh.add(cuff);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skin); hand.position.y = -0.34; sh.add(hand);
    return sh;
  };
  const lArm = arm(1), rArm = arm(-1);

  // legs
  const leg = (s) => {
    const hip = new THREE.Group(); hip.position.set(s * 0.09, -0.02, 0); hips.add(hip);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.12, 4, 8), pants); thigh.position.y = -0.12; hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.25; hip.add(knee);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.12, 4, 8), pants); shin.position.y = -0.11; knee.add(shin);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.2), jacket); shoe.position.set(0, -0.25, 0.03); knee.add(shoe);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.015, 0.205), trim); sole.position.set(0, -0.285, 0.03); knee.add(sole);
    return { hip, knee };
  };
  const lLeg = leg(1), rLeg = leg(-1);

  // props
  const book = new THREE.Group();
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.03), new THREE.MeshStandardMaterial({ color: 0x7a2030, roughness: 0.6 }));
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.035), new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.9, emissive: 0x201c10 }));
  pages.position.z = 0.005; book.add(cover, pages);
  book.position.set(0, 0.16, 0.32); book.visible = false; torso.add(book);

  // blob shadow + a small personal light so he reads at night
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);
  const aura = new THREE.PointLight('#9fe8ff', 0.9, 4, 1.5); aura.position.set(0, 2.4, 0.3); root.add(aura);

  root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  scene.add(root);

  // ------------------------------------------------------------------
  const J = { hipY: STAND_HIP, lean: 0, headPitch: 0, headYaw: 0, lArm: 0, rArm: 0, lArmZ: 0.08, rArmZ: -0.08, lThigh: 0, rThigh: 0, lKnee: 0, rKnee: 0 };
  const cur = { ...J };
  let walkPhase = 0, blinkT = 2, yaw = 0, pose = 'idle', seat = 0;

  function target(t, speed) {
    const T = { ...J };
    const breathe = Math.sin(t * 1.6) * 0.015;
    const sitBase = (s) => {
      T.hipY = s + 0.08; T.lThigh = T.rThigh = -1.5; T.lKnee = T.rKnee = 1.45;
      T.lArm = T.rArm = -0.55; T.lArmZ = -0.05; T.rArmZ = 0.05; T.lean = 0.05 + breathe;
    };
    switch (pose) {
      case 'walk': {
        const s = Math.sin(walkPhase), c = Math.cos(walkPhase);
        T.lThigh = -s * 0.55; T.rThigh = s * 0.55;
        T.lKnee = Math.max(0, c) * 0.7 + 0.05; T.rKnee = Math.max(0, -c) * 0.7 + 0.05;
        T.lArm = s * 0.45; T.rArm = -s * 0.45;
        T.hipY = STAND_HIP - 0.02 + Math.abs(c) * 0.03; T.lean = 0.08; T.headPitch = -0.05;
        break;
      }
      case 'sit': sitBase(seat); T.headYaw = Math.sin(t * 0.25) * 0.35; break;
      case 'think':
        if (seat > 0) sitBase(seat);
        else { T.hipY = 0.1; T.lThigh = T.rThigh = -1.35; T.lKnee = T.rKnee = 0.25; T.lean = 0.12; T.lArm = 0.3; T.lArmZ = 0.25; }
        T.rArm = -1.25; T.rArmZ = 0.45; T.headPitch = 0.15 + Math.sin(t * 0.2) * 0.05; T.headYaw = Math.sin(t * 0.13) * 0.3; T.lean += 0.08;
        break;
      case 'read': case 'journal':
        if (seat > 0) sitBase(seat);
        else { T.hipY = 0.1; T.lThigh = T.rThigh = -1.35; T.lKnee = T.rKnee = 0.25; }
        T.lArm = T.rArm = -1.05; T.lArmZ = -0.32; T.rArmZ = 0.32; T.headPitch = 0.45; T.lean = 0.1;
        if (pose === 'journal') { T.rArm = -1.0 + Math.sin(t * 9) * 0.05; T.rArmZ = 0.2 + Math.sin(t * 5) * 0.06; T.headPitch = 0.55; }
        else if (Math.sin(t * 0.21) > 0.97) T.rArmZ = 0.05; // turn a page
        break;
      case 'eat': {
        sitBase(seat);
        const bite = Math.max(0, Math.sin(t * 0.9)) ** 3;
        T.lArm = -1.0; T.lArmZ = -0.25; T.rArm = -1.0 - bite * 0.9; T.rArmZ = 0.2 + bite * 0.15; T.headPitch = 0.25 - bite * 0.15; T.lean = 0.15;
        break;
      }
      case 'play':
        T.lArm = -1.2 + Math.sin(t * 18) * 0.05; T.rArm = -1.2 + (Math.sin(t * 7) > 0.6 ? -0.12 : 0); T.lArmZ = -0.2; T.rArmZ = 0.2;
        T.lean = 0.12; T.headPitch = 0.12 + Math.sin(t * 2.3) * 0.03; T.hipY = STAND_HIP - 0.01 + Math.abs(Math.sin(t * 3)) * 0.015;
        break;
      case 'charge':
        T.rArm = -1.35; T.rArmZ = -0.1; T.headPitch = 0.1; T.lean = 0.04 + breathe;
        break;
      case 'watch':
        T.headPitch = -0.45 + Math.sin(t * 0.3) * 0.05; T.headYaw = Math.sin(t * 0.17) * 0.2; T.lean = -0.04; T.lArm = T.rArm = 0.05;
        break;
      case 'pond':
        T.headPitch = 0.45; T.lArm = T.rArm = 0.35; T.lArmZ = 0.12; T.rArmZ = -0.12; T.lean = 0.06 + breathe;
        break;
      default: // idle / nothing
        T.lean = breathe; T.headYaw = Math.sin(t * 0.3) * 0.45; T.headPitch = Math.sin(t * 0.21) * 0.1;
        T.lArm = Math.sin(t * 0.8) * 0.04; T.rArm = -Math.sin(t * 0.8) * 0.04;
    }
    return T;
  }

  return {
    root,
    /** Called every frame. s = {x, y, z, yaw, pose, seat, moving, speed, hidden}. */
    update(dt, t, s) {
      root.visible = !s.hidden;
      shadow.visible = !s.hidden;
      pose = s.pose; seat = s.seat || 0;
      if (s.moving) walkPhase += dt * s.speed * 5.2;
      // position: snap when far (teleport after reconnect), otherwise smooth
      const d = Math.hypot(root.position.x - s.x, root.position.z - s.z);
      const k = d > 3 ? 1 : 1 - Math.exp(-dt * 12);
      root.position.x += (s.x - root.position.x) * k;
      root.position.z += (s.z - root.position.z) * k;
      root.position.y += (s.y - root.position.y) * (1 - Math.exp(-dt * 10));
      let dy = s.yaw - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      yaw += dy * (1 - Math.exp(-dt * 7));
      root.rotation.y = yaw;
      shadow.position.set(root.position.x, root.position.y + 0.02, root.position.z);

      const T = target(t, s.speed);
      const a = 1 - Math.exp(-dt * 8);
      for (const key in T) cur[key] += (T[key] - cur[key]) * a;
      hips.position.y = cur.hipY;
      torso.rotation.x = cur.lean;
      head.rotation.x = cur.headPitch; head.rotation.y = cur.headYaw;
      lArm.rotation.set(cur.lArm, 0, cur.lArmZ); rArm.rotation.set(cur.rArm, 0, cur.rArmZ);
      lLeg.hip.rotation.x = cur.lThigh; rLeg.hip.rotation.x = cur.rThigh;
      lLeg.knee.rotation.x = cur.lKnee; rLeg.knee.rotation.x = cur.rKnee;

      book.visible = pose === 'read' || pose === 'journal';
      book.rotation.x = pose === 'journal' ? -1.25 : -0.85;
      book.position.y = pose === 'journal' ? 0.08 : 0.16;

      // antennae sway + glow, eye blinks
      tips.forEach((ant, i) => { ant.rotation.x = Math.sin(t * 1.7 + i) * 0.08 + (pose === 'walk' ? Math.sin(walkPhase * 2) * 0.1 : 0); });
      const glow = pose === 'charge' ? 3 + Math.sin(t * 6) * 2 : 3.5 + Math.sin(t * 2) * 0.8;
      tipMat.color.set('#ff2bd6').multiplyScalar(glow);
      blinkT -= dt;
      const blink = blinkT < 0.12 && blinkT > 0;
      if (blinkT <= 0) blinkT = 2 + Math.random() * 4;
      for (const e of eyes) e.scale.y = blink ? 0.1 : (e.geometry.parameters.radius > 0.05 ? 1.25 : 1);
    },
    headWorld(v) { return head.getWorldPosition(v).add(new THREE.Vector3(0, 0.55, 0)); },
  };
}
