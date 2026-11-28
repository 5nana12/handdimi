/* =========================================================
 *  letter.js — 편지지 제작 & 이미지 다운로드
 *
 *  - 메인 모듈에서 p5, opentype을 가져와 사용
 *  - 손글씨 담당 파트가 만든 OTF 폰트(opentype.Font / ArrayBuffer / Blob / URL)를
 *    addHandwritingFont()로 받아 편지에 적용
 *  - 편지지(줄노트·무지·격자), 내용 입력(A–Z), 미리보기, 전체 보기, PNG 다운로드
 * ========================================================= */

import { p5, opentype } from "./main.js"; // ← 메인 모듈 파일명이 다르면 여기만 수정

// ---------- 편지지 규격 (px) ----------
const PAPER = {
  width: 952,
  minHeight: 600,
  marginX: 40,       // 줄/격자 좌우 여백
  textX: 50,         // 글자 시작 x
  firstLine: 115,    // 첫 줄 y
  lineGap: 46,       // 줄 간격
  gridSize: 23,      // 격자 한 칸 (lineGap의 절반)
  bottomPad: 60,
  fontSize: 34,
  baselineOffset: 8  // 글자를 줄보다 살짝 위로
};

const COLORS = {
  paper: "#ffffff",
  line: "#dcdcdc",
  grid: "#e8e8e8",
  ink: "#222222"
};

const DOWNLOAD_DENSITY = 2;      // 다운로드 해상도 배율
const FALLBACK_FAMILY = "Gochi Hand";
const ALLOWED = /[^A-Z .,!?'\n]/g; // 입력 허용 문자 외 제거

// ---------- 폰트 목록 ----------
// 첫 항목은 손글씨 폰트 자리. 폰트가 들어오기 전에는 대체 폰트로 보여줌
const FONTS = [
  { id: "my-hand", label: "나의 첫 손글씨", family: null },
  { id: "gochi",   label: "Gochi Hand",   family: "Gochi Hand" },
  { id: "patrick", label: "Patrick Hand", family: "Patrick Hand" },
  { id: "caveat",  label: "Caveat",       family: "Caveat" },
  { id: "indie",   label: "Indie Flower", family: "Indie Flower" }
];

const state = {
  fontId: FONTS[0].id,
  paper: "lined",
  text: ""
};

let P = null;   // p5 인스턴스
let ui = {};
let fontSeq = 0;

// =========================================================
//  공개 API
// =========================================================

/**
 * 편지 화면 시작
 * @param {object} [opts]
 * @param {string} [opts.previewId="preview"] 캔버스를 넣을 요소 id
 */
export function initLetter({ previewId = "preview" } = {}) {
  if (P) return P;
  bindUI();
  state.text = sanitize(ui.textarea.value);
  ui.textarea.value = state.text;

  P = new p5((p) => {
    p.setup = () => {
      p.createCanvas(PAPER.width, PAPER.minHeight).parent(previewId);
      p.noLoop();
      applyFont();
    };
    p.draw = () => {
      const layout = makeLayout(p);
      if (p.height !== layout.height) p.resizeCanvas(PAPER.width, layout.height);
      drawLetter(p, layout);
    };
  });
  return P;
}

/**
 * 손글씨 폰트 등록 → 폰트 목록에 반영하고 바로 선택
 * @param {opentype.Font|ArrayBuffer|Uint8Array|Blob|string} source
 *        opentype.Font 객체, 폰트 바이너리, Blob/File, 또는 폰트 파일 URL
 * @param {string} [label="나의 첫 손글씨"] 목록에 보일 이름 (같은 이름이면 교체)
 */
export async function addHandwritingFont(source, label = "나의 첫 손글씨") {
  const buffer = await toArrayBuffer(source);

  // 폰트에 실제로 들어있는 글자 확인 (빠진 글자 경고용)
  let missing = [];
  try {
    const parsed = opentype.parse(buffer.slice(0));
    missing = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].filter(
      (ch) => parsed.charToGlyphIndex(ch) === 0
    );
  } catch (err) {
    throw new Error(`[letter] 폰트 파일을 읽을 수 없습니다: ${err.message}`);
  }
  if (missing.length) {
    console.warn(`[letter] '${label}'에 없는 글자: ${missing.join(" ")} (기본 폰트로 표시됨)`);
  }

  // 브라우저에 폰트 등록 → p5 textFont(family)로 사용
  const family = `Handwriting_${++fontSeq}`;
  const face = new FontFace(family, buffer);
  await face.load();
  document.fonts.add(face);

  let font = FONTS.find((f) => f.label === label);
  if (font) {
    if (font.face) document.fonts.delete(font.face); // 이전 버전 폰트 정리
    Object.assign(font, { family, face });
  } else {
    font = { id: family, label, family, face };
    FONTS.push(font);
  }

  state.fontId = font.id;
  renderFontOptions();
  applyFont();
  return { family, missing };
}

