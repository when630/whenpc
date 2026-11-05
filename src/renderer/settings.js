const $ = (id) => document.getElementById(id);

const ITEMS = [
  { k: 'clock', label: '시계', color: '--clock' },
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
for (const id of ['showGraphs', 'alwaysOnTop', 'locked', 'openAtLogin']) {
  $(id).addEventListener('change', (e) => set({ [id]: e.target.checked }));
}
$('close').addEventListener('click', () => window.close());
$('resetPosition').addEventListener('click', () => window.widget.resetPosition());

// ---------- sync ----------
function render(c) {
  config = c;
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
}

window.widget.onConfig(render);
window.widget.getConfig().then(render);

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
