import prisma from "../config/prisma.js";

/**
 * Per-warehouse permissions to UPDATE / DELETE inward (GRN) and outward (MIN) entries.
 * A Super admin grants them on the warehouse access screen. SUPER_ADMIN never needs a grant.
 */
export const ENTRY_PERMISSION_FIELDS = ["canUpdateInward", "canDeleteInward", "canUpdateOutward", "canDeleteOutward"];

/** Zeroed flags - used when a grant is created without them. */
export const emptyEntryPermissions = () => Object.fromEntries(ENTRY_PERMISSION_FIELDS.map((f) => [f, false]));

/** Reads the four flags out of a request body (anything missing = false). */
export const pickEntryPermissions = (source = {}) =>
  Object.fromEntries(ENTRY_PERMISSION_FIELDS.map((f) => [f, Boolean(source[f])]));

/** Prisma `select` fragment for the four flags. */
export const ENTRY_PERMISSION_SELECT = Object.fromEntries(ENTRY_PERMISSION_FIELDS.map((f) => [f, true]));

/**
 * The warehouse manager's flags for ONE warehouse (SUPER_ADMIN -> everything true, anyone else -> everything false).
 * Returns { canUpdateInward, canDeleteInward, canUpdateOutward, canDeleteOutward }.
 */
export async function getEntryPermissions(user, warehouseId) {
  if (user?.role === "SUPER_ADMIN") return Object.fromEntries(ENTRY_PERMISSION_FIELDS.map((f) => [f, true]));
  if (user?.role !== "WAREHOUSE_MANAGER" || !warehouseId) return emptyEntryPermissions();

  const access = await prisma.warehouseAccess.findUnique({
    where: { userId_warehouseId: { userId: user.id, warehouseId } },
    select: { accessLevel: true, ...ENTRY_PERMISSION_SELECT },
  });
  if (!access || access.accessLevel !== "MANAGE") return emptyEntryPermissions();
  return pickEntryPermissions(access);
}

/** True when the user may do `permission` (one of ENTRY_PERMISSION_FIELDS) on this warehouse's entries. */
export async function hasEntryPermission(user, warehouseId, permission) {
  if (user?.role === "SUPER_ADMIN") return true;
  return Boolean((await getEntryPermissions(user, warehouseId))[permission]);
}

/**
 * The flags a grant may carry for a role: a warehouse manager gets all four, Sales only the two outward ones
 * (Sales never works with inward), everyone else none.
 */
export function entryPermissionsForRole(role, source = {}) {
  if (role === "WAREHOUSE_MANAGER") return pickEntryPermissions(source);
  if (role === "SALES") return { ...emptyEntryPermissions(), canUpdateOutward: Boolean(source.canUpdateOutward), canDeleteOutward: Boolean(source.canDeleteOutward) };
  return emptyEntryPermissions();
}
