import {
  ImageTracer as ImageTracerModule,
  opentype as opentypeModule,
} from "./main.js";

/**
 * HANDDIMI 영문 OTF 변환 모듈
 *
 * 처리 순서
 * 1) 다른 화면에서 완성된 Canvas / ImageData / strokes를 받는다.
 * 2) 글씨 영역만 잘라 흑백 ImageData로 정규화한다.
 * 3) ImageTracerJS로 닫힌 SVG 윤곽선을 만든다.
 * 4) SVG 좌표를 opentype.Path의 폰트 좌표로 변환한다.
 * 5) A-Z, a-z Glyph와 .notdef / 공백을 묶어 실제 OTF ArrayBuffer를 만든다.
 * 6) 생성한 버퍼를 opentype.parse()로 다시 열어 cmap과 Path를 검증한다.
 *
 * 이 파일은 ES module named export와 window.HANDDIMIFont를 동시에 제공한다.
 */

// main.js가 CDN에서 불러와 export한 모듈을 font.js에서 사용한다.
const opentype = opentypeModule.Path ? opentypeModule : opentypeModule.default;
const imageTracerCandidate = ImageTracerModule?.default ?? ImageTracerModule;
const imageTracer = typeof imageTracerCandidate?.imagedataToSVG === "function"
  ? imageTracerCandidate
  : new imageTracerCandidate();

if (!opentype?.Path || !opentype?.Glyph || !opentype?.Font || !opentype?.parse) {
  throw new Error("opentype.js를 불러오지 못했습니다.");
}

if (typeof imageTracer?.imagedataToSVG !== "function") {
  throw new Error("ImageTracerJS를 불러오지 못했습니다.");
}

const FONT_METRICS = Object.freeze({
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  topLimit: 760,
  bottomLimit: -160,
  sideBearing: 60,
  maximumInkWidth: 880,
  spaceWidth: 300,
});

const DEFAULTS = Object.freeze({
  familyName: "HANDDIMI",
  styleName: "Regular",
  threshold: 238,
  cropPadding: 2,
});

const TRACE_OPTIONS = Object.freeze({
  ltres: 0.5,
  qtres: 0.5,
  pathomit: 1,
  rightangleenhance: false,
  colorsampling: 0,
  numberofcolors: 2,
  mincolorratio: 0,
  colorquantcycles: 1,
  layering: 0,
  strokewidth: 0,
  linefilter: false,
  scale: 1,
  roundcoords: 3,
  viewbox: true,
  desc: false,
  blurradius: 0,
  blurdelta: 20,
});

