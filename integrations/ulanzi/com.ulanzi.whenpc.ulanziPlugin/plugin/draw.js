// 키 화면 그리기 (196×196 PNG). 색은 whenpc 위젯의 현재 테마(바탕·글자·강조)를 따른다
/* exported Draw */
const Draw = (() => {
  const SIZE = 196
  const PAD = 16
  const FONT = "'Pretendard Variable', 'Segoe UI', 'Malgun Gothic', sans-serif"
  const MONO = "'Cascadia Mono', Consolas, monospace"
  const FALLBACK = { bg: '#0a0a0a', ink: '#ffffff', sig: '#ff2a12', dark: true }

  const LABEL = { cpu: 'CPU', mem: 'MEM', gpu: 'GPU', disk: 'DISK', net: 'NET', temp: 'TEMP' }

  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')

  /** '#rrggbb' 두 색을 t(0~1) 비율로 섞는다 */
  function mix(a, b, t) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    const [x, y] = [p(a), p(b)]
    if (x.some(Number.isNaN) || y.some(Number.isNaN)) return a
    return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`
  }

  function palette(theme) {
    const t = { ...FALLBACK, ...(theme || {}) }
    return { ...t, dim: mix(t.ink, t.bg, 0.55), faint: mix(t.ink, t.bg, 0.85) }
  }

  function clear(bg) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
  }

  function font(weight, px, family = FONT) {
    ctx.font = `${weight} ${px}px ${family}`
  }

  const png = () => canvas.toDataURL('image/png')

  /** 초당 바이트 → '12.3M' 같은 짧은 표기 */
  function rate(b) {
    if (b == null || !Number.isFinite(b)) return '–'
    const u = ['B', 'K', 'M', 'G']
    let i = 0
    while (b >= 1000 && i < u.length - 1) {
      b /= 1024
      i++
    }
    return `${b >= 100 || i === 0 ? Math.round(b) : b.toFixed(1)}${u[i]}`
  }

  /** 아래쪽 추이 그래프. values: 오래된 것부터, max: 세로 상한 */
  function spark(values, max, color, faint) {
    const top = 128
    const h = SIZE - top - 14
    const w = SIZE - PAD * 2
    ctx.fillStyle = faint
    ctx.fillRect(PAD, SIZE - 14, w, 2)
    const vs = values.filter((v) => v != null && Number.isFinite(v))
    if (vs.length < 2 || !(max > 0)) return
    const step = w / 59
    const start = PAD + w - step * (values.length - 1)
    ctx.beginPath()
    let first = true
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) return
      const x = start + i * step
      const y = top + h - Math.min(1, v / max) * h
      if (first) {
        ctx.moveTo(x, SIZE - 14)
        first = false
      }
      ctx.lineTo(x, y)
    })
    ctx.lineTo(PAD + w, SIZE - 14)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }

  /** 맨 위 줄: 이름(왼쪽) · 보조 글(오른쪽) */
  function header(c, name, side) {
    font(800, 22)
    ctx.fillStyle = c.ink
    ctx.fillText(name, PAD, 36)
    if (side) {
      font(600, 15, MONO)
      ctx.textAlign = 'right'
      ctx.fillStyle = c.dim
      ctx.fillText(side, SIZE - PAD, 34)
      ctx.textAlign = 'left'
    }
  }

  /** 가운데 큰 숫자 + 단위 */
  function big(c, value, unit, hot) {
    font(800, 64)
    ctx.fillStyle = hot ? c.sig : c.ink
    const text = value == null ? '–' : String(value)
    ctx.fillText(text, PAD - 2, 106)
    if (value != null && unit) {
      const w = ctx.measureText(text).width
      font(700, 26)
      ctx.fillStyle = c.dim
      ctx.fillText(unit, PAD + w + 2, 106)
    }
  }

  /**
   * 수치 하나. kind: cpu|mem|gpu|disk|net|temp, m: whenpc /events의 metrics, hist: kind별 최근 60개
   */
  function metric(kind, m, hist, theme) {
    const c = palette(theme)
    clear(c.bg)
    const GB = 1024 ** 3
    switch (kind) {
      case 'mem':
        header(c, 'MEM', m.memTotal ? `${(m.memUsed / GB).toFixed(1)}/${Math.round(m.memTotal / GB)}G` : '')
        big(c, m.mem == null ? null : Math.round(m.mem), '%', m.mem >= 90)
        spark(hist.mem, 100, c.sig, c.faint)
        break
      case 'temp':
        header(c, 'TEMP', m.tempLabel || '')
        big(c, m.temp == null ? null : Math.round(m.temp), '°', m.temp >= 85)
        spark(hist.temp, 100, c.sig, c.faint)
        break
      case 'net':
      case 'disk': {
        const [down, up] = kind === 'net' ? [m.netRx, m.netTx] : [m.diskRead, m.diskWrite]
        const [a, b] = kind === 'net' ? ['↓', '↑'] : ['R', 'W']
        header(c, LABEL[kind], kind === 'disk' && m.disk != null ? `${Math.round(m.disk)}%` : '')
        font(800, 30, MONO)
        ctx.fillStyle = c.ink
        ctx.fillText(`${a} ${rate(down)}`, PAD, 76)
        ctx.fillText(`${b} ${rate(up)}`, PAD, 112)
        const h = hist[kind]
        spark(h, Math.max(1, ...h.filter(Number.isFinite)), c.sig, c.faint)
        break
      }
      default: {
        const v = m[kind]
        header(c, LABEL[kind] || kind.toUpperCase(), '')
        big(c, v == null ? null : Math.round(v), '%', v >= 90)
        spark(hist[kind], 100, c.sig, c.faint)
      }
    }
    return png()
  }

  /** 위젯 보이기/숨기기 키. visible: 지금 화면에 떠 있는지 */
  function toggle(visible, theme) {
    const c = palette(theme)
    clear(c.bg)
    font(800, 22)
    ctx.fillStyle = c.ink
    ctx.fillText('PC_', PAD, 36)
    // 위젯 모양: 테두리 사각형 안에 막대 셋. 숨김이면 흐리게 + 사선
    const x = 52
    const y = 56
    const w = 92
    const h = 72
    ctx.lineWidth = 6
    ctx.strokeStyle = visible ? c.ink : c.dim
    ctx.strokeRect(x, y, w, h)
    ctx.fillStyle = visible ? c.sig : c.faint
    ;[0.45, 0.8, 0.6].forEach((p, i) => ctx.fillRect(x + 16 + i * 24, y + h - 12 - (h - 24) * p, 14, (h - 24) * p))
    if (!visible) {
      ctx.beginPath()
      ctx.moveTo(x - 10, y + h + 10)
      ctx.lineTo(x + w + 10, y - 10)
      ctx.stroke()
    }
    font(800, 20)
    ctx.textAlign = 'center'
    ctx.fillStyle = visible ? c.ink : c.dim
    ctx.fillText(visible ? 'SHOWN' : 'HIDDEN', SIZE / 2, 172)
    return png()
  }

  /** whenpc가 꺼져 있거나 통로가 없을 때 */
  function offline(theme) {
    const c = palette(theme)
    clear(c.bg)
    font(800, 22)
    ctx.fillStyle = c.dim
    ctx.fillText('PC_', PAD, 36)
    ctx.fillStyle = c.sig
    ctx.fillRect(PAD + 44, 22, 14, 14)
    font(800, 18)
    ctx.textAlign = 'center'
    ctx.fillText('OFFLINE', SIZE / 2, 104)
    font(600, 14)
    ctx.fillStyle = c.dim
    ctx.fillText('whenpc 실행 필요', SIZE / 2, 130)
    return png()
  }

  return { metric, toggle, offline }
})()
