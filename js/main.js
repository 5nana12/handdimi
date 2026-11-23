// 손글씨 입력 Canvas 및 좌표 수집
import p5 from "p5";
// Canvas 이미지의 벡터 윤곽선 추출
import ImageTracer from "imagetracerjs";
// 글리프 및 OTF 폰트 파일 생성
import * as opentype from "opentype.js";
// 업로드한 손글씨 이미지 OCR
import { createWorker } from "tesseract.js";

const strokes = [];
let currentStroke = null;
let sketch = null;
let svgText = "";
let fontBlob = null;
let fontObjectUrl = "";
let uploadedImage = null;
let uploadedImageUrl = "";

const elements = {
  canvasHost: document.querySelector("#canvas-host"),
  strokeCount: document.querySelector("#stroke-count"),
  pointCount: document.querySelector("#point-count"),
  coordinateLog: document.querySelector("#coordinate-log"),
  undoButton: document.querySelector("#undo-button"),
  clearButton: document.querySelector("#clear-button"),
  vectorizeButton: document.querySelector("#vectorize-button"),
  downloadSvgButton: document.querySelector("#download-svg-button"),
  svgPreview: document.querySelector("#svg-preview"),
  vectorStatus: document.querySelector("#vector-status"),
  fontSample: document.querySelector("#font-sample"),
  fontPreview: document.querySelector("#font-preview"),
  fontStatus: document.querySelector("#font-status"),
  createFontButton: document.querySelector("#create-font-button"),
  downloadFontButton: document.querySelector("#download-font-button"),
  ocrFile: document.querySelector("#ocr-file"),
  ocrPreview: document.querySelector("#ocr-preview"),
  ocrPlaceholder: document.querySelector("#ocr-placeholder"),
  ocrLanguage: document.querySelector("#ocr-language"),
  ocrResult: document.querySelector("#ocr-result"),
  ocrProgress: document.querySelector("#ocr-progress"),
  ocrStatus: document.querySelector("#ocr-status"),
  runOcrButton: document.querySelector("#run-ocr-button"),
};

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hasDrawing() {
  return strokes.some((stroke) => stroke.length > 0);
}

function updateDrawingInfo() {
  const pointCount = strokes.reduce((sum, stroke) => sum + stroke.length, 0);
  const recentPoints = strokes.flat().slice(-8);
  elements.strokeCount.textContent = String(strokes.length);
  elements.pointCount.textContent = String(pointCount);
  elements.coordinateLog.textContent = recentPoints.length
    ? recentPoints.map((point, index) => {
        const number = pointCount - recentPoints.length + index + 1;
        return `${String(number).padStart(3, "0")}  x: ${point.x.toFixed(1).padStart(6)}  y: ${point.y.toFixed(1).padStart(6)}`;
      }).join("\n")
    : "아직 입력된 좌표가 없습니다.";
}

function renderDrawing() {
  if (!sketch) return;
  sketch.background(255);
  sketch.noFill();
  sketch.stroke("#172033");
  sketch.strokeWeight(9);
  sketch.strokeCap(sketch.ROUND);
  sketch.strokeJoin(sketch.ROUND);

  strokes.forEach((stroke) => {
    if (stroke.length === 1) {
      sketch.point(stroke[0].x, stroke[0].y);
      return;
    }
    sketch.beginShape();
    stroke.forEach((point) => sketch.vertex(point.x, point.y));
    sketch.endShape();
  });
}

