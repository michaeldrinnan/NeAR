/**
 * Pointer-based drag and drop for sample tiles (mouse, pen and touch),
 * following the original WinForms rules:
 *  - entering another tile moves the dragged tile to that tile's position
 *    (Control.SetChildIndex semantics, so the tiles visibly make room);
 *  - entering the empty part of a box moves the tile to the end of that box;
 *  - reference tiles (.ref) never move.
 *
 * Rearrangements are animated (FLIP: tiles slide from where they were to
 * where they now belong) when the 'Animate' rating option is ticked.
 */

const SLIDE_MS = 200;
const SETTLE_MS = 150;
const EDGE_PX = 70; // dragging this close to the top or bottom of the window scrolls the page
const MAX_SCROLL_PX = 20; // per frame, at the very edge
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** A tile's resting place, ignoring any slide animation in progress. */
function layoutRect(el: HTMLElement): DOMRect {
  const r = el.getBoundingClientRect();
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return r;
  const m = new DOMMatrixReadOnly(t);
  return new DOMRect(r.x - m.m41, r.y - m.m42, r.width, r.height);
}

const inside = (r: DOMRect, x: number, y: number) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;

export function enableDrag(boxes: readonly HTMLElement[], onChange: () => void, animate = true): () => void {
  let dragged: HTMLElement | null = null;
  let avatar: HTMLElement | null = null;
  let settling: Animation | null = null;
  let startX = 0;
  let startY = 0;
  let grabX = 0;
  let grabY = 0;
  let started = false;
  let lastHover: Element | null = null;
  let pointerX = 0;
  let pointerY = 0;
  let scrollFrame = 0;

  const tiles = () => boxes.flatMap((b) => [...b.querySelectorAll<HTMLElement>(':scope > .tile')]);

  /** Runs a DOM rearrangement and slides every tile from its old place to its new one. */
  function flip(mutate: () => void) {
    if (!animate) return mutate();
    const all = tiles();
    const before = new Map(all.map((t) => [t, t.getBoundingClientRect()])); // where they are seen now
    mutate();
    for (const t of all) {
      t.getAnimations().forEach((a) => a.cancel());
      const from = before.get(t)!;
      const to = t.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      t.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: SLIDE_MS, easing: EASE });
    }
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0 || dragged) return;
    const target = e.target as Element;
    const tile = target.closest<HTMLElement>('.tile');
    if (!tile || tile.classList.contains('ref') || target.closest('.play')) return;
    settling?.finish();
    dragged = tile;
    started = false;
    startX = e.clientX;
    startY = e.clientY;
    const r = tile.getBoundingClientRect();
    grabX = e.clientX - r.left;
    grabY = e.clientY - r.top;
    // Listen on the document: moving the tile between boxes would drop any pointer capture.
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function begin() {
    started = true;
    lastHover = dragged;
    dragged!.classList.add('moving');
    avatar = dragged!.cloneNode(true) as HTMLElement;
    avatar.classList.add('drag-avatar');
    avatar.removeAttribute('data-id');
    avatar.setAttribute('aria-hidden', 'true');
    document.body.append(avatar);
  }

  /** What the pointer is over, judged by resting positions so sliding tiles can't cause flicker. */
  function hoverAt(x: number, y: number): { tile: HTMLElement | null; box: HTMLElement | null } {
    const box = boxes.find((b) => inside(b.getBoundingClientRect(), x, y)) ?? null;
    const tile = box ? tiles().find((t) => t.parentElement === box && inside(layoutRect(t), x, y)) ?? null : null;
    return { tile, box };
  }

  function onMove(e: PointerEvent) {
    if (!dragged) return;
    if (!started) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
      begin();
    }
    pointerX = e.clientX;
    pointerY = e.clientY;
    avatar!.style.transform = `translate(${pointerX - grabX}px, ${pointerY - grabY}px)`;
    hoverOver(pointerX, pointerY);
    if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
  }

  /**
   * Scrolls the page while the pointer is held near the top or bottom edge, so a
   * tile can be carried to a box that is off screen (essential with touch, where
   * the finger that drags can't also scroll). The speed grows towards the edge.
   */
  function autoScroll() {
    scrollFrame = 0;
    if (!dragged || !started) return;
    const h = window.innerHeight;
    let speed = 0;
    if (pointerY < EDGE_PX) speed = -MAX_SCROLL_PX * (1 - Math.max(pointerY, 0) / EDGE_PX);
    else if (pointerY > h - EDGE_PX) speed = MAX_SCROLL_PX * (1 - Math.max(h - pointerY, 0) / EDGE_PX);
    if (!speed) return;
    const before = window.scrollY;
    window.scrollBy(0, speed);
    // The page moved under a stationary pointer, so what it is over may have changed.
    if (window.scrollY !== before) hoverOver(pointerX, pointerY);
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function hoverOver(x: number, y: number) {
    if (!dragged) return;
    const { tile, box } = hoverAt(x, y);
    const hover = tile ?? box;
    if (hover === lastHover) return; // act on "enter" only, like DragEnter
    lastHover = hover;
    if (!hover || hover === dragged || !box) return;

    const d = dragged;
    if (tile) {
      flip(() => {
        if (tile.parentElement !== d.parentElement) tile.before(d);
        else if (tile.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_PRECEDING) tile.after(d);
        else tile.before(d);
      });
    } else if (d.parentElement !== box) {
      flip(() => box.append(d));
    } else {
      return;
    }
    onChange();
  }

  function onUp() {
    if (!dragged) return;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    const d = dragged;
    const a = avatar;
    dragged = null;
    avatar = null;
    lastHover = null;
    if (!started) return;
    onChange();

    // Let the floating copy settle into the tile's slot before revealing the tile.
    if (!a || !animate) {
      a?.remove();
      d.classList.remove('moving');
      return;
    }
    const to = layoutRect(d);
    d.style.visibility = 'hidden';
    settling = a.animate([{ transform: a.style.transform }, { transform: `translate(${to.left}px, ${to.top}px)` }], {
      duration: SETTLE_MS,
      easing: EASE,
    });
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      a.remove();
      d.style.visibility = '';
      d.classList.remove('moving');
      settling = null;
    };
    settling.onfinish = done;
    settling.oncancel = done;
    // Animations pause while the page isn't being drawn (e.g. a hidden tab); never leave the tile hidden.
    setTimeout(done, SETTLE_MS + 150);
  }

  boxes.forEach((b) => b.addEventListener('pointerdown', onDown));
  return () => {
    settling?.finish();
    boxes.forEach((b) => b.removeEventListener('pointerdown', onDown));
  };
}
