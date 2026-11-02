/* PR Forge — local dev server. Run `node tools/serve.js`, then open http://localhost:8000/.
 * Nothing is cached, and sw.js stays off on localhost, so a refresh always shows your latest edits. */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var PORT = Number(process.env.PORT) || 8000;
var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

http.createServer(function (req, res) {
  var urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { res.writeHead(400); res.end('Bad request'); return; }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  var file = path.join(ROOT, urlPath);
  if (file.indexOf(ROOT + path.sep) !== 0) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', function () {
  console.log('PR Forge running at http://localhost:' + PORT + '/');
});
