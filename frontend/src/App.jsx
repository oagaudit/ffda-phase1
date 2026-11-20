import { ConfigProvider, Layout, Menu, Segmented, Spin, Tag } from 'antd'
import thTH from 'antd/locale/th_TH'
import {
  AimOutlined, AppstoreOutlined, BarChartOutlined, CloudUploadOutlined, DashboardOutlined, EnvironmentOutlined,
  GlobalOutlined, OrderedListOutlined, SettingOutlined, UnorderedListOutlined, UserOutlined,
} from '@ant-design/icons'
import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { TARGET, useApp } from './store'
import { antdTheme } from './theme'
import { OverviewPage, PublicHome, QuestionsPage } from './pages/Pages'
import { ViewBuilderPage } from './pages/Admin'
import OrgReport from './pages/OrgReport'

// หน้าของเจ้าหน้าที่ถูกโหลดแบบแยกไฟล์ และ "ไม่ถูก build" เลยเมื่อ VITE_TARGET=public
const HAS_STAFF = TARGET !== 'public'
const Explorer = HAS_STAFF ? lazy(() => import('./pages/Explorer')) : null
const QuestionnairePage = HAS_STAFF ? lazy(() => import('./pages/Questionnaire')) : null
const staffPage = (name) => (HAS_STAFF ? lazy(() => import('./pages/StaffPages').then((m) => ({ default: m[name] }))) : null)
const adminPage = (name) => (HAS_STAFF ? lazy(() => import('./pages/StaffAdmin').then((m) => ({ default: m[name] }))) : null)
const StaffDashboardPage = staffPage('StaffDashboardPage')
const OrgListPage = staffPage('OrgListPage')
const ImportPage = adminPage('ImportPage')
const SettingsPage = adminPage('SettingsPage')

const MENUS = {
  overview: [
    { key: '/overview', icon: <GlobalOutlined />, label: 'ภาพรวมประเทศ' },
    { key: '/questions', icon: <BarChartOutlined />, label: 'วิเคราะห์รายข้อคำถาม' },
    { key: '/builder', icon: <AppstoreOutlined />, label: 'สร้างมุมมองของฉัน' },
  ],
  public: [
    { key: '/public', icon: <AimOutlined />, label: 'ค้นหา อปท. ของฉัน' },
    { key: '/overview', icon: <GlobalOutlined />, label: 'ภาพรวมประเทศ' },
    { key: '/builder', icon: <AppstoreOutlined />, label: 'สร้างมุมมองของฉัน' },
  ],
  staff: !HAS_STAFF ? [] : [
    { key: '/explore', icon: <EnvironmentOutlined />, label: 'สำรวจพื้นที่' },
    { key: '/staff', icon: <DashboardOutlined />, label: 'แดชบอร์ดสถิติ' },
    { key: '/orgs', icon: <UnorderedListOutlined />, label: 'รายหน่วยงาน' },
    { key: '/questions', icon: <BarChartOutlined />, label: 'วิเคราะห์รายข้อ' },
    { key: '/builder', icon: <AppstoreOutlined />, label: 'สร้างมุมมอง' },
    { type: 'divider' },
    { key: '/questionnaire', icon: <OrderedListOutlined />, label: 'โครงสร้างแบบประเมิน' },
    { key: '/import', icon: <CloudUploadOutlined />, label: 'นำเข้าข้อมูล' },
    { key: '/settings', icon: <SettingOutlined />, label: 'ตั้งค่า' },
  ],
}
const HOME = { overview: '/overview', public: '/public', staff: '/explore' }

// ตัวสลับโหมดตามเป้าหมายการติดตั้ง
const MODE_OPTIONS = {
  public: [{ value: 'overview', label: 'ภาพรวม', icon: <GlobalOutlined /> }, { value: 'public', label: 'ประชาชน', icon: <AimOutlined /> }],
  dev: [{ value: 'overview', label: 'ภาพรวม', icon: <GlobalOutlined /> }, { value: 'public', label: 'ประชาชน', icon: <AimOutlined /> },
    { value: 'staff', label: 'เจ้าหน้าที่ สตง.', icon: <UserOutlined /> }],
}

function StaffOnly({ children }) {
  const { isStaff } = useApp()
  if (!HAS_STAFF) return <Navigate to="/overview" replace />
  return isStaff ? <Suspense fallback={<Spin style={{ display: 'block', marginTop: 120 }} />}>{children}</Suspense> : <Navigate to="/overview" replace />
}

