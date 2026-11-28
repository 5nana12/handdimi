# HANDDIMI `font.js` 연동 가이드

이 문서는 다음 두 담당자가 [`js/font.js`](./js/font.js)를 연결할 때 참고하는 문서입니다.

- 글자 그리기 담당: 완성된 손글씨 데이터를 `font.js`에 전달
- 다운로드 담당: 변환이 끝난 실제 OTF 데이터를 전달받아 사용

`font.js`는 다운로드를 실행하지 않습니다. 손글씨를 실제 OTF `ArrayBuffer`로 변환하고 검증한 뒤 반환하는 역할까지만 담당합니다.

## 1. 핵심 동작

처리 흐름은 다음과 같습니다.

1. `Canvas`, `ImageData`, 또는 획 좌표(`strokes`)를 받습니다.
2. 글씨 경계를 찾아 여백을 자르고 흑백 이미지로 정규화합니다.
3. ImageTracerJS로 글씨 윤곽선을 벡터화합니다.
4. opentype.js의 글리프와 Font 객체를 만듭니다.
5. 실제 OTF `ArrayBuffer`를 생성합니다.
6. 생성한 버퍼를 다시 열어 글리프와 Unicode 매핑을 검증합니다.

영문 대문자 `A-Z`와 소문자 `a-z`만 받을 수 있습니다. 52자를 전부 작성할 필요는 없고, **한 글자 이상만 있으면 작성된 글자만 OTF로 변환**됩니다.

## 2. 현재 모듈 연결 구조

외부 CDN 라이브러리는 `main.js`에서 한 번만 import하고 export합니다.

```javascript
// js/main.js
import p5 from "https://esm.sh/p5@1.11.3";
import ImageTracer from "https://esm.sh/imagetracerjs@1.2.6";
import * as opentype from "https://esm.sh/opentype.js@1.3.4";
import { createWorker } from "https://esm.sh/tesseract.js@6.0.1";

export {
  p5,
  ImageTracer,
  opentype,
  createWorker,
};
```

`font.js`는 CDN을 다시 호출하지 않고 `main.js`가 export한 ImageTracerJS와 opentype.js를 가져옵니다.

```javascript
// js/font.js
import {
  ImageTracer as ImageTracerModule,
  opentype as opentypeModule,
} from "./main.js";
```

HTML에서는 import map 없이 두 모듈을 선언합니다.

```html
<script type="module" src="./js/main.js"></script>
<script type="module" src="./js/font.js"></script>
```

`font.js`가 `main.js`를 import하더라도 브라우저의 ES module 캐시 때문에 `main.js`와 CDN 모듈은 다시 실행되지 않습니다. 이 구조에서는 순환 참조를 피하기 위해 `main.js`가 다시 `font.js`를 import하지 않아야 합니다.

CDN 모듈을 사용하므로 최초 페이지 실행 시에는 인터넷 연결이 필요합니다.

### ES module 방식 — 권장

다른 담당자의 JS에서는 CDN 주소를 다시 작성하지 않고, 사용할 함수만 `font.js`에서 가져옵니다.

```javascript
import {
  registerGlyph,
  registerGlyphs,
  getGlyphs,
  removeGlyph,
  clearGlyphs,
  convertToOtf,
} from "./js/font.js";
```

HTML에서 이미 `font.js`를 불러왔더라도 위 import로 중복 실행되지 않습니다.

### 전역 객체 방식

`font.html`에서 `font.js`가 로드된 뒤에는 아래 전역 객체도 사용할 수 있습니다.

```javascript
window.HANDDIMIFont.registerGlyph(...);
window.HANDDIMIFont.convertToOtf(...);
```

`HanddimiFont`도 같은 객체를 가리키지만, 코드에서는 `HANDDIMIFont` 사용을 권장합니다.

## 3. 글자 그리기 담당자가 넘길 데이터

각 글자는 하나의 객체로 전달합니다. `character`는 필수이며, 데이터 형식은 `canvas`, `imageData`, `strokes` 중 하나를 선택하면 됩니다.

### 방법 A: Canvas 전달 — 가장 간단함

```javascript
registerGlyph({
  character: "A",
  canvas: drawingCanvas,
  baseline: 320,
});
```

`canvas`에는 다음 객체를 사용할 수 있습니다.

- `HTMLCanvasElement`
- `OffscreenCanvas`
- p5 Renderer 객체(`.elt` 또는 `.canvas`를 가진 객체)

