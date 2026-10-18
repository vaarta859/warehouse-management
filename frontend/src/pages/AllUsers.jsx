import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Power,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import {
  getAllUsers,
  deleteUser,
  updateUserRole,
  updateUser,
  setUserStatus,
  selectAllUsers,
  selectUsersStatus,
  selectUsersError,
} from "../features/auth/authSlice";
import { fetchCompanies, selectAllCompanies } from "../features/company/companySlice";
import CompanyMultiSelect from "../components/CompanyMultiSelect";

// Every company a user belongs to. Falls back to the old single-company
// fields for users loaded before multi-company support.
const userCompanies = (user) => {
  if (user?.companies?.length) return user.companies;
  return user?.company ? [user.company] : [];
};

const userCompanyIds = (user) => {
  if (user?.companyIds?.length) return user.companyIds;
  return user?.companyId ? [user.companyId] : [];
};

const sameIds = (a, b) =>
  a.length === b.length && a.every((id) => b.includes(id));

const ROLES = ["SUPER_ADMIN", "WAREHOUSE_MANAGER", "SALES", "ACCOUNT"];
const roleLabel = (role) =>
  ({
    SUPER_ADMIN: "Super Admin",
    WAREHOUSE_MANAGER: "Warehouse Manager",
    SALES: "Sales",
    ACCOUNT: "Account",
  })[role] ||
  role ||
  "-";

