import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import apiClient from "../../services/apiClient";
import { isAnyOf } from "@reduxjs/toolkit";
import {
  initialCache, makeFetchGuard, markPending, markLoaded, markFailed, bumpVersion, sessionChanged,
} from "../shared/fetchGuard";

// -------------------------------------------------
// Initial state
// -------------------------------------------------

const initialState = {
  ...initialCache,
  // list page
  list: [],
  listStatus: "idle", // idle | loading | succeeded | failed
  listError: null,
  // Real server-side pagination - list only ever holds ONE page of rows.
  listPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },

  // detail page
  current: null,
  detailStatus: "idle",
  detailError: null,

  // create form
  createStatus: "idle",
  createError: null,
  lastCreatedOutward: null,

  // per-document-category upload flag, used on the
  // create form where docs upload right after dispatch creation
  uploadingDocs: {}, // { [docCategory]: boolean }

  // per-documentId action flag, used on the detail page
  docActionStatus: {}, // { [documentId]: "downloading" | "deleting" }
  models: [],
  modelsStatus: "idle",
  companies: [],
  companiesStatus: "idle",

  // activity/history panel on the detail page
  history: [],
  historyStatus: "idle",
  historyError: null,
};

// -------------------------------------------------
// Thunks
// -------------------------------------------------

import { handleSignedUrl } from "../shared/fileActions";
export const fetchOutwardList = createAsyncThunk(
  "outward/fetchList",
  async (
    { warehouseId, search, type, status, dateFrom, dateTo, page = 1, pageSize = 20 } = {},
    { rejectWithValue }
  ) => {
    try {
      const { data } = await apiClient.get("/api/outward", {
        params: {
          ...(warehouseId ? { warehouseId } : {}),
          ...(search ? { search } : {}),
          ...(type ? { type } : {}),
          ...(status ? { status } : {}),
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
          page,
          pageSize,
        },
      });

      const entries = Array.isArray(data)
        ? data
        : Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.outwards)
        ? data.outwards
        : [];

      return { entries, pagination: data.pagination || null };
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to fetch outward entries"
      );
    }
  },
  { condition: makeFetchGuard("outward", (s) => s.listStatus === "loading") }
);

export const fetchOutwardById = createAsyncThunk(
  "outward/fetchById",
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get(`/api/outward/${id}`);
      return data.data || data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to load outward entry"
      );
    }
  }
);

export const fetchOutwardModels = createAsyncThunk(
  "outward/fetchModels",
  async (warehouseId, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get("/api/outward/models", { params: { warehouseId } });
      return Array.isArray(data) ? data : data.data || data.models || [];
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to fetch models");
    }
  }
);

export const createOutwardModel = createAsyncThunk(
  "outward/createModel",
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post("/api/outward/models", payload);
      return data.data || data;
    } catch (err) {
      return rejectWithValue({ status: err.response?.status, message: err.response?.data?.message || "Failed to create model" });
    }
  }
);

// Companies (brands/manufacturers) tagged per item - separate from the
// tenant "Company" used for account/warehouse ownership. Mirrors the
// inward feature's fetchInwardCompanies / createInwardCompany.
export const fetchOutwardCompanies = createAsyncThunk(
  "outward/fetchCompanies",
  async (warehouseId, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get("/api/outward/companies", { params: { warehouseId } });
      return Array.isArray(data) ? data : data.data || data.companies || [];
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to fetch companies");
    }
  }
);

export const createOutwardCompany = createAsyncThunk(
  "outward/createCompany",
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post("/api/outward/companies", payload);
      return data.data || data;
    } catch (err) {
      return rejectWithValue({ status: err.response?.status, message: err.response?.data?.message || "Failed to create company" });
    }
  }
);

export const updateOutward = createAsyncThunk(
  "outward/update",
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.put(`/api/outward/${id}`, payload);
      return data;
    } catch (err) {
      return rejectWithValue({
        status: err.response?.status,
        message: err.response?.data?.message || "Failed to update outward entry",
        errors: err.response?.data?.errors,
      });
    }
  }
);

export const createOutward = createAsyncThunk(
  "outward/create",
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post("/api/outward", payload);
      return data;
    } catch (err) {
      return rejectWithValue({
        status: err.response?.status,
        message: err.response?.data?.message,
        errors: err.response?.data?.errors,
        duplicates: err.response?.data?.duplicates,
      });
    }
  }
);

