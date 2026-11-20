// หน้าต่าง ๆ ของระบบ (ภาพรวม / ประชาชน / เจ้าหน้าที่)
import { Alert, AutoComplete, Button, Card, Col, Descriptions, Empty, Form, Input, Row, Select, Space, Table, Tag, Typography } from 'antd'
import { DownloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useApp, useFetch } from '../store'
import { DrillBar, ErrorBox, GradeTag, PageHeader, Panel, scopeLabel } from '../components/Common'
import { Dashboard } from '../components/Widgets'
import { Chart, GradeDonut, PartLegend, QuestionBars, RankBar, ThailandMap } from '../components/Charts'
import { OVERVIEW_DASHBOARD, STAFF_DASHBOARD } from '../config/dashboards'
import { BRAND, PART_COLORS, axisStyle, baseChart, fmt, fmtInt } from '../theme'

export function NoData() {
  const { metaError, isStaff } = useApp()
  return <Card style={{ marginTop: 40, textAlign: 'center' }}><Empty description={metaError || (isStaff ? 'ยังไม่มีข้อมูล — ไปที่เมนู “นำเข้าข้อมูล” เพื่ออัปโหลด Excel ปี 2569' : 'ยังไม่มีข้อมูลที่เผยแพร่')} /></Card>
}

// ---------------------------------------------------------------- โหมดภาพรวม
export function OverviewPage() {
  const { meta, year, filters } = useApp()
  if (!meta?.latest_year) return <NoData />
  return (<>
    <PageHeader title="ภาพรวมวินัยการเงินการคลังขององค์กรปกครองส่วนท้องถิ่น" subtitle={`ผลการประเมินปีงบประมาณ พ.ศ. ${year} · ${scopeLabel(filters)} · แสดงเฉพาะข้อมูลสรุป ไม่เปิดเผยรายหน่วยงาน`} />
    <DrillBar />
    <Dashboard layout={OVERVIEW_DASHBOARD} />
  </>)
}

// ---------------------------------------------------------------- ประชาชน: ค้นหา อปท. ของฉัน
export function PublicHome() {
  const { meta, year, drill } = useApp()
  const nav = useNavigate()
  const [opts, setOpts] = useState([])
  const [q, setQ] = useState('')
  useEffect(() => {
    if (q.trim().length < 2) { setOpts([]); return }
    const t = setTimeout(() => api.get('/api/orgs/search', { q }).then((rows) => setOpts(rows.map((r) => ({
      value: r.code, label: <div><b>{r.name}</b><div className="cell-sub">อ.{r.district} จ.{r.province}</div></div>,
    })))).catch(() => setOpts([])), 250)
    return () => clearTimeout(t)
  }, [q])
  const { data: prov } = useFetch(year ? '/api/breakdown' : null, { year, level: 'province' })
  if (!meta?.latest_year) return <NoData />
  return (<>
    <div className="hero">
      <Typography.Title level={2} style={{ color: '#fff', margin: 0 }}>ท้องถิ่นของคุณบริหารเงินภาษีของเราดีแค่ไหน?</Typography.Title>
      <div style={{ color: '#d7e3ee', margin: '8px 0 20px' }}>ค้นหาเทศบาล หรือ อบต. ในพื้นที่ของคุณ เพื่อดูผลการประเมินวินัยการเงินการคลังปี {year}</div>
      {meta.public_org_lookup ? (
        <AutoComplete style={{ width: '100%', maxWidth: 620 }} options={opts} onSearch={setQ} onSelect={(v) => nav(`/org/${v}`)}>
          <Input size="large" prefix={<SearchOutlined />} placeholder="พิมพ์ชื่อ อปท. อำเภอ หรือจังหวัด เช่น “ท่าตูม” หรือ “เมืองเชียงใหม่”" allowClear />
        </AutoComplete>
      ) : <Alert type="info" message="ขณะนี้ยังไม่เปิดให้ค้นหารายหน่วยงาน" />}
    </div>
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={11}><Panel title="จังหวัดของคุณอยู่ตรงไหน" hint="คลิกจังหวัดเพื่อดูภาพรวมของจังหวัด">
        <ThailandMap rows={prov?.rows || []} provinces={meta.provinces} height={500}
          onSelect={(name) => { const p = meta.provinces.find((x) => x.name === name); drill({ region: p.region, province: name }); nav('/overview') }} />
      </Panel></Col>
      <Col xs={24} lg={13}><Panel title="คะแนนรวมเฉลี่ยรายจังหวัด (สูง → ต่ำ)">
        <div style={{ maxHeight: 500, overflowY: 'auto' }}><RankBar rows={prov?.rows || []} /></div>
      </Panel></Col>
      <Col xs={24}><Panel title="คะแนนนี้วัดอะไร">
        <Row gutter={[16, 16]}>
          {[['แบบประเมินตนเอง', '40%', `${meta.n_questions || ''} ข้อ ใน 4 ด้าน: รายได้ รายจ่าย จัดซื้อจัดจ้าง/พัสดุ และบัญชี/การตรวจสอบ`],
            ['คะแนน LPA', '10%', 'ผลการประเมินประสิทธิภาพขององค์กรปกครองส่วนท้องถิ่น (Local Performance Assessment)'],
            ['รายงานการเงิน', '50%', 'การจัดทำและส่งรายงานการเงินให้ สตง. ตรวจสอบตามกำหนด']].map(([t, w, d]) => (
            <Col xs={24} md={8} key={t}><div className="explain"><div className="explain-w">{w}</div><b>{t}</b><div className="cell-sub">{d}</div></div></Col>))}
        </Row>
      </Panel></Col>
    </Row>
  </>)
}

