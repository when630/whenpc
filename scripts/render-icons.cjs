// Renders build/icons/*.svg → build/icons/<name>.png (1024, transparent) and a preview sheet.
// Same approach as whenterminal's scripts/render-icons.cjs: the wordmark needs Archivo 900, so it is
// drawn by Chromium in an offscreen window.
//
//   npx electron scripts/render-icons.cjs
//
// Every icon is copied to src/assets/icons/<name>.png (selectable in settings: tray and window icons);
// the default (bars) also becomes build/icon.png (installer, shortcuts).
const { app, BrowserWindow } = require('electron');
const { readFileSync, readdirSync, writeFileSync, mkdirSync, copyFileSync } = require('node:fs');
const { join, basename } = require('node:path');
const { pathToFileURL } = require('node:url');

const DEFAULT_ICON = 'bars';
const root = join(__dirname, '..');
const dir = join(root, 'build/icons');
const font = pathToFileURL(join(root, 'node_modules/@fontsource/archivo/files/archivo-latin-900-normal.woff2')).href;
const fontFace = `@font-face { font-family: 'Archivo'; font-weight: 900; src: url('${font}') format('woff2'); }`;
const settle = 'document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode()))).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))';

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, backgroundColor: '#00000000', webPreferences: { offscreen: true } });
  const names = readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => basename(f, '.svg'));
  for (const name of names) {
    const svg = readFileSync(join(dir, `${name}.svg`), 'utf8');
    const tmp = join(app.getPath('temp'), `whenpc-icon-${name}.html`);
    writeFileSync(tmp, `<!doctype html><html><head><style>${fontFace}
      html, body { margin: 0; background: transparent; width: 1024px; height: 1024px; overflow: hidden; }
      svg { display: block; width: 1024px; height: 1024px; }</style></head><body>${svg}</body></html>`);
    await win.loadFile(tmp);
    await win.webContents.executeJavaScript(settle);
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
    writeFileSync(join(dir, `${name}.png`), img.resize({ width: 1024, height: 1024 }).toPNG());
    console.log('rendered', name);
  }

  mkdirSync(join(root, 'src/assets/icons'), { recursive: true });
  for (const name of names) copyFileSync(join(dir, `${name}.png`), join(root, 'src/assets/icons', `${name}.png`));
  copyFileSync(join(dir, `${DEFAULT_ICON}.png`), join(root, 'build/icon.png'));

  // Preview: large on white, small sizes, and a dark taskbar strip.
  const src = (n) => pathToFileURL(join(dir, `${n}.png`)).href;
  const sheet = new BrowserWindow({ width: 260 * names.length + 80, height: 560, show: false, webPreferences: { offscreen: true } });
  const tmp = join(app.getPath('temp'), 'whenpc-icon-sheet.html');
  writeFileSync(tmp, `<!doctype html><html><head><style>${fontFace}
    body { margin: 0; background: #fff; font: 700 18px/1.2 'Malgun Gothic', sans-serif; color: #0a0a0a; }
    h1 { margin: 0; padding: 22px 30px 14px; font: 900 30px/1 'Archivo', sans-serif; border-bottom: 6px solid #0a0a0a; }
    .row { display: flex; padding: 0 40px; } .cell { width: 260px; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 26px 0 18px; border-right: 2px solid #0a0a0a; }
    .cell:last-child { border-right: 0; } .big { width: 200px; height: 200px; filter: drop-shadow(0 8px 12px rgba(0,0,0,.2)); }
    .sizes { display: flex; align-items: flex-end; gap: 14px; height: 70px; }
    .bar { display: flex; justify-content: center; gap: 40px; padding: 26px 0; margin: 0 40px; background: #2a2a2c; border-radius: 28px; }
    .bar img { width: 48px; height: 48px; } .bar img.s { width: 24px; height: 24px; align-self: center; }
  </style></head><body><h1>WHENPC · APP ICONS</h1><div class="row">${names.map((n) => `<div class="cell"><img class="big" src="${src(n)}"><div class="sizes"><img src="${src(n)}" width="64"><img src="${src(n)}" width="32"><img src="${src(n)}" width="16"></div><div>${n}${n === DEFAULT_ICON ? ' (기본)' : ''}</div></div>`).join('')}</div>
    <div class="bar">${names.map((n) => `<img src="${src(n)}"><img class="s" src="${src(n)}">`).join('')}</div></body></html>`);
  await sheet.loadFile(tmp);
  await sheet.webContents.executeJavaScript(settle);
  writeFileSync(join(dir, 'preview.png'), (await sheet.webContents.capturePage()).toPNG());
  console.log('preview written');
  app.quit();
});
