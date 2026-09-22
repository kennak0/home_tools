// タッチとマウスの操作。Pointer Events だけを見る（touch/mouse を両方書かない）。
// 2 本指はツールに関係なく常にスクロールとピンチ（README「遊び方」）。

/**
 * @param {(x:number,y:number)=>{ok:boolean,reason?:string}} paint 1 マスに適用する
 * @param {()=>string} getTool 現在のツール
 * @param {()=>number} getFootprint カーソルの大きさ（マス）
 */
export function createInput(canvas, view, { paint, getTool, getFootprint }) {
  const pointers = new Map();
  let mode = null; // "pan" | "pinch" | "draw"
  let last = null; // draw 中に最後に塗ったマス
  let pinch = null; // {ids:[a,b], dist, mid}

  const tileAt = (e) => {
    const p = view.screenToTile(e.clientX, e.clientY);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  };

  function paintAt(x, y) {
    const res = paint(x, y);
    view.setCursor({ x, y, size: getFootprint(), ok: !res.reason });
    return res;
  }

  // 指を速く動かすとマスが飛ぶので、前のマスとの間を直線で埋める（Bresenham）
  function paintLine(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    for (;;) {
      if (x !== x0 || y !== y0) paintAt(x, y);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  function twoPointers() {
    const [a, b] = [...pointers.keys()];
    const pa = pointers.get(a), pb = pointers.get(b);
    return {
      ids: [a, b],
      dist: Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1,
      mid: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
    };
  }

  function endGesture() {
    if (mode === "pinch") view.snapScale();
    mode = null;
    last = null;
    pinch = null;
    view.setCursor(null);
  }

  canvas.addEventListener("pointerdown", (e) => {
    // setPointerCapture は使わない。move と up は window で拾っているので要らず、
    // 指を離す前に要素が消えた場合に例外を投げる分だけ損
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      if (getTool() === "hand") {
        mode = "pan";
      } else {
        mode = "draw";
        const t = tileAt(e);
        paintAt(t.x, t.y);
        last = t;
      }
    } else if (pointers.size === 2) {
      // 2 本目が触れた時点で描画はやめる。ここまでに置いたものはそのまま残す
      mode = "pinch";
      last = null;
      view.setCursor(null);
      pinch = twoPointers();
    }
    e.preventDefault();
  });

  window.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, now);

    if (mode === "pan" && pointers.size === 1) {
      view.panBy(now.x - prev.x, now.y - prev.y);
    } else if (mode === "pinch" && pointers.size >= 2) {
      const next = twoPointers();
      view.panBy(next.mid.x - pinch.mid.x, next.mid.y - pinch.mid.y);
      view.zoomAt(next.mid.x, next.mid.y, view.cam.scale * (next.dist / pinch.dist));
      pinch = next;
    } else if (mode === "draw") {
      const t = tileAt(e);
      if (!last || t.x !== last.x || t.y !== last.y) {
        if (last) paintLine(last.x, last.y, t.x, t.y);
        else paintAt(t.x, t.y);
        last = t;
      }
    }
    e.preventDefault();
  }, { passive: false });

  const release = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size === 0) endGesture();
    else if (mode === "pinch" && pointers.size === 1) {
      // 1 本だけ残ったらスクロールに切り替える。ここで描画に戻すと誤設置になる
      view.snapScale();
      mode = "pan";
      pinch = null;
    }
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);

  // iOS Safari のページ全体のピンチズームを止める（touch-action だけでは残る）
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    canvas.addEventListener(type, (e) => e.preventDefault());
  }
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // PC で試すとき用。実機の操作とは関係ない
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    view.zoomAt(e.clientX, e.clientY, view.cam.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });
}
