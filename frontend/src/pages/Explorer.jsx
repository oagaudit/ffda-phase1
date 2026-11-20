// หน้าสำรวจพื้นที่ (สำหรับเจ้าหน้าที่ สตง.) — ปรับจากต้นแบบ "แผนที่วินัยการเงินการคลัง อปท."
// แผนที่ซ้าย + แฟ้มข้อมูลพื้นที่ขวา, เจาะลง ประเทศ › จังหวัด › อำเภอ › ตำบล/อปท., 3 มุมมอง, แผนที่เล็ก 4 ด้าน, ตารางสีผลต่าง
import { AutoComplete, Button, Card, Col, Empty, Input, Row, Segmented, Select, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { ArrowUpOutlined, ExportOutlined, SearchOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useApp, useFetch } from '../store'
import { GeoMap, cellStyle } from '../components/GeoMap'
import { BRAND, PART_COLORS, PART_SHORT, fmt, fmtInt } from '../theme'
import { NoData } from './Pages'

const TABS = [
  { value: 'total', label: '1 · คะแนนรวมโครงการ' },
  { value: 'ffda', label: '2 · การประเมิน FFDA รายด้าน' },
  { value: 'items', label: '3 · รายด้านและรายข้อ' },
]
const METRICS = {
  total: [
    { value: 'avg_total', label: 'คะแนนรวม (100)', org: 'total' },
    { value: 'avg_fin50', label: 'รายงานการเงิน FA (50)', org: 'fin50' },
    { value: 'avg_q40', label: 'แบบประเมินตนเอง CSA (40)', org: 'q40' },
    { value: 'avg_lpa10', label: 'LPA (10)', org: 'lpa10' },
    { value: 'submission_rate', label: 'อัตราการส่งแบบประเมิน (%)', org: null },
  ],
  ffda: [
    { value: 'avg_q_pct', label: 'FFDA รวม 4 ด้าน (%)', org: 'q_pct' },
    ...[1, 2, 3, 4].map((k) => ({ value: `avg_p${k}`, label: `ด้านที่ ${k} ${PART_SHORT[k]} (%)`, org: `p${k}_pct` })),
  ],
}
const val = (r, m) => (r ? (r[m.value] ?? (m.org ? r[m.org] : undefined)) : undefined)

export default function Explorer() {
  const { meta, year } = useApp()
  const nav = useNavigate()
  const [tab, setTab] = useState('total')
  const [metricKey, setMetricKey] = useState('avg_total')
  const [part, setPart] = useState(1)
  const [natLevel, setNatLevel] = useState('province')
  const [orgType, setOrgType] = useState()
  const [path, setPath] = useState({}) // { pro, proName, amp, ampName, tam, tamName, org }
  const [tq, setTq] = useState('')
  const [sort, setSort] = useState(null)

  useEffect(() => { setMetricKey(tab === 'total' ? 'avg_total' : tab === 'ffda' ? 'avg_q_pct' : `avg_p${part}`) }, [tab, part])
  const metric = tab === 'items' ? METRICS.ffda.find((m) => m.value === `avg_p${part}`) : (METRICS[tab].find((m) => m.value === metricKey) || METRICS[tab][0])

  // ระดับปัจจุบัน
  const mapLevel = path.amp ? 'tam' : path.pro ? 'amp' : natLevel
  const childLevel = path.amp ? 'org' : path.pro ? 'amp' : natLevel
  const base = { year, org_type: orgType }
  const scopeF = { ...base, province: path.proName, amp_code: path.amp }

  const nat = useFetch(year ? '/api/summary' : null, base)
  const scope = useFetch(year ? '/api/summary' : null, scopeF)
  const kids = useFetch(year ? '/api/breakdown' : null, { ...scopeF, level: childLevel })
  // ระดับตำบล: ค่าแผนที่จากการรวม อปท. ตามตำบล
  const tams = useFetch(year && path.amp ? '/api/breakdown' : null, { ...scopeF, level: 'tam' })
  const orgDetail = useFetch(path.org ? `/api/orgs/${path.org}` : null, { year })

  const provByName = useMemo(() => Object.fromEntries((meta?.provinces || []).map((p) => [p.name, p])), [meta])
  if (!meta?.latest_year) return <NoData />

  const natS = nat.data, scS = scope.data
  const rows = (kids.data?.rows || []).map((r) => childLevel === 'org'
    ? { ...r, key: r.org_code, label: r.name, n: 1, avg_total: r.total, avg_fin50: r.fin50, avg_q40: r.q40, avg_lpa10: r.lpa10, avg_q_pct: r.q_pct, avg_p1: r.p1_pct, avg_p2: r.p2_pct, avg_p3: r.p3_pct, avg_p4: r.p4_pct }
    : r)

  // ค่าที่ใช้ระบายสีแผนที่ (รหัสพื้นที่ -> ค่า)
  const mapRows = mapLevel === 'tam' ? (tams.data?.rows || []) : rows
  const mapValues = {}
  for (const r of mapRows) {
    const code = mapLevel === 'province' ? provByName[r.key]?.code : r.key
    if (code) mapValues[code] = val(r, metric)
  }
  const mapScope = { pro: path.pro, amp: path.amp }

  const z = (r, k) => {
    const sd = natS?.parts_std?.[k]; const ref = natS?.parts?.[k]
    const v = r[`avg_p${k}`]
    return v == null || !sd || ref == null ? null : (v - ref) / sd
  }
  const pattern = (r) => [1, 2, 3, 4].map((k) => { const d = (r[`avg_p${k}`] ?? NaN) - (natS?.parts?.[k] ?? NaN); return Number.isNaN(d) ? '·' : d >= 0 ? '▲' : '▼' }).join('')
  const priority = (r) => {
    let best = null
    for (const k of [1, 2, 3, 4]) { const zz = z(r, k); if (zz != null && zz < 0 && (best == null || zz < best.z)) best = { k, z: zz } }
    return best
  }

  const select = (code, name) => {
    if (mapLevel === 'province') { const p = meta.provinces.find((x) => x.code === code); setPath({ pro: code, proName: p?.name }) }
    else if (mapLevel === 'amp') {
      const pro = path.pro || code.slice(0, 2)
      setPath({ pro, proName: meta.provinces.find((x) => x.code === pro)?.name, amp: code, ampName: name })
    } else setPath({ ...path, tam: code, tamName: name, org: undefined })
  }
  const up = () => setPath(path.org ? { ...path, org: undefined } : path.tam ? { ...path, tam: undefined, tamName: undefined } : path.amp ? { pro: path.pro, proName: path.proName } : {})

  const scopeName = path.ampName ? `อำเภอ${path.ampName} จ.${path.proName}` : path.proName ? `จังหวัด${path.proName}` : 'ประเทศไทย'
  const siblings = rows.filter((r) => val(r, metric) != null)
  const tableRows = rows.filter((r) => !tq || String(r.label).includes(tq) || (r.tam_name || '').includes(tq))
    .filter((r) => !path.tam || r.tam_code === path.tam)

  return (
    <div className="explorer">
      <div className="ex-head">
        <div>
          <div className="eyebrow">โครงการประเมินวินัยการเงินการคลังของ อปท. · ผลประเมินปี {year}</div>
          <Typography.Title level={3} style={{ margin: '2px 0 0' }}>สำรวจพื้นที่ — {scopeName}</Typography.Title>
          <div className="page-sub">คะแนนรวม 100 = รายงานการเงิน FA 50 + แบบประเมินตนเอง FFDA (CSA) 40 + LPA 10 · คลิกแผนที่เพื่อเจาะลง จังหวัด › อำเภอ › ตำบล/อปท.</div>
        </div>
        <div className="ex-kpis">
          <div><b>{fmt(natS?.avg_total)}</b><span>คะแนนรวมเฉลี่ยประเทศ</span></div>
          <div><b>{fmtInt(natS?.n_submitted)}</b><span>อปท. ส่งแบบประเมิน</span></div>
          <div><b>{fmt(natS?.submission_rate, 1)}%</b><span>อัตราการส่ง</span></div>
          <div><b>{fmt(natS?.avg_q_pct, 1)}%</b><span>FFDA เฉลี่ย</span></div>
        </div>
      </div>

      <div className="ex-toolbar">
        <Segmented value={tab} onChange={setTab} options={TABS} />
        {tab !== 'items'
          ? <Select style={{ width: 250 }} value={metric.value} onChange={setMetricKey} options={METRICS[tab].map((m) => ({ value: m.value, label: `แสดงค่า: ${m.label}` }))} />
          : <Select style={{ width: 290 }} value={part} onChange={setPart} options={[1, 2, 3, 4].map((k) => ({ value: k, label: `ด้านที่ ${k} ${PART_SHORT[k]}` }))} />}
        {!path.pro && <Segmented value={natLevel} onChange={setNatLevel} options={[{ value: 'province', label: 'ทั้งประเทศรายจังหวัด' }, { value: 'amp', label: 'รายอำเภอ' }]} />}
        <Select allowClear placeholder="ทุกประเภท" style={{ width: 150 }} value={orgType} onChange={setOrgType} options={meta.org_types.map((t) => ({ value: t, label: t }))} />
        <OrgSearch onPick={(o) => nav(`/org/${o.value}`)} />
      </div>

      <div className="crumbs">
        <button aria-current={!path.pro} onClick={() => setPath({})}>ประเทศไทย</button>
        {path.pro && <><span>›</span><button aria-current={!path.amp} onClick={() => setPath({ pro: path.pro, proName: path.proName })}>จ.{path.proName}</button></>}
        {path.amp && <><span>›</span><button aria-current={!path.tam && !path.org} onClick={() => setPath({ pro: path.pro, proName: path.proName, amp: path.amp, ampName: path.ampName })}>อ.{path.ampName}</button></>}
        {path.tam && <><span>›</span><button aria-current={!path.org} onClick={() => setPath({ ...path, org: undefined })}>ต.{path.tamName}</button></>}
        {path.org && orgDetail.data && <><span>›</span><button aria-current>{orgDetail.data.name}</button></>}
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={13}>
          <Card className="panel" styles={{ body: { padding: 12, position: 'relative' } }}>
            <div className="maptitle">{metric.label} · {mapLevel === 'province' ? 'รายจังหวัด' : mapLevel === 'amp' ? 'รายอำเภอ' : 'รายตำบล'}</div>
            <div className="cell-sub">{mapLevel === 'tam' ? 'ค่าของตำบล = ค่าเฉลี่ยของ อปท. ในตำบล · คลิกตำบลเพื่อดูรายชื่อ อปท.' : 'คลิกพื้นที่เพื่อเจาะลง · ลากเพื่อเลื่อน · เลื่อนลูกกลิ้งเพื่อซูม'}</div>
            {path.pro && <Button size="small" icon={<ArrowUpOutlined />} onClick={up} style={{ position: 'absolute', right: 12, top: 12, zIndex: 2 }}>ย้อนขึ้น</Button>}
            <GeoMap key={`${mapLevel}-${path.pro}-${path.amp}`} level={mapLevel} scope={mapScope} values={mapValues} label={metric.label}
              selected={path.tam || undefined} onSelect={select} height={640}
              tooltipExtra={(code) => {
                const r = mapRows.find((x) => (mapLevel === 'province' ? provByName[x.key]?.code : x.key) === code)
                return r ? `<br/>อปท. ที่ส่ง: ${r.n} แห่ง${r.submission_rate != null ? ` (${fmt(r.submission_rate, 1)}%)` : ''}<br/>รูปแบบ 4 ด้าน: <span style="letter-spacing:2px">${pattern(r)}</span>` : ''
              }} />
            {mapLevel === 'tam' && <div className="note">อปท. ที่ระบุตำบลไม่ได้ (ส่วนใหญ่เป็นเทศบาลที่ชื่อไม่ตรงกับตำบล) ยังอยู่ในตารางรายชื่อของอำเภอ · อบจ. แสดงที่ระดับจังหวัด</div>}
          </Card>
        </Col>
        <Col xs={24} xl={11}>
          {path.org
            ? <OrgDossier d={orgDetail.data} nat={natS} scope={scS} meta={meta} onOpen={() => nav(`/org/${path.org}`)} onBack={() => setPath({ ...path, org: undefined })} />
            : <AreaDossier name={scopeName} s={scS} nat={natS} meta={meta} metric={metric} siblings={siblings} isNation={!path.pro}
                pattern={pattern} priority={priority} tab={tab} part={part} scopeF={scopeF} />}
        </Col>
      </Row>

      {tab === 'ffda' && (
        <Card className="panel" style={{ marginTop: 16 }} title={<span>FFDA 4 ด้าน เทียบค่าเฉลี่ยประเทศ <span className="muted">· {mapLevel === 'province' ? 'รายจังหวัด' : mapLevel === 'amp' ? 'รายอำเภอ' : 'รายตำบล'}</span></span>}>
          <Row gutter={[12, 12]}>
            {[1, 2, 3, 4].map((k) => {
              const zv = {}
              for (const r of mapRows) {
                const code = mapLevel === 'province' ? provByName[r.key]?.code : r.key
                if (code) zv[code] = z(r, k)
              }
              return (
                <Col xs={12} lg={6} key={k}>
                  <div className="sm-cap"><span style={{ color: PART_COLORS[k] }}>■</span> ด้านที่ {k} {PART_SHORT[k]}<div className="cell-sub">ประเทศ {fmt(natS?.parts?.[k], 1)}%</div></div>
                  <GeoMap level={mapLevel} scope={mapScope} values={zv} diverging compact height={300} onSelect={select} />
                </Col>)
            })}
          </Row>
          <DivergeLegend />
        </Card>
      )}

      {tab === 'items'
        ? <ItemsMatrix level={childLevel} scopeF={scopeF} part={part} tq={tq} setTq={setTq}
            onRow={(r) => childLevel === 'org' ? setPath({ ...path, org: r.key }) : select(mapLevel === 'province' ? provByName[r.key]?.code : r.key, r.label)} />
        : (
          <Card className="panel" style={{ marginTop: 16 }} title={`ตาราง${childLevel === 'org' ? 'รายชื่อ อปท.' : childLevel === 'amp' ? 'รายอำเภอ' : 'รายจังหวัด'}${path.tam ? ` · ต.${path.tamName}` : ''} (${tableRows.length})`}
            extra={<Input allowClear size="small" prefix={<SearchOutlined />} placeholder="กรองชื่อ" value={tq} onChange={(e) => setTq(e.target.value)} style={{ width: 200 }} />}>
            <Table size="small" rowKey="key" dataSource={tableRows} loading={kids.loading} pagination={{ pageSize: 15, size: 'small', showSizeChanger: true }} scroll={{ x: 1100 }}
              onRow={(r) => ({ className: 'click', onClick: () => childLevel === 'org' ? setPath({ ...path, org: r.key }) : select(mapLevel === 'province' ? provByName[r.key]?.code : r.key, r.label) })}
              onChange={(_, __, s) => setSort(s)}
              columns={[
                { title: childLevel === 'org' ? 'อปท.' : 'พื้นที่', dataIndex: 'label', fixed: 'left', width: 220, sorter: (a, b) => String(a.label).localeCompare(String(b.label), 'th'),
                  render: (v, r) => <>{v}{childLevel === 'org' && <div className="cell-sub">{r.org_type}{r.tam_name && r.tam_name !== 'ไม่ระบุตำบล' ? ` · ต.${r.tam_name}` : ''}</div>}</> },
                childLevel !== 'org' && { title: 'ส่ง', dataIndex: 'n', align: 'right', width: 60, sorter: (a, b) => a.n - b.n },
                { title: 'รวม 100', dataIndex: 'avg_total', align: 'right', width: 80, defaultSortOrder: childLevel === 'org' ? 'ascend' : undefined, sorter: (a, b) => (a.avg_total ?? 0) - (b.avg_total ?? 0), render: (v) => <b>{fmt(v)}</b> },
                { title: 'FA 50', dataIndex: 'avg_fin50', align: 'right', width: 70, sorter: (a, b) => (a.avg_fin50 ?? 0) - (b.avg_fin50 ?? 0), render: (v) => fmt(v, 1) },
                { title: 'CSA 40', dataIndex: 'avg_q40', align: 'right', width: 70, sorter: (a, b) => (a.avg_q40 ?? 0) - (b.avg_q40 ?? 0), render: (v) => fmt(v, 1) },
                { title: 'LPA 10', dataIndex: 'avg_lpa10', align: 'right', width: 70, sorter: (a, b) => (a.avg_lpa10 ?? 0) - (b.avg_lpa10 ?? 0), render: (v) => fmt(v, 2) },
                ...[1, 2, 3, 4].map((k) => ({
                  title: <Tooltip title={`ด้านที่ ${k} ${PART_SHORT[k]} — สีคือผลต่างจากค่าเฉลี่ยประเทศ`}><span style={{ borderBottom: `2px solid ${PART_COLORS[k]}` }}>ด้าน {k} %</span></Tooltip>,
                  dataIndex: `avg_p${k}`, align: 'right', width: 76, sorter: (a, b) => (a[`avg_p${k}`] ?? 0) - (b[`avg_p${k}`] ?? 0),
                  onCell: (r) => ({ style: cellStyle(z(r, k)) }),
                  render: (v) => fmt(v, 1),
                })),
                { title: 'รูปแบบ', width: 80, render: (r) => <span className="pattern">{pattern(r)}</span> },
                { title: childLevel === 'org' ? 'ระดับ' : 'ส่งเสริมก่อน', width: 150, render: (r) => childLevel === 'org'
                  ? <GradePill g={r.grade} bands={meta.grade_bands} />
                  : (() => { const p = priority(r); return p ? <span><span style={{ color: PART_COLORS[p.k] }}>■</span> {PART_SHORT[p.k]}</span> : <span className="muted">–</span> })() },
              ].filter(Boolean)} />
            <div className="note">คลิกหัวคอลัมน์เพื่อเรียงลำดับ · คลิกแถวเพื่อเจาะลง · ช่องสีของด้านที่ 1–4 = ผลต่างจากค่าเฉลี่ยประเทศ{orgType ? ` (${orgType})` : ''} หารด้วยส่วนเบี่ยงเบนมาตรฐาน (น้ำเงิน = สูงกว่า, แดง = ต่ำกว่า) · รูปแบบ ▲▼ เรียงด้าน 1→4</div>
          </Card>)}
    </div>
  )
}

function OrgSearch({ onPick }) {
  const [opts, setOpts] = useState([])
  const [q, setQ] = useState('')
  useEffect(() => {
    if (q.trim().length < 2) { setOpts([]); return }
    const t = setTimeout(() => api.get('/api/orgs/search', { q }).then((rows) => setOpts(rows.map((r) => ({ value: r.code, label: <div>{r.name}<div className="cell-sub">อ.{r.district} จ.{r.province}</div></div> })))).catch(() => {}), 250)
    return () => clearTimeout(t)
  }, [q])
  return (
    <AutoComplete style={{ width: 280 }} options={opts} onSearch={setQ} onSelect={(v) => onPick({ value: v })}>
      <Input prefix={<SearchOutlined />} placeholder="ค้นหา อปท. / ตำบล / อำเภอ / จังหวัด" allowClear />
    </AutoComplete>
  )
}

function GradePill({ g, bands }) {
  const b = bands.find((x) => x.label === g)
  return g ? <span className="pill"><i style={{ background: b?.color }} />{g}</span> : '–'
}

function GradeStack({ grades = {}, bands }) {
  const total = Object.values(grades).reduce((a, b) => a + b, 0)
  if (!total) return null
  return (
    <div>
      <div className="stack">{bands.map((b) => grades[b.label] ? <span key={b.label} title={`${b.label} ${grades[b.label]}`} style={{ flex: grades[b.label], background: b.color }} /> : null)}</div>
      <div className="legend-row">{bands.map((b) => <span key={b.label}><i style={{ background: b.color }} />{b.label} {fmtInt(grades[b.label] || 0)}</span>)}</div>
    </div>
  )
}

function PartBars({ parts = {}, refParts = {}, refLabel = 'ประเทศ' }) {
  return (
    <div className="parts">
      {[1, 2, 3, 4].map((k) => {
        const v = parts[k]; const r = refParts[k]; const d = v != null && r != null ? v - r : null
        return (
          <div key={k}>
            <div className="part-top"><span><span style={{ color: PART_COLORS[k] }}>■</span> ด้านที่ {k} {PART_SHORT[k]}</span>
              <span><b>{fmt(v, 1)}%</b> {d != null && <span className={d >= 0 ? 'up' : 'dn'}>{d >= 0 ? '▲' : '▼'} {fmt(Math.abs(d), 1)}</span>}</span></div>
            <div className="mbar"><i style={{ width: `${v || 0}%`, background: PART_COLORS[k] }} />{r != null && <b style={{ left: `${r}%` }} title={`${refLabel} ${fmt(r, 1)}%`} />}</div>
          </div>)
      })}
      <div className="cell-sub">เส้นดำ = ค่าเฉลี่ย{refLabel}</div>
    </div>
  )
}

function AreaDossier({ name, s, nat, meta, metric, siblings, isNation, pattern, priority, tab, part, scopeF }) {
  if (!s) return <Card className="panel" loading />
  const v = s[metric.value] ?? (metric.value === 'avg_q_pct' ? s.avg_q_pct : metric.value.startsWith('avg_p') ? s.parts?.[metric.value.slice(5)] : undefined)
  const asRow = { avg_p1: s.parts?.[1], avg_p2: s.parts?.[2], avg_p3: s.parts?.[3], avg_p4: s.parts?.[4] }
  const pr = isNation ? null : priority(asRow)
  const sorted = [...siblings].sort((a, b) => val(b, metric) - val(a, metric))
  return (
    <Card className="panel dossier" styles={{ body: { padding: 16, display: 'flex', flexDirection: 'column', gap: 14 } }}>
      <div>
        <div className="eyebrow">แฟ้มข้อมูลพื้นที่</div>
        <Typography.Title level={4} style={{ margin: 0 }}>{name}</Typography.Title>
        <div className="cell-sub">ส่งแบบประเมิน {fmtInt(s.n_submitted)} จาก {fmtInt(s.n_orgs)} แห่ง ({fmt(s.submission_rate, 1)}%)</div>
      </div>
      <div className="stats3">
        <div><b>{fmt(s.avg_total)}</b><span>คะแนนรวมเฉลี่ย {!isNation && nat && <span className={s.avg_total >= nat.avg_total ? 'up' : 'dn'}>({s.avg_total >= nat.avg_total ? '+' : ''}{fmt(s.avg_total - nat.avg_total)})</span>}</span></div>
        <div><b>{fmt(s.avg_fin50, 1)}</b><span>FA เฉลี่ย / 50</span></div>
        <div><b>{fmt(s.avg_q40, 1)} · {fmt(s.avg_lpa10, 1)}</b><span>CSA / 40 · LPA / 10</span></div>
      </div>
      <div><div className="sub-h">ระดับผลการประเมิน</div><GradeStack grades={s.grades} bands={meta.grade_bands} /></div>
      <div><div className="sub-h">FFDA 4 ด้าน {!isNation && <span className="pattern" style={{ marginLeft: 8 }}>{pattern(asRow)}</span>}</div>
        <PartBars parts={s.parts} refParts={isNation ? undefined : nat?.parts} /></div>
      {pr && <div className="callout"><b>ด้านที่ควรส่งเสริมก่อน:</b> ด้านที่ {pr.k} {PART_SHORT[pr.k]} — ต่ำกว่าค่าเฉลี่ยประเทศ {fmt(Math.abs(pr.z), 2)} เท่าของส่วนเบี่ยงเบนมาตรฐาน</div>}
      {tab === 'items' && <PartQuestions part={part} scopeF={scopeF} />}
      {tab !== 'items' && sorted.length > 1 && (
        <div>
          <div className="sub-h">อันดับพื้นที่ย่อยตาม{metric.label}</div>
          <div className="rank-list">
            {sorted.slice(0, 5).map((r, i) => <div key={r.key}><span>{i + 1}. {r.label}</span><b>{fmt(val(r, metric))}</b></div>)}
            {sorted.length > 10 && <div className="muted" style={{ textAlign: 'center' }}>⋯</div>}
            {sorted.slice(Math.max(5, sorted.length - 5)).map((r, i, arr) => <div key={r.key} className="dn-row"><span>{sorted.length - arr.length + i + 1}. {r.label}</span><b>{fmt(val(r, metric))}</b></div>)}
          </div>
        </div>)}
    </Card>
  )
}

// รายข้อของด้านที่เลือก + สัดส่วนตัวเลือกคำตอบ (พื้นที่นี้ เทียบประเทศ)
function PartQuestions({ part, scopeF }) {
  const { meta } = useApp()
  const qs = meta.questions.filter((q) => q.part === part)
  const [q, setQ] = useState(qs[0]?.q)
  useEffect(() => { setQ(qs[0]?.q) }, [part]) // eslint-disable-line
  const stats = useFetch('/api/questions/stats', scopeF)
  const natStats = useFetch('/api/questions/stats', { year: scopeF.year, org_type: scopeF.org_type })
  const opts = useFetch(q ? `/api/questions/${q}/options` : null, scopeF)
  const st = Object.fromEntries((stats.data?.rows || []).map((r) => [r.q, r]))
  const ns = Object.fromEntries((natStats.data?.rows || []).map((r) => [r.q, r]))
  return (
    <div>
      <div className="sub-h">ข้อคำถามด้านที่ {part} — คลิกเพื่อดูสัดส่วนคำตอบ</div>
      <div className="qlist">
        {qs.map((x) => {
          const v = st[x.q]?.avg_pct; const r = ns[x.q]?.avg_pct
          return (
            <div key={x.q} className={`qrow ${q === x.q ? 'on' : ''}`} onClick={() => setQ(x.q)}>
              <span className="qn">{x.q}</span><span className="qt">{x.short}</span>
              <div className="mbar"><i style={{ width: `${v || 0}%`, background: PART_COLORS[part] }} />{r != null && <b style={{ left: `${r}%` }} />}</div>
              <span className="qv">{fmt(v, 0)}%</span>
            </div>)
        })}
      </div>
      {opts.data && (
        <div className="qbox">
          <div className="sub-h" style={{ margin: 0 }}>ข้อ {opts.data.q} {opts.data.short}{opts.data.group === 2 ? ' (แบบ อบจ.)' : opts.data.group === 1 ? ' (แบบ อบต./เทศบาล)' : ''}</div>
          {opts.data.options.length === 0 ? <Empty description="ไม่มีข้อมูลคำตอบ" /> : opts.data.options.filter((o) => o.pct_national > 0 || o.pct > 0).map((o) => (
            <div key={`${o.no}-${o.text}`} className="opt">
              <span className="muted">{o.no}.</span><span className="ot">{o.text}</span>
              <div className="ob"><i style={{ width: `${o.pct || 0}%` }} /><b style={{ left: `${o.pct_national || 0}%` }} /></div>
              <span className="ov">{fmt(o.pct, 1)}%<small>ปท. {fmt(o.pct_national, 1)}%</small></span>
            </div>))}
          <div className="cell-sub">แท่ง = สัดส่วนในพื้นที่นี้ · เส้นดำ = ทั้งประเทศ{opts.data.multi ? ' · ข้อนี้มีหลายรายการย่อย/เลือกได้หลายข้อ นับทุกรายการ' : ''}</div>
        </div>)}
    </div>
  )
}

function OrgDossier({ d, nat, scope, meta, onOpen, onBack }) {
  if (!d) return <Card className="panel" loading />
  const gaps = (d.answers || []).filter((a) => a.score != null && a.score < a.max)
  return (
    <Card className="panel dossier" styles={{ body: { padding: 16, display: 'flex', flexDirection: 'column', gap: 14 } }}>
      <div className="lao-hd">
        <div>
          <div className="eyebrow">แฟ้มข้อมูล อปท.</div>
          <Typography.Title level={4} style={{ margin: 0 }}>{d.name}</Typography.Title>
          <div className="cell-sub">{d.org_type} · อ.{d.district} จ.{d.province} · รหัส {d.code}</div>
        </div>
        <div className="big">{fmt(d.total)}<div><GradePill g={d.grade} bands={meta.grade_bands} /></div></div>
      </div>
      {!d.submitted ? <Empty description="ไม่ได้ส่งแบบประเมินในปีนี้" /> : (<>
        <div className="stats3">
          <div><b>{fmt(d.fin50, 1)}</b><span>FA / 50</span></div>
          <div><b>{fmt(d.q40, 1)}</b><span>CSA / 40 ({fmt(d.q_pct, 1)}%)</span></div>
          <div><b>{fmt(d.lpa10, 2)}</b><span>LPA / 10</span></div>
        </div>
        <div className="cell-sub">อันดับ {d.rank_province} จาก {d.n_province} แห่งในจังหวัด · ดีกว่า อปท. ทั่วประเทศ {fmt(d.percentile_national, 1)}%</div>
        <div><div className="sub-h">FFDA 4 ด้าน (เทียบค่าเฉลี่ยจังหวัด)</div><PartBars parts={d.parts} refParts={d.compare?.province?.parts} refLabel="จังหวัด" /></div>
        <div>
          <div className="sub-h">ข้อที่ได้ไม่เต็ม ({gaps.length} ข้อ)</div>
          <div className="ans">
            {gaps.map((a) => (
              <div key={a.q} className="ar">
                <span className="muted">{a.q}</span>
                <div><span style={{ color: PART_COLORS[a.part] }}>■</span> {a.short}<div className="cell-sub">{a.text}</div></div>
                <span className={`ap ${a.score === 0 ? 'rz' : 'rp'}`}>{fmt(a.score, 1)}/{a.max}</span>
              </div>))}
          </div>
        </div>
      </>)}
      <Space><Button onClick={onBack}>← กลับ</Button><Button type="primary" icon={<ExportOutlined />} onClick={onOpen}>เปิดรายงานฉบับเต็ม</Button></Space>
    </Card>
  )
}

function ItemsMatrix({ level, scopeF, part, onRow, tq, setTq }) {
  const lvl = level === 'org' ? 'org' : level
  const { data, loading } = useFetch('/api/questions/matrix', { ...scopeF, level: lvl, part })
  const rows = (data?.rows || []).filter((r) => !tq || String(r.label).includes(tq))
  const qs = data?.questions || []
  const cls = (v, n) => (v == null ? 'rn' : level === 'org' ? (v >= 99.9 ? 'rf' : v <= 0.1 ? 'rz' : 'rp') : null)
  return (
    <Card className="panel" style={{ marginTop: 16 }} title={`ตารางรายข้อ ด้านที่ ${part} ${PART_SHORT[part]} × ${level === 'org' ? 'อปท.' : level === 'amp' ? 'อำเภอ' : 'จังหวัด'}`}
      extra={<Input allowClear size="small" prefix={<SearchOutlined />} placeholder="กรองชื่อ" value={tq} onChange={(e) => setTq(e.target.value)} style={{ width: 200 }} />}>
      <Table size="small" rowKey="key" loading={loading} dataSource={rows} pagination={{ pageSize: 15, size: 'small' }} scroll={{ x: 300 + qs.length * 64 }}
        onRow={(r) => ({ className: 'click', onClick: () => onRow(r) })}
        columns={[
          { title: 'พื้นที่ / อปท.', dataIndex: 'label', fixed: 'left', width: 220, sorter: (a, b) => String(a.label).localeCompare(String(b.label), 'th') },
          ...qs.map((q) => ({
            title: <Tooltip title={`ข้อ ${q.q} ${q.short} · ประเทศ ${fmt(data.national[q.q], 0)}%`}>ข้อ {q.q}</Tooltip>, width: 64, align: 'center',
            sorter: (a, b) => (a.values[q.q] ?? -1) - (b.values[q.q] ?? -1),
            onCell: (r) => {
              const v = r.values[q.q]; const n = data.national[q.q]
              if (level === 'org') return { className: cls(v) }
              return { style: v == null ? {} : cellStyle((v - n) / 10) }
            },
            render: (_, r) => (r.values[q.q] == null ? <span className="muted">NA</span> : fmt(r.values[q.q], 0)),
          })),
        ]} />
      <div className="note">{level === 'org' ? 'สีเขียวอ่อน = ได้คะแนนเต็ม, เทา = ได้บางส่วน, แดง = ได้ 0, NA = ไม่เข้าเงื่อนไข' : 'ค่า = คะแนนเฉลี่ยเป็น % ของคะแนนเต็มข้อนั้น · สี = ผลต่างจากค่าเฉลี่ยประเทศ (ทุก 10 จุด = 1 ขั้นสี)'}</div>
    </Card>
  )
}

function DivergeLegend() {
  const labels = ['ต่ำกว่ามาก', '', 'ต่ำกว่า', 'ใกล้เคียง', 'สูงกว่า', '', 'สูงกว่ามาก']
  const cols = ['#b32b2b', '#e66767', '#f7c4c3', '#f0efec', '#b7d3f6', '#5598e7', '#1c5cab']
  return <div className="legend-row" style={{ marginTop: 8 }}>{cols.map((c, i) => <span key={c}><i style={{ background: c }} />{labels[i]}</span>)}<span className="muted">· เทียบค่าเฉลี่ยประเทศ หน่วยเป็นส่วนเบี่ยงเบนมาตรฐาน</span></div>
}
