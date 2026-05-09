# ImageCleaner

Browser-only tool that strips AI-image metadata, injects realistic camera EXIF, and disrupts diffusion-model fingerprints. Nothing leaves your device.

**Open the app:** https://sergeyizmailov.github.io/ImageCleaner

## What it does

- Wipes EXIF, XMP, IPTC, C2PA, PNG chunks, generator signatures
- Injects EXIF from a verified 2025–2026 camera profile (iPhone 17/16 Pro, Galaxy S25 Ultra, Pixel 9 Pro, Xiaomi 15 Ultra, Canon R5 II, Sony α7 IV / α7R V)
- Subtle resize, low-pass blur, sensor noise, color curve, single JPEG encode at device-appropriate quality
- Filename, dimensions, timestamp, lens, ISO, exposure, aperture — all match the chosen device

## Privacy

100% client-side. No upload, no analytics, no telemetry. Three CDN scripts (JSZip, FileSaver, piexifjs) load on first open over HTTPS — after that the page works offline.

## Limits

- Doesn't bypass Google SynthID (needs diffusion re-rendering)
- Canvas JPEG quantization tables are still browser-flavored — forensic QT databases will spot it; full fix needs a WASM JPEG encoder
- Lowers Hive AI detector confidence but doesn't guarantee a bypass on hard cases

## Run locally

```bash
git clone https://github.com/sergeyizmailov/ImageCleaner.git
cd ImageCleaner
open index.html
```

Requires a modern browser (Chrome 88+, Firefox 105+, Safari 16.4+).

## License

MIT — see [LICENSE](LICENSE). For educational and research purposes.
