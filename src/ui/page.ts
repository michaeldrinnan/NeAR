/** Small DOM helpers shared by the pages. */

type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & Record<string, unknown>;

/** Creates an element with properties (or attributes, for names with a dash) and children. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k.includes('-')) node.setAttribute(k, String(v));
    else (node as unknown as Record<string, unknown>)[k] = v;
  }
  node.append(...children);
  return node;
}

/** A page: one column of sections. */
export function page(children: Node[]): HTMLElement {
  window.scrollTo(0, 0);
  return el('div', { className: 'page' }, children);
}

/** The big Back button at the top of every page but the rating screen. */
export function backNav(onBack: () => void): HTMLElement {
  const btn = el('button', { type: 'button', className: 'big back', textContent: '← Back' });
  btn.addEventListener('click', onBack);
  return el('nav', { className: 'nav' }, [btn]);
}
