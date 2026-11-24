(() => {
  'use strict';
  // Runtime assets are the verified Open Book bundle. Only local Blob/canvas pixels
  // enter the OCR Worker. No remote image URL, outbound API, or persistent OCR cache.
  const assetBase = new URL('./ocr-vendor/', document.currentScript?.src || document.baseURI);
  const asset = name => new URL(name, assetBase).href;
  const MAX_BYTES = 24_000_000;
  const MAX_EDGE = 1800;
  const OCR_TIMEOUT = 120_000;
  const GROUP_MARK = /^[\s▶▷►▸◆◇■□●○▪–—:>*#·ㆍ|]+/u;
  const BODY_HEADING = /^(?:본문\s*나눔(?:\s*질문)?)[\s:.]*$/u;
  const PRACTICE_HEADING = /^(?:결단\s*(?:하기|질문)|적용\s*(?:하기|질문))[\s:.]*$/u;
  const NUMBERED = /^(?:(?:[Qq]|문항|질문)\s*)?\(?([0-9]{1,2})\s*[.)、:]/u;
  const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮';
  let libraryPromise;

  function library() {
    if (!libraryPromise) {
      libraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = asset('tesseract.min.js');
        script.onload = () => {
          if (typeof window.Tesseract?.createWorker === 'function') resolve(window.Tesseract);
          else { script.remove(); reject(new Error('한글 인식 도구를 준비하지 못했어요.')); }
        };
        script.onerror = () => { script.remove(); reject(new Error('한글 인식 파일을 불러오지 못했어요.')); };
        document.head.append(script);
      }).catch(error => { libraryPromise = null; throw error; });
    }
    return libraryPromise;
  }

  function decodeBlob(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const image = new Image();
      const fail = () => reject(new Error('사진을 열 수 없어요. JPG 또는 PNG 사진을 골라 주세요.'));
      reader.onerror = reader.onabort = image.onerror = fail;
      image.onload = () => resolve(image);
      // A data URL is only read by a local image decoder, not by fetch or form POST.
      reader.onload = () => { image.src = reader.result; };
      reader.readAsDataURL(blob);
    });
  }

  function boundedCanvas(image) {
    const w = image.naturalWidth || image.width;
    const h = image.naturalHeight || image.height;
    if (!w || !h) throw new Error('읽을 사진이 없어요.');
    const ratio = Math.min(2, MAX_EDGE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * ratio));
    canvas.height = Math.max(1, Math.round(h * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('이 기기에서 사진을 준비하지 못했어요.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function questionCoverage(raw) {
    let section = '', ordered = false, hasHeading = false;
    const numbers = {body:[], practice:[]};
    for (const source of raw.split('\n')) {
      const unmarked = source.trim().replace(GROUP_MARK, '');
      const line = unmarked.normalize('NFKC');
      if (BODY_HEADING.test(line)) { section = 'body'; hasHeading = true; }
      else if (PRACTICE_HEADING.test(line)) {
        ordered ||= section === 'body' && numbers.body.length > 0;
        section = 'practice'; hasHeading = true;
      } else if (section) {
        const n = (unmarked[0] ? CIRCLED.indexOf(unmarked[0]) + 1 : 0) || Number(NUMBERED.exec(line)?.[1]);
        if (n >= 1 && n <= 30) numbers[section].push(n);
      }
    }
    const parsed = window.YeoBulletinQuestions?.extract?.(raw);
    const grouped = parsed?.filter(q => /^(?:본문나눔|결단하기|적용하기)\s/u.test(q)).length
      ?? new Set(numbers.body).size + new Set(numbers.practice).size;
    const count = parsed?.length ?? grouped;
    const consecutive = group => group.length > 0 && group.every((n, i) => n === i + 1);
    const coherent = ordered && consecutive(numbers.body) && consecutive(numbers.practice);
    const complete = coherent && grouped === numbers.body.length + numbers.practice.length;
    // Prefer useful prompts over raw text length; long spurious side columns are
    // common in handheld photos. Do not merge candidates (duplicated questions).
    return {count, hasHeading, complete, score: count * 3 + grouped * 5 + (complete ? 4 : 0)};
  }

  function cropRegion(source, bounds) {
    const [left, top, spanX, spanY] = bounds;
    const x = Math.round(source.width * left), y = Math.round(source.height * top);
    const width = Math.round(source.width * spanX), height = Math.round(source.height * spanY);
    if (!width || !height) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.width = canvas.height = 0; return null; }
    ctx.drawImage(source, x, y, width, height, 0, 0, width, height);
    return canvas;
  }

  function hasSurroundings(source) {
    // Sample a few small patches, not a full extra frame. A light, neutral
    // page center with darker or more colorful outer patches suggests a photo
    // with background outside the main sheet, rather than a flat scan.
    const ctx = source.getContext('2d');
    if (!ctx?.getImageData || source.width < 80 || source.height < 80) return false;
    const size = Math.max(2, Math.round(Math.min(source.width, source.height) * 0.032));
    const ink = (x, y) => {
      const p = ctx.getImageData(Math.round(source.width * x - size / 2), Math.round(source.height * y - size / 2), size, size).data;
      let dark = 0;
      for (let i = 0; i < p.length; i += 4) {
        const r = p[i], g = p[i+1], b = p[i+2];
        if (r + g + b < 375 || Math.max(r,g,b) - Math.min(r,g,b) > 32) dark++;
      }
      return 4 * dark / p.length;
    };
    const center = [0.3, 0.56, 0.83].map(y => ink(0.5,y));
    const outside = [0.13, 0.36, 0.58, 0.81].flatMap(y => [ink(0.04,y),ink(0.96,y)]);
    return center.filter(v => v < 0.25).length >= 2 && outside.filter(v => v > 0.58).length >= 3;
  }

  function pageCoverage(raw) {
    const s = raw.normalize('NFKC');
    const marks = [
      /말씀\s*나눔|주보|설교\s*제목/u,
      /[가-힣]{2,10}\s*[0-9]{1,3}\s*(?:장|창|:)\s*[0-9]{1,3}/u,
      /찬송(?:가)?\s*[^\p{L}\p{N}]*[0-9]/u,
      /들어가기|시작하기|게임/u,
      /본문\s*이해|말씀\s*이해/u,
      /본문\s*나눔/u,
      /결단\s*하기|적용\s*하기/u,
    ].map(pattern => pattern.test(s));
    return {marks, marked:marks.filter(Boolean).length, letters:(s.match(/[가-힣a-z]/gi) || []).length};
  }

  function usablePageCrop(original, focused) {
    const before = pageCoverage(original.raw), after = pageCoverage(focused.raw);
    return after.marked >= 3 && after.marked >= before.marked
      && before.marks.every((seen, n) => !seen || after.marks[n])
      && after.letters >= before.letters * 0.88
      && (!original.complete || (focused.complete && focused.count >= original.count));
  }

  function glyphAnomalies(raw) {
    // A weak signal to decide whether to retry, never a text replacement.
    return [...raw.matchAll(/(?:^|[^\p{L}\p{N}])\d{1,2}([가-힣]{2,})/gu)]
      .filter(([,word]) => !/^(?:년|월|일|시|분|초|장|절|명|회|번|층|개|권|원|쪽|세|대|부|주|학년|시간|개월|번째)/u.test(word)).length;
  }

  function wantsRefinement(candidate) {
    return Number.isFinite(candidate.confidence) && (candidate.confidence < 90 || candidate.anomalies > 0);
  }

  function contrastCopy(source) {
    // A second, mild grayscale rendering, not a hard threshold: keep strokes
    // in faint print while lowering the effect of colored or shadowed paper.
    const canvas = cropRegion(source,[0,0,1,1]);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx?.getImageData || !ctx.putImageData) {
      canvas.width = canvas.height = 0;
      return null;
    }
    const pixels = ctx.getImageData(0,0,canvas.width,canvas.height);
    const p = pixels.data;
    for (let i = 0; i < p.length; i += 4) {
      const luminance = (p[i]*54 + p[i+1]*183 + p[i+2]*19) / 256;
      p[i] = p[i+1] = p[i+2] = (luminance-48) * (255 / (221-48));
    }
    ctx.putImageData(pixels,0,0);
    return canvas;
  }

  function betterBody(previous, alternate) {
    const before = pageCoverage(previous.raw), after = pageCoverage(alternate.raw);
    if (!before.marks.every((seen,n) => !seen || after.marks[n]) || after.letters < before.letters*0.91
      || (previous.complete && (!alternate.complete || alternate.count < previous.count))) return false;
    const delta = alternate.confidence - previous.confidence;
    return after.marked > before.marked || (alternate.complete && !previous.complete)
      || (delta >= 2 && alternate.anomalies <= previous.anomalies)
      || (delta >= -1 && alternate.anomalies < previous.anomalies);
  }

  async function scanBulletin(input, {onProgress, signal} = {}, includePage = false) {
    const abortError = () => new DOMException('사진 읽기가 취소됐어요.', 'AbortError');
    if (signal?.aborted) throw abortError();
    const isCanvas = typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement;
    const isBlob = input instanceof Blob && !/svg/i.test(input.type) && (!input.type || input.type.startsWith('image/'));
    if (!isCanvas && !isBlob) throw new Error('JPG 또는 PNG 사진을 골라 주세요.');
    if (isBlob && (input.size > MAX_BYTES || !input.size)) throw new Error('24MB 이하의 주보 사진을 골라 주세요.');
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') throw new Error('이 브라우저는 사진에서 한글 읽기를 지원하지 않아요.');
    let worker, canvas, page, crop, adjusted, stopped = false, last = -1, timer, rejectStop, pass = 0;
    const halt = new Promise((_, reject) => { rejectStop = reject; });
    halt.catch(() => {});
    const onAbort = () => rejectStop(abortError());
    const progress = value => {
      if (stopped || signal?.aborted || !Number.isFinite(value)) return;
      const clamped = Math.max(0, Math.min(1, value));
      if (clamped <= last) return;
      last = clamped;
      try { onProgress?.(clamped); } catch { /* Display callbacks must not interrupt recognition. */ }
    };
    const terminate = worker => { try { Promise.resolve(worker?.terminate()).catch(() => {}); } catch {} };
    const step = p => Promise.race([p, halt]);
    signal?.addEventListener('abort', onAbort, {once:true});
    timer = setTimeout(() => rejectStop(new Error('사진을 읽는 데 시간이 오래 걸려요. 작은 사진으로 다시 시도하거나 직접 적어 주세요.')), OCR_TIMEOUT);
    try {
      progress(0);
      const im = isCanvas ? input : await step(decodeBlob(input));
      if (signal?.aborted) throw abortError();
      canvas = boundedCanvas(im);
      progress(0.04);
      const engine = await step(library());
      const opening = engine.createWorker('kor', 1, {
        workerPath: asset('worker.min.js'),
        corePath: asset('core'),
        langPath: asset('lang'),
        gzip: false,
        workerBlobURL: false,
        cacheMethod: 'none',
        errorHandler: () => rejectStop(new Error('한글 인식 파일을 읽지 못했어요. 다시 시도해 주세요.')),
        logger: message => {
          const p = Number(message.progress) || 0;
          switch (message.status) {
            case 'loading tesseract core': progress(0.05 + p * 0.12); break;
            case 'initializing tesseract': progress(0.17 + p * 0.06); break;
            case 'loading language traineddata': progress(0.23 + p * 0.13); break;
            case 'initializing api': progress(0.36 + p * 0.08); break;
            case 'recognizing text': {
              const thresholds = includePage ? [0.45, 0.69, 0.84, 0.93, 0.99] : [0.45, 0.76, 0.89, 0.99];
              progress(thresholds[pass] + p * (thresholds[pass + 1] - thresholds[pass])); break;
            }
          }
        }
      });
      // A late creation after cancellation does not leave a live worker holding pixels.
      opening.then(value => { if (stopped) terminate(value); }, () => {});
      worker = await step(opening);
      progress(0.45);
      const read = async (image, mode) => {
        await step(worker.setParameters({tessedit_pageseg_mode:mode, preserve_interword_spaces:'1'}));
        const result = await step(worker.recognize(image));
        const raw = String(result?.data?.text ?? '').slice(0, 30000);
        const confidence = typeof result?.data?.confidence === 'number' ? result.data.confidence : NaN;
        return {raw, confidence, anomalies:glyphAnomalies(raw), ...questionCoverage(raw)};
      };
      const portrait = canvas.height > canvas.width * 1.1;
      // Wide bulletins are often multi-column. Auto layout first avoids joining
      // unrelated lines across the fold, with dense mode as a bounded fallback.
      const mode = portrait ? '4' : includePage ? '3' : '6';
      let best = await read(canvas, mode);
      let whole = best;
      const start = best;
      let focus = null;
      if (includePage && portrait && hasSurroundings(canvas)) {
        // Keep the title and opening material in view, unlike the separate
        // lower question-only fallback. Rectangles are in relative page units.
        page = cropRegion(canvas, [0.179, 0.0995, 0.666, 0.8667]);
        if (page) {
          pass++;
          focus = await read(page, '6');
          if (usablePageCrop(start, focus)) whole = focus;
          if (focus.score > best.score) best = focus;
        }
      }
      if (includePage && wantsRefinement(focus || start)) {
        adjusted = contrastCopy(page || canvas);
        if (adjusted) {
          pass++;
          const refined = await read(adjusted, focus ? '6' : mode);
          if (focus ? usablePageCrop(start, refined) && (whole === start || betterBody(focus, refined))
                    : betterBody(start, refined)) whole = refined;
          if (refined.score > best.score) best = refined;
          adjusted.width = adjusted.height = 0; adjusted = null;
        }
      }
      if (!best.complete && (best.hasHeading || best.count < 2)) {
        const firstHadHeading = best.hasHeading;
        pass++;
        const alternate = await read(canvas, mode === '6' ? '4' : '6');
        if (includePage && whole === start && !start.raw.trim() && alternate.raw.trim()) whole = alternate;
        else if (includePage && !focus && betterBody(whole,alternate)) whole = alternate;
        if (alternate.score > best.score) best = alternate;
        if (pass < 3 && !alternate.complete && !best.complete && portrait && (firstHadHeading || alternate.hasHeading || best.count < 2)) {
          crop = cropRegion(canvas, [0.147, 0.43, 0.767, 0.55]);
          if (crop) {
            pass++;
            const focused = await read(crop, '6');
            if (focused.score > best.score) best = focused;
          }
        }
      }
      progress(1);
      return {text:whole.raw.trim(), questionText:best.raw, originalText:start.raw.trim()};
    } finally {
      stopped = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      terminate(worker);
      if (adjusted) { adjusted.width = 0; adjusted.height = 0; }
      if (page) { page.width = 0; page.height = 0; }
      if (crop) { crop.width = 0; crop.height = 0; }
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
  }
  async function recognizeBulletinText(input, options) {
    return (await scanBulletin(input, options)).questionText;
  }
  function analyzeBulletin(input, options) {
    return scanBulletin(input, options, true);
  }
  window.YeoBulletinOCR = Object.freeze({recognizeBulletinText, analyzeBulletin});
})();
