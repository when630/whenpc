const $ = (id) => document.getElementById(id);

const ITEMS = [
  { k: 'clock', label: '시계', color: '--ink' },
  { k: 'cpu', label: 'CPU', color: '--cpu', desc: '사용률 · 클럭' },
  { k: 'mem', label: '메모리', color: '--mem', desc: '사용량 · 커밋' },
  { k: 'gpu', label: 'GPU', color: '--gpu', desc: '사용률 · 엔진별' },
  { k: 'gpuMem', label: 'GPU 메모리', parent: 'gpu' },
  { k: 'disk', label: '디스크', color: '--disk', desc: '활성 시간 · 읽기/쓰기' },
  { k: 'drives', label: '드라이브 용량', parent: 'disk' },
  { k: 'net', label: '네트워크', color: '--net', desc: '다운로드 · 업로드' },
  { k: 'temp', label: '온도', color: '--temp' },
];

let config = null;
const set = (patch) => window.widget.setConfig(patch);

// ---------- items ----------
const itemInputs = {};
for (const item of ITEMS) {
  const row = document.createElement('label');
  row.className = `row${item.parent ? ' child' : ''}`;

  const text = document.createElement('span');
  text.className = 'row-text';
  const name = document.createElement('span');
  name.className = 'item-name';
  if (item.color) {
    const sw = document.createElement('i');
    sw.className = 'swatch';
    sw.style.setProperty('--sw', `var(${item.color})`);
    name.append(sw);
  }
  name.append(item.label);
  text.append(name);
  if (item.desc) {
    const small = document.createElement('small');
    small.textContent = item.desc;
    text.append(small);
  }

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'switch';
  input.addEventListener('change', () => set({ items: { [item.k]: input.checked } }));

  row.append(text, input);
  $('items').append(row);
  itemInputs[item.k] = { input, row, parent: item.parent };
}

// ---------- sliders ----------
function bindRange(id, format) {
  const input = $(id);
  const out = $(`${id}-out`);
  const paint = () => {
    const p = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--p', `${p}%`);
    out.textContent = format(Number(input.value));
  };
  input.addEventListener('input', () => {
    paint();
    set({ [id]: Number(input.value) });
  });
  return paint;
}
const paintTransparency = bindRange('transparency', (v) => `${v}%`);
const paintScale = bindRange('scale', (v) => `${v}%`);

// ---------- switches ----------
$('deckFollow').addEventListener('change', (e) => set({ deckFollow: e.target.checked }));
for (const id of ['showGraphs', 'alwaysOnTop', 'locked', 'openAtLogin']) {
  $(id).addEventListener('change', (e) => set({ [id]: e.target.checked }));
}
$('close').addEventListener('click', () => window.close());
$('resetPosition').addEventListener('click', () => window.widget.resetPosition());

// ---------- hide/show shortcut ----------
// KeyboardEvent.code → Electron accelerator key. Uses physical keys so the Korean IME (e.key 'Process')
// and keyboard layout don't matter.
const CODE_KEYS = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
};
function acceleratorKey(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return `num${m[1]}`;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return CODE_KEYS[code] || null;
}
const prettyShortcut = (acc) => acc.replace(/^num/i, 'Num ').split('+').join(' + ');

let recording = false;
const shortcutBtn = $('shortcut');

function renderShortcut(c) {
  if (recording) return;
  shortcutBtn.classList.remove('recording');
  shortcutBtn.textContent = c.toggleShortcut ? prettyShortcut(c.toggleShortcut) : '없음';
  $('shortcutClear').hidden = !c.toggleShortcut;
  const hint = $('shortcutHint');
  const taken = c.toggleShortcut && !c.shortcutOk;
  hint.classList.toggle('warn', !!taken);
  hint.textContent = taken
    ? '다른 프로그램이 이미 쓰는 조합이라 등록하지 못했습니다. 다른 조합을 눌러 주세요'
    : '어디서든 눌러 위젯을 내리고 다시 띄웁니다';
}

function stopRecording() {
  if (!recording) return;
  recording = false;
  window.widget.pauseShortcut(false); // main re-registers and broadcasts the result
  if (config) renderShortcut(config);
}

shortcutBtn.addEventListener('click', () => {
  if (recording) return stopRecording();
  recording = true;
  window.widget.pauseShortcut(true);
  shortcutBtn.classList.add('recording');
  shortcutBtn.textContent = '키 입력…';
  $('shortcutHint').classList.remove('warn');
  $('shortcutHint').textContent = 'Ctrl · Alt · Shift와 함께 누르세요. Esc는 취소, Backspace는 끄기';
});
shortcutBtn.addEventListener('blur', stopRecording);
shortcutBtn.addEventListener('keydown', (e) => {
  if (!recording) return;
  e.preventDefault();
  e.stopPropagation();
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  if (e.code === 'Escape' && !mods.length) return stopRecording();
  if ((e.code === 'Backspace' || e.code === 'Delete') && !mods.length) {
    set({ toggleShortcut: '' });
    return stopRecording();
  }
  const key = acceleratorKey(e.code);
  const live = mods.length ? `${mods.join(' + ')} + ${key ? prettyShortcut(key) : '…'}` : '키 입력…';
  shortcutBtn.textContent = live;
  if (!key) return; // only modifiers so far
  // A bare key would fire while typing anywhere; F-keys are fine alone.
  if (!mods.length && !/^F\d+$/.test(key)) return;
  // Shift alone with a printable key is just typing a capital letter or symbol.
  if (mods.length === 1 && mods[0] === 'Shift' && !/^F\d+$/.test(key)) return;
  set({ toggleShortcut: [...mods, key].join('+') });
  stopRecording();
});
$('shortcutClear').addEventListener('click', () => set({ toggleShortcut: '' }));

