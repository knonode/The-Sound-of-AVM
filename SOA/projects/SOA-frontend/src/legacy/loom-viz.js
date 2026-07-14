/*
 * loom-viz.js — The Loom. A Fable original.
 *
 * The ledger as fabric. Forty-eight warp threads run down a dark loom, and
 * every sender is hashed onto one of them — deterministically, so the same
 * address always returns to the same thread. A transaction is a knot tied
 * where its sender's thread crosses the row being woven; amount sets the
 * knot's size, type its color. When a block certifies, the shuttle passes:
 * the working row locks into cloth and the fabric advances one row down.
 *
 * What emerges is honest texture. Organic traffic weaves tweed; a bot
 * hammering the chain becomes a bright vertical stripe; an atomic group is
 * a gold float carried across its members' threads; a state proof is a
 * silver band through the whole width of the cloth.
 *
 * Like the Score, rendering sleeps whenever the canvas isn't on screen.
 */

const THREADS = 48;
const ROW_H = 16;
const SHUTTLE_H = 52; // working row at the top where pending knots appear
const GUTTER_R = 54;  // right margin for round numbers

const COLORS = {
  pay: '#4f83f7',
  axfer: '#e05252',
  appl: '#b06af0',
  acfg: '#3fbf74',
  keyreg: '#38b6cf',
  afrz: '#f08a3c',
  stpf: '#e8e8f0',
  hb: '#9fce3f',
};

let canvas = null;
let ctx = null;
let rafId = null;
let visible = false;
let lastFrame = 0;

let pendingKnots = [];  // { thread, type, size, t }
let pendingFloats = []; // { threads: [..], t }
let rows = [];          // newest first: { round, knots, floats, stpf }
const heat = new Float32Array(THREADS); // recent activity per thread

// djb2 over the address string: same sender, same thread, always.
function threadOf(snd) {
  if (typeof snd !== 'string' || !snd) return Math.floor(Math.random() * THREADS);
  let h = 5381;
  for (let i = 0; i < snd.length; i++) h = ((h << 5) + h + snd.charCodeAt(i)) | 0;
  return Math.abs(h) % THREADS;
}

function knotSize(txn) {
  const amt = typeof txn?.amt === 'number' ? txn.amt : typeof txn?.aamt === 'number' ? txn.aamt : 0;
  if (amt <= 0) return 2.2;
  return Math.min(7, 2.2 + Math.log10(1 + amt / 1e6) * 1.1);
}

export function loomAddTx(type, txData) {
  const txn = txData?.txn ?? txData;

  if (type === 'group') {
    // A float: the weft carried across the member senders' threads
    const members = Array.isArray(txData?.members) ? txData.members : [];
    const threads = [...new Set(members.map((m) => threadOf(m?.txn?.snd)))];
    if (threads.length > 1) pendingFloats.push({ threads, t: Date.now() });
    return;
  }
  if (!(type in COLORS)) return;

  const thread = threadOf(txn?.snd);
  heat[thread] = Math.min(6, heat[thread] + 1);
  pendingKnots.push({ thread, type, size: knotSize(txn), t: Date.now() });
  if (pendingKnots.length > 400) pendingKnots.splice(0, pendingKnots.length - 400);
}

export function loomAddBlock(round) {
  rows.unshift({
    round,
    knots: pendingKnots,
    floats: pendingFloats,
    stpf: pendingKnots.some((k) => k.type === 'stpf'),
  });
  pendingKnots = [];
  pendingFloats = [];
  if (rows.length > 90) rows.length = 90;
}

function threadX(i, w) {
  const span = w - GUTTER_R - 12;
  return 12 + ((i + 0.5) / THREADS) * span;
}

