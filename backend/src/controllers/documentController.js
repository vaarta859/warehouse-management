import prisma from "../config/prisma.js";
import { getWarehouseCompanies, allCompaniesInactive, sharesCompany } from "../utils/warehouseCompanies.js";
import { supabase, SUPABASE_BUCKET } from "../config/supabase.js";
import { recordAuditLog } from "../utils/auditLog.js";
import { isFinanceSide, getUserCompanyIds, getManagerCompanyIds, WAREHOUSE_VISIBLE_STATUSES, STATUS, outwardFolder, isAccountDocCategory, isInvoiceDocCategory, hasReleaseDocument, ACCOUNT_DOC_STATUSES, isApprovedStatus, isDispatchedStatus, syncApprovedStage } from "../utils/outwardWorkflow.js";
 
// assertLinkedEntryAccess used to be 3 sequential round-trips (entry, then
// its warehouse, then the caller's warehouse access) plus a 4th one later
// just to look up the entry's display number for the audit log - all on
// the hot path of every single document upload/download/delete. The entry
// + warehouse + entry number are fetched together here in one query, and
// the access-grant check (still a separate query - Prisma can't filter an
// arbitrary user's access as part of the same call) is skipped entirely
// for SUPER_ADMIN, who bypasses it anyway.
async function assertLinkedEntryAccess(req, linkedType, linkedId, permission = null, category = null) {
  const model = linkedType === "grn" ? prisma.grn : prisma.min;
  const numberField = linkedType === "grn" ? "grnNumber" : "outwardNumber";

  const entry = await model.findUnique({
    where: { id: linkedId },
    select: {
      id: true,
      warehouseId: true,
      ...(linkedType === "grn" ? {} : { status: true, createdById: true, directDispatch: true, companyId: true }),
      [numberField]: true,
      warehouse: { select: { id: true, code: true, companyId: true, company: { select: { status: true } } } },
    },
  });
  if (!entry) throw Object.assign(new Error(`${linkedType === "grn" ? "GRN" : "Outward entry"} not found.`), { status: 404 });

  // Dispatch directly (outward without a warehouse): access comes from the company. Account manages the documents,
  // Sales can only view them, the warehouse manager has no part in it.
  if (linkedType === "outward" && entry.directDispatch) {
    entry.entryNumber = entry.outwardNumber || entry.id;
    const role = req.user.role;
    if (role === "SUPER_ADMIN") {
      if (!(isApprovedStatus(entry.status) || isDispatchedStatus(entry.status))) {
        throw Object.assign(new Error("Documents are available after approval."), { status: 409 });
      }
      return entry;
    }
    // The warehouse manager can only OPEN (view / download) the documents of a delivered direct entry of his companies.
    if (role === "WAREHOUSE_MANAGER") {
      const managerCompanyIds = await getManagerCompanyIds(req.user);
      if (permission || entry.status !== STATUS.DELIVERED || !entry.companyId || !managerCompanyIds.includes(entry.companyId)) {
        throw Object.assign(new Error("You don't have access to this document."), { status: 403 });
      }
      return entry;
    }
    if (!isFinanceSide(role)) throw Object.assign(new Error("You don't have access to this document."), { status: 403 });
    const companyIds = await getUserCompanyIds(req.user);
    if (!entry.companyId || !companyIds.includes(entry.companyId)) throw Object.assign(new Error("You don't have access to this document."), { status: 403 });
    if (permission) {
      if (role !== "ACCOUNT") throw Object.assign(new Error("You don't have access to this document."), { status: 403 });
      if (!ACCOUNT_DOC_STATUSES.includes(entry.status)) throw Object.assign(new Error("Documents can no longer be changed after the entry is delivered."), { status: 409 });
      if (!isAccountDocCategory(category)) throw Object.assign(new Error("Account can only manage invoice, e-way bill and other account documents."), { status: 403 });
    }
    return entry;
  }

  const warehouse = entry.warehouse;
  if (!warehouse) throw Object.assign(new Error("Warehouse not found."), { status: 404 });
  const warehouseCompanies = await getWarehouseCompanies(warehouse.id);
  if (allCompaniesInactive(warehouseCompanies)) throw Object.assign(new Error("This warehouse belongs to an inactive company."), { status: 403 });

  entry.entryNumber = entry[numberField] || entry.id;
  entry.warehouseCode = warehouse.code;

  if (req.user.role === "SUPER_ADMIN") {
    // The documents section only exists from dispatch details onwards.
    if (linkedType === "outward" && !(isApprovedStatus(entry.status) || isDispatchedStatus(entry.status))) {
      throw Object.assign(new Error("Documents are available after approval."), { status: 409 });
    }
    return entry;
  }

  // Account owns the invoice / e-way bill / other documents of an outward entry: it can open them at any
  // stage, and delete them until the entry is dispatched (uploads travel with PUT /:id/account-documents).
  if (req.user.role === "ACCOUNT" && linkedType === "outward") {
    const companyIds = await getUserCompanyIds(req.user);
    if (!sharesCompany(warehouseCompanies, companyIds)) {
      throw Object.assign(new Error("You don't have access to this document."), { status: 403 });
    }
    if (permission) {
      if (!ACCOUNT_DOC_STATUSES.includes(entry.status)) {
        throw Object.assign(new Error("Documents can no longer be changed after dispatch."), { status: 409 });
      }
      if (!isAccountDocCategory(category)) {
        throw Object.assign(new Error("Account can only manage invoice, e-way bill and other account documents."), { status: 403 });
      }
    } else if (!isDispatchedStatus(entry.status) && !isAccountDocCategory(category)) {
      throw Object.assign(new Error("Dispatch documents are available after dispatch."), { status: 403 });
    }
    return entry;
  }

  // Sales / Account may open (download) inward documents and the dispatch
  // documents of outward entries in their company, but never add or delete them.
  if (isFinanceSide(req.user.role)) {
    const companyIds = await getUserCompanyIds(req.user);
    if (permission || !sharesCompany(warehouseCompanies, companyIds)) {
      throw Object.assign(new Error("You don't have access to this document."), { status: 403 });
    }
    // Sales can open every document of its company's entries at any stage (view only).
    return entry;
  }

  // The warehouse only ever sees outward entries Account has approved.
  if (linkedType === "outward" && !WAREHOUSE_VISIBLE_STATUSES.includes(entry.status)) {
    throw Object.assign(new Error("You don't have access to this warehouse."), { status: 403 });
  }

  // The warehouse manager can add / delete outward documents both before and after dispatch
  // (WAREHOUSE_VISIBLE_STATUSES above already limits this to PENDING_DISPATCH / DISPATCHED).

  const access = await prisma.warehouseAccess.findUnique({
    where: { userId_warehouseId: { userId: req.user.id, warehouseId: entry.warehouseId } },
  });
  if (!access || access.accessLevel !== "MANAGE") throw Object.assign(new Error("You don't have access to this warehouse."), { status: 403 });
  if (permission && !access[permission]) throw Object.assign(new Error("You don't have permission to manage this document."), { status: 403 });
  return entry;
}
 
