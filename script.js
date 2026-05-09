/**
 * GhostImage — Privacy-First AI Trace Remover
 *
 * Pipeline per image (all in Web Worker / OffscreenCanvas):
 *   decode (EXIF-oriented) → subtle resize (±1%) → low-pass blur (0.3–0.5px)
 *   → color curve (contrast/brightness/saturate ±1–2%) → Gaussian sensor noise
 *   → JPEG encode q=0.96 → decode → JPEG encode q=0.93
 *   → (main thread) inject realistic camera EXIF via piexifjs
 */

// ============================================
// Configuration
// ============================================
const CONFIG = {
    maxFiles: 20,
    maxFileSize: 50 * 1024 * 1024,

    // Fallback JPEG quality. Real value comes from the selected camera profile
    // (phones: 0.92 / 4:2:0 · pro cameras: 0.96 / 4:4:4) — forensic consistency.
    jpegQuality: 0.92,

    // Subtle resize — breaks pixel-aligned watermarks (SynthID-lite, PRNU).
    resizeMin: 0.99,
    resizeMax: 1.01,

    // Low-pass filter — removes high-freq diffusion artifacts.
    blurMin: 0.3,
    blurMax: 0.5,

    // In-camera-like color processing.
    contrastMin: 1.00,
    contrastMax: 1.02,
    brightnessMin: 0.99,
    brightnessMax: 1.01,
    saturateMin: 0.99,
    saturateMax: 1.02,

    // Gaussian noise magnitude (±RGB). Stronger noise = more high-freq entropy
    // = less JPEG-compressible = bigger output file + more realistic sensor character.
    noiseMin: 4,
    noiseMax: 9,

    acceptedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
};