`baseline`은 원본 Canvas 위에서 글자가 놓이는 기준선의 Y 좌표입니다. 예를 들어 기준선이 Canvas 위쪽에서 320px 위치라면 `baseline: 320`을 전달합니다.

기준선을 생략하면 검출된 글씨의 아래쪽을 기준선으로 사용합니다. 대문자와 소문자의 높이를 자연스럽게 맞추려면 그리기 화면에서 사용하는 실제 기준선 값을 전달하는 것을 권장합니다.

### 방법 B: ImageData 전달

```javascript
const context = drawingCanvas.getContext("2d");
const imageData = context.getImageData(
  0,
  0,
  drawingCanvas.width,
  drawingCanvas.height,
);

registerGlyph({
  character: "B",
  imageData,
  baseline: 320,
});
```

### 방법 C: 획 좌표 전달

Canvas 대신 획 좌표를 그대로 전달할 수도 있습니다.

```javascript
registerGlyph({
  character: "C",
  width: 400,
  height: 400,
  baseline: 320,
  strokeWidth: 18,
  strokes: [
    [
      { x: 280, y: 90 },
      { x: 230, y: 60 },
      { x: 150, y: 80 },
      { x: 90, y: 160 },
      { x: 100, y: 270 },
      { x: 180, y: 330 },
      { x: 270, y: 310 },
    ],
  ],
});
```

좌표는 `{ x, y }` 또는 `[x, y]` 형태를 사용할 수 있습니다.

획마다 두께가 다르다면 아래 형태도 사용할 수 있습니다.

```javascript
registerGlyph({
  character: "D",
  width: 400,
  height: 400,
  baseline: 320,
  strokes: [
    {
      width: 14,
      points: [[80, 60], [80, 320]],
    },
    {
      width: 22,
      points: [[80, 60], [240, 80], [300, 190], [240, 300], [80, 320]],
    },
  ],
});
```

### 선택 옵션

```javascript
registerGlyph({
  character: "A",
  canvas: drawingCanvas,
  baseline: 320,
  threshold: 238,
  padding: 2,
  advanceWidth: 650,
});
```

| 속성 | 설명 |
| --- | --- |
| `character` 또는 `char` | 필수. `A-Z`, `a-z` 중 정확히 한 글자 |
| `baseline` | 원본 Canvas 기준선의 Y 좌표 |
| `threshold` | 글씨로 판정할 밝기 기준. 일반적으로 기본값 사용 |
| `padding` | 글씨 경계 바깥쪽에 남길 여백 |
| `advanceWidth` | 글자를 입력한 다음 커서가 이동할 폭. 생략하면 자동 계산 |

가이드라인까지 같은 Canvas에 그리면 가이드라인도 글씨로 인식될 수 있습니다. 가이드라인은 별도 Canvas나 HTML 요소로 표시하거나, 전달하기 전에 글씨만 남겨야 합니다. 투명 배경과 흰색 배경은 모두 사용할 수 있습니다.

## 4. 글자를 등록하는 방법

### 한 글자씩 등록

글자 저장 버튼을 누를 때마다 호출하는 방식입니다.

```javascript
function saveCurrentLetter(character, canvas, baseline) {
  return registerGlyph({
    character,
    canvas,
    baseline,
  });
}
```

같은 글자를 다시 등록하면 이전 데이터가 최신 데이터로 교체됩니다.

### 여러 글자를 한 번에 등록

```javascript
registerGlyphs([
  { character: "A", canvas: canvasA, baseline: 320 },
  { character: "B", canvas: canvasB, baseline: 320 },
  { character: "a", canvas: canvasLowerA, baseline: 320 },
], { replace: true });
```

- `replace: true`: 기존 등록 글자를 모두 지우고 전달한 배열로 교체
- `replace: false`: 기존 등록 글자를 유지하고 전달한 글자만 추가 또는 교체

기본값은 `replace: false`입니다.

### 등록 상태 확인 및 삭제

```javascript
const registeredGlyphs = getGlyphs();

removeGlyph("A");

clearGlyphs();
```

`getGlyphs()`는 현재 메모리에 등록된 글자 배열을 반환합니다.

### CustomEvent로 그리기 데이터를 전달

그리기 담당 코드에서 `font.js` 함수를 직접 import하기 어려운 구조라면 `handdimi:glyphs-ready` 이벤트로 여러 글자를 전달할 수 있습니다.

