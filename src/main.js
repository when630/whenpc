const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, ipcMain, screen, powerMonitor, globalShortcut } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
const { readLhmTemps } = require('./lhm');
const updater = require('./updater');
const { skins: SKINS, themes: THEMES } = require('./themes.json');
// App icons (build/icons/*.svg → scripts/render-icons.cjs → src/assets/icons/<id>.png).
// The installer/shortcut icon is fixed at build time (build/icon.png); this choice changes tray and window icons.
const APP_ICONS = [
  { id: 'bars', name: 'BARS', note: '사용량 막대, 작은 크기에서 가장 또렷함' },
  { id: 'gauge', name: 'GAUGE', note: '원형 게이지' },
  { id: 'wordmark', name: 'PC_', note: 'whenterminal의 WT_와 짝' },
];
const iconPath = () => path.join(__dirname, 'assets', 'icons', `${config.appIcon}.png`);

const BASE_WIDTH = 292;   // must match body width in renderer/style.css
const DETAIL_EXTRA = 308; // detail panel (300) + gap (8); body.expanded is 600px

// Dev runs (npm start) get their own settings folder and app id. Sharing them with the installed app
// made the two fight over the single-instance lock (launching the installed app just focused the dev
// one) and over the same "run at login" registry value.
if (!app.isPackaged) app.setPath('userData', `${app.getPath('userData')}-dev`);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Must match build.appId so Windows notifications are attributed to the installed app.
// It is also the registry value name used for "run at login".
app.setAppUserModelId(app.isPackaged ? 'com.when630.whenpc' : 'com.when630.whenpc.dev');

// setLoginItemSettings and getLoginItemSettings must get the same path/args on Windows, or
// getLoginItemSettings reports openAtLogin: false even though the entry exists.
const loginItemOptions = () => ({
  path: process.execPath,
  args: app.isPackaged ? [] : [path.resolve(__dirname, '..')],
});

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
  skin: 'poster',     // whenterminal skins/themes (src/themes.json)
  theme: 'poster',
  skinThemes: {},     // last theme picked per skin
  appIcon: 'bars',
  toggleShortcut: 'Ctrl+Alt+W', // global hide/show hotkey (Electron accelerator); '' = off
};
let config = structuredClone(defaults);

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    config = { ...defaults, ...saved, items: { ...DEFAULT_ITEMS, ...(saved.items || {}) } };
  } catch {
    config = structuredClone(defaults);
  }
  normalizeTheme();
  if (!APP_ICONS.some((i) => i.id === config.appIcon)) config.appIcon = defaults.appIcon;
  if (typeof config.toggleShortcut !== 'string') config.toggleShortcut = defaults.toggleShortcut;
}

const themeMeta = (id) => THEMES.find((t) => t.id === id);

// Keep skin/theme valid and consistent: the theme always belongs to the chosen skin.
function normalizeTheme() {
  if (!SKINS.some((s) => s.id === config.skin)) config.skin = defaults.skin;
  if (themeMeta(config.theme)?.skin !== config.skin) {
    const remembered = config.skinThemes?.[config.skin];
    config.theme = themeMeta(remembered)?.skin === config.skin ? remembered : THEMES.find((t) => t.skin === config.skin).id;
  }
  config.skinThemes = { ...config.skinThemes, [config.skin]: config.theme };
  const t = themeMeta(config.theme);
  nativeTheme.themeSource = t.dark ? 'dark' : 'light';
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.setBackgroundColor(t.colors[0]);
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
  return { ...config, themeDark: !!themeMeta(config.theme)?.dark, openAtLogin: app.getLoginItemSettings(loginItemOptions()).openAtLogin, shortcutOk };
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
  delete config.themeDark;
  delete config.shortcutOk;
  if (typeof config.toggleShortcut !== 'string') config.toggleShortcut = prev.toggleShortcut;
  // Switching skin restores that skin's last theme (normalizeTheme picks it when the theme no longer fits).
  if ('skin' in patch && !('theme' in patch)) config.theme = null;
  normalizeTheme();
  if ('appIcon' in patch) {
    if (!APP_ICONS.some((i) => i.id === config.appIcon)) config.appIcon = defaults.appIcon;
    applyAppIcon();
  }

  if (prev.toggleShortcut !== config.toggleShortcut) registerShortcut();
  if ('openAtLogin' in patch) {
    app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: !!patch.openAtLogin });
  }
  if (win) {
    if (prev.alwaysOnTop !== config.alwaysOnTop) applyTopmost();
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
    icon: iconPath(),
    webPreferences,
  });
  applyTopmost();
  win.setIgnoreMouseEvents(config.locked);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => showWidget());

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

// ---------- keeping the widget up ----------
// 'floating' (the default level) sits below the taskbar on Windows, so clicking the taskbar or Start
// buried the widget. 'screen-saver' is above it.
const TOP_LEVEL = 'screen-saver';
let userHidden = false; // hidden on purpose from the tray; otherwise the widget should always be showing