// ============================================
// Realistic Camera Profiles — verified from sampleshots.com, GSMArena,
// exiftool dumps, manufacturer firmware pages (2025-2026 data).
// Multi-lens structure: each lens has its own focal/aperture/35mm eq.
// ============================================
const CAMERA_PROFILES = [
    // ===== iPhone 17 Pro Max — iOS 26 (Sept 2025) =====
    {
        make: "Apple", model: "iPhone 17 Pro Max",
        softwareOptions: ["26.0", "26.0.1", "26.1", "26.1.1"],
        lenses: [
            { lensModel: "iPhone 17 Pro Max back triple camera 6.765mm f/1.78", focalLength: [6765, 1000], focal35mm: 24, fNumber: [178, 100] },
            { lensModel: "iPhone 17 Pro Max back triple camera 16.891mm f/2.8", focalLength: [16891, 1000], focal35mm: 100, fNumber: [28, 10] },
            { lensModel: "iPhone 17 Pro Max back triple camera 2.22mm f/2.2", focalLength: [222, 100], focal35mm: 13, fNumber: [22, 10] },
        ],
        isoOptions: [32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250],
        exposureOptions: [[1, 30], [1, 60], [1, 120], [1, 250], [1, 500], [1, 800], [1, 1000], [1, 1500], [1, 2000], [1, 3000]],
    },
    // ===== iPhone 17 Pro =====
    {
        make: "Apple", model: "iPhone 17 Pro",
        softwareOptions: ["26.0", "26.0.1", "26.1", "26.1.1"],
        lenses: [
            { lensModel: "iPhone 17 Pro back triple camera 6.765mm f/1.78", focalLength: [6765, 1000], focal35mm: 24, fNumber: [178, 100] },
            { lensModel: "iPhone 17 Pro back triple camera 16.891mm f/2.8", focalLength: [16891, 1000], focal35mm: 100, fNumber: [28, 10] },
            { lensModel: "iPhone 17 Pro back triple camera 2.22mm f/2.2", focalLength: [222, 100], focal35mm: 13, fNumber: [22, 10] },
        ],
        isoOptions: [32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000],
        exposureOptions: [[1, 30], [1, 60], [1, 120], [1, 250], [1, 500], [1, 1000], [1, 2000], [1, 3000]],
    },
    // ===== iPhone 16 Pro Max — iOS 18 =====
    {
        make: "Apple", model: "iPhone 16 Pro Max",
        softwareOptions: ["18.7.1", "18.7", "18.6.2", "18.6.1", "18.6", "18.5", "18.4.1", "18.4", "18.3.2", "18.3.1", "18.2.1", "18.2", "18.1.1"],
        lenses: [
            { lensModel: "iPhone 16 Pro Max back triple camera 6.765mm f/1.78", focalLength: [6765, 1000], focal35mm: 24, fNumber: [178, 100] },
            { lensModel: "iPhone 16 Pro Max back triple camera 15.66mm f/2.8", focalLength: [1566, 100], focal35mm: 120, fNumber: [28, 10] },
            { lensModel: "iPhone 16 Pro Max back triple camera 2.22mm f/2.2", focalLength: [222, 100], focal35mm: 13, fNumber: [22, 10] },
        ],
        isoOptions: [32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800],
        exposureOptions: [[1, 30], [1, 60], [1, 120], [1, 250], [1, 500], [1, 800], [1, 1000], [1, 1500], [1, 2000]],
    },
    // ===== iPhone 16 Pro =====
    {
        make: "Apple", model: "iPhone 16 Pro",
        softwareOptions: ["18.7.1", "18.7", "18.6.2", "18.6.1", "18.5", "18.4.1", "18.3.2", "18.3.1", "18.2.1", "18.2", "18.1.1"],
        lenses: [
            { lensModel: "iPhone 16 Pro back triple camera 6.765mm f/1.78", focalLength: [6765, 1000], focal35mm: 24, fNumber: [178, 100] },
            { lensModel: "iPhone 16 Pro back triple camera 15.66mm f/2.8", focalLength: [1566, 100], focal35mm: 120, fNumber: [28, 10] },
            { lensModel: "iPhone 16 Pro back triple camera 2.22mm f/2.2", focalLength: [222, 100], focal35mm: 13, fNumber: [22, 10] },
        ],
        isoOptions: [32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800],
        exposureOptions: [[1, 30], [1, 60], [1, 120], [1, 250], [1, 500], [1, 1000], [1, 2000]],
    },
    // ===== iPhone 16 (vanilla) =====
    {
        make: "Apple", model: "iPhone 16",
        softwareOptions: ["18.7", "18.6.2", "18.5", "18.4.1", "18.3.2", "18.2.1", "18.1.1"],
        lenses: [
            { lensModel: "iPhone 16 back dual wide camera 5.96mm f/1.6", focalLength: [596, 100], focal35mm: 26, fNumber: [16, 10] },
            { lensModel: "iPhone 16 back dual wide camera 2.22mm f/2.2", focalLength: [222, 100], focal35mm: 13, fNumber: [22, 10] },
        ],
        isoOptions: [32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400],
        exposureOptions: [[1, 30], [1, 60], [1, 120], [1, 250], [1, 500], [1, 1000]],
    },
    // ===== Samsung Galaxy S25 Ultra (SM-S938B, One UI 7) =====
    {
        make: "samsung", model: "SM-S938B",
        softwareOptions: ["S938BXXU1AYA1", "S938BXXU5BYI3", "S938BXXS7BYK3", "S938BXXS8BZB5"],
        lenses: [
            { lensModel: "", focalLength: [23, 10], focal35mm: 23, fNumber: [17, 10] },
            { lensModel: "", focalLength: [22, 10], focal35mm: 13, fNumber: [19, 10] },
            { lensModel: "", focalLength: [69, 10], focal35mm: 69, fNumber: [24, 10] },
            { lensModel: "", focalLength: [230, 10], focal35mm: 115, fNumber: [34, 10] },
        ],
        isoOptions: [50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 640, 800, 1000, 1600],
        exposureOptions: [[1, 30], [1, 60], [1, 100], [1, 200], [1, 400], [1, 800], [1, 1600], [1, 4650]],
    },
    // ===== Samsung Galaxy S25+ =====
    {
        make: "samsung", model: "SM-S936B",
        softwareOptions: ["S936BXXU1AYA1", "S936BXXU5BYI3", "S936BXXS7BYK3"],
        lenses: [
            { lensModel: "", focalLength: [24, 10], focal35mm: 24, fNumber: [18, 10] },
            { lensModel: "", focalLength: [22, 10], focal35mm: 13, fNumber: [22, 10] },
            { lensModel: "", focalLength: [69, 10], focal35mm: 67, fNumber: [24, 10] },
        ],
        isoOptions: [50, 64, 80, 100, 125, 160, 200, 320, 400, 640, 800, 1600],
        exposureOptions: [[1, 30], [1, 60], [1, 100], [1, 200], [1, 400], [1, 800]],
    },
    // ===== Samsung Galaxy S24 Ultra (SM-S928B) =====
    {
        make: "samsung", model: "SM-S928B",
        softwareOptions: ["S928BXXU1AXAD", "S928BXXU3BXDJ", "S928BXXU5BXJ1", "S928BXXU7CXJ2"],
        lenses: [
            { lensModel: "", focalLength: [23, 10], focal35mm: 24, fNumber: [17, 10] },
            { lensModel: "", focalLength: [22, 10], focal35mm: 13, fNumber: [22, 10] },
            { lensModel: "", focalLength: [69, 10], focal35mm: 67, fNumber: [24, 10] },
            { lensModel: "", focalLength: [230, 10], focal35mm: 120, fNumber: [34, 10] },
        ],
        isoOptions: [50, 64, 80, 100, 125, 160, 200, 400, 640, 800, 1600, 3200],
        exposureOptions: [[1, 30], [1, 60], [1, 100], [1, 200], [1, 400], [1, 800], [1, 1600]],
    },
    // ===== Google Pixel 9 Pro XL =====
    {
        make: "Google", model: "Pixel 9 Pro XL",
        softwareOptions: ["AD1A.240905.004", "AP3A.241005.015", "AP4A.241205.013.A2", "AP41.250305.002"],
        lenses: [
            { lensModel: "Pixel 9 Pro XL back camera 6.9mm f/1.68", focalLength: [69, 10], focal35mm: 25, fNumber: [168, 100] },
            { lensModel: "Pixel 9 Pro XL back camera 2.02mm f/1.7", focalLength: [202, 100], focal35mm: 15, fNumber: [17, 10] },
            { lensModel: "Pixel 9 Pro XL back camera 17.906mm f/2.8", focalLength: [17906, 1000], focal35mm: 113, fNumber: [28, 10] },
        ],
        isoOptions: [42, 55, 70, 90, 110, 135, 170, 220, 275, 350, 440, 560, 700],
        exposureOptions: [[1, 50], [1, 100], [1, 200], [1, 400], [1, 800], [1, 1600]],
    },
    // ===== Google Pixel 9 Pro =====
    {
        make: "Google", model: "Pixel 9 Pro",
        softwareOptions: ["AD1A.240905.004", "AP3A.241005.015", "AP4A.241205.013.A2"],
        lenses: [
            { lensModel: "Pixel 9 Pro back camera 6.9mm f/1.68", focalLength: [69, 10], focal35mm: 25, fNumber: [168, 100] },
            { lensModel: "Pixel 9 Pro back camera 2.02mm f/1.7", focalLength: [202, 100], focal35mm: 15, fNumber: [17, 10] },
            { lensModel: "Pixel 9 Pro back camera 17.906mm f/2.8", focalLength: [17906, 1000], focal35mm: 113, fNumber: [28, 10] },
        ],
        isoOptions: [42, 55, 70, 90, 110, 135, 170, 220, 275, 350, 440, 560],
        exposureOptions: [[1, 50], [1, 100], [1, 200], [1, 400], [1, 800], [1, 1600]],
    },
    // ===== Xiaomi 15 Ultra (HyperOS 2) =====
    {
        make: "Xiaomi", model: "Xiaomi 15 Ultra",
        softwareOptions: ["OS2.0.104.0.VOAEUXM", "OS2.0.120.0.VOACNXM", "OS2.0.200.0.WOACNXM"],
        lenses: [
            { lensModel: "", focalLength: [86, 10], focal35mm: 23, fNumber: [18, 10] },
            { lensModel: "", focalLength: [22, 10], focal35mm: 14, fNumber: [18, 10] },
            { lensModel: "", focalLength: [55, 10], focal35mm: 70, fNumber: [18, 10] },
            { lensModel: "", focalLength: [140, 10], focal35mm: 100, fNumber: [26, 10] },
        ],
        isoOptions: [50, 64, 80, 100, 125, 160, 200, 320, 400, 640, 800, 1600],
        exposureOptions: [[1, 30], [1, 60], [1, 100], [1, 200], [1, 400], [1, 800]],
    },
    // ===== Canon EOS R5 Mark II (firmware 1.2.0, Nov 2025) =====
    {
        make: "Canon", model: "Canon EOS R5 Mark II",
        softwareOptions: ["Firmware Version 1.2.0", "Firmware Version 1.1.1", "Firmware Version 1.0.2"],
        lenses: [
            { lensModel: "RF28-70mm F2 L USM", focalLength: [50, 1], focal35mm: 50, fNumber: [20, 10] },
            { lensModel: "RF24-70mm F2.8 L IS USM", focalLength: [35, 1], focal35mm: 35, fNumber: [28, 10] },
            { lensModel: "RF24-105mm F4 L IS USM", focalLength: [50, 1], focal35mm: 50, fNumber: [40, 10] },
            { lensModel: "RF50mm F1.2 L USM", focalLength: [50, 1], focal35mm: 50, fNumber: [12, 10] },
            { lensModel: "RF70-200mm F2.8 L IS USM", focalLength: [135, 1], focal35mm: 135, fNumber: [28, 10] },
            { lensModel: "RF135mm F1.8 L IS USM", focalLength: [135, 1], focal35mm: 135, fNumber: [18, 10] },
            { lensModel: "RF15-35mm F2.8 L IS USM", focalLength: [24, 1], focal35mm: 24, fNumber: [28, 10] },
            { lensModel: "RF100-500mm F4.5-7.1 L IS USM", focalLength: [300, 1], focal35mm: 300, fNumber: [56, 10] },
        ],
        isoOptions: [100, 200, 400, 800, 1600, 3200, 6400, 12800],
        exposureOptions: [[1, 60], [1, 125], [1, 250], [1, 500], [1, 1000], [1, 2000], [1, 4000], [1, 8000]],
    },
    // ===== Sony A7 IV (firmware 6.01, Jan 2026) =====
    {
        make: "SONY", model: "ILCE-7M4",
        softwareOptions: ["6.01", "6.00", "5.00", "4.01"],
        lenses: [
            { lensModel: "FE 24-70mm F2.8 GM II", focalLength: [50, 1], focal35mm: 50, fNumber: [28, 10] },
            { lensModel: "FE 70-200mm F2.8 GM OSS II", focalLength: [135, 1], focal35mm: 135, fNumber: [28, 10] },
            { lensModel: "FE 85mm F1.4 GM", focalLength: [85, 1], focal35mm: 85, fNumber: [14, 10] },
            { lensModel: "FE 50mm F1.2 GM", focalLength: [50, 1], focal35mm: 50, fNumber: [12, 10] },
            { lensModel: "FE 35mm F1.4 GM", focalLength: [35, 1], focal35mm: 35, fNumber: [14, 10] },
            { lensModel: "FE 24-105mm F4 G OSS", focalLength: [50, 1], focal35mm: 50, fNumber: [40, 10] },
        ],
        isoOptions: [100, 200, 400, 800, 1600, 3200, 6400, 12800],
        exposureOptions: [[1, 60], [1, 125], [1, 250], [1, 500], [1, 1000], [1, 2000]],
    },
    // ===== Sony A7R V =====
    {
        make: "SONY", model: "ILCE-7RM5",
        softwareOptions: ["2.00", "1.12", "1.10"],
        lenses: [
            { lensModel: "FE 24-70mm F2.8 GM II", focalLength: [50, 1], focal35mm: 50, fNumber: [28, 10] },
            { lensModel: "FE 85mm F1.4 GM", focalLength: [85, 1], focal35mm: 85, fNumber: [14, 10] },
            { lensModel: "FE 50mm F1.2 GM", focalLength: [50, 1], focal35mm: 50, fNumber: [12, 10] },
            { lensModel: "FE 70-200mm F2.8 GM OSS II", focalLength: [135, 1], focal35mm: 135, fNumber: [28, 10] },
        ],
        isoOptions: [100, 200, 400, 800, 1600, 3200, 6400],
        exposureOptions: [[1, 60], [1, 125], [1, 250], [1, 500], [1, 1000], [1, 2000], [1, 4000]],
    },
];

