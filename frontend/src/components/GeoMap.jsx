// แผนที่หลายระดับ: จังหวัด / อำเภอ / ตำบล (ขอบเขตจาก OpenGISData-Thailand, CC BY 4.0)
// ไฟล์อยู่ใน public/geo — ใช้งานได้บน intranet โดยไม่ต้องต่ออินเทอร์เน็ต
import * as echarts from 'echarts'
import { useEffect, useState } from 'react'
import { Spin } from 'antd'
import { Chart, MAP_TAG } from './Charts'
import { BRAND, SEQ_BLUE, baseChart, fmt } from '../theme'

const cache = {}
function loadGeo(file) {
  cache[file] = cache[file] || fetch(`/geo/${file}`).then((r) => r.json())
  return cache[file]
}

// คืนชื่อแผนที่ที่ลงทะเบียนแล้ว: level = province | amp | tam ; scope = { pro, amp }
export function useGeo(level, scope = {}) {
  const key = level === 'province' ? 'g_prov' : level === 'amp' ? `g_amp_${scope.pro || 'all'}` : `g_tam_${scope.amp}`
  const [ready, setReady] = useState(!!echarts.getMap(key))
  const [names, setNames] = useState({})
  useEffect(() => {
    let alive = true
    const file = level === 'province' ? 'provinces.json' : level === 'amp' ? 'districts.json' : `tambon/${scope.pro}.json`
    loadGeo(file).then((g) => {
      const codeProp = { province: 'pro_code', amp: 'amp_code', tam: 'tam_code' }[level]
      const nameProp = { province: 'pro_th', amp: 'amp_th', tam: 'tam_th' }[level]
      let feats = g.features
      if (level === 'amp' && scope.pro) feats = feats.filter((f) => f.properties.pro_code === scope.pro)
      if (level === 'tam') feats = feats.filter((f) => f.properties.amp_code === scope.amp)
      const nm = {}
      feats = feats.map((f) => { nm[f.properties[codeProp]] = f.properties[nameProp]; return { ...f, properties: { ...f.properties, name: f.properties[codeProp] } } })
      if (!echarts.getMap(key)) echarts.registerMap(key, { type: 'FeatureCollection', features: feats })
      if (alive) { setNames(nm); setReady(true) }
    })
    return () => { alive = false }
  }, [key])
  return { mapKey: key, ready, names }
}

// สีแบบแยกขั้ว (ต่ำกว่า/สูงกว่าค่าเฉลี่ยประเทศ) — แดง ↔ เทา ↔ น้ำเงิน
export const DIVERGE = ['#b32b2b', '#e66767', '#f7c4c3', '#f0efec', '#b7d3f6', '#5598e7', '#1c5cab']
export function divergeColor(z) {
  if (z == null || Number.isNaN(z)) return null
  if (z <= -1.5) return DIVERGE[0]
  if (z <= -0.75) return DIVERGE[1]
  if (z <= -0.25) return DIVERGE[2]
  if (z < 0.25) return DIVERGE[3]
  if (z < 0.75) return DIVERGE[4]
  if (z < 1.5) return DIVERGE[5]
  return DIVERGE[6]
}

export function GeoMap({ level, scope, values = {}, label = '', selected, onSelect, height = 600, diverging,
  range, tooltipExtra, showLabels = true, compact }) {
  const { mapKey, ready, names } = useGeo(level, scope)
  if (!ready) return <Spin><div style={{ height }} /></Spin>
  const data = Object.keys(names).map((code) => ({ name: code, value: values[code] ?? null, selected: code === selected }))
  const vals = data.map((d) => d.value).filter((v) => v != null).sort((a, b) => a - b)
  const q = (p) => vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))] : 0
  const [min, max] = range || [Math.floor(q(0.03)), Math.ceil(q(0.97))]
  const nFeat = data.length
  const option = {
    tooltip: compact ? { show: false } : {
      ...baseChart.tooltip, trigger: 'item',
      formatter: (p) => {
        const nm = names[p.name] || p.name
        if (p.value == null || Number.isNaN(p.value)) return `<b>${nm}</b><br/><span style="color:#8a96a5">ไม่มีข้อมูล</span>`
        return `<b>${nm}</b><br/>${label}: <b>${fmt(p.value)}</b>${tooltipExtra ? tooltipExtra(p.name) : ''}`
      },
    },
    visualMap: diverging
      ? { show: false, type: 'piecewise', dimension: 0, pieces: [
          { lt: -1.5, color: DIVERGE[0] }, { gte: -1.5, lt: -0.75, color: DIVERGE[1] }, { gte: -0.75, lt: -0.25, color: DIVERGE[2] },
          { gte: -0.25, lt: 0.25, color: DIVERGE[3] }, { gte: 0.25, lt: 0.75, color: DIVERGE[4] }, { gte: 0.75, lt: 1.5, color: DIVERGE[5] }, { gte: 1.5, color: DIVERGE[6] }] }
      : { show: !compact, min, max, left: 8, bottom: 12, calculable: false, itemHeight: 110, itemWidth: 12, inRange: { color: SEQ_BLUE },
          text: [fmt(max, 0), fmt(min, 0)], textStyle: { color: BRAND.textSecondary, fontSize: 11 } },
    series: [{
      type: 'map', map: mapKey, roam: !compact, data, selectedMode: compact ? false : 'single',
      layoutCenter: ['50%', '50%'], layoutSize: '96%',
      itemStyle: { borderColor: '#fff', borderWidth: compact ? 0.3 : 0.7, areaColor: '#e9edf2' },
      emphasis: compact ? { disabled: true } : { label: { ...MAP_TAG, formatter: (p) => names[p.name] || '' }, itemStyle: { areaColor: '#c9a227' } },
      select: { label: { ...MAP_TAG, formatter: (p) => names[p.name] || '' }, itemStyle: { areaColor: '#c9a227', borderColor: BRAND.navyDark, borderWidth: 2 } },
      label: { show: !compact && showLabels && nFeat <= 40, formatter: (p) => names[p.name] || '', fontSize: 11.5, fontWeight: 500, color: BRAND.text, textBorderColor: '#fff', textBorderWidth: 3 },
    }],
  }
  return <Chart option={option} height={height} onClick={(p) => onSelect && onSelect(p.name, names[p.name])} />
}

// สีตัวอักษรบนช่องสีเข้ม
export function cellStyle(z) {
  const bg = divergeColor(z)
  if (!bg) return {}
  return { background: bg, color: Math.abs(z) >= 0.75 ? '#fff' : undefined }
}
