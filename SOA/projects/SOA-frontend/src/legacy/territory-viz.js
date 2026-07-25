/*
 * territory-viz.js — Territory.
 *
 * The mempool as contested ground. Every transaction is a plain rectangle
 * that claims its share of the screen, and the screen is always full. A
 * payment arriving into a quiet pool takes everything; the next one takes
 * its cut and the first is squeezed aside to make room. Area is share:
 * a cell's fraction of the viewport is its weight over the weight of all
 * standing territory, at every depth.
 *
 * An arrival takes the cell where it leaves the squarest ground behind, ties
 * going to the cell with most room, and cuts it whichever way keeps the pair
 * nearest to square. Aiming purely at the biggest cell sounds right and is
 * not: a dust payment landing in a whale can only shave a splinter off it,
 * whichever way the knife falls, and the map shreds into stripes. Choosing on
 * squareness sends a claim to ground its own size, so like sizes gather and
 * arrivals still surface all over the map rather than at one edge.
 *
 * Two kinds of claim. Transactions carrying value are elastic — they take
 * sqrt(algo), so an eight-algo payment reads as clearly larger than a
 * two-algo one without a whale erasing the map. Transactions carrying no
 * value at all — keyreg, acfg, afrz, stpf, hb, and zero-amount opt-ins —
 * are rigid: a fixed slab that holds its size while everything around it
 * gives way. Application calls are elastic on fee, which is their
 * computational footprint. An atomic group is one ochre-framed enclosure
 * that lands, holds and dies as a unit; nothing else may split it.
 *
 * Nothing is cleared on a block. The cohort standing when a round certifies
 * dries into the paper — half the saturation, thinned until the sheet reads
 * through it — so what is still being proposed is the only thing at full
 * strength, and the settled record is ground. Territory is lost only to
 * pressure: when the map is full, the oldest is squeezed out of existence
 * by what is arriving.
 *
 * The whole thing is CSS. Each cell's flex-grow IS its weight, and flex-grow
 * is transitioned — so a cell entering at zero and animating to its weight
 * makes the browser re-run layout every frame, and every sibling and
 * ancestor gives way on its own. There is no render loop; an idle Territory
 * costs nothing. Easing is ease-in on purpose: width is grow/(grow+rest),
 * which is concave, so a linear ramp would do half its travel in the first
 * eighth of the duration. ease-in cancels that into even motion.
 *
 *
 * CHANNELS — what is spent, and what is deliberately still free.
 *
 * Spent: area is weight; hue family is transaction type; saturation with
 * alpha is pending against certified; an enclosure with an ochre frame is an
 * atomic group; rigid against elastic is whether the transaction carries
 * value at all; and shade within a hue family is which app or which asset.
 *
 * Held in reserve:
 *
 *   Rule weight. The outline between cells is uniform today. It is the
 *   cleanest channel left — an outline costs no layout, so varying its
 *   thickness is free, and Mondrian varies line weight anyway, so it belongs
 *   to the look rather than being imposed on it. The obvious claimant is
 *   apan, the on-completion: a heavier rule around UpdateApp and DeleteApp,
 *   which are rare and mean somebody is mutating or destroying a live
 *   contract. Do not spend it on anything common.
 *
 *   Time. Nothing uses entry duration or easing per cell, and no other
 *   visualization here can, since this is the only one the browser animates.
 *   It only reads at the instant of arrival, so it suits the rare and grave
 *   and is wasted on anything frequent.
 *
 *   Subdivision inside a cell is possible — the group machinery already does
 *   it — but it is not free: a subdivided cell reads as a group. The
 *   capability is there; the vocabulary is already spent.
 *
 * Position and aspect are not available at all. The squareness rule owns
 * geometry, and overriding it to carry meaning would cost the coherence that
 * makes the map readable in the first place.
 *
 * The restraint is the point. Every channel here means exactly one thing and
 * needs no explanation. A few more and it becomes a code, and a code needs a
 * legend — at which point this stops being something you can just look at.
 */

