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

// カメラ映像を video に流し、QR が読めたら onCode(text) を呼んで止める。戻り値は stop()
export async function startScan(video, onCode) {
  const jsQR = await loadJsQR();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream; // HTML 側の playsinline で iOS のフルスクリーン化を抑える
  await video.play();

  const canvas = document.createElement("canvas");
  let stopped = false;
  let timer = 0;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  const tick = () => {
    if (stopped) return;
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
