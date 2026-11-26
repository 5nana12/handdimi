// file.js

/*
각 함수 호출 법(타 화면에서 호출되어야함)

-------------------------------------------------
1. otf 파일 다운로드

//파일상단 file.js 파일 임포트
import { downloadFont } from "./file.js";

downloadButton.addEventListener("click", () => {
  downloadFont(result); //result는 변환 완료된 폰트객체
});

-------------------------------------------------

2. 임시저장
import { continueWork } from "./file.js";

await continueWork("save", glyphs);


-------------------------------------------------

3. 이어하기
import { continueWork } from "./file.js";
const saved = await continueWork("load");

if (saved) {
  const glyphs = saved.data;
  // 기존 그리기 화면에 데이터 복원
}

*/

// 변환된 OTF 폰트 파일 다운로드
export function downloadFont(result, fileName = result?.familyName ?? "Handdimi") {
  const buffer = result instanceof ArrayBuffer ? result : result?.buffer;

  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4) {
    throw new Error("다운로드할 폰트 데이터가 없습니다.");
  }

  const header = new Uint8Array(buffer, 0, 4);

  if (String.fromCharCode(...header) !== "OTTO") {
    throw new Error("올바른 OTF 폰트 파일이 아닙니다.");
  }

  const name = String(fileName)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .trim()
    .replace(/\.otf$/i, "") || "Handdimi";

  const blob = new Blob([buffer], { type: "font/otf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${name}.otf`;

  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// 이어하기: 현재 작업 저장 또는 이전 작업 불러오기
// continueWork("save", 작업데이터), continueWork("load")
export async function continueWork(action = "load", data) {
  if (action !== "save" && action !== "load") {
    throw new Error("save 또는 load를 지정해 주세요.");
  }

  if (action === "save" && (data === undefined || data === null)) {
    throw new Error("저장할 작업 데이터가 없습니다.");
  }

  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("handdimi-file", 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore("projects");
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(
        "projects",
        action === "save" ? "readwrite" : "readonly"
      );

      const store = transaction.objectStore("projects");
      let result = null;

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(
        transaction.error ?? new Error("작업 저장소 접근이 중단되었습니다.")
      );

      if (action === "save") {
        // ImageData, 획 좌표 배열, ArrayBuffer 등 저장 가능
        // Canvas나 DOM 요소는 ImageData 등으로 변환한 뒤 전달해야 함
        result = { data, savedAt: Date.now() };
        store.put(result, "latest");
      } else {
        const request = store.get("latest");

        request.onsuccess = () => {
          result = request.result ?? null;
        };
      }
    });
  } finally {
    db.close();
  }
}