import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Eye, EyeOff, KeyRound, Mail, MapPin, ShieldCheck, User, UserCircle } from "lucide-react";

import apiClient from "../services/apiClient";

// Department shown on the profile for each role.
const DEPARTMENTS = {
  SUPER_ADMIN: "Admin",
  WAREHOUSE_MANAGER: "Warehouse",
  SALES: "Sales",
  ACCOUNT: "Account",
};

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("user"));
  } catch {
    return null;
  }
}

function InfoRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
        <div className="mt-0.5 break-words text-sm font-medium text-gray-900">{children}</div>
      </div>
    </div>
  );
}

function PasswordField({ label, value, onChange, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-black">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

function ProfileSection({ profile, loading, error }) {
  const user = profile?.user;
  const companies = user?.companies || [];
  const warehouses = profile?.warehouses || [];
  const isAdmin = user?.role === "SUPER_ADMIN";

  if (loading && !user) return <p className="py-6 text-center text-sm text-gray-500">Loading profile...</p>;

  return (
    <div className="divide-y divide-gray-100">
      {error && <p className="pb-3 text-sm text-red-600">{error}</p>}

      <InfoRow icon={User} label="Name">{user?.name || "—"}</InfoRow>
      <InfoRow icon={Mail} label="Email">{user?.email || "—"}</InfoRow>
      <InfoRow icon={UserCircle} label="Department">
        {DEPARTMENTS[user?.role] || user?.role || "—"}
      </InfoRow>

      <InfoRow icon={Building2} label={`Companies${companies.length ? ` (${companies.length})` : ""}`}>
        {isAdmin ? (
          <span className="text-gray-600">All companies</span>
        ) : companies.length ? (
          <div className="flex flex-wrap gap-1.5">
            {companies.map((c) => (
              <span key={c.id} className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                {c.name}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-gray-400">Not connected to any company</span>
        )}
      </InfoRow>

      <InfoRow icon={MapPin} label={`Warehouses${warehouses.length ? ` (${warehouses.length})` : ""}`}>
        {isAdmin ? (
          <span className="text-gray-600">All warehouses</span>
        ) : warehouses.length ? (
          <div className="flex flex-wrap gap-1.5">
            {warehouses.map((w) => (
              <span key={w.id} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                {w.name}
                {w.code ? ` · ${w.code}` : ""}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-gray-400">No warehouse access</span>
        )}
      </InfoRow>
    </div>
  );
}

function SecuritySection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const mismatch = confirmPassword !== "" && newPassword !== confirmPassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Please fill in all the fields");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirm password do not match");
      return;
    }

    setSaving(true);
    try {
      const { data } = await apiClient.post("/api/auth/change-password", {
        currentPassword,
        newPassword,
        confirmPassword,
      });
      setSuccess(data?.message || "Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to change password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md space-y-4">
      <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
      <PasswordField label="New password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
      <div>
        <PasswordField label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
        {mismatch && <p className="mt-1 text-xs text-red-600">Passwords do not match</p>}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p>}

      <button
        type="submit"
        disabled={saving || mismatch || !currentPassword || !newPassword || !confirmPassword}
        className="rounded-lg bg-purple-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Changing..." : "Change password"}
      </button>
    </form>
  );
}

export default function Profile({ initialTab = "profile" }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState(initialTab);
  const [profile, setProfile] = useState(() => {
    const u = readStoredUser();
    return u ? { user: u, warehouses: [] } : null;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get("/api/auth/profile")
      .then(({ data }) => {
        if (!cancelled) setProfile(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.message || "Failed to load profile");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const user = profile?.user;
  const initials = (user?.name || "U")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const tabs = [
    { key: "profile", label: "Profile", icon: User },
    { key: "security", label: "Security", icon: ShieldCheck },
  ];

  return (
    <div className="min-h-full bg-[#F1EFE8] p-4 sm:p-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-600 text-base font-bold text-white">
            {initials}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-gray-900 sm:text-xl">{user?.name || "My profile"}</h1>
            <p className="text-xs text-gray-500">{DEPARTMENTS[user?.role] || ""}</p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="flex gap-1 border-b border-gray-200 p-2">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  tab === key ? "bg-purple-50 text-purple-700" : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>

          <div className="p-4 sm:p-5">
            {tab === "profile" ? (
              <ProfileSection profile={profile} loading={loading} error={error} />
            ) : (
              <SecuritySection />
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mt-4 text-xs font-semibold text-purple-700 hover:underline"
        >
          ← Back
        </button>
      </div>
    </div>
  );
}