```javascript
window.dispatchEvent(new CustomEvent("handdimi:glyphs-ready", {
  detail: {
    glyphs: [
      { character: "A", canvas: canvasA, baseline: 320 },
      { character: "B", canvas: canvasB, baseline: 320 },
    ],
    replace: true,
  },
}));
```

- `detail.glyphs`: 등록할 글자 객체 배열
- `detail.replace: true`: 기존 등록 글자를 모두 지우고 전달한 배열로 교체
- `detail.replace: false`: 기존 글자를 유지하면서 추가 또는 교체

`font.js`는 한 글자 등록 후 `handdimi:glyph-registered`, 여러 글자 등록 후 `handdimi:glyphs-registered` 이벤트도 발생시킵니다. 상태 표시가 필요한 다른 모듈에서 선택적으로 구독할 수 있습니다.

## 5. OTF로 변환하는 방법

### 등록된 글자를 변환

앞에서 `registerGlyph()` 또는 `registerGlyphs()`로 등록했다면 `glyphs`를 다시 전달하지 않아도 됩니다.

```javascript
const result = convertToOtf({
  familyName: "HANDDIMI",
  styleName: "Regular",
});
```

### 등록 과정 없이 배열을 바로 변환

```javascript
const result = convertToOtf({
  glyphs: [
    { character: "A", canvas: canvasA, baseline: 320 },
    { character: "a", imageData: imageDataA, baseline: 320 },
  ],
  familyName: "HANDDIMI",
  styleName: "Regular",
});
```

이 방식에서 `glyphs` 배열에 같은 글자가 여러 번 들어 있으면 마지막 데이터가 사용됩니다.

## 6. 변환 결과

`convertToOtf()`의 주요 반환값은 다음과 같습니다.

```javascript
const result = convertToOtf({
  familyName: "HANDDIMI",
});

result.buffer;      // 실제 OTF 바이너리 ArrayBuffer
result.familyName;  // "HANDDIMI"
result.styleName;   // "Regular"
result.validated;   // 검증 성공 시 true
result.report;      // 검증 결과와 글자 수
```

다운로드 담당자에게 전달해야 하는 핵심 값은 **`result.buffer`**입니다. 이미지 파일이나 SVG가 아니라, opentype.js가 생성하고 다시 파싱해 검증한 실제 OTF 데이터입니다.

검증 보고서는 다음처럼 확인할 수 있습니다.

```javascript
console.log(result.report.signature);             // "OTTO"
console.log(result.report.mappedCharacterCount);  // 변환된 영문 글자 수
console.log(result.report.byteLength);            // OTF 바이트 크기
console.log(result.report.missingLetters);        // 작성되지 않은 영문 목록
console.log(result.report.isCompleteAlphabet);    // 52자 완성 여부
```

`missingLetters`와 `isCompleteAlphabet`은 상태 표시용 정보입니다. 52자가 완성되지 않아도 변환은 성공합니다.

## 7. 다운로드 담당자가 변환 결과를 받는 방법

이 문서에서는 다운로드 코드를 만들지 않고, 변환된 데이터를 받는 지점까지만 설명합니다.

### 방법 A: 반환값을 직접 전달 — 권장

```javascript
const convertedFont = convertToOtf({
  familyName: "HANDDIMI",
  styleName: "Regular",
});

// 다운로드 담당 코드에는 이 객체 또는 convertedFont.buffer를 전달합니다.
setConvertedFont(convertedFont);
```

다운로드 담당 코드가 받아야 하는 값은 다음과 같습니다.

```javascript
function setConvertedFont(convertedFont) {
  const otfArrayBuffer = convertedFont.buffer;
  const familyName = convertedFont.familyName;
  const styleName = convertedFont.styleName;

  // 이후 다운로드 구현에서 otfArrayBuffer를 사용합니다.
}
```

### 방법 B: `handdimi:font-ready` 이벤트로 받기

서로 다른 JS 파일이 직접 함수를 호출하기 어려운 구조라면, 다운로드 담당 코드에서 이벤트를 먼저 등록합니다.

```javascript
let latestConvertedFont = null;

window.addEventListener("handdimi:font-ready", (event) => {
  latestConvertedFont = event.detail;
});
```

변환이 성공할 때 `event.detail`에는 다음 값이 들어옵니다.

```javascript
event.detail.familyName;
event.detail.styleName;
event.detail.buffer;
event.detail.report;
```

이벤트는 변환이 실행되는 순간 한 번 발생하므로, **`convertToOtf()`를 호출하기 전에 이벤트 리스너를 등록**해야 합니다.