export function sanitizeCategory(value) {
  return String(value || "Other").replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 80) || "Other";
}
function baseName(category) {
  const c = category.toLowerCase();
  if (c.includes("receiving")) return "receiving";
  if (c.includes("bilty")) return "bilty";
  if (c.includes("without")) return "without-invoice";
  if (c.includes("invoice")) return "invoice";
  if (c.includes("e-way") || c.includes("eway")) return "eway-bill";
  if (c.includes("challan")) return "delivery-challan";
  if (c.includes("dispatch photo") || c.includes("photo")) return "dispatch-photo";
  if (c.includes("sign-off") || c.includes("signoff")) return "unloading-signoff";
  return "document";
}
 

// Uploads the files sent along with the dispatch request, all in parallel, into the outward's own
// folder min/<outward number>/ (same place as the payment proofs). Nothing is kept if any of them fails.
export async function storeOutwardFiles(files, categories, outwardNumber) {
  const folder = outwardFolder(outwardNumber);
  const stamp = Date.now();
  const prepared = files.map((file, index) => {
    const category = sanitizeCategory(categories[index]);
    const clean = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
    const extension = clean.includes(".") ? clean.split(".").pop().toLowerCase() : "file";
    const fileKey = `${folder}${baseName(category)}-${stamp}-${index}-${Math.round(Math.random() * 1e6)}.${extension}`;
    return { file, category, fileKey };
  });

  const results = await Promise.all(
    prepared.map(async (p) => {
      const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(p.fileKey, p.file.buffer, {
        contentType: p.file.mimetype, cacheControl: "3600", upsert: false,
      });
      return error ? { error } : null;
    })
  );
  const failed = results.find(Boolean);
  if (failed) {
    const stored = prepared.filter((_, i) => !results[i]).map((p) => p.fileKey);
    if (stored.length) await supabase.storage.from(SUPABASE_BUCKET).remove(stored).catch(() => {});
    throw Object.assign(new Error(`Failed to upload file: ${failed.error.message}`), { status: 500 });
  }
  return prepared.map((p) => ({
    docCategory: p.category, fileKey: p.fileKey, fileType: p.file.mimetype, fileSize: p.file.size, fileName: p.file.originalname,
  }));
}

