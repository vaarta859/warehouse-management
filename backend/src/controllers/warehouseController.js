import prisma from "../config/prisma.js";
import { userBelongsToCompany } from "../utils/userCompanies.js";
import { isFinanceSide, getUserCompanyIds } from "../utils/outwardWorkflow.js";

const WAREHOUSE_SELECT = {
  id: true,
  name: true,
  code: true,
  locality: true,
  city: true,
  state: true,
  pincode: true,
  Inward: true,
  Outward: true,
  companyId: true,
  createdAt: true,
  // So the warehouse page can show the company's name directly instead
  // of a raw companyId (and know at a glance if the parent company is
  // Inactive, which is what's actually disabling this warehouse).
  company: {
    select: { id: true, name: true, status: true },
  },
};

// ---------------------------------------------------
// Generates the next warehouse code, e.g. WH-0001, WH-0002...
// ---------------------------------------------------
async function generateWarehouseCode() {
  const last = await prisma.warehouse.findFirst({
    where: { code: { startsWith: "WH-" } },
    orderBy: { code: "desc" },
    select: { code: true },
  });

  let nextSeq = 1;

  if (last) {
    const match = last.code.match(/WH-(\d+)/);
    if (match) nextSeq = parseInt(match[1], 10) + 1;
  }

  return `WH-${String(nextSeq).padStart(4, "0")}`;
}

// -----------------------------------------
// GET /api/warehouses?search=&companyId=
//
// SUPER_ADMIN -> sees all (optionally filtered by ?companyId=)
// WAREHOUSE_MANAGER -> only warehouses they hold a MANAGE grant on
// -----------------------------------------
export async function getAllWarehouses(req, res) {
  try {
    const { search = "" } = req.query;

    const where = { AND: [] };

    if (req.user.role === "WAREHOUSE_MANAGER") {
      where.AND.push({
        access: {
          some: { userId: req.user.id, accessLevel: "MANAGE" },
        },
      });
    } else if (isFinanceSide(req.user.role)) {
      // SALES / ACCOUNT: every warehouse of the companies they belong to.
      const companyIds = await getUserCompanyIds(req.user);
      where.AND.push({ companyId: { in: companyIds } });
      if (req.query.companyId) where.AND.push({ companyId: req.query.companyId });
    } else if (req.query.companyId) {
      where.AND.push({ companyId: req.query.companyId });
    }

    if (search) {
      where.AND.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { code: { contains: search, mode: "insensitive" } },
          { city: { contains: search, mode: "insensitive" } },
          { state: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    const warehouses = await prisma.warehouse.findMany({
      where,
      select: WAREHOUSE_SELECT,
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(warehouses);
  } catch (error) {
    console.error("getAllWarehouses error:", error);
    res.status(500).json({ message: "Failed to fetch warehouses" });
  }
}

// -----------------------------------------
// GET /api/warehouses/:id
// -----------------------------------------
export async function getWarehouseById(req, res) {
  try {
    const { id } = req.params;
    const warehouse = await prisma.warehouse.findUnique({
      where: { id },
      select: WAREHOUSE_SELECT,
    });

    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({
        where: { userId_warehouseId: { userId: req.user.id, warehouseId: id } },
      });

      if (!access || access.accessLevel !== "MANAGE") {
        return res.status(403).json({ message: "You don't have access to this warehouse" });
      }
    }

    if (isFinanceSide(req.user.role)) {
      const companyIds = await getUserCompanyIds(req.user);
      if (!warehouse.companyId || !companyIds.includes(warehouse.companyId)) {
        return res.status(403).json({ message: "You don't have access to this warehouse" });
      }
    }

    res.status(200).json(warehouse);
  } catch (error) {
    console.error("getWarehouseById error:", error);
    res.status(500).json({ message: "Failed to fetch warehouse" });
  }
}

// -----------------------------------------
// POST /api/warehouses
// SUPER_ADMIN only
//
// SUPER_ADMIN must specify companyId in the body.
// -----------------------------------------
export async function createWarehouse(req, res) {
  try {
    const { name, locality, city, state, pincode } = req.body;

    const companyId = req.body.companyId;

    // Report every missing required field at once (name/city/state/pincode
    // are required; locality is optional) instead of a generic message,
    // so the form knows exactly what to fix.
    const missing = ["name", "city", "state", "pincode"].filter(
      (field) => !req.body[field] || !String(req.body[field]).trim()
    );

    if (missing.length > 0) {
      return res.status(400).json({
        message: `Missing required field(s): ${missing.join(", ")}`,
        missingFields: missing,
      });
    }

    if (!companyId) {
      return res.status(400).json({ message: "companyId is required" });
    }

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return res.status(400).json({ message: "companyId does not match an existing company" });
    }

    if (company.status === "Inactive") {
      return res.status(409).json({
        message: "This company is inactive. Reactivate it before adding warehouses.",
      });
    }

    let warehouse;
    let attempt = 0;

    while (!warehouse && attempt < 2) {
      const code = await generateWarehouseCode();

      try {
        warehouse = await prisma.warehouse.create({
          data: {
            name: name.trim(),
            code,
            locality: locality && locality.trim() ? locality.trim() : null,
            city: city.trim(),
            state: state.trim(),
            pincode: pincode.trim(),
            companyId,
          },
          select: WAREHOUSE_SELECT,
        });
      } catch (err) {
        if (err.code === "P2002" && attempt === 0) {
          attempt += 1;
          continue;
        }
        throw err;
      }
    }

    res.status(201).json(warehouse);
  } catch (error) {
    console.error("createWarehouse error:", error);
    res.status(500).json({ message: "Failed to create warehouse" });
  }
}

// -----------------------------------------
// PUT /api/warehouses/:id
// SUPER_ADMIN only
// -----------------------------------------
export async function updateWarehouse(req, res) {
  try {
    const { id } = req.params;
    const { name, locality, city, state, pincode, companyId } = req.body;

    const existing = await prisma.warehouse.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    const warehouse = await prisma.warehouse.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(locality !== undefined && { locality: locality.trim() ? locality.trim() : null }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(pincode !== undefined && { pincode }),
        ...(req.user.role === "SUPER_ADMIN" && companyId !== undefined && { companyId }),
      },
      select: WAREHOUSE_SELECT,
    });

    res.status(200).json(warehouse);
  } catch (error) {
    console.error("updateWarehouse error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Warehouse not found" });
    }
    res.status(500).json({ message: "Failed to update warehouse" });
  }
}

