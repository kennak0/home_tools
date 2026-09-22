// 開発用の静的サーバ。pwa/ をルートとして配信する（GitHub Pages の /home_tools/ 相当）。
//   node pwa/tools/serve.mjs [--root pwa] [--port 8080]
// npm の依存は増やさない。
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { join, normalize, extname, resolve } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const root = resolve(args.root ?? "pwa");
const port = Number(args.port ?? 8080);

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

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, path);
  if (!file.startsWith(root)) {
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
      // Pages と同じ。HTTP キャッシュに頼らない作りかを見るため
      "Cache-Control": "max-age=600",
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  }
}).listen(port, () => console.log(`serving ${root} at http://localhost:${port}/`));