// Document.linkedType uses "grn" / "outward"; AuditLog.entityType uses
// "INWARD" / "OUTWARD" — keep the mapping in one place.
const AUDIT_ENTITY_TYPE = { grn: "INWARD", outward: "OUTWARD" };
 
async function uploadLinkedDocument(req, res, linkedType) {
  try {
    if (!req.user?.id) return res.status(401).json({ message: "Unauthorized. Please login again." });
    if (!req.file) return res.status(422).json({ message: "Please select a file." });
 
    const id = req.params.id;
    const permission = linkedType === "grn" ? "canInward" : "canOutward";
    const entry = await assertLinkedEntryAccess(req, linkedType, id, permission);

    // Dispatch documents are saved only once the entry has been dispatched.
    if (linkedType === "outward" && !isDispatchedStatus(entry.status)) {
      return res.status(409).json({ message: "Documents can be saved only after the entry is dispatched." });
    }
 
    const category = sanitizeCategory(req.body.docCategory);
    if (linkedType === "outward" && req.user.role === "WAREHOUSE_MANAGER" && isAccountDocCategory(category)) {
      return res.status(403).json({ message: "Invoice and e-way bill documents are added by the account team." });
    }
    const file = req.file;
    const originalName = file.originalname;
    const fileType = file.mimetype;
    const fileSize = file.size;
    const cleanFileName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
    const extension = cleanFileName.includes(".") ? cleanFileName.split(".").pop().toLowerCase() : "file";
 
    const prefix = linkedType === "grn" ? "GRN" : "MIN";
    const entryNumber = entry.entryNumber;
    // Use a collision-proof suffix instead of a DB count: counting existing
    // docs and using count+1 is a read-then-write race when multiple files
    // are uploaded concurrently (as the frontend does via Promise.all), and
    // it also breaks when the category itself is already unique per file
    // (e.g. "invoice1"/"invoice2"), since baseName() collapses those back
    // down to the same "invoice" prefix — both then computed count=0 and
    // collided on the same storage key, so only the first upload survived.
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    // Outward documents sit in the same folder as the item payment proofs: min/<outward number>/
    const folder = linkedType === "outward" ? outwardFolder(entryNumber) : `${prefix}/${entryNumber}/`;
    const fileKey = `${folder}${baseName(category)}-${uniqueSuffix}.${extension}`;
 
    const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).upload(fileKey, file.buffer, {
      contentType: fileType, cacheControl: "3600", upsert: false,
    });
    if (error) return res.status(500).json({ message: "Failed to upload file.", error: error.message });
 
    const document = await prisma.document.create({
      data: { linkedType, linkedId: id, docCategory: category, fileKey: data.path, fileType, fileSize, uploadedById: req.user.id },
    });
 
    // The audit log write doesn't need to hold up the response - the upload
    // already succeeded and the document row is already saved, so let the
    // caller move on and finish logging in the background. Failures here
    // are logged but never surfaced to the user, same as before.
    recordAuditLog(prisma, {
      entityType: AUDIT_ENTITY_TYPE[linkedType],
      entityId: id,
      entityNumber: entryNumber,
      action: "DOCUMENT_ADDED",
      description: `Document added: ${category} (${originalName})`,
      changes: { docCategory: category, fileName: originalName },
      userId: req.user.id,
      warehouseId: entry.warehouseId,
    }).catch((err) => console.error("Audit log (DOCUMENT_ADDED) failed:", err));
 
    return res.status(201).json({ message: "Document uploaded successfully", data: { ...document, fileName: originalName } });
  } catch (error) {
    console.error(`UPLOAD ${linkedType.toUpperCase()} DOCUMENT ERROR:`, error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to upload document." });
  }
}
 