export default function App() {
  const { mode, setMode, user, meta, metaError } = useApp()
  const nav = useNavigate()
  const loc = useLocation()
  const switchMode = (m) => { setMode(m); nav(HOME[m]) }
  const selected = MENUS[mode].find((m) => m.key && loc.pathname.startsWith(m.key))?.key

  return (
    <ConfigProvider theme={antdTheme} locale={thTH}>
      <Layout style={{ minHeight: '100vh' }}>
        <Layout.Header className="topbar">
          <div className="brand" onClick={() => nav(HOME[mode])}>
            <div className="brand-mark">F</div>
            <div>
              <div className="brand-title">ระบบวิเคราะห์วินัยการเงินการคลัง อปท.{TARGET === 'staff' && <Tag color="gold" style={{ marginLeft: 8 }}>สำหรับเจ้าหน้าที่ สตง.</Tag>}</div>
              <div className="brand-sub">Fiscal Discipline Analytics · สำนักงานการตรวจเงินแผ่นดิน</div>
            </div>
          </div>
          <div className="topbar-right">
            {MODE_OPTIONS[TARGET] && <Segmented className="mode-switch" value={mode} onChange={switchMode} options={MODE_OPTIONS[TARGET]} />}
            {mode === 'staff' && user && (
              <span className="who"><UserOutlined /> {user.full_name || user.username}
                <span className="who-role">{user.role === 'admin' ? 'ผู้ดูแลระบบ' : 'เจ้าหน้าที่'}{TARGET === 'staff' ? ' · SSO' : ' · จำลอง'}</span></span>
            )}
          </div>
        </Layout.Header>
        <Layout>
          <Layout.Sider width={210} breakpoint="lg" collapsedWidth={0} className="sider">
            <Menu mode="inline" selectedKeys={[selected]} items={MENUS[mode]} onClick={(e) => nav(e.key)} style={{ borderInlineEnd: 0, paddingTop: 8 }} />
            <div className="sider-foot">
              {mode === 'overview' && 'โหมดภาพรวม: แสดงเฉพาะข้อมูลสรุป'}
              {mode === 'public' && 'โหมดประชาชน: ดูผลของท้องถิ่นตนเอง'}
              {mode === 'staff' && 'เครือข่ายภายใน สตง. · ข้อมูลรายหน่วยงานเป็นข้อมูลภายใน'}
            </div>
          </Layout.Sider>
          <Layout.Content className="content">
            {metaError && !meta ? <div className="error-page"><h2>เข้าใช้งานไม่ได้</h2><p>{metaError}</p></div>
              : !meta ? <Spin style={{ display: 'block', marginTop: 120 }} size="large" /> : (
              <Routes>
                <Route path="/" element={<Navigate to={HOME[mode]} replace />} />
                <Route path="/overview" element={<OverviewPage />} />
                <Route path="/public" element={<PublicHome />} />
                <Route path="/questions" element={<QuestionsPage />} />
                <Route path="/builder" element={<ViewBuilderPage />} />
                <Route path="/org/:code" element={<OrgReport />} />
                {HAS_STAFF && <>
                  <Route path="/explore" element={<StaffOnly><Explorer /></StaffOnly>} />
                  <Route path="/questionnaire" element={<StaffOnly><QuestionnairePage /></StaffOnly>} />
                  <Route path="/staff" element={<StaffOnly><StaffDashboardPage /></StaffOnly>} />
                  <Route path="/orgs" element={<StaffOnly><OrgListPage /></StaffOnly>} />
                  <Route path="/import" element={<StaffOnly><ImportPage /></StaffOnly>} />
                  <Route path="/settings" element={<StaffOnly><SettingsPage /></StaffOnly>} />
                </>}
                <Route path="*" element={<Navigate to={HOME[mode]} replace />} />
              </Routes>
            )}
            <div className="footer">ข้อมูลจากแบบประเมินวินัยการเงินการคลังขององค์กรปกครองส่วนท้องถิ่น · คะแนนรวม = รายงานการเงิน FA 50 + แบบประเมินตนเอง CSA 40 + LPA 10 · ขอบเขตพื้นที่: OpenGISData-Thailand (CC BY 4.0) · เวอร์ชัน 1.1.0 (19 พ.ย. 2569)</div>
          </Layout.Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  )
}
