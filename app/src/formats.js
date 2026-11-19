// A single size table drives the preview, download and fixed screenshot scenes.
export const EXPORT_FORMATS = Object.freeze({
  square: Object.freeze({ width: 1080, height: 1080, label: 'Square' }),
  portrait: Object.freeze({ width: 1080, height: 1350, label: 'Portrait' }),
  landscape: Object.freeze({ width: 1920, height: 1080, label: 'Landscape' }),
});

export function getExportFormat(name) {
  return EXPORT_FORMATS[name] ?? EXPORT_FORMATS.portrait;
}
