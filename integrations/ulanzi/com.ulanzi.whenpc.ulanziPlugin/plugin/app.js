/* global $UD, Draw */
// whenpc 덱 플러그인 주 서비스.
// 앱의 로컬 통로(127.0.0.1:37631, src/deck.js)에서 상태를 SSE로 받아 키마다 그린다.
//  - 위젯: 위젯이 떠 있는지 보여 준다. 누르면 위젯을 숨기거나 다시 띄운다
//  - 사용량: CPU·메모리·GPU·디스크·네트워크·온도 하나와 최근 60초 추이, 또는 요약(CPU·MEM·GPU)·드라이브 용량.
//    누르면 위젯을 숨기거나 다시 띄운다
//  - 위치 고정: 클릭 통과를 켜고 끈다
//  - 상위 프로세스: CPU(또는 메모리)를 가장 많이 쓰는 프로세스 3개. 누르면 위젯 상세 패널을 그 탭으로 연다.
//    프로세스별 수집은 CPU를 조금 더 쓰므로 이 키가 있을 때만 ?detail=1로 요청한다
//  - 테마: 지금 테마를 그 색 그대로 보여 준다. 누르면 같은 스킨의 다음 테마로 (대상: 위젯 또는 덱 키)
//  - 가동 시간: PC를 켠 뒤 지난 시간과 부팅 시각. 누르면 위젯을 숨기거나 다시 띄운다

const BASE = 'http://127.0.0.1:37631'
const PLUGIN = 'com.ulanzi.ulanzistudio.whenpc'
const KIND_BY_UUID = {
  [`${PLUGIN}.toggle`]: 'toggle',
  [`${PLUGIN}.metric`]: 'metric',
  [`${PLUGIN}.lock`]: 'lock',
  [`${PLUGIN}.top`]: 'top',
  [`${PLUGIN}.theme`]: 'theme',
  [`${PLUGIN}.uptime`]: 'uptime',
}
const TREND = ['cpu', 'mem', 'gpu', 'disk', 'net', 'temp']
const METRICS = [...TREND, 'summary', 'drives']
const HISTORY = 60

/** context → { kind: 'toggle' | 'metric' | 'lock' | 'top' | 'theme' | 'uptime', metric, drive, target, basis } */
const keys = new Map()
/** context → 마지막으로 보낸 그림 (같으면 다시 보내지 않는다) */
const sent = new Map()
/** 수치별 최근 60개. 키가 없어도 모아 둬 새로 놓은 키가 바로 추이를 그린다 */
const hist = Object.fromEntries(TREND.map((k) => [k, []]))
let state = null
let online = false
let offlineTimer = null
let es = null
let esDetail = null

$UD.connect(PLUGIN)

function record(m) {
  const v = { cpu: m.cpu, mem: m.mem, gpu: m.gpu, disk: (m.diskRead || 0) + (m.diskWrite || 0), net: (m.netRx || 0) + (m.netTx || 0), temp: m.temp }
  for (const k of TREND) {
    hist[k].push(v[k])
    if (hist[k].length > HISTORY) hist[k].shift()
  }
}

function register(jsn) {
  const ctx = jsn.context
  const { uuid } = $UD.decodeContext(ctx)
  const prev = keys.get(ctx)
  keys.set(ctx, { kind: KIND_BY_UUID[uuid] || 'metric', metric: prev ? prev.metric : 'cpu', drive: prev ? prev.drive : 'C:', target: prev ? prev.target : 'widget', basis: prev ? prev.basis : 'cpu' })
  applySettings(ctx, jsn.param)
}

function applySettings(ctx, param) {
  const k = keys.get(ctx)
  if (!k || !param) return
  if (METRICS.includes(param.metric)) k.metric = param.metric
  if (typeof param.drive === 'string' && param.drive) k.drive = param.drive
  if (param.target === 'widget' || param.target === 'deck') k.target = param.target
  if (param.basis === 'cpu' || param.basis === 'mem') k.basis = param.basis
}

