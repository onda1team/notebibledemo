'use strict';
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const questions = require('../client/bulletin-questions.js');
const source = readFileSync(path.join(__dirname, '../client/bulletin-ocr-engine.js'), 'utf8');

function setup(reads, surrounds = false) {
  class Canvas {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() {
      return {
        drawImage() {}, fillRect() {}, putImageData() {},
        getImageData: (x, _y, w,h) => ({data:new Uint8ClampedArray(Math.min(w*h*4,10000))
          .fill(surrounds && (x<this.width*0.1 || x>this.width*0.9) ? 35 : 220)}),
      };
    }
  }
  let activeMode, terminated = 0, openings = 0;
  const seen = [], canvases = [];
  const window = {YeoBulletinQuestions:questions, Tesseract:{
    async createWorker(_lang, _oem, {logger}) {
      openings++;
      return {
        async setParameters(params) { activeMode = params.tessedit_pageseg_mode; },
        async recognize(image) {
          seen.push([activeMode, image.width, image.height]);
          logger({status:'recognizing text', progress:0.1});
          logger({status:'recognizing text', progress:1});
          assert.ok(reads.length, 'unexpected fallback pass');
          const result=reads.shift();
          return {data:typeof result==='string'?{text:result}:result};
        },
        terminate() { terminated++; },
      };
    },
  }};
  const document = {
    baseURI:'https://example.test/',
    createElement(name) {
      if (name === 'canvas') {
        const canvas = new Canvas();
        canvases.push(canvas);
        return canvas;
      }
      assert.equal(name, 'script');
      return {};
    },
    head:{append(script) { script.onload(); }},
  };
  vm.runInNewContext(source, {
    document, window, HTMLCanvasElement:Canvas, Blob, URL, Worker:function Worker() {},
    WebAssembly, setTimeout, clearTimeout, DOMException,
  });
  return {
    recognize:(w, h, settings) => window.YeoBulletinOCR.recognizeBulletinText(new Canvas(w,h),settings),
    analyze:(w, h, settings) => window.YeoBulletinOCR.analyzeBulletin(new Canvas(w,h),settings),
    seen, canvases, counts:() => [openings, terminated],
  };
}

const complete = '오늘의 안내\n▶ 본문 나눔\n1. 첫 질문인가요?\n2. 둘째 질문인가요?\n3. 셋째 질문인가요?\n4. 넷째 질문인가요?\n▶ 결단하기\n1. 첫 실천을 정하기\n2. 둘째 실천을 정하기';

test('portrait columns preserve a complete variable-length section pair in one pass', async () => {
  const local = setup([complete]);
  assert.equal(await local.recognize(1350, 1800), complete);
  assert.deepEqual(local.seen, [['4',1350,1800]]);
  assert.deepEqual(local.counts(), [1,1]);
});

test('incomplete groups retry in one worker and pick the intact candidate without duplicating questions', async () => {
  const local = setup([
    '본문나눔\n1. 첫 질문인가요?\n3. 셋째 질문인가요?\n결단하기\n1. 첫 실천을 정하기',
    '결단하기\n1. 첫 실천을 정하기\n2. 둘째 실천을 정하기',
    complete,
  ]);
  const progress = [];
  assert.equal(await local.recognize(1350,1800,{onProgress:n=>progress.push(n)}), complete);
  assert.deepEqual(local.seen, [['4',1350,1800],['6',1350,1800],['6',1035,990]]);
  assert.deepEqual(local.counts(), [1,1]);
  assert.ok(local.canvases.every(canvas=>!canvas.width&&!canvas.height), 'release both local canvases');
  assert.equal(progress.at(-1),1);
  assert.ok(progress.every((n,i)=>i===0||n>progress[i-1]));
});

test('plain two-question landscape reference keeps the original dense one-pass mode', async () => {
  const plain = '나눔 질문\n1. 첫 질문인가요?\n2. 둘째 질문인가요?';
  const local = setup([plain]);
  assert.equal(await local.recognize(1200,650),plain);
  assert.deepEqual(local.seen,[['6',1800,975]]);
  assert.deepEqual(local.counts(),[1,1]);
});

const wholeText = `말씀 나눔 주보
마가복음 8장 7절
찬송 333장
들어가기
서로의 이름을 기억하는 게임으로 시작합니다.
본문이해
한 주 동안 돌아볼 본문을 오늘 함께 천천히 읽습니다.
${complete}`;

test('photographed surroundings select a complete center-page transcription separately from question input', async () => {
  const flattened = wholeText.replace('말씀 나눔 주보\n마가복음 8장 7절\n','옆 장의 예시 문구\n');
  const local = setup([flattened, wholeText], true);
  const result = await local.analyze(1350,1800);
  assert.equal(result.text,wholeText);
  assert.equal(result.originalText,flattened);
  assert.equal(result.questionText,flattened, 'a question tie retains the original pass');
  assert.equal(questions.extract(result.questionText).length,6);
  assert.deepEqual(local.seen,[['4',1350,1800],['6',899,1560]]);
  assert.ok(local.canvases.every(canvas=>!canvas.width&&!canvas.height));
});

test('do not accept a center crop that loses a known section or run it on a flat page', async () => {
  const weakCrop = wholeText.replace('찬송 333장\n','');
  const photo = setup([wholeText, weakCrop],true);
  assert.equal((await photo.analyze(1350,1800)).text,wholeText);
  const scan = setup([wholeText]);
  assert.equal((await scan.analyze(1350,1800)).text,wholeText);
  assert.deepEqual(scan.seen,[['4',1350,1800]]);
});

test('take one same-region contrast pass for OCR noise, preserve actual numerals and original text', async () => {
  const noisy=wholeText.replace('한 주 동안','2늘은');
  const local=setup([{text:noisy,confidence:88},{text:wholeText,confidence:89}]);
  const result=await local.analyze(1350,1800);
  assert.equal(result.text,wholeText);
  assert.equal(result.originalText,noisy);
  assert.match(result.text,/마가복음 8장 7절/);
  assert.deepEqual(local.seen,[['4',1350,1800],['4',1350,1800]]);
  assert.deepEqual(local.counts(),[1,1]);
});

test('retain a lower-confidence complete body over a clipped higher-confidence OCR retry', async () => {
  const incomplete=wholeText.replace('찬송 333장\n','');
  const local=setup([{text:wholeText,confidence:85},{text:incomplete,confidence:99}]);
  assert.equal((await local.analyze(1350,1800)).text,wholeText);
});

test('wide whole-page scans begin with auto layout rather than assuming one column', async () => {
  const local=setup([{text:wholeText,confidence:98}]);
  assert.equal((await local.analyze(1200,650)).text,wholeText);
  assert.deepEqual(local.seen,[['3',1800,975]]);
});
