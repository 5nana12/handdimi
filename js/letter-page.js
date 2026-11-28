// draw.js에서 저장 후 이동하면 전체 보기로 연결합니다.
const drawingPage = new URL("../draw.html", import.meta.url);
const cameFromDrawing = document.referrer && new URL(document.referrer).origin === drawingPage.origin
  && new URL(document.referrer).pathname === drawingPage.pathname;

if (cameFromDrawing) {
  location.replace("./font.html");
} else {
  const { addHandwritingFont, initLetter } = await import("./letter.js");

  const preview = document.querySelector("#preview");
  const download = document.querySelector("#btn-download");

  const previewObserver = new MutationObserver(() => {
    if (preview.querySelector("canvas")) {
      download.disabled = false;
      previewObserver.disconnect();
    }
  });
  previewObserver.observe(preview, { childList: true });

  initLetter();
  if (new URLSearchParams(location.search).get("font") === "custom") {
    try {
      const { familyName, url } = JSON.parse(sessionStorage.getItem("handdimi-letter-font"));
      await addHandwritingFont(url, familyName);
    } catch {
      document.querySelector("#letter-status").textContent = "내 폰트를 불러오지 못해 기본 폰트를 표시합니다.";
    }
  }
}
