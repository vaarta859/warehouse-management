
import { useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";

import {
  Activity,
  FileWarning,
  PackageMinus,
  PackagePlus,
  Warehouse,
} from "lucide-react";

import {
  fetchInwardList,
  selectInwardList,
} from "../features/inward/inwardSlice";

import {
  fetchOutwardList,
  selectOutwardList,
} from "../features/outward/outwardSlice";

import {
  fetchWarehouses,
  selectWarehouses,
  selectSelectedWarehouse,
} from "../features/warehouse/warehouseSlice";

import {
  fetchCompanies,
  selectAllCompanies,
} from "../features/company/companySlice";

// =====================================================
// HELPERS
// =====================================================

const today = (value) => {
  if (!value) return false;

  const date = new Date(value);
  const now = new Date();

  return (
    date.toDateString() === now.toDateString()
  );
};

// =====================================================
// DASHBOARD
// =====================================================

export default function Dashboard() {
  const dispatch = useDispatch();

  // ===================================================
  // REDUX DATA
  // ===================================================

  const inward = useSelector(selectInwardList);
  const outward = useSelector(selectOutwardList);
  const warehouses = useSelector(selectWarehouses);
  const companies = useSelector(selectAllCompanies);
  const selectedWarehouse = useSelector(selectSelectedWarehouse);

  const user = useSelector(
    (state) => state.auth.user
  );

  // Warehouse managers see only the warehouse they've switched to
  // in the navbar. Admins keep seeing everything within their
  // existing access (company / all companies).
  const scopedWarehouseId =
    user?.role === "WAREHOUSE_MANAGER" ? selectedWarehouse?.id : undefined;

  // ===================================================
  // FETCH DATA
  // ===================================================

  useEffect(() => {
    dispatch(fetchInwardList({ warehouseId: scopedWarehouseId }));
    dispatch(fetchOutwardList({ warehouseId: scopedWarehouseId }));

    dispatch(
      fetchWarehouses({
        search: "",
      })
    );

    // Used only as fallback for company name. /api/companies is
    // Super Admin only, so managers skip the (always-403) request.
    if (user?.role === "SUPER_ADMIN") dispatch(fetchCompanies());
  }, [dispatch, user?.companyId, user?.role, scopedWarehouseId]);

  // ===================================================
  // COMPANY NAME
  // ===================================================
  //
  // Priority:
  //
  // 1. user.company.name
  // 2. warehouse.company.name
  // 3. company list using companyId
  // 4. Super Admin scope
  //
  // Your Warehouse Management already receives:
  //
  // warehouse.company.name
  //
  // so this works even when /api/companies does not
  // return anything useful for the current user.
  // ===================================================

  const companyName = useMemo(() => {
    // -------------------------------------------------
    // 0. User belongs to several companies - list them all
    // -------------------------------------------------

    if (user?.companies?.length > 1) {
      return user.companies.map((company) => company.name).join(", ");
    }

    // -------------------------------------------------
    // 1. Direct company relation on logged-in user
    // -------------------------------------------------

    if (user?.company?.name) {
      return user.company.name;
    }

    // -------------------------------------------------
    // 2. Find company from warehouse relation
    // -------------------------------------------------

    if (user?.companyId) {
      const warehouseWithCompany =
        warehouses.find(
          (warehouse) =>
            warehouse.companyId ===
              user.companyId &&
            warehouse.company?.name
        );

      if (
        warehouseWithCompany?.company?.name
      ) {
        return warehouseWithCompany.company.name;
      }
    }

    // -------------------------------------------------
    // 3. Fallback to company Redux list
    // -------------------------------------------------

    if (user?.companyId) {
      const company = companies.find(
        (item) =>
          item.id === user.companyId
      );

      if (company?.name) {
        return company.name;
      }
    }

    // -------------------------------------------------
    // 4. Super admin
    // -------------------------------------------------

    if (
      user?.role === "SUPER_ADMIN" &&
      !user?.companyId
    ) {
      return "Super Admin scope";
    }

    return user?.companyId
      ? "Company not found"
      : "Super Admin scope";
  }, [
    user,
    warehouses,
    companies,
  ]);

  // ===================================================
  // EFFECTIVE INWARD PERMISSION
  // ===================================================
  //
  // Stored permission is not removed when company or
  // warehouse becomes inactive.
  //
  // The backend can return:
  //
  // effectiveCanInward
  //
  // If backend doesn't return it yet, we fall back to
  // canInward.
  // ===================================================

  const canInward = useMemo(() => {
    // Sales and Account can only view inward - never create it.
    if (
      user?.role === "SALES" ||
      user?.role === "ACCOUNT"
    ) {
      return false;
    }

    // Super admin keeps normal access.
    if (
      user?.role !==
      "WAREHOUSE_MANAGER"
    ) {
      return true;
    }

    return (
      user?.warehouseAccess || []
    ).some((access) => {
      if (
        typeof access.effectiveCanInward ===
        "boolean"
      ) {
        return access.effectiveCanInward;
      }

      return !!access.canInward;
    });
  }, [user]);

  // ===================================================
  // EFFECTIVE OUTWARD PERMISSION
  // ===================================================

  const canOutward = useMemo(() => {
    if (
      user?.role !==
      "WAREHOUSE_MANAGER"
    ) {
      return true;
    }

    return (
      user?.warehouseAccess || []
    ).some((access) => {
      if (
        typeof access.effectiveCanOutward ===
        "boolean"
      ) {
        return access.effectiveCanOutward;
      }

      return !!access.canOutward;
    });
  }, [user]);

  // ===================================================
  // DASHBOARD STATS
  // ===================================================

  const stats = useMemo(
    () => ({
      warehouses: warehouses.length,

      todayInward: inward.filter(
        (item) =>
          today(item.createdAt)
      ).length,

      todayOutward: outward.filter(
        (item) =>
          today(item.createdAt)
      ).length,

      pending:
        inward.filter(
          (item) =>
            item.status !== "Complete"
        ).length +
        outward.filter(
          (item) =>
            item.status !== "Complete"
        ).length,
    }),
    [
      warehouses,
      inward,
      outward,
    ]
  );

  // ===================================================
  // RECENT ACTIVITY
  // ===================================================

  const activity = useMemo(() => {
    const inwardActivity =
      inward
        .slice(0, 3)
        .map((item) => ({
          date: item.createdAt,

          text: `${
            item.grnNumber || "GRN"
          } received`,
        }));

    const outwardActivity =
      outward
        .slice(0, 3)
        .map((item) => ({
          date: item.createdAt,

          text: `${
            item.outwardNumber || "MIN"
          } dispatched`,
        }));

    return [
      ...inwardActivity,
      ...outwardActivity,
    ]
      .filter(
        (item) => item.date
      )
      .sort(
        (a, b) =>
          new Date(b.date) -
          new Date(a.date)
      )
      .slice(0, 6);
  }, [inward, outward]);

  // ===================================================
  // RENDER
  // ===================================================

  return (
    <div className="min-h-dvh bg-[#F1EFE8] p-4 sm:p-6">
      {/* =================================================
          HEADER
      ================================================= */}

      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900 sm:text-2xl">
          Dashboard
        </h1>

        <p className="text-xs text-gray-500 mt-0.5 sm:text-sm sm:mt-1">
          Live overview of the warehouses and
          stock movements available to your
          account.
        </p>
      </div>

      {/* =================================================
          STATS
      ================================================= */}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <Stat
          icon={Warehouse}
          label="Accessible warehouses"
          value={stats.warehouses}
        />

        <Stat
          icon={PackagePlus}
          label="Today's inward"
          value={stats.todayInward}
        />

        <Stat
          icon={PackageMinus}
          label="Today's outward"
          value={stats.todayOutward}
        />

        <Stat
          icon={FileWarning}
          label="Pending documents"
          value={stats.pending}
        />
      </div>

      {/* =================================================
          QUICK ACTIONS
      ================================================= */}

      <div className="flex flex-wrap gap-3 mb-6">
        {canInward && (
          <Link
            to="/inward/create"
            className="rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 transition"
          >
            + New inward
          </Link>
        )}

        {canOutward && (
          <Link
            to="/outward/create"
            className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-600 transition"
          >
            + New outward
          </Link>
        )}
      </div>

      {/* =================================================
          MAIN CONTENT
      ================================================= */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* =================================================
            RECENT ACTIVITY
        ================================================= */}

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity
              size={18}
              className="text-blue-600"
            />

            <h2 className="text-sm font-semibold text-gray-900">
              Recent activity
            </h2>
          </div>

          {activity.length > 0 ? (
            <div className="space-y-3">
              {activity.map(
                (item, index) => (
                  <div
                    key={`${item.date}-${index}`}
                    className="flex items-center justify-between gap-3 border-b last:border-0 pb-3 last:pb-0"
                  >
                    <span className="text-sm text-gray-700">
                      {item.text}
                    </span>

                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {new Date(
                        item.date
                      ).toLocaleString(
                        "en-IN",
                        {
                          day: "numeric",
                          month: "short",
                          hour: "numeric",
                          minute:
                            "2-digit",
                        }
                      )}
                    </span>
                  </div>
                )
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              No activity yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================
// STAT COMPONENT
// =====================================================

function Stat({
  icon: Icon,
  label,
  value,
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {label}
        </p>

        <Icon
          size={17}
          className="text-blue-600"
        />
      </div>

      <p className="mt-2 text-2xl font-semibold text-gray-900">
        {value}
      </p>
    </div>
  );
}

// =====================================================
// INFO COMPONENT
// =====================================================

function Info({
  label,
  value,
}) {
  return (
    <div className="flex justify-between gap-4 border-b py-2 last:border-0">
      <span className="text-xs text-gray-500">
        {label}
      </span>

      <span className="text-xs font-medium text-gray-800 text-right break-all">
        {value || "-"}
      </span>
    </div>
  );
}



