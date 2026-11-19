import { drawCover, getPanels, getPhotoPlacement, hitTestPanel } from './cover.js';
import { applyShot, signalShotReady } from './shots.js';
import { getExportFormat } from './formats.js';
import { loadDisplayFonts } from './fonts.js';

const canvas = document.getElementById('cover');
const canvasFrame = document.getElementById('canvas-frame');
const photoInput = document.getElementById('photo');
const photoGrid = document.getElementById('photo-grid');
const photoCount = document.getElementById('photo-count');
const panelNumber = document.getElementById('panel-number');
const zoomInput = document.getElementById('zoom');
const zoomValue = document.getElementById('zoom-value');
const toast = document.getElementById('toast');
const query = new URLSearchParams(location.search);
const shot = query.get('shot');

const DEFAULT_SLOTS = [
  { imageIndex: 0, zoom: 1.12, x: 0.02, y: 0.86 },
  { imageIndex: 1, zoom: 1.15, x: -0.14, y: 0.44 },
  { imageIndex: 0, zoom: 1.22, x: 0.23, y: 0.68 },
  { imageIndex: 1, zoom: 1.18, x: 0.12, y: 0.45 },
  { imageIndex: 0, zoom: 1.38, x: -0.18, y: 0.52 },
  { imageIndex: 1, zoom: 1.12, x: -0.08, y: 0.82 },
  { imageIndex: 0, zoom: 1.18, x: 0.08, y: 0.36 },
  { imageIndex: 1, zoom: 1.25, x: -0.12, y: 0.30 },
  { imageIndex: 0, zoom: 1.08, x: 0.00, y: 0.54 },
];

const state = {
  images: [],
  slots: cloneSlots(DEFAULT_SLOTS),
  activeSlot: 0,
  layout: 'classic',
  ratio: 'portrait',
  preset: 'vice',
  intensity: 72,
  texture: 38,
  grain: 24,
  vignette: 42,
  frameLines: true,
  titleOne: 'GRAND',
  titleTwo: 'THEFT',
  titleThree: 'AUTO',
  strapline: 'A VICE CITY STORY',
  logoSize: 100,
  ratingBadge: true,
};

let animationFrame = 0;
let drag = null;
let toastTimer = 0;
let uploading = false;

bootstrap().catch((error) => {
  console.error(error);
  showToast('The local photos or display fonts could not load. Please reload the studio.');
  window.__shotError = error.message ?? String(error);
});

async function bootstrap() {
  const [images] = await Promise.all([
    Promise.all([
      loadImageRecord('./samples/boulevard.jpg', 'boulevard', 'Sunset boulevard'),
      loadImageRecord('./samples/pier.jpg', 'pier', 'Ocean pier'),
    ]),
    loadDisplayFonts(),
  ]);
  state.images = images;

  applyShot(shot, query, state);
  state.activeSlot = clamp(state.activeSlot, 0, getPanels(state.layout).length - 1);
  bindEvents();
  syncAllControls();
  drawNow();
  document.getElementById('export').disabled = false;
  signalShotReady();
}

