// 키 화면 그리기 (196×196 PNG). 색은 whenpc가 보내는 테마(바탕·글자·강조), 글꼴은 스킨을 따른다
/* exported Draw */
const Draw = (() => {
  const SIZE = 196
  const PAD = 16
  const SANS = "'Segoe UI', 'Malgun Gothic', sans-serif"
  const MONO = "'Cascadia Mono', Consolas, 'Malgun Gothic', monospace"
  // 스킨별 글꼴 느낌. 덱 WebView에는 whenpc의 글꼴이 없어 Windows 기본 글꼴로 비슷하게 맞춘다
  //  heavy: 이름·큰 숫자, mid: 보조 글
  const SKIN = {
    poster: { font: SANS, mono: MONO, heavy: 900, mid: 700 },
    soft: { font: SANS, mono: SANS, heavy: 600, mid: 500 },
    tui: { font: MONO, mono: MONO, heavy: 700, mid: 400 },
    zen: { font: "Georgia, 'Batang', serif", mono: "Georgia, 'Batang', serif", heavy: 400, mid: 400 },
    glass: { font: "'Segoe UI Variable Display', " + SANS, mono: SANS, heavy: 300, mid: 400 },
    ide: { font: "'Cascadia Code', " + MONO, mono: "'Cascadia Code', " + MONO, heavy: 600, mid: 400 },
    sketch: { font: "'Segoe Print', 'Comic Sans MS', " + SANS, mono: "'Segoe Print', 'Comic Sans MS', " + SANS, heavy: 700, mid: 400 },
  }
  let style = SKIN.poster
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
    style = SKIN[t.skin] || SKIN.poster
    return { ...t, dim: mix(t.ink, t.bg, 0.55), faint: mix(t.ink, t.bg, 0.85) }
  }

  function clear(bg) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
  }

  /** weight 800 이상은 스킨의 heavy, 그 아래는 mid. mono: 숫자·속도 같은 고정폭 자리 */
  function font(weight, px, mono = false) {
    ctx.font = `${weight >= 800 ? style.heavy : style.mid} ${px}px ${mono ? style.mono : style.font}`
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
      font(600, 15, true)
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
        font(800, 30, true)
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

  /** 글자가 폭을 넘으면 끝을 …로 자른다 */
  function fit(text, width) {
    if (ctx.measureText(text).width <= width) return text
    let t = text
    while (t && ctx.measureText(t + '…').width > width) t = t.slice(0, -1)
    return t + '…'
  }

  /** 가로 막대 하나. p: 0~100, hot이면 강조색 */
  function hbar(c, x, y, w, h, p, hot) {
    ctx.fillStyle = c.faint
    ctx.fillRect(x, y, w, h)
    if (p == null) return
    ctx.fillStyle = hot ? c.sig : c.ink
    ctx.fillRect(x, y, Math.max(0, Math.min(1, p / 100)) * w, h)
  }

  /** 요약: CPU·MEM·GPU 세 줄 (이름 · 막대 · %) */
  function summary(m, theme) {
    const c = palette(theme)
    clear(c.bg)
    header(c, 'PC', '')
    const rows = [['CPU', m.cpu], ['MEM', m.mem], ['GPU', m.gpu]]
    rows.forEach(([name, v], i) => {
      const y = 70 + i * 44
      font(700, 17)
      ctx.fillStyle = c.dim
      ctx.fillText(name, PAD, y)
      font(800, 22, true)
      ctx.textAlign = 'right'
      ctx.fillStyle = v >= 90 ? c.sig : c.ink
      ctx.fillText(v == null ? '–' : `${Math.round(v)}%`, SIZE - PAD, y)
      ctx.textAlign = 'left'
      hbar(c, PAD, y + 9, SIZE - PAD * 2, 8, v, v >= 90)
    })
    return png()
  }

  /** 드라이브 용량. drive: 'C:' 같은 이름, 'all'이면 최대 3개를 줄로 */
  function drives(list, drive, theme) {
    const c = palette(theme)
    clear(c.bg)
    const GB = 1024 ** 3
    const free = (d) => {
      const g = d.free / GB
      return g >= 1000 ? `${(g / 1024).toFixed(1)}T` : `${Math.round(g)}G`
    }
    const used = (d) => (d.total ? ((d.total - d.free) / d.total) * 100 : null)
    if (!list || !list.length) {
      header(c, 'DISK', '')
      big(c, null)
      return png()
    }
    if (drive && drive !== 'all') {
      const d = list.find((x) => x.name.toUpperCase() === drive.toUpperCase())
      header(c, drive.toUpperCase(), d ? `${Math.round(used(d))}%` : '')
      if (!d) {
        font(600, 16)
        ctx.fillStyle = c.dim
        ctx.fillText('드라이브 없음', PAD, 100)
        return png()
      }
      big(c, free(d).slice(0, -1), free(d).slice(-1), false)
      font(600, 15)
      ctx.fillStyle = c.dim
      ctx.fillText('남음', PAD, 132)
      hbar(c, PAD, 154, SIZE - PAD * 2, 14, used(d), used(d) >= 90)
      return png()
    }
    header(c, 'DRIVES', '')
    list.slice(0, 3).forEach((d, i) => {
      const y = 70 + i * 44
      font(800, 18, true)
      ctx.fillStyle = c.ink
      ctx.fillText(d.name, PAD, y)
      font(700, 18, true)
      ctx.textAlign = 'right'
      ctx.fillStyle = used(d) >= 90 ? c.sig : c.dim
      ctx.fillText(free(d), SIZE - PAD, y)
      ctx.textAlign = 'left'
      hbar(c, PAD, y + 9, SIZE - PAD * 2, 8, used(d), used(d) >= 90)
    })
    return png()
  }

  /** 위치 고정(클릭 통과). locked면 닫힌 자물쇠 + 강조색 */
  function lock(locked, theme) {
    const c = palette(theme)
    clear(c.bg)
    font(800, 22)
    ctx.fillStyle = c.ink
    ctx.fillText('PC_', PAD, 36)
    const x = 66
    const y = 88
    const w = 64
    const h = 50
    // 고리: 잠기면 몸통에 꽂히고, 풀리면 오른쪽으로 들려 있다
    ctx.lineWidth = 9
    ctx.strokeStyle = locked ? c.ink : c.dim
    ctx.beginPath()
    if (locked) {
      ctx.moveTo(x + 14, y)
      ctx.lineTo(x + 14, y - 16)
      ctx.arc(x + w / 2, y - 16, w / 2 - 14, Math.PI, 0)
      ctx.lineTo(x + w - 14, y)
    } else {
      ctx.moveTo(x + 14, y)
      ctx.lineTo(x + 14, y - 26)
      ctx.arc(x + w / 2 + 2, y - 30, w / 2 - 14, Math.PI, 0)
      ctx.lineTo(x + w - 10, y - 18)
    }
    ctx.stroke()
    ctx.fillStyle = locked ? c.sig : c.dim
    ctx.fillRect(x, y, w, h)
    font(800, 20)
    ctx.textAlign = 'center'
    ctx.fillStyle = locked ? c.ink : c.dim
    ctx.fillText(locked ? 'LOCKED' : 'FREE', SIZE / 2, 172)
    return png()
  }

  /** 바이트 → '2.1G' · '812M' 같은 짧은 표기 */
  function size(b) {
    if (b == null || !Number.isFinite(b)) return '–'
    const G = 1024 ** 3
    const M = 1024 ** 2
    return b >= G ? `${(b / G).toFixed(b >= 10 * G ? 0 : 1)}G` : `${Math.round(b / M)}M`
  }

  /**
   * 상위 프로세스. topData: { cpu: [{ name, count, cpu }], mem: [{ name, count, mem }] } 또는 null(모으는 중),
   * basis: 'cpu' | 'mem', m: metrics (머리글의 전체 사용률, 메모리 총량)
   */
  function top(topData, basis, m, theme) {
    const c = palette(theme)
    clear(c.bg)
    const mem = basis === 'mem'
    const total = mem ? m.mem : m.cpu
    header(c, 'TOP', `${mem ? 'MEM' : 'CPU'}${total == null ? '' : ` ${Math.round(total)}%`}`)
    const list = topData && topData[mem ? 'mem' : 'cpu']
    if (!list) {
      font(600, 15)
      ctx.fillStyle = c.dim
      ctx.fillText('모으는 중…', PAD, 100)
      return png()
    }
    list.slice(0, 3).forEach((p, i) => {
      const y = 76 + i * 42
      // 막대·강조 기준: CPU는 사용률, 메모리는 전체 RAM 대비 비율
      const ratio = mem ? (m.memTotal ? (p.mem / m.memTotal) * 100 : 0) : p.cpu
      const value = mem ? size(p.mem) : `${p.cpu < 10 ? p.cpu.toFixed(1) : Math.round(p.cpu)}%`
      font(800, 18, true)
      ctx.textAlign = 'right'
      ctx.fillStyle = ratio >= (mem ? 25 : 50) ? c.sig : c.ink
      ctx.fillText(value, SIZE - PAD, y)
      const pw = ctx.measureText(value).width + 8
      ctx.textAlign = 'left'
      font(700, 18)
      ctx.fillStyle = c.ink
      ctx.fillText(fit(p.name, SIZE - PAD * 2 - pw), PAD, y)
      ctx.fillStyle = i === 0 ? c.sig : c.faint
      ctx.fillRect(PAD, y + 9, Math.max(4, Math.min(1, ratio / 100) * (SIZE - PAD * 2)), 4)
    })
    return png()
  }

  /**
   * 가동 시간: 가장 큰 단위를 크게(3일 · 4시간 · 12분), 그 아래 나머지와 부팅 시각.
   * sec: 가동 초, now: 지금 (부팅 시각 = now - sec)
   */
  function uptime(sec, now, theme) {
    const c = palette(theme)
    clear(c.bg)
    header(c, 'UPTIME', '')
    if (sec == null) {
      big(c, null)
      return png()
    }
    const d = Math.floor(sec / 86400)
    const h = Math.floor((sec % 86400) / 3600)
    const mi = Math.floor((sec % 3600) / 60)
    const [value, unit, rest] = d ? [d, '일', `${h}시간 ${mi}분`] : h ? [h, '시간', `${mi}분`] : [mi, '분', '']
    big(c, value, unit, false)
    if (rest) {
      font(700, 18)
      ctx.fillStyle = c.ink
      ctx.fillText(rest, PAD, 134)
    }
    // 오래 켜 둔 PC(7일 이상)는 구분선을 강조색으로
    ctx.fillStyle = d >= 7 ? c.sig : c.faint
    ctx.fillRect(PAD, 150, SIZE - PAD * 2, 2)
    const boot = new Date(now.getTime() - sec * 1000)
    const hh = String(boot.getHours()).padStart(2, '0')
    const mm = String(boot.getMinutes()).padStart(2, '0')
    font(600, 15)
    ctx.fillStyle = c.dim
    ctx.fillText('부팅', PAD, 178)
    font(700, 15, true)
    ctx.textAlign = 'right'
    ctx.fillText(`${boot.getMonth() + 1}/${boot.getDate()} ${hh}:${mm}`, SIZE - PAD, 178)
    ctx.textAlign = 'left'
    return png()
  }

  /** 테마 키: 그 테마의 색 그대로 미리보기. info: { name, bg, ink, sig, skin }, target: 'widget' | 'deck' */
  function themeKey(info, target, theme) {
    const c = palette(info || theme)
    clear(c.bg)
    font(800, 16)
    ctx.fillStyle = c.dim
    ctx.fillText(target === 'deck' ? 'DECK THEME' : 'THEME', PAD, 32)
    font(800, 64)
    ctx.fillStyle = c.ink
    ctx.fillText('Aa', PAD - 2, 112)
    ctx.fillStyle = c.sig
    ctx.fillRect(SIZE - PAD - 34, 86, 34, 26)
    font(800, 20)
    ctx.fillStyle = c.ink
    ctx.fillText(fit(info ? info.name : '–', SIZE - PAD * 2 - 22), PAD, 170)
    // 누르면 다음 테마로: 오른쪽 아래 화살표
    ctx.strokeStyle = c.dim
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(SIZE - PAD - 12, 158)
    ctx.lineTo(SIZE - PAD - 4, 164)
    ctx.lineTo(SIZE - PAD - 12, 170)
    ctx.stroke()
    return png()
  }

  return { metric, summary, drives, lock, top, uptime, themeKey, toggle, offline }
})()
