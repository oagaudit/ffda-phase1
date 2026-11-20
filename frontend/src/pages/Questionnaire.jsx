// โครงสร้างแบบประเมินรายปี — รองรับการเพิ่ม/ลด/แก้ไขข้อคำถามในปีถัดไป (เฉพาะ build ของเจ้าหน้าที่)
// ขั้นตอน: อัปโหลดไฟล์ปีใหม่ → ระบบเทียบกับปีก่อนและเสนอการจับคู่ → ผู้ดูแลตรวจ/แก้ → อนุมัติ → นำเข้าผลประเมิน
import { Alert, AutoComplete, Button, Card, Col, Empty, Form, Input, InputNumber, Popconfirm, Row, Select, Space, Statistic, Steps, Table, Tabs, Tag, Tooltip, Upload, message } from 'antd'
import { CheckCircleOutlined, EditOutlined, InboxOutlined, WarningFilled } from '@ant-design/icons'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useApp, useFetch } from '../store'
import { ErrorBox, PageHeader, Panel } from '../components/Common'
import { PART_COLORS, PART_SHORT, fmt } from '../theme'
import { CHANGE_TAG } from './Pages'

const CHANGE_OPTS = [
  { value: 'same', label: 'เหมือนเดิม' },
  { value: 'reworded', label: 'ปรับถ้อยคำ (เทียบได้)' },
  { value: 'changed', label: 'เปลี่ยนสาระ (เทียบไม่ได้)' },
  { value: 'new', label: 'ข้อใหม่' },
]
const COL_LABEL = { org_code: 'รหัส อปท.', name: 'ชื่อ อปท.', district: 'อำเภอ', province: 'จังหวัด', form_group: 'กลุ่มแบบประเมิน', p1: 'คะแนนด้าน 1', p2: 'คะแนนด้าน 2', p3: 'คะแนนด้าน 3', p4: 'คะแนนด้าน 4', q_pct: 'คะแนนแบบประเมิน %', lpa10: 'LPA', fin50: 'รายงานการเงิน', total: 'คะแนนรวม' }

const ChangeTag = ({ c }) => (!c || c === 'same' ? <span className="muted">เหมือนเดิม</span> : <Tag color={CHANGE_TAG[c]?.color} style={{ marginInlineEnd: 0 }}>{CHANGE_TAG[c]?.label}</Tag>)

// ---------------------------------------------------------------- ตารางเทียบข้อคำถามข้ามปี
function Crosswalk({ cw }) {
  if (!cw?.items?.length) return <Empty />
  const years = cw.years.map((y) => y.year)
  return (
    <Table size="small" rowKey="key" dataSource={cw.items} pagination={false} scroll={{ x: 640 + years.length * 120 }}
      columns={[
        { title: 'รหัสตัวชี้วัด', dataIndex: 'key', width: 100, fixed: 'left', render: (v) => <b className="mono">{v}</b> },
        { title: 'ด้าน', dataIndex: 'part', width: 170, filters: [1, 2, 3, 4].map((k) => ({ text: PART_SHORT[k], value: k })), onFilter: (v, r) => r.part === v,
          render: (k) => <span><span style={{ color: PART_COLORS[k] }}>■</span> {PART_SHORT[k]}</span> },
        { title: 'ประเด็น (ชื่อย่อล่าสุด)', dataIndex: 'short', ellipsis: true },
        ...years.map((y) => ({
          title: `ปี ${y}`, width: 120, align: 'center',
          render: (r) => { const c = r.years[y]; if (!c) return <span className="muted">–</span>
            if (c.change === 'removed') return <Tag style={{ marginInlineEnd: 0 }}>ยกเลิก</Tag>
            return <span>ข้อ <b>{c.q}</b> {c.change && c.change !== 'same' && <ChangeTag c={c.change} />}</span> },
        })),
      ]} />
  )
}

