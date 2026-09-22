// config.enc を作る。家族の合言葉を生成し、設定 JSON を AES-GCM で暗号化する。
//
//   node pwa/tools/make-config.mjs \
//     --out pwa/family-schedule/config.enc \
//     --passphrase-file ~/.config/home_tools/family-schedule.passphrase \
//     [--in config.plain.json] [--url https://kennak0.github.io/home_tools/family-schedule/] [--qr-only]
//
// - 合言葉を埋めたログイン用 QR（SVG）も --passphrase-file と同じディレクトリに書く
//   （family-schedule-login-qr.svg）。中身は「アプリの URL + #code=合言葉」。iPhone のカメラで
//   読むと Safari でログイン済みの状態で開き、アプリ内の「QR コードを読み取る」でも読める。
//   **QR は合言葉そのもの**なので、家族以外に見せない・リポジトリに置かない
// - --qr-only なら config.enc は書き換えず QR だけ作り直す（salt が変わって差分が出るのを避ける）
//
// - 合言葉は画面に出さず --passphrase-file に書く（mode 0600）。ファイルが既にあれば
//   その合言葉を使い回すので、中身の JSON を変えて作り直しても家族の入れ直しは要らない。
//   合言葉を変えたいときはファイルを消してから実行する
// - --in を省くと段階 1 の { "ok": true } を暗号化する。平文 JSON は pwa/**/config.plain.json
//   に置けば .gitignore で除外される
// - 復号側は pwa/family-schedule/login.js。ファイル形式を変えたら両方直す
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import qrcode from "./vendor/qrcode-generator/qrcode.mjs";

const DEFAULT_URL = "https://kennak0.github.io/home_tools/family-schedule/";

export const FORMAT_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    args[a.slice(2)] = argv[++i];
  }
  return args;
}

// 合言葉: 5 文字 × 4 組、紛らわしい文字（0 o 1 l i）を除いた 31 種 → 約 99 bit。
// 256 は 31 で割り切れないので、剰余の偏りを避けるため 248 以上のバイトは捨てて引き直す
function generatePassphrase() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const limit = 256 - (256 % alphabet.length); // 248
  const chars = [];
  while (chars.length < 20) {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && chars.length < 20) chars.push(alphabet[b % alphabet.length]);
    }
  }
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join("")).join("-");
}

export async function deriveKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptConfig(passphrase, plainObject) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(plainObject)));
  return {
    v: FORMAT_VERSION,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: b64(salt) },
    cipher: "AES-GCM",
    iv: b64(iv),
    ct: b64(new Uint8Array(ct)),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const qrOnly = argv.includes("--qr-only");
  const args = parseArgs(argv.filter((a) => a !== "--qr-only"));
  if ((!args.out && !qrOnly) || !args["passphrase-file"]) {
    console.error("usage: make-config.mjs --out <config.enc> --passphrase-file <path> [--in <plain.json>] [--url <app url>] [--qr-only]");
    process.exit(2);
  }
  const passFile = resolve(args["passphrase-file"].replace(/^~(?=$|\/)/, homedir()));
  const plain = args.in ? JSON.parse(readFileSync(args.in, "utf8")) : { ok: true };

  let passphrase;
  let reused = false;
  if (qrOnly && !existsSync(passFile)) {
    // 新しい合言葉を作ってしまうと config.enc と食い違う
    throw new Error(`--qr-only requires an existing passphrase file: ${passFile}`);
  }
  if (existsSync(passFile)) {
    passphrase = readFileSync(passFile, "utf8").trim();
    if (!passphrase) throw new Error(`${passFile} is empty`);
    reused = true;
  } else {
    passphrase = generatePassphrase();
    mkdirSync(dirname(passFile), { recursive: true, mode: 0o700 });
    writeFileSync(passFile, passphrase + "\n", { mode: 0o600 });
    chmodSync(passFile, 0o600);
  }

  if (!qrOnly) {
    const out = await encryptConfig(passphrase, plain);
    writeFileSync(args.out, JSON.stringify(out, null, 2) + "\n", { mode: 0o644 });
    chmodSync(args.out, 0o644); // 公開前提のファイルだが、他ユーザーから書き換えられない状態にしておく
    console.log(`wrote ${args.out} (keys: ${Object.keys(plain).join(", ") || "none"})`);
  }

  // ログイン用 QR。URL の fragment に合言葉を載せる（fragment はサーバに送られない）
  const url = (args.url ?? DEFAULT_URL).replace(/#.*$/, "");
  const qr = qrcode(0, "M");
  qr.addData(`${url}#code=${passphrase}`);
  qr.make();
  const qrPath = resolve(dirname(passFile), "family-schedule-login-qr.svg");
  writeFileSync(qrPath, qr.createSvgTag({ cellSize: 8, margin: 32, scalable: true }) + "\n", { mode: 0o600 });
  chmodSync(qrPath, 0o600); // 既存ファイルには mode が効かない
  console.log(`wrote ${qrPath} (login QR; treat it like the passphrase)`);
  console.log(
    reused
      ? `passphrase: reused from ${passFile}`
      : `passphrase: generated and saved to ${passFile} (not shown; open the file to read it)`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
