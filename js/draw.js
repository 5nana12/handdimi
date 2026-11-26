import { p5 } from "./main.js";
import { registerGlyph, removeGlyph } from "./font.js";
import { continueWork } from "./file.js";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const CANVAS_WIDTH = 1118;
const CANVAS_HEIGHT = 478;
const PEN_SIZE = 18;

const GUIDE_LINES = [
  { name: "윗선", y: 62 },
  { name: "중간선", y: 178 },
  { name: "기준선", y: 299 },
  { name: "아랫선", y: 365 },
];
const BASELINE_Y = 299;

const OVERVIEW_PAGE = "./letter.html";
const MY_FONTS_PAGE = "./file.html";

let currentIndex = 0;
let letterStrokes = {};
let currentStroke = null;

LETTERS.forEach((letter) => {
  letterStrokes[letter] = [];
});

function currentLetter() {
  return LETTERS[currentIndex];
}

const sketch = (p) => {
  p.setup = () => {
    const canvas = p.createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    canvas.parent("canvas-box");

    canvas.mousePressed(startStroke);
    canvas.touchStarted(startStroke);
  };

  p.draw = () => {
    p.background(255);
    drawGuideLines(p);

    if (currentStroke && p.mouseIsPressed) {
      addPoint(p.mouseX, p.mouseY);
    }

    p.stroke(34);
    p.strokeWeight(PEN_SIZE);
    p.strokeCap(p.ROUND);
    p.strokeJoin(p.ROUND);
    p.noFill();

    for (const stroke of letterStrokes[currentLetter()]) {
      drawStroke(p, stroke);
    }
  };

  p.mouseReleased = endStroke;
  p.touchEnded = endStroke;

  function startStroke() {
    currentStroke = [];
    letterStrokes[currentLetter()].push(currentStroke);
    addPoint(p.mouseX, p.mouseY);
    return false;
  }

  function addPoint(x, y) {
    x = p.constrain(x, 0, CANVAS_WIDTH);
    y = p.constrain(y, 0, CANVAS_HEIGHT);

    const last = currentStroke[currentStroke.length - 1];
    if (last && p.dist(last.x, last.y, x, y) < 2) return;

    currentStroke.push({ x: Math.round(x), y: Math.round(y) });
  }

  function endStroke() {
    currentStroke = null;
  }
};

function drawGuideLines(p) {
  p.textSize(10);
  p.textAlign(p.LEFT, p.CENTER);

  for (const line of GUIDE_LINES) {
    p.stroke(line.y === BASELINE_Y ? 140 : 210);
    p.strokeWeight(1);
    p.line(31, line.y, 1041, line.y);

    p.noStroke();
    p.fill(60);
    p.text(line.name, 974, line.y - 3);
  }
}

function drawStroke(p, stroke) {
  if (stroke.length === 1) {
    p.point(stroke[0].x, stroke[0].y);
    return;
  }

  p.beginShape();
  for (const point of stroke) {
    p.vertex(point.x, point.y);
  }
  p.endShape();
}

new p5(sketch);

function sendLetterToFont(letter) {
  const strokes = letterStrokes[letter];

  if (strokes.length === 0) {
    removeGlyph(letter);
    return;
  }

  registerGlyph({
    character: letter,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    baseline: BASELINE_Y,
    strokeWidth: PEN_SIZE,
    strokes: strokes,
  });
}

async function saveWork() {
  try {
    await continueWork("save", {
      letterStrokes,
      currentIndex,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      baseline: BASELINE_Y,
      strokeWidth: PEN_SIZE,
    });
  } catch (error) {
    console.error("임시저장 실패:", error);
  }
}

async function loadWork() {
  try {
    const saved = await continueWork("load");
    if (!saved || !saved.data || !saved.data.letterStrokes) return;

    for (const letter of LETTERS) {
      letterStrokes[letter] = saved.data.letterStrokes[letter] || [];
      if (letterStrokes[letter].length > 0) {
        sendLetterToFont(letter);
      }
    }
    currentIndex = saved.data.currentIndex || 0;
    updateScreen();
  } catch (error) {
    console.error("이어하기 불러오기 실패:", error);
  }
}

const letterText = document.getElementById("current-letter");
const progressText = document.getElementById("progress");
const prevButton = document.getElementById("btn-prev");
const nextButton = document.getElementById("btn-next");

function updateScreen() {
  letterText.textContent = currentLetter();
  progressText.textContent = `${currentIndex + 1} / ${LETTERS.length}`;

  prevButton.disabled = currentIndex === 0;

  const isLast = currentIndex === LETTERS.length - 1;
  nextButton.textContent = isLast ? "완성하기" : "다음 글자";
}

async function saveCurrentLetter() {
  sendLetterToFont(currentLetter());
  await saveWork();
}

document.getElementById("btn-undo").addEventListener("click", () => {
  letterStrokes[currentLetter()].pop();
});

document.getElementById("btn-clear").addEventListener("click", () => {
  letterStrokes[currentLetter()] = [];
});

prevButton.addEventListener("click", async () => {
  if (currentIndex === 0) return;
  await saveCurrentLetter();
  currentIndex--;
  updateScreen();
});

nextButton.addEventListener("click", async () => {
  await saveCurrentLetter();

  if (currentIndex < LETTERS.length - 1) {
    currentIndex++;
    updateScreen();
  } else {
    location.href = OVERVIEW_PAGE;
  }
});

document.getElementById("btn-overview").addEventListener("click", async () => {
  await saveCurrentLetter();
  location.href = OVERVIEW_PAGE;
});

document.getElementById("btn-my-fonts").addEventListener("click", async () => {
  await saveCurrentLetter();
  location.href = MY_FONTS_PAGE;
});

updateScreen();
loadWork();