// ---------------------------------------------------------------- ข้อคำถาม: heatmap + แนวโน้มรายตัวชี้วัดข้ามปี
export const CHANGE_TAG = {
  reworded: { color: 'blue', label: 'ปรับถ้อยคำ' },
  changed: { color: 'orange', label: 'เปลี่ยนสาระ' },
  new: { color: 'green', label: 'ข้อใหม่' },
  removed: { color: 'default', label: 'ยกเลิก' },
}

function ItemTrend({ itemKey, items, onChange }) {
  const { filters } = useApp()
  const { data, error } = useFetch(itemKey ? '/api/questions/item-trend' : null, { key: itemKey, ...filters })
  const rows = data?.rows || []
  const since = data?.comparable_since
  const opt = {
    grid: { ...baseChart.grid, top: 30, bottom: 50 },
    tooltip: { ...baseChart.tooltip, trigger: 'axis', formatter: (ps) => { const r = rows[ps[0].dataIndex]; return r.present ? `ปี ${r.year} · ข้อ ${r.q}<br/>คะแนนเฉลี่ย <b>${fmt(r.avg_pct, 1)}%</b> · ได้เต็ม ${fmt(r.pct_full, 1)}%${r.change && r.change !== 'same' ? `<br/>${CHANGE_TAG[r.change]?.label || ''}` : ''}` : `ปี ${r.year}: ไม่มีข้อนี้ในแบบประเมิน` } },
    xAxis: { type: 'category', data: rows.map((r) => `${r.year}${r.present ? `\nข้อ ${r.q}` : '\n—'}`), ...axisStyle },
    yAxis: { type: 'value', min: 0, max: 100, ...axisStyle, axisLabel: { ...axisStyle.axisLabel, formatter: '{value}%' } },
    series: [{
      type: 'bar', barMaxWidth: 46,
      data: rows.map((r) => ({ value: r.present ? r.avg_pct : null, itemStyle: { color: since && r.year < since ? '#c9d1db' : PART_COLORS[data?.part], borderRadius: [4, 4, 0, 0] } })),
      label: { show: true, position: 'top', formatter: (p) => (p.value == null ? '' : fmt(p.value, 1)), color: BRAND.textSecondary },
    }],
  }
  return (
    <Panel title="แนวโน้มรายตัวชี้วัดข้ามปี" hint="เทียบด้วยรหัสตัวชี้วัด (ไม่ใช่เลขข้อ) จึงถูกตัวแม้เลขข้อเปลี่ยน · แท่งสีเทา = ก่อนการเปลี่ยนสาระ เทียบกับปีหลังไม่ได้"
      extra={<Select showSearch optionFilterProp="label" style={{ width: 360 }} value={itemKey} onChange={onChange}
        options={items.map((it) => ({ value: it.key, label: `${it.key} · ${it.short}` }))} />}>
      <ErrorBox error={error} />
      {data && <>
        <div className="cell-sub" style={{ marginBottom: 6 }}>{data.text}</div>
        <Chart option={opt} height={260} />
        {since && rows.some((r) => r.present && r.year < since) && <div className="note">ตัวชี้วัดนี้เปลี่ยนสาระในปี {since} — ใช้แนวโน้มได้ตั้งแต่ปี {since} เป็นต้นไป</div>}
      </>}
    </Panel>
  )
}

