import { continueWork } from "./file.js";

const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const nameKey = "handdimi-active-name";
const archiveKey = "handdimi-font-archive";
const status = document.querySelector("#library-status");
const dialog = document.querySelector("#new-font-dialog");
const form = document.querySelector("#new-font-form");
const nameField = document.querySelector("#new-font-name");
const newButton = document.querySelector("#new-font");
const rows = document.querySelector("#font-rows");
let active;
let archive;
let switching = false;

async function openProject(project, nextArchive) {
  if (switching) return;
  switching = true;
  try {
    if (active) {
      localStorage.setItem(archiveKey, JSON.stringify([...archive, active]));
    }
    await continueWork("save", project.data);
    localStorage.setItem(archiveKey, JSON.stringify(nextArchive));
    localStorage.setItem(nameKey, project.name);
    location.href = "./draw.html";
  } catch {
    const error = dialog.open ? document.querySelector("#new-font-status") : status;
    error.textContent = "작업을 열 수 없습니다. 브라우저 저장 공간을 확인해 주세요.";
    switching = false;
  }
}

function appendProject(project, index) {
  const strokes = project.data.letterStrokes ?? {};
  const drawn = [...letters].filter(letter => strokes[letter]?.length).length;
  const nextLetter = letters[project.data.currentIndex] ?? "A";
  const row = rows.insertRow();
  row.insertCell().textContent = project.name;
  row.insertCell().textContent = `${drawn} / 26`;
  row.insertCell().textContent = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium", timeStyle: "short",
  }).format(project.savedAt);
  const action = document.createElement("button");
  action.type = "button";
  action.className = "text-button";
  action.textContent = drawn === 26 ? "글자 수정하기 →" : `${nextLetter}부터 이어하기 →`;
  action.addEventListener("click", () => {
    if (index === -1) {
      location.href = "./draw.html";
      return;
    }
    openProject(project, [...archive.filter((_, i) => i !== index), ...(active ? [active] : [])]);
  });
  row.insertCell().append(action);
}

window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});

newButton.addEventListener("click", () => dialog.showModal());
document.querySelector("#cancel-new-font").addEventListener("click", () => dialog.close());
nameField.addEventListener("input", () => nameField.setCustomValidity(""));
form.addEventListener("submit", event => {
  event.preventDefault();
  const name = nameField.value.trim();
  if (!name) {
    nameField.setCustomValidity("폰트 이름을 입력해 주세요.");
    nameField.reportValidity();
    return;
  }
  openProject({ name, data: { letterStrokes: {}, currentIndex: 0 } },
    active ? [...archive, active] : archive);
});

try {
  const saved = await continueWork("load");
  active = saved && { ...saved, name: localStorage.getItem(nameKey) || "나의 첫 손글씨" };
  archive = JSON.parse(localStorage.getItem(archiveKey) || "[]");
  if (active) appendProject(active, -1);
  archive.forEach(appendProject);
  document.querySelector("#empty-library").hidden = Boolean(rows.rows.length);
  document.querySelector("#font-library").hidden = !rows.rows.length;
  newButton.disabled = false;
} catch {
  status.textContent = "저장된 폰트 목록을 불러오지 못했습니다.";
}
