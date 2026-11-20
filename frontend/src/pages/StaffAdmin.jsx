// หลังบ้าน: นำเข้าข้อมูล / ตั้งค่า / สิทธิ์ผู้ใช้ — เฉพาะ build ของเจ้าหน้าที่
import { Alert, Button, Col, Form, Input, InputNumber, Popconfirm, Row, Select, Space, Steps, Switch, Table, Tag, Upload, message } from 'antd'
import { DeleteOutlined, InboxOutlined, PlusOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useApp, useFetch } from '../store'
import { ErrorBox, PageHeader, Panel } from '../components/Common'
import { fmt, fmtInt } from '../theme'

// ---------------------------------------------------------------- นำเข้าข้อมูล (Excel รายปี)
export function ImportPage() {
  const { isAdmin, refresh } = useApp()
  const nav = useNavigate()
  const [year, setYear] = useState(2569)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState(null)
  const years = useFetch('/api/admin/years', null, [result])
  const imports = useFetch('/api/admin/imports', null, [result])

  const run = async (dry) => {
    setBusy(true); setErr(null); setResult(null)
    const f = new FormData()
    f.append('year', year); f.append('dry_run', dry); f.append('file', file)
    try { const r = await api.upload('/api/admin/import', f); setResult(r); if (!dry) refresh() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const act = async (y, a) => {
    const r = await api.post(`/api/admin/years/${y}/${a}`)
    const ps = r.public_sync
    if (ps?.status === 'success') message.success(`ส่งข้อมูลที่เผยแพร่ไปยังเว็บสาธารณะแล้ว (ปี ${ps.years.join(', ') || '-'})`)
    else if (ps?.status === 'failed') message.error(ps.message)
    setResult({ ...result }); refresh()
  }

  return (<>
    <PageHeader title="นำเข้าผลการประเมินรายปี" subtitle="อัปโหลดไฟล์ Excel ผลการประเมิน (รูปแบบเดียวกับไฟล์ survey_analyst) → ตรวจสอบ → นำเข้า → เผยแพร่" />
    {!isAdmin && <Alert type="info" showIcon message="เฉพาะผู้ดูแลระบบ (admin) เท่านั้นที่นำเข้าและเผยแพร่ข้อมูลได้" style={{ marginBottom: 16 }} />}
    <Steps size="small" style={{ marginBottom: 20 }} items={[{ title: 'อนุมัติโครงสร้างแบบประเมินของปี', description: <a onClick={() => nav('/questionnaire')}>เฉพาะปีใหม่</a> }, { title: 'ตรวจสอบไฟล์ (ไม่บันทึก)' }, { title: 'นำเข้า (สถานะร่าง)' }, { title: 'ตรวจทานบนแดชบอร์ด' }, { title: 'กดเผยแพร่' }]} />
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={10}>
        <Panel title="อัปโหลดไฟล์">
          <Form layout="vertical">
            <Form.Item label="ปีงบประมาณ (พ.ศ.)" extra="ปีใหม่ (เช่น 2570) ต้องอนุมัติ “โครงสร้างแบบประเมิน” ของปีนั้นก่อน · นำเข้าปีเดิมซ้ำ = แทนที่ข้อมูลทั้งปี">
              <InputNumber min={2560} max={2700} value={year} onChange={setYear} style={{ width: 160 }} />
            </Form.Item>
            <Upload.Dragger accept=".xlsx,.xlsm" maxCount={1} beforeUpload={(f) => { setFile(f); return false }} onRemove={() => setFile(null)} disabled={!isAdmin}>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p>ลากไฟล์ Excel มาวาง หรือคลิกเพื่อเลือก</p>
              <p className="ant-upload-hint">ระบบอ่านชีต “Analyst” และชีตรายชื่อ อปท. (ถ้ามี) อัตโนมัติ</p>
            </Upload.Dragger>
          </Form>
          <Space style={{ marginTop: 16 }}>
            <Button disabled={!file || !isAdmin} loading={busy} onClick={() => run(true)}>1) ตรวจสอบไฟล์</Button>
            <Popconfirm title={`นำเข้าข้อมูลปี ${year}?`} description="ถ้ามีข้อมูลปีนี้อยู่แล้ว จะถูกแทนที่ทั้งหมด" onConfirm={() => run(false)}>
              <Button type="primary" disabled={!file || !isAdmin} loading={busy}>2) นำเข้า</Button>
            </Popconfirm>
          </Space>
          <div style={{ marginTop: 16 }}>
            <ErrorBox error={err} />
            {err && err.includes('โครงสร้างแบบประเมิน') && <Button type="link" onClick={() => nav('/questionnaire')} style={{ paddingLeft: 0 }}>ไปที่หน้า “โครงสร้างแบบประเมิน” →</Button>}
            {result && <Alert type={result.status === 'success' ? 'success' : 'info'} showIcon
              message={result.status === 'dry_run' ? `ไฟล์ถูกต้อง: พบ ${fmtInt(result.valid_rows)} หน่วยงาน (ชีต ${result.sheet})` : `นำเข้าสำเร็จ ${fmtInt(result.imported_rows)} หน่วยงาน — สถานะ “ร่าง” ตรวจทานแล้วกดเผยแพร่`}
              description={<>
                {(result.warnings || []).map((w, i) => <div key={i}>• {w}</div>)}
                {result.n_questions && <div>• ใช้โครงสร้างแบบประเมินปี {year} ({result.n_questions} ข้อ)</div>}
              </>} />}
          </div>
        </Panel>
      </Col>
      <Col xs={24} lg={14}>
        <Panel title="ข้อมูลรายปีในระบบ" style={{ height: 'auto' }}>
          <Table size="small" rowKey="year" loading={years.loading} dataSource={years.data || []} pagination={false} columns={[
            { title: 'ปี', dataIndex: 'year', render: (v) => <b>{v}</b> },
            { title: 'จำนวน', dataIndex: 'n_records', align: 'right', render: fmtInt },
            { title: 'สถานะ', dataIndex: 'status', render: (v) => v === 'published' ? <Tag color="green">เผยแพร่แล้ว</Tag> : <Tag color="orange">ร่าง (เห็นเฉพาะ จนท.)</Tag> },
            { title: 'นำเข้าเมื่อ', dataIndex: 'imported_at', render: (v) => v?.replace('T', ' ') },
            { title: '', render: (r) => isAdmin && (r.status === 'published'
              ? <Button size="small" onClick={() => act(r.year, 'unpublish')}>ยกเลิกเผยแพร่</Button>
              : <Popconfirm title={`เผยแพร่ข้อมูลปี ${r.year} สู่โหมดภาพรวมและประชาชน?`} onConfirm={() => act(r.year, 'publish')}><Button size="small" type="primary">เผยแพร่</Button></Popconfirm>) },
          ]} />
        </Panel>
        <Panel title="ประวัติการนำเข้า" style={{ marginTop: 16, height: 'auto' }}>
          <Table size="small" rowKey="id" loading={imports.loading} dataSource={imports.data || []} pagination={{ pageSize: 5 }}
            expandable={{ expandedRowRender: (r) => (r.warnings || []).map((w, i) => <div key={i}>• {w}</div>), rowExpandable: (r) => r.warnings?.length }}
            columns={[{ title: 'เวลา', dataIndex: 'created_at', render: (v) => v.replace('T', ' ') }, { title: 'ปี', dataIndex: 'year' },
              { title: 'ไฟล์', dataIndex: 'filename', ellipsis: true }, { title: 'แถว', dataIndex: 'imported_rows', align: 'right', render: fmtInt },
              { title: 'ผล', dataIndex: 'status', render: (v) => <Tag color={v === 'success' ? 'green' : 'red'}>{v}</Tag> }, { title: 'โดย', dataIndex: 'created_by' }]} />
        </Panel>
      </Col>
    </Row>
  </>)
}

