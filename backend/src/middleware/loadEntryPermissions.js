import prisma from "../config/prisma.js";

/**
 * Loads, once per request, the warehouses on which a WAREHOUSE_MANAGER or SALES user may UPDATE / DELETE outward entries
 * (the "Update outward" / "Delete outward" switches a Super admin sets on the warehouse access screen).
 * Must run AFTER authenticate().
 *
 *   req.entryPerms = { updateOutward: Set<warehouseId>, deleteOutward: Set<warehouseId> }
 *
 * Other roles get empty sets (SUPER_ADMIN is checked by role everywhere, never through these sets).
 */
export default async function loadEntryPermissions(req, res, next) {
  req.entryPerms = { updateOutward: new Set(), deleteOutward: new Set() };
  if (req.user?.role !== "WAREHOUSE_MANAGER" && req.user?.role !== "SALES") return next();
  try {
    const rows = await prisma.warehouseAccess.findMany({
      where: { userId: req.user.id, accessLevel: "MANAGE", OR: [{ canUpdateOutward: true }, { canDeleteOutward: true }] },
      select: { warehouseId: true, canUpdateOutward: true, canDeleteOutward: true },
    });
    for (const row of rows) {
      if (row.canUpdateOutward) req.entryPerms.updateOutward.add(row.warehouseId);
      if (row.canDeleteOutward) req.entryPerms.deleteOutward.add(row.warehouseId);
    }
    next();
  } catch (err) {
    console.error("loadEntryPermissions error:", err);
    return res.status(500).json({ message: "Something went wrong while checking your permissions" });
  }
}
