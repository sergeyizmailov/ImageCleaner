# ImageCleaner

Browser-only tool that strips AI-image metadata, injects realistic camera EXIF, and disrupts diffusion-model fingerprints. Zero upload — everything runs locally in your browser.

**Open the app:** https://sergeyizmailov.github.io/ImageCleaner/

## What it does

Per-image pipeline (runs inside a Web Worker, won't freeze the UI):

1. **Strips all metadata** — EXIF, XMP, IPTC, C2PA manifests, PNG chunks, generator signatures
2. **Subtle resize** ±1% with high-quality bicubic interpolation — breaks pixel-aligned watermarks (SynthID-lite, PRNU residue)
3. **Low-pass filter** 0.3–0.5px Gaussian blur — destroys high-frequency diffusion artifacts (kills NPR detector)
4. **Color curve** ±1–2% contrast / brightness / saturation — simulates in-camera ISP processing
5. **Gaussian sensor noise** ±4–9 RGB with luminance-aware spatial coherence — adds realistic high-ISO noise character
6. **Single JPEG encode** at device-appropriate quality — phones use 0.96 / pro bodies 0.97
7. **Realistic EXIF injection** via piexifjs — Make, Model, Software, DateTime, Lens, ISO, Exposure, Aperture, FocalLength, ShutterSpeedValue (APEX), GPS-less but otherwise complete

## Camera profiles

14 verified 2025–2026 device profiles with multi-lens support, real software/firmware versions, and per-device filename conventions:

- **Apple** — iPhone 17 Pro Max, iPhone 17 Pro, iPhone 16 Pro Max, iPhone 16 Pro, iPhone 16 (iOS 26 / 18.x)
- **Samsung** — Galaxy S25 Ultra, Galaxy S25+, Galaxy S24 Ultra (One UI 7)
- **Google** — Pixel 9 Pro XL, Pixel 9 Pro
- **Xiaomi** — 15 Ultra (HyperOS 2)
- **Canon** — EOS R5 Mark II (firmware 1.2.0)
- **Sony** — α7 IV (firmware 6.01), α7R V

Filenames match each manufacturer's convention:

| Device | Pattern | Example |
|---|---|---|
| iPhone | `IMG_XXXX.JPG` | `IMG_4382.JPG` |
| Samsung | `YYYYMMDD_HHMMSS.jpg` | `20251114_164231.jpg` |
| Pixel | `PXL_YYYYMMDD_HHMMSSmmm.jpg` | `PXL_20251114_164231847.jpg` |
| Xiaomi | `IMG_YYYYMMDD_HHMMSS.jpg` | `IMG_20251114_164231.jpg` |
| Canon | `IMG_XXXX.JPG` | `IMG_2957.JPG` |
| Sony | `DSCXXXXX.JPG` | `DSC04782.JPG` |

Filename timestamp is synchronized with the EXIF `DateTimeOriginal` value — no inconsistency.

## Privacy

- **100% client-side** — images never leave your device
- **No analytics, no tracking, no telemetry**
- Three CDN scripts loaded over HTTPS on first open: [JSZip](https://stuk.github.io/jszip/), [FileSaver.js](https://github.com/eligrey/FileSaver.js), [piexifjs](https://github.com/hMatoba/piexifjs). After first cache, the page works fully offline.
- All processing happens in an inline Web Worker via `OffscreenCanvas` — your CPU, your RAM, your data

## What it does NOT bypass

Honest limits — this tool is not a silver bullet:

- **Google SynthID** (Imagen 3/4, Gemini, Nano Banana) — pixel-space watermark survives basic resize/JPEG. Defeating it requires diffusion re-rendering (img2img) or spectral adversarial attacks like UnMarker (IEEE S&P 2025), which can't run in a browser
- **JPEG quantization-table forensics** — `canvas.toBlob('image/jpeg')` always emits standard IJG QT. Forensic tools with QT databases (ExifTool `JPEGDigest`, Amped Authenticate, Forensically) recognize it as "browser/software output" regardless of EXIF claims. A real fix needs a WASM JPEG encoder (mozjpeg-wasm) capable of accepting a custom camera QT
- **Hive AI detector** — best-in-class commercial detector (~98% accuracy). Our pipeline lowers its confidence but does not guarantee a bypass on hard cases
- **Sensor PRNU** — real cameras leave a unique sensor-noise pattern. We add Gaussian noise but it's not a real device's PRNU. A PRNU-aware detector can still distinguish synthetic noise from real

For social-media posting, the pipeline is sufficient. For forensic-grade adversaries, it isn't.

## Tech

Vanilla JavaScript. No build step. No framework.

- **Web Worker** + **OffscreenCanvas** for non-blocking image processing
- **`createImageBitmap`** with EXIF orientation handling
- **Box-Muller transform** for true Gaussian noise distribution
- **Block-coherent spatial noise** (modulated by sensor-like sweet spots) — not flat random
- **Luminance-weighted noise intensity** — darker areas get more noise (high-ISO behavior)
- **APEX-correct shutter speed and aperture values** — `ShutterSpeedValue = -log₂(exposure)`, `ApertureValue = 2·log₂(F)`
- **Fraunces** (display) + **Onest** (UI) + **JetBrains Mono** (technical readouts)

## Run locally

Just open `index.html` in any modern browser. No server, no install.

```bash
git clone https://github.com/sergeyizmailov/ImageCleaner.git
cd ImageCleaner
open index.html   # macOS
# or just double-click in your file manager
```

Browser support: Chrome 88+, Firefox 105+, Safari 16.4+, Edge 88+. Requires `OffscreenCanvas`, `createImageBitmap`, `crypto.subtle`.

## Deploy to GitHub Pages

Settings → Pages → Source: `Deploy from a branch` → Branch: `main` / `(root)` → Save.

The site goes live at `https://<username>.github.io/<repo>/` within ~1 minute. Static files only — no build pipeline needed.

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

This tool is provided for educational and research purposes — privacy preservation, study of forensic detection mechanisms, removal of metadata from images you own. The author is not responsible for misuse. Don't break laws, don't deceive in contexts where deception causes harm.
