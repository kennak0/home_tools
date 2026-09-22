// タイルの絵をコードで描いて 1 枚のアトラスに焼く。
// 外部の画像を読まない（`.claude/AGENTS.md`「外部リソース」）ので、素材はここで作る。
// 1 セル 16x16、8 列。セル番号は下の ATLAS.* から引く。
import { TILE } from "./map.js";

const COLS = 8;
const ROWS = 4;

export const ATLAS = {
  LAND_A: 0,
  LAND_B: 1,
  WATER: 2,
  TREE: 3,
  ROAD: 4,      // +0..15（北=1 東=2 南=4 西=8 のビットマスク）
  ZONE_R: 20,   // +0..8（dy*3+dx）
};

const C = {
  grass: "#6d9a46",
  grassDark: "#5f8b3d",
  grassLight: "#7dab52",
  water: "#3a76b8",
  waterLight: "#5089c7",
  waterDark: "#2f639b",
  trunk: "#5a4326",
  leaf: "#2f6b2c",
  leafLight: "#3d8437",
  road: "#585a5e",
  roadEdge: "#424447",
  roadLine: "#d8cf7a",
  lot: "#b3a582",
  lotEdge: "#7d7255",
  house: "#4a7c3f",
  houseLight: "#63a054",
};

function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawGrass(ctx, variant) {
  px(ctx, 0, 0, TILE, TILE, C.grass);
  // 固定位置の斑点。乱数にすると再読み込みで絵が変わってしまう
  const spots = variant === 0
    ? [[2, 3], [9, 1], [5, 8], [12, 6], [3, 12], [11, 13]]
    : [[6, 2], [1, 7], [13, 4], [8, 10], [4, 14], [14, 11]];
  for (const [x, y] of spots) px(ctx, x, y, 2, 1, C.grassDark);
  px(ctx, variant === 0 ? 7 : 2, variant === 0 ? 5 : 11, 1, 1, C.grassLight);
}

function drawWater(ctx) {
  px(ctx, 0, 0, TILE, TILE, C.water);
  px(ctx, 0, 0, TILE, 1, C.waterDark);
  px(ctx, 2, 3, 6, 1, C.waterLight);
  px(ctx, 9, 7, 5, 1, C.waterLight);
  px(ctx, 4, 11, 7, 1, C.waterLight);
  px(ctx, 11, 13, 3, 1, C.waterDark);
}

function drawTree(ctx) {
  drawGrass(ctx, 0);
  // 2 本ぶん。幹 → 葉の順
  for (const [bx, by] of [[3, 5], [9, 3]]) {
    px(ctx, bx + 2, by + 5, 2, 3, C.trunk);
    px(ctx, bx, by + 1, 6, 4, C.leaf);
    px(ctx, bx + 1, by, 4, 6, C.leaf);
    px(ctx, bx + 1, by + 1, 2, 2, C.leafLight);
  }
  px(ctx, 5, 12, 5, 3, C.leaf);
  px(ctx, 6, 11, 3, 1, C.leafLight);
}

// 接続マスク（北=1 東=2 南=4 西=8）から道路を描く。
// 芝の上に幅 8px の帯を敷き、つながっている方向だけ端まで伸ばす
function drawRoad(ctx, mask) {
  drawGrass(ctx, 0);
  const a = 4, b = 12; // 帯の範囲 [4,12)
  px(ctx, a, a, 8, 8, C.road);
  if (mask & 1) px(ctx, a, 0, 8, a, C.road);
  if (mask & 2) px(ctx, b, a, TILE - b, 8, C.road);
  if (mask & 4) px(ctx, a, b, 8, TILE - b, C.road);
  if (mask & 8) px(ctx, 0, a, a, 8, C.road);

  // 縁。つながっていない側だけ影を落として、行き止まりが分かるようにする
  if (!(mask & 1)) px(ctx, a, a, 8, 1, C.roadEdge);
  if (!(mask & 4)) px(ctx, a, b - 1, 8, 1, C.roadEdge);
  if (!(mask & 8)) px(ctx, a, a, 1, 8, C.roadEdge);
  if (!(mask & 2)) px(ctx, b - 1, a, 1, 8, C.roadEdge);

  // 中央線。直線のときだけ引く（交差点や曲がり角に線があると読みにくい）
  const straightV = mask === 5, straightH = mask === 10;
  if (straightV) { px(ctx, 8, 1, 1, 4, C.roadLine); px(ctx, 8, 9, 1, 4, C.roadLine); }
  if (straightH) { px(ctx, 1, 8, 4, 1, C.roadLine); px(ctx, 9, 8, 4, 1, C.roadLine); }
  if (mask === 0) px(ctx, 6, 6, 4, 4, C.roadEdge); // 孤立した 1 マス
}

// 3x3 ゾーンの 1 枚。dx,dy は中心からの位置（0..2）
function drawZoneR(ctx, dx, dy) {
  px(ctx, 0, 0, TILE, TILE, C.lot);
  // 地面の粒
  for (const [x, y] of [[3, 4], [10, 2], [6, 11], [13, 9]]) px(ctx, x, y, 1, 1, C.lotEdge);
  // 外周だけ枠線を引く。3 枚並ぶと 1 つの区画に見える
  if (dy === 0) px(ctx, 0, 0, TILE, 1, C.lotEdge);
  if (dy === 2) px(ctx, 0, TILE - 1, TILE, 1, C.lotEdge);
  if (dx === 0) px(ctx, 0, 0, 1, TILE, C.lotEdge);
  if (dx === 2) px(ctx, TILE - 1, 0, 1, TILE, C.lotEdge);
  // 中心に用途マーク（住宅 = 緑）。建物が建つのは段階 1
  if (dx === 1 && dy === 1) {
    px(ctx, 4, 5, 8, 7, C.house);
    px(ctx, 5, 6, 6, 2, C.houseLight);
    px(ctx, 3, 5, 10, 1, C.lotEdge);
  }
}

/** アトラスを 1 枚描いて返す。起動時に 1 回だけ呼ぶ */
export function buildAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const cell = (n, draw) => {
    ctx.save();
    ctx.translate((n % COLS) * TILE, Math.floor(n / COLS) * TILE);
    ctx.beginPath();
    ctx.rect(0, 0, TILE, TILE);
    ctx.clip(); // 隣のセルにはみ出させない
    draw();
    ctx.restore();
  };

  cell(ATLAS.LAND_A, () => drawGrass(ctx, 0));
  cell(ATLAS.LAND_B, () => drawGrass(ctx, 1));
  cell(ATLAS.WATER, () => drawWater(ctx));
  cell(ATLAS.TREE, () => drawTree(ctx));
  for (let m = 0; m < 16; m++) cell(ATLAS.ROAD + m, () => drawRoad(ctx, m));
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) cell(ATLAS.ZONE_R + dy * 3 + dx, () => drawZoneR(ctx, dx, dy));
  }
  return canvas;
}

/** アトラス内の位置。描画側が毎フレーム呼ぶので割り算だけに留める */
export function atlasX(n) { return (n % COLS) * TILE; }
export function atlasY(n) { return Math.floor(n / COLS) * TILE; }