// Ink on paper. Held as hue/saturation/lightness rather than hex so that the
// one rule that matters here can be stated instead of tabulated: a certified
// claim is the same ink at half the saturation, thinned so the paper comes
// through. Pending is wet and full-strength; a round certifies and the ink
// dries into the sheet.
//
// These are deeper than the palette the other visualizations share, because
// those were chosen to glow on a near-black ground and would read as pastel
// on paper. Note stpf, which is white elsewhere and would vanish here: as the
// rarest and heaviest transaction on the chain it becomes plain black ink.
const INK = {
  pay: [223, 65, 47],
  axfer: [5, 62, 50],
  appl: [272, 46, 50],
  acfg: [153, 62, 32],
  keyreg: [189, 82, 34],
  afrz: [30, 75, 48],
  stpf: [40, 8, 16],
  hb: [74, 63, 37],
};
const GROUP_INK = [40, 65, 45];
const CERTIFIED_SAT = 0.5;   // "half as saturated" — the whole rule
const CERTIFIED_ALPHA = 0.20; // thinned, so the sheet shows through

function wet([h, s, l]) {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function dry([h, s, l]) {
  return `hsla(${h}, ${(s * CERTIFIED_SAT).toFixed(1)}%, ${l}%, ${CERTIFIED_ALPHA})`;
}

const GROUP_PENDING = wet(GROUP_INK);
const GROUP_CERTIFIED = dry(GROUP_INK);

// --- shade: which app, which asset ---------------------------------------
//
// An app call and an asset transfer both carry an identity worth seeing, and
// without it a busy hour is a wall of one purple with no way to tell one bot
// hammering one contract from a dozen protocols working at once.
//
// Identity is assigned, not hashed. Hashing an id to a shade sounds better —
// same app, same shade forever — but it cannot promise that the apps on screen
// TOGETHER differ from each other, and two of them colliding is a worse lie
// than no shading at all. It also promises a stability nobody can spend:
// Territory has no legend and no labels, so a fixed shade is unreadable as
// identity. What is readable without being taught anything is "these two are
// the same and that one is not" — which is separation, not identity.
//
// So: a small palette of well-spaced shades, handed out least-recently-used.
// An app that keeps arriving keeps its shade; one that goes quiet loses it to
// a newcomer. Where few apps are live nearly every one holds its own shade;
// where dozens are, shades get reused — but that is exactly the case where
// they were never going to be tellable apart anyway. It fails where failure
// is free, and it spends nothing permanent on the contracts that deploy daily
// and are never seen again.
//
// A palette must be a grid, not an arc: three hues at 16° apart is legible,
// eight at 5° is not, and widening the arc instead would run appl into pay.
// Lightness supplies the second dimension.
function palette(hues, sat, lights) {
  // Interleaved, so consecutively handed-out shades are far apart.
  return [[0, 0], [2, 1], [1, 0], [0, 1], [2, 0], [1, 1]].map(([h, l]) => [hues[h], sat, lights[l]]);
}

const SHADES = {
  appl: palette([256, 272, 288], 46, [43, 57]),
  // Skewed cool on purpose: an axfer drifting warm would close on afrz orange.
  axfer: palette([344, 354, 4], 62, [44, 57]),
};

// Least-recently-arrived loses its slot. Bounded by the palette itself — the
// map never holds more entries than there are shades.
function makeAllocator(slots) {
  const owner = new Array(slots.length).fill(null);
  const held = new Map(); // id -> { slot, seen }
  let tick = 0;

  return (id) => {
    const have = held.get(id);
    if (have) {
      have.seen = ++tick;
      return slots[have.slot];
    }
    let pick = owner.indexOf(null);
    if (pick < 0) {
      let oldest = Infinity;
      for (let i = 0; i < owner.length; i++) {
        const seen = held.get(owner[i])?.seen ?? -1;
        if (seen < oldest) {
          oldest = seen;
          pick = i;
        }
      }
      held.delete(owner[pick]);
    }
    owner[pick] = id;
    held.set(id, { slot: pick, seen: ++tick });
    return slots[pick];
  };
}

const allocate = {
  appl: makeAllocator(SHADES.appl),
  axfer: makeAllocator(SHADES.axfer),
};

// The identity a shade is granted for: the application being called, or the
// asset being moved. An appl with no apid is creating its app rather than
// calling one, so there is no venue yet — it keeps the base ink.
function inkFor(type, txn) {
  if (type === 'appl') {
    const apid = typeof txn?.apid === 'number' ? txn.apid : 0;
    return apid > 0 ? allocate.appl(apid) : INK.appl;
  }
  if (type === 'axfer') {
    const xaid = typeof txn?.xaid === 'number' ? txn.xaid : 0;
    return xaid > 0 ? allocate.axfer(xaid) : INK.axfer;
  }
  return INK[type] ?? INK.pay;
}

const LEAF_CAP = 240;        // standing cells before the oldest are pushed out
const RIGID_PX = 42;         // fixed extent of a valueless claim, along the grain
// Weight is sqrt(algo), scaled. Only the ratios between weights decide the
// layout — but the absolute size matters for one reason. Where the flex-grow
// values inside a container add up to less than 1, CSS hands out only that
// fraction of the free space and the rest of the box stays bare. Cells are
// forever animating up from zero and down to it, so a cut can briefly hold
// nothing but near-zero values. Keeping the smallest claim at 100 means that
// window closes a hundred times faster, and the map is never seen unfilled.
const SCALE = 300;
const MIN_WEIGHT = 100;      // dust — anything under about a tenth of an algo
const MAX_WEIGHT = 10800;    // sqrt(1296 algo): a whale reads as huge, not total
const RIGID_WEIGHT = SCALE;  // a valueless claim reserves about one algo's worth
const DURATION = 700;        // keep in step with the transition in legacy.css
const QUEUE_CAP = 400;
// Because every cell's area is its weight over the whole map's weight at any
// depth, tree shape decides only who neighbours whom — never how big anything
// is. So an arrival can join the cut it landed in as a sibling instead of
// nesting a fresh level, which is what stops a heavy cell from being split
// over and over into one long chain. Beyond this many neighbours a cut would
// read as stripes, so we nest instead.
const FLATTEN_MAX = 6;

let mount = null;
let root = null;             // { el, children, weight, ... } — the whole map
let order = [];              // live leaves, oldest first: the eviction queue
let liveLeaves = 0;
let queue = [];              // arrivals awaiting the next frame
let frame = null;
let visible = false;

// --- weight ---------------------------------------------------------------

function microAmount(txn) {
  const amt = typeof txn?.amt === 'number' ? txn.amt : 0;
  const aamt = typeof txn?.aamt === 'number' ? txn.aamt : 0;
  return amt || aamt;
}

// A transaction's claim. Value-bearing transactions are elastic on sqrt of
// their amount; app calls on sqrt of their fee in minimum-fee units, which
// counts inner transactions and pooled opcode budget. Everything else — and
// any transfer of zero — carries no magnitude, so it takes a rigid slab.
function specFor(type, txData) {
  const txn = txData?.txn ?? txData;
  const ink = inkFor(type, txn);

  if (type === 'appl') {
    const fee = typeof txn?.fee === 'number' && txn.fee > 0 ? txn.fee : 1000;
    return { kind: 'leaf', type, ink, rigid: false, weight: clampWeight(Math.sqrt(fee / 1000) * SCALE) };
  }
  if (type === 'pay' || type === 'axfer') {
    const micro = microAmount(txn);
    if (micro > 0) {
      return { kind: 'leaf', type, ink, rigid: false, weight: clampWeight(Math.sqrt(micro / 1e6) * SCALE) };
    }
  }
  return { kind: 'leaf', type, ink, rigid: true, weight: RIGID_WEIGHT };
}

function clampWeight(w) {
  if (!Number.isFinite(w)) return MIN_WEIGHT;
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, w));
}