// ============================================
// Worker Source (inline — avoids CORS on file://)
// ============================================
const WORKER_SOURCE = `
function gaussianRandom(mean, stdDev) {
    let u1 = Math.random();
    if (u1 < 1e-10) u1 = 1e-10;
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z * stdDev + mean;
}

function spatialHash(x, y, seed) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    return n - Math.floor(n);
}

function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

function addNoise(ctx, width, height, baseIntensity, seed) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const blockSize = 4 + Math.floor(spatialHash(0, 0, seed) * 5);
    let pixelsModified = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;

            const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
            const lumMult = 1.5 - (lum * 0.8); // darker → more noise (high-ISO behavior)

            const blockX = Math.floor(x / blockSize);
            const blockY = Math.floor(y / blockSize);

            // Block-level intensity modulation (0.5–1.5×) — spatial coherence
            const blockMult = 0.5 + spatialHash(blockX, blockY, seed) * 1.0;

            // Block-level kill-switch: ~20% blocks receive no noise (sensor sweet spots)
            if (spatialHash(blockX, blockY, seed + 7777) < 0.2) continue;

            // Per-pixel probability ~50%
            if (Math.random() < 0.5) {
                pixelsModified++;
                const stdDev = baseIntensity * lumMult * blockMult;
                const baseNoise = gaussianRandom(0, stdDev * 0.6);
                for (let c = 0; c < 3; c++) {
                    const channelNoise = gaussianRandom(0, stdDev * 0.4);
                    data[i + c] = clamp255(data[i + c] + Math.round(baseNoise + channelNoise));
                }
            }
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return pixelsModified;
}

async function computeHash(ctx, width, height) {
    const data = ctx.getImageData(0, 0, width, height).data;
    let s = '';
    for (let i = 0; i < data.length; i += 400) s += data[i].toString(16);
    const buf = new TextEncoder().encode(s);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).slice(0, 6)
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

async function processImage(buffer, mimeType, opts) {
    const srcBlob = new Blob([buffer], { type: mimeType });
    const bitmap = await createImageBitmap(srcBlob, { imageOrientation: 'from-image' });

    const newW = Math.max(1, Math.round(bitmap.width * opts.resizeFactor));
    const newH = Math.max(1, Math.round(bitmap.height * opts.resizeFactor));

    // Pass 1: resize with high-quality interpolation
    const canvasA = new OffscreenCanvas(newW, newH);
    const ctxA = canvasA.getContext('2d');
    ctxA.imageSmoothingEnabled = true;
    ctxA.imageSmoothingQuality = 'high';
    // PNGs with alpha: flatten on white so JPEG output isn't black
    ctxA.fillStyle = '#ffffff';
    ctxA.fillRect(0, 0, newW, newH);
    ctxA.drawImage(bitmap, 0, 0, newW, newH);
    bitmap.close();

    // Pass 2: apply blur + color curve via canvas filter
    const canvasB = new OffscreenCanvas(newW, newH);
    const ctxB = canvasB.getContext('2d');
    ctxB.filter =
        'blur(' + opts.blur + 'px) ' +
        'contrast(' + opts.contrast + ') ' +
        'brightness(' + opts.brightness + ') ' +
        'saturate(' + opts.saturate + ')';
    ctxB.drawImage(canvasA, 0, 0);
    ctxB.filter = 'none';

    const originalHash = await computeHash(ctxB, newW, newH);

    // Pass 3: Gaussian sensor noise
    const pixelsModified = addNoise(ctxB, newW, newH, opts.noiseIntensity, opts.noiseSeed);

    const newHash = await computeHash(ctxB, newW, newH);

    // Pass 4: single JPEG encode — matches real camera (one JPEG pass from RAW).
    // Avoids double-compression forensic traces and keeps file size realistic.
    const outBlob = await canvasB.convertToBlob({ type: 'image/jpeg', quality: opts.jpegQuality });
    const outBuffer = await outBlob.arrayBuffer();

    return {
        buffer: outBuffer,
        width: newW,
        height: newH,
        pixelsModified,
        originalHash,
        newHash,
    };
}

self.onmessage = async (e) => {
    const { id, buffer, mimeType, opts } = e.data;
    try {
        const result = await processImage(buffer, mimeType, opts);
        self.postMessage({ id, ok: true, result }, [result.buffer]);
    } catch (err) {
        self.postMessage({ id, ok: false, error: err.message || String(err) });
    }
};
`;

