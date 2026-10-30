import apiClient from "../../services/apiClient";
import { handleSignedUrl } from "../shared/fileActions";

// Thin wrappers around /api/transfers - the transfer pages keep their data in local state,
// so nothing here touches the Redux store.

const messageOf = (err, fallback) => err?.response?.data?.message || fallback;

export async function fetchTransferOptions() {
  try {
    const { data } = await apiClient.get("/api/transfers/options");
    return data.data;
  } catch (err) {
    throw new Error(messageOf(err, "Failed to load companies and warehouses"));
  }
}

// Stock (with serial numbers) the company holds in the warehouse it sends from.
export async function fetchTransferStock({ companyId, warehouseId }) {
  try {
    const { data } = await apiClient.get("/api/transfers/stock", { params: { companyId, warehouseId } });
    return data.data || [];
  } catch (err) {
    throw new Error(messageOf(err, "Failed to load stock"));
  }
}

// files = [{ docCategory, file }] picked in the Documents section. With files the request is multipart
// (payload + categories + files, same shape as the outward dispatch); without files it is plain JSON.
// Serial numbers in stock for ONE model: { [stockType]: [serialNo, ...] } (loaded when the model is picked).
export async function fetchTransferSerials({ companyId, warehouseId, category, sku }) {
  try {
    const { data } = await apiClient.get("/api/transfers/serials", { params: { companyId, warehouseId, category, sku } });
    return data.data || {};
  } catch (err) {
    throw new Error(messageOf(err, "Failed to load serial numbers"));
  }
}

export async function createTransfer(payload, files = []) {
  try {
    if (!files.length) {
      const { data } = await apiClient.post("/api/transfers", payload);
      return data.data;
    }
    const formData = new FormData();
    formData.append("payload", JSON.stringify(payload));
    formData.append("categories", JSON.stringify(files.map((f) => f.docCategory)));
    files.forEach((f) => formData.append("files", f.file));
    const { data } = await apiClient.post("/api/transfers", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120000,
    });
    return data.data;
  } catch (err) {
    throw new Error(messageOf(err, "Failed to transfer stock"));
  }
}

// Adds documents to an existing transfer. files = [{ docCategory, file }]
export async function uploadTransferDocuments(id, files) {
  try {
    const formData = new FormData();
    formData.append("categories", JSON.stringify(files.map((f) => f.docCategory)));
    files.forEach((f) => formData.append("files", f.file));
    await apiClient.post(`/api/transfers/${id}/documents`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120000,
    });
  } catch (err) {
    throw new Error(messageOf(err, "Failed to upload documents"));
  }
}

export async function fetchTransfers(params) {
  try {
    const { data } = await apiClient.get("/api/transfers", { params });
    return { rows: data.data || [], pagination: data.pagination || null };
  } catch (err) {
    throw new Error(messageOf(err, "Failed to load transfers"));
  }
}

export async function fetchTransferById(id) {
  try {
    const { data } = await apiClient.get(`/api/transfers/${id}`);
    return data.data;
  } catch (err) {
    throw new Error(messageOf(err, "Failed to load transfer"));
  }
}

// Opens (mode "view") or saves (mode "download") one document of a transfer.
export async function openTransferDocument(documentId, mode = "view") {
  try {
    const { data } = await apiClient.get(`/api/transfers/documents/${documentId}/download`, {
      params: mode === "download" ? { download: 1 } : undefined,
    });
    const url = data.data?.url;
    if (!url) throw new Error("Download URL was not generated.");
    handleSignedUrl(url, mode);
  } catch (err) {
    throw new Error(messageOf(err, err.message || "Unable to open the document"));
  }
}
