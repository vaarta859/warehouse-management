
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
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-200 flex-col shrink-0">
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
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                      active === key
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`}
                  >
                    <Icon size={18} />
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
              <div className="border-t border-gray-200 mb-3" />

              {/* One-line heading */}
              <div className="flex items-center gap-2 px-3 mb-2 whitespace-nowrap">
                <Settings size={16} className="text-gray-500 shrink-0" />

                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
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
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                            active === key
                              ? "bg-blue-50 text-blue-700"
                              : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                          }`}
                        >
                          <Icon size={18} />
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
        <div className="p-3 border-t border-gray-200">
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-red-600"
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
                    active === key ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-900"
                  }`}
                >
                  <Icon size={20} className="shrink-0" />
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
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 flex items-stretch"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {navItems.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setSettingsOpen(false); onNavigate(key); }}
            onTouchStart={() => prefetchRoute(key)}
            aria-label={label}
            className={`flex h-[3.75rem] flex-1 flex-col items-center justify-center gap-0.5 ${
              active === key && !settingsOpen ? "text-blue-700" : "text-gray-500"
            }`}
          >
            <Icon size={22} />
            <span className="text-[11px] font-medium leading-none">{label}</span>
          </button>
        ))}
        {showSystemConfiguration && (
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label="Settings"
            className={`flex h-[3.75rem] flex-1 flex-col items-center justify-center gap-0.5 ${
              settingsOpen || systemConfigItems.some((i) => i.key === active) ? "text-blue-700" : "text-gray-500"
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
