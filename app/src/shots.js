// Applies deterministic query-string scenes for the repository screenshots. The regular app
// never depends on these values; they only make ?shot=editor and ?shot=cover reproducible.
import { LAYOUT_NAMES } from './cover.js';
import { EXPORT_FORMATS } from './formats.js';

export function applyShot(shot, query, state) {
  if (!shot) return;
  if (shot === 'cover') document.body.classList.add('shot-cover');

  const layout = query.get('layout');
  const preset = query.get('preset');
  const ratio = query.get('ratio');
  if (LAYOUT_NAMES.includes(layout)) state.layout = layout;
  if (['vice', 'sunset', 'neon', 'noir'].includes(preset)) state.preset = preset;
  if (Object.hasOwn(EXPORT_FORMATS, ratio)) state.ratio = ratio;
  state.titleOne = (query.get('one') ?? state.titleOne).slice(0, 12);
  state.titleTwo = (query.get('two') ?? state.titleTwo).slice(0, 12);
  state.titleThree = (query.get('three') ?? state.titleThree).slice(0, 12);
  state.strapline = (query.get('strapline') ?? state.strapline).slice(0, 28);
  const panel = Number(query.get('panel') ?? 0);
  state.activeSlot = Number.isInteger(panel) ? panel : 0;

  for (const key of ['intensity', 'texture', 'grain', 'vignette', 'logoSize']) {
    if (!query.has(key)) continue;
    const value = Number(query.get(key));
    if (Number.isFinite(value)) state[key] = Math.max(key === 'logoSize' ? 72 : 0, Math.min(key === 'logoSize' ? 125 : 100, value));
  }

  const requestedPhoto = query.get('photo');
  if (requestedPhoto) {
    const requestedIndex = state.images.findIndex((record) => record.id === requestedPhoto);
    if (requestedIndex >= 0) state.slots[0].imageIndex = requestedIndex;
  }
}

export function signalShotReady() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.__shotReady = true;
  }));
}
