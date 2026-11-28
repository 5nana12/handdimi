# HANDDIMI

브라우저에서 직접 그린 손글씨를 설치 가능한 OpenType 폰트(`.otf`)로 만들고, 그 폰트로 쓴 편지를 PNG 이미지로 저장하는 프로젝트입니다.

## 실행 방법

저장소 루트에서 로컬 HTTP 서버를 실행합니다.

```sh
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000/`을 엽니다. JavaScript 라이브러리는 esm.sh에서 불러오므로 인터넷 연결이 필요합니다. 작업 목록과 이어하기 데이터는 현재 브라우저에 저장됩니다.

## 작업 흐름

1. **시작 화면**에서 **시작하기**를 눌러 내 폰트 목록으로 이동합니다.
2. **내 폰트 목록**에서 새 작업의 이름을 정하거나 저장된 작업을 이어서 엽니다.
3. **그리기 화면**에서 영문 대문자 A–Z를 한 글자씩 그립니다. 글자 이동이나 전체 보기 버튼을 누르면 현재 획 좌표와 작업 진행도를 저장합니다.
4. **전체 보기**에서 그린 글자를 확인합니다. **다운로드 (.otf)**를 누르면 저장한 획에서 윤곽선을 추출하고 OTF를 생성·검증한 뒤 다운로드합니다. 지금까지 그린 글자만 폰트에 포함됩니다. 한글 등 ASCII 범위를 벗어나는 이름을 입력한 경우 파일명에는 입력한 이름을 사용하고, 설치용 이름은 버튼 아래에 표시합니다.
5. **이 폰트로 편지 쓰기**를 누르면 생성한 폰트가 편지 화면에 전달됩니다. 편지지를 선택하고 영문 내용을 입력한 뒤 PNG로 다운로드할 수 있습니다. 편지 화면의 **전체 보기**를 누르면 현재 작업의 폰트 화면으로 돌아갑니다.

```text
index.html → file.html → draw.html → font.html → letter.html
                ↑            │            └─ OTF 다운로드
                └────────────┘
                 내 폰트 목록
```

## 사용 라이브러리

| 라이브러리 | 버전 | 용도 |
| --- | --- | --- |
| p5.js | 1.11.3 | 그리기 캔버스, 획 좌표 입력, 편지 미리보기와 PNG 렌더링 |
| ImageTracerJS | 1.2.6 | 손글씨 이미지에 있는 획을 SVG 윤곽선으로 변환 |
| opentype.js | 1.3.4 | 윤곽선으로 OpenType 글리프와 OTF를 생성하고, 생성된 파일의 문자 매핑을 검증 |
| Tesseract.js | 6.0.1 | 이미지 OCR용으로 `main.js`에서 내보냅니다. 현재 페이지 흐름에서는 호출하지 않습니다. 추후 이미지로 글자를 읽을 때 사용합니다.

브라우저의 **IndexedDB**에는 현재 작업을, **localStorage**에는 작업 이름과 보관한 작업을 저장합니다. 편지 화면에 생성한 폰트를 전달할 때는 **sessionStorage**를 사용합니다.

## 파일 구조

```text
.
├── index.html
├── file.html
├── draw.html
├── font.html
├── letter.html
├── css/
│   ├── reset.css
│   └── style.css
├── js/
│   ├── main.js
│   ├── file.js
│   ├── draw.js
│   ├── font.js
│   ├── letter.js
│   ├── file-page.js
│   ├── draw-page.js
│   ├── font-page.js
│   └── letter-page.js
├── FONT_JS_GUIDE.md
└── README.md
```

### HTML 페이지

| 파일 | 역할 |
| --- | --- |
| [index.html](index.html) | 프로젝트 시작 화면입니다. 내 폰트 목록으로 이동합니다. |
| [file.html](file.html) | 내 폰트 목록, 진행도, 마지막 수정일과 새 폰트 만들기 대화상자를 표시합니다. |
| [draw.html](draw.html) | 글자별 그리기 캔버스와 되돌리기, 지우기, 글자 이동 버튼을 제공합니다. |
| [font.html](font.html) | 그린 글자 전체 보기, 폰트 이름 입력, OTF 다운로드, 편지 쓰기 이동을 제공합니다. |
| [letter.html](letter.html) | 폰트와 편지지 선택, 편지 내용 입력, 미리보기, PNG 다운로드, 폰트 전체 보기로 돌아가는 링크를 제공합니다. |

### JavaScript 기능 모듈

| 파일 | 역할 |
| --- | --- |
| [main.js](js/main.js) | 외부 라이브러리를 esm.sh에서 가져와 다른 모듈에 내보냅니다. |
| [file.js](js/file.js) | `continueWork()`로 현재 작업을 저장하거나 불러오고, `downloadFont()`로 OTF를 다운로드합니다. |
| [draw.js](js/draw.js) | p5.js 캔버스에서 획 좌표를 수집합니다. 되돌리기, 지우기, 이동, 임시저장과 이어하기를 처리합니다. |
| [font.js](js/font.js) | 글리프를 등록하고 손글씨 윤곽선을 추출해 OTF를 생성·검증합니다. 변환 API는 [FONT_JS_GUIDE.md](FONT_JS_GUIDE.md)에 정리되어 있습니다. |
| [letter.js](js/letter.js) | 편지 화면을 초기화하고, 폰트 적용, 편지지와 텍스트 렌더링, 전체 보기, PNG 다운로드를 처리합니다. |

### 페이지 연결 스크립트

`*-page.js`는 각 HTML에서 불러오는 진입점입니다. 버튼과 입력 요소를 기존 모듈에 연결하고, 페이지에 필요한 표시와 데이터 전달을 담당합니다.

| 파일 | 작성한 이유와 역할 |
| --- | --- |
| [file-page.js](js/file-page.js) | `file.html`에 저장된 작업 목록을 표시하고 새 작업이나 이어하기 버튼을 연결합니다. 현재 작업의 저장·불러오기는 `file.js`를 호출하고, 이전 작업은 목록에서 다시 열 수 있도록 보관합니다. |
| [draw-page.js](js/draw-page.js) | `draw.html` 제목에 현재 작업 이름을 표시합니다. 그리기 기능은 `draw.js`가 담당합니다. |
| [font-page.js](js/font-page.js) | `font.html`에서 저장된 획 데이터를 불러와 `font.js`에 등록하고 글자 미리보기를 표시하기 위해 작성했습니다. 버튼이 눌리면 변환과 다운로드 함수를 호출하고, 편지 쓰기를 선택하면 생성한 폰트를 편지 화면에 전달합니다. |
| [letter-page.js](js/letter-page.js) | `letter.html`에서 `letter.js`를 초기화하고 전달받은 폰트를 적용하기 위해 작성했습니다. 그리기에서 폰트 전체 보기로 이어지는 경로도 처리합니다. |

### 공통 CSS

- [reset.css](css/reset.css)는 브라우저 기본 여백과 폼 요소의 글꼴을 정리합니다.
- [style.css](css/style.css)는 공통 버튼, 입력 요소, 화면 배치와 반응형 스타일을 정의합니다.
