const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

export function newCode() {
  return Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
}

// Per tab, not per device, so two tabs can play each other.
function clientId() {
  try {
    let id = sessionStorage.getItem('glyph-garden-id');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('glyph-garden-id', id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

// mode only matters if the room is new.
export function connect(code, handlers, mode = 'duet', role = '') {
  const id = clientId();
  let ws = null;
  let stopped = false;
  let retries = 0;

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/api/room/${code}/ws?id=${id}&mode=${mode}${role ? `&role=${role}` : ''}`);
    ws.onopen = () => {
      retries = 0;
      handlers.status('connected');
    };
    ws.onmessage = (e) => {
      try { handlers.message(JSON.parse(e.data)); } catch (err) { console.error(err); }
    };
    ws.onclose = (e) => {
      if (stopped) return;
      if (e.code === 4000) return handlers.status('full');
      handlers.status('reconnecting');
      setTimeout(open, Math.min(5000, 500 * 2 ** retries++));
    };
  };
  open();

  return {
    send: (msg) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
    close: () => { stopped = true; ws?.close(); },
  };
}
