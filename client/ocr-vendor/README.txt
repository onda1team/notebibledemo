Tesseract.js 6.0.1; tesseract.js-core 6.0.0; Korean tessdata_fast LSTM model.

Only LSTM mode (OEM=1) is bundled. Both SIMD and non-SIMD core .wasm.js files contain embedded base64 WASM, so no separate .wasm downloads are needed. corePath must point to the core directory so feature detection selects the correct one. No legacy core or OSD model is provided.

Load /ocr-vendor/tesseract.min.js, then:
const base = new URL("./ocr-vendor/", location.href);
const worker = await Tesseract.createWorker("kor", 1, {
 workerPath: new URL("worker.min.js", base).href,
 corePath: new URL("core", base).href,
 langPath: new URL("lang", base).href,
 gzip: false,
 workerBlobURL: false,
 cacheMethod: "none",
 logger: (m) => console.log(m.status, m.progress)
});
const { data } = await worker.recognize(fileOrCanvas);
await worker.terminate();

All runtime assets are same-origin. cacheMethod none avoids language-model IndexedDB cache; app may choose write for performance. Images stay in browser worker provided app does not separately upload them. Requires WebAssembly and Workers. Real iOS/Android memory and camera behavior require device testing; this bundle alone is not a device certification. Serve over HTTPS.

Checksums and source integrity: SOURCES.json and SHA256SUMS.
Source API documentation: https://github.com/naptha/tesseract.js/blob/v6.0.1/docs/api.md
Core selection: https://github.com/naptha/tesseract.js/blob/v6.0.1/src/worker-script/browser/getCore.js
Licenses: Apache-2.0 files included separately; bundled third-party notices in *.LICENSE.txt.