function bindEvents() {
  document.querySelectorAll('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => activateTool(button.dataset.tool));
  });

  photoInput.addEventListener('change', async () => {
    try {
      await addFiles([...photoInput.files]);
    } finally {
      photoInput.value = '';
    }
  });

  const dropzone = document.getElementById('dropzone');
  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-dragging');
    });
  });
  dropzone.addEventListener('drop', async (event) => addFiles([...event.dataTransfer.files]));

  zoomInput.addEventListener('input', () => {
    state.slots[state.activeSlot].zoom = Number(zoomInput.value) / 100;
    syncRange(zoomInput, zoomValue, '%');
    scheduleDraw();
  });

  document.querySelectorAll('[data-nudge]').forEach((button) => {
    button.addEventListener('click', () => nudgeActiveSlot(button.dataset.nudge, 0.045));
  });

  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      state.preset = button.dataset.preset;
      syncChoiceButtons('[data-preset]', state.preset, 'preset');
      scheduleDraw();
    });
  });

  bindRange('intensity', 'intensity-value', 'intensity');
  bindRange('texture', 'texture-value', 'texture');
  bindRange('grain', 'grain-value', 'grain');
  bindRange('vignette', 'vignette-value', 'vignette');
  bindRange('logo-size', 'logo-size-value', 'logoSize');
  bindCheckbox('frame-lines', 'frameLines');
  bindCheckbox('rating-badge', 'ratingBadge');
  bindText('title-one', 'titleOne');
  bindText('title-two', 'titleTwo');
  bindText('title-three', 'titleThree');
  bindText('strapline', 'strapline');

  document.querySelectorAll('[data-layout]').forEach((button) => {
    button.addEventListener('click', () => {
      state.layout = button.dataset.layout;
      state.activeSlot = clamp(state.activeSlot, 0, getPanels(state.layout).length - 1);
      syncChoiceButtons('[data-layout]', state.layout, 'layout');
      updatePanelControls();
      renderPhotoGrid();
      scheduleDraw();
    });
  });

  document.querySelectorAll('input[name="ratio"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      changeFormat(radio.value);
    });
  });

  document.getElementById('export-format').addEventListener('change', (event) => {
    changeFormat(event.target.value);
  });

  document.getElementById('remix').addEventListener('click', remixScenes);
  document.getElementById('reset').addEventListener('click', resetCover);
  document.getElementById('export').addEventListener('click', exportCover);
  document.getElementById('fit-preview').addEventListener('click', () => {
    fitCanvasFrame();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) canvasFrame.animate([
      { transform: 'scale(0.985)' }, { transform: 'scale(1)' },
    ], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    canvas.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' });
  });

  canvas.addEventListener('pointerdown', startCanvasDrag);
  canvas.addEventListener('pointermove', moveCanvasDrag);
  canvas.addEventListener('pointerup', endCanvasDrag);
  canvas.addEventListener('pointercancel', endCanvasDrag);
  canvas.addEventListener('lostpointercapture', endCanvasDrag);
  canvas.addEventListener('wheel', zoomCanvasPanel, { passive: false });
  canvas.addEventListener('keydown', handleCanvasKey);

  new ResizeObserver(fitCanvasFrame).observe(document.getElementById('canvas-stage'));
  window.addEventListener('beforeunload', () => {
    state.images.filter((record) => record.isUpload).forEach((record) => URL.revokeObjectURL(record.url));
  });
}

function activateTool(tool) {
  document.querySelectorAll('[data-tool]').forEach((button) => {
    const active = button.dataset.tool === tool;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    const active = panel.dataset.panel === tool;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  });
  if (matchMedia('(max-width: 780px)').matches) {
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    document.querySelector(`[data-panel="${tool}"]`).scrollIntoView({ behavior, block: 'start' });
  }
}

