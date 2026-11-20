// สร้างมุมมองเอง (view builder), นำเข้าข้อมูล, ตั้งค่าระบบ
import { Alert, Button, Card, Col, Divider, Form, Input, InputNumber, List, Popconfirm, Row, Segmented, Select, Space, Steps, Switch, Table, Tag, Typography, Upload, message } from 'antd'
import { DeleteOutlined, InboxOutlined, SaveOutlined, TableOutlined, BarChartOutlined, LineChartOutlined, PieChartOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useApp, useFetch } from '../store'
import { DrillBar, ErrorBox, PageHeader, Panel } from '../components/Common'
import { GenericChart } from '../components/Charts'
import { fmt, fmtInt } from '../theme'

const DIM_LABEL = { region: 'ภูมิภาค', province: 'จังหวัด', district: 'อำเภอ', org_type: 'ประเภท อปท.', grade: 'ระดับผลประเมิน', risk_level: 'ระดับความเสี่ยง', cluster: 'กลุ่มลักษณะ', year: 'ปี', org: 'หน่วยงาน' }
const PRESETS = [
  { name: 'คะแนนเฉลี่ยภูมิภาค × ประเภท อปท.', config: { rows: 'region', cols: 'org_type', measure: 'avg_total', chart: 'bar' } },
  { name: 'อัตราการส่งแบบประเมินรายจังหวัด', config: { rows: 'province', measure: 'submission_rate', chart: 'hbar' } },
  { name: 'ด้านบัญชี/ตรวจสอบ รายภูมิภาค', config: { rows: 'region', measure: 'avg_p4', chart: 'bar' } },
  { name: 'จำนวน อปท. ตามระดับผล × ประเภท', config: { rows: 'org_type', cols: 'grade', measure: 'count', chart: 'bar' } },
]