export const UPPERCASE_LETTERS = Object.freeze(Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ"));
export const LOWERCASE_LETTERS = Object.freeze(Array.from("abcdefghijklmnopqrstuvwxyz"));
export const ENGLISH_LETTERS = Object.freeze([...UPPERCASE_LETTERS, ...LOWERCASE_LETTERS]);

const glyphStore = new Map();
let activePreviewFace = null;
let buildRevision = 0;

const elements = {
  familyName: document.querySelector("#family-name"),
  styleName: document.querySelector("#style-name"),
  receivedCount: document.querySelector("#received-count"),
  missingSummary: document.querySelector("#missing-summary"),
  uppercaseGrid: document.querySelector("#uppercase-grid"),
  lowercaseGrid: document.querySelector("#lowercase-grid"),
  uppercaseCount: document.querySelector("#uppercase-count"),
  lowercaseCount: document.querySelector("#lowercase-count"),
  previewText: document.querySelector("#preview-text"),
  preview: document.querySelector("#font-preview"),
  generateFont: document.querySelector("#generate-font"),
  status: document.querySelector("#font-status"),
  validationList: document.querySelector("#validation-list"),
};

/* --------------------------------------------------------------------------
 * 1. 외부 그리기 데이터를 ImageData로 통일
 * ----------------------------------------------------------------------- */

function assertEnglishLetter(value) {
  const character = String(value ?? "").trim();
  if (!/^[A-Za-z]$/.test(character)) {
    throw new Error("영문 대문자 A-Z 또는 소문자 a-z 한 글자만 사용할 수 있습니다.");
  }
  return character;
}

function cloneImageData(imageData) {
  return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
}

function isImageDataLike(value) {
  return Boolean(
    value
    && Number.isInteger(value.width)
    && Number.isInteger(value.height)
    && value.width > 0
    && value.height > 0
    && value.data
    && value.data.length >= value.width * value.height * 4,
  );
}

function pointFromUnknown(point) {
  if (Array.isArray(point)) {
    return { x: Number(point[0]), y: Number(point[1]) };
  }

  return { x: Number(point?.x), y: Number(point?.y) };
}

function imageDataFromStrokes(strokes, width, height, defaultStrokeWidth = 16) {
  if (!Array.isArray(strokes) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("strokes 입력에는 유효한 width와 height가 필요합니다.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d", { willReadFrequently: true });

  context.strokeStyle = "#000";
  context.fillStyle = "#000";
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const strokeValue of strokes) {
    const points = Array.isArray(strokeValue) ? strokeValue : strokeValue?.points;
    if (!Array.isArray(points) || points.length === 0) continue;

    const lineWidth = Number(strokeValue?.width ?? defaultStrokeWidth);
    context.lineWidth = Number.isFinite(lineWidth) && lineWidth > 0
      ? lineWidth
      : defaultStrokeWidth;

    const first = pointFromUnknown(points[0]);
    if (!Number.isFinite(first.x) || !Number.isFinite(first.y)) continue;

    if (points.length === 1) {
      context.beginPath();
      context.arc(first.x, first.y, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }

    context.beginPath();
    context.moveTo(first.x, first.y);
    for (let index = 1; index < points.length; index += 1) {
      const point = pointFromUnknown(points[index]);
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
        context.lineTo(point.x, point.y);
      }
    }
    context.stroke();
  }

  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function sourceToImageData(input) {
  if (isImageDataLike(input?.imageData)) {
    return cloneImageData(input.imageData);
  }

  if (isImageDataLike(input?.source)) {
    return cloneImageData(input.source);
  }

  const canvasCandidate = input?.canvas ?? input?.source;
  const canvas = [canvasCandidate, canvasCandidate?.elt, canvasCandidate?.canvas]
    .find((value) => (
      value
      && typeof value.getContext === "function"
      && Number.isFinite(value.width)
      && Number.isFinite(value.height)
    ));

  // HTMLCanvasElement뿐 아니라 p5.Renderer(.elt/.canvas)와 OffscreenCanvas도 받는다.
  if (canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("전달받은 Canvas에서 2D context를 열 수 없습니다.");
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }

  if (Array.isArray(input?.strokes)) {
    return imageDataFromStrokes(
      input.strokes,
      input.width,
      input.height,
      input.strokeWidth,
    );
  }

  throw new Error("canvas, imageData 또는 strokes 중 하나를 전달해 주세요.");
}

function compositeLuminanceOnWhite(data, offset) {
  const alpha = data[offset + 3] / 255;
  const red = data[offset] * alpha + 255 * (1 - alpha);
  const green = data[offset + 1] * alpha + 255 * (1 - alpha);
  const blue = data[offset + 2] * alpha + 255 * (1 - alpha);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

/**
 * Canvas/ImageData에서 잉크 픽셀의 경계를 찾고 흑백 ImageData를 만든다.
 * 투명 배경은 흰색에 합성해 판정하므로 투명 픽셀이 검정으로 오인되지 않는다.
 *
 * @param {ImageData} sourceImageData 원본 픽셀 데이터
 * @param {{ threshold?: number, padding?: number, baseline?: number }} options
 * @returns {{ imageData: ImageData, bounds: object, padding: number, baseline: number }}
 */
export function extractGlyphImageData(sourceImageData, options = {}) {
  if (!isImageDataLike(sourceImageData)) {
    throw new Error("유효한 ImageData가 필요합니다.");
  }

  const threshold = Number.isFinite(options.threshold)
    ? Math.min(254, Math.max(1, options.threshold))
    : DEFAULTS.threshold;
  const padding = Number.isFinite(options.padding)
    ? Math.max(1, Math.round(options.padding))
    : DEFAULTS.cropPadding;
  const { width, height, data } = sourceImageData;
  const mask = new Uint8Array(width * height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const dataIndex = pixelIndex * 4;
      const isInk = compositeLuminanceOnWhite(data, dataIndex) < threshold;
      if (!isInk) continue;

      mask[pixelIndex] = 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error("Canvas가 비어 있습니다. 글자를 먼저 그려 주세요.");
  }

  const contentWidth = maxX - minX + 1;
  const contentHeight = maxY - minY + 1;
  const outputWidth = contentWidth + padding * 2;
  const outputHeight = contentHeight + padding * 2;
  const output = new ImageData(outputWidth, outputHeight);

  for (let index = 0; index < output.data.length; index += 4) {
    output.data[index] = 255;
    output.data[index + 1] = 255;
    output.data[index + 2] = 255;
    output.data[index + 3] = 255;
  }

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!mask[y * width + x]) continue;
      const outputX = x - minX + padding;
      const outputY = y - minY + padding;
      const outputIndex = (outputY * outputWidth + outputX) * 4;
      output.data[outputIndex] = 0;
      output.data[outputIndex + 1] = 0;
      output.data[outputIndex + 2] = 0;
      output.data[outputIndex + 3] = 255;
    }
  }

  const requestedBaseline = Number(options.baseline);
  const baseline = Number.isFinite(requestedBaseline)
    ? requestedBaseline - minY + padding
    : padding + contentHeight;

  return {
    imageData: output,
    bounds: { x: minX, y: minY, width: contentWidth, height: contentHeight },
    padding,
    baseline,
    sourceWidth: width,
    sourceHeight: height,
  };
}

function makeTraceOptions() {
  return {
    ...TRACE_OPTIONS,
    pal: [
      { r: 0, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 },
    ],
  };
}

/* --------------------------------------------------------------------------
 * 2. 흑백 ImageData를 ImageTracerJS SVG로 변환
 * ----------------------------------------------------------------------- */

export function traceImageDataToSvg(imageData) {
  return imageTracer.imagedataToSVG(imageData, makeTraceOptions());
}

function parseFillColor(fillValue) {
  const value = String(fillValue ?? "").trim().toLowerCase();
  const rgbMatch = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgbMatch) {
    return rgbMatch.slice(1, 4).map(Number);
  }

  const hexMatch = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1].length === 3
      ? Array.from(hexMatch[1], (character) => character + character).join("")
      : hexMatch[1];
    return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  }

  if (value === "black") return [0, 0, 0];
  if (value === "white") return [255, 255, 255];
  return null;
}