function getPointerPosition(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

new p5((p) => {
  p.setup = () => {
    const width = Math.max(300, Math.min(760, elements.canvasHost.clientWidth));
    const canvas = p.createCanvas(width, 360);
    canvas.parent(elements.canvasHost);
    p.pixelDensity(1);
    p.noLoop();
    sketch = p;
    renderDrawing();

    canvas.elt.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      canvas.elt.setPointerCapture(event.pointerId);
      currentStroke = [getPointerPosition(event, canvas.elt)];
      strokes.push(currentStroke);
      renderDrawing();
      updateDrawingInfo();
    });
    canvas.elt.addEventListener("pointermove", (event) => {
      if (!currentStroke || !canvas.elt.hasPointerCapture(event.pointerId)) return;
      event.preventDefault();
      currentStroke.push(getPointerPosition(event, canvas.elt));
      renderDrawing();
      updateDrawingInfo();
    });
    const endStroke = (event) => {
      if (canvas.elt.hasPointerCapture(event.pointerId)) canvas.elt.releasePointerCapture(event.pointerId);
      currentStroke = null;
    };
    canvas.elt.addEventListener("pointerup", endStroke);
    canvas.elt.addEventListener("pointercancel", endStroke);
  };
}, elements.canvasHost);

elements.undoButton.addEventListener("click", () => {
  strokes.pop();
  renderDrawing();
  updateDrawingInfo();
});

elements.clearButton.addEventListener("click", () => {
  strokes.length = 0;
  svgText = "";
  elements.svgPreview.innerHTML = '<span class="placeholder">벡터화 결과가 여기에 표시됩니다.</span>';
  elements.downloadSvgButton.disabled = true;
  elements.vectorStatus.textContent = "";
  renderDrawing();
  updateDrawingInfo();
});

elements.vectorizeButton.addEventListener("click", () => {
  if (!hasDrawing()) {
    elements.vectorStatus.textContent = "먼저 캔버스에 글자를 써 주세요.";
    return;
  }
  const imageData = sketch.drawingContext.getImageData(0, 0, sketch.width, sketch.height);
  svgText = ImageTracer.imagedataToSVG(imageData, {
    ltres: 1, qtres: 1, pathomit: 4, colorsampling: 0,
    numberofcolors: 2, mincolorratio: 0, colorquantcycles: 3, scale: 1,
  });
  elements.svgPreview.innerHTML = svgText;
  elements.downloadSvgButton.disabled = false;
  elements.vectorStatus.textContent = "캔버스를 SVG 윤곽선으로 변환했습니다.";
});

elements.downloadSvgButton.addEventListener("click", () => {
  if (svgText) downloadBlob(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }), "handdimi-trace.svg");
});

function addRectangleContour(path, start, end, halfWidth) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const offsetX = (-dy / length) * halfWidth;
  const offsetY = (dx / length) * halfWidth;
  path.moveTo(start.x + offsetX, start.y + offsetY);
  path.lineTo(end.x + offsetX, end.y + offsetY);
  path.lineTo(end.x - offsetX, end.y - offsetY);
  path.lineTo(start.x - offsetX, start.y - offsetY);
  path.close();
}

function buildFontPath() {
  const path = new opentype.Path();
  const allPoints = strokes.flat();
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = Math.min(700 / width, 700 / height);
  const offsetX = 100 + (700 - width * scale) / 2;
  const offsetY = 100 + (700 - height * scale) / 2;
  const mapPoint = (point) => ({
    x: offsetX + (point.x - minX) * scale,
    y: 900 - (offsetY + (point.y - minY) * scale),
  });

  strokes.forEach((stroke) => {
    if (stroke.length === 1) {
      const point = mapPoint(stroke[0]);
      addRectangleContour(path, { x: point.x - 1, y: point.y }, { x: point.x + 1, y: point.y }, 18);
    }
    for (let index = 1; index < stroke.length; index += 1) {
      addRectangleContour(path, mapPoint(stroke[index - 1]), mapPoint(stroke[index]), 18);
    }
  });
  return path;
}

