// รายงานผลรายหน่วยงาน — ประชาชนเห็น "บัตรรายงาน", เจ้าหน้าที่เห็นเพิ่ม: คำตอบและคะแนนรายข้อ
import { Alert, Button, Col, Descriptions, Row, Segmented, Space, Spin, Table, Tag } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp, useFetch } from '../store'
import { ErrorBox, GradeTag, PageHeader, Panel } from '../components/Common'
import { Chart, PartsBars, TrendLine } from '../components/Charts'
import { BRAND, PART_COLORS, PART_SHORT, baseChart, fmt } from '../theme'

const PART_EXPLAIN = {
  1: 'การจัดเก็บภาษีและรายได้ของท้องถิ่น เช่น แผนที่ภาษี การติดตามผู้ค้างชำระ นวัตกรรมการรับชำระ',
  2: 'การวางแผนงบประมาณ การเบิกจ่าย การยืมเงิน และการใช้ระบบอิเล็กทรอนิกส์ในการจ่ายเงิน',
  3: 'การจัดซื้อจัดจ้าง การทำสัญญา และการดูแลทรัพย์สิน/พัสดุของหน่วยงาน',
  4: 'การทำบัญชี การรายงานการเงิน การควบคุมภายในและการตรวจสอบภายใน',
}

function Gauge({ value }) {
  return <Chart height={200} option={{
    series: [{
      type: 'gauge', startAngle: 200, endAngle: -20, min: 0, max: 100, radius: '100%', center: ['50%', '62%'],
      progress: { show: true, width: 14, itemStyle: { color: BRAND.navy } },
      axisLine: { lineStyle: { width: 14, color: [[1, '#e9edf2']] } },
      axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false },
      detail: { valueAnimation: true, offsetCenter: [0, '-5%'], fontSize: 34, fontWeight: 700, color: BRAND.text, formatter: (v) => fmt(v) },
      title: { offsetCenter: [0, '30%'], fontSize: 13, color: BRAND.textSecondary },
      data: [{ value, name: 'คะแนนรวม (เต็ม 100)' }],
    }],
  }} />
}