// ---------------------------------------------------------------- ตั้งค่า
export function SettingsPage() {
  const { isAdmin, refresh, meta } = useApp()
  const { data, loading } = useFetch('/api/admin/settings')
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)
  const users = useFetch(isAdmin ? '/api/admin/users' : null)
  const [nu, setNu] = useState({ role: 'officer' })
  useEffect(() => { if (data) setSt(data) }, [data])
  if (loading || !st) return null
  const save = async () => {
    setBusy(true)
    try { setSt(await api.put('/api/admin/settings', st)); message.success('บันทึกแล้ว และคำนวณระดับผลใหม่ทั้งหมด'); refresh() } catch (e) { message.error(e.message) } finally { setBusy(false) }
  }
  const band = (key, i, field, v) => setSt({ ...st, [key]: st[key].map((b, j) => (j === i ? { ...b, [field]: v } : b)) })
  return (<>
    <PageHeader title="ตั้งค่าระบบ" subtitle="เกณฑ์ต่าง ๆ เป็นค่าตั้งต้นสำหรับเสนอที่ประชุม — แก้ไขแล้วระบบคำนวณใหม่ทันที" extra={isAdmin && <Button type="primary" loading={busy} onClick={save}>บันทึกและคำนวณใหม่</Button>} />
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}><Panel title="เกณฑ์ระดับผลการประเมิน (คะแนนรวม และใช้จัดระดับรายด้าน)" hint="เรียงจากสูงไปต่ำ · ช่วงคะแนนของแต่ละระดับ = ตั้งแต่ค่านี้ ถึงก่อนระดับที่สูงกว่า">
        {[...st.grade_bands].map((b, i) => (
          <Space key={i} style={{ marginBottom: 8 }} wrap>
            <Input style={{ width: 150 }} value={b.label} onChange={(e) => band('grade_bands', i, 'label', e.target.value)} />
            ตั้งแต่ <InputNumber value={b.min} min={0} max={100} step={0.5} onChange={(v) => band('grade_bands', i, 'min', v)} />
            <span className="muted">ถึง {i === 0 ? 100 : fmt(st.grade_bands[i - 1].min - 0.01)}</span>
            <input type="color" value={b.color} onChange={(e) => band('grade_bands', i, 'color', e.target.value)} />
            <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={st.grade_bands.length <= 2}
              onClick={() => setSt({ ...st, grade_bands: st.grade_bands.filter((_, j) => j !== i) })} />
          </Space>))}
        <div><Button size="small" icon={<PlusOutlined />} onClick={() => setSt({ ...st, grade_bands: [...st.grade_bands, { min: 0, label: 'ระดับใหม่', color: '#8a96a5' }] })}>เพิ่มระดับ</Button>
          <Button size="small" type="link" onClick={() => setSt({ ...st, grade_bands: [...st.grade_bands].sort((a, b) => b.min - a.min) })}>เรียงลำดับ</Button></div>
        <div className="note">ค่าเริ่มต้นตามเกณฑ์โครงการ: ดีเยี่ยม 95–100 · ดีเด่น 85–94.99 · ดี 70–84.99 · พอใช้ 50–69.99 · ควรปรับปรุง &lt; 50</div>
      </Panel></Col>
      <Col xs={24} lg={12}><Panel title="การเปิดเผยข้อมูลต่อสาธารณะ">
        <Form layout="vertical">
          <Form.Item label="ปกปิดค่าเฉลี่ยของกลุ่มที่มีหน่วยงานน้อยกว่า (โหมดภาพรวม/ประชาชน)"><InputNumber min={1} value={st.min_group_size} onChange={(v) => setSt({ ...st, min_group_size: v })} /> แห่ง</Form.Item>
          <Form.Item label="ให้ประชาชนค้นหาดูผลของ อปท. รายแห่ง"><Switch checked={st.public_org_lookup} onChange={(v) => setSt({ ...st, public_org_lookup: v })} /></Form.Item>
        </Form>
      </Panel></Col>
      {isAdmin && <Col xs={24}><Panel title="สิทธิ์ผู้ใช้ (บัญชี AD — เข้าระบบด้วย SSO ไม่มีรหัสผ่านในระบบนี้)"
        hint="ทุกคนในโดเมนที่ผ่าน IIS ได้สิทธิ์ 'เจ้าหน้าที่' อัตโนมัติ (หรือเฉพาะกลุ่ม AD_USER_GROUP ถ้าตั้งไว้) · กำหนด 'ผู้ดูแลระบบ' ได้ที่นี่ หรือผ่านกลุ่ม AD_ADMIN_GROUP">
        <Space wrap style={{ marginBottom: 12 }}>
          <Input placeholder="บัญชี AD เช่น OAG\somchai.k" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} style={{ width: 240 }} />
          <Input placeholder="ชื่อ-สกุล" value={nu.full_name} onChange={(e) => setNu({ ...nu, full_name: e.target.value })} />
          <Select value={nu.role} onChange={(v) => setNu({ ...nu, role: v })} options={[{ value: 'officer', label: 'เจ้าหน้าที่ (ดูข้อมูล)' }, { value: 'admin', label: 'ผู้ดูแลระบบ' }]} style={{ width: 180 }} />
          <Button onClick={async () => { try { await api.post('/api/admin/users', nu); setNu({ role: 'officer' }); message.success('เพิ่มแล้ว'); refresh() } catch (e) { message.error(e.message) } }}>เพิ่ม/กำหนดสิทธิ์ล่วงหน้า</Button>
        </Space>
        <Table size="small" rowKey="id" dataSource={users.data || []} pagination={{ pageSize: 10 }} columns={[
          { title: 'บัญชี AD', dataIndex: 'username' }, { title: 'ชื่อ-สกุล', dataIndex: 'full_name' },
          { title: 'สิทธิ์', dataIndex: 'role', render: (v, r) => r.env_admin ? <Tag color="purple">ผู้ดูแลระบบ (.env)</Tag>
            : <Select size="small" value={v} style={{ width: 150 }} onChange={async (role) => { await api.patch(`/api/admin/users/${r.id}`, { role }); refresh() }}
                options={[{ value: 'officer', label: 'เจ้าหน้าที่' }, { value: 'admin', label: 'ผู้ดูแลระบบ' }]} /> },
          { title: 'อนุญาตใช้งาน', dataIndex: 'active', render: (v, r) => <Switch size="small" checked={v} onChange={async (c) => { await api.patch(`/api/admin/users/${r.id}`, { active: c }); refresh() }} /> },
        ]} />
      </Panel></Col>}
    </Row>
  </>)
}
