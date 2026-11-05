const HISTORY = 60;
const $ = (sel, root = document) => root.querySelector(sel);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Theme colors may be hex, rgb() or named; normalize through canvas to apply an alpha.
const colorCtx = document.createElement('canvas').getContext('2d');
function withAlpha(color, a) {
  colorCtx.fillStyle = '#000';
  colorCtx.fillStyle = color;
  const c = colorCtx.fillStyle; // '#rrggbb' or 'rgba(r, g, b, a)'
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const [r, g, b, a0 = 1] = c.match(/[\d.]+/g).map(Number);
  return `rgba(${r}, ${g}, ${b}, ${a * a0})`;
}
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ---------- formatting ----------
const GB = 1024 ** 3;
function bytes(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (Math.abs(n) >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : n < 10 ? digits : 0)} ${units[i]}`;
}
const rate = (n) => `${bytes(n)}/s`;
const level = (p) => (p == null ? '' : p >= 90 ? 'crit' : p >= 75 ? 'warn' : '');

// ---------- sparkline ----------
class Spark {
  constructor(canvas, colorVars, { max = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.colorVars = colorVars;
    this.fixedMax = max;
    this.series = colorVars.map(() => new Array(HISTORY).fill(null));
  }

  push(...values) {
    values.forEach((v, i) => { this.series[i].push(Number.isFinite(v) ? v : null); this.series[i].shift(); });
    this.draw();
  }

  draw() {
    const { canvas, ctx } = this;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = (window.devicePixelRatio || 1) * scale;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const all = this.series.flat().filter((v) => v != null);
    const max = this.fixedMax ?? Math.max(1024, ...all) * 1.2;
    const step = w / (HISTORY - 1);
    const yOf = (v) => h - 1.5 - (Math.min(v, max) / max) * (h - 4);

    // draw back-to-front so the primary series sits on top
    [...this.series.keys()].reverse().forEach((si) => {
      const s = this.series[si];
      const color = css(this.colorVars[si]);
      const first = s.findIndex((v) => v != null);
      if (first < 0) return;

      ctx.beginPath();
      for (let i = first; i < s.length; i++) {
        const x = i * step, y = yOf(s[i] ?? 0);
        if (i === first) { ctx.moveTo(x, y); continue; }
        // smooth with quadratic midpoints
        const px = (i - 1) * step, py = yOf(s[i - 1] ?? 0);
        ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
      }
      ctx.lineTo((s.length - 1) * step, yOf(s[s.length - 1] ?? 0));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.lineTo((s.length - 1) * step, h);
      ctx.lineTo(first * step, h);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, withAlpha(color, si === 0 ? 0.32 : 0.2));
      g.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = g;
      ctx.fill();
    });
  }
}

// ---------- tiles ----------
const RING_C = 2 * Math.PI * 20;
const NET_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8 4v15m0 0-4-4m4 4 4-4M16 20V5m0 0 4 4m-4-4-4 4"/></svg>';

const TILE_DEFS = [
  { k: 'cpu', label: 'CPU', spark: ['--cpu'], max: 100 },
  { k: 'mem', label: '메모리', spark: ['--mem'], max: 100 },
  { k: 'gpu', label: 'GPU', spark: ['--gpu'], max: 100, subs: 2 },
  { k: 'disk', label: '디스크', spark: ['--disk', '--disk2'], extra: true },
  { k: 'net', label: '네트워크', spark: ['--net', '--net2'], icon: NET_ICON },
  { k: 'temp', label: '온도', spark: ['--temp'], max: 100 },
];

const tiles = {};
for (const def of TILE_DEFS) {
  const root = el('section', 'tile');
  root.dataset.k = def.k;

  let gauge;
  if (def.icon) {
    gauge = el('div', 'gauge icon');
    gauge.innerHTML = def.icon;
  } else {
    gauge = el('div', 'gauge');
    gauge.innerHTML = `<svg viewBox="0 0 48 48"><circle class="track" cx="24" cy="24" r="20"/><circle class="arc" cx="24" cy="24" r="20" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/></svg><span class="gv"></span>`;
  }

  const body = el('div', 'body');
  const head = el('div', 'head');
  head.append(el('span', 'label', def.label), el('span', 'meta'));
  const canvas = el('canvas', 'spark');
  const subs = Array.from({ length: def.subs || 1 }, () => el('div', 'sub'));
  body.append(head, canvas, ...subs);

  root.append(gauge, body);
  let extra = null;
  if (def.extra) { extra = el('div', 'extra'); root.append(extra); }
  $('#tiles').append(root);

  tiles[def.k] = {
    root, extra, subs,
    meta: $('.meta', head),
    arc: $('.arc', gauge),
    gv: $('.gv', gauge),
    spark: new Spark(canvas, def.spark, { max: def.max ?? null }),
  };
}

function setGauge(t, percent, text, unit = '%') {
  const p = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  if (t.arc) t.arc.style.strokeDashoffset = String(RING_C * (1 - p / 100));
  if (t.gv) {
    t.gv.replaceChildren(document.createTextNode(text ?? '–'));
    if (text != null && unit) t.gv.append(el('small', null, unit));
  }
  t.root.classList.remove('warn', 'crit');
  const l = level(percent);
  if (l) t.root.classList.add(l);
}

function dots(...items) {
  return items.map(([text, colorVar]) => {
    const s = el('span', 'dot', text);
    s.style.setProperty('--dot', `var(${colorVar})`);
    return s;
  });
}

function renderDrives(container, drives) {
  container.replaceChildren(...drives.map((d) => {
    const used = d.total - d.free;
    const p = d.total ? (used / d.total) * 100 : 0;
    const row = el('div', 'drive');
    row.title = `${d.name} ${d.label || ''}\n사용 ${bytes(used)} / ${bytes(d.total)} · 남음 ${bytes(d.free)}`;
    const bar = el('div', `bar ${level(p)}`);
    const fill = el('i');
    fill.style.width = `${p.toFixed(1)}%`;
    bar.append(fill);
    row.append(el('b', null, d.name), bar, el('span', null, `${bytes(d.free, 0)} 남음`));
    return row;
  }));
}

// ---------- render metrics ----------
const ENGINE_LABELS = { '3D': '3D', VideoDecode: '디코드', VideoEncode: '인코드', VideoProcessing: '비디오', Copy: '복사', Compute: '연산' };
let lastDrivesKey = '';

function render(m) {
  $('#error').hidden = true;
  let t;

  // CPU
  t = tiles.cpu;
  setGauge(t, m.cpu.util, Math.round(m.cpu.util));
  t.spark.push(m.cpu.util);
  t.meta.textContent = m.cpu.mhz ? `${(m.cpu.mhz / 1000).toFixed(2)} GHz` : '';
  t.subs[0].textContent = `${m.info.cores}코어 · ${m.info.threads}스레드`;
  t.root.title = m.info.cpuName;

  // Memory
  t = tiles.mem;
  const used = m.info.memTotal - m.mem.avail;
  const memP = (used / m.info.memTotal) * 100;
  setGauge(t, memP, Math.round(memP));
  t.spark.push(memP);
  t.meta.textContent = `${(used / GB).toFixed(1)} / ${(m.info.memTotal / GB).toFixed(0)} GB`;
  t.subs[0].textContent = `커밋 ${(m.mem.commit / GB).toFixed(0)} / ${(m.mem.commitLimit / GB).toFixed(0)} GB`;

  // GPU
  t = tiles.gpu;
  setGauge(t, m.gpu.util, Math.round(m.gpu.util));
  t.spark.push(m.gpu.util);
  const engines = Object.entries(m.gpu.engines)
    .filter(([k]) => ENGINE_LABELS[k])
    .sort((a, b) => b[1] - a[1]);
  t.meta.textContent = engines.length ? `${ENGINE_LABELS[engines[0][0]]} ${Math.round(engines[0][1])}%` : '';
  t.subs[0].textContent = engines.slice(1, 4).map(([k, v]) => `${ENGINE_LABELS[k]} ${Math.round(v)}%`).join(' · ');
  t.subs[1].textContent = m.gpu.dedicated > 0
    ? `VRAM 전용 ${bytes(m.gpu.dedicated)} · 공유 ${bytes(m.gpu.shared)}`
    : `VRAM 공유 ${bytes(m.gpu.shared)}`;
  t.root.title = m.info.gpuName;

  // Disk
  t = tiles.disk;
  setGauge(t, m.disk.active, m.disk.active == null ? null : Math.round(m.disk.active));
  t.spark.push(m.disk.read, m.disk.write);
  t.meta.textContent = '';
  t.subs[0].replaceChildren(...dots([`읽기 ${rate(m.disk.read)}`, '--disk'], [`쓰기 ${rate(m.disk.write)}`, '--disk2']));
  const drivesKey = JSON.stringify(m.disk.drives);
  if (drivesKey !== lastDrivesKey) { lastDrivesKey = drivesKey; renderDrives(t.extra, m.disk.drives); }

  // Network
  t = tiles.net;
  t.spark.push(m.net.rx, m.net.tx);
  t.subs[0].replaceChildren(...dots([`↓ ${rate(m.net.rx)}`, '--net'], [`↑ ${rate(m.net.tx)}`, '--net2']));

  // IDE skin status bar
  $('#sb-left').textContent = `CPU ${Math.round(m.cpu.util)}%  ·  MEM ${Math.round(memP)}%  ·  GPU ${Math.round(m.gpu.util)}%`;
  $('#sb-right').textContent = m.sys ? `가동 ${uptimeText(m.sys.uptime)}` : '';

  // Temperature
  t = tiles.temp;
  const temp = m.temp;
  if (temp.source === 'lhm') {
    const main = temp.cpu ?? temp.gpu;
    setGauge(t, main, Math.round(main), '°');
    t.spark.push(main);
    t.meta.textContent = temp.cpu != null ? 'CPU 패키지' : 'GPU';
    t.subs[0].textContent = [temp.gpu != null && temp.cpu != null ? `GPU ${Math.round(temp.gpu)}°C` : null, 'LibreHardwareMonitor'].filter(Boolean).join(' · ');
  } else if (temp.acpi != null) {
    setGauge(t, temp.acpi, Math.round(temp.acpi), '°');
    t.spark.push(temp.acpi);
    t.meta.textContent = '시스템 (ACPI)';
    t.subs[0].textContent = 'CPU 코어 온도 아님';
  } else {
    setGauge(t, null, null);
    t.meta.textContent = '센서 없음';
    t.subs[0].textContent = 'LibreHardwareMonitor 연동 필요';
  }
}

// ---------- config ----------
let scale = 1;

function applyConfig(c) {
  scale = c.scale / 100;
  const html = document.documentElement;
  html.dataset.skin = c.skin;
  html.dataset.theme = c.theme;
  html.toggleAttribute('data-dark', !!c.themeDark);
  const root = document.documentElement.style;
  root.setProperty('--solid', String(1 - c.transparency / 100));
  root.setProperty('--scale', String(scale));
  document.body.classList.toggle('no-clock', !c.items.clock);
  document.body.classList.toggle('no-graphs', !c.showGraphs);

  let any = false;
  for (const k of Object.keys(tiles)) {
    tiles[k].root.hidden = !c.items[k];
    any ||= !!c.items[k];
  }
  tiles.gpu.subs[1].hidden = !c.items.gpuMem;
  tiles.disk.extra.hidden = !c.items.drives;
  $('#empty').hidden = any;

  document.body.classList.toggle('expanded', !!c.expanded);
  document.body.classList.toggle('side-left', c.detailSide === 'left');
  $('#detail').hidden = !c.expanded;
  $('#expand').setAttribute('aria-pressed', String(!!c.expanded));
  $('#expand').title = c.expanded ? '상세 닫기' : '상세 보기';
  setTab(c.detailTab || 'cpu', false);

  requestAnimationFrame(() => {
    Object.values(tiles).forEach((t) => t.spark.draw());
    fitWindow();
  });
}

// ---------- detail panel ----------
const FRIENDLY = {
  msmpeng: 'Microsoft Defender', vmmemwsl: 'WSL', vmmem: '가상 머신 (vmmem)', svchost: '서비스 호스트',
  dwm: '데스크톱 창 관리자', explorer: '파일 탐색기', system: '시스템', 'memory compression': '메모리 압축',
  registry: '레지스트리', csrss: '클라이언트 서버 런타임', chrome: 'Chrome', msedge: 'Microsoft Edge',
  msedgewebview2: 'Edge WebView2', firefox: 'Firefox', code: 'VS Code', idea64: 'IntelliJ IDEA',
  searchhost: 'Windows 검색', startmenuexperiencehost: '시작 메뉴', shellexperiencehost: 'Windows 셸',
  runtimebroker: '런타임 브로커', audiodg: '오디오 장치 그래프', teams: 'Teams', 'ms-teams': 'Teams',
  slack: 'Slack', discord: 'Discord', kakaotalk: '카카오톡', powershell: 'PowerShell', pwsh: 'PowerShell 7',
  windowsterminal: 'Windows 터미널', 'wslservice': 'WSL 서비스', 'com.docker.backend': 'Docker',
};
const friendly = (n) => FRIENDLY[n.toLowerCase()] || n;
const hue = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
const pctText = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;

const TABS = {
  cpu: {
    value: (p) => p.cpu, text: (p) => pctText(p.cpu),
    sub: (p) => `메모리 ${bytes(p.mem)}${p.gpu >= 0.5 ? ` · GPU ${pctText(p.gpu)}` : ''}`,
    summary: (m) => `전체 <b>${Math.round(m.cpu.util)}%</b> · 논리 프로세서 ${m.info.threads}개 기준`,
    note: 'CPU 시간을 논리 프로세서 수로 나눈 값입니다.',
  },
  mem: {
    value: (p) => p.mem, text: (p) => bytes(p.mem),
    sub: (p) => `CPU ${pctText(p.cpu)} · RAM의 ${((p.mem / lastMemTotal) * 100).toFixed(1)}%`,
    summary: (m) => `사용 <b>${((m.info.memTotal - m.mem.avail) / GB).toFixed(1)} GB</b> / ${(m.info.memTotal / GB).toFixed(0)} GB`,
    note: '개인 작업 집합(다른 프로세스와 공유하지 않는 메모리) 기준입니다.',
  },
  gpu: {
    value: (p) => p.gpu, text: (p) => pctText(p.gpu),
    sub: (p) => [p.vram > 0 ? `VRAM ${bytes(p.vram)}` : null, `CPU ${pctText(p.cpu)}`, `메모리 ${bytes(p.mem)}`].filter(Boolean).join(' · '),
    summary: (m) => `전체 <b>${Math.round(m.gpu.util)}%</b> · 가장 바쁜 엔진 기준`,
    note: '프로세스마다 가장 바쁜 GPU 엔진의 사용률입니다.',
  },
  io: {
    value: (p) => p.r + p.w, text: (p) => rate(p.r + p.w),
    sub: (p) => `읽기 ${rate(p.r)} · 쓰기 ${rate(p.w)}`,
    summary: (m) => `디스크 <b>${rate(m.disk.read + m.disk.write)}</b> · 활성 ${Math.round(m.disk.active ?? 0)}%`,
    note: '프로세스 I/O에는 디스크뿐 아니라 네트워크·장치 입출력이 섞여 있습니다. 프로세스별 네트워크 사용량은 Windows 성능 카운터로 따로 구할 수 없습니다.',
  },
};

let currentTab = 'cpu';
let lastMetrics = null;
let lastMemTotal = 1;

function setTab(tab, persist = true) {
  if (!TABS[tab]) tab = 'cpu';
  currentTab = tab;
  $('#detail').dataset.tab = tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('#dnote').textContent = TABS[tab].note;
  if (persist) window.widget.setConfig({ detailTab: tab });
  if (lastMetrics) renderDetail(lastMetrics);
}

function uptimeText(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m}분` : `${m}분`;
}