export function QuestionsPage() {
  const { meta, year, filters } = useApp()
  const { data } = useFetch(year ? '/api/questions/stats' : null, { year, ...filters })
  const { data: cw } = useFetch('/api/questions/crosswalk')
  const [heat, setHeat] = useState(null)
  const [itemKey, setItemKey] = useState(null)
  useEffect(() => {
    if (!year || !meta) return
    const keys = filters.province ? [] : (filters.region ? meta.provinces.filter((p) => p.region === filters.region).map((p) => ['province', p.name]) : meta.regions.map((r) => ['region', r]))
    Promise.all(keys.map(([k, v]) => api.get('/api/questions/stats', { year, [k]: v, org_type: filters.org_type }).then((d) => [v, d.rows]).catch(() => [v, []])))
      .then(setHeat)
  }, [year, filters, meta])
  const rows = data?.rows || []
  useEffect(() => { // เริ่มที่ข้อที่คะแนนเฉลี่ยต่ำที่สุดของปีที่เลือก
    if (!itemKey && rows.length) setItemKey([...rows].sort((a, b) => (a.avg_pct ?? 999) - (b.avg_pct ?? 999))[0].key)
  }, [rows, itemKey])
  if (!meta?.latest_year) return <NoData />
  const qs = rows.map((r) => r.q)
  const yinfo = cw?.years?.find((y) => y.year === year)
  const removed = (cw?.items || []).filter((it) => it.years[year]?.change === 'removed')
  const changedRows = rows.filter((r) => r.change && r.change !== 'same')
  const heatOpt = heat && heat.length && rows.length ? {
    grid: { left: 8, right: 16, top: 10, bottom: 70, containLabel: true },
    tooltip: { ...baseChart.tooltip, formatter: (p) => `${heat[p.data[1]][0]}<br/>ข้อ ${qs[p.data[0]]} ${rows[p.data[0]].short}<br/><b>${fmt(p.data[2], 1)}%</b>` },
    xAxis: { type: 'category', data: qs.map(String), ...axisStyle, name: 'ข้อคำถาม', nameLocation: 'middle', nameGap: 28 },
    yAxis: { type: 'category', data: heat.map((h) => h[0]), ...axisStyle },
    visualMap: { min: 30, max: 100, orient: 'horizontal', left: 'center', bottom: 0, itemWidth: 12, inRange: { color: ['#c8423b', '#f2c94c', '#f7f7f5', '#6da7ec', '#184f95'] }, text: ['100%', '30%'] },
    series: [{ type: 'heatmap', data: heat.flatMap(([, rs], yi) => rs.map((r) => [qs.indexOf(r.q), yi, r.avg_pct])).filter((d) => d[0] >= 0), itemStyle: { borderColor: '#fff', borderWidth: 1 } }],
  } : null
  return (<>
    <PageHeader title="วิเคราะห์รายข้อคำถาม" subtitle={`แบบประเมินปี ${year} · ${rows.length} ข้อ · ระบุประเด็นที่ อปท. ส่วนใหญ่ยังทำได้ไม่ครบ เพื่อวางแผนให้คำแนะนำ/ฝึกอบรม`} />
    <DrillBar />
    {yinfo?.base_year && (changedRows.length > 0 || removed.length > 0) && (
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={`แบบประเมินปี ${year} เปลี่ยนจากปี ${yinfo.base_year}`}
        description={<Space wrap size={[4, 4]}>
          {changedRows.map((r) => <Tag key={r.q} color={CHANGE_TAG[r.change]?.color}>ข้อ {r.q} {CHANGE_TAG[r.change]?.label}: {r.short}</Tag>)}
          {removed.map((it) => <Tag key={it.key}>ยกเลิก: {it.short} (ปี {yinfo.base_year} ข้อ {it.years[yinfo.base_year]?.q})</Tag>)}
          <span className="muted">· ข้ออื่นเหมือนเดิม (บางข้อเลขข้อเลื่อน) — การเทียบข้ามปีใช้รหัสตัวชี้วัด</span>
        </Space>} />)}
    <Row gutter={[16, 16]}>
      {heatOpt && <Col xs={24}><Panel title={`แผนภาพความร้อน: คะแนนเฉลี่ยรายข้อ × ${filters.region ? 'จังหวัด' : 'ภูมิภาค'}`} hint="สีแดง = จุดอ่อน, สีน้ำเงิน = ทำได้ดี">
        <Chart option={heatOpt} height={Math.max(260, heat.length * 26 + 110)} /></Panel></Col>}
      <Col xs={24} xl={12}><Panel title="รายข้อ (%)" extra={<PartLegend />} hint="คลิกแท่งเพื่อดูแนวโน้มข้ามปีของข้อนั้น">
        {data && <QuestionBars rows={rows} height={Math.max(420, rows.length * 17 + 40)} onSelect={(r) => setItemKey(r.key)} />}</Panel></Col>
      <Col xs={24} xl={12}>
        {cw && <ItemTrend itemKey={itemKey} items={cw.items.filter((it) => Object.values(it.years).some((y) => y.q))} onChange={setItemKey} />}
      </Col>
    </Row>
  </>)
}
