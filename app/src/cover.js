// The preview and PNG downloads share this renderer. Panel geometry uses normalized
// coordinates; typography, borders and print effects scale with the canvas's shorter edge.

const rectangle = (left, top, right, bottom) => [[left, top], [right, top], [right, bottom], [left, bottom]];
const LAYOUTS = {
  classic: [
    [[0, 0], [0.62, 0], [0.59, 0.41], [0.34, 0.397], [0, 0.38]],
    [[0.62, 0], [1, 0], [1, 0.35], [0.72, 0.39], [0.59, 0.41]],
    [[0, 0.38], [0.34, 0.397], [0.38, 0.72], [0, 0.75]],
    [[0.34, 0.397], [0.59, 0.41], [0.72, 0.39], [0.68, 0.70], [0.38, 0.72]],
    [[0.72, 0.39], [1, 0.35], [1, 0.71], [0.68, 0.70]],
    [[0, 0.75], [0.38, 0.72], [0.68, 0.70], [1, 0.71], [1, 1], [0, 1]],
  ],
  grid: Array.from({ length: 9 }, (_, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    return rectangle(column / 3, row / 3, (column + 1) / 3, (row + 1) / 3);
  }),
  duo: [
    [[0, 0], [0.54, 0], [0.46, 1], [0, 1]],
    [[0.54, 0], [1, 0], [1, 1], [0.46, 1]],
  ],
  hero: [
    rectangle(0, 0, 1, 0.72),
    rectangle(0, 0.72, 1 / 3, 1),
    rectangle(1 / 3, 0.72, 2 / 3, 1),
    rectangle(2 / 3, 0.72, 1, 1),
  ],
};

export const LAYOUT_NAMES = Object.freeze(Object.keys(LAYOUTS));

const COLOR_STOPS = {
  vice: [[0, [10, 19, 23]], [0.36, [118, 50, 55]], [0.70, [251, 135, 92]], [1, [255, 250, 221]]],
  sunset: [[0, [35, 16, 14]], [0.34, [146, 47, 35]], [0.68, [249, 142, 64]], [1, [255, 242, 193]]],
  neon: [[0, [5, 13, 20]], [0.35, [182, 31, 126]], [0.70, [27, 178, 194]], [1, [201, 255, 249]]],
  noir: [[0, [7, 12, 15]], [0.38, [48, 75, 83]], [0.73, [107, 173, 180]], [1, [232, 249, 240]]],
};

const GRADIENT_MAPS = Object.fromEntries(Object.entries(COLOR_STOPS).map(([name, stops]) => [name, makeGradientMap(stops)]));
const GRADE_STRENGTH = { vice: 0.27, sunset: 0.78, neon: 0.76, noir: 0.78 };
const TINTS = {
  vice: ['#ff8a35', '#f23d84', '#36c5cd', '#ffb13b', '#f95a6b', '#e63172'],
  sunset: ['#eea94e', '#ee7150', '#df6540', '#ffb05e', '#f7bd69', '#be563d'],
  neon: ['#21cbdc', '#ec349a', '#4be4e3', '#cd3b9a', '#209baa', '#e240ad'],
  noir: ['#263a3d', '#57dbe0', '#344349', '#274b53', '#49b9c0', '#111b1e'],
};

const dotTiles = new Map();
const grainTile = makeGrainTile();

export function getPanels(layout = 'classic') {
  return LAYOUTS[layout] ?? LAYOUTS.classic;
}

export function hitTestPanel(layout, x, y) {
  return getPanels(layout).findIndex((polygon) => pointInPolygon(x, y, polygon));
}

// The same overflow distances are used by the painter and pointer dragging. Position is
// bounded to [-1, 1], so even at the limits a photo completely fills its clipped panel.
export function getPhotoPlacement(w, h, polygon, image, slot) {
  const bounds = polygonBounds(polygon, w, h);
  const scale = Math.max(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight) * Math.max(1, slot?.zoom ?? 1.12);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const travelX = Math.max(0, (width - bounds.width) / 2);
  const travelY = Math.max(0, (height - bounds.height) / 2);
  return {
    bounds, width, height, travelX, travelY,
    x: bounds.x - travelX + Math.max(-1, Math.min(1, slot?.x ?? 0)) * travelX,
    y: bounds.y - travelY + Math.max(-1, Math.min(1, slot?.y ?? 0)) * travelY,
  };
}