// ---------------------------------------------------------------- ตัวแก้ไขร่างโครงสร้าง
function Editor({ draft, setDraft, knownKeys, onSaved }) {
  const { isAdmin } = useApp()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [only, setOnly] = useState('changes')
  const def = draft.definition
  const qs = def.questions
  const setQ = (i, patch) => setDraft({ ...draft, definition: { ...def, questions: qs.map((q, j) => (j === i ? { ...q, ...patch } : q)) } })
  const setCol = (k, v) => setDraft({ ...draft, definition: { ...def, columns: { ...def.columns, [k]: v } }, missing_columns: Object.fromEntries(Object.entries(draft.missing_columns || {}).filter(([x]) => x !== k)) })
  const cnt = useMemo(() => qs.reduce((a, q) => ({ ...a, [q.change || 'same']: (a[q.change || 'same'] || 0) + 1 }), {}), [qs])
  const review = qs.filter((q) => q.needs_review).length
  const removed = draft.removed || draft.diff?.removed_items || []
  const rows = qs.map((q, i) => ({ ...q, _i: i })).filter((q) => only === 'all' || (q.change && q.change !== 'same') || q.needs_review)

  const save = async (approve) => {
    setBusy(true)
    try {
      await api.put(`/api/admin/questionnaires/${draft.year}`, { definition: def, base_year: draft.base_year, note: draft.note })
      if (approve) {
        await api.post(`/api/admin/questionnaires/${draft.year}/approve`)
        message.success(`อนุมัติโครงสร้างแบบประเมินปี ${draft.year} แล้ว — นำเข้าผลประเมินได้`)
      } else message.success('บันทึกร่างแล้ว')
      onSaved(approve)
    } catch (e) { message.error(e.message) } finally { setBusy(false) }
  }

  return (<>
    <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
      {[['same', 'เหมือนเดิม', '#1b7f5b'], ['reworded', 'ปรับถ้อยคำ', '#1d63c4'], ['changed', 'เปลี่ยนสาระ', '#d46b08'], ['new', 'ข้อใหม่', '#389e0d']].map(([k, l, c]) => (
        <Col key={k} xs={12} md={4}><Card size="small"><Statistic title={l} value={cnt[k] || 0} valueStyle={{ color: c }} /></Card></Col>))}
      <Col xs={12} md={4}><Card size="small"><Statistic title="ยกเลิก (มีในปีก่อน)" value={removed.length} /></Card></Col>
      <Col xs={12} md={4}><Card size="small"><Statistic title="ต้องตรวจ" value={review} valueStyle={{ color: review ? '#b42318' : undefined }} prefix={review ? <WarningFilled /> : <CheckCircleOutlined />} /></Card></Col>
    </Row>
    {Object.keys(draft.missing_columns || {}).length > 0 && (
      <Alert type="error" showIcon style={{ marginBottom: 12 }} message="ไม่พบคอลัมน์ข้อมูลหลักในไฟล์ — เลือกคอลัมน์ที่ตรงกัน (ชื่อคอลัมน์ในไฟล์ปีนี้อาจเปลี่ยน)"
        description={<Space direction="vertical" style={{ width: '100%' }}>{Object.entries(draft.missing_columns).map(([k, v]) => (
          <Space key={k} wrap><span style={{ width: 160, display: 'inline-block' }}>{COL_LABEL[k] || k} <span className="muted">(เดิม “{v}”)</span></span>
            <Select showSearch style={{ width: 360 }} placeholder="เลือกคอลัมน์ในไฟล์" onChange={(x) => setCol(k, x)} options={(draft.headers || []).map((h) => ({ value: h, label: h }))} /></Space>))}</Space>} />)}
    <Panel title={`ข้อคำถามปี ${draft.year} (${qs.length} ข้อ) — เทียบกับปี ${draft.base_year}`} style={{ height: 'auto' }}
      hint="ระบบจับคู่จากความคล้ายของข้อความคำถาม (ตัดเลขปี พ.ศ. ออกก่อนเทียบ) · รหัสตัวชี้วัดเดิม = เทียบแนวโน้มข้ามปีได้ · กดแถวเพื่อดูข้อความเต็มเทียบปีก่อน"
      extra={<Select size="small" value={only} onChange={setOnly} style={{ width: 210 }} options={[{ value: 'changes', label: 'เฉพาะข้อที่เปลี่ยน/ต้องตรวจ' }, { value: 'all', label: 'ทุกข้อ' }]} />}>
      {rows.length > 0 && <Table size="small" rowKey="_i" dataSource={rows} pagination={false} scroll={{ x: 1100 }}
        expandable={{ expandedRowRender: (q) => (
          <Row gutter={16}>
            <Col xs={24} md={12}><div className="sub-head">ปี {draft.year} · ข้อ {q.q}</div><div className="qtext">{q.text || '—'}</div>
              {q.text_g2 && <><div className="sub-head">ฉบับ อบจ.</div><div className="qtext">{q.text_g2}</div></>}
              <div className="cell-sub">คอลัมน์คะแนน: {q.col_g1}{q.col_g2 !== q.col_g1 ? ` / ${q.col_g2}` : ''}</div></Col>
            <Col xs={24} md={12}><div className="sub-head">ปี {draft.base_year} {q.base_q ? `· ข้อ ${q.base_q}` : ''}</div><div className="qtext">{q.base_text || <span className="muted">ไม่มี (ข้อใหม่)</span>}</div></Col>
          </Row>) }}
        columns={[
          { title: 'ข้อ', dataIndex: 'q', width: 52, render: (v, q) => <><b>{v}</b>{q.base_q && q.base_q !== v && <div className="cell-sub">เดิม {q.base_q}</div>}</> },
          { title: 'ด้าน', dataIndex: 'part', width: 100, render: (v, q) => <Select size="small" value={v} disabled={!isAdmin} style={{ width: 90 }} onChange={(x) => setQ(q._i, { part: x })} options={[1, 2, 3, 4].map((k) => ({ value: k, label: PART_SHORT[k] }))} /> },
          { title: 'รหัสตัวชี้วัด', dataIndex: 'key', width: 120, render: (v, q) => <AutoComplete size="small" value={v} disabled={!isAdmin} style={{ width: 105 }} onChange={(x) => setQ(q._i, { key: x.trim().toUpperCase() })} options={knownKeys.map((k) => ({ value: k }))} filterOption={(i, o) => o.value.includes(i.toUpperCase())} /> },
          { title: 'การเปลี่ยนแปลง', dataIndex: 'change', width: 190, render: (v, q) => <Select size="small" value={v} disabled={!isAdmin} style={{ width: 180 }} onChange={(x) => setQ(q._i, { change: x })} options={CHANGE_OPTS} /> },
          { title: 'ชื่อย่อ (แสดงบนแดชบอร์ด)', dataIndex: 'short', render: (v, q) => <Input size="small" value={v} disabled={!isAdmin} onChange={(e) => setQ(q._i, { short: e.target.value })} /> },
          { title: 'เต็ม (อบต./ทม.)', dataIndex: 'max_g1', width: 92, render: (v, q) => <InputNumber size="small" min={0} step={0.5} value={v} disabled={!isAdmin} style={{ width: 76 }} onChange={(x) => setQ(q._i, { max_g1: x })} /> },
          { title: 'เต็ม (อบจ.)', dataIndex: 'max_g2', width: 86, render: (v, q) => <InputNumber size="small" min={0} step={0.5} value={v} disabled={!isAdmin} style={{ width: 70 }} onChange={(x) => setQ(q._i, { max_g2: x })} /> },
          { title: 'คล้าย', dataIndex: 'similarity', width: 64, align: 'right', render: (v) => (v == null ? '–' : `${fmt(v * 100, 0)}%`) },
          { title: '', width: 36, render: (q) => q.needs_review && <Tooltip title={q.needs_review}><WarningFilled style={{ color: '#d46b08' }} /></Tooltip> },
        ]} />}
      {only === 'changes' && rows.length === 0 && <Alert type="success" showIcon message="ทุกข้อเหมือนปีก่อน — ตรวจคอลัมน์แล้วกดอนุมัติได้เลย" />}
    </Panel>
    {removed.length > 0 && <Panel title={`ข้อที่ถูกยกเลิก (มีในปี ${draft.base_year} แต่ไม่มีในปี ${draft.year})`} style={{ height: 'auto', marginTop: 16 }}
      hint="ข้อมูลปีก่อนของข้อเหล่านี้ยังอยู่ครบ แต่ไม่มีแนวโน้มต่อ · ถ้าจริง ๆ แล้วเป็นข้อเดิมที่ระบบจับคู่ไม่ได้ ให้แก้รหัสตัวชี้วัดของข้อปีนี้เป็นรหัสด้านล่าง">
      <Space wrap>{removed.map((r) => <Tag key={r.key}><b className="mono">{r.key}</b> เดิมข้อ {r.q} · {r.short}</Tag>)}</Space>
    </Panel>}
    <Form.Item label="หมายเหตุการเปลี่ยนแปลง (เช่น อ้างอิงมติที่ประชุม)" style={{ marginTop: 16 }}>
      <Input.TextArea rows={2} value={draft.note} disabled={!isAdmin} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="เช่น ตามมติคณะทำงานฯ ครั้งที่ 1/2570 ยกเลิกข้อการใช้รถส่วนกลาง และเพิ่มข้อการเผยแพร่รายงานการเงิน" />
    </Form.Item>
    {isAdmin && <Space>
      <Button loading={busy} onClick={() => save(false)}>บันทึกร่าง</Button>
      <Popconfirm title={`อนุมัติโครงสร้างแบบประเมินปี ${draft.year}?`} description={review ? `ยังมี ${review} ข้อที่ระบบแนะนำให้ตรวจ — ยืนยันว่าตรวจแล้ว` : 'หลังอนุมัติจึงนำเข้าผลประเมินปีนี้ได้'} onConfirm={() => save(true)}>
        <Button type="primary" loading={busy} disabled={Object.keys(draft.missing_columns || {}).length > 0}>อนุมัติ</Button></Popconfirm>
      <Button type="link" onClick={() => nav('/import')}>ไปหน้านำเข้าข้อมูล →</Button>
    </Space>}
  </>)
}