function draw(now) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // decay thread heat with real elapsed time
  const dt = Math.min(0.2, (now - lastFrame) / 1000 || 0.016);
  lastFrame = now;
  for (let i = 0; i < THREADS; i++) heat[i] = Math.max(0, heat[i] - dt * 0.6);

  // the loom
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#04140f');
  bg.addColorStop(1, '#020b08');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // warp threads, glowing with recent activity
  for (let i = 0; i < THREADS; i++) {
    const x = threadX(i, w);
    ctx.strokeStyle = `rgba(120, 220, 190, ${(0.05 + Math.min(0.4, heat[i] * 0.07)).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // shuttle separator
  ctx.strokeStyle = 'rgba(160, 240, 210, 0.25)';
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(0, SHUTTLE_H);
  ctx.lineTo(w, SHUTTLE_H);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '9px "Berkeley Mono Trial", monospace';
  ctx.textBaseline = 'middle';

  // woven cloth: newest row right under the shuttle
  const maxRows = Math.floor((h - SHUTTLE_H) / ROW_H);
  for (let r = 0; r < Math.min(rows.length, maxRows); r++) {
    const row = rows[r];
    const y = SHUTTLE_H + (r + 0.5) * ROW_H;
    const fade = Math.max(0.22, 1 - (r / maxRows) * 0.85);

    // state proof: a silver band through the whole cloth
    if (row.stpf) {
      const band = ctx.createLinearGradient(0, y - ROW_H / 2, 0, y + ROW_H / 2);
      band.addColorStop(0, 'rgba(220, 220, 235, 0)');
      band.addColorStop(0.5, `rgba(220, 220, 235, ${0.16 * fade})`);
      band.addColorStop(1, 'rgba(220, 220, 235, 0)');
      ctx.fillStyle = band;
      ctx.fillRect(0, y - ROW_H / 2, w, ROW_H);
    }

    // weft pass
    ctx.strokeStyle = `rgba(190, 235, 215, ${(0.1 * fade).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, y);
    ctx.lineTo(w - GUTTER_R, y);
    ctx.stroke();

    // gold floats: groups carried across their members' threads
    for (const f of row.floats) {
      const xs = f.threads.map((t) => threadX(t, w));
      ctx.strokeStyle = `rgba(224, 176, 48, ${(0.65 * fade).toFixed(3)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(Math.min(...xs), y);
      ctx.lineTo(Math.max(...xs), y);
      ctx.stroke();
    }

    // knots
    ctx.globalAlpha = fade;
    for (const k of row.knots) {
      ctx.fillStyle = COLORS[k.type];
      ctx.beginPath();
      ctx.arc(threadX(k.thread, w), y, k.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // round number in the right selvage
    ctx.fillStyle = `rgba(150, 210, 190, ${(0.4 * fade).toFixed(3)})`;
    ctx.fillText(String(row.round), w - GUTTER_R + 8, y);
  }

  // the shuttle: pending knots pulse while the row is still being woven
  for (const k of pendingKnots) {
    const x = threadX(k.thread, w);
    const jitterY = 12 + ((k.t * 7919) % Math.max(1, SHUTTLE_H - 24));
    const pulse = 0.65 + 0.35 * Math.sin(now / 180 + k.thread);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = COLORS[k.type];
    ctx.beginPath();
    ctx.arc(x, jitterY, k.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // pending gold floats stretch across the shuttle zone
  for (const f of pendingFloats) {
    const xs = f.threads.map((t) => threadX(t, w));
    ctx.strokeStyle = 'rgba(224, 176, 48, 0.7)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(Math.min(...xs), SHUTTLE_H / 2);
    ctx.lineTo(Math.max(...xs), SHUTTLE_H / 2);
    ctx.stroke();
  }
}

function loop(ts) {
  if (!visible || document.hidden) {
    rafId = null;
    return;
  }
  draw(ts || performance.now());
  rafId = requestAnimationFrame(loop);
}

function wake() {
  if (rafId === null && visible && !document.hidden) {
    rafId = requestAnimationFrame(loop);
  }
}

export function initLoomViz(canvasEl) {
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
