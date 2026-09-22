// 共有コード（家族の合言葉）で config.enc を復号し、中身を settings に保存する。
// 仕組みは README「ログイン（家族の共有コード）」。config.enc は pwa/tools/make-config.mjs が作る。
// ファイル形式（v1）:
//   { v: 1, kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt }, cipher: "AES-GCM", iv, ct }
//   salt / iv / ct は base64。復号した平文は JSON オブジェクト
import { getSetting, putSettings, clearSettings } from "./db.js";

// 背面カメラを優先。qr-scan.js は押されたときだけ読むので、制約はこちらに置く
const CAMERA_CONSTRAINTS = {
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: false,
};

const CONFIG_URL = new URL("./config.enc", import.meta.url);
const enc = new TextEncoder();
const dec = new TextDecoder();

function fromB64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function deriveKey(passphrase, kdf) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: kdf.hash, salt: fromB64(kdf.salt), iterations: kdf.iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

async function fetchConfig() {
  // Pages は max-age=600 を付ける。作り直した直後に古い config.enc を掴まないよう HTTP キャッシュを迂回
  const res = await fetch(CONFIG_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error(`config.enc: HTTP ${res.status}`);
  const cfg = await res.json();
  if (cfg.v !== 1 || cfg.kdf?.name !== "PBKDF2" || cfg.cipher !== "AES-GCM") {
    throw new Error("config.enc: unsupported format");
  }
  return cfg;
}

// 復号できたら平文オブジェクトを返す。合言葉違いは AES-GCM の認証失敗（OperationError）になる
export async function unlock(passphrase) {
  const cfg = await fetchConfig();
  const key = await deriveKey(passphrase, cfg.kdf);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(cfg.iv) }, key, fromB64(cfg.ct));
  } catch (e) {
    if (e.name === "OperationError") return null;
    throw e;
  }
  const config = JSON.parse(dec.decode(plain));
  await putSettings({ ...config, unlocked: true });
  return config;
}

export function isUnlocked() {
  return getSetting("unlocked").then((v) => v === true);
}

export async function logout() {
  await clearSettings();
}

