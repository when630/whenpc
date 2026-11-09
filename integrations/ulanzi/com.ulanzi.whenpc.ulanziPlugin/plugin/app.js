/* global $UD, Draw */
// whenpc 덱 플러그인 주 서비스.
// 앱의 로컬 통로(127.0.0.1:37631, src/deck.js)에서 상태를 SSE로 받아 키마다 그린다.
//  - 위젯: 위젯이 떠 있는지 보여 준다. 누르면 위젯을 숨기거나 다시 띄운다
//  - 사용량: CPU·메모리·GPU·디스크·네트워크·온도 중 하나와 최근 60초 추이. 누르면 위젯을 숨기거나 다시 띄운다

const BASE = 'http://127.0.0.1:37631'
const PLUGIN = 'com.ulanzi.ulanzistudio.whenpc'
const TOGGLE = `${PLUGIN}.toggle`
const KINDS = ['cpu', 'mem', 'gpu', 'disk', 'net', 'temp']
const HISTORY = 60

/** context → { kind: 'toggle' | 'metric', metric } */
const keys = new Map()
/** context → 마지막으로 보낸 그림 (같으면 다시 보내지 않는다) */
const sent = new Map()
/** 수치별 최근 60개. 키가 없어도 모아 둬 새로 놓은 키가 바로 추이를 그린다 */
const hist = Object.fromEntries(KINDS.map((k) => [k, []]))
let state = null
let online = false
let offlineTimer = null

$UD.connect(PLUGIN)

function record(m) {
  const v = { cpu: m.cpu, mem: m.mem, gpu: m.gpu, disk: (m.diskRead || 0) + (m.diskWrite || 0), net: (m.netRx || 0) + (m.netTx || 0), temp: m.temp }
  for (const k of KINDS) {
    hist[k].push(v[k])
    if (hist[k].length > HISTORY) hist[k].shift()
  }
}

function register(jsn) {
  const ctx = jsn.context
  const { uuid } = $UD.decodeContext(ctx)
  const prev = keys.get(ctx)
  keys.set(ctx, { kind: uuid === TOGGLE ? 'toggle' : 'metric', metric: prev ? prev.metric : 'cpu' })
  applySettings(ctx, jsn.param)
}

function applySettings(ctx, param) {
  const k = keys.get(ctx)
  if (!k || !param) return
  if (KINDS.includes(param.metric)) k.metric = param.metric
}

function send(ctx, img) {
  if (sent.get(ctx) === img) return
  sent.set(ctx, img)
  $UD.setBaseDataIcon(ctx, img)
}

function render() {
  const theme = state && state.theme
  for (const [ctx, k] of keys) {
    if (!online || !state) send(ctx, Draw.offline(theme))
    else if (k.kind === 'toggle') send(ctx, Draw.toggle(state.visible, theme))
    else if (!state.metrics) send(ctx, Draw.offline(theme))
    else send(ctx, Draw.metric(k.metric, state.metrics, hist, theme))
  }
}

function connect() {
  const es = new EventSource(`${BASE}/events`)
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

$UD.onConnected(() => connect())

$UD.onAdd((jsn) => {
  register(jsn)
  sent.delete(jsn.context)
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
  if (keys.has(jsn.context)) post('/widget/toggle')
})

$UD.onClear((jsn) => {
  for (const item of jsn.param || []) {
    keys.delete(item.context)
    sent.delete(item.context)
  }
})

$UD.onParamFromApp((jsn) => {
  if (!keys.has(jsn.context)) register(jsn)
  else applySettings(jsn.context, jsn.param)
  sent.delete(jsn.context)
  render()
})

$UD.onParamFromPlugin((jsn) => {
  applySettings(jsn.context, jsn.param)
  sent.delete(jsn.context)
  render()
})
