import prisma from "../config/prisma.js";

// =====================================================
// Multi-company helpers.
//
// A user can now belong to MANY companies through the
// UserCompany join table. `User.companyId` is kept as the
// user's "primary" company so anything that still reads it
// keeps working; it is always one of the companies in the list.
// =====================================================

// Nested select used everywhere a user is loaded.
export const USER_COMPANIES_SELECT = {
  select: {
    company: {
      select: { id: true, name: true, code: true, status: true },
    },
  },
  orderBy: { createdAt: "asc" },
};

/**
 * Reads the requested companies from a request body.
 *
 *   { companyIds: [a, b] }  -> [a, b]
 *   { companyId: a }        -> [a]        (old single-company clients)
 *   neither key present     -> undefined  (caller decides: "leave as is")
 */
export function parseCompanyIds(body = {}) {
  let raw;

  if (Array.isArray(body.companyIds)) {
    raw = body.companyIds;
  } else if (body.companyId) {
    raw = [body.companyId];
  } else {
    return undefined;
  }

  return [
    ...new Set(
      raw
        .filter((id) => typeof id === "string" && id.trim())
        .map((id) => id.trim())
    ),
  ];
}

// Returns the ids from `ids` that don't exist as companies.
export async function findMissingCompanyIds(ids, db = prisma) {
  if (!ids.length) return [];

  const found = await db.company.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });

  const foundIds = new Set(found.map((c) => c.id));
  return ids.filter((id) => !foundIds.has(id));
}

// Keeps the old single `companyId` pointing at a company the user still has.
export function pickPrimaryCompanyId(companyIds, currentPrimaryId) {
  if (!companyIds.length) return null;
  return companyIds.includes(currentPrimaryId) ? currentPrimaryId : companyIds[0];
}

/**
 * Flattens the join rows into the shape the frontend uses:
 *
 *   companies:  [{ id, name, code, status }]
 *   companyIds: [id, ...]
 *   companyId / company: the primary company (backward compatible)
 */
export function shapeUser(user) {
  if (!user) return user;

  const { companies: links, ...rest } = user;

  let companies = (links || []).map((link) => link.company).filter(Boolean);

  // Rows created before the UserCompany backfill only have the old
  // single company — show it instead of an empty list.
  if (!companies.length && rest.company) {
    companies = [rest.company];
  }

  const primary =
    companies.find((c) => c.id === rest.companyId) || companies[0] || null;

  return {
    ...rest,
    companyId: primary?.id ?? rest.companyId ?? null,
    company: primary
      ? { id: primary.id, name: primary.name, code: primary.code }
      : null,
    companies,
    companyIds: companies.map((c) => c.id),
  };
}

// Is this user a member of the given company?
export async function userBelongsToCompany(user, companyId) {
  if (!companyId) return false;
  if (user.companyId === companyId) return true;

  const link = await prisma.userCompany.findUnique({
    where: { userId_companyId: { userId: user.id, companyId } },
    select: { userId: true },
  });

  return Boolean(link);
}