// -------------------------------------------------
// Workflow thunks
//   Sales   -> uploadOutwardProof (payment proof of an item)
//   Account -> approveOutward / rejectOutward
//   Manager -> dispatchOutward
// -------------------------------------------------

// Uploads one payment-proof file and returns { fileKey, fileName, fileType }.
export const uploadOutwardProof = createAsyncThunk(
  "outward/uploadProof",
  async ({ file, warehouseId, outwardId, kind }, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      // Text fields go first so the server knows the target folder: min/<warehouse>/<outwardId>/
      formData.append("warehouseId", warehouseId);
      formData.append("outwardId", outwardId);
      if (kind) formData.append("kind", kind); // "pi" -> saved as PI.<ext>; no kind -> saved as payment.<ext>
      formData.append("file", file);
      const { data } = await apiClient.post("/api/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const uploaded = data.data || data;
      return { fileKey: uploaded.fileKey, fileName: uploaded.fileName || file.name, fileType: uploaded.fileType || file.type };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to upload the file");
    }
  }
);

// Deletes a payment proof that was uploaded but replaced / removed before the entry was saved.
export const deleteUploadedProof = createAsyncThunk(
  "outward/deleteUploadedProof",
  async ({ fileKey }, { rejectWithValue }) => {
    try {
      await apiClient.delete("/api/upload", { data: { fileKey } });
      return { fileKey };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to delete the file");
    }
  }
);

export const approveOutward = createAsyncThunk(
  "outward/approve",
  async ({ id, remarks }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post(`/api/outward/${id}/approve`, { remarks });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to approve");
    }
  }
);

export const holdOutward = createAsyncThunk(
  "outward/hold",
  async ({ id, remarks }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post(`/api/outward/${id}/hold`, { remarks });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to put on hold");
    }
  }
);

export const rejectOutward = createAsyncThunk(
  "outward/reject",
  async ({ id, remarks }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post(`/api/outward/${id}/reject`, { remarks });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to reject");
    }
  }
);

// `files` (optional): [{ file, docCategory }] - sent in the SAME request as the dispatch details,
// so there is only one round trip instead of one per document.
export const dispatchOutward = createAsyncThunk(
  "outward/dispatch",
  async ({ id, payload, files = [] }, { rejectWithValue }) => {
    try {
      if (!files.length) {
        const { data } = await apiClient.put(`/api/outward/${id}/dispatch`, payload);
        return data;
      }
      const formData = new FormData();
      formData.append("payload", JSON.stringify(payload));
      formData.append("categories", JSON.stringify(files.map((f) => f.docCategory)));
      files.forEach((f) => formData.append("files", f.file));
      const { data } = await apiClient.put(`/api/outward/${id}/dispatch`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to save dispatch details");
    }
  }
);

// Warehouse manager: transportation form (dedicated vehicle OR transporter). Unlocks the account team's documents.
export const saveOutwardTransportation = createAsyncThunk(
  "outward/saveTransportation",
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.put(`/api/outward/${id}/transportation`, payload);
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to save transportation details");
    }
  }
);

// Warehouse manager: receiving details (date, receiver, remarks) together with the picked receiving documents.
export const saveOutwardReceiving = createAsyncThunk(
  "outward/saveReceiving",
  async ({ id, payload, files = [] }, { rejectWithValue }) => {
    try {
      if (!files.length) {
        const { data } = await apiClient.put(`/api/outward/${id}/receiving`, payload);
        return data;
      }
      const formData = new FormData();
      formData.append("payload", JSON.stringify(payload));
      formData.append("categories", JSON.stringify(files.map((f) => f.docCategory)));
      files.forEach((f) => formData.append("files", f.file));
      const { data } = await apiClient.put(`/api/outward/${id}/receiving`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to save receiving details");
    }
  }
);

// Account: saves its own reference documents (invoice / e-way bill / other) together with any picked files.
export const saveAccountDocuments = createAsyncThunk(
  "outward/saveAccountDocuments",
  async ({ id, payload, files = [] }, { rejectWithValue }) => {
    try {
      if (!files.length) {
        const { data } = await apiClient.put(`/api/outward/${id}/account-documents`, payload);
        return data;
      }
      const formData = new FormData();
      formData.append("payload", JSON.stringify(payload));
      formData.append("categories", JSON.stringify(files.map((f) => f.docCategory)));
      files.forEach((f) => formData.append("files", f.file));
      const { data } = await apiClient.put(`/api/outward/${id}/account-documents`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });
      return data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to save documents");
    }
  }
);