/** Call after loadDisplayFonts(): all canvas text uses the locally vendored display faces. */
export function drawCover(canvas, state, { editor = false } = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const panels = getPanels(state.layout);
  const unit = Math.min(w, h);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#080807';
  ctx.fillRect(0, 0, w, h);

  panels.forEach((polygon, index) => drawPanel(ctx, w, h, polygon, state.slots[index], state, index));
  if (state.frameLines) drawPanelLines(ctx, w, h, panels, unit);
  if (state.layout === 'hero') drawFilmstrip(ctx, w, h, unit);
  drawCornerLabels(ctx, w, h, state, unit);
  drawTitleMark(ctx, w, h, state, unit);
  if (state.ratingBadge) drawRatingBadge(ctx, w, h, unit);

  // These are cover-wide operations, after the scenes and title have been composed.
  applyComposedGrade(ctx, w, h, state);
  drawVignette(ctx, w, h, state.vignette ?? 42);
  drawOuterFrame(ctx, w, h, unit);

  if (editor && panels[state.activeSlot]) drawSelection(ctx, w, h, panels[state.activeSlot], state.activeSlot, unit);
  ctx.restore();
}

function drawPanel(ctx, w, h, polygon, slot, state, index) {
  const image = (state.images[slot?.imageIndex] ?? state.images[0])?.img;
  const bounds = polygonBounds(polygon, w, h);
  const intensity = (state.intensity ?? 72) / 100;
  const colors = TINTS[state.preset] ?? TINTS.vice;

  ctx.save();
  tracePolygon(ctx, polygon, w, h);
  ctx.clip();
  ctx.fillStyle = colors[index % colors.length];
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

  if (image?.complete && image.naturalWidth) {
    const position = getPhotoPlacement(w, h, polygon, image, slot);
    ctx.filter = styleFilter(state.preset, intensity);
    ctx.drawImage(image, position.x, position.y, position.width, position.height);
    ctx.filter = 'none';
  }

  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = intensity * 0.15;
  ctx.fillStyle = colors[index % colors.length];
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

  if ((state.texture ?? 38) > 0) {
    ctx.globalAlpha = (state.texture / 100) * 0.20;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = halftonePattern(ctx, Math.min(w, h));
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }
  ctx.restore();
}

function styleFilter(preset, intensity) {
  const saturation = preset === 'noir' ? 1 - intensity * 0.62 : 1 + intensity * 0.57;
  return `contrast(${1 + intensity * 0.24}) saturate(${saturation}) brightness(${1 + intensity * 0.025})`;
}

function makeGradientMap(stops) {
  const table = new Uint8ClampedArray(256 * 3);
  for (let value = 0; value < 256; value += 1) {
    const luminance = value / 255;
    const stopIndex = Math.max(0, stops.findIndex(([at]) => at >= luminance) - 1);
    const [leftAt, left] = stops[stopIndex];
    const [rightAt, right] = stops[stopIndex + 1];
    const amount = Math.max(0, Math.min(1, (luminance - leftAt) / (rightAt - leftAt)));
    for (let channel = 0; channel < 3; channel += 1) {
      table[value * 3 + channel] = left[channel] + (right[channel] - left[channel]) * amount;
    }
  }
  return table;
}

function makeGrainTile() {
  const noise = new Float32Array(128 * 128);
  let seed = 6317;
  for (let index = 0; index < noise.length; index += 1) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    noise[index] = (seed >>> 0) / 0xffffffff * 2 - 1;
  }
  return noise;
}