async function addFiles(files) {
  if (uploading) return;
  const imageFiles = files.filter((file) => file.type.startsWith('image/') || (!file.type && /\.(jpe?g|png|webp|gif)$/i.test(file.name)));
  const available = Math.max(0, 12 - state.images.length);
  if (!imageFiles.length) {
    showToast('Choose a JPG, PNG or WEBP image.');
    return;
  }
  if (!available) {
    showToast('The photo roll is full. Twelve shots is the limit.');
    return;
  }

  const selected = imageFiles.slice(0, available);
  const firstNewIndex = state.images.length;
  uploading = true;
  photoInput.disabled = true;
  const results = await Promise.allSettled(selected.map(async (file, index) => {
    const url = URL.createObjectURL(file);
    try {
      const record = await loadImageRecord(url, `upload-${Date.now()}-${index}`, file.name);
      record.isUpload = true;
      return record;
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }));
  uploading = false;
  photoInput.disabled = false;
  const records = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (!records.length) {
    showToast('Those images could not be decoded. Try a JPG, PNG or WEBP file.');
    return;
  }

  state.images.push(...records);
  const panelCount = getPanels(state.layout).length;
  records.forEach((_, index) => {
    const slotIndex = (state.activeSlot + index) % panelCount;
    state.slots[slotIndex].imageIndex = firstNewIndex + index;
    state.slots[slotIndex].zoom = 1.08;
    state.slots[slotIndex].x = 0;
    state.slots[slotIndex].y = 0;
  });
  renderPhotoGrid();
  updatePanelControls();
  scheduleDraw();
  const skipped = imageFiles.length - records.length;
  showToast(`${records.length} photo${records.length === 1 ? '' : 's'} added.${skipped ? ` ${skipped} skipped or over the roll limit.` : ''}`);
}

function renderPhotoGrid() {
  photoGrid.replaceChildren();
  const visibleSlots = state.slots.slice(0, getPanels(state.layout).length);
  state.images.forEach((record, imageIndex) => {
    const assigned = visibleSlots
      .map((slot, slotIndex) => slot.imageIndex === imageIndex ? slotIndex + 1 : null)
      .filter(Boolean);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `photo-thumb${state.slots[state.activeSlot]?.imageIndex === imageIndex ? ' is-assigned' : ''}`;
    button.style.backgroundImage = `url("${record.url}")`;
    button.setAttribute('aria-label', `Use ${record.name} in panel ${state.activeSlot + 1}`);
    button.setAttribute('aria-pressed', String(state.slots[state.activeSlot]?.imageIndex === imageIndex));
    button.title = record.name;
    if (assigned.length) {
      const marker = document.createElement('i');
      marker.textContent = `${assigned.length}×`;
      marker.setAttribute('aria-hidden', 'true');
      button.append(marker);
    }
    button.addEventListener('click', () => {
      state.slots[state.activeSlot].imageIndex = imageIndex;
      renderPhotoGrid();
      scheduleDraw();
    });
    photoGrid.append(button);
  });
  photoCount.textContent = `${state.images.length} photo${state.images.length === 1 ? '' : 's'}`;
}

function startCanvasDrag(event) {
  if (shot === 'cover' || event.button !== 0) return;
  event.preventDefault();
  const point = canvasPoint(event);
  const panel = hitTestPanel(state.layout, point.x, point.y);
  if (panel < 0) return;
  state.activeSlot = panel;
  const slot = state.slots[panel];
  const image = state.images[slot.imageIndex]?.img;
  if (!image) return;
  const position = getPhotoPlacement(canvas.width, canvas.height, getPanels(state.layout)[panel], image, slot);
  drag = {
    pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    slotX: slot.x, slotY: slot.y, travelX: position.travelX, travelY: position.travelY,
  };
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('is-dragging');
  updatePanelControls();
  renderPhotoGrid();
  scheduleDraw();
}

function moveCanvasDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const rect = canvas.getBoundingClientRect();
  const slot = state.slots[state.activeSlot];
  const dx = (event.clientX - drag.startX) * canvas.width / rect.width;
  const dy = (event.clientY - drag.startY) * canvas.height / rect.height;
  if (drag.travelX > 0) slot.x = clamp(drag.slotX + dx / drag.travelX, -1, 1);
  if (drag.travelY > 0) slot.y = clamp(drag.slotY + dy / drag.travelY, -1, 1);
  scheduleDraw();
}

function endCanvasDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag = null;
  canvas.classList.remove('is-dragging');
}

function zoomCanvasPanel(event) {
  if (shot === 'cover') return;
  event.preventDefault();
  const point = canvasPoint(event);
  const panel = hitTestPanel(state.layout, point.x, point.y);
  if (panel >= 0 && panel !== state.activeSlot) {
    state.activeSlot = panel;
    renderPhotoGrid();
  }
  const slot = state.slots[state.activeSlot];
  slot.zoom = clamp(slot.zoom - event.deltaY * 0.0012, 1, 2.2);
  updatePanelControls();
  scheduleDraw();
}

function handleCanvasKey(event) {
  const keys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (keys[event.key]) {
    event.preventDefault();
    nudgeActiveSlot(keys[event.key], event.shiftKey ? 0.1 : 0.035);
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    changeActiveZoom(0.05);
  }
  if (event.key === '-') {
    event.preventDefault();
    changeActiveZoom(-0.05);
  }
}

