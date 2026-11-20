// สถานะกลางของแอป: โหมด (overview/public/staff), ผู้ใช้, ปี, ข้อมูลอ้างอิง (meta), ตัวกรอง drill-down
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, setApiMode } from './api'

// เป้าหมายการ build: public (อินเทอร์เน็ต) | staff (intranet) | dev (เครื่องนักพัฒนา)
export const TARGET = import.meta.env.VITE_TARGET || 'dev'
const DEFAULT_MODE = TARGET === 'staff' ? 'staff' : 'overview'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

export function AppProvider({ children }) {
  const [mode, setModeState] = useState(() => {
    if (TARGET === 'staff') return 'staff'
    const m = sessionStorage.getItem('ffda_mode') || DEFAULT_MODE
    return TARGET === 'public' && m === 'staff' ? 'overview' : m
  })
  const [meta, setMeta] = useState(null)
  const [metaError, setMetaError] = useState(null)
  const [year, setYear] = useState(null)
  const [filters, setFilters] = useState({}) // {region, province, district, org_type}
  const [version, setVersion] = useState(0) // เพิ่มค่าเมื่อข้อมูลเปลี่ยน (นำเข้าใหม่) เพื่อโหลดซ้ำ

  setApiMode(mode)

  const loadMeta = useCallback(() => {
    setApiMode(mode)
    api.get('/api/meta').then((m) => {
      setMeta(m); setMetaError(null)
      setYear((y) => (y && m.years.includes(y) ? y : m.latest_year))
    }).catch((e) => {
      setMetaError(e.message)
    })
  }, [mode])

  useEffect(() => { loadMeta() }, [loadMeta, version])

  const setMode = (m) => {
    if (TARGET === 'staff' || (TARGET === 'public' && m === 'staff')) return
    sessionStorage.setItem('ffda_mode', m)
    setFilters({})
    setModeState(m)
  }
  // ผู้ใช้มาจาก SSO (เครื่อง staff) — ไม่มีการ login ในระบบนี้
  const user = meta && meta.username ? { username: meta.username, full_name: meta.full_name, role: meta.mode } : null

  // ตัวช่วย drill-down: เลือกระดับลึกลงไป / ย้อนขึ้นมา
  const drill = (patch) => setFilters((f) => {
    const order = ['region', 'province', 'district']
    const next = { ...f, ...patch }
    // ถ้าเปลี่ยนระดับบน ให้ล้างระดับล่าง
    for (const k of order) if (k in patch) { order.slice(order.indexOf(k) + 1).forEach((x) => { if (!(x in patch)) delete next[x] }) }
    Object.keys(next).forEach((k) => (next[k] == null || next[k] === '') && delete next[k])
    return next
  })

  const value = useMemo(() => ({
    mode, setMode, user, meta, metaError, year, setYear, filters, setFilters, drill, target: TARGET,
    isStaff: mode === 'staff' && (meta?.mode === 'officer' || meta?.mode === 'admin'), isAdmin: mode === 'staff' && meta?.mode === 'admin',
    refresh: () => setVersion((v) => v + 1), version,
  }), [mode, meta, metaError, year, filters, version])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// hook ดึงข้อมูลพร้อมสถานะ loading/error; โหลดใหม่เมื่อ deps เปลี่ยน
export function useFetch(path, params, deps = []) {
  const { mode, version } = useApp()
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const key = JSON.stringify([path, params, mode, version, ...deps])
  useEffect(() => {
    if (!path) { setState({ data: null, loading: false, error: null }); return }
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    api.get(path, params).then((d) => alive && setState({ data: d, loading: false, error: null }))
      .catch((e) => alive && setState({ data: null, loading: false, error: e.message }))
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}