function isDarkVisiblePath(pathElement) {
  const opacity = Number(pathElement.getAttribute("opacity") ?? 1);
  if (!Number.isFinite(opacity) || opacity <= 0.5) return false;

  const color = parseFillColor(pathElement.getAttribute("fill"));
  return Boolean(color && color[0] + color[1] + color[2] < 384);
}

const SVG_TOKEN_PATTERN = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

function tokenizeSvgPath(pathData) {
  const tokens = String(pathData ?? "").match(SVG_TOKEN_PATTERN) ?? [];
  if (tokens.length === 0) {
    throw new Error("SVG path 데이터가 비어 있습니다.");
  }
  return tokens;
}

function isSvgCommand(token) {
  return /^[a-zA-Z]$/.test(token);
}

/* --------------------------------------------------------------------------
 * 3. ImageTracer가 만든 SVG path 명령을 파싱
 * ----------------------------------------------------------------------- */

/**
 * ImageTracer의 M/L/Q/Z를 포함해 일반적인 M/L/H/V/C/S/Q/T/Z를 절대 좌표로 파싱한다.
 * 원호 A 명령은 ImageTracer가 생성하지 않으므로, 손실 방지를 위해 발견 즉시 오류로 처리한다.
 */
export function parseSvgPathData(pathData) {
  const tokens = tokenizeSvgPath(pathData);
  const commands = [];
  let tokenIndex = 0;
  let activeCommand = null;
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let lastCubicControl = null;
  let lastQuadraticControl = null;
  let previousType = null;

  const hasNumber = () => tokenIndex < tokens.length && !isSvgCommand(tokens[tokenIndex]);
  const readNumber = () => {
    if (!hasNumber()) throw new Error(`SVG path ${activeCommand} 명령의 좌표가 부족합니다.`);
    const value = Number(tokens[tokenIndex]);
    tokenIndex += 1;
    if (!Number.isFinite(value)) throw new Error("SVG path에 유효하지 않은 숫자가 있습니다.");
    return value;
  };
  const absolutePoint = (x, y, relative) => ({
    x: relative ? currentX + x : x,
    y: relative ? currentY + y : y,
  });
  const resetControls = () => {
    lastCubicControl = null;
    lastQuadraticControl = null;
  };

  while (tokenIndex < tokens.length) {
    if (isSvgCommand(tokens[tokenIndex])) {
      activeCommand = tokens[tokenIndex];
      tokenIndex += 1;
    } else if (!activeCommand) {
      throw new Error("SVG path 명령 문자가 필요합니다.");
    }

    const relative = activeCommand === activeCommand.toLowerCase();
    const type = activeCommand.toUpperCase();

    if (type === "Z") {
      commands.push({ type: "Z" });
      currentX = startX;
      currentY = startY;
      previousType = "Z";
      resetControls();
      activeCommand = null;
      continue;
    }

    if (type === "A") {
      throw new Error("ImageTracer가 지원 범위 밖의 SVG A(arc) 명령을 생성했습니다.");
    }

    if (!hasNumber()) {
      throw new Error(`SVG path ${activeCommand} 명령의 좌표가 없습니다.`);
    }

    if (type === "M") {
      let firstPoint = true;
      while (hasNumber()) {
        const point = absolutePoint(readNumber(), readNumber(), relative);
        if (firstPoint) {
          commands.push({ type: "M", x: point.x, y: point.y });
          startX = point.x;
          startY = point.y;
          firstPoint = false;
          previousType = "M";
        } else {
          commands.push({ type: "L", x: point.x, y: point.y });
          previousType = "L";
        }
        currentX = point.x;
        currentY = point.y;
        resetControls();
      }
      activeCommand = relative ? "l" : "L";
      continue;
    }

    if (type === "L") {
      while (hasNumber()) {
        const point = absolutePoint(readNumber(), readNumber(), relative);
        commands.push({ type: "L", x: point.x, y: point.y });
        currentX = point.x;
        currentY = point.y;
        previousType = "L";
        resetControls();
      }
      continue;
    }

    if (type === "H") {
      while (hasNumber()) {
        const value = readNumber();
        currentX = relative ? currentX + value : value;
        commands.push({ type: "L", x: currentX, y: currentY });
        previousType = "L";
        resetControls();
      }
      continue;
    }

    if (type === "V") {
      while (hasNumber()) {
        const value = readNumber();
        currentY = relative ? currentY + value : value;
        commands.push({ type: "L", x: currentX, y: currentY });
        previousType = "L";
        resetControls();
      }
      continue;
    }

    if (type === "C") {
      while (hasNumber()) {
        const control1 = absolutePoint(readNumber(), readNumber(), relative);
        const control2 = absolutePoint(readNumber(), readNumber(), relative);
        const end = absolutePoint(readNumber(), readNumber(), relative);
        commands.push({
          type: "C",
          x1: control1.x,
          y1: control1.y,
          x2: control2.x,
          y2: control2.y,
          x: end.x,
          y: end.y,
        });
        currentX = end.x;
        currentY = end.y;
        lastCubicControl = control2;
        lastQuadraticControl = null;
        previousType = "C";
      }
      continue;
    }

    if (type === "S") {
      while (hasNumber()) {
        const control1 = (previousType === "C" || previousType === "S") && lastCubicControl
          ? { x: currentX * 2 - lastCubicControl.x, y: currentY * 2 - lastCubicControl.y }
          : { x: currentX, y: currentY };
        const control2 = absolutePoint(readNumber(), readNumber(), relative);
        const end = absolutePoint(readNumber(), readNumber(), relative);
        commands.push({
          type: "C",
          x1: control1.x,
          y1: control1.y,
          x2: control2.x,
          y2: control2.y,
          x: end.x,
          y: end.y,
        });
        currentX = end.x;
        currentY = end.y;
        lastCubicControl = control2;
        lastQuadraticControl = null;
        previousType = "S";
      }
      continue;
    }

    if (type === "Q") {
      while (hasNumber()) {
        const control = absolutePoint(readNumber(), readNumber(), relative);
        const end = absolutePoint(readNumber(), readNumber(), relative);
        commands.push({
          type: "Q",
          x1: control.x,
          y1: control.y,
          x: end.x,
          y: end.y,
        });
        currentX = end.x;
        currentY = end.y;
        lastQuadraticControl = control;
        lastCubicControl = null;
        previousType = "Q";
      }
      continue;
    }

    if (type === "T") {
      while (hasNumber()) {
        const control = (previousType === "Q" || previousType === "T") && lastQuadraticControl
          ? { x: currentX * 2 - lastQuadraticControl.x, y: currentY * 2 - lastQuadraticControl.y }
          : { x: currentX, y: currentY };
        const end = absolutePoint(readNumber(), readNumber(), relative);
        commands.push({
          type: "Q",
          x1: control.x,
          y1: control.y,
          x: end.x,
          y: end.y,
        });
        currentX = end.x;
        currentY = end.y;
        lastQuadraticControl = control;
        lastCubicControl = null;
        previousType = "T";
      }
      continue;
    }

    throw new Error(`지원하지 않는 SVG path 명령입니다: ${activeCommand}`);
  }

  return commands;
}

