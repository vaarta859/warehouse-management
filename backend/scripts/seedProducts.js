/**
 * One-time helper: fills the new Product table from the items that
 * already exist in your database, so the inward / outward dropdowns
 * are not empty the moment you deploy.
 *
 * It reads distinct (category, sku) pairs from:
 *   - past GRN items
 *   - past outward items
 *   - the old per-warehouse model list (WarehouseModel)
 *
 * Safe to run more than once - products that already exist are skipped.
 *
 * Run from the backend folder:
 *   node scripts/seedProducts.js
 */
import "dotenv/config";
import prisma from "../src/config/prisma.js";

const norm = (v) => String(v || "").replace(/\s+/g, " ").trim();
const keyOf = (category, sku) => `${category.toLowerCase()}::${sku.toLowerCase()}`;

async function main() {
  const [grn, min, models, existing] = await Promise.all([
    prisma.grnItem.groupBy({ by: ["category", "sku"] }),
    prisma.minItem.groupBy({ by: ["category", "sku"] }),
    prisma.warehouseModel.findMany({ select: { category: true, name: true } }),
    prisma.product.findMany({ select: { category: true, sku: true } }),
  ]);

  const pairs = [
    ...grn.map((r) => ({ category: r.category, sku: r.sku })),
    ...min.map((r) => ({ category: r.category, sku: r.sku })),
    ...models.map((r) => ({ category: r.category, sku: r.name })),
  ];

  // First spelling of a category wins, so "Inverters" and "inverters"
  // don't become two categories.
  const categoryCase = new Map();
  for (const p of existing) categoryCase.set(p.category.toLowerCase(), p.category);

  const seen = new Set(existing.map((p) => keyOf(p.category, p.sku)));
  const toCreate = [];

  for (const pair of pairs) {
    const rawCategory = norm(pair.category);
    const sku = norm(pair.sku);
    if (!rawCategory || !sku) continue;

    const lower = rawCategory.toLowerCase();
    if (!categoryCase.has(lower)) categoryCase.set(lower, rawCategory);
    const category = categoryCase.get(lower);

    const key = keyOf(category, sku);
    if (seen.has(key)) continue;

    seen.add(key);
    toCreate.push({ category, sku });
  }

  if (!toCreate.length) {
    console.log("Nothing to add - product list is already up to date.");
    return;
  }

  const result = await prisma.product.createMany({ data: toCreate, skipDuplicates: true });
  console.log(`Added ${result.count} product(s).`);
}

main()
  .catch((err) => {
    console.error("Seeding products failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