// ============================================
// DOM Elements
// ============================================
const elements = {
    uploadZone: document.getElementById('uploadZone'),
    fileInput: document.getElementById('fileInput'),
    uploadSection: document.getElementById('uploadSection'),
    processingSection: document.getElementById('processingSection'),
    resultsSection: document.getElementById('resultsSection'),
    processingStatus: document.getElementById('processingStatus'),
    progressBar: document.getElementById('progressBar'),
    processedCount: document.getElementById('processedCount'),
    totalCount: document.getElementById('totalCount'),
    resultsSummary: document.getElementById('resultsSummary'),
    resultsGrid: document.getElementById('resultsGrid'),
    downloadAllBtn: document.getElementById('downloadAllBtn'),
    processMoreBtn: document.getElementById('processMoreBtn'),
    cameraProfileSelect: document.getElementById('cameraProfileSelect'),
    profileInfoTier: document.getElementById('profileInfoTier'),
    profileInfoQuality: document.getElementById('profileInfoQuality'),
    profileInfoChroma: document.getElementById('profileInfoChroma'),
    profileInfoLenses: document.getElementById('profileInfoLenses'),
    profileInfoSize: document.getElementById('profileInfoSize'),
};

// ============================================
// State
// ============================================
let processedImages = [];
let worker = null;
let workerMsgId = 0;
const workerPending = new Map();