function renderDetail(m) {
  lastMetrics = m;
  lastMemTotal = m.info.memTotal;
  if ($('#detail').hidden) return;
  if (m.sys) {
    $('#sysinfo').textContent = `프로세스 ${m.sys.procs.toLocaleString()} · 가동 ${uptimeText(m.sys.uptime)}`;
  }
  const tab = TABS[currentTab];
  $('#dsummary').innerHTML = tab.summary(m);
  if (!m.detail) return;

  const list = m.detail[currentTab] || [];
  const max = Math.max(...list.map(tab.value), currentTab === 'cpu' || currentTab === 'gpu' ? 1 : 1024);
  $('#plist').replaceChildren(...list.map((p) => {
    const li = el('li', 'proc');
    const name = friendly(p.n);
    li.title = `${p.n}${p.c > 1 ? ` (${p.c}개 프로세스 합산)` : ''}`;
    const av = el('span', 'av', name.replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?');
    av.style.setProperty('--h', String(hue(p.n.toLowerCase())));

    const body = el('div', 'pbody');
    const top = el('div', 'ptop');
    const pname = el('span', 'pname', name);
    if (p.c > 1) pname.append(el('small', null, `×${p.c}`));
    top.append(pname, el('span', 'pval', tab.text(p)));
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = `${Math.max(1, (tab.value(p) / max) * 100).toFixed(1)}%`;
    bar.append(fill);
    body.append(top, bar, el('div', 'psub', tab.sub(p)));
    li.append(av, body);
    return li;
  }));
}

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('#expand').addEventListener('click', () => window.widget.toggleExpand());

// ---------- wiring ----------
window.widget.onMetrics((m) => { render(m); renderDetail(m); });
window.widget.onConfig(applyConfig);
window.widget.getConfig().then(applyConfig);
window.widget.onCollectorError((msg) => {
  $('#error').hidden = false;
  $('#error').textContent = `수집기 오류: ${msg}`;
});

$('#settings').addEventListener('click', () => window.widget.openSettings());

function tick() {
  const now = new Date();
  $('#time').textContent = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  $('#date').textContent = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
}
tick();
setInterval(tick, 5_000);

// body.offsetHeight is in unzoomed CSS px; the window needs zoomed px.
const fitWindow = () => window.widget.resize(document.body.offsetHeight * scale);
const ro = new ResizeObserver(fitWindow);
ro.observe($('#card'));
ro.observe($('#detail'));
