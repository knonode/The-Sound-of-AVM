/*
 * xenakis-viz.js — the score.
 *
 * Inspired by Xenakis's graphic scores (Metastaseis): the ledger is
 * stochastic, his scores look like a ledger. Time flows right to left past
 * a red "now" line. Every transaction is a stroke that begins when it
 * enters the mempool and ends at the barline that certifies it — so the
 * LENGTH of a stroke is its real residence time in the pool. Amount tilts
 * the stroke upward (glissando). Atomic groups tie their members together
 * with a vertical gold brace. Blocks are barlines carrying round numbers.
 *
 * Rendering is gated: the rAF loop only runs while the canvas is actually
 * visible on screen, so the section costs ~nothing when scrolled away.
 */

const TYPE_ROWS = ['pay', 'axfer', 'appl', 'acfg', 'keyreg', 'afrz', 'stpf', 'hb', 'group'];
const COLORS = {
  pay: '#2563eb',
  axfer: '#dc2626',
  appl: '#9333ea',
  acfg: '#16a34a',
  keyreg: '#0891b2',
  afrz: '#ea580c',
  stpf: '#be185d',
  hb: '#65a30d',
  group: '#d4a017',
};

const PX_PER_SEC = 22;      // scroll speed: ~55s of history on a wide screen
const NOW_FRAC = 0.78;      // the red line sits at 78% of the width
const LABEL_GUTTER = 46;    // left gutter for row labels

const rowIndex = Object.fromEntries(TYPE_ROWS.map((t, i) => [t, i]));

let canvas = null;
let ctx = null;
let rafId = null;
let visible = false;

let strokes = [];   // { t, certT|null, row, rise, y0, width }
let barlines = [];  // { t, round }
let ties = [];      // { t, rows: [minRow, maxRow] }

function nowX(width) {
  return LABEL_GUTTER + (width - LABEL_GUTTER) * NOW_FRAC;
}

function xAt(time, now, width) {
  return nowX(width) - ((now - time) / 1000) * PX_PER_SEC;
}

// Amount (µ-units) -> upward glissando rise in px
function amountRise(txn) {
  const amt = typeof txn?.amt === 'number' ? txn.amt : typeof txn?.aamt === 'number' ? txn.aamt : 0;
  if (amt <= 0) return 0;
  return Math.min(26, Math.log10(1 + amt / 1e6) * 5);
}

export function vizAddTx(type, txData) {
  const row = rowIndex[type];
  if (row === undefined) return;
  const txn = txData?.txn ?? txData;
  const t = txData?.receivedAt ?? Date.now();

  strokes.push({
    t,
    certT: null,
    row,
    rise: amountRise(txn),
    jitter: Math.random(), // vertical position within the row band
    width: type === 'stpf' ? 3 : type === 'group' ? 2 : 1.4,
  });

  // Group brace: tie the member types together at the arrival instant
  if (type === 'group' && Array.isArray(txn?.types)) {
    const rows = txn.types.map((mt) => rowIndex[mt]).filter((r) => r !== undefined);
    if (rows.length > 1) {
      ties.push({ t, rows: [Math.min(...rows), Math.max(...rows)] });
    }
  }

  if (strokes.length > 6000) strokes.splice(0, strokes.length - 6000);
}

export function vizAddBlock(round) {
  const t = Date.now();
  barlines.push({ t, round });
  // Certification: the pool drains into the block — every open stroke ends
  // at this barline. (Honest at Algorand's current TPS; txs the block did
  // not take will re-enter as fresh strokes when they re-gossip.)
  for (const s of strokes) {
    if (s.certT === null) s.certT = t;
  }
  if (barlines.length > 100) barlines.splice(0, barlines.length - 100);
}

function prune(now, width) {
  strokes = strokes.filter((s) => xAt(s.certT ?? now, now, width) > LABEL_GUTTER - 60);
  barlines = barlines.filter((b) => xAt(b.t, now, width) > LABEL_GUTTER - 60);
  ties = ties.filter((k) => xAt(k.t, now, width) > LABEL_GUTTER - 60);
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const now = Date.now();
  prune(now, w);

  // Score paper
  const paper = ctx.createLinearGradient(0, 0, 0, h);
  paper.addColorStop(0, '#f8f8f6');
  paper.addColorStop(1, '#e9e9e5');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);

  const rowH = h / TYPE_ROWS.length;

  // Staff lines + labels
  ctx.font = '9px "Berkeley Mono Trial", monospace';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= TYPE_ROWS.length; i++) {
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LABEL_GUTTER, i * rowH);
    ctx.lineTo(w, i * rowH);
    ctx.stroke();
    if (i < TYPE_ROWS.length) {
      ctx.fillStyle = COLORS[TYPE_ROWS[i]];
      ctx.fillText(TYPE_ROWS[i], 6, (i + 0.5) * rowH);
    }
  }

  // Barlines with round numbers
  for (const b of barlines) {
    const x = xAt(b.t, now, w);
    if (x < LABEL_GUTTER) continue;
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.translate(x - 3, h - 4);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(String(b.round), 0, 0);
    ctx.restore();
  }

  // Group braces (behind the strokes)
  for (const k of ties) {
    const x = xAt(k.t, now, w);
    if (x < LABEL_GUTTER) continue;
    ctx.strokeStyle = 'rgba(212, 160, 23, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, (k.rows[0] + 0.5) * rowH);
    ctx.lineTo(x, (k.rows[1] + 0.5) * rowH);
    ctx.stroke();
  }

  // Transaction strokes: arrival -> certification (or the now line)
  const nx = nowX(w);
  for (const s of strokes) {
    const x0 = xAt(s.t, now, w);
    const x1 = s.certT === null ? nx : xAt(s.certT, now, w);
    if (x1 < LABEL_GUTTER) continue;

    const yBase = s.row * rowH + rowH * (0.25 + s.jitter * 0.5);
    const pending = s.certT === null;
    const type = TYPE_ROWS[s.row];

    ctx.strokeStyle = COLORS[type] + (pending ? 'ff' : '99');
    ctx.lineWidth = s.width;
    ctx.beginPath();
    ctx.moveTo(Math.max(x0, LABEL_GUTTER), yBase);
    ctx.lineTo(x1, yBase - s.rise); // glissando: amount tilts the line up
    ctx.stroke();

    // Arrival tick
    if (x0 >= LABEL_GUTTER) {
      ctx.fillStyle = COLORS[type];
      ctx.fillRect(x0 - 0.75, yBase - 2.5, 1.5, 5);
    }
  }

  // The present
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(nx, 0);
  ctx.lineTo(nx, h);
  ctx.stroke();
}

function loop() {
  if (!visible || document.hidden) {
    rafId = null; // sleep; visibility handlers wake us up
    return;
  }
  draw();
  rafId = requestAnimationFrame(loop);
}

function wake() {
  if (rafId === null && visible && !document.hidden) {
    rafId = requestAnimationFrame(loop);
  }
}

export function initXenakisViz(canvasEl) {
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
