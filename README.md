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
- Before/after comparison slider, and a readout of the scale and shift corrected for each photo.
- Save the result (PNG or JPEG), the depth map, the aligned middle photo, or any single input photo.
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
- `python3 build.py` inlines the engine into the template and writes `index.html`.

## Limits
- Speed: about 2 s per photo at 6 MP and about 8 s per photo at 24 MP, on a single CPU core.
- Memory: about 1.2 GB for a 24 MP stack. Use the "Working size" setting for a quick preview first.
- Formats: RAW and TIFF must be converted to JPEG or PNG first. Output is 8-bit.
