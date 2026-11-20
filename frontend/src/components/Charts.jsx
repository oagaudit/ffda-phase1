// คอมโพเนนต์กราฟที่ใช้ซ้ำทั้งระบบ (ECharts)
import ReactECharts from 'echarts-for-react'
import * as echarts from 'echarts'
import { useEffect, useState } from 'react'
import { Empty, Spin } from 'antd'
import { BRAND, PART_COLORS, PART_SHORT, SEQ_BLUE, SERIES, axisStyle, baseChart, clearTextCache, fitText, fmt, textWidth } from '../theme'

// รอฟอนต์ไทยโหลดเสร็จก่อนวัดความกว้างป้ายชื่อ (ถ้าวัดก่อน ป้ายจะถูกตัดผิด)
let fontsDone = typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded'
function useFontsReady() {
  const [ok, setOk] = useState(fontsDone)
  useEffect(() => {
    if (ok || !document.fonts) return
    let alive = true
    document.fonts.ready.then(() => { fontsDone = true; clearTextCache(); if (alive) setOk(true) })
    return () => { alive = false }
  }, [ok])
  return ok
}

// แกนหมวดหมู่ที่ตั้ง fitLabels: { max } → ระบบวัดชื่อที่ยาวที่สุดเอง กันพื้นที่ซ้ายให้พอดี และตัดเฉพาะชื่อที่ยาวเกิน max (ดูชื่อเต็มใน tooltip)
function fitCategoryLabels(option) {
  const ax = option.yAxis
  if (!ax || Array.isArray(ax) || ax.type !== 'category' || !ax.fitLabels) return option
  const fs = ax.axisLabel?.fontSize || 12
  const longest = Math.max(0, ...(ax.data || []).map((l) => textWidth(l, fs)))
  const w = Math.ceil(Math.min(ax.fitLabels.max || 220, longest)) + 4
  const { fitLabels, ...yAxis } = ax
  const grid = option.grid || baseChart.grid
  return {
    ...option,
    grid: { ...grid, containLabel: false, left: (grid.left || 8) + w + 10, bottom: Math.max(grid.bottom ?? 8, 28) },
    yAxis: { ...yAxis, axisLabel: { ...yAxis.axisLabel, width: undefined, overflow: 'none', formatter: (v) => fitText(v, w, fs) } },
  }
}

export function Chart({ option, height = 320, onClick, loading }) {
  const fontsReady = useFontsReady()
  const events = onClick ? { click: onClick } : undefined
  const opt = fitCategoryLabels({ ...baseChart, ...option })
  return (
    <Spin spinning={!!loading}>
      {/* renderer svg: ให้เบราว์เซอร์วาดตัวอักษรเอง (อักษรไทยคมชัดและครบทุกเบราว์เซอร์ รวมถึง Safari) */}
      <ReactECharts key={fontsReady ? 'f1' : 'f0'} option={opt} opts={{ renderer: 'svg' }} style={{ height, width: '100%' }} notMerge onEvents={events} />
    </Spin>
  )
}

// ป้ายชื่อบนแผนที่: กล่องพื้นขาว อ่านชัดแม้อยู่บนพื้นที่สีเข้ม
export const MAP_TAG = { show: true, fontSize: 13, fontWeight: 600, color: BRAND.text, backgroundColor: 'rgba(255,255,255,0.94)',
  borderColor: '#c9d1db', borderWidth: 1, borderRadius: 4, padding: [3, 7] }

// ---------- แผนที่ประเทศไทยรายจังหวัด (คลิกเพื่อเจาะลึก)
let mapReady = null
function useThaiMap() {
  const [ok, setOk] = useState(!!echarts.getMap('thailand'))
  useEffect(() => {
    if (ok) return
    // ใช้ชื่อจังหวัดภาษาไทยเป็นชื่อพื้นที่ (ตรงกับข้อมูลจาก API)
    mapReady = mapReady || fetch('/geo/provinces.json').then((r) => r.json()).then((g) => echarts.registerMap('thailand', {
      type: 'FeatureCollection', features: g.features.map((f) => ({ ...f, properties: { ...f.properties, name: f.properties.pro_th } })) }))
    mapReady.then(() => setOk(true))
  }, [ok])
  return ok
}

