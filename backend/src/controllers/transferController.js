import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { supabase, SUPABASE_BUCKET } from "../config/supabase.js";
import { sanitizeCategory } from "./documentController.js";
import { getUserCompanyIds, isFinanceSide } from "../utils/outwardWorkflow.js";
import { WAREHOUSE_COMPANIES_SELECT, shapeWarehouse, getWarehouseCompanies } from "../utils/warehouseCompanies.js";
import { INWARD, canonicalInwardType } from "../utils/serialSources.js";
import { stockKey } from "../utils/stock.js";
import { getLocationStock, TYPE_LABELS } from "../utils/transferStock.js";

/**
 * =========================================================
 * STOCK TRANSFER  (company A / warehouse  ->  company B / warehouse)
 * =========================================================
 * Moves stock from one company's stock to another company's stock. Nothing is stored as a balance: the Stock
 * Ledger, the outward form's stock list and the serial rules all read the transfer rows (see utils/stock.js,
 * utils/serialSources.js, controllers/reportController.js).
 *
 *   GET  /api/transfers/options   companies + warehouses the form can offer
 *   GET  /api/transfers/stock     stock (and serial numbers) the chosen company has in the chosen warehouse
 *   POST /api/transfers           make a transfer
 *   GET  /api/transfers           list of transfers
 *   GET  /api/transfers/:id       one transfer with its items and serial numbers
 *
 * Who: the ACCOUNT team (from a company they belong to) and the SUPER_ADMIN (from any company) make transfers. Everyone who can see the Stock Ledger
 * can view the transfer list, limited to their own scope.
 * =========================================================
 */

const httpError = (status, message) => Object.assign(new Error(message), { status });
const fail = (res, error, fallback) => {
  if (!error.status) console.error(fallback, error);
  return res.status(error.status || 500).json({ message: error.status ? error.message : fallback, error: error.status ? undefined : error.message });
};
const eq = (name) => ({ equals: String(name || "").trim(), mode: "insensitive" });

// ---------------------------------------------------
// Reference documents + uploaded documents of a transfer
// ---------------------------------------------------
// Reference documents (type + number) are saved as a list on the transfer (StockTransfer.referenceDocuments, Json).
// Uploaded files are saved as Document rows with linkedType "transfer" and linkedId = the transfer id.
export const TRANSFER_REF_TYPES = ["E-way Bill", "Invoice", "DC Challan", "Bilty", "Other"];

function cleanReferences(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const refDocType = TRANSFER_REF_TYPES.find((t) => t.toLowerCase() === String(raw?.refDocType || "").trim().toLowerCase());
    const refDocNumber = String(raw?.refDocNumber || "").trim().slice(0, 80);
    if (!refDocType) { if (refDocNumber) throw httpError(422, "Select a valid reference document type"); continue; }
    if (!refDocNumber) continue; // a row with no number is just an empty row
    out.push({ refDocType, refDocNumber });
  }
  return out;
}

// Files go to storage first (in parallel), in transfers/<random id>/. Nothing is kept if one of them fails.
async function storeTransferFiles(files, categories) {
  if (!files.length) return { keys: [], documents: [] };
  const folder = `transfers/${crypto.randomUUID()}/`;
  const stamp = Date.now();
  const prepared = files.map((file, index) => {
    const docCategory = sanitizeCategory(categories[index]);
    const clean = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
    const extension = clean.includes(".") ? clean.split(".").pop().toLowerCase() : "file";
    const base = docCategory.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "document";
    const fileKey = `${folder}${base}-${stamp}-${index}-${Math.round(Math.random() * 1e6)}.${extension}`;
    return { file, docCategory, fileKey };
  });

  const results = await Promise.all(
    prepared.map(async (p) => {
      const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(p.fileKey, p.file.buffer, {
        contentType: p.file.mimetype, cacheControl: "3600", upsert: false,
      });
      return error || null;
    })
  );
  const failed = results.find(Boolean);
  const keys = prepared.map((p) => p.fileKey);
  if (failed) {
    await removeStoredFiles(prepared.filter((_, i) => !results[i]).map((p) => p.fileKey));
    throw httpError(500, `Failed to upload file: ${failed.message}`);
  }
  return {
    keys,
    documents: prepared.map((p) => ({ docCategory: p.docCategory, fileKey: p.fileKey, fileType: p.file.mimetype, fileSize: p.file.size })),
  };
}