/** 현재 편지를 PNG dataURL로 반환 (서버 저장, 공유 등에 사용) */
export function getLetterDataURL(density = DOWNLOAD_DENSITY) {
  const pg = renderOffscreen(density);
  const url = pg.elt.toDataURL("image/png");
  pg.remove();
  return url;
}

/** 현재 편지를 PNG Blob으로 반환 */
export function getLetterBlob(density = DOWNLOAD_DENSITY) {
  const pg = renderOffscreen(density);
  return new Promise((resolve) => {
    pg.elt.toBlob((blob) => { pg.remove(); resolve(blob); }, "image/png");
  });
}

/** 편지 내용 직접 지정 */
export function setLetterText(text) {
  state.text = sanitize(text);
  if (ui.textarea) ui.textarea.value = state.text;
  P?.redraw();
}

/** 편지지 종류 지정: "lined" | "blank" | "grid" */
export function setPaper(type) {
  state.paper = type;
  ui.paperBtns?.forEach((b) => {
    const on = b.dataset.paper === type;
    b.classList.toggle("selected", on);
    b.setAttribute("aria-checked", on);
  });
  P?.redraw();
}

export function downloadLetter() {
  const pg = renderOffscreen(DOWNLOAD_DENSITY);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  P.saveCanvas(pg, `letter_${stamp}`, "png");
  pg.remove();
}

// =========================================================
//  UI 연결
// =========================================================
function bindUI() {
  ui.select = document.getElementById("font-select");
  ui.textarea = document.getElementById("letter-text");
  ui.paperBtns = document.querySelectorAll(".paper-option");
  ui.modal = document.getElementById("modal");
  ui.modalImg = document.getElementById("modal-img");

  renderFontOptions();

  ui.select.addEventListener("change", () => {
    state.fontId = ui.select.value;
    applyFont();
  });

  ui.paperBtns.forEach((btn) =>
    btn.addEventListener("click", () => setPaper(btn.dataset.paper))
  );

  ui.textarea.addEventListener("input", onTextInput);

  document.getElementById("btn-fullview").addEventListener("click", openFullView);
  document.getElementById("btn-download").addEventListener("click", downloadLetter);
  document.getElementById("modal-close").addEventListener("click", closeFullView);
  ui.modal.addEventListener("click", (e) => { if (e.target === ui.modal) closeFullView(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeFullView(); });
}

function renderFontOptions() {
  ui.select.innerHTML = "";
  FONTS.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.label;
    ui.select.appendChild(opt);
  });
  ui.select.value = state.fontId;
}

function sanitize(str) {
  return str.toUpperCase().replace(ALLOWED, "");
}

function onTextInput() {
  const el = ui.textarea;
  const caret = el.selectionStart;
  const before = sanitize(el.value.slice(0, caret)); // 커서 위치 유지
  const clean = sanitize(el.value);
  if (clean !== el.value) {
    el.value = clean;
    el.setSelectionRange(before.length, before.length);
  }
  state.text = clean;
  P?.redraw();
}

// =========================================================
//  폰트
// =========================================================
function currentFont() {
  return FONTS.find((f) => f.id === state.fontId) || FONTS[0];
}

function familyOf(font) {
  return font.family || FALLBACK_FAMILY;
}

async function applyFont() {
  try {
    await document.fonts.load(`${PAPER.fontSize}px "${familyOf(currentFont())}"`);
  } catch (_) { /* 로드 실패 시 기본 폰트로 그림 */ }
  P?.redraw();
}