function splitContours(commands) {
  const contours = [];
  let points = [];

  for (const command of commands) {
    if (command.type === "M") {
      if (points.length > 0) contours.push(points);
      points = [{ x: command.x, y: command.y }];
    } else if (command.type === "L" || command.type === "Q" || command.type === "C") {
      points.push({ x: command.x, y: command.y });
    } else if (command.type === "Z" && points.length > 0) {
      contours.push(points);
      points = [];
    }
  }

  if (points.length > 0) contours.push(points);
  return contours;
}

function signedContourArea(points) {
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function inspectContourWinding(commands) {
  const contours = splitContours(commands);
  const areas = contours.map(signedContourArea);

  // ImageTracer 1.2.6은 한 path의 첫 contour 뒤에 holechildren을 역순으로 붙인다.
  // 반대 winding이 깨졌다면 잘못 채워진 OTF를 만들지 않고 즉시 중단한다.
  if (areas.length > 1 && Math.abs(areas[0]) > 0.001) {
    const outerSign = Math.sign(areas[0]);
    for (let index = 1; index < areas.length; index += 1) {
      if (Math.abs(areas[index]) > 0.001 && Math.sign(areas[index]) === outerSign) {
        throw new Error("내부 구멍 윤곽의 방향이 외곽선과 같아 폰트 생성을 중단했습니다.");
      }
    }
  }

  return { contourCount: contours.length, holeCount: Math.max(0, contours.length - 1) };
}

function appendCommandsToOpenTypePath(targetPath, commands, transform) {
  const point = (x, y) => transform(x, y);

  for (const command of commands) {
    if (command.type === "M") {
      const transformed = point(command.x, command.y);
      targetPath.moveTo(transformed.x, transformed.y);
    } else if (command.type === "L") {
      const transformed = point(command.x, command.y);
      targetPath.lineTo(transformed.x, transformed.y);
    } else if (command.type === "Q") {
      const control = point(command.x1, command.y1);
      const end = point(command.x, command.y);
      targetPath.quadTo(control.x, control.y, end.x, end.y);
    } else if (command.type === "C") {
      const control1 = point(command.x1, command.y1);
      const control2 = point(command.x2, command.y2);
      const end = point(command.x, command.y);
      targetPath.curveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
    } else if (command.type === "Z") {
      targetPath.close();
    }
  }
}

function calculateGlyphTransform(normalized) {
  const inkTop = normalized.padding;
  const inkBottom = normalized.padding + normalized.bounds.height;
  const topDistance = Math.max(1, normalized.baseline - inkTop);
  const bottomDistance = Math.max(0, inkBottom - normalized.baseline);
  const topScale = FONT_METRICS.topLimit / topDistance;
  const bottomScale = bottomDistance > 0
    ? Math.abs(FONT_METRICS.bottomLimit) / bottomDistance
    : Number.POSITIVE_INFINITY;
  const widthScale = FONT_METRICS.maximumInkWidth / normalized.bounds.width;
  const scale = Math.min(topScale, bottomScale, widthScale);

  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("글리프 크기를 폰트 좌표로 정규화하지 못했습니다.");
  }

  return {
    scale,
    transform(x, y) {
      return {
        x: FONT_METRICS.sideBearing + (x - normalized.padding) * scale,
        y: (normalized.baseline - y) * scale,
      };
    },
  };
}