export function ThailandMap({ rows = [], provinces = [], metric = 'avg_total', metricLabel = 'คะแนนรวมเฉลี่ย',
  selected, onSelect, height = 520, range }) {
  const ready = useThaiMap()
  if (!ready) return <Spin><div style={{ height }} /></Spin>
  const enByTh = Object.fromEntries(provinces.map((p) => [p.name, p.name]))
  const thByEn = enByTh
  const data = rows.filter((r) => enByTh[r.key]).map((r) => ({ name: enByTh[r.key], value: r[metric], raw: r }))
  const vals = data.map((d) => d.value).filter((v) => v != null)
  const [min, max] = range || [Math.floor(Math.min(...vals, 100)), Math.ceil(Math.max(...vals, 0))]
  const option = {
    tooltip: {
      ...baseChart.tooltip, trigger: 'item',
      formatter: (p) => {
        const r = p.data?.raw
        const th = thByEn[p.name] || p.name
        if (!r) return `<b>${th}</b><br/>ไม่มีข้อมูล`
        return `<b>${th}</b><br/>${metricLabel}: <b>${fmt(p.value)}</b><br/>ส่งแบบประเมิน: ${r.n} แห่ง${r.submission_rate != null ? ` (${fmt(r.submission_rate, 1)}%)` : ''}`
      },
    },
    visualMap: {
      min, max, left: 8, bottom: 16, calculable: true, itemHeight: 120, inRange: { color: SEQ_BLUE },
      text: ['สูง', 'ต่ำ'], textStyle: { color: BRAND.textSecondary },
    },
    series: [{
      type: 'map', map: 'thailand', roam: true, zoom: 1.1, data,
      selectedMode: 'single',
      itemStyle: { borderColor: '#fff', borderWidth: 0.8, areaColor: '#e9edf2' },
      emphasis: { label: { ...MAP_TAG, formatter: (p) => thByEn[p.name] || p.name }, itemStyle: { areaColor: BRAND.accent } },
      select: { label: { ...MAP_TAG, formatter: (p) => thByEn[p.name] || p.name }, itemStyle: { areaColor: BRAND.accent, borderColor: BRAND.navy, borderWidth: 1.5 } },
      label: { show: false },
    }],
  }
  if (selected && enByTh[selected]) option.series[0].data = data.map((d) => ({ ...d, selected: d.name === enByTh[selected] }))
  return <Chart option={option} height={height} onClick={(p) => onSelect && thByEn[p.name] && onSelect(thByEn[p.name])} />
}

// ---------- แท่งแนวนอนเรียงลำดับ (ใช้กับ drill-down)
export function RankBar({ rows = [], metric = 'avg_total', label = 'คะแนนรวมเฉลี่ย', onSelect, height, highlight, digits = 2, max }) {
  const data = [...rows].filter((r) => r[metric] != null).sort((a, b) => a[metric] - b[metric])
  if (!data.length) return <Empty description="ไม่มีข้อมูล (หรือถูกปกปิดเนื่องจากกลุ่มเล็ก)" />
  const vals = data.map((r) => r[metric])
  const lo = Math.max(0, Math.floor(Math.min(...vals) - 2))
  const h = height || Math.max(220, data.length * 26 + 48)
  const option = {
    grid: { ...baseChart.grid, right: 48 },
    tooltip: { ...baseChart.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps) => { const r = data[ps[0].dataIndex]; return `<b>${r.label}</b><br/>${label}: <b>${fmt(r[metric], digits)}</b><br/>จำนวน ${r.n} แห่ง` } },
    xAxis: { type: 'value', min: lo, max, ...axisStyle },
    yAxis: { type: 'category', data: data.map((r) => r.label), ...axisStyle, fitLabels: { max: 200 }, axisLabel: { ...axisStyle.axisLabel, fontSize: 13, color: BRAND.text } },
    series: [{
      type: 'bar', barMaxWidth: 16,
      data: data.map((r) => ({ value: r[metric], itemStyle: { color: highlight && r.key === highlight ? BRAND.accent : '#2a78d6', borderRadius: [0, 4, 4, 0] } })),
      label: { show: data.length <= 25, position: 'right', formatter: (p) => fmt(p.value, digits), color: BRAND.textSecondary, fontSize: 11 },
    }],
  }
  return <Chart option={option} height={h} onClick={(p) => onSelect && onSelect(data[p.dataIndex])} />
}

// ---------- 4 ด้าน: แท่งเทียบกับค่าอ้างอิง
export function PartsBars({ parts = {}, compare, compareLabel = 'ค่าเฉลี่ยประเทศ', height = 260, mainLabel = 'คะแนน' }) {
  const keys = [1, 2, 3, 4]
  const series = [{
    name: mainLabel, type: 'bar', barMaxWidth: 26,
    data: keys.map((k) => ({ value: parts[k], itemStyle: { color: PART_COLORS[k], borderRadius: [4, 4, 0, 0] } })),
    label: { show: true, position: 'top', formatter: (p) => fmt(p.value, 1), color: BRAND.text, fontSize: 12 },
  }]
  if (compare) series.push({
    name: compareLabel, type: 'scatter', symbol: 'rect', symbolSize: [34, 3], z: 5,
    data: keys.map((k) => compare[k]), itemStyle: { color: BRAND.text },
  })
  const option = {
    legend: compare ? { top: 0, right: 0, data: [{ name: compareLabel, icon: 'rect' }], textStyle: { color: BRAND.textSecondary } } : undefined,
    grid: { ...baseChart.grid, top: 36 },
    tooltip: { ...baseChart.tooltip, trigger: 'axis', valueFormatter: (v) => `${fmt(v, 1)}%` },
    xAxis: { type: 'category', data: keys.map((k) => PART_SHORT[k]), ...axisStyle, axisLabel: { ...axisStyle.axisLabel, interval: 0 } },
    yAxis: { type: 'value', min: 0, max: 100, ...axisStyle, axisLabel: { ...axisStyle.axisLabel, formatter: '{value}%' } },
    series,
  }
  return <Chart option={option} height={height} />
}

