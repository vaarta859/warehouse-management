import prisma from "../config/prisma.js";

/**
 * =========================================================
 * PRODUCT CATALOG HELPERS
 * =========================================================
 *
 * GRN / outward items store the product's category and SKU as
 * plain strings (so old entries never break if a product is
 * later deleted). These helpers make sure that whatever is
 * being saved on an entry actually exists in the Product
 * master that the admin manages.
 * =========================================================
 */

const keyOf = (category, sku) =>
  `${String(category || "").trim().toLowerCase()}::${String(sku || "").trim().toLowerCase()}`;

/**
 * Returns the items whose (category, sku) is NOT in the product master.
 *
 * `existingItems` is for updates: items that were already on the entry
 * are grandfathered in, so editing an old GRN / outward entry keeps
 * working even if one of its products was deleted from the master since.
 * Only items that are new to the entry have to exist in the master.
 */
export async function findUnknownProducts(items = [], existingItems = []) {
  const grandfathered = new Set(existingItems.map((i) => keyOf(i.category, i.sku)));
  const toCheck = items.filter((i) => !grandfathered.has(keyOf(i.category, i.sku)));
  if (!toCheck.length) return [];

  const categories = [...new Set(toCheck.map((i) => String(i.category).trim()))];

  const products = await prisma.product.findMany({
    where: {
      OR: categories.map((category) => ({
        category: { equals: category, mode: "insensitive" },
      })),
    },
    select: { category: true, sku: true },
  });

  const known = new Set(products.map((p) => keyOf(p.category, p.sku)));
  return toCheck.filter((i) => !known.has(keyOf(i.category, i.sku)));
}

export function unknownProductsMessage(unknown = []) {
  const list = unknown
    .map((i) => `${String(i.sku).trim()} (${String(i.category).trim()})`)
    .join(", ");
  return `These items are not in the product list: ${list}. Ask an admin to add them in Product Management first.`;
}
