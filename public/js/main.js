// Entry point: renderer, camera, render loop. Renders whatever the state source says.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PLACES, GENERIC_ACTIONS, locate, pathLength, samplePath, groundHeight } from '../shared/town.js';
import { buildCity } from './city.js';
import { createAlien } from './alien.js';
import { createRain, createCars, createSky, daylight, townHour } from './effects.js';
import { neonEnvironment } from './textures.js';
import { createUI } from './ui.js';
import { createScriptedSource } from './scripted.js';
import { createSocketSource } from './net.js';
import { createCreations } from './creations.js';

const params = new URLSearchParams(location.search);
const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;

// ---------- renderer ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.environment = neonEnvironment(renderer);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);
camera.position.set(-27, 7, 27);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomScale = mobile ? 0.5 : 1;
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth * bloomScale, innerHeight * bloomScale), 1.0, 0.55, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const sky = createSky(scene, renderer);
const city = buildCity(scene, { mobile });
const alien = createAlien(scene);
const rain = createRain(scene, mobile ? 2500 : 7000);
const cars = createCars(scene, mobile ? 14 : 28);
const creations = createCreations(scene);

// ---------- camera controls ----------
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2.5;
controls.maxDistance = 45;
controls.maxPolarAngle = Math.PI * 0.47;
controls.enablePan = false;
controls.target.set(-33, 1, 20);
let follow = true;
let rainOn = true;

const ui = createUI({
  onFollow: (on) => { follow = on; controls.enablePan = !on; },
  onRain: (on) => { rainOn = on; },
});

// ---------- state from the source ----------
let state = null;
let clockOffset = 0; // source clock - local clock
// ?demo runs the phase-1 scripted loop locally, without the server.
const source = params.has('demo') ? createScriptedSource({ speed: Number(params.get('speed')) || 1 }) : createSocketSource();
source.on('state', (s) => { state = s; clockOffset = s.now - Date.now(); creations.set(s.creations); });
source.on('event', (e) => ui.addEvent(e));
source.on('snapshot', (events) => ui.resetEvents(events));
source.on('status', (st) => ui.setStatus(st));
source.start();

/** What the alien looks like right now, derived from state + the clock. */
function view(now) {
  const a = state.alien;
  if (a.motion) {
    const L = pathLength(a.motion.path);
    const d = ((now - a.motion.start) / 1000) * a.motion.speed;
    if (d < L) {
      const p = samplePath(a.motion.path, d);
      return { x: p.x, z: p.z, y: groundHeight(p.x, p.z), yaw: p.yaw, pose: 'walk', moving: true, speed: a.motion.speed };
    }
  }
  const spot = locate(a.loc);
  let pose = 'idle', seat = 0, hidden = false;
  const act = a.activity?.id;
  if (a.loc.place && PLACES[a.loc.place].activities[act]) {
    const def = PLACES[a.loc.place].activities[act];
    pose = def.pose; seat = def.seat || 0; hidden = !!def.hidden;
  } else if (GENERIC_ACTIONS[act]) {
    pose = act === 'wander' ? 'idle' : GENERIC_ACTIONS[act].pose;
    if (spot.corner && (pose === 'think' || pose === 'journal')) seat = 0;
  }
  return { x: spot.x, z: spot.z, y: groundHeight(spot.x, spot.z), yaw: spot.yaw, pose, seat, hidden, moving: false, speed: 0 };
}

// ---------- building fade ----------
const ray = new THREE.Ray();
const tmp = new THREE.Vector3();
const head = new THREE.Vector3();
function updateFade(dt) {
  alien.headWorld(head);
  const dist = camera.position.distanceTo(head);
  ray.origin.copy(camera.position);
  ray.direction.copy(head).sub(camera.position).normalize();
  for (const f of city.fadeables) {
    const hit = ray.intersectBox(f.box, tmp);
    const target = hit && camera.position.distanceTo(tmp) < dist - 0.6 ? 1 : 0;
    const prev = f.fade;
    f.fade += (target - f.fade) * (1 - Math.exp(-dt * 8));
    if (Math.abs(f.fade - prev) < 1e-4 && (f.fade < 0.002 || f.fade > 0.998)) continue;
    const faded = f.fade > 0.01;
    for (const m of f.mats) {
      const wasT = m.transparent;
      m.transparent = faded || m.userData.baseTransparent;
      m.depthWrite = faded ? false : m.userData.baseDepthWrite;
      m.opacity = m.userData.baseOpacity * (1 - 0.85 * f.fade);
      if (wasT !== m.transparent) m.needsUpdate = true;
    }
  }
}

// ---------- loop ----------
const timer = new THREE.Timer();
const desired = new THREE.Vector3();
const bubblePos = new THREE.Vector3();
let lastUi = 0, lastDay = -1, lastFog = 0, rainLevel = 0, placed = false;
const hourOverride = params.has('hour') ? Number(params.get('hour')) : null;

function frame() {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();
  const now = Date.now() + clockOffset;

  if (state) {
    const v = view(now);
    alien.update(dt, t, v);
    city.setHome(v.hidden);

    desired.set(alien.root.position.x, alien.root.position.y + 0.9, alien.root.position.z);
    if (!placed) {
      // First state: put the camera right behind him instead of gliding across town.
      placed = true;
      camera.position.copy(desired).add(tmp.set(6, 5, 7).applyAxisAngle(THREE.Object3D.DEFAULT_UP, v.yaw + Math.PI * 0.8));
      controls.target.copy(desired);
    }
    if (follow) {
      tmp.copy(desired).sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 4));
      controls.target.add(tmp);
      camera.position.add(tmp);
    }

    if (t - lastUi > 0.25) { lastUi = t; ui.setState(state, v); ui.setClock(now, state.tz); }

    // thought bubble above his head (or above the pod door when he's inside)
    alien.headWorld(bubblePos);
    bubblePos.project(camera);
    const vis = bubblePos.z < 1 && Math.abs(bubblePos.x) < 1.1 && Math.abs(bubblePos.y) < 1.1;
    ui.placeBubble((bubblePos.x * 0.5 + 0.5) * innerWidth, (-bubblePos.y * 0.5 + 0.5) * innerHeight - 12, vis);
  }

  // day/night (recomputed every few seconds)
  const day = daylight(hourOverride !== null ? hourOverride : townHour(now, state?.tz));
  const fog = state?.weather?.fog ?? 0;
  if (Math.abs(day - lastDay) > 0.001 || Math.abs(fog - lastFog) > 0.001) {
    lastDay = day;
    lastFog += (fog - lastFog) * Math.min(1, dt * 0.5); // fog rolls in gradually
    if (Math.abs(fog - lastFog) < 0.002) lastFog = fog;
    sky.apply(day, bloom, lastFog); city.setDaylight(day);
  }

  const rainTarget = rainOn ? (state?.weather?.rain ?? 0) : 0;
  rainLevel += (rainTarget - rainLevel) * Math.min(1, dt * 0.4);
  rain.object.visible = rainLevel > 0.01;
  rain.intensity = rainLevel;
  rain.update(t, controls.target);
  cars.update(dt);
  city.update(t, dt);
  creations.update(t);
  controls.update();
  updateFade(dt);
  composer.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (params.has('debug')) window.__town = { THREE, camera, controls, scene, alien, setFollow: (v) => { follow = v; } };

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth * bloomScale, innerHeight * bloomScale);
});
