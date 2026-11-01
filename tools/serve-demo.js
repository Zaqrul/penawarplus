#!/usr/bin/env node
/**
 * Serves tests/manual/ on http://127.0.0.1:8080 so the demo page can be opened
 * in a browser with the extension active (content scripts do not run on file://).
 * Listens on loopback only and serves nothing outside that folder.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'manual');
const PORT = Number(process.env.PORT) || 8080;

createServer(async (req, res) => {
  const name = new URL(req.url, 'http://x').pathname === '/' ? 'demo.html' : path.basename(new URL(req.url, 'http://x').pathname);
  try {
    const body = await readFile(path.join(ROOT, name));
    res.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' });
    res.end(body);
  } catch (_) {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Demo: http://127.0.0.1:${PORT}/   (Ctrl+C to stop)`));
