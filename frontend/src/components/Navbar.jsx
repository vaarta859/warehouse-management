import { useEffect, useState } from "react";
import {
  MapPin,
  Package,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  fetchWarehouses,
  selectWarehouses,
  selectSelectedWarehouse,
  setSelectedWarehouse,
} from "../features/warehouse/warehouseSlice";

function Navbar({ location = "Delhi Warehouse" }) {
  const [user, setUser] = useState(null);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const warehouses = useSelector(selectWarehouses);
  const selectedWarehouse = useSelector(selectSelectedWarehouse);

  const handleSignOut = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/", { replace: true });
  };

  useEffect(() => {
    dispatch(fetchWarehouses());
    const savedUser = localStorage.getItem("user");

    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (error) {
        console.error("Invalid user data:", error);
      }
    }
  }, [dispatch]);

  const userName = user?.name || "User";
  const userRole = user?.role || "";

  // Super admins see everything. Warehouse managers use the switcher
  // to focus the app on one of their assigned warehouses.
  const canSwitchWarehouse = userRole === "WAREHOUSE_MANAGER";

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="h-14 md:h-16 flex items-center justify-between gap-3 px-3 sm:px-6 shrink-0" style={{ paddingTop: "env(safe-area-inset-top)", background: "linear-gradient(100deg,#7C3AED 0%,#9333EA 55%,#C026D3 100%)" }}>

      {/* Logo */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
          <Package className="text-white" size={18} />
        </div>

        <span className="text-white font-bold text-base tracking-tight">
          InvTrack
        </span>
      </div>

      {/* Right side */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-5">

        {/* Warehouse switcher - warehouse managers only */}
        {canSwitchWarehouse && warehouses.length > 0 && (
          <div className="relative flex min-w-0 justify-end">
            <button
              type="button"
              onClick={() => warehouses.length > 1 && setWarehouseOpen((value) => !value)}
              className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-medium leading-none text-white hover:bg-white/25 disabled:cursor-default disabled:hover:bg-white/15 sm:text-sm"
              aria-label="Switch warehouse"
              disabled={warehouses.length <= 1}
            >
              <MapPin size={14} className="shrink-0" />
              <span className="truncate">{selectedWarehouse?.name || location}</span>
              {warehouses.length > 1 && <ChevronDown size={14} className="shrink-0" />}
            </button>

            {warehouseOpen && warehouses.length > 1 && (
              <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {warehouses.map((warehouse) => (
                  <button
                    key={warehouse.id}
                    type="button"
                    onClick={() => {
                      dispatch(setSelectedWarehouse(warehouse));
                      setWarehouseOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                      selectedWarehouse?.id === warehouse.id
                        ? "bg-purple-50 text-purple-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span>{warehouse.name}</span>
                    <span className="text-xs text-gray-400">{warehouse.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* User */}
        <div className="flex shrink-0 items-center gap-2">

          {/* Initials */}
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-purple-700 text-xs font-semibold">
            {initials}
          </div>

          {/* Name + Role */}
          <div className="hidden md:block leading-tight">
            <div className="text-white text-sm font-semibold">
              {userName}
            </div>

            <div className="text-white/75 text-xs">
              {userRole}
            </div>
          </div>

        </div>

        {/* Sign out - mobile only, sidebar handles it on desktop */}
        <button
          onClick={handleSignOut}
          aria-label="Sign out"
          className="md:hidden flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/90 hover:bg-white/15 hover:text-white"
        >
          <LogOut size={20} />
        </button>
      </div>
    </header>
  );
}

export default Navbar;