// ============================================
// Worker lifecycle
// ============================================
function getWorker() {
    if (worker) return worker;
    const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
    worker = new Worker(URL.createObjectURL(blob));
    worker.onmessage = (e) => {
        const { id, ok, result, error } = e.data;
        const p = workerPending.get(id);
        if (!p) return;
        workerPending.delete(id);
        if (ok) p.resolve(result); else p.reject(new Error(error));
    };
    worker.onerror = (e) => {
        console.error('Worker error:', e.message);
    };
    return worker;
}

function runInWorker(buffer, mimeType, opts) {
    const w = getWorker();
    return new Promise((resolve, reject) => {
        const id = ++workerMsgId;
        workerPending.set(id, { resolve, reject });
        w.postMessage({ id, buffer, mimeType, opts }, [buffer]);
    });
}

// ============================================
// Init
// ============================================
function init() {
    populateCameraProfileSelector();
    setupEventListeners();
    setupUploadZoneEffects();
    updateProfileInfo();
}

function populateCameraProfileSelector() {
    const sel = elements.cameraProfileSelect;
    if (!sel) return;
    const groups = {};
    CAMERA_PROFILES.forEach((profile, index) => {
        const key = brandLabel(profile.make);
        if (!groups[key]) groups[key] = [];
        groups[key].push({ index, model: profile.model });
    });
    const order = ['Apple', 'Samsung', 'Google', 'Xiaomi', 'Canon', 'Sony'];
    order.forEach(brand => {
        if (!groups[brand]) return;
        const og = document.createElement('optgroup');
        og.label = brand;
        groups[brand].forEach(({ index, model }) => {
            const opt = document.createElement('option');
            opt.value = String(index);
            opt.textContent = model;
            og.appendChild(opt);
        });
        sel.appendChild(og);
    });
}

function brandLabel(make) {
    const m = make.toLowerCase();
    if (m === 'apple') return 'Apple';
    if (m === 'samsung') return 'Samsung';
    if (m === 'google') return 'Google';
    if (m === 'xiaomi') return 'Xiaomi';
    if (m === 'canon') return 'Canon';
    if (m === 'sony') return 'Sony';
    return make;
}

function getSelectedProfile() {
    const sel = elements.cameraProfileSelect;
    const idx = sel ? parseInt(sel.value, 10) : 0;
    return CAMERA_PROFILES[idx] || CAMERA_PROFILES[0];
}

function updateProfileInfo() {
    const profile = getSelectedProfile();
    if (!profile || !elements.profileInfoTier) return;
    const isPhone = new Set(['Apple', 'samsung', 'Google', 'Xiaomi']).has(profile.make);
    const quality = qualityForProfile(profile);
    const chroma = quality >= 0.96 ? '4:4:4' : '4:2:0';
    const tier = isPhone ? 'Smartphone' : 'Pro camera';
    const sizeEst = isPhone ? '~1 – 1.8 MB' : '~2 – 3 MB';

    elements.profileInfoTier.textContent = tier;
    elements.profileInfoQuality.textContent = Math.round(quality * 100) + '%';
    elements.profileInfoChroma.textContent = chroma;
    elements.profileInfoLenses.textContent = profile.lenses.length + (profile.lenses.length === 1 ? ' lens' : ' lenses');
    elements.profileInfoSize.textContent = sizeEst;

    elements.profileInfoQuality.classList.toggle('accent', !isPhone);
    elements.profileInfoChroma.classList.toggle('accent', !isPhone);
}

function setupEventListeners() {
    elements.uploadZone.addEventListener('click', () => elements.fileInput.click());
    elements.fileInput.addEventListener('change', handleFileSelect);
    elements.uploadZone.addEventListener('dragover', handleDragOver);
    elements.uploadZone.addEventListener('dragleave', handleDragLeave);
    elements.uploadZone.addEventListener('drop', handleDrop);
    elements.downloadAllBtn.addEventListener('click', downloadAllAsZip);
    elements.processMoreBtn.addEventListener('click', resetToUpload);
    if (elements.cameraProfileSelect) {
        elements.cameraProfileSelect.addEventListener('change', updateProfileInfo);
    }
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
}

