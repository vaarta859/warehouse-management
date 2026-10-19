import prisma from "../config/prisma.js";

// =====================================================
// Multi-company helpers for warehouses.
//
// A warehouse can now be linked with MANY companies through the
// WarehouseCompanyLink join table (the same idea as UserCompany for
// users). `Warehouse.companyId` is kept as the warehouse's "primary"
// company so older code keeps working; it is always one of the linked
// companies.
//
// A user can reach a warehouse only when the warehouse is linked with at
// least one company the user also belongs to.
// =====================================================

// Nested select used wherever a warehouse is returned to the frontend.
export const WAREHOUSE_COMPANIES_SELECT = {
  select: {
    company: { select: { id: true, name: true, code: true, status: true } },
  },
  orderBy: { createdAt: "asc" },
};

// Prisma `where` fragment: warehouses linked with any of these companies.
export function warehouseCompanyWhere(companyIds) {
  return {
    OR: [
      { companyId: { in: companyIds } },
      { companyLinks: { some: { companyId: { in: companyIds } } } },
    ],
  };
}

/**
 * Flattens the join rows into the shape the frontend uses:
 *
 *   companies:  [{ id, name, code, status }]
 *   companyIds: [id, ...]
 *   companyId / company: the primary company (backward compatible)
 */
export function shapeWarehouse(warehouse) {
  if (!warehouse) return warehouse;

  const { companyLinks, ...rest } = warehouse;

  let companies = (companyLinks || []).map((l) => l.company).filter(Boolean);

  // Rows from before the backfill only have the old single company.
  if (!companies.length && rest.company) {
    companies = [rest.company];
  }

  const primary =
    companies.find((c) => c.id === rest.companyId) || companies[0] || null;

  return {
    ...rest,
    companyId: primary?.id ?? rest.companyId ?? null,
    company: primary
      ? { id: primary.id, name: primary.name, status: primary.status }
      : null,
    companies,
    companyIds: companies.map((c) => c.id),
  };
}

// Every company a warehouse is linked with: [{ id, name, code, status }]
export async function getWarehouseCompanies(warehouseId, db = prisma) {
  const warehouse = await db.warehouse.findUnique({
    where: { id: warehouseId },
    select: {
      companyId: true,
      company: { select: { id: true, name: true, code: true, status: true } },
      companyLinks: WAREHOUSE_COMPANIES_SELECT,
    },
  });
  if (!warehouse) return [];
  return shapeWarehouse(warehouse).companies;
}

export const companyIdsOf = (companies) => companies.map((c) => c.id);

// A warehouse is switched off by its companies only when it has companies
// and EVERY one of them is Inactive.
export function allCompaniesInactive(companies) {
  return companies.length > 0 && companies.every((c) => c.status === "Inactive");
}

// Does the warehouse share at least one company with `userCompanyIds`?
export function sharesCompany(companies, userCompanyIds) {
  return companies.some((c) => userCompanyIds.includes(c.id));
}

// Warehouse ids (from `warehouseIds`, or all of them) linked with any of these companies.
export async function warehouseIdsForCompanies(companyIds, warehouseIds = null) {
  if (!companyIds.length) return [];
  const rows = await prisma.warehouse.findMany({
    where: {
      AND: [
        warehouseCompanyWhere(companyIds),
        ...(warehouseIds ? [{ id: { in: warehouseIds } }] : []),
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// Replaces the warehouse's linked companies with `companyIds` (inside a transaction client).
export async function setWarehouseCompanies(db, warehouseId, companyIds) {
  await db.warehouseCompanyLink.deleteMany({
    where: { warehouseId, companyId: { notIn: companyIds } },
  });
  await db.warehouseCompanyLink.createMany({
    data: companyIds.map((companyId) => ({ warehouseId, companyId })),
    skipDuplicates: true,
  });
}
