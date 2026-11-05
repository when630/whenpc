const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, ipcMain, screen } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
const { readLhmTemps } = require('./lhm');
const updater = require('./updater');

const BASE_WIDTH = 292;   // must match body width in renderer/style.css
const DETAIL_EXTRA = 308; // detail panel (300) + gap (8); body.expanded is 600px

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

nativeTheme.themeSource = 'dark';
// Must match build.appId so Windows notifications are attributed to the installed app.
app.setAppUserModelId('com.when630.whenpc');

// ---------- settings ----------
const configPath = () => path.join(app.getPath('userData'), 'config.json');
const DEFAULT_ITEMS = { clock: true, cpu: true, mem: true, gpu: true, gpuMem: true, disk: true, drives: true, net: true, temp: true };
const defaults = {
  x: null, y: null,
  alwaysOnTop: false,
  locked: false,
  transparency: 15, // 0 = opaque background, 100 = fully transparent background
  scale: 100,       // percent
  showGraphs: true,
  items: DEFAULT_ITEMS,
  expanded: false,      // detail (process) panel open
  detailSide: 'left',   // which side of the tiles the panel opens on
  detailTab: 'cpu',
};
let config = structuredClone(defaults);

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    config = { ...defaults, ...saved, items: { ...DEFAULT_ITEMS, ...(saved.items || {}) } };
  } catch {
    config = structuredClone(defaults);
  }
}

let saveTimer = null;
function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(configPath()), { recursive: true });
      fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
    } catch (e) {
      console.error('config save failed', e);
    }
  }, 300);
}

function publicConfig() {
  return { ...config, openAtLogin: app.getLoginItemSettings().openAtLogin };
}

function broadcastConfig() {
  const c = publicConfig();
  for (const w of [win, settingsWin]) if (w && !w.isDestroyed()) w.webContents.send('config', c);
  refreshMenu();
}

function applyConfig(patch) {
  const prev = config;
  config = { ...config, ...patch, items: { ...config.items, ...(patch.items || {}) } };
  delete config.openAtLogin;

  if ('openAtLogin' in patch) {
    app.setLoginItemSettings({
      openAtLogin: !!patch.openAtLogin,
      path: process.execPath,
      args: app.isPackaged ? [] : [path.resolve(__dirname, '..')],
    });
  }
  if (win) {
    if (prev.alwaysOnTop !== config.alwaysOnTop) win.setAlwaysOnTop(config.alwaysOnTop);
    if (prev.locked !== config.locked) win.setIgnoreMouseEvents(config.locked);
    if (prev.scale !== config.scale) {
      const [x, y] = win.getPosition();
      const [w, h] = win.getSize();
      // With the panel on the left, keep the tiles' right edge in place.
      const nx = config.expanded && config.detailSide === 'left' ? x + w - widgetWidth() : x;
      win.setBounds({ x: nx, y, width: widgetWidth(), height: h });
    }
  }
  saveConfig();
  broadcastConfig();
}

const widgetWidth = () => Math.round((BASE_WIDTH + (config.expanded ? DETAIL_EXTRA : 0)) * config.scale / 100);

function setExpanded(on) {
  if (!win || config.expanded === on) return;
  const [x, y] = win.getPosition();
  const [, h] = win.getSize();
  const delta = Math.round(DETAIL_EXTRA * config.scale / 100);
  if (on) {
    // Open toward the roomier side: widgets in the right half of their display expand to the left.
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    config.detailSide = x + win.getSize()[0] / 2 > area.x + area.width / 2 ? 'left' : 'right';
  }
  config.expanded = on;
  const nx = config.detailSide === 'left' ? (on ? x - delta : x + delta) : x;
  config.x = nx;
  config.y = y;
  broadcastConfig();
  win.setBounds({ x: nx, y, width: widgetWidth(), height: h });
  saveConfig();
  syncCollectorDetail();
}

// ---------- widget window ----------
let win = null;
let settingsWin = null;
let tray = null;

function initialPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  const w = widgetWidth();
  if (config.x != null && config.y != null) {
    // Keep the saved position only if it is still on some display.
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      config.x >= a.x - w + 40 && config.x <= a.x + a.width - 40 &&
      config.y >= a.y && config.y <= a.y + a.height - 40);
    if (visible) return { x: config.x, y: config.y };
  }
  return { x: area.x + area.width - w - 24, y: area.y + 24 };
}

const preload = path.join(__dirname, 'preload.js');
const webPreferences = { preload, contextIsolation: true, sandbox: true, nodeIntegration: false };

function createWindow() {
  const { x, y } = initialPosition();
  win = new BrowserWindow({
    x, y,
    width: widgetWidth(),
    height: 480,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: config.alwaysOnTop,
    webPreferences,
  });
  win.setIgnoreMouseEvents(config.locked);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());

  win.on('moved', () => {
    const [nx, ny] = win.getPosition();
    config.x = nx;
    config.y = ny;
    saveConfig();
  });
  win.on('show', () => { refreshMenu(); syncCollectorDetail(); });
  win.on('hide', () => { refreshMenu(); syncCollectorDetail(); });
  win.on('closed', () => { win = null; });
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 420,
    height: 720,
    minWidth: 380,
    minHeight: 480,
    title: 'whenpc 설정',
    icon: trayIcon(32),
    frame: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#101217',
    autoHideMenuBar: true,
    show: false,
    webPreferences,
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}

function resetPosition() {
  config.x = config.y = null;
  saveConfig();
  const { x, y } = initialPosition();
  win?.setPosition(x, y);
}