/* --------------------------------------------------------------------------
 * 4. SVG 좌표를 opentype.Path 좌표로 변환
 *
 * SVG는 Y가 아래로 증가하지만 폰트는 Y가 위로 증가한다. calculateGlyphTransform에서
 * Y축을 뒤집고, 기준선/ascender/descender/좌우 여백에 맞는 1000 UPM 좌표로 바꾼다.
 * ----------------------------------------------------------------------- */

function svgToOpenTypePath(svgString, normalized) {
  const documentParser = new DOMParser();
  const svgDocument = documentParser.parseFromString(svgString, "image/svg+xml");
  if (svgDocument.querySelector("parsererror")) {
    throw new Error("ImageTracer가 만든 SVG를 파싱하지 못했습니다.");
  }

  const darkPaths = Array.from(svgDocument.querySelectorAll("path")).filter(isDarkVisiblePath);
  if (darkPaths.length === 0) {
    throw new Error("SVG에서 글씨 윤곽선을 찾지 못했습니다.");
  }

  const glyphPath = new opentype.Path();
  const { scale, transform } = calculateGlyphTransform(normalized);
  let contourCount = 0;
  let holeCount = 0;

  for (const pathElement of darkPaths) {
    const commands = parseSvgPathData(pathElement.getAttribute("d"));
    const winding = inspectContourWinding(commands);
    contourCount += winding.contourCount;
    holeCount += winding.holeCount;
    appendCommandsToOpenTypePath(glyphPath, commands, transform);
  }

  return {
    path: glyphPath,
    scale,
    contourCount,
    holeCount,
    commandCount: glyphPath.commands.length,
  };
}

function glyphNameForCharacter(character) {
  // 현재 입력은 A-Z/a-z로 제한되므로 PostScript glyph name도 글자 그대로 쓴다.
  return character;
}

function prepareGlyphRecord(input) {
  if (!input || typeof input !== "object") {
    throw new Error("글리프 데이터 객체가 필요합니다.");
  }

  const character = assertEnglishLetter(input.character ?? input.char);
  const normalizedInput = input.normalized;
  const hasValidNormalizedData = isImageDataLike(normalizedInput?.imageData)
    && Number.isFinite(normalizedInput?.bounds?.x)
    && Number.isFinite(normalizedInput?.bounds?.y)
    && Number.isFinite(normalizedInput?.bounds?.width)
    && normalizedInput.bounds.width > 0
    && Number.isFinite(normalizedInput?.bounds?.height)
    && normalizedInput.bounds.height > 0
    && Number.isFinite(normalizedInput?.padding)
    && Number.isFinite(normalizedInput?.baseline);

  if (hasValidNormalizedData) {
    return {
      ...input,
      character,
      unicode: character.codePointAt(0),
      normalized: {
        ...normalizedInput,
        bounds: { ...normalizedInput.bounds },
        imageData: cloneImageData(normalizedInput.imageData),
      },
      advanceWidth: Number.isFinite(Number(input.advanceWidth))
        ? Number(input.advanceWidth)
        : null,
    };
  }

  const sourceImageData = sourceToImageData(input);
  const normalized = extractGlyphImageData(sourceImageData, {
    baseline: input.baseline,
    threshold: input.threshold,
    padding: input.padding,
  });

  return {
    character,
    unicode: character.codePointAt(0),
    normalized,
    advanceWidth: Number.isFinite(Number(input.advanceWidth))
      ? Number(input.advanceWidth)
      : null,
    addedAt: Date.now(),
  };
}

function removePreviewFace() {
  if (activePreviewFace && document.fonts?.delete) {
    document.fonts.delete(activePreviewFace);
  }
  activePreviewFace = null;
  if (elements.preview) elements.preview.style.fontFamily = "";
}

function invalidateBuild(message = "글자 또는 폰트 정보가 바뀌었습니다. 다시 생성·검증해 주세요.") {
  buildRevision += 1;
  removePreviewFace();
  if (elements.validationList) {
    elements.validationList.hidden = true;
    elements.validationList.replaceChildren();
  }
  if (message) setStatus(message, "idle");
}

/* --------------------------------------------------------------------------
 * 5. 선택적 글리프 저장소 API
 *
 * 다른 담당자는 글자를 한 개씩 registerGlyph()로 넘기거나, 완성된 배열을
 * registerGlyphs()로 한 번에 넘길 수 있다. 배치 등록은 먼저 전부 검증한 뒤
 * Map을 변경하므로 잘못된 한 글자 때문에 기존 데이터가 반쯤 교체되지 않는다.
 * ----------------------------------------------------------------------- */

/** 한 글자를 내부 저장소에 등록한다. 같은 글자는 최신 데이터로 교체한다. */
export function registerGlyph(input) {
  const record = prepareGlyphRecord(input);
  glyphStore.set(record.character, record);
  invalidateBuild(null);
  renderAlphabetStatus();

  window.dispatchEvent(new CustomEvent("handdimi:glyph-registered", {
    detail: { character: record.character, unicode: record.unicode },
  }));

  return prepareGlyphRecord(record);
}