function nudgeActiveSlot(direction, amount) {
  const slot = state.slots[state.activeSlot];
  if (direction === 'left') slot.x = clamp(slot.x - amount, -1, 1);
  if (direction === 'right') slot.x = clamp(slot.x + amount, -1, 1);
  if (direction === 'up') slot.y = clamp(slot.y - amount, -1, 1);
  if (direction === 'down') slot.y = clamp(slot.y + amount, -1, 1);
  scheduleDraw();
}

function changeActiveZoom(change) {
  const slot = state.slots[state.activeSlot];
  slot.zoom = clamp(slot.zoom + change, 1, 2.2);
  updatePanelControls();
  scheduleDraw();
}

function remixScenes() {
  const panelCount = getPanels(state.layout).length;
  for (let index = 0; index < panelCount; index += 1) {
    state.slots[index].imageIndex = Math.floor(Math.random() * state.images.length);
    state.slots[index].zoom = 1.08 + Math.random() * 0.45;
    state.slots[index].x = (Math.random() - 0.5) * 0.48;
    state.slots[index].y = (Math.random() - 0.5) * 0.34;
  }
  renderPhotoGrid();
  updatePanelControls();
  scheduleDraw();
  showToast('New scene cut ready.');
}

function resetCover() {
  state.slots = cloneSlots(DEFAULT_SLOTS).map((slot) => ({ ...slot, imageIndex: slot.imageIndex % state.images.length }));
  Object.assign(state, {
    activeSlot: 0,
    layout: 'classic',
    ratio: 'portrait',
    preset: 'vice',
    intensity: 72,
    texture: 38,
    grain: 24,
    vignette: 42,
    frameLines: true,
    titleOne: 'GRAND',
    titleTwo: 'THEFT',
    titleThree: 'AUTO',
    strapline: 'A VICE CITY STORY',
    logoSize: 100,
    ratingBadge: true,
  });
  syncAllControls();
  scheduleDraw();
  showToast('Cover settings reset. Your photos are still here.');
}

