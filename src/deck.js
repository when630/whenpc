const http = require('node:http');

// Local HTTP channel for stream deck plugins (integrations/ulanzi). Listens on 127.0.0.1 only and checks
// Host/Origin so pages from other sites can't read it or drive the widget.
//   GET  /state           current state once
//   GET  /events          SSE: current state on connect, then on every metrics tick / widget change.
//                         ?detail=1 asks for per-process data (top CPU processes) while connected
//   POST /widget/toggle   hide or show the widget (also /widget/show, /widget/hide)
//   POST /widget/lock     toggle "lock position (click-through)"
//   POST /widget/detail   show the widget with the process panel open (?tab=cpu|mem|gpu|io)
//   POST /theme/next      switch to the next theme of the same skin (?target=widget|deck)
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
    uptime: m.sys?.uptime ?? null, // seconds
    drives: (m.disk.drives || []).map((d) => ({ name: d.name, label: d.label || '', total: d.total, free: d.free })),
    // Only present while per-process collection is on (panel open, or a client asked with ?detail=1).
    // Top 3 by CPU (%) and by memory (private working set, bytes); same-name processes are grouped.
    top: m.detail?.cpu && m.detail?.mem
      ? {
        cpu: m.detail.cpu.slice(0, 3).map((p) => ({ name: p.n, count: p.c, cpu: round1(p.cpu) })),
        mem: m.detail.mem.slice(0, 3).map((p) => ({ name: p.n, count: p.c, mem: p.mem })),
      }
      : null,
  };
}

class DeckBridge {
  // hooks: { visible(), locked(), theme(), themes(), toggle(), show(), hide(), toggleLock(), openDetail(tab),
  //          nextTheme(target), openSettings(), detailDemandChanged() }
  constructor(hooks) {
    this.hooks = hooks;
    this.server = null;
    this.clients = new Set();
    this.detailClients = new Set(); // SSE clients that asked for per-process data
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
    this.detailClients.clear();
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

  // True while some plugin shows top processes; main keeps the collector's per-process counters on.
  wantsDetail() {
    return this.detailClients.size > 0;
  }

  state() {
    return { visible: this.hooks.visible(), locked: this.hooks.locked(), theme: this.hooks.theme(), themes: this.hooks.themes(), metrics: this.metrics, seq: this.seq, at: Date.now() };
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
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const { pathname } = url;
    if (req.method === 'GET' && pathname === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(this.state()));
      return;
    }
    if (req.method === 'GET' && pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`retry: 2000\ndata: ${JSON.stringify(this.state())}\n\n`);
      this.clients.add(res);
      const detail = url.searchParams.get('detail') === '1';
      if (detail) {
        this.detailClients.add(res);
        if (this.detailClients.size === 1) this.hooks.detailDemandChanged();
      }
      req.on('close', () => {
        this.clients.delete(res);
        if (this.detailClients.delete(res) && this.detailClients.size === 0) this.hooks.detailDemandChanged();
      });
      return;
    }
    const actions = {
      '/widget/toggle': this.hooks.toggle,
      '/widget/show': this.hooks.show,
      '/widget/hide': this.hooks.hide,
      '/widget/lock': this.hooks.toggleLock,
      '/widget/detail': () => this.hooks.openDetail(url.searchParams.get('tab') || 'cpu'),
      '/theme/next': () => this.hooks.nextTheme(url.searchParams.get('target') === 'deck' ? 'deck' : 'widget'),
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
