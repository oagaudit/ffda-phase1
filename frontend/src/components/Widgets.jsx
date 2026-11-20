// ตัวแสดงผล widget ตามผังใน config/dashboards.js
import { Col, Empty, Row, Segmented, Table } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, useFetch } from '../store'
import { GenericChart, GradeDonut, Histogram, PartLegend, PartsBars, QuestionBars, RankBar, ThailandMap, TrendLine, Chart } from './Charts'
import { Delta, ErrorBox, GradeTag, KpiRow, Panel, scopeLabel } from './Common'
import { BRAND, baseChart, fmt, fmtInt } from '../theme'

export function nextLevel(f, isStaff) {
  if (f.district) return isStaff ? 'org' : 'org_type'
  if (f.province) return 'district'
  if (f.region) return 'province'
  return 'region'
}
const LEVEL_NAME = { region: 'ภูมิภาค', province: 'จังหวัด', district: 'อำเภอ', org: 'หน่วยงาน', org_type: 'ประเภท อปท.' }

function useSummary() {
  const { year, filters } = useApp()
  return useFetch(year ? '/api/summary' : null, { year, ...filters })
}

function Kpis({ staff }) {
  const { meta, filters } = useApp()
  const { data: s, error } = useSummary()
  if (error) return <ErrorBox error={error} />
  if (!s) return <KpiRow items={[{ label: 'กำลังโหลด…' }]} />
  const low = meta.grade_bands[meta.grade_bands.length - 1]?.label
  const items = [
    { label: `คะแนนรวมเฉลี่ย · ${scopeLabel(filters)}`, value: s.avg_total, precision: 2, color: BRAND.navy,
      sub: s.prev_year ? <Delta cur={s.avg_total} prev={s.prev_avg_total} label={`ปี ${s.prev_year}`} /> : `มัธยฐาน ${fmt(s.median_total)}` },
    { label: 'อปท. ที่ส่งแบบประเมิน', value: s.n_submitted, sub: `จากทั้งหมด ${fmtInt(s.n_orgs)} แห่ง` },
    { label: 'อัตราการส่ง', value: s.submission_rate, precision: 1, suffix: '%', sub: staff ? `ยังไม่ส่ง ${fmtInt(s.not_submitted)} แห่ง` : 'ของ อปท. ในพื้นที่' },
    { label: 'คะแนนแบบประเมิน (เต็ม 100%)', value: s.avg_q_pct, precision: 2, suffix: '%', sub: `LPA ${fmt(s.avg_lpa10)}/10 · รายงานการเงิน ${fmt(s.avg_fin50)}/50`, hint: 'คะแนนรวม = แบบประเมิน 40% + LPA 10% + รายงานการเงิน 50%' },
    { label: `ระดับ "${low}"`, value: s.grades?.[low], sub: s.n_submitted ? `${fmt((s.grades?.[low] || 0) / s.n_submitted * 100, 1)}% ของที่ส่ง` : '', color: '#c8423b' },
    staff && { label: 'รายงานการเงินไม่เต็ม 50', value: s.n_fin_not_full, color: '#b42318', sub: s.n_submitted ? `${fmt(s.n_fin_not_full / s.n_submitted * 100, 1)}% ของที่ส่ง` : '' },
  ]
  if (s.suppressed) items.splice(0, 1, { label: 'คะแนนรวมเฉลี่ย', value: '–', sub: 'ปกปิด: จำนวนหน่วยงานน้อยเกินไป' })
  return <KpiRow items={items} />
}

function MapWidget({ w }) {
  const { meta, year, filters, drill } = useApp()
  const { region, org_type } = filters
  const { data, loading } = useFetch(year ? '/api/breakdown' : null, { year, level: 'province', region, org_type })
  return (
    <Panel title={w.title} hint={w.hint}>
      {loading && !data ? <div style={{ height: 520 }} /> :
        <ThailandMap rows={data?.rows || []} provinces={meta.provinces} selected={filters.province}
          onSelect={(name) => { const p = meta.provinces.find((x) => x.name === name); drill({ region: p.region, province: name }) }} />}
    </Panel>
  )
}