// ---------- สัดส่วนระดับผลการประเมิน
export function GradeDonut({ grades = {}, bands = [], height = 260 }) {
  const data = bands.map((b) => ({ name: b.label, value: grades[b.label] || 0, itemStyle: { color: b.color } }))
  const total = data.reduce((s, d) => s + d.value, 0)
  const option = {
    tooltip: { ...baseChart.tooltip, trigger: 'item', formatter: (p) => `${p.name}: <b>${p.value.toLocaleString()}</b> แห่ง (${fmt(p.percent, 1)}%)` },
    legend: { orient: 'vertical', right: 0, top: 'middle', textStyle: { color: BRAND.text },
      formatter: (n) => { const d = data.find((x) => x.name === n); return `${n}  ${total ? fmt(d.value / total * 100, 1) : 0}%` } },
    series: [{ type: 'pie', radius: ['52%', '78%'], center: ['32%', '50%'], data, label: { show: false },
      itemStyle: { borderColor: '#fff', borderWidth: 2 } }],
    graphic: [{ type: 'text', left: '32%', top: '45%', style: { text: total.toLocaleString(), fontSize: 22, fontWeight: 600, fill: BRAND.text, textAlign: 'center' } },
      { type: 'text', left: '32%', top: '56%', style: { text: 'แห่ง', fontSize: 12, fill: BRAND.textSecondary, textAlign: 'center' } }],
  }
  return <Chart option={option} height={height} />
}

// ---------- ฮิสโตแกรมการกระจายคะแนน
export function Histogram({ bins = [], counts = [], height = 260, markValue, markLabel }) {
  const option = {
    tooltip: { ...baseChart.tooltip, trigger: 'axis', formatter: (ps) => `คะแนน ${ps[0].name}–${Number(ps[0].name) + 1}: <b>${ps[0].value.toLocaleString()}</b> แห่ง` },
    xAxis: { type: 'category', data: bins, ...axisStyle, name: 'คะแนนรวม', nameLocation: 'middle', nameGap: 26 },
    yAxis: { type: 'value', ...axisStyle, name: 'จำนวน อปท.' },
    grid: { ...baseChart.grid, bottom: 24 },
    series: [{
      type: 'bar', barCategoryGap: '8%', data: counts, itemStyle: { color: '#3987e5', borderRadius: [3, 3, 0, 0] },
      markLine: markValue != null ? { symbol: 'none', lineStyle: { color: BRAND.accent, width: 2 },
        label: { formatter: markLabel || `${fmt(markValue)}`, color: BRAND.text },
        data: [{ xAxis: String(Math.floor(markValue)) }] } : undefined,
    }],
  }
  return <Chart option={option} height={height} />
}

// ---------- ผลรายข้อคำถาม (43 ข้อ) แยกสีตามด้าน
export function QuestionBars({ rows = [], height = 760, metric = 'avg_pct', onSelect }) {
  const data = [...rows].sort((a, b) => b.q - a.q)
  const option = {
    grid: { ...baseChart.grid, right: 40 },
    tooltip: { ...baseChart.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps) => { const r = data[ps[0].dataIndex]; return `<b>ข้อ ${r.q}</b> ${r.short}<br/>คะแนนเฉลี่ย: <b>${fmt(r.avg_pct, 1)}%</b><br/>ได้เต็ม: ${fmt(r.pct_full, 1)}% · ได้ 0: ${fmt(r.pct_zero, 1)}%<br/>หน่วยงานที่เข้าเงื่อนไข: ${r.n_applicable.toLocaleString()}` } },
    xAxis: { type: 'value', min: 0, max: 100, ...axisStyle, axisLabel: { ...axisStyle.axisLabel, formatter: '{value}%' } },
    yAxis: { type: 'category', data: data.map((r) => `${r.q}. ${r.short}`), ...axisStyle, fitLabels: { max: 300 }, axisLabel: { ...axisStyle.axisLabel, fontSize: 12, color: BRAND.text, interval: 0 } },
    series: [{
      type: 'bar', barMaxWidth: 12,
      data: data.map((r) => ({ value: r[metric], itemStyle: { color: PART_COLORS[r.part], borderRadius: [0, 3, 3, 0] } })),
      label: { show: true, position: 'right', formatter: (p) => fmt(p.value, 0), fontSize: 10, color: BRAND.textSecondary },
    }],
  }
  return <Chart option={option} height={height} onClick={(p) => onSelect && onSelect(data[p.dataIndex])} />
}

