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
  // Real server-side pagination (page/pageSize as requested, total/totalPages
  // as returned by the backend) - the list only ever holds ONE page of rows.
  listPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },

  // detail page
  current: null,
  detailStatus: "idle",
  detailError: null,

  // create form
  createStatus: "idle",
  createError: null,
  lastCreatedGrn: null,

  // per-document-category upload flag, used on the
  // create form where docs upload right after GRN creation
  uploadingDocs: {}, // { [docCategory]: boolean }
  models: [],
  modelsStatus: "idle",
  companies: [],
  companiesStatus: "idle",

  // per-documentId action flag, used on the detail page
  docActionStatus: {}, // { [documentId]: "uploading" | "downloading" | "deleting" }

  // activity/history panel on the detail page
  history: [],
  historyStatus: "idle",
  historyError: null,
};

// -------------------------------------------------
// Thunks
// -------------------------------------------------

import { handleSignedUrl } from "../shared/fileActions";
export const fetchInwardList = createAsyncThunk(
  "inward/fetchList",
  async (
    { warehouseId, search, type, dateFrom, dateTo, page = 1, pageSize = 20 } = {},
    { rejectWithValue }
  ) => {
    try {
      const { data } = await apiClient.get("/api/grn", {
        params: {
          ...(warehouseId ? { warehouseId } : {}),
          ...(search ? { search } : {}),
          ...(type ? { type } : {}),
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
          page,
          pageSize,
        },
      });

      const grns = Array.isArray(data)
        ? data
        : Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.grns)
        ? data.grns
        : [];

      return { grns, pagination: data.pagination || null };
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to fetch inward entries"
      );
    }
  },
  { condition: makeFetchGuard("inward", (s) => s.listStatus === "loading") }
);

export const fetchInwardById = createAsyncThunk(
  "inward/fetchById",
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get(`/api/grn/${id}`);
      return data.data || data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to load inward"
      );
    }
  }
);

export const updateInward = createAsyncThunk(
  "inward/update",
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.put(`/api/grn/${id}`, payload);
      return data;
    } catch (err) {
      return rejectWithValue({
        status: err.response?.status,
        message: err.response?.data?.message || "Failed to update inward entry",
        errors: err.response?.data?.errors,
      });
    }
  }
);

export const createInward = createAsyncThunk(
  "inward/create",
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post("/api/grn", payload);
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

// Used both by the create-form (right after GRN creation)
// and the detail page (uploading a missing required doc).
export const uploadInwardDocument = createAsyncThunk(
  "inward/uploadDocument",
  async ({ grnId, file, docCategory }, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("docCategory", docCategory);

      const { data } = await apiClient.post(
        `/api/grn/${grnId}/documents`,
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

export const downloadInwardDocument = createAsyncThunk(
  "inward/downloadDocument",
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

export const deleteInwardDocument = createAsyncThunk(
  "inward/deleteDocument",
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


export const createInwardModel = createAsyncThunk(
  "inward/createModel",
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post("/api/grn/models", payload);
      return data.data || data;
    } catch (err) {
      return rejectWithValue({ status: err.response?.status, message: err.response?.data?.message || "Failed to create model" });
    }
  }
);

export const fetchInwardModels = createAsyncThunk(
  "inward/fetchModels",
  async (warehouseId, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get("/api/grn/models", { params: { warehouseId } });
      return Array.isArray(data) ? data : data.data || data.models || [];
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to fetch models");
    }
  }
);

// Companies (brands/manufacturers) tagged per item - separate from the
// tenant "Company" used for account/warehouse ownership.
export const fetchInwardCompanies = createAsyncThunk(
  "inward/fetchCompanies",
  async (warehouseId, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get("/api/grn/companies", { params: { warehouseId } });
      return Array.isArray(data) ? data : data.data || data.companies || [];
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to fetch companies");
    }
  }
);

export const createInwardCompany = createAsyncThunk(
  "inward/createCompany",
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post("/api/grn/companies", payload);
      return data.data || data;
    } catch (err) {
      return rejectWithValue({ status: err.response?.status, message: err.response?.data?.message || "Failed to create company" });
    }
  }
);