// --- intake ---------------------------------------------------------------

export function territoryAddTx(type, txData) {
  if (type === 'group') {
    const members = Array.isArray(txData?.members) ? txData.members : [];
    const specs = members
      .map((m) => (typeof m?.txn?.type === 'string' && m.txn.type in INK ? specFor(m.txn.type, m) : null))
      .filter(Boolean);
    if (!specs.length) return;
    queue.push({ kind: 'group', members: specs });
  } else if (type in INK) {
    queue.push(specFor(type, txData));
  } else {
    return;
  }
  if (queue.length > QUEUE_CAP) queue.splice(0, queue.length - QUEUE_CAP);
  schedule();
}

// A round certifies: the ground standing right now stops being a proposal and
// the ink dries into the sheet. Nothing moves, nothing is cleared.
export function territoryAddBlock(_round) {
  for (const leaf of order) {
    if (leaf.certified || leaf.removing) continue;
    leaf.certified = true;
    // Dries into its OWN shade, not its type's — the app a call belonged to
    // must survive certification, or history would relabel itself.
    leaf.el.style.background = dry(leaf.ink);
    const box = leaf.parent;
    if (box && box.group && !box.certified) {
      box.certified = true;
      box.el.style.background = GROUP_CERTIFIED;
      box.el.style.setProperty('--terr-bind', GROUP_CERTIFIED);
    }
  }
}