function setupUploadZoneEffects() {
    elements.uploadZone.addEventListener('mousemove', (e) => {
        const rect = elements.uploadZone.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        elements.uploadZone.style.setProperty('--mouse-x', `${x}%`);
        elements.uploadZone.style.setProperty('--mouse-y', `${y}%`);
    });
}

// ============================================
// Drag & Drop
// ============================================
function handleDragOver(e) {
    e.preventDefault(); e.stopPropagation();
    elements.uploadZone.classList.add('drag-over');
}
function handleDragLeave(e) {
    e.preventDefault(); e.stopPropagation();
    elements.uploadZone.classList.remove('drag-over');
}
function handleDrop(e) {
    e.preventDefault(); e.stopPropagation();
    elements.uploadZone.classList.remove('drag-over');
    processFiles(Array.from(e.dataTransfer.files));
}
function handleFileSelect(e) {
    processFiles(Array.from(e.target.files));
    e.target.value = '';
}

// ============================================
// File Processing
// ============================================
function processFiles(files) {
    const valid = files.filter(f => {
        if (!CONFIG.acceptedTypes.includes(f.type)) return false;
        if (f.size > CONFIG.maxFileSize) return false;
        return true;
    });

    const toProcess = valid.slice(0, CONFIG.maxFiles);
    if (toProcess.length === 0) {
        alert('No valid images found. Please upload JPG, PNG, WebP, or AVIF files under 50MB.');
        return;
    }
    if (valid.length > CONFIG.maxFiles) {
        alert(`Processing first ${CONFIG.maxFiles} images. You can process more afterward.`);
    }
    startProcessing(toProcess);
}

async function startProcessing(files) {
    processedImages = [];
    elements.uploadSection.classList.add('hidden');
    elements.resultsSection.classList.remove('active');
    elements.processingSection.classList.add('active');

    elements.totalCount.textContent = files.length;
    elements.processedCount.textContent = '0';
    elements.progressBar.style.width = '0%';
    elements.processingStatus.textContent = 'Starting...';

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        elements.processingStatus.textContent = `Processing: ${file.name}`;
        try {
            const result = await processImage(file);
            processedImages.push(result);
        } catch (err) {
            console.error(`Error processing ${file.name}:`, err);
        }
        elements.progressBar.style.width = `${((i + 1) / files.length) * 100}%`;
        elements.processedCount.textContent = i + 1;
    }

    elements.processingStatus.textContent = 'Complete!';
    await sleep(400);
    showResults();
}

async function processImage(file) {
    const buffer = await file.arrayBuffer();

    const chosen = getSelectedProfile();
    const jpegQuality = qualityForProfile(chosen);

    const opts = {
        resizeFactor: randRange(CONFIG.resizeMin, CONFIG.resizeMax),
        blur: randRange(CONFIG.blurMin, CONFIG.blurMax),
        contrast: randRange(CONFIG.contrastMin, CONFIG.contrastMax),
        brightness: randRange(CONFIG.brightnessMin, CONFIG.brightnessMax),
        saturate: randRange(CONFIG.saturateMin, CONFIG.saturateMax),
        noiseIntensity: randRange(CONFIG.noiseMin, CONFIG.noiseMax),
        noiseSeed: Math.random() * 10000,
        jpegQuality,
    };

    const result = await runInWorker(buffer, file.type, opts);
    let outBlob = new Blob([result.buffer], { type: 'image/jpeg' });

    // Shared photo context — same date feeds both EXIF timestamps and filename
    const photoCtx = generatePhotoContext();

    // Inject fake EXIF (main thread — piexifjs)
    try {
        outBlob = await injectFakeExif(outBlob, result.width, result.height, chosen, photoCtx);
    } catch (err) {
        console.warn('EXIF injection failed, keeping clean JPEG:', err);
    }

    return {
        originalName: file.name,
        newName: filenameForProfile(chosen, photoCtx),
        originalSize: file.size,
        newSize: outBlob.size,
        blob: outBlob,
        width: result.width,
        height: result.height,
        pixelsModified: result.pixelsModified,
        originalHash: result.originalHash,
        newHash: result.newHash,
        profileModel: chosen.model,
        jpegQuality,
    };
}

// Canvas IJG encoder is less efficient than Apple/Samsung native encoders — at "same"
// quality number, canvas produces noticeably smaller files. To match real-device file
// size, we bump the quality number; the resulting file weight lands in phone-typical range.
// Trade-off: at 0.96+ canvas may switch to 4:4:4 chroma (vs phone's 4:2:0) — a minor
// forensic mismatch invisible to humans and bypassed by most AI detectors.
function qualityForProfile(profile) {
    const phoneBrands = new Set(['Apple', 'samsung', 'Google', 'Xiaomi']);
    return phoneBrands.has(profile.make) ? 0.96 : 0.97;
}

// ============================================
// Fake EXIF Injection
// ============================================
async function injectFakeExif(blob, width, height, profile, ctx) {
    if (typeof piexif === 'undefined') throw new Error('piexifjs not loaded');

    const dataUrl = await blobToDataUrl(blob);
    const exifObj = buildExifObject(profile, width, height, ctx);
    const exifBytes = piexif.dump(exifObj);
    const newDataUrl = piexif.insert(exifBytes, dataUrl);
    return dataUrlToBlob(newDataUrl);
}

