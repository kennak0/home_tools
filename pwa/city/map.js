// 街のデータと、地形生成・設置・撤去。描画と入力はここに書かない。
// データの持ち方は README「データモデル」。

export const W = 120;
export const H = 100;
export const TILE = 16; // タイル 1 枚の元サイズ（px）

// terrain
export const LAND = 0, WATER = 1, TREE = 2;
// build
export const EMPTY = 0, ROAD = 1, ZONE_R = 10;

export const ZONE_SIZE = 3;

export const COST = { road: 10, zoneR: 100, bulldoze: 1 };
export const START_FUNDS = 20000;

export const idx = (x, y) => y * W + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 3x3 の箱ぼかし。端はクランプ（マップ外を水にしたくないので複製で伸ばす）
function blur(src) {
  const dst = new Float32Array(src.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(H - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(W - 1, Math.max(0, x + dx));
          sum += src[yy * W + xx];
        }
      }
      dst[y * W + x] = sum / 9;
    }
  }
  return dst;
}

// 川を 1 本、上から下へ蛇行させて彫る。ぼかしただけの地形は
// 湖が点在するだけで「街を分断するもの」が無く、道路を引く判断が生まれないため
function carveRiver(terrain, rnd) {
  let x = W * (0.25 + rnd() * 0.5);
  let vx = 0;
  for (let y = 0; y < H; y++) {
    vx = vx * 0.82 + (rnd() - 0.5) * 0.9;
    x = Math.min(W - 4, Math.max(3, x + vx));
    const half = 1 + Math.floor(rnd() * 2); // 幅 3〜5
    for (let dx = -half; dx <= half; dx++) {
      const xx = Math.round(x) + dx;
      if (xx >= 0 && xx < W) terrain[y * W + xx] = WATER;
    }
  }
}

export function generate(seed) {
  const rnd = mulberry32(seed);
  let f = new Float32Array(W * H);
  for (let i = 0; i < f.length; i++) f[i] = rnd();
  for (let n = 0; n < 4; n++) f = blur(f);

  // ぼかすと値が中央に寄って絶対値のしきい値が使えないので、平均と標準偏差で見る
  let mean = 0;
  for (let i = 0; i < f.length; i++) mean += f[i];
  mean /= f.length;
  let variance = 0;
  for (let i = 0; i < f.length; i++) variance += (f[i] - mean) ** 2;
  const sd = Math.sqrt(variance / f.length) || 1e-6;

  const terrain = new Uint8Array(W * H);
  for (let i = 0; i < f.length; i++) {
    const z = (f[i] - mean) / sd;
    terrain[i] = z < -1.0 ? WATER : z > 0.45 ? TREE : LAND;
  }
  carveRiver(terrain, rnd);

  return {
    seed,
    terrain,
    build: new Uint16Array(W * H),
    zone: new Int32Array(W * H).fill(-1),
    funds: START_FUNDS,
  };
}

export function createCity(seed = (Math.random() * 0xffffffff) >>> 0) {
  return generate(seed);
}

// 保存から復元したデータが今のマップサイズと合うか。合わなければ作り直す
export function isValidSave(s) {
  return !!s && s.terrain?.length === W * H && s.build?.length === W * H && s.zone?.length === W * H
    && Number.isFinite(s.funds);
}

/** 3x3 ゾーンの中心 (cx,cy) として置けるか。理由つきで返す */
function canPlaceZone(city, cx, cy) {
  const r = (ZONE_SIZE - 1) / 2;
  if (!inBounds(cx - r, cy - r) || !inBounds(cx + r, cy + r)) return "はみ出しています";
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const i = idx(x, y);
      if (city.terrain[i] === WATER) return "水の上には置けません";
      if (city.build[i] !== EMPTY) return "ほかの建物があります";
    }
  }
  return null;
}

function clearTile(city, i) {
  city.build[i] = EMPTY;
  city.zone[i] = -1;
  if (city.terrain[i] === TREE) city.terrain[i] = LAND;
}

/** ゾーンの一部に触れたら 3x3 まるごと消す */
function clearZoneAt(city, i) {
  const c = city.zone[i];
  if (c < 0) return;
  const r = (ZONE_SIZE - 1) / 2;
  const cx = c % W, cy = (c / W) | 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (inBounds(x, y)) clearTile(city, idx(x, y));
    }
  }
}

/**
 * ツールを 1 マスに適用する。
 * @returns {{ok: boolean, cost: number, reason?: string, silent?: boolean}}
 *   silent は「すでにそうなっている」など、メッセージを出すまでもない不成立
 */
export function apply(city, tool, x, y) {
  if (!inBounds(x, y)) return { ok: false, cost: 0, silent: true };
  const i = idx(x, y);

  if (tool === "road") {
    if (city.build[i] === ROAD) return { ok: false, cost: 0, silent: true };
    if (city.terrain[i] === WATER) return { ok: false, cost: 0, reason: "水の上には引けません" };
    if (city.build[i] !== EMPTY) return { ok: false, cost: 0, reason: "先に整地してください" };
    if (city.funds < COST.road) return { ok: false, cost: 0, reason: "資金が足りません" };
    if (city.terrain[i] === TREE) city.terrain[i] = LAND;
    city.build[i] = ROAD;
    city.funds -= COST.road;
    return { ok: true, cost: COST.road };
  }

  if (tool === "zoneR") {
    const reason = canPlaceZone(city, x, y);
    if (reason) return { ok: false, cost: 0, reason };
    if (city.funds < COST.zoneR) return { ok: false, cost: 0, reason: "資金が足りません" };
    const r = (ZONE_SIZE - 1) / 2;
    for (let yy = y - r; yy <= y + r; yy++) {
      for (let xx = x - r; xx <= x + r; xx++) {
        const j = idx(xx, yy);
        if (city.terrain[j] === TREE) city.terrain[j] = LAND;
        city.build[j] = ZONE_R;
        city.zone[j] = i;
      }
    }
    city.funds -= COST.zoneR;
    return { ok: true, cost: COST.zoneR };
  }

  if (tool === "bulldoze") {
    if (city.terrain[i] === WATER) return { ok: false, cost: 0, reason: "水は埋め立てられません" };
    if (city.build[i] === EMPTY && city.terrain[i] !== TREE) return { ok: false, cost: 0, silent: true };
    if (city.funds < COST.bulldoze) return { ok: false, cost: 0, reason: "資金が足りません" };
    if (city.zone[i] >= 0) clearZoneAt(city, i);
    else clearTile(city, i);
    city.funds -= COST.bulldoze;
    return { ok: true, cost: COST.bulldoze };
  }

  return { ok: false, cost: 0, silent: true };
}

/** ツールが 1 回の操作で覆う範囲（カーソル表示用）。ゾーンだけ 3x3 */
export function toolFootprint(tool) {
  return tool === "zoneR" ? ZONE_SIZE : 1;
}
