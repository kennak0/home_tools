// カメラと描画。画面に映っているマスだけ drawImage する（README「表示」）。
import { W, H, TILE, WATER, TREE, ROAD, ZONE_R, idx } from "./map.js";
import { ATLAS, atlasX, atlasY, buildAtlas } from "./tiles.js";

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;

export function createView(canvas, city) {
  const ctx = canvas.getContext("2d", { alpha: false });
  const atlas = buildAtlas();
  // cam はマップ座標（タイル単位）の左上。scale は 1 タイル = TILE*scale CSS px
  const cam = { x: W / 2, y: H / 2, scale: 2 };
  let cssW = 0, cssH = 0, dpr = 1;
  let cursor = null; // {x, y, size, ok} 指で触っている場所
  let dirty = true;
  let frame = 0;

  function tilesAcross() { return cssW / (TILE * cam.scale); }
  function tilesDown() { return cssH / (TILE * cam.scale); }

  // マップより画面が広いときは中央に寄せる。狭いときは端で止める
  function clampCam() {
    const aw = tilesAcross(), ah = tilesDown();
    cam.x = aw >= W ? (W - aw) / 2 : Math.min(W - aw, Math.max(0, cam.x));
    cam.y = ah >= H ? (H - ah) / 2 : Math.min(H - ah, Math.max(0, cam.y));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 3); // 3 倍を超えても見た目が変わらない割に重い
    cssW = rect.width;
    cssH = rect.height;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    clampCam();
    invalidate();
  }

  function invalidate() {
    dirty = true;
    if (!frame) frame = requestAnimationFrame(draw);
  }

  /** 画面の CSS 座標 → マップのタイル座標（切り捨て前の実数） */
  function screenToTile(px, py) {
    const rect = canvas.getBoundingClientRect();
    const s = TILE * cam.scale;
    return { x: cam.x + (px - rect.left) / s, y: cam.y + (py - rect.top) / s };
  }

  function panBy(dxCss, dyCss) {
    const s = TILE * cam.scale;
    cam.x -= dxCss / s;
    cam.y -= dyCss / s;
    clampCam();
    invalidate();
  }

  /** 画面上の点 (px,py) を固定したまま拡大率を変える */
  function zoomAt(px, py, nextScale) {
    const before = screenToTile(px, py);
    cam.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    const after = screenToTile(px, py);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
    clampCam();
    invalidate();
  }

  function snapScale() {
    const r = Math.round(cam.scale);
    if (r !== cam.scale) zoomAt(cssW / 2, cssH / 2, r);
  }

  function setCursor(next) {
    const same = (!cursor && !next)
      || (cursor && next && cursor.x === next.x && cursor.y === next.y
          && cursor.size === next.size && cursor.ok === next.ok);
    cursor = next;
    if (!same) invalidate();
  }

  function centerOn(tx, ty) {
    cam.x = tx - tilesAcross() / 2;
    cam.y = ty - tilesDown() / 2;
    clampCam();
    invalidate();
  }

  // 1 マスのアトラス番号。道路の形は隣 4 マスから毎回求める（README「データモデル」）
  function cellOf(x, y) {
    const i = idx(x, y);
    const b = city.build[i];
    if (b === ROAD) {
      let m = 0;
      if (y > 0 && city.build[i - W] === ROAD) m |= 1;
      if (x < W - 1 && city.build[i + 1] === ROAD) m |= 2;
      if (y < H - 1 && city.build[i + W] === ROAD) m |= 4;
      if (x > 0 && city.build[i - 1] === ROAD) m |= 8;
      return ATLAS.ROAD + m;
    }
    if (b === ZONE_R) {
      const c = city.zone[i];
      const dx = x - (c % W) + 1;
      const dy = y - ((c / W) | 0) + 1;
      return ATLAS.ZONE_R + dy * 3 + dx;
    }
    const t = city.terrain[i];
    if (t === WATER) return ATLAS.WATER;
    if (t === TREE) return ATLAS.TREE;
    return (x + y) % 2 === 0 ? ATLAS.LAND_A : ATLAS.LAND_B;
  }

  function draw() {
    frame = 0;
    if (!dirty) return;
    dirty = false;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#1b2430"; // マップの外側
    ctx.fillRect(0, 0, cssW, cssH);

    const s = TILE * cam.scale;
    const x0 = Math.max(0, Math.floor(cam.x));
    const y0 = Math.max(0, Math.floor(cam.y));
    const x1 = Math.min(W - 1, Math.ceil(cam.x + tilesAcross()));
    const y1 = Math.min(H - 1, Math.ceil(cam.y + tilesDown()));
    // 1px の隙間が出ないよう、出力サイズは切り上げる
    const d = Math.ceil(s) + 1;

    for (let y = y0; y <= y1; y++) {
      const sy = Math.round((y - cam.y) * s);
      for (let x = x0; x <= x1; x++) {
        const n = cellOf(x, y);
        ctx.drawImage(atlas, atlasX(n), atlasY(n), TILE, TILE,
          Math.round((x - cam.x) * s), sy, d, d);
      }
    }

    if (cursor) {
      const r = (cursor.size - 1) / 2;
      const cx = Math.round((cursor.x - r - cam.x) * s);
      const cy = Math.round((cursor.y - r - cam.y) * s);
      const cw = Math.round(cursor.size * s);
      ctx.lineWidth = 2;
      ctx.strokeStyle = cursor.ok ? "#ffffff" : "#ff5a5a";
      ctx.strokeRect(cx + 1, cy + 1, cw - 2, cw - 2);
    }
  }

  return { cam, resize, invalidate, screenToTile, panBy, zoomAt, snapScale, setCursor, centerOn };
}