function generatePhotoContext() {
    const daysBack = randInt(1, 180);
    const date = new Date(Date.now() - daysBack * 86400000);
    date.setHours(randInt(8, 21), randInt(0, 59), randInt(0, 59));
    return {
        date,
        subSec: String(randInt(0, 999)).padStart(3, '0'),
    };
}

function buildExifObject(profile, width, height, ctx) {
    const dateStr = formatExifDate(ctx.date);
    const subSec = ctx.subSec;

    const software = pickRandom(profile.softwareOptions);
    const lens = pickRandom(profile.lenses);
    const iso = pickRandom(profile.isoOptions);
    const exposure = pickRandom(profile.exposureOptions);

    const zeroth = {};
    zeroth[piexif.ImageIFD.Make] = profile.make;
    zeroth[piexif.ImageIFD.Model] = profile.model;
    zeroth[piexif.ImageIFD.Software] = software;
    zeroth[piexif.ImageIFD.DateTime] = dateStr;
    zeroth[piexif.ImageIFD.Orientation] = 1;
    zeroth[piexif.ImageIFD.XResolution] = [72, 1];
    zeroth[piexif.ImageIFD.YResolution] = [72, 1];
    zeroth[piexif.ImageIFD.ResolutionUnit] = 2;
    zeroth[piexif.ImageIFD.YCbCrPositioning] = 1;

    const exif = {};
    exif[piexif.ExifIFD.DateTimeOriginal] = dateStr;
    exif[piexif.ExifIFD.DateTimeDigitized] = dateStr;
    exif[piexif.ExifIFD.SubSecTime] = subSec;
    exif[piexif.ExifIFD.SubSecTimeOriginal] = subSec;
    exif[piexif.ExifIFD.SubSecTimeDigitized] = subSec;
    exif[piexif.ExifIFD.ExposureTime] = exposure;
    exif[piexif.ExifIFD.FNumber] = lens.fNumber;
    exif[piexif.ExifIFD.ISOSpeedRatings] = iso;
    exif[piexif.ExifIFD.ExposureProgram] = 2;
    exif[piexif.ExifIFD.ExifVersion] = "0232";
    exif[piexif.ExifIFD.ComponentsConfiguration] = "\x01\x02\x03\x00";
    exif[piexif.ExifIFD.ShutterSpeedValue] = apexFromExposure(exposure);
    exif[piexif.ExifIFD.ApertureValue] = apexFromFNumber(lens.fNumber);
    exif[piexif.ExifIFD.BrightnessValue] = [randInt(-200, 900), 100];
    exif[piexif.ExifIFD.ExposureBiasValue] = [0, 10];
    exif[piexif.ExifIFD.MeteringMode] = pickRandom([2, 3, 5, 6]);
    exif[piexif.ExifIFD.Flash] = 16;
    exif[piexif.ExifIFD.FocalLength] = lens.focalLength;
    exif[piexif.ExifIFD.ColorSpace] = 1;
    exif[piexif.ExifIFD.PixelXDimension] = width;
    exif[piexif.ExifIFD.PixelYDimension] = height;
    exif[piexif.ExifIFD.SensingMethod] = 2;
    exif[piexif.ExifIFD.WhiteBalance] = 0;
    exif[piexif.ExifIFD.FocalLengthIn35mmFilm] = lens.focal35mm;
    exif[piexif.ExifIFD.SceneCaptureType] = 0;
    exif[piexif.ExifIFD.CustomRendered] = 0;
    exif[piexif.ExifIFD.ExposureMode] = 0;
    if (lens.lensModel) exif[piexif.ExifIFD.LensModel] = lens.lensModel;
    exif[piexif.ExifIFD.LensMake] = profile.make;

    return { "0th": zeroth, "Exif": exif };
}

function apexFromExposure(r) {
    const t = r[0] / r[1];
    const apex = -Math.log2(t);
    return [Math.round(apex * 100), 100];
}
function apexFromFNumber(r) {
    const f = r[0] / r[1];
    const apex = 2 * Math.log2(f);
    return [Math.round(apex * 100), 100];
}
function formatExifDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
// Per-device filename convention matching how each manufacturer's stock camera app names files.
// Uses the same date from photoCtx so filename timestamp = EXIF DateTimeOriginal.
function filenameForProfile(profile, ctx) {
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const d = ctx.date;
    const Y = d.getFullYear();
    const M = pad(d.getMonth() + 1);
    const D = pad(d.getDate());
    const h = pad(d.getHours());
    const m = pad(d.getMinutes());
    const s = pad(d.getSeconds());
    const stamp = `${Y}${M}${D}_${h}${m}${s}`;
    const brand = profile.make.toLowerCase();

    // iPhone → IMG_1234.JPG (Apple uses uppercase extension in Photos app exports)
    if (brand === 'apple') return `IMG_${randInt(1000, 9999)}.JPG`;

    // Samsung Galaxy → 20250415_143022.jpg
    if (brand === 'samsung') return `${stamp}.jpg`;

    // Google Pixel → PXL_20250415_143022123.jpg (timestamp + milliseconds)
    if (brand === 'google') return `PXL_${stamp}${ctx.subSec}.jpg`;

    // Xiaomi → IMG_20250415_143022.jpg
    if (brand === 'xiaomi') return `IMG_${stamp}.jpg`;

    // Canon DSLR → IMG_1234.JPG (4-digit rolling counter)
    if (brand === 'canon') return `IMG_${randInt(1000, 9999)}.JPG`;

    // Sony α → DSC00123.JPG (5-digit counter, DSC prefix)
    if (brand === 'sony') return `DSC${pad(randInt(0, 99999), 5)}.JPG`;

    return `IMG_${randInt(1000, 9999)}.JPG`;
}