// Super admin only: deletes a dispatched outward entry.
export const deleteOutwardEntry = createAsyncThunk(
  "outward/deleteEntry",
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.delete(`/api/outward/${id}`);
      return { id, message: data?.message };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to delete outward entry");
    }
  }
);

// Opens the payment proof of one item in a new tab (Sales / Account / Admin only).
export const downloadItemProof = createAsyncThunk(
  "outward/downloadItemProof",
  async ({ outwardId, itemId, mode = "view" }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get(`/api/outward/${outwardId}/items/${itemId}/proof`, { params: mode === "download" ? { download: 1 } : undefined });
      const url = data.data?.url;
      if (!url) throw new Error("Download URL was not generated.");
      handleSignedUrl(url, mode);
      return { itemId };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message || "Unable to open the proof file.");
    }
  }
);

// Opens the PI (proforma invoice) file of an entry in a new tab (Sales / Account / Admin only).
export const downloadPiFile = createAsyncThunk(
  "outward/downloadPiFile",
  async ({ outwardId, mode = "view" }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get(`/api/outward/${outwardId}/pi-file`, { params: mode === "download" ? { download: 1 } : undefined });
      const url = data.data?.url;
      if (!url) throw new Error("Download URL was not generated.");
      handleSignedUrl(url, mode);
      return { outwardId };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message || "Unable to open the PI file.");
    }
  }
);

// Used both by the create-form (right after dispatch creation)
// and the detail page (uploading a missing required doc).
export const uploadOutwardDocument = createAsyncThunk(
  "outward/uploadDocument",
  async ({ outwardId, file, docCategory }, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("docCategory", docCategory);

      const { data } = await apiClient.post(
        `/api/outward/${outwardId}/documents`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );

      return { docCategory, document: data.data || data };
    } catch (err) {
      return rejectWithValue({
        docCategory,
        message:
          err.response?.data?.message || `${docCategory} could not be uploaded.`,
      });
    }
  }
);

// Document download/delete share the same document
// endpoints the inward feature uses - a document is a
// document regardless of which entry it hangs off of.
export const downloadOutwardDocument = createAsyncThunk(
  "outward/downloadDocument",
  async ({ documentId, mode = "download" }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get(
        `/api/documents/${documentId}/download`,
        { params: mode === "download" ? { download: 1 } : undefined }
      );

      const signedUrl = data.data?.url;

      if (!signedUrl) {
        throw new Error("Download URL was not generated.");
      }

      handleSignedUrl(signedUrl, mode);

      return { documentId };
    } catch (err) {
      return rejectWithValue({
        documentId,
        message:
          err.response?.data?.message || err.message || "Unable to download file.",
      });
    }
  }
);

export const deleteOutwardDocument = createAsyncThunk(
  "outward/deleteDocument",
  async ({ documentId }, { rejectWithValue }) => {
    try {
      await apiClient.delete(`/api/documents/${documentId}`);
      return { documentId };
    } catch (err) {
      return rejectWithValue({
        documentId,
        message: err.response?.data?.message || "Delete failed.",
      });
    }
  }
);

export const fetchOutwardHistory = createAsyncThunk(
  "outward/fetchHistory",
  async ({ warehouseId, search, from, to, pageSize } = {}, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get(`/api/outward/history`, {
        params: { warehouseId, search, from, to, pageSize },
      });
      return Array.isArray(data) ? data : data.data || [];
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to load history"
      );
    }
  }
);

// -------------------------------------------------
// Slice
// -------------------------------------------------