// ---------------------------------------------------------------- หน้าหลัก
export default function QuestionnairePage() {
  const { isAdmin, refresh } = useApp()
  const [tab, setTab] = useState('crosswalk')
  const [ver, setVer] = useState(0)
  const { data: cw } = useFetch('/api/questions/crosswalk', null, [ver])
  const { data: versions, loading } = useFetch('/api/admin/questionnaires', null, [ver])
  const [year, setYear] = useState(null)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [draft, setDraft] = useState(null)
  const knownKeys = useMemo(() => (cw?.items || []).map((i) => i.key), [cw])
  const nextYear = (versions?.[0]?.year || 2569) + 1

  const propose = async () => {
    setBusy(true); setErr(null)
    const f = new FormData(); f.append('year', year || nextYear); f.append('file', file)
    try { setDraft(await api.upload('/api/admin/questionnaires/propose', f)) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const edit = async (y) => { const d = await api.get(`/api/admin/questionnaires/${y}`); setDraft({ ...d, removed: d.diff?.removed_items }); setTab('prepare') }
  const act = async (y, a) => { try { a === 'delete' ? await api.del(`/api/admin/questionnaires/${y}`) : await api.post(`/api/admin/questionnaires/${y}/${a}`); setVer((v) => v + 1); refresh() } catch (e) { message.error(e.message) } }

  return (<>
    <PageHeader title="โครงสร้างแบบประเมินรายปี" subtitle="ข้อคำถามเปลี่ยนได้ทุกปี — ระบบผูกข้อเดียวกันข้ามปีด้วย “รหัสตัวชี้วัด” เพื่อให้แนวโน้มรายข้อถูกต้อง และต้องอนุมัติโครงสร้างก่อนนำเข้าผล" />
    <Steps size="small" style={{ marginBottom: 20 }} current={-1} items={[
      { title: 'อัปโหลดไฟล์ปีใหม่', description: 'ไฟล์ผลประเมินชุดแรกที่ได้รับ' }, { title: 'ระบบเทียบกับปีก่อน', description: 'จับคู่จากข้อความคำถาม' },
      { title: 'ตรวจ/แก้รายข้อ', description: 'รหัส · ชื่อย่อ · คะแนนเต็ม' }, { title: 'อนุมัติ', description: 'ผู้ดูแลระบบ' }, { title: 'นำเข้าผลประเมิน', description: 'เมนูนำเข้าข้อมูล' }]} />
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'crosswalk', label: 'ตารางเทียบข้อคำถามข้ามปี', children: (<Row gutter={[16, 16]}>
        <Col xs={24}><Panel title="ฉบับแบบประเมินในระบบ" style={{ height: 'auto' }}>
          <Table size="small" rowKey="year" loading={loading} dataSource={versions || []} pagination={false} columns={[
            { title: 'ปี', dataIndex: 'year', render: (v) => <b>{v}</b> },
            { title: 'สถานะ', dataIndex: 'status', render: (v) => (v === 'approved' ? <Tag color="green">อนุมัติแล้ว</Tag> : <Tag color="orange">ร่าง</Tag>) },
            { title: 'จำนวนข้อ', dataIndex: 'n_questions', align: 'right' },
            { title: 'เทียบกับปี', dataIndex: 'base_year', render: (v) => v || <span className="muted">ฉบับตั้งต้น</span> },
            { title: 'การเปลี่ยนแปลง', render: (r) => (r.diff ? <Space size={4} wrap>
              {r.diff.changed > 0 && <Tag color="orange">เปลี่ยนสาระ {r.diff.changed}</Tag>}{r.diff.reworded > 0 && <Tag color="blue">ปรับถ้อยคำ {r.diff.reworded}</Tag>}
              {r.diff.new > 0 && <Tag color="green">ข้อใหม่ {r.diff.new}</Tag>}{r.diff.removed > 0 && <Tag>ยกเลิก {r.diff.removed}</Tag>}
              {!r.diff.changed && !r.diff.reworded && !r.diff.new && !r.diff.removed && <span className="muted">ไม่เปลี่ยน</span>}</Space> : '–') },
            { title: 'อนุมัติโดย', render: (r) => (r.approved_by ? <span>{r.approved_by}<div className="cell-sub">{r.approved_at?.replace('T', ' ')}</div></span> : '–') },
            { title: 'ผลประเมิน', dataIndex: 'has_data', render: (v) => (v ? <Tag color="blue">นำเข้าแล้ว</Tag> : <span className="muted">ยังไม่นำเข้า</span>) },
            { title: 'หมายเหตุ', dataIndex: 'note', ellipsis: true },
            { title: '', render: (r) => isAdmin && <Space size={4}>
              {r.status === 'draft' && <Button size="small" icon={<EditOutlined />} onClick={() => edit(r.year)}>ตรวจ/แก้</Button>}
              {r.status === 'draft' && <Popconfirm title="ลบร่างนี้?" onConfirm={() => act(r.year, 'delete')}><Button size="small" danger>ลบ</Button></Popconfirm>}
              {r.status === 'approved' && r.base_year && !r.has_data && <Button size="small" onClick={() => act(r.year, 'unapprove')}>ยกเลิกอนุมัติ</Button>}
            </Space> },
          ]} />
        </Panel></Col>
        <Col xs={24}><Panel title="ตารางเทียบข้อคำถาม (crosswalk)" style={{ height: 'auto' }}
          hint="แต่ละแถว = 1 ตัวชี้วัด · ตัวเลข = เลขข้อในปีนั้น · ‘เปลี่ยนสาระ’ และ ‘ข้อใหม่’ = เริ่มเส้นแนวโน้มใหม่">
          <Crosswalk cw={cw} /></Panel></Col>
      </Row>) },
      { key: 'prepare', label: draft ? `ตรวจโครงสร้างปี ${draft.year}` : 'เตรียมแบบประเมินปีใหม่', disabled: !isAdmin, children: !draft ? (
        <Row gutter={16}><Col xs={24} lg={12}><Panel title="อัปโหลดไฟล์ผลประเมินของปีใหม่" style={{ height: 'auto' }}>
          <Form layout="vertical">
            <Form.Item label="ปีงบประมาณ (พ.ศ.)"><InputNumber min={2560} max={2700} value={year || nextYear} onChange={setYear} style={{ width: 160 }} /></Form.Item>
            <Upload.Dragger accept=".xlsx,.xlsm" maxCount={1} beforeUpload={(f) => { setFile(f); return false }} onRemove={() => setFile(null)}>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p><p>ลากไฟล์ Excel ปีใหม่มาวาง</p>
              <p className="ant-upload-hint">ระบบอ่านเฉพาะหัวคอลัมน์ (ข้อคำถาม/คอลัมน์คะแนน) ยังไม่บันทึกผลประเมิน</p>
            </Upload.Dragger>
          </Form>
          <Button type="primary" style={{ marginTop: 16 }} disabled={!file} loading={busy} onClick={propose}>เทียบกับแบบประเมินปีก่อน</Button>
          <div style={{ marginTop: 12 }}><ErrorBox error={err} /></div>
        </Panel></Col>
        <Col xs={24} lg={12}><Alert type="info" showIcon message="ระบบจัดการกรณีเหล่านี้ให้อัตโนมัติ" description={<ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>เลขข้อเลื่อน</b> (เช่น ยกเลิกข้อ 30 ทำให้ข้อ 31 เป็นข้อ 30) — จับคู่จากข้อความ จึงยังเป็นตัวชี้วัดเดิม</li>
          <li><b>เปลี่ยนปีงบประมาณในข้อความ</b> (2568 → 2569) — ไม่ถือว่าเปลี่ยน</li>
          <li><b>ข้อใหม่</b> — ได้รหัสใหม่อัตโนมัติ คะแนนเต็มตั้งต้นจากค่าสูงสุดในไฟล์ (ต้องยืนยัน)</li>
          <li><b>ข้อความต่างมาก</b> — เสนอเป็น “เปลี่ยนสาระ” ให้คนตัดสินว่าเป็นข้อเดิมหรือข้อใหม่</li>
          <li><b>ข้อที่หายไป</b> — แสดงเป็น “ยกเลิก” ข้อมูลปีก่อนยังอยู่ครบ</li>
          <li><b>ชื่อคอลัมน์หลักเปลี่ยน</b> — ให้เลือกคอลัมน์ที่ตรงกันก่อนอนุมัติ</li></ul>} /></Col></Row>
      ) : (<>
        <Space style={{ marginBottom: 12 }}><Button onClick={() => { setDraft(null); setFile(null) }}>← เริ่มใหม่</Button>{draft.sheet && <span className="muted">ไฟล์: ชีต {draft.sheet} · {draft.n_rows?.toLocaleString()} แถว</span>}</Space>
        <Editor draft={draft} setDraft={setDraft} knownKeys={knownKeys} onSaved={(approved) => { setVer((v) => v + 1); refresh(); if (approved) { setDraft(null); setFile(null); setTab('crosswalk') } }} />
      </>) },
    ]} />
  </>)
}