const removeStoredFiles = async (keys) => {
  if (keys?.length) await supabase.storage.from(SUPABASE_BUCKET).remove(keys).catch(() => {});
};

async function managedWarehouseIds(user) {
  const grants = await prisma.warehouseAccess.findMany({
    where: { userId: user.id, accessLevel: "MANAGE" },
    select: { warehouseId: true },
  });
  return grants.map((g) => g.warehouseId);
}

// The Account team and the Super Admin make stock transfers.
const canMakeTransfer = (role) => role === "ACCOUNT" || role === "SUPER_ADMIN";

// Throws unless this user may send stock out of this company's stock in this warehouse.
// Account users: only a company they belong to, and only a warehouse linked with that company.
// Super admin: any company, but still only a warehouse linked with that company.
async function assertCanSendFrom(user, { companyId, warehouseId }) {
  if (!canMakeTransfer(user.role)) throw httpError(403, "Only the Account team or Super Admin can transfer stock");
  if (user.role !== "SUPER_ADMIN") {
    const companyIds = await getUserCompanyIds(user);
    if (!companyIds.includes(companyId)) throw httpError(403, "You can only send stock of your own company");
  }
  const linked = await getWarehouseCompanies(warehouseId);
  if (!linked.some((c) => c.id === companyId)) throw httpError(403, "This warehouse is not linked with the company you are sending from");
}

// =====================================================
// GET /api/transfers/options
// =====================================================
export async function getTransferOptions(req, res) {
  try {
    const user = req.user;
    const [companies, warehouseRows] = await Promise.all([
      prisma.company.findMany({ select: { id: true, name: true, code: true, status: true }, orderBy: { name: "asc" } }),
      prisma.warehouse.findMany({
        select: {
          id: true, name: true, code: true, companyId: true,
          company: { select: { id: true, name: true, code: true, status: true } },
          companyLinks: WAREHOUSE_COMPANIES_SELECT,
        },
        orderBy: { name: "asc" },
      }),
    ]);

    const activeCompanies = companies.filter((c) => c.status !== "Inactive");
    const warehouses = warehouseRows.map((w) => {
      const shaped = shapeWarehouse(w);
      return { id: shaped.id, name: shaped.name, code: shaped.code, companyIds: shaped.companyIds };
    });

    // The receiving side can be any active company and any warehouse linked to it.
    const toCompanies = activeCompanies.map((c) => ({ id: c.id, name: c.name, code: c.code }));
    const toWarehouses = warehouses;

    // Sending side: only the companies the Account user belongs to, and the warehouses linked with them.
    let fromCompanies = [];
    let fromWarehouses = [];
    if (canMakeTransfer(user.role)) {
      const companyIds = user.role === "SUPER_ADMIN" ? toCompanies.map((c) => c.id) : await getUserCompanyIds(user);
      fromCompanies = toCompanies.filter((c) => companyIds.includes(c.id));
      fromWarehouses = warehouses.filter((w) => fromCompanies.some((c) => w.companyIds.includes(c.id)));
    }

    return res.json({
      data: { canTransfer: canMakeTransfer(user.role), fromCompanies, fromWarehouses, toCompanies, toWarehouses },
    });
  } catch (error) {
    return fail(res, error, "Failed to load transfer options");
  }
}

// =====================================================
// GET /api/transfers/stock?companyId=&warehouseId=
// =====================================================
export async function getTransferStock(req, res) {
  try {
    const { companyId, warehouseId } = req.query;
    if (!companyId || !warehouseId) throw httpError(400, "Company and warehouse are required");
    await assertCanSendFrom(req.user, { companyId, warehouseId });

    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    if (!company) throw httpError(404, "Company not found");

    // The list opens without serial numbers (fast); they are loaded for one model at a time (GET /serials).
    const { rows } = await getLocationStock(prisma, { warehouseId, companyName: company.name, withSerials: false });
    return res.json({ data: rows });
  } catch (error) {
    return fail(res, error, "Failed to load stock");
  }
}

