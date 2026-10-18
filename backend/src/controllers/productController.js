import prisma from "../config/prisma.js";

/**
 * =========================================================
 * PRODUCT MASTER
 * =========================================================
 *
 * A product is a (category, sku) pair, e.g. ("Inverter", "GW5000-DNS").
 *
 *   - Everyone who is logged in can LIST products, because the
 *     inward / outward forms need them for the item dropdowns.
 *   - SUPER_ADMIN and WAREHOUSE_MANAGER can CREATE products (managers
 *     do it from the "Add" button on the inward form).
 *   - Only SUPER_ADMIN can edit or delete them.
 *   All of this is enforced in productRoutes.js.
 *
 * GRN / outward items keep category + sku as plain text, so:
 *   - deleting a product never damages past entries, and
 *   - editing a product's category / SKU renames it on past
 *     entries as well, so stock ledger totals stay in one row.
 * =========================================================
 */

const MAX_LENGTH = 100;

const PRODUCT_SELECT = {
  id: true,
  category: true,
  sku: true,
  createdAt: true,
  updatedAt: true,
};

// Trim + collapse repeated spaces.
const clean = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

function validate(category, sku) {
  if (!category) return "Item category is required";
  if (!sku) return "SKU / module name is required";
  if (category.length > MAX_LENGTH) return `Category must be ${MAX_LENGTH} characters or less`;
  if (sku.length > MAX_LENGTH) return `SKU / module name must be ${MAX_LENGTH} characters or less`;
  return null;
}

// If this category already exists with different capitalisation
// ("inverter" vs "Inverter"), reuse the existing spelling so the
// same category never shows up twice in dropdowns.
async function canonicalCategory(client, category, excludeId) {
  const existing = await client.product.findFirst({
    where: {
      category: { equals: category, mode: "insensitive" },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { category: true },
  });
  return existing ? existing.category : category;
}

async function findDuplicate(client, category, sku, excludeId) {
  return client.product.findFirst({
    where: {
      category: { equals: category, mode: "insensitive" },
      sku: { equals: sku, mode: "insensitive" },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true },
  });
}

// GET /api/products?search=&category=
// Any authenticated user.
export async function listProducts(req, res) {
  try {
    const search = clean(req.query.search);
    const category = clean(req.query.category);

    const where = {};

    if (category) {
      where.category = { equals: category, mode: "insensitive" };
    }

    if (search) {
      where.OR = [
        { category: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
      ];
    }

    const products = await prisma.product.findMany({
      where,
      select: PRODUCT_SELECT,
      orderBy: [{ category: "asc" }, { sku: "asc" }],
    });

    return res.json({ data: products });
  } catch (error) {
    console.error("List products error:", error);
    return res.status(500).json({
      message: "Something went wrong while fetching products",
    });
  }
}

// POST /api/products
// SUPER_ADMIN and WAREHOUSE_MANAGER.
export async function createProduct(req, res) {
  try {
    const rawCategory = clean(req.body.category);
    const sku = clean(req.body.sku);

    const problem = validate(rawCategory, sku);
    if (problem) return res.status(400).json({ message: problem });

    const category = await canonicalCategory(prisma, rawCategory);

    if (await findDuplicate(prisma, category, sku)) {
      return res.status(409).json({
        message: `"${sku}" already exists in ${category}`,
      });
    }

    const product = await prisma.product.create({
      data: { category, sku },
      select: PRODUCT_SELECT,
    });

    return res.status(201).json({
      message: "Product created successfully",
      product,
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "This product already exists" });
    }
    console.error("Create product error:", error);
    return res.status(500).json({
      message: "Something went wrong while creating the product",
    });
  }
}

// PATCH /api/products/:id
// SUPER_ADMIN only.
export async function updateProduct(req, res) {
  try {
    const { id } = req.params;

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: "Product not found" });
    }

    const rawCategory =
      req.body.category !== undefined ? clean(req.body.category) : existing.category;
    const sku = req.body.sku !== undefined ? clean(req.body.sku) : existing.sku;

    const problem = validate(rawCategory, sku);
    if (problem) return res.status(400).json({ message: problem });

    const category = await canonicalCategory(prisma, rawCategory, id);

    if (await findDuplicate(prisma, category, sku, id)) {
      return res.status(409).json({
        message: `"${sku}" already exists in ${category}`,
      });
    }

    const from = { category: existing.category, sku: existing.sku };
    const to = { category, sku };
    const renamed = from.category !== to.category || from.sku !== to.sku;

    const product = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: to,
        select: PRODUCT_SELECT,
      });

      // Keep past inward / outward items pointing at the same product.
      if (renamed) {
        await tx.grnItem.updateMany({ where: from, data: to });
        await tx.minItem.updateMany({ where: from, data: to });
      }

      return updated;
    });

    return res.json({
      message: "Product updated successfully",
      product,
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "This product already exists" });
    }
    console.error("Update product error:", error);
    return res.status(500).json({
      message: "Something went wrong while updating the product",
    });
  }
}

// DELETE /api/products/:id
// SUPER_ADMIN only.
// Past GRN / outward entries keep their item text, so nothing else is touched.
export async function deleteProduct(req, res) {
  try {
    const { id } = req.params;

    const existing = await prisma.product.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ message: "Product not found" });
    }

    await prisma.product.delete({ where: { id } });

    return res.json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Delete product error:", error);
    return res.status(500).json({
      message: "Something went wrong while deleting the product",
    });
  }
}
