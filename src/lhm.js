// Reads CPU/GPU temperatures from LibreHardwareMonitor's remote web server (http://localhost:8085/data.json).
// Windows exposes no reliable CPU core temperature without a kernel driver, so this is opt-in:
// run LibreHardwareMonitor (as admin) and enable Options > Remote Web Server > Run.

const URL = 'http://127.0.0.1:8085/data.json';

function parseTemp(value) {
  if (typeof value !== 'string' || !value.includes('°C')) return null;
  const n = parseFloat(value.replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 150 ? n : null;
}

function kindOf(node, parentKind) {
  const id = `${node.SensorId || node.HardwareId || ''} ${node.ImageURL || ''}`.toLowerCase();
  if (/cpu/.test(id)) return 'cpu';
  if (/gpu|nvidia|ati\.png|radeon/.test(id)) return 'gpu';
  return parentKind;
}

function collect(node, parentKind, out) {
  const kind = kindOf(node, parentKind);
  const t = parseTemp(node.Value);
  if (t != null && (!node.Children || node.Children.length === 0) && kind) {
    out[kind].push({ name: String(node.Text || ''), value: t });
  }
  for (const child of node.Children || []) collect(child, kind, out);
}

function pick(list, preferred) {
  for (const re of preferred) {
    const hit = list.find((s) => re.test(s.name));
    if (hit) return hit.value;
  }
  return list.length ? Math.max(...list.map((s) => s.value)) : null;
}

async function readLhmTemps() {
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return { cpu: null, gpu: null };
    const out = { cpu: [], gpu: [] };
    collect(await res.json(), null, out);
    return {
      cpu: pick(out.cpu, [/package/i, /core max/i, /tctl|tdie/i]),
      gpu: pick(out.gpu, [/gpu core/i, /hot ?spot/i]),
    };
  } catch {
    return { cpu: null, gpu: null };
  }
}

module.exports = { readLhmTemps };
