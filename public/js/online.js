// Online duet: a live connection (WebSocket) to the room on the server.
// The room keeps the messages, so a phone that drops out can rejoin and catch up.

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L mix-ups

export function newCode() {
  return Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
}

// A stable id for this tab, so a reload gets the same seat back
// (per tab, so two tabs on one device count as two people).
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

// handlers.message(msg) gets every message from the room;
// handlers.status('connected' | 'reconnecting' | 'full') reports the connection.
// mode = 'duet' or 'party' — only used if this is a brand-new room.
export function connect(code, handlers, mode = 'duet') {
  const id = clientId();
  let ws = null;
  let stopped = false;
  let retries = 0;

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/api/room/${code}/ws?id=${id}&mode=${mode}`);
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
      setTimeout(open, Math.min(5000, 500 * 2 ** retries++)); // try again, waiting a bit longer each time
    };
  };
  open();

  return {
    send: (msg) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
    close: () => { stopped = true; ws?.close(); },
  };
}
