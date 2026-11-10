// WebSocket broadcast hub. Strictly one-way: the server talks, browsers listen.
// Anything a browser sends is ignored, and oversized frames close the connection.

import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Simulation, WorldState, SimEvent } from './sim.ts';
import { config } from './config.ts';

export function attachHub(server: Server, sim: Simulation) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 256,          // visitors have nothing to say
    perMessageDeflate: false, // cheap on the Pi
  });
  const perIp = new Map<string, number>();
  const alive = new WeakMap<WebSocket, boolean>();

  const ipOf = (req: IncomingMessage) => {
    // Behind Cloudflare Tunnel the real client IP is in CF-Connecting-IP.
    const cf = req.headers['cf-connecting-ip'];
    return (typeof cf === 'string' && cf) || req.socket.remoteAddress || '?';
  };

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://x');
    const ip = ipOf(req);
    if (url.pathname !== '/ws' || wss.clients.size >= config.maxClients || (perIp.get(ip) ?? 0) >= config.maxClientsPerIp) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      ws.once('close', () => {
        const n = (perIp.get(ip) ?? 1) - 1;
        if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);
      });
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('message', () => { /* watch-only: ignored */ });
    ws.on('error', () => ws.terminate());
    // Late joiners get everything they need to render the current moment.
    send(ws, { type: 'snapshot', state: sim.snapshot(), events: sim.events.slice(-50) });
  });

  // Drop dead connections.
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
  }, 30_000).unref();

  function send(ws: WebSocket, msg: unknown) {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 1_000_000) ws.send(JSON.stringify(msg));
  }
  function broadcast(msg: unknown) {
    if (!wss.clients.size) return;
    const data = JSON.stringify(msg);
    for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 1_000_000) ws.send(data);
  }

  sim.on({
    state: (state: WorldState) => broadcast({ type: 'state', state }),
    event: (event: SimEvent) => broadcast({ type: 'event', event }),
  });

  return { clients: () => wss.clients.size };
}