export default function OrgReport() {
  const { code } = useParams()
  const nav = useNavigate()
  const { year, meta, isStaff } = useApp()
  const { data: d, loading, error } = useFetch(year ? `/api/orgs/${code}` : null, { year })
  const [cmp, setCmp] = useState('province')
  const [ansFilter, setAnsFilter] = useState('gap')

  if (loading && !d) return <Spin style={{ display: 'block', marginTop: 80 }} />
  if (error) return <ErrorBox error={error} />
  if (!d) return null
  const back = <Button icon={<ArrowLeftOutlined />} onClick={() => nav(-1)}>ย้อนกลับ</Button>
  if (!d.submitted) return (<><PageHeader title={d.name} subtitle={`อ.${d.district} จ.${d.province}`} extra={back} />
    <Alert type="info" showIcon message={`ไม่พบผลการประเมินของหน่วยงานนี้ในปี ${year}`} /></>)

  const cmpData = d.compare[cmp]
  const cmpLabel = { national: 'ค่าเฉลี่ยประเทศ', province: `ค่าเฉลี่ยจังหวัด${d.province}`, org_type: `ค่าเฉลี่ย${d.org_type}ทั่วประเทศ` }[cmp]
  const answers = (d.answers || []).filter((a) => ansFilter === 'all' || (a.score != null && a.score < a.max))

  return (
    <>
      <PageHeader title={d.name} subtitle={`${d.org_type} · อำเภอ${d.district} จังหวัด${d.province} · ${d.region} · รหัส ${d.code}`}
        extra={back} />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Panel title={`ผลการประเมินปี ${year}`}>
            <Gauge value={d.total} />
            <div style={{ textAlign: 'center', marginTop: -8 }}>ระดับ <GradeTag grade={d.grade} bands={meta.grade_bands} /></div>
            <Descriptions size="small" column={1} style={{ marginTop: 16 }} items={[
              { label: 'แบบประเมินตนเอง (40%)', children: <b>{fmt(d.q40)} <span className="muted">({fmt(d.q_pct)}%)</span></b> },
              { label: 'คะแนน LPA (10%)', children: <b>{fmt(d.lpa10)}</b> },
              { label: 'รายงานการเงิน (50%)', children: <b>{fmt(d.fin50)}</b> },
              { label: 'ดีกว่า อปท. ทั่วประเทศ', children: <b>{fmt(d.percentile_national, 1)}%</b> },
              { label: 'อันดับในจังหวัด', children: <b>{d.rank_province} จาก {d.n_province} แห่ง</b> },
            ]} />
          </Panel>
        </Col>
        <Col xs={24} lg={16}>
          <Panel title="คะแนนแบบประเมินรายด้าน เทียบกับกลุ่มอ้างอิง"
            extra={<Segmented size="small" value={cmp} onChange={setCmp} options={[{ value: 'province', label: 'จังหวัด' }, { value: 'org_type', label: 'ประเภทเดียวกัน' }, { value: 'national', label: 'ประเทศ' }]} />}>
            <PartsBars parts={d.parts} compare={cmpData.parts} compareLabel={cmpLabel} height={280} mainLabel={d.name} />
            <Row gutter={[12, 12]} style={{ marginTop: 8 }}>
              {[1, 2, 3, 4].map((k) => {
                const diff = (d.parts[k] ?? 0) - (cmpData.parts[k] ?? 0)
                return (
                  <Col xs={24} md={12} key={k}>
                    <div className="part-card" style={{ borderLeftColor: PART_COLORS[k] }}>
                      <div className="part-title">ด้าน{PART_SHORT[k]} <span style={{ float: 'right', color: diff >= 0 ? '#1b7f5b' : '#c8423b' }}>{diff >= 0 ? '+' : ''}{fmt(diff, 1)}</span></div>
                      <div className="cell-sub">{PART_EXPLAIN[k]}</div>
                    </div>
                  </Col>)
              })}
            </Row>
          </Panel>
        </Col>
        {d.history?.length > 0 && (
          <Col xs={24}><Panel title="ผลย้อนหลัง">
            <Space size="large" wrap>{d.history.map((h) => <div key={h.year} className="hist-pill"><div className="muted">ปี {h.year}</div><b style={{ fontSize: 20 }}>{fmt(h.total)}</b> <GradeTag grade={h.grade} bands={meta.grade_bands} /></div>)}</Space>
          </Panel></Col>)}

        {isStaff && (<>
          <Col xs={24}>
            <Panel title={`คำตอบและคะแนนรายข้อ (แบบประเมินปี ${year})`} hint="รหัสตัวชี้วัด (เช่น ACC-09) คงที่ทุกปี แม้เลขข้อจะเปลี่ยน" extra={<Segmented size="small" value={ansFilter} onChange={setAnsFilter} options={[{ value: 'gap', label: 'เฉพาะข้อที่ไม่เต็ม' }, { value: 'all', label: `ทั้งหมด ${(d.answers || []).length} ข้อ` }]} />}>
              <Table size="small" rowKey="q" dataSource={answers} pagination={{ pageSize: 12, size: 'small' }}
                expandable={{ expandedRowRender: (a) => <div style={{ whiteSpace: 'pre-wrap' }}>{a.text || '—'}</div>, rowExpandable: (a) => !!a.text }}
                columns={[
                  { title: 'ข้อ', dataIndex: 'q', width: 50 },
                  { title: 'รหัส', dataIndex: 'key', width: 80, render: (v) => <span className="mono">{v}</span> },
                  { title: 'ประเด็น', dataIndex: 'short', render: (v, a) => <><span style={{ color: PART_COLORS[a.part] }}>●</span> {v}</> },
                  { title: 'คะแนน', width: 90, align: 'right', render: (a) => a.score == null ? <Tag>ไม่เข้าเงื่อนไข</Tag> : <b style={{ color: a.score < a.max ? '#c8423b' : '#1b7f5b' }}>{fmt(a.score, 1)}/{a.max}</b> },
                  { title: 'ประเทศได้เต็ม', dataIndex: 'national_pass', width: 110, align: 'right', render: (v) => `${fmt(v, 0)}%` },
                ]} />
            </Panel>
          </Col>
        </>)}
      </Row>
      {!isStaff && <div className="note" style={{ marginTop: 16 }}>คะแนนรวม = แบบประเมินตนเอง 40% + คะแนน LPA 10% + การจัดทำรายงานการเงิน 50% · ข้อมูลคำตอบรายข้อเปิดเผยเฉพาะเจ้าหน้าที่</div>}
    </>
  )
}
