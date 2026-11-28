import { continueWork, downloadFont } from "./file.js";
import { convertToOtf, getGlyphs, registerGlyphs } from "./font.js";

const grid = document.querySelector("#uppercase-grid");
const name = document.querySelector("#family-name");
const download = document.querySelector("#download-font");
const write = document.querySelector("#write-letter");
const status = document.querySelector("#font-status");

function exportFont(displayName) {
  const normalized = displayName.normalize("NFC");
  if (/^[A-Za-z0-9][A-Za-z0-9 -]{0,47}$/.test(normalized)) {
    return convertToOtf({ familyName: normalized });
  }

  // opentype.js 1.3.4는 패밀리 이름을 CFF 및 PostScript 이름에도 사용합니다.
  // 설치용 이름은 ASCII로 만들고, 파일명과 편지 화면에는 입력한 이름을 표시합니다.
  let hash = 2166136261;
  for (const character of normalized) {
    hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  }
  const suffix = (hash >>> 0).toString(16).padStart(8, "0");
  return convertToOtf({ familyName: `Handdimi-${suffix}` });
}

download.addEventListener("click", () => {
  if (!name.reportValidity()) return;
  try {
    const displayName = name.value.trim() || "나의 첫 손글씨";
    const result = exportFont(displayName);
    downloadFont(result, displayName);
    status.textContent = `설치 후 폰트 이름: ${result.familyName}`;
  } catch (error) {
    status.textContent = error.message;
  }
});

function renderGlyphs() {
  const records = new Map(getGlyphs().map(record => [record.character, record]));
  for (const cell of grid.children) {
    const record = records.get(cell.dataset.letter);
    const preview = cell.querySelector("canvas");
    preview?.remove();
    if (!record) continue;
    const { imageData } = record.normalized;
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    canvas.setAttribute("aria-hidden", "true");
    cell.append(canvas);
  }
  download.disabled = write.disabled = records.size === 0;
}

write.addEventListener("click", () => {
  if (!name.reportValidity()) return;
  try {
    const familyName = name.value.trim() || "나의 첫 손글씨";
    const { buffer } = exportFont(familyName);
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        sessionStorage.setItem("handdimi-letter-font", JSON.stringify({ familyName, url: reader.result }));
        location.href = "./letter.html?font=custom";
      } catch {
        status.textContent = "편지에 사용할 폰트를 저장하지 못했습니다.";
      }
    });
    reader.addEventListener("error", () => {
      status.textContent = "편지에 사용할 폰트를 읽지 못했습니다.";
    });
    reader.readAsDataURL(new Blob([buffer], { type: "font/otf" }));
  } catch (error) {
    status.textContent = error.message;
  }
});

window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});

for (const event of ["handdimi:glyphs-registered", "handdimi:glyph-registered"]) {
  window.addEventListener(event, renderGlyphs);
}

try {
  name.value = localStorage.getItem("handdimi-active-name") || name.value;
  const { data } = await continueWork("load") ?? {};
  const glyphs = Object.entries(data?.letterStrokes ?? {})
    .filter(([, strokes]) => strokes.length)
    .map(([character, strokes]) => ({
      character, strokes, width: data.width, height: data.height,
      baseline: data.baseline, strokeWidth: data.strokeWidth,
    }));
  if (glyphs.length) registerGlyphs(glyphs);
} catch {
  status.textContent = "저장된 손글씨를 불러오지 못했습니다.";
}