function schedule() {
  if (frame === null && visible && mount) frame = requestAnimationFrame(flush);
}

// --- tree -----------------------------------------------------------------

function makeEl(cls) {
  const el = document.createElement('div');
  el.className = cls;
  return el;
}

function buildLeaf(spec, inGroup) {
  const leaf = {
    el: makeEl(spec.rigid ? 'terr-cell terr-rigid' : 'terr-cell'),
    parent: null,
    children: null,
    weight: spec.weight,
    rigid: spec.rigid,
    type: spec.type,
    // The shade this cell was painted with, kept for its whole life. A cell
    // never repaints when the allocator hands its app's slot to someone else.
    ink: spec.ink ?? INK[spec.type] ?? INK.pay,
    inGroup: !!inGroup,
    certified: false,
    removing: false,
  };
  leaf.el.style.background = wet(leaf.ink);
  // Baseline zero. A fresh element's first computed style is the transition's
  // starting point, so this is what the cell will grow out of.
  if (spec.rigid) leaf.el.style.flexBasis = '0px';
  else leaf.el.style.flexGrow = '0';
  order.push(leaf);
  liveLeaves++;
  return leaf;
}

// A group is built whole, with its members already at their final relative
// weights, so the enclosure expands as one piece with fixed interior grain.
function buildGroup(spec) {
  const box = {
    el: makeEl('terr-box terr-group'),
    parent: null,
    children: [],
    weight: 0,
    axis: 'row',
    group: true,
    rigid: false,
    certified: false,
    removing: false,
  };
  box.el.style.background = GROUP_PENDING;
  box.el.style.setProperty('--terr-bind', GROUP_PENDING);
  box.el.style.flexGrow = '0';
  for (const ms of spec.members) {
    const leaf = buildLeaf(ms, true);
    leaf.parent = box;
    box.children.push(leaf);
    box.el.appendChild(leaf.el);
    box.weight += leaf.weight;
    if (leaf.rigid) leaf.el.style.flexBasis = RIGID_PX + 'px';
    else leaf.el.style.flexGrow = String(leaf.weight);
  }
  return box;
}

// Weights are summed and unsummed all the way to the root thousands of times
// a minute, so they accumulate floating-point dust and a total that ought to
// be exactly zero lands a hair below it. That matters: flex-grow rejects a
// negative number outright, the browser keeps whatever the box last had, and
// a dead cut goes on holding its full share of the screen with nothing alive
// inside it. Snap the dust away as it appears.
function addWeightUp(node, delta) {
  for (let n = node; n; n = n.parent) {
    n.weight += delta;
    if (n.weight < 1e-6) n.weight = 0;
  }
}

// Replace a leaf with a container holding [leaf, arrival]. The container is
// born at exactly the weight the leaf held, so the region does not jump; it
// then grows to hold both, and the browser squeezes the old occupant.
function splitLeaf(target, incoming, axis) {
  const parent = target.parent;
  const box = {
    el: makeEl('terr-box'),
    parent,
    children: [target, incoming],
    weight: target.weight + incoming.weight,
    axis,
    group: false,
    rigid: false,
    certified: false,
    removing: false,
  };
  box.el.style.flexDirection = axis;
  box.el.style.flexGrow = String(target.weight);

  const i = parent.children.indexOf(target);
  parent.children[i] = box;
  parent.el.replaceChild(box.el, target.el);
  target.parent = box;
  incoming.parent = box;
  box.el.appendChild(target.el);
  box.el.appendChild(incoming.el);

  addWeightUp(parent, incoming.weight);
  return box;
}

