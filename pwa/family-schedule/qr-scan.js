// ログイン用 QR をカメラで読む。jsQR（vendor/jsqr）は押されたときだけ <script> で読む。
// getUserMedia が使えない（権限拒否・非対応）ときは写真を 1 枚選んで読む。

let jsQRPromise;

function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsQRPromise) {
    jsQRPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = new URL("./vendor/jsqr/jsQR.js", import.meta.url).href;
      s.onload = () => resolve(window.jsQR);
      s.onerror = () => {
        jsQRPromise = undefined; // 一度の失敗を持ち越さない
        s.remove();
        reject(new Error("jsQR の読み込みに失敗"));
      };
      document.head.append(s);
    });
  }
  return jsQRPromise;
}

function decodeCanvas(jsQR, canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
}

// カメラ映像（呼び出し側が取った MediaStream）を video に流し、QR が読めたら onCode(text) を
// 呼んで止める。戻り値は stop()。
// **getUserMedia はここで呼ばない**: iOS はタップ直後（user activation 有効中）でないと
// カメラの許可ダイアログを出さず、待っても何も起きないことがある。jsQR の読み込み（256KB）を
// 挟むと間に合わないので、呼び出し側がタップ直後に getUserMedia を始めてストリームを渡す
// onStall: 許可は下りたのに映像が出てこないとき（一部のブラウザで起きる）に 1 回だけ呼ぶ
export async function startScan(video, stream, onCode, onStall) {
  const jsQR = await loadJsQR();
  video.srcObject = stream; // HTML 側の playsinline で iOS のフルスクリーン化を抑える
  // **play() を await しない**。映像が来ないブラウザ（Orion で確認）では解決も reject もせず、
  // 待つと下の stall 判定に進めないまま「開いたのに何も起きない」になる
  video.play().catch(() => {});

  const canvas = document.createElement("canvas");
  let stopped = false;
  let timer = 0;
  let stalled = false;
  const startedAt = Date.now();
  const STALL_MS = 8000;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  const tick = () => {
    if (stopped) return;
    if (!stalled && !video.videoWidth && Date.now() - startedAt > STALL_MS) {
      stalled = true;
      onStall?.();
      return; // 呼び出し側が stop() する
    }
    if (video.readyState >= 2 && video.videoWidth) {
      // 解析は 640px 幅で十分。毎フレーム全画素を読むと iPhone で重い
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, canvas.width, canvas.height);
      const text = decodeCanvas(jsQR, canvas);
      if (text) {
        stop();
        onCode(text);
        return;
      }
    }
    timer = setTimeout(tick, 150);
  };
  tick();
  return stop;
}

// 写真 1 枚から読む（カメラが使えないときの代替）
export async function scanFile(file) {
  const jsQR = await loadJsQR();
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); // EXIF の向きを反映
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return decodeCanvas(jsQR, canvas);
}