// QR や URL から合言葉を取り出す。「…/#code=xxxxx-…」でも合言葉そのものでも受ける。
// fragment（#）だけを見る。?code= は受けない（クエリはサーバのログに載る経路になる）
const PASSPHRASE_RE = /^[a-z0-9]{5}(?:-[a-z0-9]{5}){3}$/;
export function extractCode(text) {
  const t = (text ?? "").trim();
  if (!t) return null;
  const m = t.match(/#code=([^&#\s]+)/);
  let code;
  try {
    code = decodeURIComponent(m ? m[1] : t).trim();
  } catch {
    return null; // 壊れた % エスケープ
  }
  return PASSPHRASE_RE.test(code) ? code : null;
}

// ログイン画面の配線。form の submit か QR で unlock し、成功したら onUnlocked を呼ぶ
export function mountLogin(root, { onUnlocked }) {
  const form = root.querySelector("#login-form");
  const input = root.querySelector("#passphrase");
  const submit = root.querySelector("#login-submit");
  const error = root.querySelector("#login-error");
  const status = root.querySelector("#login-status");
  const scanButton = root.querySelector("#login-scan");
  const scanFileLabel = root.querySelector("#login-scan-file");
  const scanFileInput = root.querySelector("#login-scan-input");
  const scanner = root.querySelector("#scanner");
  const video = root.querySelector("#scanner-video");
  let stopScan = null;
  let scanGen = 0; // 起動中に「やめる」/ 二度押しされたときに、後から届いたストリームを止めるため

  const showError = (msg) => {
    error.textContent = msg;
    error.hidden = !msg;
  };
  const showStatus = (msg) => {
    status.textContent = msg;
    status.hidden = !msg;
  };
  const setBusy = (busy) => {
    submit.disabled = busy;
    scanButton.disabled = busy;
  };

  // 合言葉 1 つを試す。true なら解錠済み
  async function tryUnlock(passphrase) {
    setBusy(true);
    showError("");
    if (!isSecureContext) {
      // http://<LAN IP> では crypto.subtle が無い。原因が分かる文言にする
      showError("https でないと使えません（http のままではブラウザが暗号 API を許可しません）。");
      setBusy(false);
      return false;
    }
    try {
      const config = await unlock(passphrase);
      if (config === null) {
        showError("合言葉が違います。");
        return false;
      }
      showStatus("");
      closeScanner();
      onUnlocked(config);
      return true;
    } catch (e) {
      console.error(e);
      showError(navigator.onLine === false
        ? "オフラインです。初回は通信が必要です。"
        : "確認に失敗しました。時間をおいて試してください。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleScanned(text) {
    const code = extractCode(text);
    if (!code) {
      showError("このアプリの QR コードではありません。");
      return;
    }
    showStatus("QR コードを読み取りました。確認しています…");
    if (!(await tryUnlock(code))) showStatus("");
  }

  function closeScanner() {
    scanGen++;
    stopScan?.();
    stopScan = null;
    scanner.hidden = true;
    scanButton.disabled = false;
    showStatus("");
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const passphrase = input.value.trim();
    // 読んだらすぐ DOM から消す。以後は変数にしか無い
    input.value = "";
    if (!passphrase) return;
    if (!(await tryUnlock(passphrase))) input.focus();
  });

  // カメラを諦めて写真から読む経路に切り替える。理由は必ず画面に出す（黙って何も起きない状態を作らない）
  function fallbackToPhoto(message) {
    closeScanner();
    scanFileLabel.hidden = false;
    scanButton.hidden = true;
    showStatus("");
    showError(message);
  }

  function cameraErrorMessage(e) {
    switch (e?.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "カメラの使用が許可されていません。設定 → Safari → カメラ で許可するか、QR コードを撮った写真から読み取ってください。";
      case "NotFoundError":
      case "OverconstrainedError":
        return "カメラが見つかりませんでした。QR コードを撮った写真から読み取れます。";
      case "NotReadableError":
        return "カメラを他のアプリが使っています。閉じてからもう一度試すか、写真から読み取ってください。";
      case "TimeoutError":
        return "カメラが応答しませんでした。QR コードを撮った写真から読み取れます。";
      default:
        return "カメラを使えませんでした。QR コードを撮った写真から読み取れます。";
    }
  }

  scanButton.addEventListener("click", (ev) => {
    ev.preventDefault();
    showError("");
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      // http や非対応ブラウザ（iOS の一部）→ 写真から読む
      fallbackToPhoto(
        isSecureContext
          ? "このブラウザではカメラを使えません。QR コードを撮った写真から読み取れます。"
          : "https でないとカメラを使えません。QR コードを撮った写真から読み取れます。",
      );
      return;
    }

    const gen = ++scanGen;
    scanner.hidden = false;
    scanButton.disabled = true; // 起動中の二度押しを防ぐ
    showStatus("カメラを準備しています…（許可を聞かれたら「許可」を選んでください）");

    // **タップ直後に getUserMedia を始める**。await を挟むと iOS で user activation が切れ、
    // 許可ダイアログが出ないまま何も起きないことがある。jsQR の読み込みはこの後ろで待つ
    const camera = navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
    // 許可も拒否もされないまま返ってこないときの保険
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error("camera timeout"), { name: "TimeoutError" })), 15000),
    );

    (async () => {
      try {
        const { startScan } = await import("./qr-scan.js");
        const stream = await Promise.race([camera, timeout]);
        if (gen !== scanGen) {
          stream.getTracks().forEach((t) => t.stop()); // 待っている間に「やめる」が押された
          return;
        }
        showStatus(""); // 以後はスキャナ内の案内文に任せる
        const stop = await startScan(
          video,
          stream,
          (text) => {
            closeScanner();
            handleScanned(text);
          },
          () => {
            // 許可は下りたのに映像が出ない（Orion など Safari 以外の iOS ブラウザで確認）
            fallbackToPhoto("カメラの映像を取得できませんでした。Safari で開くか、QR コードを撮った写真から読み取ってください。");
          },
        );
        if (gen !== scanGen) {
          stop();
          return;
        }
        stopScan = stop;
      } catch (e) {
        if (gen !== scanGen) return;
        console.error(e);
        // 取れたストリームが後から届いても止める
        camera.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
        fallbackToPhoto(cameraErrorMessage(e));
      }
    })();
  });
  root.querySelector("#scanner-stop").addEventListener("click", closeScanner);

  scanFileInput.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const { scanFile } = await import("./qr-scan.js");
      const text = await scanFile(file);
      if (!text) {
        showError("QR コードを見つけられませんでした。明るい場所で正面から撮ってください。");
        return;
      }
      handleScanned(text);
    } catch (e) {
      console.error(e);
      showError("写真を読み込めませんでした。");
    }
  });

  // iPhone のカメラで QR を読むと「…/#code=合言葉」で開く。hash はサーバに送られない。読んだら履歴から消す
  const fromUrl = extractCode(location.hash);
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  if (fromUrl) {
    showStatus("QR コードの合言葉で確認しています…");
    tryUnlock(fromUrl).then((ok) => { if (!ok) showStatus(""); });
  }
}