// Join an existing cut rather than nesting a new one: the arrival lands
// alongside the cell it targeted and every neighbour in that cut gives way.
function insertSibling(box, target, incoming) {
  const i = box.children.indexOf(target);
  box.children.splice(i + 1, 0, incoming);
  incoming.parent = box;
  box.el.insertBefore(incoming.el, target.el.nextSibling);
  addWeightUp(box, incoming.weight);
}

function appendToRoot(node) {
  node.parent = root;
  root.children.push(node);
  root.el.appendChild(node.el);
  addWeightUp(root, node.weight);
}

function rootAxis() {
  return mount && mount.clientWidth >= mount.clientHeight ? 'row' : 'column';
}

// --- placement ------------------------------------------------------------

// Cutting a cell of w by h so the arrival takes fraction f of it: which way
// leaves the squarer pair, and how bad is the worse of the two?
function squarest(w, h, f) {
  const ar = (a, b) => (a > b ? a / b : b / a);
  const row = Math.max(ar(w * (1 - f), h), ar(w * f, h));
  const col = Math.max(ar(w, h * (1 - f)), ar(w, h * f));
  return row <= col ? { axis: 'row', worst: row } : { axis: 'column', worst: col };
}

// An arrival takes the cell where it leaves the squarest ground, ties going
// to the cell with most room. Aiming purely at the largest cell looks right
// but shreds the map: a dust payment landing in a whale can only ever cut a
// splinter off it, whichever way the knife falls. Choosing on squareness
// instead sends a claim to ground its own size — so like sizes gather, and
// arrivals still surface all over the map rather than at one edge.
function place(node, cands) {
  let bi = -1;
  let bestWorst = Infinity;
  let bestArea = -1;
  let axisFor = 'row';
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const f = node.weight / (c.node.weight + node.weight);
    const s = squarest(c.w, c.h, f);
    const area = c.w * c.h;
    if (s.worst < bestWorst - 0.05 || (s.worst < bestWorst + 0.05 && area > bestArea)) {
      bestWorst = Math.min(bestWorst, s.worst);
      bestArea = area;
      bi = i;
      axisFor = s.axis;
    }
  }

  if (bi < 0) {
    // Nothing splittable yet: an empty map, or one made entirely of rigid
    // slabs and sealed groups.
    appendToRoot(node);
    if (node.group) node.el.style.flexDirection = rootAxis() === 'row' ? 'column' : 'row';
    return;
  }

  const c = cands[bi];
  const target = c.node;
  const axis = axisFor;
  const box = target.parent;

  // Join the cut if it already runs the right way and is not yet crowded;
  // otherwise make a new one. Either way the arrival ends up the same size.
  let frac;
  if (box.axis === axis && !box.group && box.children.length < FLATTEN_MAX) {
    insertSibling(box, target, node);
    frac = (box.weight - node.weight) / box.weight;
  } else {
    splitLeaf(target, node, axis);
    frac = target.weight / (target.weight + node.weight);
  }

  // A group sits across the grain of the cut it landed in, so it reads as
  // its own weave rather than more of the same.
  if (node.group) node.el.style.flexDirection = axis === 'row' ? 'column' : 'row';

  // Fold the result back into the estimates so the next arrival in this same
  // frame looks somewhere else instead of piling into the same cell.
  if (axis === 'row') {
    const w = c.w;
    c.w = w * frac;
    if (!node.children && !node.rigid) cands.push({ node, w: w * (1 - frac), h: c.h });
  } else {
    const h = c.h;
    c.h = h * frac;
    if (!node.children && !node.rigid) cands.push({ node, w: c.w, h: h * (1 - frac) });
  }
}

// --- loss -----------------------------------------------------------------

function removeLeaf(leaf) {
  if (leaf.removing) return;
  leaf.removing = true;
  leaf.el.classList.add('terr-leaving');
  liveLeaves--;
  addWeightUp(leaf.parent, -leaf.weight);
  leaf.weight = 0;
  // Detach on a timer rather than transitionend: a cell that was already at
  // zero width fires no transition and would otherwise never be collected.
  setTimeout(() => detach(leaf), DURATION + 80);
}