const outwardSlice = createSlice({
  name: "outward",
  initialState,
  reducers: {
    clearCurrentOutward: (state) => {
      state.current = null;
      state.detailStatus = "idle";
      state.detailError = null;
      state.docActionStatus = {};
    },
    resetOutwardCreateStatus: (state) => {
      state.createStatus = "idle";
      state.createError = null;
      state.lastCreatedOutward = null;
      state.uploadingDocs = {};
    },
  },
  extraReducers: (builder) => {
    builder
      // ---------------- list ----------------
      .addCase(fetchOutwardList.pending, (state, action) => {
        markPending(state, action.meta.arg);
        state.listStatus = "loading";
        state.listError = null;
      })
      .addCase(fetchOutwardList.fulfilled, (state, action) => {
        markLoaded(state);
        state.listStatus = "succeeded";
        state.list = action.payload.entries;
        if (action.payload.pagination) {
          state.listPagination = action.payload.pagination;
        }
      })
      .addCase(fetchOutwardList.rejected, (state, action) => {
        markFailed(state);
        state.listStatus = "failed";
        state.listError = action.payload;
      })

      // ---------------- models ----------------
      .addCase(fetchOutwardModels.pending, (state) => {
        state.modelsStatus = "loading";
      })
      .addCase(fetchOutwardModels.fulfilled, (state, action) => {
        state.modelsStatus = "succeeded";
        state.models = action.payload;
      })
      .addCase(fetchOutwardModels.rejected, (state) => {
        state.modelsStatus = "failed";
      })

      // ---------------- companies ----------------
      .addCase(fetchOutwardCompanies.pending, (state) => {
        state.companiesStatus = "loading";
      })
      .addCase(fetchOutwardCompanies.fulfilled, (state, action) => {
        state.companiesStatus = "succeeded";
        state.companies = action.payload;
      })
      .addCase(fetchOutwardCompanies.rejected, (state) => {
        state.companiesStatus = "failed";
      })
      .addCase(createOutwardCompany.fulfilled, (state, action) => {
        const name = action.payload?.name;
        if (name && !state.companies.some((c) => c.name === name)) {
          state.companies.push(action.payload);
        }
      })

      // ---------------- detail ----------------
      .addCase(fetchOutwardById.pending, (state) => {
        state.detailStatus = "loading";
        state.detailError = null;
      })
      .addCase(fetchOutwardById.fulfilled, (state, action) => {
        state.detailStatus = "succeeded";
        state.current = action.payload;
      })
      .addCase(fetchOutwardById.rejected, (state, action) => {
        state.detailStatus = "failed";
        state.detailError = action.payload;
      })

      // After approving, a leftover copy of the entry must not look "pending approval" any more,
      // or the dispatch page would bounce the admin back to the details page.
      .addCase(approveOutward.fulfilled, (state, action) => {
        if (state.current && state.current.id === action.meta.arg.id) {
          state.current.workflowStatus = action.payload?.data?.workflowStatus || "TRANSPORT_PENDING";
        }
      })

      .addCase(holdOutward.fulfilled, (state, action) => {
        if (state.current && state.current.id === action.meta.arg.id) {
          state.current.workflowStatus = "ON_HOLD";
        }
      })

      // Dispatch details saved / updated: the response is the refreshed entry.
      .addCase(dispatchOutward.fulfilled, (state, action) => {
        const entry = action.payload?.data;
        if (entry && state.current && state.current.id === action.meta.arg.id) state.current = entry;
      })

      // Transportation form saved: the response is the refreshed entry.
      .addCase(saveOutwardTransportation.fulfilled, (state, action) => {
        const entry = action.payload?.data;
        if (entry && state.current && state.current.id === action.meta.arg.id) state.current = entry;
      })

      // Receiving details saved: the server only confirms (the screen returns to the list, which reloads).
      .addCase(saveOutwardReceiving.fulfilled, (state, action) => {
        const status = action.payload?.data?.workflowStatus;
        if (status && state.current && state.current.id === action.meta.arg.id) state.current.workflowStatus = status;
      })

      // Account saved its reference documents / files: the response is the refreshed entry.
      .addCase(saveAccountDocuments.fulfilled, (state, action) => {
        const entry = action.payload?.data;
        if (entry && state.current && state.current.id === action.meta.arg.id) state.current = entry;
      })

      // ---------------- update ----------------
      .addCase(updateOutward.pending, (state) => {
        state.createStatus = "loading";
        state.createError = null;
      })
      .addCase(updateOutward.fulfilled, (state, action) => {
        state.createStatus = "succeeded";
        state.current = action.payload.data || action.payload;
        // Force the details page to load the entry again (its status may have changed).
        state.detailStatus = "idle";
      })
      .addCase(updateOutward.rejected, (state, action) => {
        state.createStatus = "failed";
        state.createError = action.payload;
      })

      // ---------------- create ----------------
      .addCase(createOutward.pending, (state) => {
        state.createStatus = "loading";
        state.createError = null;
      })
      .addCase(createOutward.fulfilled, (state, action) => {
        state.createStatus = "succeeded";
        state.lastCreatedOutward = action.payload.data || action.payload;
      })
      .addCase(createOutward.rejected, (state, action) => {
        state.createStatus = "failed";
        state.createError = action.payload;
      })

      // ---------------- upload document ----------------
      .addCase(uploadOutwardDocument.pending, (state, action) => {
        const { docCategory } = action.meta.arg;
        state.uploadingDocs[docCategory] = true;
      })
      .addCase(uploadOutwardDocument.fulfilled, (state, action) => {
        const { docCategory, document } = action.payload;
        state.uploadingDocs[docCategory] = false;

        if (state.current) {
          state.current.documents = [
            ...(state.current.documents || []),
            document,
          ];
        }
      })
      .addCase(uploadOutwardDocument.rejected, (state, action) => {
        const docCategory =
          action.payload?.docCategory || action.meta.arg.docCategory;
        state.uploadingDocs[docCategory] = false;
      })

      // ---------------- download document ----------------
      .addCase(downloadOutwardDocument.pending, (state, action) => {
        state.docActionStatus[action.meta.arg.documentId] = "downloading";
      })
      .addCase(downloadOutwardDocument.fulfilled, (state, action) => {
        delete state.docActionStatus[action.payload.documentId];
      })
      .addCase(downloadOutwardDocument.rejected, (state, action) => {
        const id = action.payload?.documentId || action.meta.arg.documentId;
        delete state.docActionStatus[id];
      })

      // ---------------- delete document ----------------
      .addCase(deleteOutwardDocument.pending, (state, action) => {
        state.docActionStatus[action.meta.arg.documentId] = "deleting";
      })
      .addCase(deleteOutwardDocument.fulfilled, (state, action) => {
        const { documentId } = action.payload;
        delete state.docActionStatus[documentId];

        if (state.current) {
          state.current.documents = (state.current.documents || []).filter(
            (doc) => doc.id !== documentId
          );
        }
      })
      .addCase(deleteOutwardDocument.rejected, (state, action) => {
        const id = action.payload?.documentId || action.meta.arg.documentId;
        delete state.docActionStatus[id];
      })

      // ---------------- history ----------------
      .addCase(fetchOutwardHistory.pending, (state) => {
        state.historyStatus = "loading";
        state.historyError = null;
      })
      .addCase(fetchOutwardHistory.fulfilled, (state, action) => {
        state.historyStatus = "succeeded";
        state.history = action.payload;
      })
      .addCase(fetchOutwardHistory.rejected, (state, action) => {
        state.historyStatus = "failed";
        state.historyError = action.payload;
      })

      // Anything saved / changed => the cached list is out of date.
      .addMatcher(
        isAnyOf(
          createOutward.fulfilled, updateOutward.fulfilled, approveOutward.fulfilled, holdOutward.fulfilled,
          rejectOutward.fulfilled, dispatchOutward.fulfilled, saveOutwardTransportation.fulfilled,
          saveOutwardReceiving.fulfilled, saveAccountDocuments.fulfilled, deleteOutwardEntry.fulfilled,
          uploadOutwardDocument.fulfilled, deleteOutwardDocument.fulfilled, sessionChanged
        ),
        (state) => { bumpVersion(state); }
      );
  },
});