function applyComposedGrade(ctx, w, h, state) {
  const mix = ((state.intensity ?? 72) / 100) * (GRADE_STRENGTH[state.preset] ?? GRADE_STRENGTH.vice);
  const grain = (state.grain ?? 24) * 0.22;
  if (mix === 0 && grain === 0) return;
  const table = GRADIENT_MAPS[state.preset] ?? GRADIENT_MAPS.vice;
  const frame = ctx.getImageData(0, 0, w, h);
  const pixels = frame.data;
  const original = 1 - mix;

  for (let y = 0; y < h; y += 1) {
    const noiseRow = (y & 127) * 128;
    for (let x = 0, pixel = y * w * 4; x < w; x += 1, pixel += 4) {
      const luminance = (pixels[pixel] * 54 + pixels[pixel + 1] * 183 + pixels[pixel + 2] * 19) >> 8;
      const mapped = luminance * 3;
      const noise = grainTile[noiseRow + (x & 127)] * grain;
      pixels[pixel] = pixels[pixel] * original + table[mapped] * mix + noise;
      pixels[pixel + 1] = pixels[pixel + 1] * original + table[mapped + 1] * mix + noise;
      pixels[pixel + 2] = pixels[pixel + 2] * original + table[mapped + 2] * mix + noise;
    }
  }
  ctx.putImageData(frame, 0, 0);
}

function drawVignette(ctx, w, h, amount) {
  if (amount <= 0) return;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(w / 2, h / 2);
  const shade = ctx.createRadialGradient(0, -0.08, 0.32, 0, 0, 1.38);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(0.5, 'rgba(0,0,0,0)');
  shade.addColorStop(1, `rgba(0,0,0,${amount / 100 * 0.68})`);
  ctx.fillStyle = shade;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function halftonePattern(ctx, unit) {
  const size = Math.max(6, Math.round(unit / 125));
  if (!dotTiles.has(size)) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = size;
    const dots = tile.getContext('2d');
    dots.fillStyle = '#11100f';
    dots.beginPath();
    dots.arc(size * 0.3, size * 0.3, Math.max(0.8, size * 0.11), 0, Math.PI * 2);
    dots.fill();
    dotTiles.set(size, tile);
  }
  return ctx.createPattern(dotTiles.get(size), 'repeat');
}

function drawPanelLines(ctx, w, h, panels, unit) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0a0909';
  ctx.lineWidth = unit * 0.013;
  panels.forEach((polygon) => {
    tracePolygon(ctx, polygon, w, h);
    ctx.stroke();
  });
  ctx.restore();
}

function drawFilmstrip(ctx, w, h, unit) {
  ctx.save();
  const rail = unit * 0.022;
  ctx.fillStyle = '#0b0a09';
  ctx.fillRect(0, h * 0.72 - rail / 2, w, rail);
  ctx.fillRect(0, h - rail, w, rail);
  ctx.fillStyle = '#e8dfcb';
  const pitch = unit * 0.045;
  for (let x = pitch / 2; x < w; x += pitch) {
    ctx.fillRect(x, h * 0.72 - rail * 0.2, pitch * 0.39, rail * 0.4);
    ctx.fillRect(x, h - rail * 0.68, pitch * 0.39, rail * 0.4);
  }
  ctx.restore();
}

function drawCornerLabels(ctx, w, h, state, unit) {
  const margin = unit * 0.047;
  const label = (state.strapline ?? 'A VICE CITY STORY').trim().toUpperCase();
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  if (label) {
    const size = fitText(ctx, label, w * 0.64, unit * 0.027, 12, 'Bebas Neue');
    ctx.font = `${size}px "Bebas Neue", sans-serif`;
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = '#0c0b0b';
    ctx.fillRect(margin - unit * 0.012, margin - size * 0.85, textWidth + unit * 0.024, size * 1.18);
    ctx.fillStyle = '#fffaf0';
    ctx.fillText(label, margin, margin);
  }
  ctx.textAlign = 'right';
  ctx.font = `${unit * 0.03}px "Anton", sans-serif`;
  ctx.strokeStyle = '#0a0909';
  ctx.lineWidth = unit * 0.006;
  ctx.strokeText('VP', w - margin, margin);
  ctx.fillStyle = '#fffaf0';
  ctx.fillText('VP', w - margin, margin);
  ctx.restore();
}