// ---------- IPC ----------
ipcMain.handle('config:get', () => publicConfig());
ipcMain.on('config:set', (_e, patch) => {
  if (patch && typeof patch === 'object') applyConfig(patch);
});
ipcMain.on('settings:open', openSettings);
ipcMain.on('widget:reset-position', resetPosition);
ipcMain.on('widget:toggle-expand', () => setExpanded(!config.expanded));
ipcMain.handle('update:get', () => updater.getState());
ipcMain.on('update:check', () => updater.check());
ipcMain.on('update:install', () => updater.install());

ipcMain.on('widget:resize', (e, height) => {
  if (!win || e.sender !== win.webContents || !Number.isFinite(height)) return;
  const h = Math.max(60, Math.min(1600, Math.ceil(height)));
  const [w, cur] = win.getSize();
  if (cur !== h || w !== widgetWidth()) win.setSize(widgetWidth(), h);
});

// ---------- tray ----------
function trayIcon(size = 16) {
  // BGRA bitmap: rounded teal square with three white bars, drawn on a 16-unit grid.
  const buf = Buffer.alloc(size * size * 4);
  const u = size / 16;
  const bars = [[4, 9], [7, 5], [10, 7]]; // [x, topY]
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px / u, y = py / u;
      const i = (py * size + px) * 4;
      if ((x < 2 || x >= 14) && (y < 2 || y >= 14)) continue;
      let [b, g, r] = [168, 160, 20];
      if (bars.some(([bx, top]) => x >= bx && x < bx + 2 && y >= top && y < 13)) [b, g, r] = [255, 255, 255];
      buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '위젯 보이기', type: 'checkbox', checked: !!win?.isVisible(), click: (i) => (i.checked ? win?.showInactive() : win?.hide()) },
    { label: '위치 고정 (클릭 통과)', type: 'checkbox', checked: config.locked, click: (i) => applyConfig({ locked: i.checked }) },
    { label: '설정…', click: openSettings },
    ...(updater.getState().status === 'downloaded'
      ? [{ label: `업데이트 설치 후 재시작 (v${updater.getState().version})`, click: updater.install }]
      : []),
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
}

function refreshMenu() {
  tray?.setContextMenu(buildMenu());
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('whenpc');
  refreshMenu();
  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible()) win.hide(); else win.showInactive();
  });
  tray.on('double-click', openSettings);
}

// ---------- collector ----------
let collector = null;
let restartDelay = 1000;
let collectorDetail = null;

// Per-process counters cost a little CPU, so collect them only while the panel is open and visible.
function syncCollectorDetail() {
  const on = !!(config.expanded && win?.isVisible());
  if (!collector || collectorDetail === on) return;
  collectorDetail = on;
  collector.stdin.write(`detail ${on ? 1 : 0}\n`);
}
let quitting = false;

function collectorScript() {
  // When packaged, the script must live outside app.asar (see asarUnpack) for powershell to read it.
  return path.join(__dirname, '..', 'collector', 'collector.ps1').replace('app.asar', 'app.asar.unpacked');
}

function startCollector() {
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  collector = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', collectorScript(), '-ParentPid', String(process.pid)], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  collector.stdin.on('error', () => {});
  collectorDetail = null;
  syncCollectorDetail();

  readline.createInterface({ input: collector.stdout }).on('line', (line) => {
    let data;
    try { data = JSON.parse(line); } catch { return; }
    restartDelay = 1000;
    data.temp.cpu = lhm.cpu;
    data.temp.gpu = lhm.gpu;
    data.temp.source = lhm.cpu != null || lhm.gpu != null ? 'lhm' : 'acpi';
    win?.webContents.send('metrics', data);
  });

  let stderr = '';
  collector.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });

  collector.on('exit', (code) => {
    collector = null;
    if (quitting) return;
    console.error(`collector exited (${code}); restarting in ${restartDelay}ms\n${stderr}`);
    win?.webContents.send('collector-error', stderr.trim() || `collector exited with code ${code}`);
    setTimeout(startCollector, restartDelay);
    restartDelay = Math.min(restartDelay * 2, 30000);
  });
}

// Optional: LibreHardwareMonitor's remote web server (Options > Remote Web Server, port 8085) for real CPU/GPU temps.
const lhm = { cpu: null, gpu: null };
async function pollLhm() {
  Object.assign(lhm, await readLhmTemps());
  setTimeout(pollLhm, 2000);
}

// ---------- lifecycle ----------
app.on('second-instance', () => { win?.showInactive(); openSettings(); });

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  createTray();
  startCollector();
  pollLhm();
  updater.init((state) => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('update', state);
    refreshMenu();
  });
  if (process.env.WHENPC_OPEN_SETTINGS) openSettings();

  // Dev aid: WHENPC_SNAPSHOT=out.png saves a capture of the widget (and settings, if open) after a delay, then quits.
  if (process.env.WHENPC_SNAPSHOT) {
    setTimeout(async () => {
      const out = process.env.WHENPC_SNAPSHOT;
      console.log('body class:', await win.webContents.executeJavaScript('document.body.className'), 'bounds:', JSON.stringify(win.getBounds()));
      fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
      if (settingsWin) await settingsWin.webContents.executeJavaScript(`document.querySelector('main').scrollTop = 1e6`);
      if (settingsWin) fs.writeFileSync(out.replace(/\.png$/i, '-settings.png'), (await settingsWin.webContents.capturePage()).toPNG());
      app.quit();
    }, Number(process.env.WHENPC_SNAPSHOT_DELAY || 8000));
  }
});

app.on('before-quit', () => {
  quitting = true;
  collector?.kill();
});

app.on('window-all-closed', () => app.quit());
