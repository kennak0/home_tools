// 段階 2b: 写真 → 端末内 OCR（Tesseract.js）。通信なし。
// vendor/tesseract/ の本体・WASM・日本語辞書（合計 約 9.5MB）は precache 対象外で、
// 初めて使うときに自分のオリジンから取る。辞書は Tesseract.js が IndexedDB に置いて 2 回目から再利用する。
// app.js から dynamic import する（起動時の critical path に載せない）。

const VENDOR = new URL("./vendor/tesseract/", import.meta.url).href.replace(/\/$/, "");
const MAX_EDGE = 2600; // A4 のプリントを撮った写真で本文が 30px 前後になる大きさ。小さいと日本語の認識率が落ちる

// SIMD 対応の判定（wasm-feature-detect と同じ最小モジュール）
function hasWasmSimd() {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  } catch {
    return false;
  }
}

// 画像ファイルを描画できる形にする。EXIF の向き（iPhone の縦写真）を反映する。
// createImageBitmap が無い / 失敗する古い iOS は <img> にフォールバック
async function loadImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* 下へ */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// グレースケール + コントラスト。ctx.filter は Safari 18 以降なので、無ければ画素を直接触る
function grayscale(ctx, w, h, contrast = 1.2) {
  if ("filter" in ctx) {
    ctx.filter = `grayscale(1) contrast(${contrast})`;
    return (draw) => draw();
  }
  return (draw) => {
    draw();
    const img = ctx.getImageData(0, 0, w, h);
    const p = img.data;
    for (let i = 0; i < p.length; i += 4) {
      let v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      v = Math.max(0, Math.min(255, (v - 128) * contrast + 128));
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  };
}

// 長辺 MAX_EDGE に縮小してグレースケール化。canvas を通すので EXIF（位置情報）は落ちる
export async function preprocess(file, maxEdge = MAX_EDGE) {
  const src = await loadImage(file);
  const sw = src.width ?? src.naturalWidth;
  const sh = src.height ?? src.naturalHeight;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  grayscale(ctx, w, h)(() => ctx.drawImage(src, 0, 0, w, h));
  src.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
  return { blob, width: w, height: h };
}

// Tesseract の日本語出力は文字の間に空白が入る。CJK 同士の単一空白は詰め、2 つ以上（列の区切り）は 1 つ残す。
// よくある読み違いもここで直す（曜日の「土」→「士」、時刻の間の「〜」→「て」「<>」）
export function cleanupJapanese(text) {
  const CJK = "[^\\x00-\\x7F]";
  return text
    .replace(/ {2,}/g, "\u0000")
    .replace(new RegExp(`(?<=${CJK}) (?=${CJK})`, "g"), "")
    .replace(/\u0000/g, " ")
    .replace(/[(（]\s*士\s*[)）]/g, "(土)")
    .replace(/(\d{1,2}:\d{2})\s*(?:て|<>|<|>|一|ー)\s*(\d{1,2}:\d{2})/g, "$1~$2")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 画像 1 枚を認識してテキストを返す。onProgress({ status, progress }) で進捗を出す。
// signal（AbortSignal）が abort されたら worker を止めて AbortError で reject する
export async function recognize(blob, onProgress, signal) {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  // ESM ビルドは default export だけ（中身は UMD を包んだもの）
  const { createWorker } = (await import("./vendor/tesseract/tesseract.esm.min.js")).default;
  const worker = await createWorker("jpn", 1 /* LSTM only */, {
    workerPath: `${VENDOR}/worker.min.js`,
    corePath: `${VENDOR}/${hasWasmSimd() ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js"}`,
    langPath: VENDOR,
    gzip: true,
    workerBlobURL: false,
    logger: (m) => onProgress?.(m),
  });
  const onAbort = () => worker.terminate();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    // PSM 4（1 列・行ごとに解析）。既定の 6（1 ブロック）だと表の行が崩れ、3（自動）だとセルがばらばらの行になる
    await worker.setParameters({ tessedit_pageseg_mode: "4", preserve_interword_spaces: "1" });
    const { data } = await worker.recognize(blob);
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    return cleanupJapanese(data.text);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await worker.terminate().catch(() => {});
  }
}
