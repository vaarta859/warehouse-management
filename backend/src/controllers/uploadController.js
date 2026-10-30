import prisma from "../config/prisma.js";
import { getWarehouseCompanies, sharesCompany } from "../utils/warehouseCompanies.js";
import { getUserCompanyIds, outwardFolder, tempProofFolder } from "../utils/outwardWorkflow.js";
import {
  supabase,
  SUPABASE_BUCKET,
} from "../config/supabase.js";

export async function uploadFile(
  req,
  res
) {
  try {
    // ==========================================
    // CHECK AUTH
    // ==========================================

    if (!req.user?.id) {
      return res.status(401).json({
        message:
          "Unauthorized. Please login again.",
      });
    }

    // ==========================================
    // CHECK FILE
    // ==========================================

    if (!req.file) {
      return res.status(422).json({
        message:
          "Please select a file.",
      });
    }

    const file =
      req.file;

    // ==========================================
    // FILE DETAILS
    // ==========================================

    const originalName =
      file.originalname;

    const fileType =
      file.mimetype;

    const fileSize =
      file.size;

    // ==========================================
    // SAFE FILE NAME
    // ==========================================

    const cleanFileName =
      originalName
        .replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        )
        .replace(
          /_+/g,
          "_"
        );

    // ==========================================
    // FILE EXTENSION
    // ==========================================

    const extension =
      cleanFileName.includes(".")
        ? cleanFileName
            .split(".")
            .pop()
        : "file";

    // ==========================================
    // WHERE IT GOES: min/<outward number>/payment-<...>.<ext>  (new entry: uploads/<id>/ first)
    // Only this path is saved - there is no temporary copy.
    // ==========================================
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const { warehouseId, companyId, outwardId, kind } = req.body || {};
    const isPi = kind === "pi";
    // "Dispatch directly" has no warehouse: the file is checked against the company instead.
    const direct = !warehouseId && Boolean(companyId);

    if (!UUID_RE.test(String(outwardId || "")) || !UUID_RE.test(String(direct ? companyId : warehouseId || ""))) {
      return res.status(422).json({
        message: direct ? "Select a company before attaching a file." : "Select a warehouse before attaching a file.",
      });
    }

    let existingEntry;
    if (direct) {
      const [company, entry, companyIds] = await Promise.all([
        prisma.company.findUnique({ where: { id: companyId }, select: { id: true } }),
        prisma.min.findUnique({ where: { id: outwardId }, select: { warehouseId: true, directDispatch: true, companyId: true, outwardNumber: true } }),
        req.user.role !== "SUPER_ADMIN" ? getUserCompanyIds(req.user) : Promise.resolve(null),
      ]);
      if (!company) return res.status(404).json({ message: "Company not found" });
      if (companyIds && !companyIds.includes(company.id)) return res.status(403).json({ message: "You are not linked with the selected company" });
      if (entry && !entry.directDispatch) return res.status(400).json({ message: "This outward entry belongs to a warehouse" });
      if (entry && entry.companyId !== company.id && req.user.role !== "SUPER_ADMIN") return res.status(400).json({ message: "This outward entry belongs to a different company" });
      existingEntry = entry;
    } else {
      const [warehouse, entry, companyIds] = await Promise.all([
        prisma.warehouse.findUnique({
          where: { id: warehouseId },
          select: { id: true, code: true, companyId: true },
        }),
        prisma.min.findUnique({ where: { id: outwardId }, select: { warehouseId: true, outwardNumber: true } }),
        req.user.role !== "SUPER_ADMIN" ? getUserCompanyIds(req.user) : Promise.resolve(null),
      ]);
      if (!warehouse) {
        return res.status(404).json({ message: "Warehouse not found" });
      }

      if (companyIds && !sharesCompany(await getWarehouseCompanies(warehouse.id), companyIds)) {
        return res.status(403).json({ message: "You don't have access to this warehouse" });
      }

      // An existing entry must belong to the same warehouse as the folder it is uploaded to.
      if (entry && entry.warehouseId !== warehouse.id) {
        return res.status(400).json({ message: "This outward entry belongs to a different warehouse" });
      }
      existingEntry = entry;
    }

    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const fileName = `${isPi ? "pi" : "payment"}-${uniqueSuffix}.${extension}`;
    // Existing entry (edit): straight into its own folder. New entry: waits in uploads/<id>/ and is
    // moved to min/<outward number>/ when the entry is created.
    const folder = existingEntry ? outwardFolder(existingEntry.outwardNumber) : tempProofFolder(outwardId);
    const fileKey = `${folder}${fileName}`;

    // ==========================================
    // UPLOAD TO SUPABASE
    // ==========================================

    const {
      data,
      error,
    } =
      await supabase.storage
        .from(
          SUPABASE_BUCKET
        )
        .upload(
          fileKey,
          file.buffer,
          {
            contentType:
              fileType,

            cacheControl:
              "3600",

            upsert: false,
          }
        );

    // ==========================================
    // SUPABASE ERROR
    // ==========================================

    if (error) {
      console.error(
        "Supabase upload error:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to upload file.",

        error:
          error.message,
      });
    }

    // ==========================================
    // SUCCESS
    // ==========================================

    return res.status(201).json({
      message:
        "File uploaded successfully",

      data: {
        fileKey:
          data.path,

        // A PI file is saved under the name "PI" (PI.pdf ...) and a payment proof under "payment" (payment.jpg ...).
        fileName:
          `${isPi ? "PI" : "payment"}.${String(extension).toLowerCase()}`,

        fileType,

        fileSize,
      },
    });
  } catch (error) {
    console.error(
      "Upload error:",
      error
    );

    return res.status(500).json({
      message:
        "Failed to upload file.",

      error:
        error.message,
    });
  }
}

/**
 * DELETE /api/upload   body: { fileKey }
 * Removes a payment-proof file that was uploaded but never saved with an entry (the user replaced or
 * removed it before pressing Save). A file that an entry or document still uses is never deleted here.
 */
export async function deleteUploadedFile(req, res) {
  try {
    const fileKey = String(req.body?.fileKey || "");
    const name = fileKey.split("/").pop() || "";
    if (!/^(uploads|min)\//.test(fileKey) || fileKey.includes("..") || !/^(payment|pi)-/.test(name)) {
      return res.status(422).json({ message: "Invalid file." });
    }
    const [inItem, inPi, inDocument] = await Promise.all([
      prisma.minItem.findFirst({ where: { proofFileKey: fileKey }, select: { id: true } }),
      prisma.min.findFirst({ where: { piFileKey: fileKey }, select: { id: true } }),
      prisma.document.findFirst({ where: { fileKey }, select: { id: true } }),
    ]);
    if (inItem || inPi || inDocument) return res.json({ message: "File is in use and was kept." });

    const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove([fileKey]);
    if (error) return res.status(500).json({ message: "Failed to delete the file.", error: error.message });
    return res.json({ message: "File deleted." });
  } catch (error) {
    console.error("DELETE UPLOADED FILE ERROR:", error);
    return res.status(500).json({ message: "Failed to delete the file." });
  }
}
