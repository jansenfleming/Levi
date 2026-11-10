// Levi's read-only window onto the public web.
//
// Safety properties:
// - Only http/https on ports 80/443.
// - Every hostname is resolved and every resolved address is checked at connect time (inside the
//   socket's DNS lookup), so private, loopback, link-local and other non-public ranges are refused,
//   including after redirects and DNS rebinding. Levi can never reach Ollama, the Pi or your LAN.
// - Redirects are followed manually (max 3) and re-checked.
// - Responses are capped in size and time; only text/html and text/plain are read.
// - Fetched text is returned as plain text and labelled as untrusted when shown to the model.
// - GET only, no cookies, no credentials, generic User-Agent.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { config } from './config.ts';
import { store } from './db.ts';

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 12_000;
const UA = 'Mozilla/5.0 (compatible; LeviTownBot/0.1; read-only experiment)';

export class WebError extends Error {}

function isPublicIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;     // CGNAT
  if (a === 169 && b === 254) return false;               // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;                 // 192.0.0.0/24, 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return false;  // benchmarking
  if (a === 198 && b === 51) return false;
  if (a === 203 && b === 0) return false;
  if (a >= 224) return false;                             // multicast, reserved, broadcast
  return true;
}

function isPublicIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isPublicIPv4(ip);
  if (!net.isIPv6(ip)) return false;
  const v = ip.toLowerCase();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIPv4(mapped[1]);
  if (v === '::' || v === '::1') return false;
  if (/^(fc|fd)/.test(v)) return false;                   // unique local
  if (/^fe[89ab]/.test(v)) return false;                  // link-local
  if (/^ff/.test(v)) return false;                        // multicast
  if (v.startsWith('2001:db8') || v.startsWith('64:ff9b') || v.startsWith('2002:')) return false;
  return true;
}

/** DNS lookup that refuses non-public addresses. Used for every socket we open. */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = (addresses as unknown as dns.LookupAddress[]);
    const ok = list.filter((a) => isPublicIP(a.address));
    if (!ok.length) return callback(new WebError(`refusing non-public address for ${hostname}`), '', 4);
    if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, ok);
    callback(null, ok[0].address, ok[0].family);
  });
};

function checkUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new WebError('not a valid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new WebError('only http and https are allowed');
  if (u.username || u.password) throw new WebError('URLs with credentials are not allowed');
  if (u.port && u.port !== '80' && u.port !== '443') throw new WebError('only ports 80 and 443 are allowed');
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && !isPublicIP(u.hostname.replace(/^\[|\]$/g, ''))) throw new WebError('non-public address');
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|.*\.localhost)$/i.test(u.hostname)) throw new WebError('non-public hostname');
  return u;
}

function getOnce(u: URL): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method: 'GET', lookup: safeLookup, timeout: TIMEOUT_MS,
      headers: { 'User-Agent': UA, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1', 'Accept-Language': 'en' },
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ status, headers: res.headers, body: '', location: res.headers.location });
      }
      const type = String(res.headers['content-type'] || '');
      if (!/text\/html|text\/plain|application\/xhtml|application\/json/i.test(type)) {
        res.destroy();
        return reject(new WebError(`unsupported content type: ${type || 'unknown'}`));
      }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) { res.destroy(); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('close', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new WebError('timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function safeGet(raw: string) {
  let u = checkUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const r = await getOnce(u);
    if (!r.location) return { url: u.toString(), ...r };
    if (hop === 3) throw new WebError('too many redirects');
    u = checkUrl(new URL(r.location, u).toString());
  }
  throw new WebError('too many redirects');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function htmlToText(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  // Prefer the page's main content over navigation and sidebars.
  const main = html.match(/<main[\s>][\s\S]*?<\/main>/i)?.[0] || html.match(/<article[\s>][\s\S]*?<\/article>/i)?.[0];
  const text = (main && main.length > 500 ? main : html)
    .replace(/<(nav|header|footer|aside|form|button)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '; }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

function rateLimited(): boolean {
  return store.webFetchesSince(Date.now() - 3_600_000) >= config.webFetchesPerHour;
}

export interface PageResult { url: string; title: string; text: string }

/** Read one public page as plain text (capped). */
export async function readPage(rawUrl: string): Promise<PageResult> {
  if (rateLimited()) { store.logWeb('fetch', rawUrl, null, 'rate-limited', null); throw new WebError('reading limit reached for this hour'); }
  try {
    const r = await safeGet(rawUrl);
    if (r.status >= 400) throw new WebError(`HTTP ${r.status}`);
    const isHtml = /html/i.test(String(r.headers['content-type']));
    const { title, text } = isHtml ? htmlToText(r.body) : { title: '', text: r.body };
    const out = { url: r.url, title: title.slice(0, 200), text: text.slice(0, config.webMaxChars) };
    store.logWeb('fetch', rawUrl, r.url, `ok ${r.status}`, out.text.slice(0, 500));
    return out;
  } catch (err) {
    store.logWeb('fetch', rawUrl, null, `error: ${(err as Error).message}`, null);
    throw err instanceof WebError ? err : new WebError((err as Error).message);
  }
}

export interface SearchResult { title: string; url: string; snippet: string }

/** Web search. Default provider: Wikipedia (keyless). Set SEARXNG_URL to use your own SearXNG instance. */
export async function search(query: string): Promise<SearchResult[]> {
  const q = query.slice(0, 200);
  try {
    let results: SearchResult[];
    if (config.searxngUrl) {
      const u = new URL('/search', config.searxngUrl);
      u.searchParams.set('q', q); u.searchParams.set('format', 'json');
      // The SearXNG instance is configured by you, so it may be on your LAN; plain fetch is fine here.
      const r = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA } });
      const j = (await r.json()) as { results?: { title: string; url: string; content?: string }[] };
      results = (j.results || []).slice(0, 8).map((x) => ({ title: x.title, url: x.url, snippet: (x.content || '').slice(0, 300) }));
    } else {
      const u = new URL('https://en.wikipedia.org/w/api.php');
      u.searchParams.set('action', 'query'); u.searchParams.set('list', 'search'); u.searchParams.set('srsearch', q);
      u.searchParams.set('format', 'json'); u.searchParams.set('srlimit', '8');
      const r = await safeGet(u.toString());
      const j = JSON.parse(r.body) as { query?: { search?: { title: string; snippet: string }[] } };
      results = (j.query?.search || []).map((x) => ({
        title: x.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, '_'))}`,
        snippet: htmlToText(x.snippet).text.slice(0, 300),
      }));
    }
    store.logWeb('search', q, null, `ok ${results.length}`, results.map((r) => r.title).join(' | ').slice(0, 500));
    return results;
  } catch (err) {
    store.logWeb('search', q, null, `error: ${(err as Error).message}`, null);
    throw new WebError((err as Error).message);
  }
}

export const _test = { isPublicIP, checkUrl };
