import { Alert, Breadcrumb, Card, Col, Row, Select, Space, Statistic, Tag, Tooltip, Typography } from 'antd'
import { HomeOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { useApp } from '../store'
import { BRAND, fmt, fmtInt } from '../theme'

export function PageHeader({ title, subtitle, extra }) {
  return (
    <div className="page-header">
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>{title}</Typography.Title>
        {subtitle && <div className="page-sub">{subtitle}</div>}
      </div>
      {extra && <Space wrap>{extra}</Space>}
    </div>
  )
}

export function Panel({ title, hint, extra, children, bodyStyle, ...rest }) {
  return (
    <Card
      title={title && <span>{title}{hint && <Tooltip title={hint}><InfoCircleOutlined style={{ marginLeft: 6, color: BRAND.muted, fontSize: 13 }} /></Tooltip>}</span>}
      extra={extra} className="panel" styles={{ body: { padding: 16, ...bodyStyle } }} {...rest}>
      {children}
    </Card>
  )
}

// แถวตัวเลขสำคัญ (KPI)
export function KpiRow({ items }) {
  return (
    <Row gutter={[16, 16]}>
      {items.filter(Boolean).map((it) => (
        <Col key={it.label} flex="1 1 210px">
          <Card className="kpi" styles={{ body: { padding: '14px 16px' } }}>
            <div className="kpi-label">{it.label}{it.hint && <Tooltip title={it.hint}><InfoCircleOutlined style={{ marginLeft: 4 }} /></Tooltip>}</div>
            <Statistic value={it.value ?? '–'} precision={it.precision ?? 0} suffix={it.suffix}
              valueStyle={{ fontSize: 26, fontWeight: 600, color: it.color || BRAND.text }}
              formatter={it.formatter} />
            {it.sub && <div className="kpi-sub">{it.sub}</div>}
          </Card>
        </Col>
      ))}
    </Row>
  )
}

export function Delta({ cur, prev, label }) {
  if (cur == null || prev == null) return null
  const d = cur - prev
  const color = d > 0 ? '#1b7f5b' : d < 0 ? '#c8423b' : BRAND.muted
  return <span style={{ color }}>{d > 0 ? '▲' : d < 0 ? '▼' : '■'} {fmt(Math.abs(d))} จาก{label}</span>
}

// แถบ drill-down: breadcrumb (ประเทศไทย > ภาค > จังหวัด > อำเภอ) + ตัวกรองประเภท อปท.
export function DrillBar({ showType = true, extra }) {
  const { meta, filters, drill, setFilters, year, setYear } = useApp()
  if (!meta) return null
  const provinces = meta.provinces.filter((p) => !filters.region || p.region === filters.region)
  const crumbs = [{ title: <a onClick={() => setFilters(filters.org_type ? { org_type: filters.org_type } : {})}><HomeOutlined /> ประเทศไทย</a> }]
  if (filters.region) crumbs.push({ title: <a onClick={() => drill({ region: filters.region, province: null })}>{filters.region}</a> })
  if (filters.province) crumbs.push({ title: <a onClick={() => drill({ province: filters.province, district: null })}>จ.{filters.province}</a> })
  if (filters.district) crumbs.push({ title: <span>อ.{filters.district}</span> })
  return (
    <div className="drillbar">
      <Breadcrumb items={crumbs} />
      <Space wrap size={8}>
        <Select size="middle" style={{ width: 120 }} value={year} onChange={setYear}
          options={meta.years.map((y) => ({ value: y, label: `ปี ${y}${meta.year_status?.[y] === 'draft' ? ' (ร่าง)' : ''}` }))} />
        <Select allowClear placeholder="ทุกภูมิภาค" style={{ width: 190 }} value={filters.region}
          onChange={(v) => drill({ region: v, province: null })} options={meta.regions.map((r) => ({ value: r, label: r }))} />
        <Select allowClear showSearch placeholder="ทุกจังหวัด" style={{ width: 170 }} value={filters.province}
          onChange={(v) => { const p = meta.provinces.find((x) => x.name === v); drill(v ? { region: p.region, province: v } : { province: null }) }}
          options={provinces.map((p) => ({ value: p.name, label: p.name }))} />
        {showType && <Select allowClear placeholder="ทุกประเภท อปท." style={{ width: 160 }} value={filters.org_type}
          onChange={(v) => drill({ org_type: v })} options={meta.org_types.map((t) => ({ value: t, label: t }))} />}
        {extra}
      </Space>
    </div>
  )
}

export function scopeLabel(f) {
  if (f.district) return `อำเภอ${f.district} จ.${f.province}`
  if (f.province) return `จังหวัด${f.province}`
  if (f.region) return f.region
  return 'ทั้งประเทศ'
}

export function GradeTag({ grade, bands }) {
  const b = bands?.find((x) => x.label === grade)
  return grade ? <Tag color={b?.color} style={{ marginInlineEnd: 0 }}>{grade}</Tag> : <Tag>–</Tag>
}

export function ErrorBox({ error }) {
  return error ? <Alert type="warning" showIcon message={error} style={{ marginBottom: 16 }} /> : null
}

export { fmt, fmtInt }