// -----------------------------------------
// PATCH /api/warehouses/:id/inward   toggles Inward Active <-> Inactive
// PATCH /api/warehouses/:id/outward  toggles Outward Active <-> Inactive
// SUPER_ADMIN only
// -----------------------------------------
async function toggleField(req, res, field) {
  try {
    const { id } = req.params;

    const existing = await prisma.warehouse.findUnique({
      where: { id },
      include: { company: { select: { status: true } } },
    });
    if (!existing) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    // Company status is the parent/master switch. While the company is
    // inactive, warehouse operation status cannot be changed.
    if (existing.company && existing.company.status === "Inactive") {
      return res.status(409).json({
        message: `Can't change ${field} while the parent company is inactive. Activate the company first.`,
      });
    }

    const warehouse = await prisma.warehouse.update({
      where: { id },
      data: { [field]: existing[field] === "Active" ? "Inactive" : "Active" },
      select: WAREHOUSE_SELECT,
    });

    res.status(200).json(warehouse);
  } catch (error) {
    console.error(`toggle${field} error:`, error);
    res.status(500).json({ message: `Failed to update warehouse ${field.toLowerCase()} status` });
  }
}

export const toggleInwardStatus = (req, res) => toggleField(req, res, "Inward");
export const toggleOutwardStatus = (req, res) => toggleField(req, res, "Outward");

