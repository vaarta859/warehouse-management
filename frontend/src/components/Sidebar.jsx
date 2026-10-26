
import {
  Building2,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  PackageMinus,
  PackagePlus,
  Package,
  Users,
  Warehouse,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { prefetchRoute } from "../routes/lazyPages";

const BASE_ITEMS = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    key: "inward",
    label: "Inward",
    icon: PackagePlus,
  },
  {
    key: "outward",
    label: "Outward",
    icon: PackageMinus,
  },
  {
    key: "reports",
    label: "Reports",
    icon: FileBarChart,
  },
];

// Each menu item has its own colour: [active background, active text, icon colour when idle]
const TONES = {
  dashboard: ["#EEF2FF", "#4338CA", "#6366F1"],
  inward: ["#ECFDF5", "#047857", "#10B981"],
  outward: ["#FFFBEB", "#B45309", "#F59E0B"],
  reports: ["#F0F9FF", "#0369A1", "#0EA5E9"],
  companies: ["#FDF4FF", "#A21CAF", "#C026D3"],
  allusers: ["#FFF1F2", "#BE123C", "#F43F5E"],
  warehousemanagement: ["#F0FDFA", "#0F766E", "#14B8A6"],
  products: ["#F5F3FF", "#6D28D9", "#8B5CF6"],
};
const toneOf = (key) => TONES[key] || TONES.dashboard;

export default function Sidebar({
  active = "dashboard",
  onNavigate = () => {},
}) {
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);

  let user = null;

  try {
    user = JSON.parse(localStorage.getItem("user"));
  } catch {}

  const role = user?.role;

  // Sales and Account see dashboard, inward (view only), outward and reports.
  const navItems = BASE_ITEMS;

  // System Configuration items according to role
  const systemConfigItems =
    role === "SUPER_ADMIN"
      ? [
          {
            key: "companies",
            label: "Companies",
            icon: Building2,
          },
          {
            key: "allusers",
            label: "User Management",
            icon: Users,
          },
          {
            key: "warehousemanagement",
            label: "Warehouses",
            icon: Warehouse,
          },
          {
            key: "products",
            label: "Product Management",
            icon: Package,
          },
        ]
      : [];

  const showSystemConfiguration = systemConfigItems.length > 0;

  const signOut = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    navigate("/", {
      replace: true,
    });
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-56 flex-col shrink-0" style={{ background: "linear-gradient(180deg,#E9D5FF 0%,#F1E8FF 55%,#F7F0FF 100%)", borderRight: "1px solid #D8B4FE" }}>
        <nav className="flex-1 py-4 overflow-y-auto">

          {/* Main Navigation */}
          <ul className="space-y-1 px-3">
            {navItems.map(({ key, label, icon: Icon }) => {
              return (
                <li key={key}>
                  <button
                    onClick={() => onNavigate(key)}
                    onMouseEnter={() => prefetchRoute(key)}
                    onFocus={() => prefetchRoute(key)}
                    style={active === key ? { background: "#FFFFFF", color: toneOf(key)[1], boxShadow: "0 1px 3px rgba(126,34,206,0.18)" } : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                      active === key ? "shadow-sm" : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
                    }`}
                  >
                    <Icon size={18} style={{ color: active === key ? toneOf(key)[1] : toneOf(key)[2] }} />
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* System Configuration */}
          {showSystemConfiguration && (
            <div className="mt-6 px-3">
              {/* Separator line */}
              <div className="border-t border-purple-200 mb-3" />

              {/* One-line heading */}
              <div className="flex items-center gap-2 px-3 mb-2 whitespace-nowrap">
                <Settings size={16} className="text-purple-700/70 shrink-0" />

                <span className="text-xs font-semibold text-purple-700/70 uppercase tracking-wider">
                  System Configuration
                </span>
              </div>

              {/* Configuration Items */}
              <ul className="space-y-1">
                {systemConfigItems.map(
                  ({ key, label, icon: Icon }) => {
                    return (
                      <li key={key}>
                        <button
                          onClick={() => onNavigate(key)}
                          onMouseEnter={() => prefetchRoute(key)}
                          onFocus={() => prefetchRoute(key)}
                          style={active === key ? { background: "#FFFFFF", color: toneOf(key)[1], boxShadow: "0 1px 3px rgba(126,34,206,0.18)" } : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                      active === key ? "shadow-sm" : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
                    }`}
                  >
                    <Icon size={18} style={{ color: active === key ? toneOf(key)[1] : toneOf(key)[2] }} />
                          {label}
                        </button>
                      </li>
                    );
                  }
                )}
              </ul>
            </div>
          )}
        </nav>

        {/* Sign Out */}
        <div className="p-3 border-t border-purple-200">
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-white/70 hover:text-rose-600"
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Navigation
          Everyone: Dashboard / Inward / Outward / Reports.
          Super admin: a 5th "Settings" tab that opens a sheet with Users, Companies, Warehouses, Products. */}
      {settingsOpen && showSystemConfiguration && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setSettingsOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute left-0 right-0 rounded-t-2xl bg-white p-4 shadow-xl"
            style={{ bottom: "calc(3.75rem + env(safe-area-inset-bottom))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" />
            <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-gray-500">System Configuration</p>
            <div className="grid grid-cols-2 gap-3">
              {systemConfigItems.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setSettingsOpen(false); onNavigate(key); }}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-3.5 text-left text-sm font-semibold ${
                    active === key ? "border-transparent" : "border-gray-200 bg-white text-gray-900"
                  }`}
                  style={active === key ? { background: toneOf(key)[0], color: toneOf(key)[1] } : undefined}
                >
                  <Icon size={20} className="shrink-0" style={{ color: active === key ? toneOf(key)[1] : toneOf(key)[2] }} />
                  <span className="leading-tight">{label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={signOut}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 px-3 py-3 text-sm font-semibold text-red-600"
            >
              <LogOut size={18} /> Sign out
            </button>
          </div>
        </div>
      )}

      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t-2 border-violet-200 flex items-stretch"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {navItems.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setSettingsOpen(false); onNavigate(key); }}
            onTouchStart={() => prefetchRoute(key)}
            aria-label={label}
            style={active === key && !settingsOpen ? { color: toneOf(key)[1] } : undefined}
            className={`flex h-[3.75rem] flex-1 flex-col items-center justify-center gap-0.5 ${
              active === key && !settingsOpen ? "" : "text-gray-500"
            }`}
          >
            <span
              className="flex h-7 w-12 items-center justify-center rounded-full transition-colors"
              style={active === key && !settingsOpen ? { background: toneOf(key)[0] } : undefined}
            >
              <Icon size={21} />
            </span>
            <span className="text-[11px] font-medium leading-none">{label}</span>
          </button>
        ))}
        {showSystemConfiguration && (
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label="Settings"
            className={`flex h-[3.75rem] flex-1 flex-col items-center justify-center gap-0.5 ${
              settingsOpen || systemConfigItems.some((i) => i.key === active) ? "text-violet-700" : "text-gray-500"
            }`}
          >
            <Settings size={22} />
            <span className="text-[11px] font-medium leading-none">Settings</span>
          </button>
        )}
      </nav>
    </>
  );
}