async function exportCover() {
  const exportButton = document.getElementById('export');
  if (exportButton.disabled) return;
  exportButton.disabled = true;
  exportButton.querySelector('span').textContent = 'Rendering…';
  const snapshot = { ...state, slots: cloneSlots(state.slots), images: [...state.images] };
  try {
    await loadDisplayFonts();
    await new Promise(requestAnimationFrame);
    const output = document.createElement('canvas');
    const format = getExportFormat(snapshot.ratio);
    output.width = format.width;
    output.height = format.height;
    drawCover(output, snapshot, { editor: false });
    const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Canvas returned no PNG.');
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const title = [snapshot.titleOne, snapshot.titleTwo, snapshot.titleThree].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    link.href = url;
    link.download = `${title || 'viceprint'}-${output.width}x${output.height}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast(`Cover exported at ${output.width} × ${output.height}px.`);
  } catch (error) {
    console.error(error);
    showToast('The PNG could not be rendered. Please try again.');
  } finally {
    exportButton.disabled = false;
    exportButton.querySelector('span').textContent = 'Export cover';
  }
}

function bindRange(inputId, outputId, stateKey) {
  const input = document.getElementById(inputId);
  const output = document.getElementById(outputId);
  input.addEventListener('input', () => {
    state[stateKey] = Number(input.value);
    syncRange(input, output, '%');
    scheduleDraw();
  });
}

function bindCheckbox(inputId, stateKey) {
  const input = document.getElementById(inputId);
  input.addEventListener('change', () => {
    state[stateKey] = input.checked;
    scheduleDraw();
  });
}

function bindText(inputId, stateKey) {
  const input = document.getElementById(inputId);
  input.addEventListener('input', () => {
    state[stateKey] = input.value;
    scheduleDraw();
  });
}

function syncAllControls() {
  document.getElementById('intensity').value = state.intensity;
  document.getElementById('texture').value = state.texture;
  document.getElementById('grain').value = state.grain;
  document.getElementById('vignette').value = state.vignette;
  document.getElementById('logo-size').value = state.logoSize;
  document.getElementById('frame-lines').checked = state.frameLines;
  document.getElementById('rating-badge').checked = state.ratingBadge;
  document.getElementById('title-one').value = state.titleOne;
  document.getElementById('title-two').value = state.titleTwo;
  document.getElementById('title-three').value = state.titleThree;
  document.getElementById('strapline').value = state.strapline;
  document.querySelector(`input[name="ratio"][value="${state.ratio}"]`).checked = true;
  syncRange(document.getElementById('intensity'), document.getElementById('intensity-value'), '%');
  syncRange(document.getElementById('texture'), document.getElementById('texture-value'), '%');
  syncRange(document.getElementById('grain'), document.getElementById('grain-value'), '%');
  syncRange(document.getElementById('vignette'), document.getElementById('vignette-value'), '%');
  syncRange(document.getElementById('logo-size'), document.getElementById('logo-size-value'), '%');
  syncChoiceButtons('[data-preset]', state.preset, 'preset');
  syncChoiceButtons('[data-layout]', state.layout, 'layout');
  syncCanvasShape();
  updatePanelControls();
  renderPhotoGrid();
}

function syncChoiceButtons(selector, value, key) {
  document.querySelectorAll(selector).forEach((button) => {
    const active = button.dataset[key] === value;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-checked', String(active));
  });
}

function syncCanvasShape() {
  const { width, height } = getExportFormat(state.ratio);
  canvasFrame.dataset.format = state.ratio;
  document.body.dataset.ratio = state.ratio;
  document.getElementById('export-format').value = state.ratio;
  document.querySelectorAll('input[name="ratio"]').forEach((radio) => {
    radio.checked = radio.value === state.ratio;
  });
  document.getElementById('canvas-size').textContent = `${width} × ${height} px`;
  fitCanvasFrame();
  updatePreviewScale();
}

function changeFormat(ratio) {
  state.ratio = ratio;
  syncCanvasShape();
  scheduleDraw();
}

function fitCanvasFrame() {
  if (shot === 'cover') return;
  const stage = document.getElementById('canvas-stage');
  const style = getComputedStyle(stage);
  const availableWidth = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availableHeight = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const { width, height } = getExportFormat(state.ratio);
  const scale = Math.max(0, Math.min(availableWidth / width, availableHeight / height, 700 / height));
  canvasFrame.style.width = `${Math.floor(width * scale)}px`;
  canvasFrame.style.height = `${Math.floor(height * scale)}px`;
  updatePreviewScale();
}

function updatePanelControls() {
  const slot = state.slots[state.activeSlot];
  panelNumber.textContent = String(state.activeSlot + 1).padStart(2, '0');
  zoomInput.value = Math.round(slot.zoom * 100);
  syncRange(zoomInput, zoomValue, '%');
  const picker = document.getElementById('panel-picker');
  picker.replaceChildren();
  getPanels(state.layout).forEach((_, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(index + 1).padStart(2, '0');
    button.setAttribute('aria-label', `Select panel ${index + 1}`);
    button.setAttribute('aria-pressed', String(index === state.activeSlot));
    button.addEventListener('click', () => {
      state.activeSlot = index;
      updatePanelControls();
      renderPhotoGrid();
      scheduleDraw();
    });
    picker.append(button);
  });
}

function syncRange(input, output, suffix) {
  const value = Number(input.value);
  const fill = ((value - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
  input.style.setProperty('--range-fill', `${fill}%`);
  output.textContent = `${value}${suffix}`;
}

function scheduleDraw() {
  if (animationFrame) return;
  animationFrame = requestAnimationFrame(() => {
    animationFrame = 0;
    drawNow();
  });
}

function drawNow() {
  const { width, height } = getExportFormat(state.ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  drawCover(canvas, state, { editor: shot !== 'cover' });
  updatePreviewScale();
}

function updatePreviewScale() {
  if (!canvas.width) return;
  const percent = Math.round((canvas.getBoundingClientRect().width / canvas.width) * 100);
  document.getElementById('zoom-readout').textContent = `${percent}%`;
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function loadImageRecord(url, id, name) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ img, url, id, name });
    img.onerror = reject;
    img.src = url;
  });
}

function cloneSlots(slots) {
  return slots.map((slot) => ({ ...slot }));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
