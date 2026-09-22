// 開発用の静的サーバ。pwa/ をルートとして配信する（GitHub Pages の /home_tools/ 相当）。
//   node pwa/tools/serve.mjs [--root pwa] [--port 8080] [--no-cache]
// npm の依存は増やさない。
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { join, normalize, extname, resolve, sep } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const root = resolve(args.root ?? "pwa");
const port = Number(args.port ?? 8080);
// 既定は Pages と同じ max-age=600（HTTP キャッシュに頼らない作りかを見るため）。
// --no-cache は編集を繰り返すとき用。古いモジュールを掴んだまま調べても結論が出ない
const noCache = "no-cache" in args;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".enc": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// http でしか配信しないので、LAN の実機からはログイン（crypto.subtle）もカメラも動かない。
// 実機テストは https で（AGENTS.md「テスト」）。
createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path;
  try {
    path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  } catch {
    res.writeHead(400).end("bad request"); // 壊れた % エスケープでプロセスを落とさない
    return;
  }
  let file = join(root, path);
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (statSync(file).isDirectory()) {
      if (!path.endsWith("/")) {
        res.writeHead(301, { Location: path + "/" + url.search }).end();
        return;
      }
      file = join(file, "index.html");
    }
    const size = statSync(file).size;
    res.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Content-Length": size,
      "Cache-Control": noCache ? "no-store" : "max-age=600",
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  }
}).listen(port, () => console.log(`serving ${root} at http://localhost:${port}/`));