function detach(node) {
  const parent = node.parent;
  if (!parent) return;
  if (node.el.parentNode) node.el.parentNode.removeChild(node.el);
  const i = parent.children.indexOf(node);
  if (i >= 0) parent.children.splice(i, 1);
  node.parent = null;
  prune(parent);
}

// An emptied container goes. A container down to a single occupant hands its
// space over and disappears — two cells visibly becoming one. The hoist is
// geometrically exact, since a lone child already fills its parent entirely.
function prune(box) {
  if (!box || !box.parent) return;
  if (box.children.length === 0) {
    detach(box);
    return;
  }
  if (box.children.length === 1 && !box.group) {
    const child = box.children[0];
    const parent = box.parent;
    const i = parent.children.indexOf(box);
    if (i < 0) return;
    parent.children[i] = child;
    child.parent = parent;
    parent.el.replaceChild(child.el, box.el);
    writeFlex(child);
    prune(parent);
  }
}

function evict() {
  while (liveLeaves > LEAF_CAP && order.length) {
    const leaf = order.shift();
    if (leaf && !leaf.removing && leaf.parent) removeLeaf(leaf);
  }
}

// --- frame ----------------------------------------------------------------

function writeFlex(node) {
  if (node.rigid) node.el.style.flexBasis = node.weight > 0 ? RIGID_PX + 'px' : '0px';
  else node.el.style.flexGrow = node.weight > 0 ? String(node.weight) : '0';
}

// Writing a value that has not changed is inert — a running transition is
// undisturbed — so the simplest correct thing is to restate the whole map.
function writeTree(node) {
  if (node !== root) writeFlex(node);
  if (!node.children) return;

  // A cut holding nothing but rigid slabs has nothing in it that grows, and
  // would leave bare ground showing through. The map is always full, so in
  // that case — and only that case — the slabs share the space between them.
  let elastic = false;
  for (const c of node.children) {
    if (!c.rigid && c.weight > 1e-9) {
      elastic = true;
      break;
    }
  }
  for (const c of node.children) {
    if (c.rigid) c.el.style.flexGrow = !elastic && c.weight > 1e-9 ? '1' : '0';
    writeTree(c);
  }
}

function flush() {
  frame = null;
  if (!visible || !mount || !queue.length) return;
  const batch = queue;
  queue = [];

  // Read: every cell an arrival is allowed to split. Rigid slabs are atomic,
  // and a group's members are sealed inside it.
  const cands = [];
  for (const leaf of order) {
    if (leaf.removing || !leaf.parent || leaf.rigid || leaf.inGroup) continue;
    const r = leaf.el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) cands.push({ node: leaf, w: r.width, h: r.height });
  }

  // Write: grow the tree, then give up the oldest ground if the map is full.
  for (const spec of batch) {
    place(spec.kind === 'group' ? buildGroup(spec) : buildLeaf(spec, false), cands);
  }
  evict();

  // One forced reflow commits every baseline written above — without it the
  // browser folds birth and target into a single recalc and nothing animates.
  void mount.offsetWidth;

  // Write: the targets. Every transition on screen starts here, together.
  writeTree(root);
}

// --- lifecycle ------------------------------------------------------------

export function initTerritoryViz(mountEl) {
  if (!mountEl || mount) return;
  mount = mountEl;
  root = {
    el: mount,
    parent: null,
    children: [],
    weight: 0,
    axis: rootAxis(),
    group: false,
    rigid: false,
    certified: false,
    removing: false,
  };
  mount.style.flexDirection = root.axis;

  // Hidden means display:none here, which reads as not intersecting. Arrivals
  // keep queueing while closed (capped), so opening lands on live ground.
  const observer = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? false;
    if (visible) {
      root.axis = rootAxis();
      mount.style.flexDirection = root.axis;
      schedule();
    }
  });
  observer.observe(mount);

  window.addEventListener('resize', () => {
    if (!visible || !mount) return;
    root.axis = rootAxis();
    mount.style.flexDirection = root.axis;
  });
}
