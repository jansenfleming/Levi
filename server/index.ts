// Alien Town server: serves the static site with strict security headers,
// runs the simulation and streams it to browsers over a one-way WebSocket.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { config, ROOT } from './config.ts';
import { Simulation } from './sim.ts';
import { PlaceholderDecider } from './decider.ts';
import { attachHub } from './hub.ts';

const HOST = config.host;
const PORT = config.port;

const PUBLIC_DIR = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
// Only these parts of the three package are served.
const THREE_ALLOWED = ['build', path.join('examples', 'jsm')];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// The page uses an inline import map; allow exactly that script via its hash.
async function buildIndex(): Promise<{ html: Buffer; csp: string }> {
  const html = await readFile(path.join(PUBLIC_DIR, 'index.html'));
  const m = html.toString('utf8').match(/<script type="importmap">([\s\S]*?)<\/script>/);
  const hashes = m ? [`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`] : [];
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`,
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  return { html, csp };
}

let indexCache = await buildIndex();
const DEV = config.dev;

function baseHeaders(res: ServerResponse, csp: string) {
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function safeJoin(base: string, rel: string): string | null {
  const p = path.normalize(path.join(base, rel));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

async function sendFile(res: ServerResponse, file: string, csp: string, cache: string) {
  try {
    const s = await stat(file);
    if (!s.isFile()) return notFound(res, csp);
    const body = await readFile(file);
    baseHeaders(res, csp);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': cache,
    });
    res.end(body);
  } catch {
    notFound(res, csp);
  }
}

function notFound(res: ServerResponse, csp: string) {
  baseHeaders(res, csp);
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  const url = new URL(req.url || '/', 'http://x');
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); } catch { return notFound(res, indexCache.csp); }

  if (pathname === '/' || pathname === '/index.html') {
    if (DEV) indexCache = await buildIndex();
    baseHeaders(res, indexCache.csp);
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    return res.end(indexCache.html);
  }

  if (pathname.startsWith('/vendor/three/')) {
    const rel = pathname.slice('/vendor/three/'.length);
    if (!THREE_ALLOWED.some((d) => path.normalize(rel).startsWith(d + path.sep))) return notFound(res, indexCache.csp);
    const file = safeJoin(THREE_DIR, rel);
    if (!file) return notFound(res, indexCache.csp);
    return sendFile(res, file, indexCache.csp, 'public, max-age=86400');
  }

  const file = safeJoin(PUBLIC_DIR, pathname);
  if (!file) return notFound(res, indexCache.csp);
  return sendFile(res, file, indexCache.csp, DEV ? 'no-cache' : 'public, max-age=300');
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('request failed', err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

const sim = new Simulation(new PlaceholderDecider());
attachHub(server, sim);
sim.start();

server.listen(PORT, HOST, () => {
  console.log(`[alien-town] http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (town tz ${config.townTz})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { sim.stop(); process.exit(0); });
}
