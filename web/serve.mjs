// Minimal static file server for local development: node serve.mjs [port]
// (the Explorer fetches data/ files, which browsers block over file://).

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 8000);
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".bin": "application/octet-stream", ".png": "image/png", ".pdf": "application/pdf",
};

const PDFS = { "/lunazen_guide.pdf": "lunazen_guide.pdf", "/how_the_app_works.pdf": "lunazen_guide.pdf" };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  let file = normalize(join(root, path));
  const pdf = PDFS[path]; // the site build copies the PDFs into the root; in development they are served from docs/learn
  if (pdf) file = join(root, "..", "docs", "learn", pdf);
  if (file !== root && !file.startsWith(root + sep) && !pdf) return void res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`Explorer: http://localhost:${port}/`));
