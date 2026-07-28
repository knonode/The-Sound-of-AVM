/*
 * card-reorder.js — dragging synth cards into a new order.
 *
 * The grab strip has been sitting between the header and the parameter area
 * doing nothing but looking grabbable. This is the gesture it was promising.
 *
 * A layout is read top-to-bottom and left-to-right, so the order of the cards
 * is the order of the piece: which voice you reach for first, which three
 * belong together. Until now that order was the order you happened to add them
 * in, and the only way to change it was to delete a card and build it again.
 *
 * The card is moved in the DOM as you drag rather than floating under the
 * cursor with a placeholder holding its slot. That is a real choice and not a
 * shortcut: .synth-grid is `repeat(auto-fit, minmax(150px, 1fr))`, so a card
 * lifted out of flow changes the column count for everything else, and the
 * layout you would be dragging over is not the layout you would be dropping
 * into. Moving the real node means the grid you see is always the grid you get.
 *
 * Two things keep that from thrashing. A drag does not begin until the pointer
 * has travelled a few pixels, so a stray click on the strip does nothing; and a
 * card only gives up its place once the pointer has properly arrived in it —
 * past the middle for a neighbour across the row, a good bite in from the edge
 * for one in the row above or below. Without that a card swaps the instant the
 * pointer touches its edge, which puts the pointer back over the card that just
 * moved, and the two trade places every frame for as long as you hold still.
 * Why the two axes differ is set out where the rule is applied.
 *
 * Pointer events rather than HTML5 drag-and-drop: the same code then covers
 * touch, and nothing has to be marked `draggable`, which on a card full of
 * sliders would mean turning the attribute on and off around every mousedown
 * to stop a slider drag from becoming a card drag.
 *
 * The drag is followed on the window rather than by capturing the pointer to
 * the strip, and that is the one thing here that is not a preference. Moving a
 * node is a removal followed by an insertion, and a capture target that leaves
 * the document loses the capture — so capturing works right up until the first
 * card is displaced, then silently stops delivering, which looks exactly like a
 * drag that moves one slot and never lets go. Window listeners have no such
 * hole, and they also catch a pointer released outside the grid.
 *
 *
 * WITHOUT A POINTER
 *
 * A drag is a gesture that only exists if you can see where you are pointing,
 * so the same job has to be doable from the keyboard, and the hard part is not
 * the moving. It is that reordering by keyboard is worthless if you cannot tell
 * where the thing ended up: a card that has been moved is silent, the grid it
 * moved inside is silent, and counting slots in your head from the order they
 * were created in is not using software, it is bookkeeping.
 *
 * So every move says what happened, out loud, into a live region: what moved,
 * the position it now holds, how many there are, and — the part that actually
 * orients you — which synth it is now behind and which it is now in front of.
 * Neighbours are what a layout is made of. "Third of seven" is a fact you have
 * to hold; "after the pay drone, before the block bell" is a place. Enter or
 * Space on the handle repeats it without moving anything, so the answer to
 * "where am I" is always one key away rather than something you had to retain
 * from the last time it was said.
 *
 * Plain arrows, not Ctrl-arrows. Ctrl with Left or Right is how macOS switches
 * desktops; the browser is never told it happened, so on one of the three
 * platforms the feature would simply not exist. The handle is a control that
 * does nothing else, so unmodified arrows are unambiguous on it, and Left and
 * Up both mean "earlier" because the grid is a wrapping row on screen and a
 * plain list to a screen reader, and both readings should work.
 *
 * There is no pick-up-and-drop mode — no lifting a card, moving it, and
 * dropping it. It would mirror the mouse more closely and it is what the ARIA
 * pattern usually shows, but it puts you in a state you can be stranded in, it
 * needs a cancel key, and Space in this app is already play/stop everywhere.
 * Moving immediately and saying so cannot strand anybody.
 *
 *
 * The module owns the gesture and nothing else. It does not know what a synth
 * is; it reports the new order of ids, asks the caller what to call a card, and
 * lets the caller move whatever state hangs off them.
 */

const DRAG_THRESHOLD = 4;   // px of travel before a press becomes a drag
const SAME_ROW_SLOP = 4;    // px of top-edge difference still counting as one row
const CROSS_ROW_REACH = 64; // px into the row above or below before it gives way

const HELP_ID = 'card-reorder-help';
const HELP_TEXT =
  'Press the arrow keys to move this synth one place. ' +
  'Home moves it to the front, End to the back. ' +
  'Press Enter to hear where it is now.';

// Off screen for the eye, present for a screen reader. Inline rather than a
// class because the module creates these itself: a stylesheet rule they depend
// on is a rule somebody can delete without ever seeing what broke.
const OFFSCREEN = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;' +
  'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0';

