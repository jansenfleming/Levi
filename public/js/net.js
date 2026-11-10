// Live state from the server over a one-way WebSocket, with automatic reconnect.
// Same interface as the scripted source: on('state' | 'event' | 'status'), start().

export function createSocketSource() {
  const listeners = { state: [], event: [], status: [], snapshot: [] };
  const emit = (k, v) => listeners[k].forEach((f) => f(v));
  let ws = null, retry = 0, timer = null;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    emit('status', 'connecting');
    ws.onopen = () => { retry = 0; emit('status', 'live'); };
    ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.type === 'snapshot') {
        emit('snapshot', msg.events || []);
        emit('state', msg.state);
      } else if (msg.type === 'state') emit('state', msg.state);
      else if (msg.type === 'event') emit('event', msg.event);
    };
    ws.onclose = () => {
      emit('status', 'offline');
      clearTimeout(timer);
      const delay = Math.min(30000, 1000 * 2 ** retry++) * (0.75 + Math.random() * 0.5);
      timer = setTimeout(connect, delay);
    };
    ws.onerror = () => ws.close();
  }

  // Reconnect promptly when a phone wakes the tab back up.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ws && ws.readyState > 1) { clearTimeout(timer); retry = 0; connect(); }
  });

  return {
    on(k, f) { listeners[k].push(f); },
    start: connect,
  };
}
