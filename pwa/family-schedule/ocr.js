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

// 長辺 MAX_EDGE に縮小してグレースケール化。canvas を通すので EXIF（位置情報）は落ちる
export async function preprocess(file, maxEdge = MAX_EDGE) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.filter = "grayscale(1) contrast(1.2)";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
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

// 画像 1 枚を認識してテキストを返す。onProgress({ status, progress }) で進捗を出す
export async function recognize(blob, onProgress) {
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
  try {
    // PSM 4（1 列・行ごとに解析）。既定の 6（1 ブロック）だと表の行が崩れ、3（自動）だとセルがばらばらの行になる
    await worker.setParameters({ tessedit_pageseg_mode: "4", preserve_interword_spaces: "1" });
    const { data } = await worker.recognize(blob);
    return cleanupJapanese(data.text);
  } finally {
    await worker.terminate();
  }
}
