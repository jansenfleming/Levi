// Rain, flying cars and real-time day/night lighting.
import * as THREE from 'three';
import { rng } from './textures.js';
import { GRID } from '../shared/town.js';

// ---------- rain: GPU-animated streaks around the camera target ----------
export function createRain(scene, count) {
  const R = rng(99);
  const pos = new Float32Array(count * 2 * 3);
  const seed = new Float32Array(count * 2 * 3);
  for (let i = 0; i < count; i++) {
    const sx = R(), sy = R(), sz = R();
    for (let e = 0; e < 2; e++) {
      const k = (i * 2 + e) * 3;
      seed[k] = sx; seed[k + 1] = sy; seed[k + 2] = sz;
      pos[k + 1] = e; // 0 = bottom, 1 = top of the streak
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
  const uniforms = {
    uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() },
    uSize: { value: new THREE.Vector3(70, 40, 70) }, uIntensity: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 seed; uniform float uTime; uniform vec3 uCenter; uniform vec3 uSize;
      varying float vA;
      void main(){
        vec3 p;
        p.x = uCenter.x + (fract(seed.x - uCenter.x / uSize.x + 0.5) - 0.5) * uSize.x;
        p.z = uCenter.z + (fract(seed.z - uCenter.z / uSize.z + 0.5) - 0.5) * uSize.z;
        p.y = mod(seed.y * uSize.y - uTime * 26.0, uSize.y);
        p.y += position.y * 0.9;
        p.x += position.y * 0.12;
        vA = position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uIntensity; varying float vA;
      void main(){ gl_FragColor = vec4(vec3(0.55, 0.7, 0.95) * 0.5, 0.35 * uIntensity * (0.3 + vA)); }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);
  return {
    object: lines,
    update(time, center) { uniforms.uTime.value = time; uniforms.uCenter.value.copy(center); },
    set intensity(v) { uniforms.uIntensity.value = v; },
  };
}

// ---------- flying cars along fixed lanes above the streets ----------
export function createCars(scene, count) {
  const R = rng(5);
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x1a1c24, metalness: 0.9, roughness: 0.3 }), count);
  const front = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 2.6), toneMapped: false }), count);
  const back = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 0.2, 0.3), toneMapped: false }), count);
  const under = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), count);
  const cars = [];
  const lanesX = [...GRID, -90, 90], heights = [16, 22, 28, 36, 46];
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const alongX = R() < 0.5;
    cars.push({
      alongX, line: lanesX[Math.floor(R() * lanesX.length)] + (R() < 0.5 ? -1.5 : 1.5),
      y: heights[Math.floor(R() * heights.length)] + R() * 2,
      t: (R() - 0.5) * 400, speed: (10 + R() * 14) * (R() < 0.5 ? 1 : -1),
    });
    c.set(['#ff2bd6', '#00e5ff', '#7a5cff', '#ffb300'][i % 4]).multiplyScalar(2.5);
    under.setColorAt(i, c);
  }
  scene.add(body, front, back, under);
  const o = new THREE.Object3D();
  const set = (mesh, i, car, dx, dy, dz, sx, sy, sz) => {
    o.position.set(0, 0, 0); o.rotation.set(0, car.alongX ? (car.speed > 0 ? Math.PI / 2 : -Math.PI / 2) : (car.speed > 0 ? 0 : Math.PI), 0);
    o.scale.set(sx, sy, sz);
    const off = new THREE.Vector3(dx, dy, dz).applyEuler(o.rotation);
    const x = car.alongX ? car.t : car.line, z = car.alongX ? car.line : car.t;
    o.position.set(x + off.x, car.y + off.y, z + off.z);
    o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
  };
  return {
    update(dt) {
      cars.forEach((car, i) => {
        car.t += car.speed * dt;
        if (car.t > 220) car.t -= 440; else if (car.t < -220) car.t += 440;
        set(body, i, car, 0, 0, 0, 1.4, 0.55, 2.8);
        set(front, i, car, 0, 0, 1.42, 1.1, 0.12, 0.05);
        set(back, i, car, 0, 0.05, -1.42, 1.2, 0.1, 0.05);
        set(under, i, car, 0, -0.3, 0, 1.0, 0.04, 2.2);
      });
      for (const m of [body, front, back, under]) m.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- day/night from the real local clock ----------
const NIGHT = { bg: new THREE.Color('#0b0618'), hemi: 0.9, sun: 0.12, env: 0.9, bloom: 1.05, fog: 0.016, exposure: 1.0 };
const DAY = { bg: new THREE.Color('#7d8a99'), hemi: 2.2, sun: 2.8, env: 1.6, bloom: 0.35, fog: 0.009, exposure: 1.9 };
const DUSK = new THREE.Color('#5a2a4a');

/** Fractional hour of the day in the town's timezone. */
export function townHour(now, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(now));
    const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
    return get('hour') + get('minute') / 60;
  } catch {
    const d = new Date(now);
    return d.getHours() + d.getMinutes() / 60;
  }
}

/** 0 = night, 1 = full day, with dawn 5:30–7:30 and dusk 18:00–20:00. */
export function daylight(h) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return ss(5.5, 7.5, h) * (1 - ss(18, 20, h));
}

export function createSky(scene, renderer) {
  const hemi = new THREE.HemisphereLight(0x7a6ac0, 0x201018, NIGHT.hemi);
  const sun = new THREE.DirectionalLight(0xfff0e0, NIGHT.sun);
  sun.position.set(60, 120, 40);
  scene.add(hemi, sun);
  scene.fog = new THREE.FogExp2(NIGHT.bg.clone(), NIGHT.fog);
  scene.background = NIGHT.bg.clone();
  return {
    apply(day, bloomPass, fogBoost = 0) {
      const twilight = Math.max(0, 1 - Math.abs(day - 0.5) * 4) * 0.5; // reddish tint around dawn/dusk
      const bg = NIGHT.bg.clone().lerp(DAY.bg, day).lerp(DUSK, twilight);
      scene.background.copy(bg);
      scene.fog.color.copy(bg);
      scene.fog.density = (NIGHT.fog + (DAY.fog - NIGHT.fog) * day) * (1 + fogBoost * 2.2);
      hemi.intensity = NIGHT.hemi + (DAY.hemi - NIGHT.hemi) * day;
      sun.intensity = NIGHT.sun + (DAY.sun - NIGHT.sun) * day;
      scene.environmentIntensity = NIGHT.env + (DAY.env - NIGHT.env) * day;
      renderer.toneMappingExposure = NIGHT.exposure + (DAY.exposure - NIGHT.exposure) * day;
      if (bloomPass) bloomPass.strength = NIGHT.bloom + (DAY.bloom - NIGHT.bloom) * day;
    },
  };
}
