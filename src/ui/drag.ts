/**
 * Pointer-based drag and drop for sample tiles (mouse, pen and touch),
 * following the original WinForms rules:
 *  - entering another tile moves the dragged tile to that tile's position
 *    (Control.SetChildIndex semantics, so the tiles visibly make room);
 *  - entering the empty part of a box moves the tile to the end of that box;
 *  - reference tiles (.ref) never move.
 */
export function enableDrag(boxes: readonly HTMLElement[], onChange: () => void): () => void {
  let dragged: HTMLElement | null = null;
  let avatar: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let grabX = 0;
  let grabY = 0;
  let started = false;
  let lastHover: Element | null = null;

  function onDown(e: PointerEvent) {
    if (e.button !== 0 || dragged) return;
    const target = e.target as Element;
    const tile = target.closest<HTMLElement>('.tile');
    if (!tile || tile.classList.contains('ref') || target.closest('.play')) return;
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

  function onMove(e: PointerEvent) {
    if (!dragged) return;
    if (!started) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
      begin();
    }
    avatar!.style.transform = `translate(${e.clientX - grabX}px, ${e.clientY - grabY}px)`;

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const tile = under?.closest<HTMLElement>('.tile') ?? null;
    const box = under?.closest<HTMLElement>('.box') ?? null;
    const hover = tile ?? box;
    if (hover === lastHover) return; // act on "enter" only, like DragEnter
    lastHover = hover;
    if (!hover || hover === dragged || !boxes.includes(box!)) return;

    if (tile) {
      if (tile.parentElement !== dragged.parentElement) tile.before(dragged);
      else if (tile.compareDocumentPosition(dragged) & Node.DOCUMENT_POSITION_PRECEDING) tile.after(dragged);
      else tile.before(dragged);
    } else if (dragged.parentElement !== box) {
      box!.append(dragged);
    }
    onChange();
  }

  function onUp() {
    if (!dragged) return;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    dragged.classList.remove('moving');
    avatar?.remove();
    avatar = null;
    dragged = null;
    lastHover = null;
    if (started) onChange();
  }

  boxes.forEach((b) => b.addEventListener('pointerdown', onDown));
  return () => boxes.forEach((b) => b.removeEventListener('pointerdown', onDown));
}