// ---------- skin & theme ----------
let catalog = { skins: [], themes: [] };

function radio(el, checked) {
  el.setAttribute('role', 'radio');
  el.setAttribute('aria-checked', String(checked));
}

// el: container, skin: selected skin id, pick(id): called on click. Shared by the widget and deck pickers.
function renderSkins(el, skin, pick) {
  el.replaceChildren(...catalog.skins.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'skin-card';
    radio(b, s.id === skin);
    const name = document.createElement('b');
    name.textContent = s.name;
    const note = document.createElement('span');
    note.textContent = s.note;
    b.append(name, note);
    b.addEventListener('click', () => pick(s.id));
    return b;
  }));
}

function renderThemes(el, skin, theme, pick) {
  el.replaceChildren(...catalog.themes.filter((t) => t.skin === skin).map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-chip';
    b.title = t.note;
    radio(b, t.id === theme);
    const sample = document.createElement('span');
    sample.className = 'sample';
    sample.textContent = 'Aa';
    sample.style.setProperty('--s-bg', t.colors[0]);
    sample.style.setProperty('--s-ink', t.colors[1]);
    sample.style.setProperty('--s-sig', t.colors[2]);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = t.name;
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = t.note;
    b.append(sample, name, note);
    b.addEventListener('click', () => pick(t.id));
    return b;
  }));
}

function renderIcons(c) {
  $('icons').replaceChildren(...(catalog.icons || []).map((ic) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-card';
    b.title = ic.note;
    radio(b, ic.id === c.appIcon);
    const img = document.createElement('img');
    img.src = `../assets/icons/${ic.id}.png`;
    img.alt = '';
    const name = document.createElement('b');
    name.textContent = ic.name;
    const note = document.createElement('span');
    note.textContent = ic.note;
    b.append(img, name, note);
    b.addEventListener('click', () => set({ appIcon: ic.id }));
    return b;
  }));
}

// ---------- sync ----------
function render(c) {
  config = c;
  const html = document.documentElement;
  html.dataset.skin = c.skin;
  html.dataset.theme = c.theme;
  html.toggleAttribute('data-dark', !!c.themeDark);
  renderSkins($('skins'), c.skin, (id) => set({ skin: id }));
  renderThemes($('themes'), c.skin, c.theme, (id) => set({ theme: id }));
  $('deckFollow').checked = !!c.deckFollow;
  $('deckPick').hidden = !!c.deckFollow;
  if (!c.deckFollow) {
    renderSkins($('deckSkins'), c.deckSkin, (id) => set({ deckSkin: id }));
    renderThemes($('deckThemes'), c.deckSkin, c.deckTheme, (id) => set({ deckTheme: id }));
  }
  renderIcons(c);
  for (const [k, { input, row, parent }] of Object.entries(itemInputs)) {
    input.checked = !!c.items[k];
    row.classList.toggle('disabled', !!parent && !c.items[parent]);
  }
  // Don't fight the user's drag: only update sliders that aren't being dragged.
  if (document.activeElement !== $('transparency')) $('transparency').value = c.transparency;
  if (document.activeElement !== $('scale')) $('scale').value = c.scale;
  paintTransparency();
  paintScale();
  for (const id of ['showGraphs', 'alwaysOnTop', 'locked', 'openAtLogin']) $(id).checked = !!c[id];
  renderShortcut(c);
}

window.widget.onConfig(render);
window.widget.getThemes().then((t) => {
  catalog = t;
  return window.widget.getConfig();
}).then(render);

// ---------- update ----------
function renderUpdate(u) {
  $('appVersion').textContent = `v${u.current}`;
  const btn = $('updateBtn');
  const status = {
    dev: '개발 모드에서는 자동 업데이트가 꺼져 있습니다',
    idle: '시작 후 자동으로 확인하고, 4시간마다 다시 확인합니다',
    checking: '업데이트 확인 중…',
    latest: '최신 버전입니다',
    downloading: `v${u.version} 내려받는 중… ${u.percent}%`,
    downloaded: `v${u.version} 준비됨 · 재시작하면 설치됩니다`,
    error: `확인 실패: ${u.error || '알 수 없는 오류'}`,
  }[u.status];
  $('updateStatus').textContent = status || '';
  btn.hidden = ['dev', 'checking', 'downloading'].includes(u.status);
  btn.textContent = u.status === 'downloaded' ? '재시작해 설치' : '지금 확인';
  btn.classList.toggle('primary', u.status === 'downloaded');
  btn.onclick = () => (u.status === 'downloaded' ? window.widget.installUpdate() : window.widget.checkUpdate());
}
window.widget.onUpdate(renderUpdate);
window.widget.getUpdate().then(renderUpdate);
