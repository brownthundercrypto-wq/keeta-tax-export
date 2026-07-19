/*
 * Local static server for the web tool.
 *
 * Serves the REPOSITORY ROOT (not web/) so that ../lib/*.js and
 * ../data/known-addresses.json resolve exactly as they will on a static host.
 * The page loads the same library files the CLI requires -- no build step, no
 * bundler, nothing to keep in sync.
 *
 *   node web/serve.js   ->  http://localhost:8900/web/
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8900;

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.css': 'text/css; charset=utf-8'
};

http.createServer((req, res) => {
	let rel = decodeURIComponent(req.url.split('?')[0]);
	if (rel === '/' || rel === '/web' || rel === '/web/') {
		rel = '/web/index.html';
	}

	/* Keep requests inside the repo. */
	const filePath = path.normalize(path.join(ROOT, rel));
	if (!filePath.startsWith(ROOT)) {
		res.writeHead(403);
		res.end('forbidden');
		return;
	}

	fs.readFile(filePath, (err, data) => {
		if (err) {
			res.writeHead(404);
			res.end('not found: ' + rel);
			return;
		}
		res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
		res.end(data);
	});
}).listen(PORT, () => console.log(`web tool: http://localhost:${PORT}/web/`));