export default function AllUsers() {
  const dispatch = useDispatch();
  const [params] = useSearchParams();
  const companyId = params.get("companyId") || undefined;
  const companyName = params.get("companyName") || "Company";
  const users = useSelector(selectAllUsers);
  const status = useSelector(selectUsersStatus);
  const error = useSelector(selectUsersError);
  const currentUser = useSelector((state) => state.auth.user);
  const companies = useSelector(selectAllCompanies);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [expandedCompanies, setExpandedCompanies] = useState({});
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [role, setRole] = useState("");
  const [companyIdsForRole, setCompanyIdsForRole] = useState(companyId ? [companyId] : []);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    dispatch(getAllUsers({ companyId }));
    if (currentUser?.role === "SUPER_ADMIN") dispatch(fetchCompanies());
  }, [dispatch, companyId, currentUser?.role]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter((user) => {
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesSearch = [
        user.name,
        user.email,
        user.role,
        ...userCompanies(user).flatMap((c) => [c.name, c.code]),
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(q),
      );
      return matchesRole && matchesSearch;
    });
  }, [users, search, roleFilter]);

  const openEdit = (user) => {
    setSelected(user);
    setEditMode(true);
    setForm({ name: user.name || "", email: user.email || "", password: "" });
    setRole(user.role || "");
    const ids = userCompanyIds(user);
    setCompanyIdsForRole(ids.length ? ids : companyId ? [companyId] : []);
    setFormError("");
  };

  // Active companies, plus any inactive company this user already belongs to,
  // so saving the form can't silently drop it.
  const editableCompanies = useMemo(() => {
    const memberOf = new Set(selected ? userCompanyIds(selected) : []);
    return companies.filter((c) => c.status !== "Inactive" || memberOf.has(c.id));
  }, [companies, selected]);

  const close = () => {
    setSelected(null);
    setEditMode(false);
    setFormError("");
  };

  const save = async (event) => {
    event.preventDefault();
    if (!selected) return;
    if (!form.name.trim()) return setFormError("Full name is required.");
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim()))
      return setFormError("Enter a valid email address.");
    if (form.password && form.password.length < 8)
      return setFormError("Password must be at least 8 characters.");
    if (role !== "SUPER_ADMIN" && companyIdsForRole.length === 0)
      return setFormError("Select at least one company for this role.");

    const profilePayload = {
      id: selected.id,
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
    };
    if (form.password) profilePayload.password = form.password;
    const profileResult = await dispatch(updateUser(profilePayload));
    if (updateUser.rejected.match(profileResult))
      return setFormError(profileResult.payload || "Failed to update user");

    if (
      role !== selected.role ||
      (role !== "SUPER_ADMIN" &&
        !sameIds(companyIdsForRole, userCompanyIds(selected)))
    ) {
      const roleResult = await dispatch(
        updateUserRole({
          id: selected.id,
          role,
          companyIds: role === "SUPER_ADMIN" ? undefined : companyIdsForRole,
        }),
      );
      if (updateUserRole.rejected.match(roleResult))
        return setFormError(roleResult.payload || "Failed to update role");
    }
    close();
  };

  const toggleStatus = async (user) => {
    if (user.id === currentUser?.id)
      return alert("You can't deactivate your own account.");
    const makeActive = user.isActive === false;
    const message = makeActive
      ? `Activate ${user.name}? They will be able to log in again.`
      : `Deactivate ${user.name}? They will no longer be able to log in.`;
    if (!window.confirm(message)) return;
    const result = await dispatch(
      setUserStatus({ id: user.id, isActive: makeActive }),
    );
    if (setUserStatus.rejected.match(result))
      alert(result.payload || "Failed to update user status");
  };

  const remove = async (user) => {
    if (user.id === currentUser?.id)
      return alert("You can't delete your own account.");
    if (!window.confirm(`Delete ${user.name}?`)) return;
    const result = await dispatch(deleteUser(user.id));
    if (deleteUser.rejected.match(result))
      alert(result.payload || "Failed to delete user");
  };

  return (
    <div className="min-h-dvh bg-[#F1EFE8] p-4 sm:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
        <div>
          {companyId && (
            <Link
              to="/companies"
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-2"
            >
              <ArrowLeft size={15} /> Back to Companies
            </Link>
          )}
          <h1 className="text-lg font-semibold text-gray-900 sm:text-2xl">
            {companyId ? `Users – ${companyName}` : "User Management"}
          </h1>
          <p className="text-xs text-gray-500 mt-0.5 sm:text-sm sm:mt-1">
            Manage accounts and role-based access.
          </p>
        </div>
        <Link
          to={
            companyId
              ? `/signup?companyId=${encodeURIComponent(companyId)}&companyName=${encodeURIComponent(companyName)}`
              : "/signup"
          }
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <UserPlus size={17} /> Create user
        </Link>
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 mb-5">
        <Stat label="Total" value={users.length} />
        <Stat
          label="Warehouse Manager"
          value={users.filter((u) => u.role === "WAREHOUSE_MANAGER").length}
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, company..."
            className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm"
        >
          <option value="all">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="mobile-cards w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Companies</th>
              <th className="px-4 py-3">Warehouses</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {status === "loading" && users.length === 0 ? (
              <tr>
                <td colSpan="5" className="py-12 text-center">
                  <Loader2 className="mx-auto animate-spin text-gray-400" />
                </td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr
                  key={user.id}
                  className="border-b last:border-0 hover:bg-gray-50/70"
                >
                  <td data-label="User" className="px-4 py-4">
                    <div className="font-medium text-gray-900">{user.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {user.email}
                    </div>
                    <span
                      className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        user.isActive === false
                          ? "bg-red-50 text-red-700"
                          : "bg-green-50 text-green-700"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          user.isActive === false ? "bg-red-500" : "bg-green-500"
                        }`}
                      />
                      {user.isActive === false ? "Inactive" : "Active"}
                    </span>
                  </td>
                  <td data-label="Role" className="px-4 py-4">
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                      <ShieldCheck size={13} /> {roleLabel(user.role)}
                    </span>
                  </td>
                  <td data-label="Companies" className="mc-stack px-4 py-4">
                    {userCompanies(user).length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {(expandedCompanies[user.id]
                          ? userCompanies(user)
                          : userCompanies(user).slice(0, 2)
                        ).map((c) => (
                          <span
                            key={c.id}
                            title={c.code || ""}
                            className="max-w-full truncate rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700"
                          >
                            {c.name}
                          </span>
                        ))}
                        {userCompanies(user).length > 2 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedCompanies((prev) => ({
                                ...prev,
                                [user.id]: !prev[user.id],
                              }))
                            }
                            className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                          >
                            {expandedCompanies[user.id]
                              ? "Show less"
                              : `+${userCompanies(user).length - 2} more`}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-gray-800">Unassigned</div>
                    )}
                  </td>
                  <td data-label="Warehouses" className="mc-stack px-4 py-4">
                    <div className="text-gray-800">
                      {user.warehouseAccess?.length || 0} granted
                    </div>
                    <div className="text-xs text-gray-500">
                      {
                        (user.warehouseAccess || []).filter((a) => a.canInward)
                          .length
                      }{" "}
                      inward •{" "}
                      {
                        (user.warehouseAccess || []).filter((a) => a.canOutward)
                          .length
                      }{" "}
                      outward
                    </div>
                  </td>
                  <td data-label="Actions" className="px-4 py-4">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => openEdit(user)}
                        title="Edit user"
                        className="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => setSelected(user)}
                        title="View access"
                        className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        onClick={() => toggleStatus(user)}
                        title={
                          user.isActive === false
                            ? "Activate user"
                            : "Deactivate user"
                        }
                        disabled={user.id === currentUser?.id}
                        className={`inline-flex items-center gap-1 rounded-lg p-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                          user.isActive === false
                            ? "text-green-700 hover:bg-green-50"
                            : "text-amber-600 hover:bg-amber-50"
                        }`}
                      >
                        <Power size={16} />
                        <span>
                          {user.isActive === false ? "Activate" : "Deactivate"}
                        </span>
                      </button>
                      <button
                        onClick={() => remove(user)}
                        title="Delete user"
                        className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {status !== "loading" && filtered.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500">
          No users found.
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-h-[90vh] sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="font-semibold text-gray-900">
                  {editMode ? "Edit user" : "User access"}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {selected.name} • {selected.email}
                </p>
              </div>
              <button
                onClick={close}
                className="p-1.5 rounded-lg hover:bg-gray-100"
              >
                <X size={19} />
              </button>
            </div>
            {editMode ? (
              <form onSubmit={save} className="p-5 space-y-4">
                <Field
                  label="Full name"
                  value={form.name}
                  onChange={(v) => setForm((p) => ({ ...p, name: v }))}
                />
                <Field
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={(v) => setForm((p) => ({ ...p, email: v }))}
                />
                <Field
                  label="New password (optional)"
                  type="password"
                  value={form.password}
                  onChange={(v) => setForm((p) => ({ ...p, password: v }))}
                />
                <label className="block">
                  <span className="block text-sm text-gray-500 mb-1">Role</span>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2.5 text-sm"
                  >
                    {ROLES.filter(
                      (r) =>
                        currentUser?.role === "SUPER_ADMIN" ||
                        r !== "SUPER_ADMIN",
                    ).map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                </label>
                {role !== "SUPER_ADMIN" && (
                  <CompanyMultiSelect
                    companies={editableCompanies}
                    value={companyIdsForRole}
                    onChange={setCompanyIdsForRole}
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
                    onClick={close}
                    className="rounded-lg bg-gray-100 px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white"
                  >
                    Save changes
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                  <Info label="Role" value={roleLabel(selected.role)} />
                  <Info
                    label={userCompanies(selected).length > 1 ? "Companies" : "Company"}
                    value={
                      userCompanies(selected).length
                        ? userCompanies(selected).map((c) => c.name).join(", ")
                        : "Unassigned"
                    }
                  />
                </div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">
                  Warehouse access
                </h3>
                {selected.warehouseAccess?.length ? (
                  <div className="space-y-2">
                    {selected.warehouseAccess.map((access) => (
                      <div
                        key={access.warehouseId}
                        className="rounded-lg border p-3"
                      >
                        <div className="font-medium text-gray-800">
                          {access.warehouse?.name || access.warehouseId}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {access.warehouse?.code || ""}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {access.canInward && <Badge>Inward</Badge>}
                          {access.canOutward && <Badge>Outward</Badge>}
                          {access.canManageDocuments && (
                            <Badge>Documents</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    No warehouse access granted.
                  </p>
                )}
                <div className="mt-5 text-right">
                  <button
                    onClick={close}
                    className="rounded-lg bg-gray-100 px-4 py-2 text-sm"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}
function Field({ label, value, onChange, type = "text", disabled = false }) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";

  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-black">{label}</span>
      <div className="relative">
        <input
          type={isPassword && showPassword ? "text" : type}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2.5 pr-10 text-sm outline-none focus:border-blue-500 disabled:bg-gray-100"
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
      </div>
    </label>
  );
}
function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-gray-800 break-words">
        {value}
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
