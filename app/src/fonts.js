let ready;

// Both faces are declared in style.css using files beside the app. Canvas text must wait for
// the actual display fonts, including on the separate PNG download path.
export function loadDisplayFonts() {
  ready ??= Promise.all([
    document.fonts.load('64px "Anton"'),
    document.fonts.load('64px "Bebas Neue"'),
  ]).then(async (faces) => {
    if (faces.some((family) => family.length === 0)) throw new Error('A local display font is missing.');
    await document.fonts.ready;
  });
  return ready;
}
