// Ad hoc static file server used only to manually verify the independent
// host fixture (tests/fixtures/independent-host/) against a real browser
// during development of gate C ("Prove portable consumption"). Not part of
// the automated test suite and not a product dependency - tests/bundle.test.cjs
// spawns its own server the same way, inline, so CI doesn't depend on this
// file either.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const port = process.argv[3] ? Number(process.argv[3]) : 4567;

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
  if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