function DrillRank({ w }) {
  const { year, filters, drill, isStaff, meta } = useApp()
  const nav = useNavigate()
  const level = nextLevel(filters, isStaff)
  const [metric, setMetric] = useState('avg_total')
  const { data, loading, error } = useFetch(year ? '/api/breakdown' : null, { year, level, ...filters })
  const rows = (data?.rows || []).map((r) => level === 'org' ? { ...r, key: r.org_code, label: r.name, avg_total: r.total, n: 1, avg_p1: r.p1_pct, avg_p2: r.p2_pct, avg_p3: r.p3_pct, avg_p4: r.p4_pct } : r)
  const onSelect = (r) => {
    if (level === 'region') drill({ region: r.key })
    else if (level === 'province') drill({ province: r.key })
    else if (level === 'district') drill({ district: r.key })
    else if (level === 'org') nav(`/org/${r.key}`)
    else if (level === 'org_type') drill({ org_type: r.key })
  }
  const metrics = [
    { value: 'avg_total', label: 'คะแนนรวม' }, { value: 'avg_p1', label: 'รายได้' }, { value: 'avg_p2', label: 'รายจ่าย' },
    { value: 'avg_p3', label: 'พัสดุ' }, { value: 'avg_p4', label: 'บัญชี' },
    ...(level !== 'org' ? [{ value: 'submission_rate', label: 'อัตราการส่ง' }] : []),
  ]
  return (
    <Panel title={`${w.title} — ราย${LEVEL_NAME[level]}`} hint={w.hint}
      extra={<Segmented size="small" options={metrics} value={metric} onChange={setMetric} />}>
      <ErrorBox error={error} />
      {rows.length > 18 && <div className="cell-sub" style={{ marginBottom: 4 }}>ทั้งหมด {rows.length} รายการ · เลื่อนในกรอบเพื่อดูเพิ่ม · ชี้ที่แท่งเพื่อดูชื่อเต็ม</div>}
      <div style={{ maxHeight: 520, overflowY: 'auto' }}>
        <RankBar rows={rows} metric={metric} label={metrics.find((m) => m.value === metric)?.label}
          onSelect={onSelect} highlight={filters[level]} height={Math.max(480, rows.length * 26 + 48)} digits={metric === 'submission_rate' ? 1 : 2}
          max={metric === 'avg_total' ? 100 : metric === 'submission_rate' || metric.startsWith('avg_p') ? 100 : undefined} />
      </div>
      {loading && <div style={{ color: BRAND.muted }}>กำลังโหลด…</div>}
      {!isStaff && level === 'org_type' && <div className="note">ระดับรายหน่วยงานแสดงเฉพาะในโหมดเจ้าหน้าที่ · ประชาชนดูผลของ อปท. ตนเองได้ที่เมนู “ค้นหา อปท. ของฉัน”</div>}
    </Panel>
  )
}

function PartsWidget({ w }) {
  const { year } = useApp()
  const { data: s } = useSummary()
  const { data: nat } = useFetch(year ? '/api/summary' : null, { year })
  return (
    <Panel title={w.title} hint={w.hint}>
      <PartsBars parts={s?.parts || {}} compare={nat?.parts} />
    </Panel>
  )
}

function GradesWidget({ w }) {
  const { meta } = useApp()
  const { data: s } = useSummary()
  return <Panel title={w.title} hint={w.hint}><GradeDonut grades={s?.grades || {}} bands={meta.grade_bands} /></Panel>
}

function HistWidget({ w }) {
  const { year, filters } = useApp()
  const { data } = useFetch(year ? '/api/distribution' : null, { year, ...filters })
  return <Panel title={w.title} hint={w.hint}>{data && <Histogram bins={data.bins} counts={data.counts} markValue={data.mean} markLabel={`เฉลี่ย ${fmt(data.mean)}`} />}</Panel>
}

function ByType({ w }) {
  const { year, filters, drill } = useApp()
  const { org_type, ...rest } = filters
  const { data } = useFetch(year ? '/api/breakdown' : null, { year, level: 'org_type', ...rest })
  return <Panel title={w.title} hint={w.hint}><RankBar rows={data?.rows || []} onSelect={(r) => drill({ org_type: r.key })} highlight={org_type} height={260} /></Panel>
}

function QuestionsWidget({ w }) {
  const { year, filters } = useApp()
  const { data } = useFetch(year ? '/api/questions/stats' : null, { year, ...filters })
  const n = data?.rows?.length
  return <Panel title={`${w.title}${n ? ` (${n} ข้อ ปี ${year})` : ''}`} hint={w.hint} extra={<PartLegend />}>{data && <QuestionBars rows={data.rows} height={Math.max(420, n * 17 + 40)} />}</Panel>
}

function TrendWidget({ w }) {
  const { filters } = useApp()
  const { data } = useFetch('/api/trend', filters)
  return <Panel title={w.title} hint={w.hint}><TrendLine rows={data?.rows || []} /></Panel>
}

function Watchlist({ w }) {
  const { year, filters, meta } = useApp()
  const nav = useNavigate()
  const { data, loading } = useFetch(year ? '/api/watchlist' : null, { year, limit: 10, ...filters })
  return (
    <Panel title={w.title} hint={w.hint} extra={<a onClick={() => nav('/orgs')}>ดูรายชื่อทั้งหมด →</a>}>
      <Table size="small" loading={loading} rowKey="org_code" pagination={false} dataSource={data?.rows || []}
        onRow={(r) => ({ onClick: () => nav(`/org/${r.org_code}`), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'หน่วยงาน', dataIndex: 'name', render: (v, r) => <><b>{v}</b><div className="cell-sub">{r.org_type} · อ.{r.district} จ.{r.province}</div></> },
          { title: 'คะแนนรวม', dataIndex: 'total', align: 'right', render: (v) => <b>{fmt(v)}</b> },
          { title: 'ระดับ', dataIndex: 'grade', render: (v) => <GradeTag grade={v} bands={meta.grade_bands} /> },
          { title: 'รายงานการเงิน', dataIndex: 'fin50', align: 'right', render: (v) => `${fmt(v, 0)}/50` },
          { title: 'ด้านที่อ่อนที่สุด', dataIndex: 'weakest' },
        ]} />
    </Panel>
  )
}

const REGISTRY = {
  kpis: Kpis, map: MapWidget, drillRank: DrillRank, parts: PartsWidget, grades: GradesWidget,
  histogram: HistWidget, byType: ByType, questions: QuestionsWidget, trend: TrendWidget, watchlist: Watchlist,
}

export function Dashboard({ layout }) {
  return (
    <Row gutter={[16, 16]}>
      {layout.map((w, i) => {
        const C = REGISTRY[w.type]
        if (!C) return null
        return <Col key={i} xs={24} xl={w.span || 24}><C w={w} staff={w.staff} /></Col>
      })}
    </Row>
  )
}