// =====================================================
// GET /api/transfers/serials?companyId=&warehouseId=&category=&sku=
// Serial numbers in stock for ONE model: { [stockType]: [serialNo, ...] }
// =====================================================
export async function getTransferSerials(req, res) {
  try {
    const { companyId, warehouseId, category, sku } = req.query;
    if (!companyId || !warehouseId || !category || !sku) throw httpError(400, "Company, warehouse, category and model are required");
    await assertCanSendFrom(req.user, { companyId, warehouseId });
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    if (!company) throw httpError(404, "Company not found");
    const { rows } = await getLocationStock(prisma, { warehouseId, companyName: company.name, products: [{ category, sku }] });
    const data = {};
    rows.forEach((r) => { data[r.stockType] = r.serialNos; });
    return res.json({ data });
  } catch (error) {
    return fail(res, error, "Failed to load serial numbers");
  }
}

// =====================================================
// POST /api/transfers
// body: {
//   fromCompanyId, fromWarehouseId, toCompanyId, toWarehouseId, remarks,
//   items: [{ category, sku, stockType, quantity, serialNos: [..] }]
// }
//   quantity = every unit sent (units with a serial number + units without one).
//   serialNos = the serial numbers among them. An item whose stock has no serial numbers sends quantity only.
// =====================================================
export async function createTransfer(req, res) {
  try {
    // JSON body, or multipart: payload (JSON string) + files + categories (JSON array, one name per file).
    let body = req.body || {};
    let categories = [];
    if (typeof body.payload === "string") {
      try {
        categories = JSON.parse(body.categories || "[]");
        body = JSON.parse(body.payload);
      } catch {
        throw httpError(422, "Invalid transfer data");
      }
    }
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length !== categories.length) throw httpError(422, "Each document needs a name");
    const referenceDocuments = cleanReferences(body.referenceDocuments);
    const { fromCompanyId, fromWarehouseId, toCompanyId, toWarehouseId } = body;
    const remarks = String(body.remarks || "").trim().slice(0, 500) || null;

    if (!fromCompanyId || !fromWarehouseId) throw httpError(422, "Select the company and warehouse you are sending from");
    if (!toCompanyId || !toWarehouseId) throw httpError(422, "Select the company and warehouse you are sending to");
    if (fromCompanyId === toCompanyId && fromWarehouseId === toWarehouseId) {
      throw httpError(422, "Sending and receiving company + warehouse cannot be the same");
    }
    if (!Array.isArray(body.items) || !body.items.length) throw httpError(422, "Add at least one item");

    await assertCanSendFrom(req.user, { companyId: fromCompanyId, warehouseId: fromWarehouseId });

    const [companies, warehouses] = await Promise.all([
      prisma.company.findMany({ where: { id: { in: [fromCompanyId, toCompanyId] } }, select: { id: true, name: true, status: true } }),
      prisma.warehouse.findMany({ where: { id: { in: [fromWarehouseId, toWarehouseId] } }, select: { id: true, name: true } }),
    ]);
    const fromCompany = companies.find((c) => c.id === fromCompanyId);
    const toCompany = companies.find((c) => c.id === toCompanyId);
    const fromWarehouse = warehouses.find((w) => w.id === fromWarehouseId);
    const toWarehouse = warehouses.find((w) => w.id === toWarehouseId);
    if (!fromCompany || !toCompany) throw httpError(404, "Company not found");
    if (!fromWarehouse || !toWarehouse) throw httpError(404, "Warehouse not found");
    if (fromCompany.status === "Inactive" || toCompany.status === "Inactive") throw httpError(422, "An inactive company cannot send or receive stock");

    // Each warehouse must really belong to the company chosen with it.
    const [fromLinked, toLinked] = await Promise.all([getWarehouseCompanies(fromWarehouseId), getWarehouseCompanies(toWarehouseId)]);
    if (!fromLinked.some((c) => c.id === fromCompanyId)) throw httpError(422, `${fromWarehouse.name} is not linked with ${fromCompany.name}`);
    if (!toLinked.some((c) => c.id === toCompanyId)) throw httpError(422, `${toWarehouse.name} is not linked with ${toCompany.name}`);

    // ---- clean the items: one entry per category + model + stock type ----
    const wanted = new Map(); // key|type -> { category, sku, stockType, quantity, serialNos: [] }
    for (const raw of body.items) {
      const category = String(raw?.category || "").trim();
      const sku = String(raw?.sku || "").trim();
      const quantity = Number(raw?.quantity);
      if (!category || !sku) throw httpError(422, "Every item needs a category and a model");
      if (!Number.isInteger(quantity) || quantity <= 0) throw httpError(422, `${sku}: quantity must be a whole number above 0`);
      const stockType = canonicalInwardType(raw?.stockType) || INWARD.NEW;
      const serialNos = (Array.isArray(raw?.serialNos) ? raw.serialNos : []).map((s) => String(s ?? "").trim()).filter(Boolean);
      const k = `${stockKey(category, sku)}|${stockType}`;
      const entry = wanted.get(k) || { category, sku, stockType, quantity: 0, serialNos: [] };
      entry.quantity += quantity;
      entry.serialNos.push(...serialNos);
      wanted.set(k, entry);
    }

    // Documents are stored first; the transfer and the document rows are then saved together in one transaction.
    const stored = await storeTransferFiles(files, categories);
    let created;
    try {
      created = await createWithNumber(req, {
        fromCompany, toCompany, fromWarehouse, toWarehouse, remarks, wanted: [...wanted.values()],
        referenceDocuments, documents: stored.documents,
      });
    } catch (error) {
      await removeStoredFiles(stored.keys); // nothing was saved, so do not leave the files behind
      throw error;
    }

    return res.status(201).json({ message: "Stock transferred", data: created });
  } catch (error) {
    return fail(res, error, "Failed to transfer stock");
  }
}

