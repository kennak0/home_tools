// 画面の組み立て。ゲームのルールは map.js、描画は render.js、操作は input.js。
import { createCity, isValidSave, apply, toolFootprint, COST, W, H } from "./map.js";
import { createView } from "./render.js";
import { createInput } from "./input.js";
import { loadCity, saveCity, clearCity } from "./db.js";

const canvas = document.getElementById("map");
const fundsEl = document.getElementById("funds");
const messageEl = document.getElementById("message");
const toolbar = document.getElementById("toolbar");

let city;
let view;
let tool = "hand";

const yen = (n) => "¥" + n.toLocaleString("ja-JP");

function showFunds() {
  fundsEl.textContent = yen(city.funds);
  fundsEl.classList.toggle("low", city.funds < COST.zoneR);
}

let messageTimer = 0;
function showMessage(text) {
  messageEl.textContent = text ?? "";
  messageEl.hidden = !text;
  clearTimeout(messageTimer);
  if (text) messageTimer = setTimeout(() => { messageEl.hidden = true; }, 2200);
}

// 保存は変更のたびではなく、指を止めてからまとめて書く
let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCity(city).catch((e) => showMessage("保存できませんでした: " + e.message));
  }, 1000);
}

function setTool(next) {
  tool = next;
  for (const b of toolbar.querySelectorAll("button[data-tool]")) {
    b.setAttribute("aria-pressed", String(b.dataset.tool === next));
  }
  view.setCursor(null);
  showMessage("");
}

/** input.js から 1 マスごとに呼ばれる */
function paint(x, y) {
  const res = apply(city, tool, x, y);
  if (res.ok) {
    view.invalidate();
    showFunds();
    scheduleSave();
  } else if (res.reason) {
    showMessage(res.reason);
  }
  return res;
}

async function start() {
  let saved = null;
  try {
    saved = await loadCity();
  } catch (e) {
    showMessage("保存データを読めませんでした（新しい街で始めます）");
  }
  city = isValidSave(saved)
    ? { seed: saved.seed, terrain: saved.terrain, build: saved.build, zone: saved.zone, funds: saved.funds }
    : createCity();

  view = createView(canvas, city);
  view.resize();
  view.centerOn(W / 2, H / 2);
  showFunds();

  createInput(canvas, view, {
    paint,
    getTool: () => tool,
    getFootprint: () => toolFootprint(tool),
  });

  toolbar.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tool]");
    if (b) setTool(b.dataset.tool);
  });
  setTool("hand");

  document.getElementById("zoom-in").addEventListener("click", () => {
    view.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, Math.round(view.cam.scale) + 1);
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    view.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, Math.round(view.cam.scale) - 1);
  });

  document.getElementById("new-city").addEventListener("click", async () => {
    if (!confirm("いまの街を捨てて、新しい街を作ります。よろしいですか？")) return;
    clearTimeout(saveTimer);
    await clearCity().catch(() => {});
    const next = createCity();
    Object.assign(city, next); // view が持っている city の参照を保つ
    view.centerOn(W / 2, H / 2);
    view.invalidate();
    showFunds();
    scheduleSave();
    showMessage("新しい街を作りました");
  });

  // 画面の回転とキーボードの出入りで大きさが変わる
  new ResizeObserver(() => view.resize()).observe(canvas);
  // タブを離れるときは待たずに書く
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      clearTimeout(saveTimer);
      saveCity(city).catch(() => {});
    }
  });
}

start().catch((e) => {
  showMessage("起動できませんでした: " + e.message);
  console.error(e);
});
