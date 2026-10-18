import prisma from '../config/prisma.js';

/**
 * requireWarehouseAccess — scopes a route that operates on ONE
 * warehouse's data (creating a Grn, a Min, uploading a Document, etc).
 * MUST run AFTER authenticate(), since it reads req.user.
 *
 *   SUPER_ADMIN        -> always passes
 * *   WAREHOUSE_MANAGER   -> passes only if they hold a MANAGE-level
 *                          WarehouseAccess row for this warehouse, and
 *                          (if `permission` is given) that row's flag is true
 *
 * `permission` is optional:
 *   null                   -> just needs *some* access to the warehouse
 *   'canInward'            -> needs that specific flag set true
 *   'canOutward'
 *   'canManageDocuments'
 *
 * `getWarehouseId(req)` pulls the target warehouse id out of the
 * request — pass a small function since it might live in params or body.
 *
 * Usage on a route:
 *   router.post(
 *     '/warehouses/:warehouseId/grn',
 *     authenticate,
 *     requireWarehouseAccess('canInward', (req) => req.params.warehouseId),
 *     createGrn
 *   )
 */
// permission -> which Warehouse status field it depends on (if any).
// canManageDocuments doesn't gate on Inward/Outward, only on the grant itself.
const PERMISSION_STATUS_FIELD = {
  canInward: 'Inward',
  canOutward: 'Outward',
};

export default function requireWarehouseAccess(permission, getWarehouseId) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Not authenticated' });
      }

      const warehouseId = getWarehouseId(req);

      if (!warehouseId) {
        return res.status(400).json({ message: 'warehouseId is required' });
      }

      const warehouse = await prisma.warehouse.findUnique({
        where: { id: warehouseId },
        select: {
          id: true,
          companyId: true,
          Inward: true,
          Outward: true,
          company: { select: { status: true } },
        },
      });

      if (!warehouse) {
        return res.status(404).json({ message: 'Warehouse not found' });
      }

      // --- Hard blocks that apply to EVERYONE, SUPER_ADMIN included ---
      // A company set Inactive takes every one of its warehouses down
      // with it: nobody can inward or outward against them.
      if (warehouse.company && warehouse.company.status === 'Inactive') {
        return res.status(403).json({
          message: 'This warehouse belongs to an inactive company. Inward/outward is disabled.',
        });
      }

      // The warehouse's own Inward/Outward toggle is a hard block too,
      // independent of who's asking or what their per-user flags say.
      const statusField = PERMISSION_STATUS_FIELD[permission];
      if (statusField && warehouse[statusField] !== 'Active') {
        return res.status(403).json({
          message: `${statusField} is disabled for this warehouse.`,
        });
      }

      // --- Role-based access, now that we know the warehouse is "live" ---
      if (req.user.role === 'SUPER_ADMIN') {
        return next();
      }

      // WAREHOUSE_MANAGER — must hold an explicit grant for this warehouse.
      const access = await prisma.warehouseAccess.findUnique({
        where: {
          userId_warehouseId: { userId: req.user.id, warehouseId },
        },
      });

      if (!access || access.accessLevel !== 'MANAGE') {
        return res.status(403).json({ message: "You don't have access to this warehouse" });
      }

      // Per-user flag — e.g. a administrator can turn off just THIS
      // user's canInward on THIS warehouse without touching anyone else.
      if (permission && !access[permission]) {
        return res.status(403).json({ message: "You don't have permission to do this on this warehouse" });
      }

      next();
    } catch (err) {
      console.error('requireWarehouseAccess error:', err);
      return res.status(500).json({ message: 'Something went wrong while checking warehouse access' });
    }
  };
}
