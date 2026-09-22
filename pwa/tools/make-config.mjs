// config.enc を作る。家族の合言葉を生成し、設定 JSON を AES-GCM で暗号化する。
//
//   node pwa/tools/make-config.mjs \
//     --out pwa/family-schedule/config.enc \
//     --passphrase-file ~/.config/home_tools/family-schedule.passphrase \
//     [--in config.plain.json]
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

// 合言葉: 5 文字 × 4 組、紛らわしい文字（0 o 1 l i）を除いた 31 種 → 約 99 bit
function generatePassphrase() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
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
  const args = parseArgs(process.argv.slice(2));
  if (!args.out || !args["passphrase-file"]) {
    console.error("usage: make-config.mjs --out <config.enc> --passphrase-file <path> [--in <plain.json>]");
    process.exit(2);
  }
  const passFile = resolve(args["passphrase-file"].replace(/^~(?=$|\/)/, homedir()));
  const plain = args.in ? JSON.parse(readFileSync(args.in, "utf8")) : { ok: true };

  let passphrase;
  let reused = false;
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

  const out = await encryptConfig(passphrase, plain);
  writeFileSync(args.out, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${args.out} (keys: ${Object.keys(plain).join(", ") || "none"})`);
  console.log(
    reused
      ? `passphrase: reused from ${passFile}`
      : `passphrase: generated and saved to ${passFile} (not shown; open the file to read it)`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
