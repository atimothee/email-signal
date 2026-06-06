export function applyHighlight(selector: string): void {
  try {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return;
    el.classList.add('es-highlight');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    /* ignore selector errors */
  }
}

export function removeHighlight(selector: string): void {
  try {
    const el = document.querySelector(selector);
    el?.classList.remove('es-highlight');
  } catch {
    /* ignore */
  }
}