export function PartLegend() {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: BRAND.textSecondary }}>
      {[1, 2, 3, 4].map((k) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: PART_COLORS[k] }} />ด้าน{PART_SHORT[k]}
        </span>
      ))}
    </div>
  )
}

// ---------- แนวโน้มหลายปี
export function TrendLine({ rows = [], height = 280 }) {
  const years = rows.map((r) => String(r.year))
  const option = {
    legend: { top: 0, textStyle: { color: BRAND.textSecondary } },
    grid: { ...baseChart.grid, top: 40 },
    tooltip: { ...baseChart.tooltip, trigger: 'axis', valueFormatter: (v) => fmt(v, 2) },
    xAxis: { type: 'category', data: years, ...axisStyle },
    yAxis: { type: 'value', scale: true, ...axisStyle },
    series: [
      { name: 'คะแนนรวม', type: 'line', data: rows.map((r) => r.avg_total), lineStyle: { width: 3, color: BRAND.navy }, itemStyle: { color: BRAND.navy }, symbolSize: 9 },
      ...[1, 2, 3, 4].map((k) => ({ name: `ด้าน${{ 1: 'รายได้', 2: 'รายจ่าย', 3: 'พัสดุ', 4: 'บัญชี' }[k]} (%)`, type: 'line', data: rows.map((r) => r[`avg_p${k}`]), lineStyle: { width: 2, color: PART_COLORS[k] }, itemStyle: { color: PART_COLORS[k] }, symbolSize: 8 })),
    ],
  }
  if (rows.length < 2) option.graphic = [{ type: 'text', left: 'center', top: 'middle', style: { text: 'กราฟแนวโน้มจะสมบูรณ์เมื่อมีข้อมูลตั้งแต่ 2 ปีขึ้นไป', fill: BRAND.muted, fontSize: 13 } }]
  return <Chart option={option} height={height} />
}

// ---------- กราฟทั่วไปสำหรับ view builder
export function GenericChart({ type = 'bar', rows = [], colKeys = [], measureLabel = '', height = 380, horizontal }) {
  if (!rows.length) return <Empty description="ไม่มีข้อมูล" />
  const labels = rows.map((r) => String(r.label))
  const multi = colKeys.length > 0
  const seriesKeys = multi ? colKeys.slice(0, 8) : ['value']
  if (type === 'pie' && !multi) {
    return <Chart height={height} option={{
      tooltip: { ...baseChart.tooltip, trigger: 'item', valueFormatter: (v) => fmt(v) },
      legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'middle' },
      series: [{ type: 'pie', radius: ['40%', '72%'], center: ['38%', '50%'], itemStyle: { borderColor: '#fff', borderWidth: 2 },
        data: rows.map((r, i) => ({ name: String(r.label), value: r.values.value, itemStyle: { color: SERIES[i % SERIES.length] } })) }],
    }} />
  }
  const cat = horizontal
    ? { type: 'category', data: labels, ...axisStyle, fitLabels: { max: 220 }, axisLabel: { ...axisStyle.axisLabel, interval: 0, fontSize: 13, color: BRAND.text } }
    : { type: 'category', data: labels, ...axisStyle, axisLabel: { ...axisStyle.axisLabel, interval: 0, rotate: labels.length > 8 ? 35 : 0, formatter: (v) => fitText(v, 140, 12) } }
  const val = { type: 'value', scale: type === 'line', ...axisStyle }
  const option = {
    legend: multi ? { top: 0, type: 'scroll', textStyle: { color: BRAND.textSecondary } } : undefined,
    grid: { ...baseChart.grid, top: multi ? 40 : 20 },
    tooltip: { ...baseChart.tooltip, trigger: 'axis', valueFormatter: (v) => fmt(v) },
    xAxis: horizontal ? val : cat,
    yAxis: horizontal ? { ...cat, inverse: true } : val,
    series: seriesKeys.map((k, i) => ({
      name: multi ? k : measureLabel, type: type === 'line' ? 'line' : 'bar', barMaxWidth: 22,
      data: rows.map((r) => r.values[k] ?? null),
      itemStyle: { color: multi ? SERIES[i] : '#2a78d6', borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
      lineStyle: { width: 2 }, symbolSize: 8,
    })),
  }
  return <Chart option={option} height={height} />
}
