import { useEffect, useMemo, useState } from "react";
import CompanyMultiSelect from "../components/CompanyMultiSelect";
import { useSearchParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  Building2,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Users,
  Warehouse,
  X,
} from "lucide-react";

import {
  fetchWarehouses,
  createWarehouse,
  updateWarehouse,
  toggleInwardStatus,
  toggleOutwardStatus,
  deleteWarehouse,
  fetchWarehouseAccess,
  grantWarehouseAccess,
  revokeWarehouseAccess,
  selectWarehouses,
  selectWarehouseLoading,
  selectWarehouseError,
  selectWarehouseAccess,
  selectWarehouseAccessLoading,
} from "../features/warehouse/warehouseSlice";

import {
  getAllUsers,
  selectAllUsers,
} from "../features/auth/authSlice";

import {
  fetchCompanies,
  selectAllCompanies,
} from "../features/company/companySlice";

const EMPTY = {
  name: "",
  locality: "",
  city: "",
  state: "",
  pincode: "",
  companyIds: [],
};

const pincodeRegex = /^\d{6}$/;

const DEFAULT_PERMISSIONS = {
  canInward: true,
  canOutward: true,
  canManageDocuments: true,
};

export default function WarehouseManagement() {
  const dispatch = useDispatch();
  const [params] = useSearchParams();

  const queryCompanyId = params.get("companyId") || "";
  const queryCompanyName = params.get("companyName") || "";

  const currentUser = useSelector((state) => state.auth.user);

  const warehouses = useSelector(selectWarehouses);
  const users = useSelector(selectAllUsers);
  const companies = useSelector(selectAllCompanies);

  const loading = useSelector(selectWarehouseLoading);
  const error = useSelector(selectWarehouseError);

  const access = useSelector(selectWarehouseAccess);
  const accessLoading = useSelector(
    selectWarehouseAccessLoading,
  );

  const canManage = currentUser?.role === "SUPER_ADMIN";

  const isSuper = currentUser?.role === "SUPER_ADMIN";

  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");

  const [accessWarehouse, setAccessWarehouse] =
    useState(null);

  const [grantUser, setGrantUser] = useState("");

  const [permissions, setPermissions] = useState(
    DEFAULT_PERMISSIONS,
  );

  // Non-super users are scoped on the server by every company they belong to.
  const effectiveCompanyId = isSuper ? queryCompanyId || undefined : undefined;

  useEffect(() => {
    dispatch(
      fetchWarehouses({
        search: "",
        companyId: effectiveCompanyId,
      }),
    );
  }, [dispatch, effectiveCompanyId]);

  useEffect(() => {
    if (isSuper) {
      dispatch(fetchCompanies());
    }
  }, [dispatch, isSuper]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();

    return warehouses.filter((w) =>
      [
        w.name,
        w.code,
        w.locality,
        w.city,
        w.state,
        w.pincode,
        w.company?.name,
        ...(w.companies || []).map((c) => c.name),
      ].some((x) =>
        String(x || "")
          .toLowerCase()
          .includes(q),
      ),
    );
  }, [warehouses, search]);

  const openCreate = () => {
    setEditing(null);

    setForm({
      ...EMPTY,
      companyIds: effectiveCompanyId ? [effectiveCompanyId] : [],
    });

    setFormError("");
    setShowForm(true);
  };

  const openEdit = (warehouse) => {
    setEditing(warehouse);

    setForm({
      name: warehouse.name || "",
      locality: warehouse.locality || "",
      city: warehouse.city || "",
      state: warehouse.state || "",
      pincode: warehouse.pincode || "",
      companyIds: warehouse.companyIds?.length
        ? warehouse.companyIds
        : warehouse.companyId
          ? [warehouse.companyId]
          : [],
    });

    setFormError("");
    setShowForm(true);
  };

  const save = async (e) => {
    e.preventDefault();

    setFormError("");

    if (!form.name.trim()) {
      return setFormError(
        "Warehouse name is required.",
      );
    }

    if (!form.city.trim()) {
      return setFormError("City is required.");
    }

    if (!form.state.trim()) {
      return setFormError("State is required.");
    }

    if (!pincodeRegex.test(form.pincode.trim())) {
      return setFormError(
        "Enter a valid 6-digit pincode.",
      );
    }

    if (isSuper && !form.companyIds.length) {
      return setFormError(
        "Please select at least one company.",
      );
    }

    const payload = {
      name: form.name.trim(),
      locality: form.locality.trim() || undefined,
      city: form.city.trim(),
      state: form.state.trim(),
      pincode: form.pincode.trim(),
      ...(isSuper
        ? { companyIds: form.companyIds }
        : {}),
    };

    const result = editing
      ? await dispatch(
          updateWarehouse({
            id: editing.id,
            ...payload,
          }),
        )
      : await dispatch(createWarehouse(payload));

    if (
      (editing
        ? updateWarehouse
        : createWarehouse
      ).rejected.match(result)
    ) {
      setFormError(
        result.payload ||
          "Failed to save warehouse",
      );
      return;
    }

    setShowForm(false);
  };

  const remove = async (warehouse) => {
    if (!window.confirm(`Delete ${warehouse.name}?`)) {
      return;
    }

    const result = await dispatch(
      deleteWarehouse({
        id: warehouse.id,
      }),
    );

    if (deleteWarehouse.rejected.match(result)) {
      const message =
        result.payload?.message ||
        "Delete failed";

      if (
        result.payload?.status === 409 &&
        window.confirm(
          `${message}\n\nForce delete this warehouse and remove its access grants?`,
        )
      ) {
        await dispatch(
          deleteWarehouse({
            id: warehouse.id,
            force: true,
          }),
        );
      } else {
        alert(message);
      }
    }
  };

  const toggle = async (warehouse, type) => {
    /*
      IMPORTANT:

      If company is inactive, warehouse is temporarily
      inactive.

      We DON'T change the warehouse's original
      Inward/Outward value in the database.

      Example:

      Warehouse Inward = Active
      Company = Inactive

      Display = Inactive

      Company becomes Active again

      Display = Active
    */

    if (warehouse.company?.status === "Inactive") {
      return;
    }

    const thunk =
      type === "inward"
        ? toggleInwardStatus
        : toggleOutwardStatus;

    const result = await dispatch(
      thunk(warehouse.id),
    );

    if (thunk.rejected.match(result)) {
      alert(
        result.payload ||
          `Failed to update ${type} status`,
      );
      return;
    }

    // User grants are persistent. Turning a warehouse operation off
    // only blocks the operation; it must never revoke existing grants.
    // When the operation is enabled again, the same grants work automatically.
  };

  const openAccess = async (warehouse) => {
    setAccessWarehouse(warehouse);
    setGrantUser("");
    setPermissions(DEFAULT_PERMISSIONS);

    dispatch(
      fetchWarehouseAccess(warehouse.id),
    );

    dispatch(getAllUsers());
  };

  const handleGrantUserChange = (userId) => {
    setGrantUser(userId);

    const existing = access.find(
      (item) => item.user?.id === userId,
    );

    setPermissions(
      existing
        ? {
            canInward: !!existing.canInward,
            canOutward: !!existing.canOutward,
            canManageDocuments:
              !!existing.canManageDocuments,
          }
        : DEFAULT_PERMISSIONS,
    );
  };

  const grant = async (e) => {
    e.preventDefault();

    if (!grantUser) return;

    if (
      accessWarehouse?.company?.status === "Inactive" ||
      accessWarehouse?.Inward !== "Active" ||
      accessWarehouse?.Outward !== "Active"
    ) {
      alert("Access cannot be granted while the company or warehouse operation is inactive.");
      return;
    }

    const result = await dispatch(
      grantWarehouseAccess({
        warehouseId: accessWarehouse.id,
        userId: grantUser,
        ...permissions,
      }),
    );

    if (
      grantWarehouseAccess.rejected.match(result)
    ) {
      alert(
        result.payload ||
          "Failed to grant access",
      );
    } else {
      setGrantUser("");
    }
  };

  return (
    <div className="min-h-dvh bg-[#F1EFE8] p-4 sm:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 sm:text-2xl">
            Warehouses
          </h1>

          <p className="text-xs text-gray-500 mt-0.5 sm:text-sm sm:mt-1">
            {queryCompanyName
              ? `${queryCompanyName} • `
              : ""}
            Manage warehouse locations, inward/outward
            status and user access.
          </p>
        </div>

        {canManage && (
          <button
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus size={17} />
            Add Warehouse
          </button>
        )}
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {typeof error === "object"
            ? error.message
            : error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4">
        <div className="relative max-w-md">
          <SearchIcon />

          <input
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder="Search warehouse, code, city..."
            className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {loading && warehouses.length === 0 ? (
        <div className="py-16 text-center">
          <Loader2 className="mx-auto animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="mobile-cards w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left font-medium text-gray-500">
                  Warehouse
                </th>

                <th className="px-3 py-3 text-left font-medium text-gray-500">
                  Location
                </th>

                <th className="px-3 py-3 text-left font-medium text-gray-500">
                  Company
                </th>

                <th className="px-3 py-3 text-left font-medium text-gray-500">
                  Inward
                </th>

                <th className="px-3 py-3 text-left font-medium text-gray-500">
                  Outward
                </th>

                {canManage && (
                  <th className="px-3 py-3 text-right font-medium text-gray-500">
                    Actions
                  </th>
                )}
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100">
              {filtered.map((w) => {
                /*
                  Company status controls the EFFECTIVE
                  warehouse status.

                  We don't overwrite w.Inward/w.Outward.
                */
                const linkedCompanies = w.companies?.length
                  ? w.companies
                  : w.company
                    ? [w.company]
                    : [];
                // Off only when every linked company is inactive
                const companyInactive =
                  linkedCompanies.length > 0 &&
                  linkedCompanies.every((c) => c.status === "Inactive");

                const effectiveInward =
                  !companyInactive &&
                  w.Inward === "Active";

                const effectiveOutward =
                  !companyInactive &&
                  w.Outward === "Active";

                return (
                  <tr
                    key={w.id}
                    onClick={
                      !canManage
                        ? () =>
                            setAccessWarehouse(w)
                        : undefined
                    }
                    className={
                      !canManage
                        ? "cursor-pointer hover:bg-gray-50"
                        : "hover:bg-gray-50"
                    }
                  >
                    <td data-label="Warehouse" className="px-3 py-3 md:min-w-[200px]">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 shrink-0 rounded-lg bg-green-50 text-green-700 flex items-center justify-center">
                          <Warehouse size={17} />
                        </div>

                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                            {w.name}
                          </p>

                          <p className="text-xs text-gray-500">
                            {w.code}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td data-label="Location" className="mc-stack px-3 py-3 text-gray-600 md:min-w-[200px]">
                      <span className="flex items-start gap-1">
                        <MapPin
                          size={12}
                          className="shrink-0 text-gray-400"
                        />

                        {[w.locality, w.city, w.state]
                          .filter(Boolean)
                          .join(", ") || "-"}

                        {w.pincode
                          ? ` • ${w.pincode}`
                          : ""}
                      </span>
                    </td>

                    <td data-label="Company" className="px-3 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
                        {(w.companies?.length
                          ? w.companies
                          : w.company
                            ? [w.company]
                            : []
                        ).map((c) => (
                          <span
                            key={c.id}
                            className="inline-flex max-w-full items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700"
                          >
                            <Building2 size={12} className="shrink-0 text-gray-400" />
                            <span className="truncate">{c.name}</span>
                            {c.status === "Inactive" && (
                              <span className="rounded-full bg-red-50 px-1.5 text-[10px] font-medium text-red-600">
                                Inactive
                              </span>
                            )}
                          </span>
                        ))}
                        {!(w.companies?.length || w.company) && (
                          <span className="text-gray-500">Unassigned</span>
                        )}
                      </div>
                    </td>

                    <td data-label="Inward" className="px-3 py-3">
                      <StatusToggle
                        active={effectiveInward}
                        disabled={
                          !canManage ||
                          companyInactive
                        }
                        onClick={() =>
                          toggle(w, "inward")
                        }
                      />
                    </td>

                    <td data-label="Outward" className="px-3 py-3">
                      <StatusToggle
                        active={effectiveOutward}
                        disabled={
                          !canManage ||
                          companyInactive
                        }
                        onClick={() =>
                          toggle(w, "outward")
                        }
                      />
                    </td>

                    {canManage && (
                      <td data-label="Actions" className="px-3 py-3 md:whitespace-nowrap md:w-px">
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() =>
                              openAccess(w)
                            }
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 px-2.5 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50"
                          >
                            <Users
                              size={14}
                              className="shrink-0"
                            />
                            Access
                          </button>

                          <button
                            onClick={() =>
                              openEdit(w)
                            }
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            <Pencil
                              size={14}
                              className="shrink-0"
                            />
                            Edit
                          </button>

                          <button
                            onClick={() =>
                              remove(w)
                            }
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-red-200 px-2.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            <Trash2
                              size={14}
                              className="shrink-0"
                            />
                            Delete
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="py-14 text-center text-sm text-gray-500">
          No warehouses found.
        </div>
      )}

      {showForm && (
        <Modal
          title={
            editing
              ? "Edit warehouse"
              : "Add warehouse"
          }
          onClose={() => setShowForm(false)}
        >
          <form
            onSubmit={save}
            className="p-5 space-y-4"
          >
            <Field
              label="Warehouse name"
              value={form.name}
              onChange={(v) =>
                setForm((p) => ({
                  ...p,
                  name: v,
                }))
              }
              required
            />

            <Field
              label="Locality / Area"
              value={form.locality}
              onChange={(v) =>
                setForm((p) => ({
                  ...p,
                  locality: v,
                }))
              }
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="City"
                value={form.city}
                onChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    city: v,
                  }))
                }
                required
              />

              <Field
                label="State"
                value={form.state}
                onChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    state: v,
                  }))
                }
                required
              />
            </div>

            <Field
              label="Pincode"
              value={form.pincode}
              onChange={(v) =>
                setForm((p) => ({
                  ...p,
                  pincode: v
                    .replace(/\D/g, "")
                    .slice(0, 6),
                }))
              }
              required
            />

            {isSuper && (
              <CompanyMultiSelect
                companies={companies}
                value={form.companyIds}
                onChange={(ids) =>
                  setForm((p) => ({ ...p, companyIds: ids }))
                }
                label="Companies"
                placeholder="Select companies"
                hint="Users of any selected company can be given access to this warehouse."
              />
            )}

            {formError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t pt-4">
              <button
                type="button"
                onClick={() =>
                  setShowForm(false)
                }
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm"
              >
                Cancel
              </button>

              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white"
              >
                {editing
                  ? "Save changes"
                  : "Create warehouse"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {accessWarehouse && !canManage && (
        <Modal
          title="Warehouse details"
          onClose={() =>
            setAccessWarehouse(null)
          }
        >
          <div className="p-5 space-y-3">
            <Info
              label="Name"
              value={accessWarehouse.name}
            />

            <Info
              label="Code"
              value={accessWarehouse.code}
            />

            <Info
              label="Company"
              value={
                accessWarehouse.company?.name
              }
            />

            <Info
              label="Location"
              value={[
                accessWarehouse.locality,
                accessWarehouse.city,
                accessWarehouse.state,
                accessWarehouse.pincode,
              ]
                .filter(Boolean)
                .join(", ")}
            />

            <Info
              label="Inward"
              value={
                accessWarehouse.company?.status ===
                "Inactive"
                  ? "Inactive"
                  : accessWarehouse.Inward
              }
            />

            <Info
              label="Outward"
              value={
                accessWarehouse.company?.status ===
                "Inactive"
                  ? "Inactive"
                  : accessWarehouse.Outward
              }
            />
          </div>
        </Modal>
      )}

      {accessWarehouse && canManage && (
        <Modal
          title={`Warehouse access • ${accessWarehouse.name}`}
          onClose={() =>
            setAccessWarehouse(null)
          }
        >
          <div className="p-5 space-y-5">
            <form
              onSubmit={grant}
              className="rounded-xl bg-gray-50 p-4 space-y-3"
            >
              <h3 className="text-sm font-semibold text-gray-900">
                Grant or update access
              </h3>

              <select
                value={grantUser}
                onChange={(e) =>
                  handleGrantUserChange(
                    e.target.value,
                  )
                }
                className="w-full rounded-lg border bg-white px-3 py-2.5 text-sm"
              >
                <option value="">
                  Select company user
                </option>

                {users
                  .filter(
                    (u) =>
                      (u.companyIds?.length
                        ? u.companyIds
                        : [u.companyId]
                      ).some((id) =>
                        (accessWarehouse.companyIds?.length
                          ? accessWarehouse.companyIds
                          : [accessWarehouse.companyId]
                        ).includes(id),
                      ) &&
                      u.role ===
                        "WAREHOUSE_MANAGER",
                  )
                  .map((u) => (
                    <option
                      key={u.id}
                      value={u.id}
                    >
                      {u.name} • {u.email}
                    </option>
                  ))}
              </select>

              <div className="flex flex-wrap gap-4">
                {[
                  ["canInward", "Inward"],
                  ["canOutward", "Outward"],
                  [
                    "canManageDocuments",
                    "Documents",
                  ],
                ].map(([key, label]) => (
                  <label
                    key={key}
                    className="inline-flex items-center gap-2 text-sm font-medium text-black"
                  >
                    <input
                      type="checkbox"
                      checked={permissions[key]}
                      onChange={() =>
                        setPermissions(
                          (p) => ({
                            ...p,
                            [key]: !p[key],
                          }),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>

              <button
                type="submit"
                disabled={!grantUser || accessWarehouse?.company?.status === "Inactive" || accessWarehouse?.Inward !== "Active" || accessWarehouse?.Outward !== "Active"}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Grant / Update
              </button>
            </form>

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Current access
              </h3>

              {accessLoading ? (
                <Loader2
                  className="animate-spin text-gray-400"
                  size={18}
                />
              ) : access.length ? (
                <div className="space-y-2">
                  {access.map((item) => (
                    <div
                      key={item.user?.id}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-800">
                          {item.user?.name}
                        </p>

                        <p className="text-xs text-gray-500">
                          {item.user?.email}
                        </p>

                        <div className="flex gap-2 mt-1">
                          {item.canInward && (
                            <Badge>
                              Inward
                            </Badge>
                          )}

                          {item.canOutward && (
                            <Badge>
                              Outward
                            </Badge>
                          )}

                          {item.canManageDocuments && (
                            <Badge>
                              Documents
                            </Badge>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() =>
                          dispatch(
                            revokeWarehouseAccess(
                              {
                                warehouseId:
                                  accessWarehouse.id,
                                userId:
                                  item.user?.id,
                              },
                            ),
                          )
                        }
                        className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                        title="Revoke"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  No users have access.
                </p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
      ⌕
    </span>
  );
}

function StatusToggle({
  active,
  onClick,
  disabled,
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1.5 text-left text-xs whitespace-nowrap ${
        active
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-gray-200 bg-gray-50 text-gray-500"
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full mr-2 ${
          active
            ? "bg-green-500"
            : "bg-gray-400"
        }`}
      />

      {active ? "Active" : "Inactive"}
    </button>
  );
}

function Modal({
  title,
  onClose,
  children,
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-h-[90vh] sm:rounded-xl"
        onClick={(e) =>
          e.stopPropagation()
        }
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold text-gray-900">
            {title}
          </h2>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-gray-100"
          >
            <X size={19} />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-black">
        {label}
      </span>

      <input
        type={type}
        value={value}
        onChange={(e) =>
          onChange(e.target.value)
        }
        required={required}
        className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
      />
    </label>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-500">
        {label}
      </p>

      <p className="mt-1 text-sm font-medium text-gray-800">
        {value || "-"}
      </p>
    </div>
  );
}

function Badge({ children }) {
  return (
    <span className="rounded-full bg-green-50 px-2 py-1 text-[11px] text-green-700">
      {children}
    </span>
  );
}