async function toArrayBuffer(source) {
  if (source && typeof source.toArrayBuffer === "function") return source.toArrayBuffer(); // opentype.Font
  if (source instanceof ArrayBuffer) return source;
  if (ArrayBuffer.isView(source)) {
    return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  }
  if (source instanceof Blob) return source.arrayBuffer();
  if (typeof source === "string") {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`[letter] 폰트 파일을 불러오지 못했습니다: ${source}`);
    return res.arrayBuffer();
  }
  throw new Error("[letter] 지원하지 않는 폰트 형식입니다.");
}

// =========================================================
//  줄바꿈 / 레이아웃
// =========================================================
function setInk(g) {
  g.textFont(familyOf(currentFont()));
  g.textSize(PAPER.fontSize);
  g.textAlign(g.LEFT ?? P.LEFT, g.BASELINE ?? P.BASELINE);
  g.noStroke();
  g.fill(COLORS.ink);
}

// 단어 단위 자동 줄바꿈 (한 단어가 너무 길면 글자 단위로 자름)
function wrapText(g, text, maxW) {
  const rows = [];
  for (const para of text.split("\n")) {
    if (para.trim() === "") { rows.push(""); continue; }
    let line = "";
    for (const word of para.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (g.textWidth(test) <= maxW) { line = test; continue; }
      if (line) rows.push(line);
      let chunk = "";
      for (const ch of word) {
        if (chunk && g.textWidth(chunk + ch) > maxW) { rows.push(chunk); chunk = ""; }
        chunk += ch;
      }
      line = chunk;
    }
    rows.push(line);
  }
  return rows;
}

function makeLayout(g) {
  setInk(g);
  const maxW = PAPER.width - PAPER.textX - PAPER.marginX;
  const rows = wrapText(g, state.text, maxW);

  let used = rows.length;
  while (used > 0 && rows[used - 1] === "") used--; // 끝의 빈 줄 제외

  const contentBottom = PAPER.firstLine + Math.max(used - 1, 0) * PAPER.lineGap;
  const height = Math.max(PAPER.minHeight, contentBottom + PAPER.lineGap + PAPER.bottomPad);
  return { rows, height };
}

// =========================================================
//  그리기 (미리보기·다운로드 공용)
// =========================================================
function drawLetter(g, layout) {
  g.background(COLORS.paper);
  drawPaper(g, layout.height);
  drawText(g, layout.rows);
}

function drawPaper(g, h) {
  const left = PAPER.marginX;
  const right = PAPER.width - PAPER.marginX;
  g.strokeWeight(1);

  if (state.paper === "lined") {
    const bottom = h - PAPER.bottomPad + PAPER.lineGap / 2;
    g.stroke(COLORS.line);
    for (let y = PAPER.firstLine; y <= bottom; y += PAPER.lineGap) {
      g.line(left, y + 0.5, right, y + 0.5);
    }
  } else if (state.paper === "grid") {
    const s = PAPER.gridSize;
    const top = PAPER.firstLine % s || s;
    const bottom = top + Math.floor((h - s - top) / s) * s;
    g.stroke(COLORS.grid);
    for (let y = top; y <= bottom; y += s) g.line(left, y + 0.5, right, y + 0.5);
    for (let x = left; x <= right + 0.1; x += s) g.line(x + 0.5, top, x + 0.5, bottom);
  }
  // blank(무지): 선 없음
}

function drawText(g, rows) {
  setInk(g);
  rows.forEach((row, i) => {
    const y = PAPER.firstLine + i * PAPER.lineGap - PAPER.baselineOffset;
    g.text(row, PAPER.textX, y);
  });
}

// =========================================================
//  전체 보기 / 오프스크린 렌더
// =========================================================
function renderOffscreen(density) {
  const pg = P.createGraphics(PAPER.width, PAPER.minHeight);
  const layout = makeLayout(pg);
  pg.resizeCanvas(PAPER.width, layout.height);
  pg.pixelDensity(density);
  drawLetter(pg, layout);
  return pg;
}

function openFullView() {
  ui.modalImg.src = getLetterDataURL();
  ui.modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeFullView() {
  if (ui.modal.hidden) return;
  ui.modal.hidden = true;
  document.body.style.overflow = "";
}