async function createWithNumber(req, { fromCompany, toCompany, fromWarehouse, toWarehouse, remarks, wanted, referenceDocuments = [], documents = [] }) {
  const MAX_ATTEMPTS = 10;
  let sequence = (await prisma.stockTransfer.count()) + 1;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const transferNumber = `TRF-${String(sequence).padStart(4, "0")}`;
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Stock is read inside the transaction, right before it is written.
          const { rows } = await getLocationStock(tx, { warehouseId: fromWarehouse.id, companyName: fromCompany.name, products: wanted.map((w) => ({ category: w.category, sku: w.sku })) });
          const stock = new Map(rows.map((r) => [`${stockKey(r.category, r.sku)}|${r.stockType}`, r]));

          const itemRows = [];
          const serialRows = [];
          const usedSerials = new Set();

          for (const want of wanted) {
            const k = `${stockKey(want.category, want.sku)}|${want.stockType}`;
            const line = stock.get(k);
            const label = `"${want.sku}" (${want.category}, ${TYPE_LABELS[want.stockType] || want.stockType})`;
            if (!line) throw httpError(422, `${label} is not in ${fromCompany.name}'s stock in ${fromWarehouse.name}`);
            if (want.quantity > line.available) {
              throw httpError(422, `${label}: requested ${want.quantity}, only ${line.available} available`);
            }

            // Serial numbers: ones recorded in this stock are matched ignoring case. A serial that was never recorded at
            // inward is accepted too (same as the outward form) unless that unit has already left (outward / transfer).
            const inStock = new Map(line.serialNos.map((s) => [s.toLowerCase(), s]));
            const picked = [];
            const unrecorded = [];
            for (const sn of want.serialNos) {
              const lowered = sn.toLowerCase();
              if (usedSerials.has(`${stockKey(want.category, want.sku)}|${lowered}`)) throw httpError(422, `Serial number "${sn}" is entered more than once`);
              usedSerials.add(`${stockKey(want.category, want.sku)}|${lowered}`);
              const real = inStock.get(lowered);
              if (real) picked.push(real);
              else unrecorded.push(sn);
            }
            if (unrecorded.length) {
              const sameProduct = { category: eq(want.category), sku: eq(want.sku) };
              const anyOf = unrecorded.map((sn) => ({ serialNo: eq(sn) }));
              const [gone, moved, received] = await Promise.all([
                tx.minSerial.findFirst({ where: { OR: anyOf, ...sameProduct, min: { status: { not: "REJECTED" } } }, select: { serialNo: true } }),
                tx.stockTransferSerial.findFirst({ where: { OR: anyOf, ...sameProduct }, select: { serialNo: true } }),
                tx.grnSerial.findFirst({ where: { OR: anyOf, ...sameProduct }, select: { serialNo: true } }),
              ]);
              const bad = gone || moved || received;
              if (bad) throw httpError(422, `Serial number "${bad.serialNo}" is not in ${fromCompany.name}'s ${TYPE_LABELS[want.stockType] || ""} stock of ${want.sku} in ${fromWarehouse.name}`);
            }
            const allPicked = [...picked, ...unrecorded];
            if (allPicked.length > want.quantity) throw httpError(422, `${want.sku}: more serial numbers (${allPicked.length}) than quantity (${want.quantity})`);

            // Units that are not a recorded serial: only as many as the stock really has without one.
            const plain = want.quantity - picked.length;
            const plainAvailable = Math.max(line.available - line.serialNos.length, 0);
            if (plain > plainAvailable) {
              throw httpError(
                422,
                plainAvailable === 0
                  ? `${label}: select the serial numbers to send (every unit in stock has a serial number)`
                  : `${label}: only ${plainAvailable} unit${plainAvailable === 1 ? "" : "s"} without serial number available - select serial numbers for the rest`
              );
            }

            itemRows.push({ category: line.category, sku: line.sku, uom: line.uom, quantity: want.quantity, stockType: want.stockType });
            allPicked.forEach((serialNo) => serialRows.push({ category: line.category, sku: line.sku, serialNo, stockType: want.stockType, source: "MANUAL" }));
          }

          const transfer = await tx.stockTransfer.create({
            data: {
              transferNumber,
              fromCompanyId: fromCompany.id, fromCompanyName: fromCompany.name,
              fromWarehouseId: fromWarehouse.id, fromWarehouseName: fromWarehouse.name,
              toCompanyId: toCompany.id, toCompanyName: toCompany.name,
              toWarehouseId: toWarehouse.id, toWarehouseName: toWarehouse.name,
              remarks,
              ...(referenceDocuments.length ? { referenceDocuments } : {}),
              createdById: req.user.id,
              createdByName: req.user.name || null,
              items: { createMany: { data: itemRows } },
              ...(serialRows.length ? { serials: { createMany: { data: serialRows } } } : {}),
            },
            select: { id: true, transferNumber: true },
          });

          if (documents.length) {
            await tx.document.createMany({
              data: documents.map((d) => ({
                linkedType: "transfer", linkedId: transfer.id, docCategory: d.docCategory,
                fileKey: d.fileKey, fileType: d.fileType, fileSize: d.fileSize, uploadedById: req.user.id,
              })),
            });
          }
          return transfer;
        },
        { maxWait: 10000, timeout: 30000 }
      );
    } catch (error) {
      const clash = error?.code === "P2002" && String(error?.meta?.target ?? "").includes("transferNumber");
      if (clash && attempt < MAX_ATTEMPTS) { sequence += 1; continue; }
      throw error;
    }
  }
  throw httpError(500, "Could not generate a transfer number, please try again");
}