다운로드 버튼을 나중에 누르는 구조라면 이벤트에서 받은 값을 변수나 공용 상태에 보관한 뒤 사용하면 됩니다.

```javascript
let latestConvertedFont = null;

window.addEventListener("handdimi:font-ready", ({ detail }) => {
  latestConvertedFont = detail;
});

function getFontForDownload() {
  if (!latestConvertedFont) {
    throw new Error("먼저 글자를 OTF로 변환해 주세요.");
  }

  return latestConvertedFont.buffer;
}
```

## 8. 추천 역할 분리 예시

아래 담당자 코드에서는 ImageTracerJS나 opentype.js의 CDN을 다시 import할 필요가 없습니다. `font.js`의 공개 함수만 import하면 됩니다.

### 그리기 담당 코드

```javascript
import { registerGlyph } from "./js/font.js";

export function submitDrawing({ character, canvas, baseline }) {
  registerGlyph({
    character,
    canvas,
    baseline,
  });
}
```

### 변환을 실행하는 코드

```javascript
import { convertToOtf } from "./js/font.js";

export function buildHandwritingFont() {
  return convertToOtf({
    familyName: "HANDDIMI",
    styleName: "Regular",
  });
}
```

### 다운로드 담당 코드가 받는 형태

```javascript
const convertedFont = buildHandwritingFont();

// 실제 다운로드 구현에 전달할 OTF 데이터
const otfArrayBuffer = convertedFont.buffer;
```

## 9. 저장과 새로고침 시 주의점

`registerGlyph()`로 등록한 글자는 현재 페이지의 메모리에만 저장됩니다. 페이지를 새로고침하거나 닫으면 등록 상태가 사라집니다.

- 작은 획 좌표 JSON: `sessionStorage` 또는 `localStorage`에 저장 가능
- `ImageData`, OTF `ArrayBuffer`, Blob 등 큰 바이너리: IndexedDB 권장
- 같은 페이지에서 담당 코드끼리 전달: 반환값 또는 `handdimi:font-ready` 이벤트 권장

`localStorage`와 `sessionStorage`는 문자열만 저장할 수 있으므로 `ArrayBuffer`를 그대로 저장할 수 없습니다.

## 10. 자주 발생하는 오류

### `폰트로 만들 글자가 없습니다.`

등록된 글자가 없고 `convertToOtf()`에도 `glyphs`를 전달하지 않은 경우입니다. 한 글자 이상 등록해야 합니다.

### `영문 대문자 A-Z 또는 소문자 a-z 한 글자만 사용할 수 있습니다.`

`character`에 한글, 숫자, 기호, 빈 문자열 또는 여러 글자를 전달한 경우입니다.

### `canvas, imageData 또는 strokes 중 하나를 전달해 주세요.`

글자 객체에 실제 그리기 데이터가 없는 경우입니다.

### `글씨 픽셀을 찾지 못했습니다.`

Canvas가 비어 있거나 글씨 색상이 배경과 구분되지 않는 경우입니다. 전달 직전 Canvas에 실제 글씨가 남아 있는지 확인해야 합니다.

### 글자 대신 가이드라인까지 폰트에 포함됨

가이드라인이 글씨와 같은 Canvas에 렌더링된 경우입니다. `font.js`에 전달하는 Canvas/ImageData에는 글씨만 남겨야 합니다.

## 11. 공개 API 요약

| 함수 | 용도 |
| --- | --- |
| `registerGlyph(input)` | 글자 한 개 등록 또는 교체 |
| `registerGlyphs(inputs, options)` | 여러 글자 등록 |
| `getGlyphs()` | 현재 등록된 글자 배열 가져오기 |
| `removeGlyph(character)` | 특정 글자 삭제 |
| `clearGlyphs()` | 등록된 글자 전체 삭제 |
| `convertToOtf(options)` | 등록 글자 또는 전달한 배열을 실제 OTF로 변환하고 검증 |
| `convertGlyphsToOtf(options)` | `convertToOtf()`와 동일한 별칭 |
| `createAndValidateFont(options)` | 저수준 변환·검증 함수 |
| `extractGlyphImageData(imageData, options)` | 글씨 경계 추출과 흑백 정규화 |
| `traceImageDataToSvg(imageData)` | 정규화된 이미지를 SVG 윤곽선으로 변환 |

일반적인 연동에서는 `registerGlyph()`, `registerGlyphs()`, `convertToOtf()` 세 함수만 사용하면 됩니다.
