// 손글씨 입력 Canvas 및 좌표 수집
import p5 from "https://esm.sh/p5@1.11.3";
// Canvas 이미지의 벡터 윤곽선 추출
import ImageTracer from "https://esm.sh/imagetracerjs@1.2.6";
// 글리프 및 OTF 폰트 파일 생성
import * as opentype from "https://esm.sh/opentype.js@1.3.4";
// 업로드한 손글씨 이미지 OCR
import { createWorker } from "https://esm.sh/tesseract.js@6.0.1";

export {
  p5,
  ImageTracer,
  opentype,
  createWorker,
};