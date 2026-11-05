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