/** 여러 영문 글자를 원자적으로 등록한다. */
export function registerGlyphs(inputs, { replace = false } = {}) {
  if (!Array.isArray(inputs)) {
    throw new Error("glyphs는 배열이어야 합니다.");
  }

  const preparedRecords = inputs.map(prepareGlyphRecord);
  if (replace) glyphStore.clear();
  for (const record of preparedRecords) {
    glyphStore.set(record.character, record);
  }

  invalidateBuild(null);
  renderAlphabetStatus();
  const letters = preparedRecords.map(({ character }) => character);
  window.dispatchEvent(new CustomEvent("handdimi:glyphs-registered", {
    detail: {
      letters,
      count: glyphStore.size,
      missingLetters: ENGLISH_LETTERS.filter((letter) => !glyphStore.has(letter)),
    },
  }));
  return getGlyphs();
}

export function removeGlyph(characterValue) {
  const character = assertEnglishLetter(characterValue);
  const removed = glyphStore.delete(character);
  if (removed) {
    invalidateBuild();
    renderAlphabetStatus();
  }
  return removed;
}

export function clearGlyphs() {
  glyphStore.clear();
  invalidateBuild();
  renderAlphabetStatus();
}

/** 외부 코드가 내부 상태를 바꾸지 못하도록 ImageData까지 복사해서 반환한다. */
export function getGlyphs() {
  return Array.from(glyphStore.values(), (record) => prepareGlyphRecord(record));
}

/* --------------------------------------------------------------------------
 * 6. opentype.Glyph 및 opentype.Font 생성
 * ----------------------------------------------------------------------- */

function createNotdefGlyph() {
  const path = new opentype.Path();
  path.moveTo(50, 0);
  path.lineTo(550, 0);
  path.lineTo(550, 700);
  path.lineTo(50, 700);
  path.close();
  path.moveTo(130, 100);
  path.lineTo(130, 600);
  path.lineTo(470, 600);
  path.lineTo(470, 100);
  path.close();

  return new opentype.Glyph({
    name: ".notdef",
    unicode: 0,
    advanceWidth: 600,
    path,
  });
}

function createSpaceGlyph() {
  return new opentype.Glyph({
    name: "space",
    unicode: 32,
    advanceWidth: FONT_METRICS.spaceWidth,
    path: new opentype.Path(),
  });
}

function createGlyphFromRecord(record) {
  const svg = traceImageDataToSvg(record.normalized.imageData);
  const vector = svgToOpenTypePath(svg, record.normalized);
  const maximumPathX = vector.path.commands.reduce((maximum, command) => {
    const values = [command.x, command.x1, command.x2].filter(Number.isFinite);
    return Math.max(maximum, ...values);
  }, FONT_METRICS.sideBearing);
  const calculatedAdvance = Math.ceil(maximumPathX + FONT_METRICS.sideBearing);
  const advanceWidth = record.advanceWidth == null
    ? Math.max(180, Math.min(2000, calculatedAdvance))
    : Math.max(1, Math.min(2000, Math.round(record.advanceWidth)));

  const glyph = new opentype.Glyph({
    name: glyphNameForCharacter(record.character),
    unicode: record.unicode,
    advanceWidth,
    path: vector.path,
  });

  return { glyph, svg, ...vector, advanceWidth };
}

function normalizeFontName(value, fallback) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 63);
  return normalized || fallback;
}

function validateFontBuffer(buffer, records, vectorDetails) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12) {
    throw new Error("생성된 폰트 데이터가 비어 있거나 손상되었습니다.");
  }

  const signature = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (signature !== "OTTO") {
    throw new Error(`OTF 시그니처가 올바르지 않습니다: ${JSON.stringify(signature)}`);
  }

  let parsedFont;
  try {
    parsedFont = opentype.parse(buffer.slice(0));
  } catch (error) {
    throw new Error(`opentype.parse() 재검증에 실패했습니다: ${error.message}`);
  }

  const expectedGlyphCount = records.length + 2;
  if (parsedFont.glyphs.length !== expectedGlyphCount) {
    throw new Error(`글리프 수가 일치하지 않습니다. 예상 ${expectedGlyphCount}, 실제 ${parsedFont.glyphs.length}`);
  }

  const notdefGlyph = parsedFont.glyphs.get(0);
  if (!notdefGlyph || (notdefGlyph.name && notdefGlyph.name !== ".notdef")) {
    throw new Error("0번 .notdef 글리프가 없습니다.");
  }

  const spaceIndex = parsedFont.charToGlyphIndex(" ");
  if (spaceIndex <= 0) {
    throw new Error("공백 글리프의 문자 매핑이 없습니다.");
  }

  for (const record of records) {
    const glyphIndex = parsedFont.charToGlyphIndex(record.character);
    if (glyphIndex <= 0) {
      throw new Error(`${record.character} 문자가 폰트 cmap에 매핑되지 않았습니다.`);
    }

    const glyph = parsedFont.glyphs.get(glyphIndex);
    const unicodeValues = Array.isArray(glyph.unicodes)
      ? glyph.unicodes
      : [glyph.unicode];
    if (!unicodeValues.includes(record.unicode)) {
      throw new Error(`${record.character} 글리프의 Unicode 값이 일치하지 않습니다.`);
    }

    if (!glyph.path?.commands?.length) {
      throw new Error(`${record.character} 글리프의 벡터 Path가 비어 있습니다.`);
    }
  }

  const holeCount = vectorDetails.reduce((sum, detail) => sum + detail.holeCount, 0);
  const commandCount = vectorDetails.reduce((sum, detail) => sum + detail.commandCount, 0);
  const providedLetters = new Set(records.map(({ character }) => character));
  const missingLetters = ENGLISH_LETTERS.filter((letter) => !providedLetters.has(letter));

  return {
    parsedFont,
    report: {
      signature,
      glyphCount: parsedFont.glyphs.length,
      mappedCharacterCount: records.length,
      holeCount,
      commandCount,
      byteLength: buffer.byteLength,
      missingLetters,
      isCompleteAlphabet: missingLetters.length === 0,
      checks: [
        "OTTO 시그니처 확인",
        ".notdef 및 공백 글리프 확인",
        `받은 영문 ${records.length}자 Unicode/cmap 매핑 확인`,
        `${commandCount}개 Path 명령 보존`,
        `opentype.parse() 재파싱 성공`,
      ],
    },
  };
}