export const fetchInwardHistory = createAsyncThunk(
  "inward/fetchHistory",
  async ({ warehouseId, search, from, to, pageSize } = {}, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get(`/api/grn/history`, {
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

const inwardSlice = createSlice({
  name: "inward",
  initialState,
  reducers: {
    clearCurrentInward: (state) => {
      state.current = null;
      state.detailStatus = "idle";
      state.detailError = null;
      state.docActionStatus = {};
    },
    resetCreateStatus: (state) => {
      state.createStatus = "idle";
      state.createError = null;
      state.lastCreatedGrn = null;
      state.uploadingDocs = {};
    },
  },
  extraReducers: (builder) => {
    builder
      // ---------------- list ----------------
      .addCase(fetchInwardList.pending, (state, action) => {
        markPending(state, action.meta.arg);
        state.listStatus = "loading";
        state.listError = null;
      })
      .addCase(fetchInwardList.fulfilled, (state, action) => {
        markLoaded(state);
        state.listStatus = "succeeded";
        state.list = action.payload.grns;
        if (action.payload.pagination) {
          state.listPagination = action.payload.pagination;
        }
      })
      .addCase(fetchInwardList.rejected, (state, action) => {
        markFailed(state);
        state.listStatus = "failed";
        state.listError = action.payload;
      })

      // ---------------- detail ----------------
      .addCase(fetchInwardModels.pending, (state) => {
      state.modelsStatus = "loading";
    })
    .addCase(fetchInwardModels.fulfilled, (state, action) => {
      state.modelsStatus = "succeeded";
      state.models = action.payload;
    })
    .addCase(fetchInwardModels.rejected, (state) => {
      state.modelsStatus = "failed";
    })

      // ---------------- companies ----------------
      .addCase(fetchInwardCompanies.pending, (state) => {
        state.companiesStatus = "loading";
      })
      .addCase(fetchInwardCompanies.fulfilled, (state, action) => {
        state.companiesStatus = "succeeded";
        state.companies = action.payload;
      })
      .addCase(fetchInwardCompanies.rejected, (state) => {
        state.companiesStatus = "failed";
      })
      .addCase(createInwardCompany.fulfilled, (state, action) => {
        const name = action.payload?.name;
        if (name && !state.companies.some((c) => c.name === name)) {
          state.companies.push(action.payload);
        }
      })

      .addCase(fetchInwardById.pending, (state) => {
        state.detailStatus = "loading";
        state.detailError = null;
      })
      .addCase(fetchInwardById.fulfilled, (state, action) => {
        state.detailStatus = "succeeded";
        state.current = action.payload;
      })
      .addCase(fetchInwardById.rejected, (state, action) => {
        state.detailStatus = "failed";
        state.detailError = action.payload;
      })

      // ---------------- update ----------------
      .addCase(updateInward.pending, (state) => {
        state.createStatus = "loading";
        state.createError = null;
      })
      .addCase(updateInward.fulfilled, (state, action) => {
        state.createStatus = "succeeded";
        state.current = action.payload.data || action.payload;
      })
      .addCase(updateInward.rejected, (state, action) => {
        state.createStatus = "failed";
        state.createError = action.payload;
      })

      // ---------------- create ----------------
      .addCase(createInward.pending, (state) => {
        state.createStatus = "loading";
        state.createError = null;
      })
      .addCase(createInward.fulfilled, (state, action) => {
        state.createStatus = "succeeded";
        state.lastCreatedGrn = action.payload.data || action.payload;
      })
      .addCase(createInward.rejected, (state, action) => {
        state.createStatus = "failed";
        state.createError = action.payload;
      })

      // ---------------- upload document ----------------
      .addCase(uploadInwardDocument.pending, (state, action) => {
        const { docCategory } = action.meta.arg;
        state.uploadingDocs[docCategory] = true;
      })
      .addCase(uploadInwardDocument.fulfilled, (state, action) => {
        const { docCategory, document } = action.payload;
        state.uploadingDocs[docCategory] = false;

        if (state.current) {
          state.current.documents = [
            ...(state.current.documents || []),
            document,
          ];
        }
      })
      .addCase(uploadInwardDocument.rejected, (state, action) => {
        const docCategory =
          action.payload?.docCategory || action.meta.arg.docCategory;
        state.uploadingDocs[docCategory] = false;
      })

      // ---------------- download document ----------------
      .addCase(downloadInwardDocument.pending, (state, action) => {
        state.docActionStatus[action.meta.arg.documentId] = "downloading";
      })
      .addCase(downloadInwardDocument.fulfilled, (state, action) => {
        delete state.docActionStatus[action.payload.documentId];
      })
      .addCase(downloadInwardDocument.rejected, (state, action) => {
        const id = action.payload?.documentId || action.meta.arg.documentId;
        delete state.docActionStatus[id];
      })

      // ---------------- delete document ----------------
      .addCase(deleteInwardDocument.pending, (state, action) => {
        state.docActionStatus[action.meta.arg.documentId] = "deleting";
      })
      .addCase(deleteInwardDocument.fulfilled, (state, action) => {
        const { documentId } = action.payload;
        delete state.docActionStatus[documentId];

        if (state.current) {
          state.current.documents = (state.current.documents || []).filter(
            (doc) => doc.id !== documentId
          );
        }
      })
      .addCase(deleteInwardDocument.rejected, (state, action) => {
        const id = action.payload?.documentId || action.meta.arg.documentId;
        delete state.docActionStatus[id];
      })

      // ---------------- history ----------------
      .addCase(fetchInwardHistory.pending, (state) => {
        state.historyStatus = "loading";
        state.historyError = null;
      })
      .addCase(fetchInwardHistory.fulfilled, (state, action) => {
        state.historyStatus = "succeeded";
        state.history = action.payload;
      })
      .addCase(fetchInwardHistory.rejected, (state, action) => {
        state.historyStatus = "failed";
        state.historyError = action.payload;
      })

      // Anything saved / changed => the cached list is out of date.
      .addMatcher(
        isAnyOf(createInward.fulfilled, updateInward.fulfilled, uploadInwardDocument.fulfilled, deleteInwardDocument.fulfilled, sessionChanged),
        (state) => { bumpVersion(state); }
      );
  },
});

export const { clearCurrentInward, resetCreateStatus } = inwardSlice.actions;

// -------------------------------------------------
// Selectors
// -------------------------------------------------

export const selectInwardList = (state) => state.inward.list;
export const selectInwardListStatus = (state) => state.inward.listStatus;
export const selectInwardListError = (state) => state.inward.listError;
export const selectInwardListPagination = (state) => state.inward.listPagination;

export const selectCurrentInward = (state) => state.inward.current;
export const selectInwardDetailStatus = (state) => state.inward.detailStatus;
export const selectInwardDetailError = (state) => state.inward.detailError;

export const selectCreateStatus = (state) => state.inward.createStatus;
export const selectCreateError = (state) => state.inward.createError;
export const selectLastCreatedGrn = (state) => state.inward.lastCreatedGrn;

export const selectUploadingDocs = (state) => state.inward.uploadingDocs;
export const selectInwardModels = (state) => state.inward.models;
export const selectInwardModelsStatus = (state) => state.inward.modelsStatus;
export const selectInwardCompanies = (state) => state.inward.companies;
export const selectInwardCompaniesStatus = (state) => state.inward.companiesStatus;
export const selectDocActionStatus = (state) => state.inward.docActionStatus;

export const selectInwardHistory = (state) => state.inward.history;
export const selectInwardHistoryStatus = (state) => state.inward.historyStatus;

export default inwardSlice.reducer;
