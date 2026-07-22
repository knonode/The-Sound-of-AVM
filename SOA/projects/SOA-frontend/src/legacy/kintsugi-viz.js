/*
 * kintsugi-viz.js — Kintsugi Ledger.
 *
 * The live ledger is a dark ceramic disc. Transactions strike its surface and
 * grow colored fractures; identity selects the impact, amount the reach, type
 * the glaze. Atomic groups join their member fractures with a gold seam.
 * A block certifies the state: every open crack flashes gold, the repaired
 * disc slips into an archive of prior rounds, and a clean ledger rises.
 *
 * Rendering sleeps while the fullscreen canvas is not visible.
 */

const TYPES = ['pay', 'axfer', 'appl', 'acfg', 'keyreg', 'afrz', 'stpf', 'hb'];
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
const GOLD = '#f5c85b';
const TAU = Math.PI * 2;

let canvas = null;
let ctx = null;
let rafId = null;
let visible = false;
let lastFrame = 0;
let currentRound = null;
let cracks = [];
let seams = [];
let archive = [];
let dust = [];
let seal = null;
let discSeed = Math.random() * 1000;
let arrivalSequence = 0;

function hashString(value) {
  const s = typeof value === 'string' ? value : String(Math.random());
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function amountWeight(txn) {
  const amount = typeof txn?.amt === 'number' ? txn.amt
    : typeof txn?.aamt === 'number' ? txn.aamt : 0;
  return amount > 0 ? Math.min(1, Math.log10(1 + amount) / 11) : 0.18;
}

function randomFrom(seed) {
  let state = seed || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function pointOnDisc(angle, radius, cx, cy) {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

function transactionKey(type, txData, txn) {
  if (typeof txData?.sig === 'string' && txData.sig) return txData.sig;
  return [type, txn?.snd, txn?.fv, txn?.lv, txn?.fee, txn?.grp]
    .map((v) => v ?? '')
    .join(':');
}

function makeCrack(type, txData, ordinal = 0) {
  const txn = txData?.txn ?? txData;
  const key = transactionKey(type, txData, txn);
  const identity = `${key}|${txData?.receivedAt ?? ''}|${ordinal}|${arrivalSequence++}`;
  const txHash = hashString(identity);
  const senderHash = hashString(txn?.snd ?? txn?.sender ?? 'anonymous');
  const rand = randomFrom(txHash);

  // The plate is a hash space: transaction identity distributes impacts
  // uniformly over its whole surface, independent of traffic type.
  const originAngle = rand() * TAU;
  const originRadius = 0.07 + Math.sqrt(rand()) * 0.39;
  const weight = amountWeight(txn);
  const reach = 0.32 + weight * 0.43;
  let direction = originAngle + (rand() - 0.5) * 1.15;
  const nodes = [];
  const segments = 4 + Math.floor(rand() * 3);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    if (i > 0) direction += (rand() - 0.5) * (0.22 + 0.18 * (1 - t));
    nodes.push({
      angle: direction,
      radius: Math.min(0.94, originRadius + reach * t),
      jitter: (rand() - 0.5) * 0.018,
    });
  }
  return {
    key,
    type,
    color: COLORS[type] ?? GOLD,
    angle: nodes[nodes.length - 1].angle,
    reach,
    nodes,
    branchAt: 1 + Math.floor(rand() * Math.max(1, segments - 2)),
    // Sender survives only as a small recurring branch gesture—a maker's
    // mark—rather than forcing repeat transactions onto the same fracture.
    branchAngle: direction + (senderHash & 1 ? -1 : 1) * (0.34 + ((senderHash >>> 8) % 100) / 220),
    branchReach: 0.08 + rand() * 0.16,
    born: performance.now(),
    speed: 0.65 + ((senderHash >>> 16) % 100) / 180,
    width: 0.65 + weight * 1.65,
    seed: senderHash,
  };
}

export function kintsugiAddTx(type, txData) {
  if (!canvas) return;
  const txn = txData?.txn ?? txData;

  if (type === 'group') {
    const members = Array.isArray(txData?.members) ? txData.members : [];
    const points = [];
    for (const memberData of members) {
      const member = memberData?.txn ?? memberData ?? {};
      const memberType = member.type;
      if (!(memberType in COLORS)) continue;
      const key = transactionKey(memberType, memberData, member);
      const crack = cracks.findLast((candidate) => candidate.key === key);
      if (!crack) continue;
      const end = crack.nodes[crack.nodes.length - 1];
      points.push({ angle: end.angle, radius: end.radius });
    }
    if (points.length > 1) seams.push({ points, born: performance.now(), life: 2.8 });
    return;
  }

  if (!(type in COLORS)) return;
  cracks.push(makeCrack(type, txData));
  if (cracks.length > 520) cracks.splice(0, cracks.length - 520);
}

export function kintsugiAddBlock(round) {
  const now = performance.now();
  currentRound = round;
  archive.unshift({
    round,
    born: now,
    cracks: cracks.map((c) => ({ ...c, progress: 1 })),
    seams: seams.map((s) => ({ ...s })),
    seed: discSeed,
  });
  if (archive.length > 7) archive.length = 7;

  seal = visible ? { born: now, duration: 1250 } : null;
  if (visible) {
    for (const c of cracks) {
      const count = 2 + Math.round(c.width);
      for (let i = 0; i < count; i++) {
        const node = c.nodes[Math.floor(Math.random() * c.nodes.length)];
        dust.push({
          angle: node.angle + (Math.random() - 0.5) * 0.12,
          radius: node.radius,
          drift: 12 + Math.random() * 32,
          life: 0.8 + Math.random() * 0.8,
          max: 1.6,
        });
      }
    }
    if (dust.length > 1600) dust.splice(0, dust.length - 1600);
  }
  cracks = [];
  seams = [];
  discSeed = Math.random() * 1000;
}

function crackPoints(c, progress, cx, cy, radius) {
  const max = Math.max(0, (c.nodes.length - 1) * progress);
  const full = Math.floor(max);
  const points = c.nodes.slice(0, full + 1).map((node) => pointOnDisc(
    node.angle + node.jitter,
    radius * node.radius,
    cx,
    cy,
  ));
  if (full < c.nodes.length - 1) {
    const a = c.nodes[full];
    const b = c.nodes[full + 1];
    const t = max - full;
    points.push(pointOnDisc(
      a.angle + (b.angle - a.angle) * t,
      radius * (a.radius + (b.radius - a.radius) * t),
      cx,
      cy,
    ));
  }
  return points;
}

function strokeCrack(c, progress, cx, cy, radius, color, alpha = 1, scale = 1) {
  if (progress <= 0) return;
  const points = crackPoints(c, progress, cx, cy, radius);
  if (points.length < 2) return;

  // Dark substrate gives every signal the depth of a physical fracture.
  ctx.strokeStyle = `rgba(0, 2, 5, ${Math.min(0.72, alpha * 0.78)})`;
  ctx.lineWidth = Math.max(1.4, c.width * scale * 2.6);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();

  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = Math.max(0.65, c.width * scale);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();

  const branchProgress = Math.max(0, Math.min(1, progress * 1.7 - 0.7));
  if (branchProgress > 0 && c.branchAt < c.nodes.length) {
    const node = c.nodes[c.branchAt];
    const fork = pointOnDisc(node.angle, radius * node.radius, cx, cy);
    const tip = pointOnDisc(c.branchAngle, radius * c.branchReach * branchProgress, fork.x, fork.y);
    ctx.lineWidth *= 0.55;
    ctx.beginPath();
    ctx.moveTo(fork.x, fork.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
  }
}

function drawDisc(cx, cy, radius, alpha = 1, seed = discSeed) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = radius * 0.18;
  ctx.shadowOffsetY = radius * 0.08;

  const glaze = ctx.createRadialGradient(
    cx - radius * 0.3, cy - radius * 0.34, radius * 0.04,
    cx, cy, radius,
  );
  glaze.addColorStop(0, '#263449');
  glaze.addColorStop(0.5, '#111a29');
  glaze.addColorStop(0.88, '#080d16');
  glaze.addColorStop(1, '#02050a');
  ctx.fillStyle = glaze;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(182, 210, 235, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 1, 0, TAU);
  ctx.stroke();

  // Subtle ceramic rings: state feels layered, not flat.
  for (let i = 1; i <= 4; i++) {
    const wobble = Math.sin(seed + i * 2.17) * radius * 0.006;
    ctx.strokeStyle = `rgba(126, 156, 184, ${0.025 + i * 0.006})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx + wobble, cy, radius * (i / 5), radius * (i / 5) * 0.97, seed * 0.01, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSeam(seam, now, cx, cy, radius, alpha = 1) {
  const age = Math.min(1, (now - seam.born) / 800);
  if (seam.points.length < 2) return;
  const points = seam.points.map((p) => pointOnDisc(p.angle, radius * p.radius, cx, cy));
  ctx.strokeStyle = rgba(GOLD, alpha * (0.55 + age * 0.35));
  ctx.lineWidth = 1.7;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    ctx.quadraticCurveTo(cx, cy, p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawArchive(now, w, h) {
  const baseX = w * 0.82;
  const baseY = h * 0.17;
  const maxR = Math.min(w, h) * 0.095;
  ctx.font = '9px "Berkeley Mono Trial", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (let i = archive.length - 1; i >= 0; i--) {
    const plate = archive[i];
    const enter = Math.min(1, (now - plate.born) / 700);
    const depth = i + (1 - enter);
    const scale = Math.pow(0.78, depth);
    const r = maxR * scale;
    const x = baseX + depth * maxR * 0.42;
    const y = baseY + depth * maxR * 0.68;
    const alpha = Math.max(0.16, 0.78 - depth * 0.1);
    drawDisc(x, y, r, alpha, plate.seed);
    for (const c of plate.cracks) strokeCrack(c, 1, x, y, r, GOLD, alpha * 0.9, scale);
    for (const s of plate.seams) drawSeam(s, now, x, y, r, alpha);
    ctx.fillStyle = `rgba(205, 222, 235, ${alpha * 0.72})`;
    ctx.fillText(String(plate.round), x, y + r + 5);
  }
}

function update(dt) {
  for (const p of dust) {
    p.radius += p.drift * dt / 500;
    p.life -= dt;
  }
  dust = dust.filter((p) => p.life > 0);
  const now = performance.now();
  seams = seams.filter((s) => now - s.born < s.life * 1000);
  if (seal && now - seal.born > seal.duration) seal = null;
}

function draw(now) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const bg = ctx.createRadialGradient(w * 0.45, h * 0.45, 0, w * 0.45, h * 0.45, Math.max(w, h) * 0.8);
  bg.addColorStop(0, '#10121b');
  bg.addColorStop(0.58, '#070810');
  bg.addColorStop(1, '#020307');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Sparse workshop dust, deterministic in screen space.
  ctx.fillStyle = 'rgba(225, 207, 167, 0.16)';
  for (let i = 0; i < 90; i++) {
    const x = ((i * 499 + 73) % 997) / 997 * w;
    const y = ((i * 281 + 19) % 991) / 991 * h;
    ctx.fillRect(x, y, i % 11 === 0 ? 1.4 : 0.7, i % 11 === 0 ? 1.4 : 0.7);
  }

  const radius = Math.min(w, h) * 0.31;
  const cx = w * 0.42;
  const cy = h * 0.52;
  drawArchive(now, w, h);
  drawDisc(cx, cy, radius);

  for (const c of cracks) {
    const progress = Math.min(1, (now - c.born) / 1000 * c.speed);
    strokeCrack(c, easeOut(progress), cx, cy, radius, c.color, 0.9);
    if (progress < 1) {
      const points = crackPoints(c, easeOut(progress), cx, cy, radius);
      const tip = points[points.length - 1];
      const glow = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 9 + c.width * 2);
      glow.addColorStop(0, rgba(c.color, 0.7));
      glow.addColorStop(1, rgba(c.color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 11, 0, TAU);
      ctx.fill();
    }
  }
  for (const seam of seams) drawSeam(seam, now, cx, cy, radius);

  if (seal) {
    const p = Math.min(1, (now - seal.born) / seal.duration);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const c of archive[0]?.cracks ?? []) strokeCrack(c, p, cx, cy, radius, GOLD, (1 - p) * 0.9 + 0.18);
    ctx.strokeStyle = rgba(GOLD, Math.sin(Math.PI * p) * 0.42);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (0.2 + p * 0.86), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  ctx.globalCompositeOperation = 'lighter';
  for (const p of dust) {
    const alpha = Math.max(0, p.life / p.max);
    const q = pointOnDisc(p.angle, radius * p.radius, cx, cy);
    ctx.fillStyle = rgba(GOLD, alpha * 0.45);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 0.8 + alpha * 1.4, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '10px "Berkeley Mono Trial", monospace';
  ctx.fillStyle = 'rgba(210, 222, 232, 0.56)';
  ctx.fillText('KINTSUGI LEDGER', 18, 18);
  ctx.fillStyle = 'rgba(210, 222, 232, 0.26)';
  ctx.fillText('pending state · fractures', 18, 34);
  ctx.textAlign = 'right';
  ctx.fillText('certified rounds · repaired archive', w - 18, 18);
  ctx.fillStyle = 'rgba(245, 200, 91, 0.62)';
  ctx.fillText(currentRound === null ? 'waiting for block' : `round ${currentRound}`, w - 18, h - 28);
}

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Number(alpha).toFixed(3)})`;
}

function easeOut(t) {
  const p = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - p, 3);
}

function loop(ts) {
  if (!visible || document.hidden) {
    rafId = null;
    return;
  }
  const now = ts || performance.now();
  const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
  lastFrame = now;
  update(dt);
  draw(now);
  rafId = requestAnimationFrame(loop);
}

function wake() {
  if (rafId === null && visible && !document.hidden) {
    lastFrame = performance.now();
    rafId = requestAnimationFrame(loop);
  }
}

export function initKintsugiViz(canvasEl) {
  if (!canvasEl || canvas) return;
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  const observer = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? false;
    wake();
  });
  observer.observe(canvas);
  document.addEventListener('visibilitychange', wake);
  wake();
}