function drawTitleMark(ctx, w, h, state, unit) {
  const scale = (state.logoSize ?? 100) / 100;
  const maxWidth = Math.min(w * 0.48, unit * 0.44 * scale);
  const centerX = w - unit * 0.07 - maxWidth / 2;
  const lineHeight = unit * 0.096 * scale;
  const blockHeight = lineHeight * 3.4;
  const top = h - unit * 0.095 - blockHeight;
  const lines = [state.titleOne, state.titleTwo, state.titleThree]
    .map((line) => (line ?? '').trim().toUpperCase())
    .filter(Boolean);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.font = `${unit * 0.29 * scale}px "Bebas Neue", sans-serif`;
  const romanX = Math.min(w - unit * 0.15 * scale, centerX + unit * 0.10 * scale);
  const romanY = top + blockHeight;
  const gradient = ctx.createLinearGradient(romanX, romanY - unit * 0.3, romanX, romanY);
  gradient.addColorStop(0, state.preset === 'neon' ? '#57f2e3' : '#ff9d31');
  gradient.addColorStop(0.5, '#f23b78');
  gradient.addColorStop(1, '#e72775');
  ctx.strokeStyle = '#fff6e8';
  ctx.lineWidth = unit * 0.021 * scale;
  ctx.shadowColor = 'rgba(0,0,0,.46)';
  ctx.shadowBlur = unit * 0.022;
  ctx.shadowOffsetY = unit * 0.01;
  ctx.strokeText('VI', romanX, romanY);
  ctx.fillStyle = gradient;
  ctx.fillText('VI', romanX, romanY);
  ctx.shadowColor = 'transparent';

  lines.forEach((line, index) => {
    const size = fitText(ctx, line, maxWidth, unit * 0.092 * scale, 12, 'Anton');
    ctx.font = `${size}px "Anton", sans-serif`;
    ctx.strokeStyle = '#090909';
    ctx.lineWidth = unit * 0.021 * scale;
    const y = top + lineHeight * (index + 0.85);
    ctx.strokeText(line, centerX, y);
    ctx.fillStyle = '#fffdf4';
    ctx.fillText(line, centerX, y);
  });
  ctx.restore();
}

function drawRatingBadge(ctx, w, h, unit) {
  const margin = unit * 0.047;
  const size = unit * 0.102;
  const x = margin;
  const y = h - size - margin;
  ctx.save();
  ctx.fillStyle = '#fffdf4';
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = '#090909';
  ctx.lineWidth = unit * 0.007;
  ctx.strokeRect(x, y, size, size);
  ctx.fillStyle = '#090909';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${size * 0.68}px "Anton", sans-serif`;
  ctx.fillText('M', x + size / 2, y + size * 0.62);
  ctx.font = `${size * 0.145}px "Bebas Neue", sans-serif`;
  ctx.fillText('MATURE 17+', x + size / 2, y + size * 0.9);
  ctx.fillRect(x + size * 0.08, y + size * 0.70, size * 0.84, unit * 0.003);
  ctx.restore();
}

function drawOuterFrame(ctx, w, h, unit) {
  ctx.save();
  ctx.strokeStyle = '#fffaf0';
  ctx.lineWidth = unit * 0.017;
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  ctx.strokeStyle = '#090909';
  ctx.lineWidth = unit * 0.005;
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  ctx.restore();
}

function drawSelection(ctx, w, h, polygon, index, unit) {
  const bounds = polygonBounds(polygon, w, h);
  ctx.save();
  tracePolygon(ctx, polygon, w, h);
  ctx.strokeStyle = '#ff3d83';
  ctx.lineWidth = unit * 0.006;
  ctx.setLineDash([unit * 0.012, unit * 0.008]);
  ctx.stroke();
  ctx.setLineDash([]);
  const badgeSize = unit * 0.035;
  const x = bounds.x + badgeSize * 0.85;
  const y = bounds.y + badgeSize * 0.85;
  ctx.fillStyle = '#ff3d83';
  ctx.beginPath();
  ctx.arc(x, y, badgeSize * 0.56, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${badgeSize * 0.52}px "Bebas Neue", sans-serif`;
  ctx.fillText(String(index + 1).padStart(2, '0'), x, y);
  ctx.restore();
}

function tracePolygon(ctx, polygon, w, h) {
  ctx.beginPath();
  polygon.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x * w, y * h);
    else ctx.lineTo(x * w, y * h);
  });
  ctx.closePath();
}

function polygonBounds(polygon, w, h) {
  const xs = polygon.map(([x]) => x * w);
  const ys = polygon.map(([, y]) => y * h);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function fitText(ctx, text, maxWidth, startSize, minSize, family) {
  let size = startSize;
  ctx.font = `${size}px "${family}", sans-serif`;
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= 1;
    ctx.font = `${size}px "${family}", sans-serif`;
  }
  return size;
}