function send(ctx, img) {
  if (sent.get(ctx) === img) return
  sent.set(ctx, img)
  $UD.setBaseDataIcon(ctx, img)
}

function draw(k) {
  const m = state.metrics
  if (k.kind === 'toggle') return Draw.toggle(state.visible, state.theme)
  if (k.kind === 'lock') return Draw.lock(!!state.locked, state.theme)
  if (k.kind === 'theme') return Draw.themeKey(state.themes && state.themes[k.target === 'deck' && !state.themes.deckFollow ? 'deck' : 'widget'], k.target, state.theme)
  if (!m) return Draw.offline(state.theme)
  if (k.kind === 'top') return Draw.top(m.top, k.basis, m, state.theme)
  if (k.kind === 'uptime') return Draw.uptime(m.uptime, new Date(), state.theme)
  if (k.metric === 'summary') return Draw.summary(m, state.theme)
  if (k.metric === 'drives') return Draw.drives(m.drives, k.drive, state.theme)
  return Draw.metric(k.metric, m, hist, state.theme)
}

function render() {
  for (const [ctx, k] of keys) send(ctx, !online || !state ? Draw.offline(state && state.theme) : draw(k))
}

/** 상위 프로세스 키가 있으면 ?detail=1로 다시 붙는다 (없어지면 다시 그냥). 바뀔 때만 */
function syncConnection() {
  const detail = [...keys.values()].some((k) => k.kind === 'top')
  if (es && esDetail === detail) return
  if (es) es.close()
  esDetail = detail
  es = new EventSource(`${BASE}/events${detail ? '?detail=1' : ''}`)
  es.onmessage = (e) => {
    let next
    try {
      next = JSON.parse(e.data)
    } catch {
      return
    }
    // 수치가 새로 왔을 때만 추이에 쌓는다 (위젯 보이기/숨기기만 바뀐 알림은 seq가 그대로다)
    if (next.metrics && (!state || next.seq !== state.seq)) record(next.metrics)
    state = next
    online = true
    if (offlineTimer) {
      clearTimeout(offlineTimer)
      offlineTimer = null
    }
    render()
  }
  // EventSource는 스스로 다시 붙는다. 잠깐 끊긴 것으로 키가 깜빡이지 않게 3초 기다린 뒤 OFFLINE
  es.onerror = () => {
    if (offlineTimer || !online) {
      if (!online) render()
      return
    }
    offlineTimer = setTimeout(() => {
      offlineTimer = null
      online = false
      render()
    }, 3000)
  }
}

function post(path) {
  return fetch(`${BASE}${path}`, { method: 'POST' }).catch(() => $UD.toast('whenpc가 꺼져 있어요'))
}

$UD.onConnected(() => syncConnection())

$UD.onAdd((jsn) => {
  register(jsn)
  sent.delete(jsn.context)
  syncConnection()
  render()
})

$UD.onSetActive((jsn) => {
  // 페이지를 넘겨 다시 보이면 그림을 새로 보낸다
  if (jsn.active) {
    sent.delete(jsn.context)
    render()
  }
})

$UD.onRun((jsn) => {
  const k = keys.get(jsn.context)
  if (!k) return
  if (k.kind === 'lock') post('/widget/lock')
  else if (k.kind === 'top') post(`/widget/detail?tab=${k.basis}`)
  else if (k.kind === 'theme') post(`/theme/next?target=${k.target}`)
  else post('/widget/toggle')
})

$UD.onClear((jsn) => {
  for (const item of jsn.param || []) {
    keys.delete(item.context)
    sent.delete(item.context)
  }
  syncConnection()
})

$UD.onParamFromApp((jsn) => {
  if (!keys.has(jsn.context)) register(jsn)
  else applySettings(jsn.context, jsn.param)
  sent.delete(jsn.context)
  syncConnection()
  render()
})

$UD.onParamFromPlugin((jsn) => {
  applySettings(jsn.context, jsn.param)
  sent.delete(jsn.context)
  render()
})