// ---------------------------------------------------------------- View builder
export function ViewBuilderPage() {
  const { meta, year, filters, isStaff } = useApp()
  const [cfg, setCfg] = useState({ rows: 'region', cols: null, measure: 'avg_total', chart: 'bar' })
  const [saved, setSaved] = useState([])
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const { data, loading, error } = useFetch(year ? '/api/pivot' : null, { year, rows: cfg.rows, cols: cfg.cols, measure: cfg.measure, ...filters })

  const loadSaved = () => {
    if (isStaff) api.get('/api/views').then(setSaved).catch(() => {})
    else setSaved(JSON.parse(localStorage.getItem('ffda_views') || '[]'))
  }
  useEffect(loadSaved, [isStaff])
  if (!meta?.latest_year) return null

  const save = async () => {
    const view = { name: name || 'มุมมองของฉัน', config: { ...cfg, filters } }
    if (isStaff) await api.post('/api/views', { ...view, shared })
    else localStorage.setItem('ffda_views', JSON.stringify([{ id: Date.now(), mine: true, ...view }, ...saved]))
    message.success('บันทึกมุมมองแล้ว'); setName(''); loadSaved()
  }
  const remove = async (v) => {
    if (isStaff) await api.del(`/api/views/${v.id}`)
    else localStorage.setItem('ffda_views', JSON.stringify(saved.filter((x) => x.id !== v.id)))
    loadSaved()
  }
  const dimOpts = meta.dims.filter((d) => d !== 'org').map((d) => ({ value: d, label: DIM_LABEL[d] }))
  const rows = data?.rows || []
  const colKeys = data?.col_keys || []

  return (<>
    <PageHeader title="สร้างมุมมองของฉัน" subtitle="เลือกเองว่าจะดูอะไรเทียบกับอะไร แล้วบันทึกไว้ใช้ครั้งต่อไป" />
    <DrillBar />
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={7}>
        <Panel title="ตั้งค่ามุมมอง" style={{ height: 'auto' }}>
          <Form layout="vertical">
            <Form.Item label="ตัวชี้วัด (ดูอะไร)"><Select value={cfg.measure} onChange={(v) => setCfg({ ...cfg, measure: v })} options={Object.entries(meta.measures).map(([k, l]) => ({ value: k, label: l }))} /></Form.Item>
            <Form.Item label="แยกตาม (แกนหลัก)"><Select value={cfg.rows} onChange={(v) => setCfg({ ...cfg, rows: v, cols: cfg.cols === v ? null : cfg.cols })} options={dimOpts} /></Form.Item>
            <Form.Item label="เทียบกับ (แยกสี — ไม่บังคับ)"><Select allowClear value={cfg.cols} onChange={(v) => setCfg({ ...cfg, cols: v || null })} options={dimOpts.filter((d) => d.value !== cfg.rows)} placeholder="ไม่เทียบ" /></Form.Item>
            <Form.Item label="รูปแบบการแสดงผล">
              <Select value={cfg.chart} onChange={(v) => setCfg({ ...cfg, chart: v })} options={[
                { value: 'bar', label: <><BarChartOutlined /> กราฟแท่งแนวตั้ง</> }, { value: 'hbar', label: <><BarChartOutlined rotate={90} /> กราฟแท่งแนวนอน</> },
                { value: 'line', label: <><LineChartOutlined /> กราฟเส้น</> }, { value: 'pie', label: <><PieChartOutlined /> กราฟวงกลม</> }, { value: 'table', label: <><TableOutlined /> ตาราง</> }]} />
            </Form.Item>
          </Form>
          <Divider style={{ margin: '8px 0 16px' }} />
          <Space.Compact style={{ width: '100%' }}>
            <Input placeholder="ตั้งชื่อมุมมอง" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="primary" icon={<SaveOutlined />} onClick={save}>บันทึก</Button>
          </Space.Compact>
          {isStaff && <div style={{ marginTop: 8 }}><Switch size="small" checked={shared} onChange={setShared} /> แชร์ให้เจ้าหน้าที่คนอื่นเห็น</div>}
          {!isStaff && <div className="note">บันทึกไว้ในเบราว์เซอร์เครื่องนี้</div>}
        </Panel>
        <Panel title="มุมมองสำเร็จรูป / ที่บันทึกไว้" style={{ marginTop: 16, height: 'auto' }}>
          <List size="small" dataSource={[...PRESETS.filter((p) => meta.dims.includes(p.config.rows) && (!p.config.cols || meta.dims.includes(p.config.cols))).map((p) => ({ ...p, preset: true })), ...saved]}
            renderItem={(v) => (
              <List.Item actions={v.mine ? [<Popconfirm key="d" title="ลบมุมมองนี้?" onConfirm={() => remove(v)}><DeleteOutlined /></Popconfirm>] : []}>
                <a onClick={() => setCfg({ rows: v.config.rows, cols: v.config.cols || null, measure: v.config.measure, chart: v.config.chart || 'bar' })}>{v.name}</a>
                {v.preset && <Tag style={{ marginLeft: 6 }}>สำเร็จรูป</Tag>}{v.shared && <Tag color="blue" style={{ marginLeft: 6 }}>แชร์</Tag>}
              </List.Item>)} />
        </Panel>
      </Col>
      <Col xs={24} lg={17}>
        <Panel title={`${meta.measures[cfg.measure]} แยกตาม${DIM_LABEL[cfg.rows]}${cfg.cols ? ` × ${DIM_LABEL[cfg.cols]}` : ''}`}>
          <ErrorBox error={error} />
          {cfg.chart === 'table' ? (
            <Table size="small" loading={loading} rowKey="key" dataSource={rows} pagination={{ pageSize: 25 }} scroll={{ x: true }}
              columns={[{ title: DIM_LABEL[cfg.rows], dataIndex: 'label', fixed: 'left' }, { title: 'จำนวน', dataIndex: 'n', align: 'right', render: fmtInt },
                ...(colKeys.length ? colKeys : ['value']).map((k) => ({ title: k === 'value' ? data?.measure_label : k, align: 'right', render: (r) => fmt(r.values[k]), sorter: (a, b) => (a.values[k] ?? -1) - (b.values[k] ?? -1) }))]} />
          ) : (
            <GenericChart type={cfg.chart === 'hbar' ? 'bar' : cfg.chart} horizontal={cfg.chart === 'hbar'} rows={rows} colKeys={colKeys}
              measureLabel={data?.measure_label} height={cfg.chart === 'hbar' ? Math.max(380, rows.length * 22 + 60) : 460} />
          )}
          {cfg.chart === 'pie' && colKeys.length > 0 && <div className="note">กราฟวงกลมใช้ได้เมื่อไม่ได้เลือก “เทียบกับ”</div>}
        </Panel>
      </Col>
    </Row>
  </>)
}

