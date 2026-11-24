// Renders the Ulanzi plugin's action icons with the plugin's own key drawing (plugin/draw.js) in FOG DARK,
// so the action list shows what a key will look like. plugin.png / category.png are the BARS app icon.
//
//   npx electron scripts/render-deck-icons.cjs
//
// Run scripts/render-icons.cjs first when the app icon changed.
const { app, BrowserWindow, nativeImage } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const plugin = join(root, 'integrations/ulanzi/com.ulanzi.whenpc.ulanziPlugin');
const out = (name) => join(plugin, 'assets', name);

const themes = require(join(root, 'src/themes.json')).themes;
const info = (id) => {
  const t = themes.find((x) => x.id === id);
  return { id: t.id, name: t.name, skin: 'fog', bg: t.colors[0], ink: t.colors[1], sig: t.colors[2], hot: t.hot, dark: !!t.dark };
};

// Sample values: a calm PC with one busy curve, nothing in the red.
const wave = (n, base, amp) => Array.from({ length: n }, (_, i) => base + amp * Math.sin(i / 5) + (amp / 2) * Math.sin(i / 2.3));
const GB = 1024 ** 3;
const sample = {
  theme: info('fog-dark'),
  themeLight: info('fog'),
  m: { cpu: 37, mem: 62, gpu: 18, memUsed: 19.8 * GB, memTotal: 32 * GB },
  hist: { cpu: wave(60, 34, 9) },
  top: { cpu: [{ name: 'chrome', count: 24, cpu: 12 }, { name: 'MsMpEng', count: 1, cpu: 6.2 }, { name: 'Code', count: 9, cpu: 0.8 }] },
};

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<!doctype html><meta charset="utf-8"><body></body>');
  await win.webContents.executeJavaScript(readFileSync(join(plugin, 'plugin/draw.js'), 'utf8') + '\n;window.Draw = Draw; 0');
  const s = JSON.stringify(sample);
  const keys = {
    'action-toggle.png': `Draw.toggle(true, S.theme)`,
    'action-metric.png': `Draw.metric('cpu', S.m, S.hist, S.theme)`,
    'action-lock.png': `Draw.lock(true, S.theme)`,
    'action-top.png': `Draw.top(S.top, 'cpu', S.m, S.theme)`,
    'action-theme.png': `Draw.themeKey(S.themeLight, 'widget', S.theme)`,
    'action-uptime.png': `Draw.uptime(2 * 86400 + 5 * 3600 + 12 * 60, new Date(2026, 10, 24, 14, 0), S.theme)`,
  };
  for (const [name, expr] of Object.entries(keys)) {
    const url = await win.webContents.executeJavaScript(`(() => { const S = ${s}; return ${expr} })()`);
    writeFileSync(out(name), nativeImage.createFromDataURL(url).toPNG());
    console.log('rendered', name);
  }
  const icon = nativeImage.createFromPath(join(root, 'build/icons/bars.png'));
  writeFileSync(out('plugin.png'), icon.resize({ width: 196, height: 196, quality: 'best' }).toPNG());
  writeFileSync(out('category.png'), icon.resize({ width: 56, height: 56, quality: 'best' }).toPNG());
  console.log('rendered plugin.png, category.png');
  app.quit();
});
