// หน้าสำหรับเจ้าหน้าที่ สตง. เท่านั้น — ไฟล์นี้ไม่ถูกรวมใน build ของเว็บสาธารณะ (VITE_TARGET=public)
import { Button, Card, Input, Select, Table } from 'antd'
import { DownloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useApp, useFetch } from '../store'
import { DrillBar, ErrorBox, GradeTag, PageHeader, scopeLabel } from '../components/Common'
import { Dashboard } from '../components/Widgets'
import { STAFF_DASHBOARD } from '../config/dashboards'
import { PART_COLORS, fmt, fmtInt } from '../theme'
import { NoData } from './Pages'

// ---------------------------------------------------------------- เจ้าหน้าที่: แดชบอร์ดหลัก
export function StaffDashboardPage() {
  const { meta, year, filters } = useApp()
  if (!meta?.latest_year) return <NoData />
  return (<>
    <PageHeader title="แดชบอร์ดเจ้าหน้าที่ สตง." subtitle={`ปี ${year} · ${scopeLabel(filters)} · คลิกแผนที่/กราฟเพื่อเจาะลึกจนถึงรายหน่วยงาน`} />
    <DrillBar />
    <Dashboard layout={STAFF_DASHBOARD} />
  </>)
}

// ---------------------------------------------------------------- เจ้าหน้าที่: รายชื่อหน่วยงานทั้งหมด
export function OrgListPage() {
  const { meta, year, filters } = useApp()
  const nav = useNavigate()
  const [search, setSearch] = useState('')
  const [grade, setGrade] = useState()
  const { data, loading, error } = useFetch(year ? '/api/breakdown' : null, { year, level: 'org', ...filters, grade })
  const rows = useMemo(() => (data?.rows || []).filter((r) => !search || `${r.name} ${r.district} ${r.org_code}`.includes(search)), [data, search])
  if (!meta?.latest_year) return <NoData />
  return (<>
    <PageHeader title="รายชื่อและผลการประเมินรายหน่วยงาน" subtitle={`${scopeLabel(filters)} · ${fmtInt(rows.length)} แห่ง`}
      extra={<Button icon={<DownloadOutlined />} onClick={() => api.download('/api/export.csv', { year, ...filters, grade }, `ffda_${year}.csv`)}>ส่งออก CSV (เปิดด้วย Excel)</Button>} />
    <DrillBar extra={<>
      <Select allowClear placeholder="ทุกระดับผล" style={{ width: 140 }} value={grade} onChange={setGrade} options={meta.grade_bands.map((b) => ({ value: b.label, label: b.label }))} />
      <Input allowClear prefix={<SearchOutlined />} placeholder="ค้นหาชื่อ/อำเภอ/รหัส" style={{ width: 220 }} value={search} onChange={(e) => setSearch(e.target.value)} />
    </>} />
    <ErrorBox error={error} />
    <Card styles={{ body: { padding: 0 } }}>
      <Table size="small" loading={loading} rowKey="org_code" dataSource={rows} scroll={{ x: 1000 }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${fmtInt(t)} แห่ง` }}
        onRow={(r) => ({ onClick: () => nav(`/org/${r.org_code}`), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'หน่วยงาน', dataIndex: 'name', fixed: 'left', width: 260, render: (v, r) => <><b>{v}</b><div className="cell-sub">{r.org_type} · อ.{r.district} จ.{r.province}</div></> },
          ...[1, 2, 3, 4].map((k) => ({ title: <span style={{ color: PART_COLORS[k] }}>{{ 1: 'รายได้', 2: 'รายจ่าย', 3: 'พัสดุ', 4: 'บัญชี' }[k]} %</span>, dataIndex: `p${k}_pct`, align: 'right', width: 85, sorter: (a, b) => a[`p${k}_pct`] - b[`p${k}_pct`], render: (v) => fmt(v, 1) })),
          { title: 'LPA', dataIndex: 'lpa10', align: 'right', width: 70, sorter: (a, b) => a.lpa10 - b.lpa10, render: (v) => fmt(v) },
          { title: 'รายงานฯ', dataIndex: 'fin50', align: 'right', width: 80, sorter: (a, b) => a.fin50 - b.fin50, render: (v) => fmt(v, 0) },
          { title: 'คะแนนรวม', dataIndex: 'total', align: 'right', width: 95, defaultSortOrder: 'ascend', sorter: (a, b) => a.total - b.total, render: (v) => <b>{fmt(v)}</b> },
          { title: 'ระดับ', dataIndex: 'grade', width: 110, render: (v) => <GradeTag grade={v} bands={meta.grade_bands} /> },
        ]} />
    </Card>
  </>)
}
