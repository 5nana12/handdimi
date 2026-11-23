// 손글씨 입력 Canvas 및 좌표 수집
import p5 from "p5";
// Canvas 이미지의 벡터 윤곽선 추출
import ImageTracer from "imagetracerjs";
// 글리프 및 OTF 폰트 파일 생성
import * as opentype from "opentype.js";
// 업로드한 손글씨 이미지 OCR
import { createWorker } from "tesseract.js";
