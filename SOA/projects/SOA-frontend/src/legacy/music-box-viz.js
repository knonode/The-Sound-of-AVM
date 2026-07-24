/*
 * music-box-viz.js — The Music Box.
 *
 * The mempool is the drum of a souvenir music box, seen in three-quarter
 * view. Each transaction sets a pin on the drum and gives it a flick of
 * angular momentum — the drum only turns while transactions arrive, easing
 * to a stop when the network goes quiet. When a pin reaches the steel comb
 * it plucks its tooth: bigger amounts strike the long bass teeth nearest
 * the camera, and the tooth flashes the transaction-type color before
 * fading back to plain steel. Atomic groups land on one row and are joined
 * by a gold bar — a chord, struck together. Blocks pass as a quiet gold
 * glint over the comb anchor.
 *
 * Rendering sleeps while the fullscreen canvas is not visible.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const COLORS = {
  pay: '#65a9ff',
  axfer: '#ff6b68',
  appl: '#c98bff',
  acfg: '#5bd18b',
  keyreg: '#55d5e8',
  afrz: '#ff9a57',
  stpf: '#e8edf5',
  hb: '#b7db5a',
};
const GOLD = 0xf5c85b;
const TAU = Math.PI * 2;

// --- Mechanism dimensions ---
const DRUM_RADIUS = 0.85;
const DRUM_LENGTH = 3.8;
const DRUM_Y = 1.18;
const TOOTH_COUNT = 56;
const TOOTH_PLANE_Y = 0.346;                 // tooth plane height above drum axis
const COMB_ANGLE = Math.acos(TOOTH_PLANE_Y / DRUM_RADIUS); // pluck angle from top, toward camera
const UPSTREAM = 0.9;                         // rad a fresh pin marches before its pluck
const DAMPING = 1.25;                         // 1/s drum friction
const IMPULSE = UPSTREAM * DAMPING * 1.15;    // one tx carries its own pin to the comb
const MAX_OMEGA = 3.2;                        // rad/s cap under floods
const PIN_CAP = 1400;
const FADE_ARC = 2.2;                         // rad of riding on after the pluck

let canvas = null;
let renderer = null;
let scene = null;
let camera = null;
let visible = false;
let rafId = null;
let lastFrame = 0;
let started = 0;

let drumGroup = null;
let pinMesh = null;
let teeth = [];          // { mesh, mat, flex, vel, omega }
let combAnchorMat = null;
let glint = 0;           // block glint intensity on the comb anchor

let theta = 0;           // unwrapped drum angle
let omega = 0;
let pins = [];           // slot pool, PIN_CAP entries
let pinOrder = [];       // active slot indices, oldest first
let recentByKey = new Map();
let bars = [];           // gold group bars: { mesh, phi, pluckTheta }

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const X_AXIS = new THREE.Vector3(1, 0, 0);

function hashString(value) {
  const s = typeof value === 'string' ? value : String(Math.random());
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function transactionKey(type, txData, txn) {
  if (typeof txData?.sig === 'string' && txData.sig) return txData.sig;
  return [type, txn?.snd, txn?.fv, txn?.lv, txn?.fee, txn?.grp]
    .map((v) => v ?? '')
    .join(':');
}

// Bigger amounts strike lower notes; amount-less txs scatter across the treble.
function toothFor(txn, seed) {
  const amount = typeof txn?.amt === 'number' ? txn.amt
    : typeof txn?.aamt === 'number' ? txn.aamt : 0;
  const weight = amount > 0
    ? Math.min(1, Math.log10(1 + amount) / 11)
    : 0.05 + ((seed >>> 8) % 1000) / 1000 * 0.3;
  return Math.max(0, Math.min(TOOTH_COUNT - 1, Math.round((1 - weight) * (TOOTH_COUNT - 1))));
}

function toothX(index) {
  // Tooth 0 is the longest bass tooth, at the far-left drum end (-X),
  // tapering to short treble teeth on the right.
  const t = index / (TOOTH_COUNT - 1);
  return -(DRUM_LENGTH / 2 - 0.1) + t * (DRUM_LENGTH - 0.2);
}

// --- Feeding ---

export function musicBoxAddTx(type, txData) {
  if (!renderer) return;
  const txn = txData?.txn ?? txData;

  if (type === 'group') {
    const members = Array.isArray(txData?.members) ? txData.members : [];
    const slots = [];
    for (const memberData of members) {
      const member = memberData?.txn ?? memberData ?? {};
      if (!(member.type in COLORS)) continue;
      const idx = recentByKey.get(transactionKey(member.type, memberData, member));
      const pin = idx !== undefined ? pins[idx] : null;
      if (pin && pin.active && !pin.plucked) slots.push(idx);
    }
    if (slots.length > 1) alignGroup(slots);
    return;
  }

  if (!(type in COLORS)) return;
  const seed = hashString(transactionKey(type, txData, txn) + (txn?.snd ?? ''));
  placePin(type, toothFor(txn, seed), transactionKey(type, txData, txn));
  omega = Math.min(MAX_OMEGA, omega + IMPULSE);
}

export function musicBoxAddBlock() {
  if (!renderer) return;
  glint = 1;
}

// --- Pins ---

function placePin(type, tooth, key) {
  let idx = pins.findIndex((p) => !p.active);
  if (idx === -1) {
    idx = pinOrder.shift() ?? 0;   // steal the oldest under flood
    freeSlot(idx);
  }
  const pin = pins[idx];
  pin.active = true;
  pin.plucked = false;
  pin.type = type;
  pin.tooth = tooth;
  pin.x = toothX(tooth);
  pin.phi = COMB_ANGLE + UPSTREAM + theta;
  pin.pluckTheta = theta + UPSTREAM;
  pinOrder.push(idx);
  recentByKey.set(key, idx);
  if (recentByKey.size > 600) {
    const first = recentByKey.keys().next().value;
    recentByKey.delete(first);
  }
  writePinMatrix(idx, 1);
  pinMesh.instanceMatrix.needsUpdate = true;
}

function freeSlot(idx) {
  const pin = pins[idx];
  pin.active = false;
  const at = pinOrder.indexOf(idx);
  if (at !== -1) pinOrder.splice(at, 1);
  writePinMatrix(idx, 0);
}

function writePinMatrix(idx, scale) {
  const pin = pins[idx];
  const r = DRUM_RADIUS + 0.03 * scale;
  _q.setFromAxisAngle(X_AXIS, pin.phi);
  _p.set(pin.x, r * Math.cos(pin.phi), r * Math.sin(pin.phi));
  _s.set(scale, scale, scale);
  _m.compose(_p, _q, _s);
  pinMesh.setMatrixAt(idx, _m);
}

// Snap group members onto the row of their earliest-placed member.
function alignGroup(slots) {
  const lead = pins[slots[0]];
  let minX = Infinity;
  let maxX = -Infinity;
  for (const idx of slots) {
    const pin = pins[idx];
    pin.phi = lead.phi;
    pin.pluckTheta = lead.pluckTheta;
    pin.x = toothX(pin.tooth);
    writePinMatrix(idx, 1);
    minX = Math.min(minX, pin.x);
    maxX = Math.max(maxX, pin.x);
  }
  pinMesh.instanceMatrix.needsUpdate = true;
  spawnBar(lead.phi, lead.pluckTheta, minX, maxX);
}

function spawnBar(phi, pluckTheta, minX, maxX) {
  const len = Math.max(0.12, maxX - minX);
  const geo = new THREE.CylinderGeometry(0.016, 0.016, len, 8);
  geo.rotateZ(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: GOLD, metalness: 1, roughness: 0.28,
    emissive: GOLD, emissiveIntensity: 0.35,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const r = DRUM_RADIUS + 0.045;
  mesh.position.set((minX + maxX) / 2, r * Math.cos(phi), r * Math.sin(phi));
  mesh.rotation.x = phi;
  drumGroup.add(mesh);
  bars.push({ mesh, pluckTheta });
  if (bars.length > 24) retireBar(bars.shift());
}

function retireBar(bar) {
  drumGroup.remove(bar.mesh);
  bar.mesh.geometry.dispose();
  bar.mesh.material.dispose();
}

// --- Scene construction ---

function woodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#9c6c3e';
  g.fillRect(0, 0, 512, 512);
  const rand = (() => { let s = 12345; return () => (s = Math.imul(s ^ (s >>> 15), 1 | s), ((s >>> 0) % 1000) / 1000); })();
  for (let i = 0; i < 90; i++) {
    const y = rand() * 512;
    g.strokeStyle = `rgba(${90 + rand() * 60}, ${55 + rand() * 40}, ${25 + rand() * 25}, ${0.08 + rand() * 0.16})`;
    g.lineWidth = 0.6 + rand() * 2.6;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3 * rand());
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0806);
  scene.fog = new THREE.Fog(0x0a0806, 9, 17);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.position.set(3.5, 6.5, 4.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -4; sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -4;
  sun.shadow.bias = -0.0005;
  scene.add(sun, new THREE.AmbientLight(0x40382e, 1.2));

  // Wooden board and dark bedplate.
  const wood = new THREE.Mesh(
    new THREE.BoxGeometry(8.5, 0.28, 6.2),
    new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.85 }),
  );
  wood.position.y = -0.14;
  wood.receiveShadow = true;
  scene.add(wood);

  const zinc = new THREE.MeshStandardMaterial({ color: 0x4c4f52, metalness: 0.75, roughness: 0.55 });
  const bed = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.26, 4.2), zinc);
  bed.position.set(0, 0.13, 0.15);
  bed.castShadow = bed.receiveShadow = true;
  scene.add(bed);

  // Small set-studs on the bedplate, like the souvenir.
  const screwMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 1, roughness: 0.3 });
  for (const [sx, sz] of [[-2.35, -1.35], [2.35, 1.35]]) {
    const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 12), screwMat);
    stud.position.set(sx, 0.32, sz);
    stud.castShadow = true;
    scene.add(stud);
  }

  // Drum: nickel cylinder, black end caps, riding pins.
  drumGroup = new THREE.Group();
  drumGroup.position.set(0, DRUM_Y, 0);
  scene.add(drumGroup);

  const drumGeo = new THREE.CylinderGeometry(DRUM_RADIUS, DRUM_RADIUS, DRUM_LENGTH, 48, 1, false);
  drumGeo.rotateZ(Math.PI / 2);
  const drum = new THREE.Mesh(drumGeo, new THREE.MeshStandardMaterial({
    color: 0xd6d9dd, metalness: 1, roughness: 0.32,
  }));
  drum.castShadow = drum.receiveShadow = true;
  drumGroup.add(drum);

  const capMat = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.5, roughness: 0.7 });
  for (const side of [-1, 1]) {
    const capGeo = new THREE.CylinderGeometry(DRUM_RADIUS + 0.12, DRUM_RADIUS + 0.12, 0.14, 40);
    capGeo.rotateZ(Math.PI / 2);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.x = side * (DRUM_LENGTH / 2 + 0.07);
    cap.castShadow = true;
    drumGroup.add(cap);
  }

  // Ratchet gear on the far end, turning with the drum.
  const gearMat = new THREE.MeshStandardMaterial({ color: 0x101113, metalness: 0.6, roughness: 0.55 });
  const gearGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.1, 32);
  gearGeo.rotateZ(Math.PI / 2);
  const gear = new THREE.Mesh(gearGeo, gearMat);
  gear.position.x = -(DRUM_LENGTH / 2 + 0.2);
  drumGroup.add(gear);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    const toothy = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.1), gearMat);
    toothy.position.set(-(DRUM_LENGTH / 2 + 0.2), Math.cos(a) * 0.56, Math.sin(a) * 0.56);
    toothy.rotation.x = a;
    drumGroup.add(toothy);
  }

  // Pins as one instanced mesh, child of the drum so they ride for free.
  const pinGeo = new THREE.CylinderGeometry(0.034, 0.045, 0.08, 8);
  pinMesh = new THREE.InstancedMesh(pinGeo,
    new THREE.MeshStandardMaterial({ color: 0xd9dcdf, metalness: 1, roughness: 0.28 }), PIN_CAP);
  pinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pinMesh.castShadow = true;
  drumGroup.add(pinMesh);
  for (let i = 0; i < PIN_CAP; i++) {
    pins.push({ active: false, plucked: false, type: 'pay', tooth: 0, phi: 0, pluckTheta: 0, x: 0 });
    writePinMatrix(i, 0);
  }
  pinMesh.instanceMatrix.needsUpdate = true;

  // The comb: anchor block behind, teeth reaching in to the drum. Bass teeth
  // are long and wide at the near end, tapering to short treble at the far.
  const tipZ = Math.sqrt(DRUM_RADIUS * DRUM_RADIUS - TOOTH_PLANE_Y * TOOTH_PLANE_Y) + 0.03;
  const toothPlane = DRUM_Y + TOOTH_PLANE_Y;
  const toothGeo = new THREE.BoxGeometry(1, 1, 1);
  toothGeo.translate(0, 0, -0.5); // pivot at the root
  for (let i = 0; i < TOOTH_COUNT; i++) {
    const t = i / (TOOTH_COUNT - 1);
    const len = 1.1 - t * 0.55;
    const width = 0.052 - t * 0.02;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc4c9cf, metalness: 1, roughness: 0.3,
      emissive: 0x000000, emissiveIntensity: 0,
    });
    const mesh = new THREE.Mesh(toothGeo, mat);
    mesh.scale.set(width, 0.04, len);
    mesh.position.set(toothX(i), toothPlane, tipZ + len);
    mesh.castShadow = true;
    scene.add(mesh);
    // Bass teeth ring slow and wide, treble fast and tight.
    teeth.push({ mesh, mat, pluckAt: -1, amp: 0.085 - t * 0.04, omega: 22 + t * 34 });
  }

  // The comb is one piece of steel: teeth grow out of a solid spine plate
  // whose front edge follows the tooth roots (deep at bass, shallow at
  // treble), screwed down through two phillips heads.
  const spineFrontBass = tipZ + 1.1 - 0.22;
  const spineFrontTreble = tipZ + 0.55 - 0.16;
  const spineBack = tipZ + 1.28;
  const spineShape = new THREE.Shape();
  spineShape.moveTo(-1.9, -spineBack);
  spineShape.lineTo(-1.9, -spineFrontBass);
  spineShape.lineTo(1.9, -spineFrontTreble);
  spineShape.lineTo(1.9, -spineBack);
  spineShape.closePath();
  const spineGeo = new THREE.ExtrudeGeometry(spineShape, { depth: 0.1, bevelEnabled: false });
  spineGeo.rotateX(-Math.PI / 2);
  const spine = new THREE.Mesh(spineGeo, new THREE.MeshStandardMaterial({
    color: 0xc4c9cf, metalness: 1, roughness: 0.3,
  }));
  spine.position.y = toothPlane - 0.045;
  spine.castShadow = spine.receiveShadow = true;
  scene.add(spine);

  // Two phillips screws clamping the spine, near the bass end.
  const spineTop = toothPlane + 0.055;
  const screwHeadMat = new THREE.MeshStandardMaterial({ color: 0xc9ced4, metalness: 1, roughness: 0.25 });
  const slotMat = new THREE.MeshStandardMaterial({ color: 0x2a2d30, metalness: 0.8, roughness: 0.6 });
  for (const [sx, sz] of [[-1.35, 1.88], [-0.45, 1.78]]) {
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 20), screwHeadMat);
    head.position.set(sx, spineTop + 0.045, sz);
    head.castShadow = true;
    scene.add(head);
    for (const rot of [0.4, 0.4 + Math.PI / 2]) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.045), slotMat);
      slot.position.set(sx, spineTop + 0.095, sz);
      slot.rotation.y = rot;
      scene.add(slot);
    }
  }

  // The round box: the dark pedestal the comb rests on, blinking gold on
  // each certified round.
  combAnchorMat = new THREE.MeshStandardMaterial({
    color: 0x1b1d20, metalness: 0.85, roughness: 0.45,
    emissive: GOLD, emissiveIntensity: 0,
  });
  const pedestalTop = toothPlane - 0.045;
  const pedestalHeight = pedestalTop - 0.26;
  const pedestal = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, pedestalHeight, 0.45), combAnchorMat);
  pedestal.position.set(0, 0.26 + pedestalHeight / 2, tipZ + 1.0);
  pedestal.castShadow = pedestal.receiveShadow = true;
  scene.add(pedestal);

  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
}

// --- Frame loop ---

function update(dt, now) {
  omega *= Math.exp(-DAMPING * dt);
  if (omega < 0.004) omega = 0;
  theta += omega * dt;
  drumGroup.rotation.x = -theta;

  let matrixDirty = false;
  for (let n = pinOrder.length - 1; n >= 0; n--) {
    const idx = pinOrder[n];
    const pin = pins[idx];
    if (!pin.plucked && theta >= pin.pluckTheta) {
      pin.plucked = true;
      pluck(pin.tooth, pin.type);
    }
    if (pin.plucked) {
      const past = theta - pin.pluckTheta;
      if (past > FADE_ARC) {
        freeSlot(idx);
        matrixDirty = true;
      } else if (past > FADE_ARC * 0.6) {
        const k = 1 - (past - FADE_ARC * 0.6) / (FADE_ARC * 0.4);
        writePinMatrix(idx, Math.max(0.001, k));
        matrixDirty = true;
      }
    }
  }
  if (matrixDirty) pinMesh.instanceMatrix.needsUpdate = true;

  for (let i = bars.length - 1; i >= 0; i--) {
    const bar = bars[i];
    const past = theta - bar.pluckTheta;
    if (past > FADE_ARC) {
      retireBar(bar);
      bars.splice(i, 1);
    } else if (past > 0) {
      bar.mesh.material.emissiveIntensity = 0.35 * (1 - past / FADE_ARC);
    }
  }

  // Plucked teeth ring down as an analytic damped sine — stable at any dt.
  for (const tooth of teeth) {
    if (tooth.pluckAt < 0) continue;
    const age = (now - tooth.pluckAt) / 1000;
    const envelope = Math.exp(-2.6 * age);
    if (envelope < 0.01 && tooth.mat.emissiveIntensity < 0.01) {
      tooth.pluckAt = -1;
      tooth.mesh.rotation.x = 0;
      tooth.mat.emissiveIntensity = 0;
      continue;
    }
    tooth.mesh.rotation.x = tooth.amp * envelope * Math.sin(tooth.omega * age);
    tooth.mat.emissiveIntensity = Math.max(0, tooth.mat.emissiveIntensity - dt * 1.4);
  }

  if (glint > 0) {
    glint = Math.max(0, glint - dt * 1.1);
    combAnchorMat.emissiveIntensity = glint * 0.12;
  }

  // Three-quarter view with a slow, small drift — the souvenir on its shelf.
  const sway = Math.sin((now - started) * 0.00021) * 0.22;
  camera.position.set(3.54 + sway, 3.74, 5.29);
  camera.lookAt(0.15, 0.75, 0);
}

function pluck(toothIndex, type) {
  const tooth = teeth[toothIndex];
  tooth.pluckAt = performance.now();
  _c.set(COLORS[type]);
  tooth.mat.emissive.copy(_c);
  tooth.mat.emissiveIntensity = 1.15;
}

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(1.75, window.devicePixelRatio || 1);
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(dpr);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function loop(ts) {
  if (!visible || document.hidden) {
    rafId = null;
    return;
  }
  const now = ts || performance.now();
  const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
  lastFrame = now;
  update(dt, now);
  renderer.render(scene, camera);
  rafId = requestAnimationFrame(loop);
}

function wake() {
  if (rafId === null && visible && !document.hidden) {
    lastFrame = performance.now();
    resize();
    rafId = requestAnimationFrame(loop);
  }
}

export function initMusicBoxViz(canvasEl) {
  if (!canvasEl || renderer) return;
  canvas = canvasEl;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  started = performance.now();
  buildScene();

  new ResizeObserver(resize).observe(canvas);
  const observer = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? false;
    wake();
  });
  observer.observe(canvas);
  document.addEventListener('visibilitychange', wake);
  wake();
}