// ============================================
// Results Display
// ============================================
function showResults() {
    elements.processingSection.classList.remove('active');
    elements.resultsSection.classList.add('active');

    const totalOrig = processedImages.reduce((s, i) => s + i.originalSize, 0);
    const totalNew = processedImages.reduce((s, i) => s + i.newSize, 0);
    const savingsPercent = totalOrig > 0 ? (((totalOrig - totalNew) / totalOrig) * 100).toFixed(1) : '0.0';
    const totalPixels = processedImages.reduce((s, i) => s + (i.pixelsModified || 0), 0);

    elements.resultsSummary.innerHTML = `
        <div class="summary-card slide-up" style="animation-delay: 0.1s">
            <div class="summary-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </div>
            <div class="summary-value">${processedImages.length}</div>
            <div class="summary-label">Images<br>Processed</div>
        </div>
        <div class="summary-card slide-up" style="animation-delay: 0.2s">
            <div class="summary-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                </svg>
            </div>
            <div class="summary-value">${savingsPercent}%</div>
            <div class="summary-label">Size<br>Delta</div>
        </div>
        <div class="summary-card slide-up" style="animation-delay: 0.3s">
            <div class="summary-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
            </div>
            <div class="summary-value">${formatPixelCount(totalPixels)}</div>
            <div class="summary-label">Pixels<br>Modified</div>
        </div>
        <div class="summary-card slide-up" style="animation-delay: 0.4s">
            <div class="summary-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <circle cx="12" cy="12" r="6"/>
                    <circle cx="12" cy="12" r="2"/>
                </svg>
            </div>
            <div class="summary-value">${Math.round((processedImages[0]?.jpegQuality ?? CONFIG.jpegQuality) * 100)}%</div>
            <div class="summary-label">JPEG<br>Quality</div>
        </div>
    `;

    elements.resultsGrid.innerHTML = `
        <div class="file-details-section">
            <h3 class="file-details-title">File Details</h3>
            <div class="file-details-grid">
            ${processedImages.map((img, index) => `
                <div class="file-detail-card" style="animation-delay: ${0.1 + index * 0.05}s">
                    <div class="file-detail-header">
                        <span class="file-name-transform">${escapeHtml(img.originalName)} → ${img.newName}</span>
                        <button class="btn btn-ghost btn-sm" onclick="downloadImage(${index})">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                        </button>
                    </div>
                    <div class="file-detail-info">
                        <div class="detail-item detail-success">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                                <polyline points="22 4 12 14.01 9 11.01"/>
                            </svg>
                            EXIF spoofed as ${escapeHtml(img.profileModel || 'camera')}
                        </div>
                        <div class="detail-item">
                            <span class="detail-hash">#</span>
                            Hash: ${img.originalHash} → ${img.newHash}
                        </div>
                        <div class="detail-item">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <line x1="9" y1="3" x2="9" y2="21"/>
                            </svg>
                            Dimensions: ${img.width}×${img.height}
                        </div>
                        <div class="detail-item">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                            </svg>
                            Size: ${formatFileSize(img.originalSize)} → ${formatFileSize(img.newSize)}
                        </div>
                    </div>
                </div>
            `).join('')}
            </div>
        </div>
    `;
}

// ============================================
// Downloads
// ============================================
function downloadImage(index) {
    const img = processedImages[index];
    saveAs(img.blob, img.newName);
}

async function downloadAllAsZip() {
    if (processedImages.length === 0) return;
    const btn = elements.downloadAllBtn;
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
            <circle cx="12" cy="12" r="10" opacity="0.3"/>
            <path d="M12 2a10 10 0 0 1 10 10"/>
        </svg>
        Creating ZIP...
    `;
    try {
        const zip = new JSZip();
        const folder = zip.folder('ghostimage_cleaned');
        processedImages.forEach((img) => folder.file(img.newName, img.blob));
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const timestamp = new Date().toISOString().slice(0, 10);
        saveAs(zipBlob, `ghostimage_${timestamp}.zip`);
    } catch (err) {
        console.error('Error creating ZIP:', err);
        alert('Error creating ZIP. Download images individually instead.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

function resetToUpload() {
    processedImages = [];
    elements.resultsSection.classList.remove('active');
    elements.processingSection.classList.remove('active');
    elements.uploadSection.classList.remove('hidden');
    elements.resultsGrid.innerHTML = '';
    elements.resultsSummary.innerHTML = '';
}

// ============================================
// Utilities
// ============================================
function randRange(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('blob→dataURL failed'));
        reader.readAsDataURL(blob);
    });
}

function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatPixelCount(count) {
    if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'm';
    if (count >= 1000) return Math.round(count / 1000) + 'k';
    return String(count);
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

window.downloadImage = downloadImage;
document.addEventListener('DOMContentLoaded', init);