function applyTopmost() {
  if (!win || win.isDestroyed()) return;
  if (config.alwaysOnTop) {
    win.setAlwaysOnTop(true, TOP_LEVEL);
    win.moveTop();
  } else {
    win.setAlwaysOnTop(false);
  }
}

function showWidget() {
  userHidden = false;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.showInactive();
  applyTopmost();
}

function hideWidget() {
  userHidden = true;
  win?.hide();
}

function toggleWidget() {
  if (!win) return;
  if (win.isVisible()) hideWidget(); else showWidget();
}

// ---------- global hide/show shortcut ----------
// register() returns false when another app already owns the combo (Windows doesn't let apps fight
// over hotkeys); shortcutOk tells the settings page so it can say so.
let shortcutOk = true;
let shortcutPaused = false; // settings is recording a new combo; let the keys reach the page

function registerShortcut() {
  globalShortcut.unregisterAll();
  shortcutOk = true;
  if (!config.toggleShortcut || shortcutPaused) return;
  try {
    shortcutOk = globalShortcut.register(config.toggleShortcut, toggleWidget);
  } catch {
    shortcutOk = false; // malformed accelerator
  }
}

// Show desktop (Win+D), sleep/lock, other topmost apps and display changes can minimize or hide the
// widget or drop its topmost state. Check periodically and put it back.
function guardWidget() {
  if (!win || win.isDestroyed() || userHidden) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.showInactive();
  if (config.alwaysOnTop && !win.isAlwaysOnTop()) applyTopmost();
}

// Bring the widget back if a display change left it off every screen.
function keepOnScreen() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y < a.y + a.height - 40 && b.y + 20 > a.y);
  if (!visible) resetPosition();
  applyTopmost();
}

function watchWidget() {
  setInterval(guardWidget, 2000);
  win.on('minimize', () => { if (!userHidden) setImmediate(() => win?.restore()); });
  win.on('always-on-top-changed', (_e, on) => { if (config.alwaysOnTop && !on) setImmediate(applyTopmost); });
  for (const ev of ['resume', 'unlock-screen']) powerMonitor.on(ev, () => setTimeout(() => { guardWidget(); applyTopmost(); }, 1000));
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => setTimeout(keepOnScreen, 500));
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
    icon: iconPath(),
    frame: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: themeMeta(config.theme).colors[0],
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
ipcMain.handle('themes:get', () => ({ skins: SKINS, themes: THEMES, icons: APP_ICONS }));
ipcMain.on('config:set', (_e, patch) => {
  if (patch && typeof patch === 'object') applyConfig(patch);
});
ipcMain.on('settings:open', openSettings);
ipcMain.on('widget:reset-position', resetPosition);
ipcMain.on('widget:toggle-expand', () => setExpanded(!config.expanded));
ipcMain.on('shortcut:pause', (_e, on) => {
  shortcutPaused = !!on;
  registerShortcut();
  if (!on) broadcastConfig();
});
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
// Swap tray and window icons in place.
function applyAppIcon() {
  const img = nativeImage.createFromPath(iconPath());
  if (img.isEmpty()) return;
  for (const w of [win, settingsWin]) if (w && !w.isDestroyed()) w.setIcon(img);
  tray?.setImage(trayIcon());
}

function trayIcon() {
  // Same artwork as the app icon (build/icons/bars.svg → src/assets/icon.png), with sharp sizes for each DPI.
  const src = nativeImage.createFromPath(iconPath());
  const img = nativeImage.createEmpty();
  for (const scaleFactor of [1, 1.25, 1.5, 2]) {
    const px = Math.round(16 * scaleFactor);
    img.addRepresentation({ scaleFactor, width: px, height: px, buffer: src.resize({ width: px, height: px, quality: 'best' }).toPNG() });
  }
  return img;
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: '위젯 보이기', type: 'checkbox', checked: !!win?.isVisible(), click: (i) => (i.checked ? showWidget() : hideWidget()),
      ...(config.toggleShortcut && shortcutOk ? { accelerator: config.toggleShortcut, registerAccelerator: false } : {}),
    },
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
  tray.on('click', toggleWidget);
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
app.on('second-instance', () => { showWidget(); openSettings(); });

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  watchWidget();
  registerShortcut();
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
      if (settingsWin && process.env.WHENPC_SNAPSHOT_SCROLL) {
        // '1' scrolls to the bottom; anything else is a CSS selector to scroll into view.
        const target = process.env.WHENPC_SNAPSHOT_SCROLL;
        await settingsWin.webContents.executeJavaScript(target === '1'
          ? `document.querySelector('main').scrollTop = 1e6`
          : `(() => { const m = document.querySelector('main'), el = document.querySelector(${JSON.stringify(target)}); if (el) m.scrollTop = el.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - 120; })()`);
        await new Promise((r) => setTimeout(r, 300));
      }
      if (settingsWin) fs.writeFileSync(out.replace(/\.png$/i, '-settings.png'), (await settingsWin.webContents.capturePage()).toPNG());
      app.quit();
    }, Number(process.env.WHENPC_SNAPSHOT_DELAY || 8000));
  }
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('before-quit', () => {
  quitting = true;
  collector?.kill();
});

app.on('window-all-closed', () => app.quit());
