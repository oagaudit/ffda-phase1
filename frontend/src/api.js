// ตัวเรียก API กลาง — ไม่มี token/รหัสผ่าน
//  - เครื่อง staff: IIS ยืนยันตัวตนด้วย SSO (Windows Authentication) ให้ก่อน เบราว์เซอร์ส่งข้อมูลประจำตัวเองอัตโนมัติ
//  - เครื่อง public/dev: ส่งโหมดการดู (overview/public[/staff เฉพาะ dev]) ใน header X-View-Mode
const BASE = import.meta.env.VITE_API_BASE || ''

let _mode = 'overview'
export const setApiMode = (m) => { _mode = m }

function headers(extra = {}) {
  return { ...extra, 'X-View-Mode': _mode }
}

export function qs(params = {}) {
  const p = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
  return p.length ? '?' + new URLSearchParams(p).toString() : ''
}

async function handle(res) {
  if (res.ok) return res.headers.get('content-type')?.includes('json') ? res.json() : res
  let msg = `เกิดข้อผิดพลาด (${res.status})`
  try { msg = (await res.json()).detail || msg } catch { /* ignore */ }
  const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  err.status = res.status
  throw err
}

const opts = (o = {}) => ({ credentials: 'include', ...o })

export const api = {
  get: (path, params) => fetch(BASE + path + qs(params), opts({ headers: headers() })).then(handle),
  post: (path, body) => fetch(BASE + path, opts({ method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body ?? {}) })).then(handle),
  put: (path, body) => fetch(BASE + path, opts({ method: 'PUT', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })).then(handle),
  patch: (path, body) => fetch(BASE + path, opts({ method: 'PATCH', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })).then(handle),
  del: (path) => fetch(BASE + path, opts({ method: 'DELETE', headers: headers() })).then(handle),
  upload: (path, form) => fetch(BASE + path, opts({ method: 'POST', headers: headers(), body: form })).then(handle),
  download: async (path, params, filename) => {
    const res = await fetch(BASE + path + qs(params), opts({ headers: headers() })).then(handle)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  },
}
