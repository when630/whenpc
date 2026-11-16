// Renderer watchdog. A widget renderer was once found spinning one core at 100% for days and holding
// 8 GB; it never reproduced on demand. This watches the widget renderer's CPU and memory, and when it
// goes bad it saves evidence (a CPU profile and recent app events) to <userData>/diagnostics, then
// restarts the renderer in a fresh process so the widget recovers on its own.
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const SAMPLE_MS = Number(process.env.WHENPC_WATCHDOG_SAMPLE_MS) || 15_000; // env: dev aid for testing
const BUSY_PERCENT = 80;        // of one core
const BUSY_SAMPLES = 4;         // consecutive samples (1 minute) before acting
const MEMORY_LIMIT_KB = 1.5 * 1024 * 1024; // private bytes; the widget normally sits around 100 MB
const PROFILE_MS = 10_000;
const CDP_TIMEOUT_MS = 5_000;
const KEEP_REPORTS = 5;
const EVENT_LOG_SIZE = 60;
const HISTORY_SIZE = 20;

const events = [];
const history = [];
let target = null; // () => webContents of the widget
let timer = null;
let last = null;   // { pid, cpuSec, at }
let busyStreak = 0;
let handling = false;
let selfKilled = false; // the render-process-gone that follows our own restart arrives asynchronously

const stamp = () => new Date().toISOString();
const diagDir = () => path.join(app.getPath('userData'), 'diagnostics');

// Record app events (sleep, lock, display and config changes) so a report shows what led up to it.
function note(type, detail) {
  events.push({ at: stamp(), type, ...(detail === undefined ? {} : { detail }) });
  if (events.length > EVENT_LOG_SIZE) events.shift();
}

function withTimeout(promise, ms, what) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms))]);
}

function rendererMetric(wc) {
  const pid = wc.getOSProcessId();
  return app.getAppMetrics().find((m) => m.pid === pid);
}

function sample() {
  const wc = target?.();
  if (!wc || wc.isDestroyed() || handling) return;
  const m = rendererMetric(wc);
  if (!m) return;

  // cumulativeCPUUsage isn't reset by other getAppMetrics() callers, unlike percentCPUUsage.
  const now = Date.now();
  const cpuSec = m.cpu.cumulativeCPUUsage;
  let percent = m.cpu.percentCPUUsage;
  if (cpuSec != null && last?.pid === m.pid) percent = ((cpuSec - last.cpuSec) / ((now - last.at) / 1000)) * 100;
  last = { pid: m.pid, cpuSec, at: now };

  const privateKB = m.memory.privateBytes ?? m.memory.workingSetSize;
  history.push({ at: stamp(), cpu: Math.round(percent), privateMB: Math.round(privateKB / 1024) });
  if (history.length > HISTORY_SIZE) history.shift();

  busyStreak = percent >= BUSY_PERCENT ? busyStreak + 1 : 0;
  if (busyStreak >= BUSY_SAMPLES) handle(wc, 'busy', m);
  else if (privateKB >= MEMORY_LIMIT_KB) handle(wc, 'memory', m);
}

async function captureProfile(wc) {
  const dbg = wc.debugger;
  if (dbg.isAttached()) return { error: 'debugger already attached (DevTools open?)' };
  dbg.attach('1.3');
  try {
    const send = (method, params) => withTimeout(dbg.sendCommand(method, params), CDP_TIMEOUT_MS, method);
    await send('Performance.enable', { timeDomain: 'threadTicks' });
    const before = (await send('Performance.getMetrics')).metrics;
    await send('Profiler.enable');
    await send('Profiler.setSamplingInterval', { interval: 500 });
    await send('Profiler.start');
    await new Promise((r) => setTimeout(r, PROFILE_MS));
    const { profile } = await send('Profiler.stop');
    const after = (await send('Performance.getMetrics')).metrics;
    return { profile, before, after };
  } finally {
    try { dbg.detach(); } catch { /* already gone */ }
  }
}

function topSelfTime(profile, limit = 15) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((id, i) => {
    const f = byId.get(id).callFrame;
    const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (profile.timeDeltas[i] || 0));
  });
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([fn, us]) => ({ fn, ms: Math.round(us / 1000) }));
}

// Performance.getMetrics before/after the profile window: what kind of work kept the thread busy.
function metricDelta(before, after) {
  const get = (list, k) => list.find((m) => m.name === k)?.value ?? 0;
  const keys = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'];
  const delta = Object.fromEntries(keys.map((k) => [k, +(get(after, k) - get(before, k)).toFixed(3)]));
  const now = Object.fromEntries(['JSHeapUsedSize', 'Nodes', 'JSEventListeners', 'Documents'].map((k) => [k, get(after, k)]));
  return { delta, now };
}

function prune(dir) {
  const reports = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const f of reports.slice(0, Math.max(0, reports.length - KEEP_REPORTS))) {
    for (const ext of ['.json', '.cpuprofile']) fs.rmSync(path.join(dir, f.replace(/\.json$/, ext)), { force: true });
  }
}

async function handle(wc, reason, metric) {
  handling = true;
  busyStreak = 0;
  note('watchdog', reason);
  const report = {
    reason,
    at: stamp(),
    appVersion: app.getVersion(),
    uptimeSec: Math.round(process.uptime()),
    renderer: { pid: metric.pid, createdAt: new Date(metric.creationTime).toISOString(), privateMB: Math.round((metric.memory.privateBytes ?? 0) / 1024) },
    history: [...history],
    events: [...events],
  };
  let profile = null;
  try {
    const cap = await captureProfile(wc);
    if (cap.error) report.profileError = cap.error;
    else {
      profile = cap.profile;
      report.top = topSelfTime(cap.profile);
      report.metrics = metricDelta(cap.before, cap.after);
    }
  } catch (e) {
    report.profileError = String(e?.message || e);
  }

  try {
    const dir = diagDir();
    fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, `renderer-${report.at.replace(/[:.]/g, '-')}`);
    fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
    if (profile) fs.writeFileSync(`${base}.cpuprofile`, JSON.stringify(profile));
    prune(dir);
    console.error(`watchdog: renderer ${reason}; report saved to ${base}.json`);
  } catch (e) {
    console.error('watchdog: saving report failed', e);
  }

  // A reload in the same process would keep any native memory; end the process and let the
  // render-process-gone handler load the page into a fresh one. Reloading right after
  // forcefullyCrashRenderer() left the widget blank in testing (Electron 45).
  if (!wc.isDestroyed()) {
    selfKilled = true;
    wc.forcefullyCrashRenderer();
  }
  last = null;
  history.length = 0;
  handling = false;
}

function start(getWebContents) {
  target = getWebContents;
  if (timer) return;
  timer = setInterval(sample, SAMPLE_MS);
  // Load the page into a new process after our own restart, and after any other renderer death,
  // which would otherwise leave a blank widget.
  app.on('render-process-gone', (_e, wc, details) => {
    if (wc !== target?.()) return;
    note('render-process-gone', details.reason);
    const ours = selfKilled;
    selfKilled = false;
    if (!ours && details.reason === 'clean-exit') return;
    setTimeout(() => { if (!wc.isDestroyed()) wc.reload(); }, ours ? 200 : 1000);
  });
}

module.exports = { start, note, diagDir };