function createFontBlob() {
  const notdefPath = new opentype.Path();
  notdefPath.moveTo(100, 0); notdefPath.lineTo(100, 700);
  notdefPath.lineTo(600, 700); notdefPath.lineTo(600, 0); notdefPath.close();
  const glyphs = [
    new opentype.Glyph({ name: ".notdef", advanceWidth: 700, path: notdefPath }),
    new opentype.Glyph({ name: "space", unicode: 32, advanceWidth: 350, path: new opentype.Path() }),
    new opentype.Glyph({ name: "A", unicode: 65, advanceWidth: 900, path: buildFontPath() }),
  ];
  const font = new opentype.Font({
    familyName: "Handdimi Test", styleName: "Regular", unitsPerEm: 1000,
    ascender: 900, descender: -100, glyphs,
  });
  return new Blob([font.toArrayBuffer()], { type: "font/otf" });
}

elements.fontSample.addEventListener("input", () => {
  elements.fontPreview.textContent = elements.fontSample.value || "A";
});

elements.createFontButton.addEventListener("click", async () => {
  if (!hasDrawing()) {
    elements.fontStatus.textContent = "먼저 캔버스에 글자를 써 주세요.";
    return;
  }
  try {
    fontBlob = createFontBlob();
    if (fontObjectUrl) URL.revokeObjectURL(fontObjectUrl);
    fontObjectUrl = URL.createObjectURL(fontBlob);
    const previewFace = new FontFace("HanddimiPreview", `url(${fontObjectUrl})`);
    await previewFace.load();
    document.fonts.add(previewFace);
    elements.fontPreview.style.fontFamily = "HanddimiPreview, sans-serif";
    elements.downloadFontButton.disabled = false;
    elements.fontStatus.textContent = "대문자 A 글리프가 포함된 OTF를 생성했습니다.";
  } catch (error) {
    console.error(error);
    elements.fontStatus.textContent = `폰트 생성 실패: ${error.message}`;
  }
});

elements.downloadFontButton.addEventListener("click", () => {
  if (fontBlob) downloadBlob(fontBlob, "handdimi-test.otf");
});

elements.ocrFile.addEventListener("change", () => {
  uploadedImage = elements.ocrFile.files?.[0] ?? null;
  elements.runOcrButton.disabled = !uploadedImage;
  elements.ocrResult.value = "";
  elements.ocrProgress.value = 0;
  if (uploadedImageUrl) URL.revokeObjectURL(uploadedImageUrl);
  if (!uploadedImage) {
    elements.ocrPreview.hidden = true;
    elements.ocrPlaceholder.hidden = false;
    elements.ocrStatus.textContent = "대기 중";
    return;
  }
  uploadedImageUrl = URL.createObjectURL(uploadedImage);
  elements.ocrPreview.src = uploadedImageUrl;
  elements.ocrPreview.hidden = false;
  elements.ocrPlaceholder.hidden = true;
  elements.ocrStatus.textContent = `${uploadedImage.name} 준비됨`;
});

elements.runOcrButton.addEventListener("click", async () => {
  if (!uploadedImage) return;
  elements.runOcrButton.disabled = true;
  elements.ocrProgress.value = 0;
  elements.ocrResult.value = "";
  let worker;
  try {
    worker = await createWorker(elements.ocrLanguage.value, undefined, {
      logger(message) {
        if (typeof message.progress === "number") elements.ocrProgress.value = message.progress;
        elements.ocrStatus.textContent = message.status || "OCR 처리 중";
      },
    });
    const result = await worker.recognize(uploadedImage);
    elements.ocrResult.value = result.data.text.trim();
    elements.ocrProgress.value = 1;
    elements.ocrStatus.textContent = "OCR 인식이 완료되었습니다.";
  } catch (error) {
    console.error(error);
    elements.ocrStatus.textContent = `OCR 실패: ${error.message}`;
  } finally {
    if (worker) await worker.terminate();
    elements.runOcrButton.disabled = false;
  }
});

window.addEventListener("beforeunload", () => {
  if (fontObjectUrl) URL.revokeObjectURL(fontObjectUrl);
  if (uploadedImageUrl) URL.revokeObjectURL(uploadedImageUrl);
});