function recordsFromInput(glyphs) {
  if (glyphs == null) return Array.from(glyphStore.values());
  if (!Array.isArray(glyphs)) throw new Error("glyphs는 배열이어야 합니다.");

  const deduplicated = new Map();
  for (const glyph of glyphs) {
    const record = prepareGlyphRecord(glyph);
    deduplicated.set(record.character, record);
  }
  return Array.from(deduplicated.values());
}

/**
 * 실제 CFF 기반 OpenType(.otf) ArrayBuffer를 만들고 같은 버퍼를 다시 파싱해 검증한다.
 * glyphs를 생략하면 registerGlyph()/registerGlyphs()로 등록한 내부 저장소를 사용한다.
 *
 * 글리프는 한 개 이상이면 충분하며 52자가 완성되지 않아도 받은 글자만 변환한다.
 *
 * @param {{ glyphs?: Array, familyName?: string, styleName?: string }} options
 * @returns {{ buffer: ArrayBuffer, font: object, parsedFont: object,
 *   report: object, validated: true }}
 */
export function createAndValidateFont(options = {}) {
  const familyName = normalizeFontName(options.familyName, DEFAULTS.familyName);
  const styleName = normalizeFontName(options.styleName, DEFAULTS.styleName);
  const records = recordsFromInput(options.glyphs)
    .sort((left, right) => left.unicode - right.unicode);

  if (records.length === 0) {
    throw new Error("폰트로 만들 글자가 없습니다.");
  }

  const glyphs = [createNotdefGlyph(), createSpaceGlyph()];
  const vectorDetails = [];

  for (const record of records) {
    const detail = createGlyphFromRecord(record);
    glyphs.push(detail.glyph);
    vectorDetails.push({
      character: record.character,
      svg: detail.svg,
      contourCount: detail.contourCount,
      holeCount: detail.holeCount,
      commandCount: detail.commandCount,
      advanceWidth: detail.advanceWidth,
    });
  }

  const font = new opentype.Font({
    familyName,
    styleName,
    unitsPerEm: FONT_METRICS.unitsPerEm,
    ascender: FONT_METRICS.ascender,
    descender: FONT_METRICS.descender,
    glyphs,
  });

  const buffer = font.toArrayBuffer();
  const validation = validateFontBuffer(buffer, records, vectorDetails);
  const result = {
    font,
    parsedFont: validation.parsedFont,
    buffer,
    familyName,
    styleName,
    records,
    glyphDetails: vectorDetails,
    report: validation.report,
    validated: true,
  };

  window.dispatchEvent(new CustomEvent("handdimi:font-ready", {
    detail: {
      familyName,
      styleName,
      buffer: result.buffer,
      report: result.report,
    },
  }));

  return result;
}

/**
 * 다른 담당자가 가장 간단히 사용할 수 있는 한 번 호출 API.
 * 받은 glyphs를 OTF로 변환·검증하고 변환 결과와 ArrayBuffer를 반환한다.
 */
export function convertToOtf({
  glyphs,
  familyName = DEFAULTS.familyName,
  styleName = DEFAULTS.styleName,
} = {}) {
  return createAndValidateFont({
    glyphs,
    familyName,
    styleName,
  });
}

// 함수 이름을 더 길고 명시적으로 쓰고 싶은 팀원을 위한 동일 함수 별칭이다.
export const convertGlyphsToOtf = convertToOtf;

async function installPreviewFont(result, expectedRevision) {
  if (!("FontFace" in window) || !document.fonts) return false;

  removePreviewFace();
  const previewFamily = `HANDDIMI_PREVIEW_${Date.now()}`;
  const fontFace = new FontFace(previewFamily, result.buffer.slice(0), {
    style: "normal",
    weight: "400",
  });
  const loadedFace = await fontFace.load();
  if (buildRevision !== expectedRevision) {
    throw new Error("생성 중 글자나 폰트 정보가 바뀌었습니다. 다시 생성해 주세요.");
  }
  document.fonts.add(loadedFace);
  activePreviewFace = loadedFace;
  if (elements.preview) elements.preview.style.fontFamily = `"${previewFamily}", sans-serif`;
  return true;
}

function setStatus(message, state = "idle") {
  if (!elements.status) return;
  elements.status.textContent = message;
  elements.status.dataset.state = state;
}

function ensureAlphabetCells(container, letters) {
  if (!container || container.childElementCount === letters.length) return;
  container.replaceChildren();
  for (const letter of letters) {
    const cell = document.createElement("span");
    cell.className = "letter-cell";
    cell.setAttribute("role", "listitem");
    cell.dataset.letter = letter;
    cell.textContent = letter;
    container.append(cell);
  }
}