// -----------------------------------------
// DELETE /api/warehouses/:id?force=true
// SUPER_ADMIN only
//
// Blocked if the warehouse still has granted user access, unless
// ?force=true — deleting cascades those WarehouseAccess rows away.
// -----------------------------------------
export async function deleteWarehouse(req, res) {
  try {
    const { id } = req.params;
    const { force } = req.query;

    const existing = await prisma.warehouse.findUnique({
      where: { id },
      select: { id: true, companyId: true, _count: { select: { access: true } } },
    });

    if (!existing) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    if (existing._count.access > 0 && force !== "true") {
      return res.status(409).json({
        message:
          "This warehouse still has users granted access to it. " +
          "Revoke their access first, or retry with ?force=true.",
        userCount: existing._count.access,
      });
    }

    await prisma.warehouse.delete({ where: { id } });
    res.status(200).json({ message: "Warehouse deleted successfully" });
  } catch (error) {
    console.error("deleteWarehouse error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Warehouse not found" });
    }
    res.status(500).json({ message: "Failed to delete warehouse" });
  }
}

// =====================================================
// Warehouse access — the "one warehouse, many users /
// one user, many warehouses" join table.
// =====================================================

// -----------------------------------------
// GET /api/warehouses/:id/access
// SUPER_ADMIN only
//
// Every user currently granted access to this warehouse.
// -----------------------------------------
export async function listWarehouseAccess(req, res) {
  try {
    const { id } = req.params;

    const warehouse = await prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    const access = await prisma.warehouseAccess.findMany({
      where: { warehouseId: id },
      select: {
        accessLevel: true,
        canInward: true,
        canOutward: true,
        canManageDocuments: true,
        grantedAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    res.json({ data: access });
  } catch (error) {
    console.error("listWarehouseAccess error:", error);
    res.status(500).json({ message: "Failed to fetch warehouse access" });
  }
}

// -----------------------------------------
// PUT /api/warehouses/:id/access
// SUPER_ADMIN only
// body: { userId, canInward, canOutward, canManageDocuments }
//
// Upsert — grants access on first call, updates the permission
// flags on later calls. The target user must belong to the
// warehouse's company (a user can belong to several companies).
// -----------------------------------------
export async function grantWarehouseAccess(req, res) {
  try {
    const { id: warehouseId } = req.params;
    const { userId, canInward, canOutward, canManageDocuments } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!(await userBelongsToCompany(targetUser, warehouse.companyId))) {
      return res.status(400).json({
        message: "This user doesn't belong to the same company as the warehouse",
      });
    }

    const access = await prisma.warehouseAccess.upsert({
      where: { userId_warehouseId: { userId, warehouseId } },
      create: {
        userId,
        warehouseId,
        accessLevel: "MANAGE",
        canInward: Boolean(canInward),
        canOutward: Boolean(canOutward),
        canManageDocuments: Boolean(canManageDocuments),
      },
      update: {
        accessLevel: "MANAGE",
        canInward: Boolean(canInward),
        canOutward: Boolean(canOutward),
        canManageDocuments: Boolean(canManageDocuments),
      },
      select: {
        accessLevel: true,
        canInward: true,
        canOutward: true,
        canManageDocuments: true,
        grantedAt: true,
        user: { select: { id: true, name: true, email: true } },
        warehouse: { select: { id: true, name: true, code: true } },
      },
    });

    res.json({ message: "Warehouse access granted", access });
  } catch (error) {
    console.error("grantWarehouseAccess error:", error);
    res.status(500).json({ message: "Failed to grant warehouse access" });
  }
}

// -----------------------------------------
// DELETE /api/warehouses/:id/access/:userId
// SUPER_ADMIN only
// -----------------------------------------
export async function revokeWarehouseAccess(req, res) {
  try {
    const { id: warehouseId, userId } = req.params;

    const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    await prisma.warehouseAccess.delete({
      where: { userId_warehouseId: { userId, warehouseId } },
    });

    res.json({ message: "Warehouse access revoked" });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "This user doesn't have access to this warehouse" });
    }
    console.error("revokeWarehouseAccess error:", error);
    res.status(500).json({ message: "Failed to revoke warehouse access" });
  }
}
