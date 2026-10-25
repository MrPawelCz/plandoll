// Zero-dependency static file server for the built page. Binds to 127.0.0.1 only.
// Usage: node tools/serve.mjs [dir] [port]   (defaults: dist, 8080)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const dir = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (rel === '/') rel = '/plandoll.html';
    const file = resolve(join(dir, rel));
    if (file !== dir && !file.startsWith(dir + sep)) { res.writeHead(403).end('forbidden'); return; }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`plandoll: http://127.0.0.1:${port}/plandoll.html  (serving ${dir}, Ctrl+C to stop)`);
});