export const { clearCurrentOutward, resetOutwardCreateStatus } = outwardSlice.actions;

// -------------------------------------------------
// Selectors
// -------------------------------------------------

export const selectOutwardList = (state) => state.outward.list;
export const selectOutwardListStatus = (state) => state.outward.listStatus;
export const selectOutwardListError = (state) => state.outward.listError;
export const selectOutwardListPagination = (state) => state.outward.listPagination;

export const selectCurrentOutward = (state) => state.outward.current;
export const selectOutwardDetailStatus = (state) => state.outward.detailStatus;
export const selectOutwardDetailError = (state) => state.outward.detailError;

export const selectOutwardCreateStatus = (state) => state.outward.createStatus;
export const selectOutwardCreateError = (state) => state.outward.createError;
export const selectLastCreatedOutward = (state) => state.outward.lastCreatedOutward;

export const selectOutwardUploadingDocs = (state) => state.outward.uploadingDocs;
export const selectOutwardModels = (state) => state.outward.models;
export const selectOutwardModelsStatus = (state) => state.outward.modelsStatus;
export const selectOutwardCompanies = (state) => state.outward.companies;
export const selectOutwardCompaniesStatus = (state) => state.outward.companiesStatus;
export const selectOutwardDocActionStatus = (state) => state.outward.docActionStatus;

export const selectOutwardHistory = (state) => state.outward.history;
export const selectOutwardHistoryStatus = (state) => state.outward.historyStatus;

export default outwardSlice.reducer;
