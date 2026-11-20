// โทนสีและค่าตั้งต้นของกราฟ — แก้ที่ไฟล์นี้ที่เดียวเมื่อต้องการเปลี่ยนสีทั้งระบบ
export const BRAND = {
  navy: '#0f3d5e',
  navyDark: '#0a2b43',
  accent: '#c9a227', // ทองหม่น (สื่อถึงหน่วยงานตรวจสอบภาครัฐ)
  surface: '#f5f7fa',
  card: '#ffffff',
  border: '#e4e8ee',
  text: '#1d2733',
  textSecondary: '#5b6878',
  muted: '#8a96a5',
}

// สีประจำ 4 ด้าน (categorical — ลำดับคงที่ ผ่านการตรวจความแตกต่างสำหรับผู้บกพร่องการเห็นสี)
export const PART_COLORS = { 1: '#2a78d6', 2: '#eb6834', 3: '#1baf7a', 4: '#eda100' }
export const PART_SHORT = { 1: 'รายได้', 2: 'รายจ่าย', 3: 'จัดซื้อจัดจ้าง/พัสดุ', 4: 'บัญชี/รายงาน/ตรวจสอบ' }

// สเกลสีต่อเนื่อง (sequential blue) สำหรับแผนที่
export const SEQ_BLUE = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b']
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']

export const antdTheme = {
  token: {
    colorPrimary: BRAND.navy,
    colorLink: '#1f6fb2',
    borderRadius: 8,
    fontFamily: "'IBM Plex Sans Thai', 'Sarabun', 'Tahoma', sans-serif",
    colorBgLayout: BRAND.surface,
    colorText: BRAND.text,
    colorTextSecondary: BRAND.textSecondary,
    colorBorderSecondary: BRAND.border,
  },
  components: {
    Layout: { headerBg: BRAND.navy, siderBg: '#ffffff', headerHeight: 60 },
    Menu: { itemSelectedBg: '#e8f0f7', itemSelectedColor: BRAND.navy },
    Card: { headerFontSize: 15 },
  },
}

// ค่าตั้งต้นกราฟ ECharts ให้ทุกกราฟหน้าตาเหมือนกัน
export const baseChart = {
  textStyle: { fontFamily: antdTheme.token.fontFamily, color: BRAND.textSecondary },
  grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
  tooltip: { confine: true, backgroundColor: '#fff', borderColor: BRAND.border, textStyle: { color: BRAND.text, fontSize: 13 } },
}
export const axisStyle = {
  axisLine: { lineStyle: { color: '#c9d1db' } },
  axisTick: { show: false },
  splitLine: { lineStyle: { color: '#eef1f5' } },
  axisLabel: { color: BRAND.textSecondary, fontSize: 12 },
}

// ---------- วัดความกว้างข้อความภาษาไทยเอง (ไม่พึ่ง overflow:'truncate' ของ ECharts ซึ่งตัดข้อความไทยผิด)
// วัดด้วย DOM (เอนจินเดียวกับที่เบราว์เซอร์ใช้วาดข้อความจริง) แทน canvas — Safari วัดอักษรไทยบน canvas ไม่ตรง
const _cache = new Map()
let _span = null
export function textWidth(text, fontSize = 12, weight = 400) {
  const s = String(text ?? '')
  if (typeof document === 'undefined' || !document.body) return s.length * fontSize * 0.62
  const key = `${fontSize}|${weight}|${s}`
  if (_cache.has(key)) return _cache.get(key)
  if (!_span) {
    _span = document.createElement('span')
    Object.assign(_span.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre', left: '-9999px', top: '0', fontFamily: antdTheme.token.fontFamily })
    document.body.appendChild(_span)
  }
  _span.style.fontSize = `${fontSize}px`
  _span.style.fontWeight = weight
  _span.textContent = s
  const w = _span.getBoundingClientRect().width || s.length * fontSize * 0.62
  _cache.set(key, w)
  return w
}
export const clearTextCache = () => _cache.clear()
// ตัดข้อความให้พอดีความกว้าง (px) ตัดตามกลุ่มตัวอักษร ไม่ให้สระ/วรรณยุกต์ไทยหลุดจากพยัญชนะ
const _seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null
export function fitText(text, maxPx, fontSize = 12) {
  const s = String(text ?? '')
  if (textWidth(s, fontSize) <= maxPx) return s
  const parts = _seg ? [..._seg.segment(s)].map((x) => x.segment) : [...s]
  let out = ''
  for (const ch of parts) {
    if (textWidth(out + ch + '…', fontSize) > maxPx) break
    out += ch
  }
  return out + '…'
}

export const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '–' : Number(v).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d }))
export const fmtInt = (v) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('th-TH'))
