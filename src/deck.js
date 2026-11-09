const http = require('node:http');

// Local HTTP channel for stream deck plugins (integrations/ulanzi). Listens on 127.0.0.1 only and checks
// Host/Origin so pages from other sites can't read it or drive the widget.
//   GET  /state           current state once
//   GET  /events          SSE: current state on connect, then on every metrics tick / widget change
//   POST /widget/toggle   hide or show the widget (also /widget/show, /widget/hide)
//   POST /settings/open   open the settings window
const DECK_PORT = 37631;

const LOCAL_HOSTS = new Set([`127.0.0.1:${DECK_PORT}`, `localhost:${DECK_PORT}`]);
// Plugin WebViews load from file:// or a local server.
const allowedOrigin = (origin) =>
  !origin || origin === 'null' || origin.startsWith('file://') || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);

const round1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

// Collector sample → the small, stable shape plugins draw from.
function summarize(m) {
  if (!m) return null;
  const memUsed = m.info.memTotal - m.mem.avail;
  const t = m.temp || {};
  const temp = t.source === 'lhm' ? (t.cpu ?? t.gpu) : t.acpi;
  return {
    cpu: round1(m.cpu.util),
    mem: round1((memUsed / m.info.memTotal) * 100),
    memUsed,
    memTotal: m.info.memTotal,
    gpu: round1(m.gpu.util),
    disk: round1(m.disk.active),
    diskRead: m.disk.read,
    diskWrite: m.disk.write,
    netRx: m.net.rx,
    netTx: m.net.tx,
    temp: round1(temp),
    tempLabel: t.source === 'lhm' ? (t.cpu != null ? 'CPU' : 'GPU') : t.acpi != null ? 'ACPI' : null,
  };
}

class DeckBridge {
  // hooks: { visible(), theme(), toggle(), show(), hide(), openSettings() }
  constructor(hooks) {
    this.hooks = hooks;
    this.server = null;
    this.clients = new Set();
    this.metrics = null;
    this.seq = 0; // bumps with each metrics sample, so clients can tell new samples from widget-only changes
    this.heartbeat = null;
    this.pushTimer = null;
  }

  start() {
    const server = http.createServer((req, res) => this.handle(req, res));
    server.on('error', (err) => {
      // Another instance (e.g. a dev run next to the installed app) owns the port: run without the channel.
      console.warn(`deck channel unavailable on ${DECK_PORT}`, err.code || err);
      this.server = null;
    });
    server.listen(DECK_PORT, '127.0.0.1');
    this.server = server;
    // Keep idle connections from being dropped.
    this.heartbeat = setInterval(() => { for (const c of this.clients) c.write(': ping\n\n'); }, 25000);
  }

  stop() {
    clearInterval(this.heartbeat);
    for (const c of this.clients) c.end();
    this.clients.clear();
    this.server?.close();
    this.server = null;
  }

  setMetrics(m) {
    try {
      this.metrics = summarize(m);
      this.seq++;
    } catch {
      return; // malformed sample; keep the last good one rather than break the collector loop
    }
    this.push();
  }

  // Widget visibility or theme changed; coalesce bursts into one push.
  changed() {
    if (this.clients.size === 0 || this.pushTimer) return;
    this.pushTimer = setTimeout(() => { this.pushTimer = null; this.push(); }, 100);
  }

  state() {
    return { visible: this.hooks.visible(), theme: this.hooks.theme(), metrics: this.metrics, seq: this.seq, at: Date.now() };
  }

  push() {
    if (this.clients.size === 0) return;
    const data = `data: ${JSON.stringify(this.state())}\n\n`;
    for (const c of this.clients) c.write(data);
  }

  handle(req, res) {
    const origin = req.headers.origin;
    // DNS rebinding: refuse requests that arrived under another name.
    if (!LOCAL_HOSTS.has(req.headers.host || '') || !allowedOrigin(origin)) {
      res.writeHead(403).end();
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Max-Age': '600' }).end();
      return;
    }
    const { pathname } = new URL(req.url || '/', `http://${req.headers.host}`);
    if (req.method === 'GET' && pathname === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(this.state()));
      return;
    }
    if (req.method === 'GET' && pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`retry: 2000\ndata: ${JSON.stringify(this.state())}\n\n`);
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    const actions = {
      '/widget/toggle': this.hooks.toggle,
      '/widget/show': this.hooks.show,
      '/widget/hide': this.hooks.hide,
      '/settings/open': this.hooks.openSettings,
    };
    if (req.method === 'POST' && actions[pathname]) {
      actions[pathname]();
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404).end();
  }
}

module.exports = { DeckBridge, DECK_PORT };