// ---------------------------------------------------
// Which transfers this user may see.
// ---------------------------------------------------
async function scopeWhere(user) {
  if (user.role === "SUPER_ADMIN") return {};
  if (user.role === "WAREHOUSE_MANAGER") {
    const ids = await managedWarehouseIds(user);
    return { OR: [{ fromWarehouseId: { in: ids } }, { toWarehouseId: { in: ids } }] };
  }
  if (isFinanceSide(user.role)) {
    const ids = await getUserCompanyIds(user);
    return { OR: [{ fromCompanyId: { in: ids } }, { toCompanyId: { in: ids } }] };
  }
  return { id: "__none__" };
}

// =====================================================
// GET /api/transfers?search=&companyId=&warehouseId=&dateFrom=&dateTo=&page=&pageSize=
//   companyId / warehouseId match either side of the transfer.
// =====================================================
export async function listTransfers(req, res) {
  try {
    const { search = "", companyId, warehouseId, dateFrom, dateTo, page = "1", pageSize = "20" } = req.query;
    const term = String(search).trim();

    const and = [await scopeWhere(req.user)];
    if (companyId) and.push({ OR: [{ fromCompanyId: companyId }, { toCompanyId: companyId }] });
    if (warehouseId) and.push({ OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] });
    if (dateFrom || dateTo) {
      and.push({
        createdAt: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999`) } : {}),
        },
      });
    }
    if (term) {
      const like = { contains: term, mode: "insensitive" };
      and.push({
        OR: [
          { transferNumber: like },
          { fromCompanyName: like },
          { toCompanyName: like },
          { fromWarehouseName: like },
          { toWarehouseName: like },
          { items: { some: { OR: [{ sku: like }, { category: like }] } } },
          { serials: { some: { serialNo: like } } },
        ],
      });
    }
    const where = { AND: and };

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const size = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);

    const [total, rows] = await Promise.all([
      prisma.stockTransfer.count({ where }),
      prisma.stockTransfer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * size,
        take: size,
        select: {
          id: true, transferNumber: true, createdAt: true, remarks: true, createdByName: true,
          fromCompanyId: true, fromCompanyName: true, fromWarehouseId: true, fromWarehouseName: true,
          toCompanyId: true, toCompanyName: true, toWarehouseId: true, toWarehouseName: true,
          items: { select: { category: true, sku: true, uom: true, quantity: true, stockType: true } },
          _count: { select: { serials: true } },
        },
      }),
    ]);

    const data = rows.map(({ _count, items, ...row }) => ({
      ...row,
      items: items.map((i) => ({ ...i, stockTypeLabel: TYPE_LABELS[canonicalInwardType(i.stockType)] || i.stockType })),
      totalQuantity: items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0),
      serialCount: _count.serials,
    }));

    return res.json({
      data,
      pagination: { page: pageNum, pageSize: size, total, totalPages: Math.ceil(total / size) || 1 },
    });
  } catch (error) {
    return fail(res, error, "Failed to load transfers");
  }
}

// =====================================================
// GET /api/transfers/:id
// =====================================================
export async function getTransferById(req, res) {
  try {
    const transfer = await prisma.stockTransfer.findFirst({
      where: { AND: [{ id: req.params.id }, await scopeWhere(req.user)] },
      include: {
        items: { orderBy: { category: "asc" } },
        serials: { orderBy: { serialNo: "asc" } },
      },
    });
    if (!transfer) throw httpError(404, "Transfer not found");

    const documents = await prisma.document.findMany({
      where: { linkedType: "transfer", linkedId: transfer.id },
    });

    const withLabel = (row) => ({ ...row, stockTypeLabel: TYPE_LABELS[canonicalInwardType(row.stockType)] || row.stockType });
    return res.json({
      data: {
        ...transfer,
        referenceDocuments: Array.isArray(transfer.referenceDocuments) ? transfer.referenceDocuments : [],
        items: transfer.items.map(withLabel),
        serials: transfer.serials.map(withLabel),
        documents,
      },
    });
  } catch (error) {
    return fail(res, error, "Failed to load transfer");
  }
}

// =====================================================
// GET /api/transfers/documents/:docId/download   (?download=1 forces a file download)
// Same visibility as the transfer itself.
// =====================================================
export async function downloadTransferDocument(req, res) {
  try {
    const document = await prisma.document.findFirst({ where: { id: req.params.docId, linkedType: "transfer" } });
    if (!document) throw httpError(404, "Document not found");
    const transfer = await prisma.stockTransfer.findFirst({
      where: { AND: [{ id: document.linkedId }, await scopeWhere(req.user)] },
      select: { id: true },
    });
    if (!transfer) throw httpError(404, "Document not found");

    const asDownload = req.query.download === "1" || req.query.download === "true";
    const fileName = String(document.fileKey).split("/").pop() || "document";
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(document.fileKey, 60 * 5, asDownload ? { download: fileName } : undefined);
    if (error) throw httpError(500, "Failed to create download link");
    return res.json({ message: "Download link created", data: { url: data.signedUrl } });
  } catch (error) {
    return fail(res, error, "Failed to download document");
  }
}
