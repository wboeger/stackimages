# stackimages
Combine photomicrographs into a single image, keeping areas in focus.

A browser app for **focus stacking**. It merges photos of one scene taken at different focus distances into a single image that is sharp from front to back. Everything runs in the browser, and no photos are uploaded.

**Use it:** open `index.html` in a recent Chrome, Edge, Firefox or Safari (16.4+). It has no dependencies and no build step. Or turn on GitHub Pages for this repository and open the Pages URL.

## Features
- Drag-and-drop JPEG, PNG or WebP photos. Photos are sorted by file name, which should match focus order.
- Automatic alignment (shift, scale and rotation) that corrects focus breathing and small camera movement.
- Two blending methods:
  - **Laplacian pyramid** (default): keeps detail band by band, with few halos.
  - **Depth map**: copies each pixel from its sharpest photo, so colours stay exactly as shot.
- Depth map output (which photo was sharpest at each pixel), shown with a perceptually uniform colour map.
- Before/after comparison slider against any slice you choose, and a readout of the scale and shift corrected for each photo.
- Save the result (PNG or JPEG), the depth map, any aligned slice (the one shown in Compare), or any single input photo.
- **Draw** tab for line drawings (camera-lucida style tracing) over the stacked result, the depth map or any single slice:
  - Switch the background at any time with the slice list, the ‹ › buttons, the *Focus* slider or the `[` `]` keys. Every slice is aligned and cropped exactly like the result, so the drawing stays registered. Slices are cached after the first visit.
  - Tools: freehand pen with a tremor stabilizer (the nib follows the pointer on a short string, then the finished stroke is smoothed along its length), straight line (Shift snaps to 15°), eraser, delete whole stroke, pan. Width, colour, undo/redo, and a background fade to check the drawing on white.
  - Pen pressure: with a stylus (Wacom, Apple Pencil, Surface Pen and similar), pressing harder draws a heavier line, from the *Lightest* share of the width up to the full width. Mouse and finger lines keep a constant width, and the *Pen pressure* box turns it off. Pressure lines are saved in the SVG as filled outlines, so the varying width survives in Inkscape or Illustrator.
  - Zoom with the wheel, pinch, or the buttons; pan with Space-drag, the middle button, two fingers, or the Pan tool. With a stylus, fingers pan and the stylus eraser end erases.
  - Lines are vector strokes. On screen they are re-rendered at the display's own resolution (including 2× and 3× Retina screens) after every pan or zoom, so they stay smooth at any zoom; only the background photo shows its pixels when magnified.
  - *Export size* (1× to 4×) sets the pixel size of PNG and PSD exports. The lines are rendered from their vector paths at that size, the background is resampled to match, and the scale bar stays correct (µm per pixel shrinks by the same factor). Sizes above 16.7 megapixels, the iPad Safari canvas limit, are not offered.
  - Save the drawing as a transparent PNG, as an SVG (vector paths for Inkscape or Illustrator), composited on the current background, or as an editable file to continue later. The scale bar can be added to the drawing.
  - **Layered PSD**: one Photoshop file with the background and the drawing as separate layers (plus a white *Paper* layer when the background is faded, and the scale bar on its own layer). Opens with its layers in Adobe Fresco, Photoshop (iPad and desktop), Affinity, Procreate, Krita and GIMP.
  - **Share…** (Draw tab and Result tab) opens the system share sheet, so on an iPad the file goes straight to Fresco, Photoshop, Photos, Files, Notes or Mail. *Send to app* picks what is sent: the layered PSD, the drawing on its background, the drawing alone, background and drawing as two PNGs, or the SVG. Where a browser cannot share files, the same files are saved instead.
- A built-in synthetic test stack, so the app shows a working example as soon as it opens.

## Method
1. **Alignment.** Small grayscale copies of the photos (about 1000 px wide) are used. Each photo is matched to its neighbour with a coarse-to-fine Gauss–Newton fit of a similarity transform. The fit uses zero-mean, unit-variance intensities (an ECC-style criterion), so blur and exposure differences do not bias it. Transforms are chained outward from the middle photo, then scaled to full resolution.
2. **Focus measure.** E = G_s * (∇²(G_1 * Y))², the locally smoothed energy of the Laplacian of Gaussian of luminance.
3. **Fusion.** The photos are processed one at a time, so memory use does not grow with the number of photos.
   - The pyramid method keeps, for each band and pixel, the coefficient with the highest local band energy. The coarsest level is averaged.
   - The depth-map method picks the photo with the highest E at each pixel.

## Benchmark
`node tests/test.js` runs a synthetic 8-slice stack with known depth, focus breathing and shake:

| | PSNR vs. ground truth |
|---|---|
| Best single photo | 18.9 dB |
| Plain average | 18.4 dB |
| Pyramid fusion, no alignment | 15.2 dB |
| **Pyramid fusion** | **26.1 dB** |
| Oracle (true depth known) | 26.0 dB |

Worst-case alignment error is 0.16 px.

## Development
- `src/engine.js` holds the image maths: plain typed arrays, no DOM. It runs in a Web Worker in the browser and under Node for the tests.
- `src/app.template.html` holds the user interface and the worker code.
- `src/psd.js` writes layered PSD files (8-bit RGB, PackBits). `node tests/psd.js out.psd && python3 tests/psd_check.py out.psd` checks it against psd-tools.
- `python3 build.py` inlines the engine and the PSD writer into the template and writes `index.html`.

## Limits
- Speed: about 2 s per photo at 6 MP and about 8 s per photo at 24 MP, on a single CPU core.
- Memory: about 1.2 GB for a 24 MP stack. Use the "Working size" setting for a quick preview first.
- Formats: RAW and TIFF must be converted to JPEG or PNG first. Output is 8-bit.