/** A-Z/a-z 52칸에 현재 전달받은 글자를 표시한다. */
function renderAlphabetStatus() {
  ensureAlphabetCells(elements.uppercaseGrid, UPPERCASE_LETTERS);
  ensureAlphabetCells(elements.lowercaseGrid, LOWERCASE_LETTERS);

  const readyLetters = new Set(glyphStore.keys());
  const missingLetters = ENGLISH_LETTERS.filter((letter) => !readyLetters.has(letter));
  const uppercaseReady = UPPERCASE_LETTERS.filter((letter) => readyLetters.has(letter)).length;
  const lowercaseReady = LOWERCASE_LETTERS.filter((letter) => readyLetters.has(letter)).length;

  for (const container of [elements.uppercaseGrid, elements.lowercaseGrid]) {
    if (!container) continue;
    for (const cell of container.children) {
      const isReady = readyLetters.has(cell.dataset.letter);
      cell.classList.toggle("ready", isReady);
      cell.setAttribute("aria-label", `${cell.dataset.letter} ${isReady ? "받음" : "대기 중"}`);
    }
  }

  if (elements.receivedCount) elements.receivedCount.textContent = String(readyLetters.size);
  if (elements.uppercaseCount) elements.uppercaseCount.textContent = `${uppercaseReady} / 26`;
  if (elements.lowercaseCount) elements.lowercaseCount.textContent = `${lowercaseReady} / 26`;
  if (elements.generateFont) elements.generateFont.disabled = readyLetters.size === 0;

  if (elements.missingSummary) {
    if (readyLetters.size === 0) {
      elements.missingSummary.textContent = "그리기 화면에서 영문 글자 데이터를 기다리고 있습니다.";
    } else if (missingLetters.length === 0) {
      elements.missingSummary.textContent = "영문 대소문자 52자를 모두 받았습니다.";
    } else {
      elements.missingSummary.textContent = `${readyLetters.size}자 준비 · ${missingLetters.length}자 대기 중`;
    }
  }
}

function renderValidationReport(result, previewInstalled) {
  if (!elements.validationList) return;
  elements.validationList.replaceChildren();
  const checks = [...result.report.checks];
  checks.push(previewInstalled
    ? "브라우저 FontFace 로드 성공"
    : "FontFace 미지원 환경 — 재파싱 검증 완료");

  for (const check of checks) {
    const item = document.createElement("li");
    item.textContent = check;
    elements.validationList.append(item);
  }
  elements.validationList.hidden = false;
}

async function handleGenerateFont() {
  const requestedRevision = buildRevision;
  elements.generateFont.disabled = true;
  setStatus("ImageData 추출 → SVG 벡터화 → OTF 변환을 진행하고 있습니다…");
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  try {
    const result = createAndValidateFont({
      familyName: elements.familyName?.value ?? DEFAULTS.familyName,
      styleName: elements.styleName?.value ?? DEFAULTS.styleName,
    });
    const previewInstalled = await installPreviewFont(result, requestedRevision);
    renderValidationReport(result, previewInstalled);
    setStatus(
      `OTF ArrayBuffer 변환 완료 · ${result.report.mappedCharacterCount}자 · ${(result.report.byteLength / 1024).toFixed(1)}KB`,
      "success",
    );
  } catch (error) {
    removePreviewFace();
    setStatus(error.message, "error");
    console.error(error);
  } finally {
    elements.generateFont.disabled = glyphStore.size === 0;
  }
}

/* --------------------------------------------------------------------------
 * 7. font.html 변환 화면 연결
 *
 * 다른 페이지에서 이 파일의 함수를 import할 때 UI 요소가 없어도 순수 변환 API가
 * 동작하도록 모든 DOM 연결은 선택적으로 수행한다.
 * ----------------------------------------------------------------------- */

function bindConverterUi() {
  elements.previewText?.addEventListener("input", () => {
    if (elements.preview) elements.preview.textContent = elements.previewText.value || " ";
  });

  for (const input of [elements.familyName, elements.styleName].filter(Boolean)) {
    input.addEventListener("input", () => invalidateBuild());
  }

  elements.generateFont?.addEventListener("click", handleGenerateFont);

  renderAlphabetStatus();
}

// 같은 페이지의 다른 그리기 모듈은 CustomEvent로 완성된 글자 배열을 전달할 수 있다.
window.addEventListener("handdimi:glyphs-ready", (event) => {
  try {
    const incoming = event.detail?.glyphs;
    registerGlyphs(incoming, { replace: event.detail?.replace === true });
    setStatus(`영문 ${incoming.length}자를 그리기 화면에서 전달받았습니다.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

const publicApi = Object.freeze({
  version: "2.0.0",
  ENGLISH_LETTERS,
  UPPERCASE_LETTERS,
  LOWERCASE_LETTERS,
  registerGlyph,
  registerGlyphs,
  removeGlyph,
  clearGlyphs,
  getGlyphs,
  extractGlyphImageData,
  traceImageDataToSvg,
  parseSvgPathData,
  createAndValidateFont,
  convertToOtf,
  convertGlyphsToOtf,
});

window.HANDDIMIFont = publicApi;
window.HanddimiFont = publicApi;

bindConverterUi();
