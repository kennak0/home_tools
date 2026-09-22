// 共有コード（家族の合言葉）で config.enc を復号し、中身を settings に保存する。
// 仕組みは README「ログイン（家族の共有コード）」。config.enc は pwa/tools/make-config.mjs が作る。
// ファイル形式（v1）:
//   { v: 1, kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt }, cipher: "AES-GCM", iv, ct }
//   salt / iv / ct は base64。復号した平文は JSON オブジェクト
import { getSetting, putSettings, clearSettings } from "./db.js";

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

// ログイン画面の配線。form の submit で unlock し、成功したら onUnlocked を呼ぶ
export function mountLogin(root, { onUnlocked }) {
  const form = root.querySelector("#login-form");
  const input = root.querySelector("#passphrase");
  const submit = root.querySelector("#login-submit");
  const error = root.querySelector("#login-error");

  const showError = (msg) => {
    error.textContent = msg;
    error.hidden = !msg;
  };

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const passphrase = input.value.trim();
    // 読んだらすぐ DOM から消す。以後は変数にしか無い
    input.value = "";
    if (!passphrase) return;

    submit.disabled = true;
    showError("");
    try {
      const config = await unlock(passphrase);
      if (config === null) {
        showError("合言葉が違います。");
        input.focus();
        return;
      }
      onUnlocked(config);
    } catch (e) {
      console.error(e);
      showError(navigator.onLine === false
        ? "オフラインです。初回は通信が必要です。"
        : "確認に失敗しました。時間をおいて試してください。");
    } finally {
      submit.disabled = false;
    }
  });
}