function onceInBody(id, build) {
  let el = document.getElementById(id);
  if (!el) {
    el = build();
    el.id = id;
    el.style.cssText = OFFSCREEN;
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Wire drag-to-reorder onto a container of cards.
 *
 *   handle     what you have to press to start a drag
 *   item       the thing that moves
 *   immovable  items that can neither be dragged nor displaced — the master
 *              card, which is the output stage and belongs at the front
 *   onReorder  called once, on drop, with the ids in their new order — and
 *              only when the order actually changed
 *   describe   what to call a card out loud, given its id. The default reads
 *              the id itself, which is honest and useless; a caller that knows
 *              what its cards are should say so.
 */
export function initCardReorder(container, {
  onReorder,
  describe = (id) => id,
  handle = '.grab-strip',
  item = '.mini-synth',
  immovable = '.master-synth',
  idAttr = 'data-instance-id',
} = {}) {
  if (!container) return;

  let card = null;          // the card being dragged
  let startX = 0;
  let startY = 0;
  let dragging = false;     // past the threshold: the card is actually moving
  let orderAtStart = null;

  const ids = () => [...container.querySelectorAll(item)].map((el) => el.getAttribute(idAttr));

  // The cards that can actually move — master is not one of them, so it is not
  // counted either: "position 1 of 6" has to mean the first thing you can move,
  // or the numbers are describing a list the listener cannot act on.
  const movable = () => [...container.querySelectorAll(item)].filter((el) => !el.matches(immovable));

  const help = onceInBody(HELP_ID, () => {
    const el = document.createElement('div');
    el.textContent = HELP_TEXT;
    return el;
  });

  // assertive, because every announcement here is the direct answer to a key
  // the user just pressed; a polite one can be held back until after the next
  // move, which is the one case where the answer is no longer true.
  const live = onceInBody('card-reorder-live', () => {
    const el = document.createElement('div');
    el.setAttribute('aria-live', 'assertive');
    el.setAttribute('aria-atomic', 'true');
    return el;
  });

  function say(message) {
    // Same text twice running is not re-announced by some screen readers, so
    // clear first: pressing End twice should still confirm where you are.
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = message; });
  }

  // Where a card stands, said as a place rather than as an index.
  function placeOf(el) {
    const list = movable();
    const at = list.indexOf(el);
    if (at < 0) return '';
    const name = describe(el.getAttribute(idAttr));
    const before = list[at - 1] && describe(list[at - 1].getAttribute(idAttr));
    const after = list[at + 1] && describe(list[at + 1].getAttribute(idAttr));
    let where = `position ${at + 1} of ${list.length}`;
    if (before && after) where += `, after ${before}, before ${after}`;
    else if (before) where += `, after ${before}, last`;
    else if (after) where += `, first, before ${after}`;
    return `${name}, ${where}`;
  }

  // The handle carries the card's name and its place, so tabbing onto it says
  // where you are before you have moved anything. Rewritten after every change,
  // by either input, because a stale position is worse than none.
  function relabel() {
    const list = movable();
    list.forEach((el, i) => {
      const grip = el.querySelector(handle);
      if (!grip) return;
      grip.setAttribute('role', 'button');
      grip.setAttribute('tabindex', '0');
      grip.setAttribute('aria-roledescription', 'reorder handle');
      grip.setAttribute('aria-describedby', HELP_ID);
      grip.setAttribute('aria-label', `Move ${describe(el.getAttribute(idAttr))}, position ${i + 1} of ${list.length}`);
    });
  }

  function onPointerDown(event) {
    // Left button only, and only on a strip belonging to a movable card.
    if (event.button !== 0 || card) return;
    const grabbed = event.target.closest(handle);
    if (!grabbed || !container.contains(grabbed)) return;
    const target = grabbed.closest(item);
    if (!target || target.matches(immovable)) return;

    card = target;
    startX = event.clientX;
    startY = event.clientY;
    dragging = false;
    orderAtStart = ids();

    // Stops the press from starting a text selection that then drags along
    // with the card.
    event.preventDefault();

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }

  function onPointerMove(event) {
    if (!card) return;

    if (!dragging) {
      if (Math.abs(event.clientX - startX) < DRAG_THRESHOLD &&
          Math.abs(event.clientY - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      card.classList.add('card-dragging');
      container.classList.add('cards-reordering');
    }

    // What is under the pointer right now. The dragged card is skipped, and so
    // is anything immovable, so a card can never be dropped in front of master.
    const under = document.elementFromPoint(event.clientX, event.clientY)?.closest(item);
    if (!under || under === card || !container.contains(under) || under.matches(immovable)) return;

    const rect = under.getBoundingClientRect();
    const mine = card.getBoundingClientRect();
    const sameRow = Math.abs(rect.top - mine.top) < SAME_ROW_SLOP;

    // Which way this move is going, in document order rather than on screen —
    // the grid wraps, so the card to the right of the last one in a row is the
    // first one in the next row down, and only document order knows that.
    const forward = !!(card.compareDocumentPosition(under) & Node.DOCUMENT_POSITION_FOLLOWING);

    // How far into the target the pointer has to travel before that card gives
    // way. Across a row it is the middle, which is the rule that keeps a card
    // from swapping the moment the pointer brushes an edge.
    //
    // Between rows it cannot be the middle. A synth card is a full stack of
    // controls — routinely a good deal taller than the window it is being
    // dragged in — so the vertical middle of the row below is often somewhere
    // off the bottom of the screen, and "past halfway" is an instruction the
    // pointer is unable to carry out. Dragging up worked and dragging down did
    // not, which is exactly that asymmetry: the row above has its middle on
    // screen and the row below does not.
    //
    // So between rows the pointer only has to enter the target properly, from
    // whichever edge it is arriving at — and even that is measured against the
    // part of the target actually on screen. A row can be showing thirty pixels
    // of itself at the bottom of the window, and a threshold deeper than that
    // is the same unreachable instruction in a smaller size. Whatever is
    // visible, you have to cross half of it.
    let mark;
    let along;
    if (sameRow) {
      mark = rect.left + rect.width / 2;
      along = event.clientX;
    } else {
      const onScreen = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      const reach = Math.min(rect.height / 2, CROSS_ROW_REACH, onScreen / 2);
      mark = forward ? rect.top + reach : rect.bottom - reach;
      along = event.clientY;
    }

    if (forward ? along > mark : along < mark) {
      if (forward) under.after(card);
      else under.before(card);
    }
  }

  function endDrag() {
    if (!card) return;
    const dropped = card;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    card.classList.remove('card-dragging');
    container.classList.remove('cards-reordering');

    const moved = dragging;
    const before = orderAtStart;
    card = null;
    dragging = false;
    orderAtStart = null;

    if (!moved) return;
    const after = ids();
    if (after.length === before.length && after.every((id, i) => id === before[i])) return;
    commit(after, dropped);
  }

  // One way out for both inputs: tell the caller, refresh the labels the new
  // order has invalidated, and say where the card ended up. A drop is announced
  // as well as a keystroke — a screen reader user with a mouse is a person, and
  // so is anyone who has just let go of a card and lost track of it.
  function commit(order, moved) {
    onReorder?.(order);
    relabel();
    if (moved) say(placeOf(moved));
  }

  // --- keyboard ------------------------------------------------------------

  // One place earlier or later — done by moving the NEIGHBOUR past the card
  // rather than the card past the neighbour. The two produce the same order,
  // and only one of them survives being driven from the keyboard: a node that
  // holds the focus is blurred the moment it is taken out of the document, and
  // reinserting it does not give the focus back. Moving the card would fire
  // once, drop focus to the body, and swallow every arrow key after that —
  // which is precisely how it behaved before this was written this way.
  // Neighbours are not focused, so they can be moved freely.
  function shift(el, delta) {
    const list = movable();
    const at = list.indexOf(el);
    const other = list[at + delta];
    if (at < 0 || !other) return false;
    if (delta < 0) el.after(other);
    else el.before(other);
    return true;
  }

  function step(el, delta) {
    if (!shift(el, delta)) {
      // Refusing to move is information too, and silence would read as a
      // dropped keypress rather than as an edge.
      say(`Already ${delta < 0 ? 'first' : 'last'}. ${placeOf(el)}`);
      return;
    }
    commit(ids(), el);
  }

  // Repeated single steps, for the same reason: every one of them moves some
  // other card, so the card you are holding never leaves the document and never
  // loses the focus. The list is a handful of cards, not a table of thousands.
  function toEnd(el, end) {
    let moved = false;
    while (shift(el, end)) moved = true;
    if (!moved) {
      say(`Already ${end < 0 ? 'first' : 'last'}. ${placeOf(el)}`);
      return;
    }
    commit(ids(), el);
  }

  function onKeyDown(event) {
    const grip = event.target.closest?.(handle);
    if (!grip || !container.contains(grip)) return;
    const el = grip.closest(item);
    if (!el || el.matches(immovable)) return;

    // Left and Up both mean earlier: on screen the grid is a wrapping row, to a
    // screen reader it is a plain list, and neither reading should be wrong.
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft': case 'ArrowUp': step(el, -1); break;
      case 'ArrowRight': case 'ArrowDown': step(el, 1); break;
      case 'Home': toEnd(el, -1); break;
      case 'End': toEnd(el, 1); break;
      case 'Enter': case ' ': case 'Spacebar': say(placeOf(el)); break;
      default: handled = false;
    }
    if (!handled) return;
    // Arrows would scroll the page and Space is play/stop everywhere else in
    // this app — the global handler deliberately does not exempt focused
    // controls — so the handle has to keep both to itself.
    event.preventDefault();
    event.stopPropagation();
  }

  // Cards are added one at a time and replaced wholesale when a preset loads,
  // and either way every label downstream of the change is now wrong. Watching
  // the container is the only way to know that covers both, and covers whatever
  // adds a card next without that code having to remember this exists.
  const watcher = new MutationObserver(() => relabel());
  watcher.observe(container, { childList: true });

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('keydown', onKeyDown);
  relabel();
}