export function uploadGrnDocument(req, res) { return uploadLinkedDocument(req, res, "grn"); }
export function uploadOutwardDocument(req, res) { return uploadLinkedDocument(req, res, "outward"); }
 
export async function downloadDocument(req, res) {
  try {
    const document = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!document) return res.status(404).json({ message: "Document not found." });
    const linked = await assertLinkedEntryAccess(req, document.linkedType, document.linkedId, null, document.docCategory);
    // The warehouse manager gets every Account document (the Invoice too) once the entry is approved. Checked here too so a direct document id cannot bypass the list.
    if (document.linkedType === "outward" && req.user.role === "WAREHOUSE_MANAGER" && isAccountDocCategory(document.docCategory)) {
      if (!(isApprovedStatus(linked.status) || isDispatchedStatus(linked.status))) {
        return res.status(403).json({ message: "You don't have access to this document." });
      }
    }
    // ?download=1 -> the link forces a file download (Content-Disposition: attachment); otherwise it opens in the browser.
    const asDownload = req.query.download === "1" || req.query.download === "true";
    const fileName = String(document.fileKey).split("/").pop() || "document";
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(document.fileKey, 60 * 5, asDownload ? { download: fileName } : undefined);
    if (error) return res.status(500).json({ message: "Failed to create download link.", error: error.message });
    return res.json({ message: "Download link created", data: { url: data.signedUrl } });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Failed to download document." });
  }
}
 
export async function deleteDocument(req, res) {
  try {
    const document = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!document) return res.status(404).json({ message: "Document not found." });
    const entry = await assertLinkedEntryAccess(req, document.linkedType, document.linkedId, "canManageDocuments", document.docCategory);
    // The warehouse manager can see the account team's documents but never remove them.
    if (document.linkedType === "outward" && req.user.role === "WAREHOUSE_MANAGER" && isAccountDocCategory(document.docCategory)) {
      return res.status(403).json({ message: "Invoice and e-way bill documents are managed by the account team." });
    }
    const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove([document.fileKey]);
    if (error) return res.status(500).json({ message: "Failed to delete file from storage.", error: error.message });
    await prisma.document.delete({ where: { id: document.id } });
    // Account removing its release document sends the entry back from READY_FOR_DISPATCH to DOCS_PENDING.
    if (document.linkedType === "outward") await syncApprovedStage(prisma, document.linkedId).catch((err) => console.error("Stage sync failed:", err));
 
    // Same as upload: the delete already succeeded, so don't make the
    // caller wait on the audit log write too.
    recordAuditLog(prisma, {
      entityType: AUDIT_ENTITY_TYPE[document.linkedType],
      entityId: document.linkedId,
      entityNumber: entry.entryNumber,
      action: "DOCUMENT_REMOVED",
      description: `Document removed: ${document.docCategory}`,
      changes: { docCategory: document.docCategory },
      userId: req.user.id,
      warehouseId: entry.warehouseId,
    }).catch((err) => console.error("Audit log (DOCUMENT_REMOVED) failed:", err));
 
    return res.json({ message: "Document deleted successfully." });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Failed to delete document." });
  }
}
