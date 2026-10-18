import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import apiClient from "../../services/apiClient";
import { isAnyOf } from "@reduxjs/toolkit";
import {
  initialCache, makeFetchGuard, markPending, markLoaded, markFailed, bumpVersion, sessionChanged,
} from "../shared/fetchGuard";

// =====================================================
// Initial State
// =====================================================

const initialState = {
  ...initialCache,
  // All companies
  list: [],

  selectedCompany: null,

  // Fetch status
  status: "idle",

  // Create / update / delete status
  saveStatus: "idle",

  error: null,
};

// =====================================================
// GET ALL COMPANIES
// GET /api/companies
// =====================================================

export const fetchPublicCompanies = createAsyncThunk(
  "company/fetchPublic",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get("/api/auth/companies");
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to fetch companies"
      );
    }
  }
);

export const fetchCompanies = createAsyncThunk(
  "company/fetchAll",

  async ({ search = "" } = {}, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get("/api/companies", {
        params: { search },
      });

      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to fetch companies"
      );
    }
  },
  { condition: makeFetchGuard("company", (s) => s.status === "loading") }
);

// =====================================================
// CREATE COMPANY
// POST /api/companies
//
// Creates a company master record only.
// Companies do not have login credentials or a company-admin role.
// =====================================================

export const createCompany = createAsyncThunk(
  "company/create",

  async (companyData, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post("/api/companies", companyData);

      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to create company"
      );
    }
  }
);

// =====================================================
// UPDATE COMPANY
// PATCH /api/companies/:id
//
// Updates company master data only.
// =====================================================

export const updateCompany = createAsyncThunk(
  "company/update",

  async ({ id, ...fields }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.patch(`/api/companies/${id}`, fields);

      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to update company"
      );
    }
  }
);

// =====================================================
// DELETE COMPANY
// DELETE /api/companies/:id
// =====================================================

export const deleteCompany = createAsyncThunk(
  "company/delete",
  async (input, { rejectWithValue }) => {
    try {
      const id = typeof input === "string" ? input : input.id;
      const force = typeof input === "object" && input.force;
      await apiClient.delete(`/api/companies/${id}`, {
        params: force ? { force: "true" } : undefined,
      });
      return id;
    } catch (err) {
      return rejectWithValue({
        status: err.response?.status,
        message: err.response?.data?.message || "Failed to delete company",
      });
    }
  }
);

// =====================================================
// COMPANY SLICE
// =====================================================

const companySlice = createSlice({
  name: "company",

  initialState,

  reducers: {
    setSelectedCompany: (state, action) => {
      state.selectedCompany = action.payload;
    },

    clearCompanyError: (state) => {
      state.error = null;
    },
  },

  extraReducers: (builder) => {
    builder
      // =================================================
      // FETCH ALL
      // =================================================

      .addCase(fetchCompanies.pending, (state, action) => {
        markPending(state, action.meta.arg);
        state.status = "loading";
        state.error = null;
      })

      .addCase(fetchCompanies.fulfilled, (state, action) => {
        markLoaded(state);
        state.status = "succeeded";

        // Support either a bare array or { data: [...] } response shapes,
        // same as the users endpoint.
        state.list = Array.isArray(action.payload)
          ? action.payload
          : action.payload?.data || [];
      })

      .addCase(fetchPublicCompanies.fulfilled, (state, action) => {
        state.list = Array.isArray(action.payload)
          ? action.payload
          : action.payload?.data || [];
      })

      .addCase(fetchCompanies.rejected, (state, action) => {
        markFailed(state);
        state.status = "failed";
        state.error = action.payload || "Failed to fetch companies";
      })

      // =================================================
      // CREATE
      // =================================================

      .addCase(createCompany.pending, (state) => {
        state.saveStatus = "loading";
        state.error = null;
      })

      .addCase(createCompany.fulfilled, (state, action) => {
        state.saveStatus = "succeeded";

        const newCompany = action.payload?.company || action.payload;

        if (newCompany?.id) {
          state.list.unshift(newCompany);
        }
      })

      .addCase(createCompany.rejected, (state, action) => {
        state.saveStatus = "failed";
        state.error = action.payload || "Failed to create company";
      })

      // =================================================
      // UPDATE
      // =================================================

      .addCase(updateCompany.pending, (state) => {
        state.saveStatus = "loading";
        state.error = null;
      })

      .addCase(updateCompany.fulfilled, (state, action) => {
        state.saveStatus = "succeeded";

        const updatedCompany = action.payload?.company || action.payload;

        if (!updatedCompany?.id) return;

        const index = state.list.findIndex(
          (company) => company.id === updatedCompany.id
        );

        if (index !== -1) {
          state.list[index] = updatedCompany;
        }
      })

      .addCase(updateCompany.rejected, (state, action) => {
        state.saveStatus = "failed";
        state.error = action.payload || "Failed to update company";
      })

      // =================================================
      // DELETE
      // =================================================

      .addCase(deleteCompany.fulfilled, (state, action) => {
        state.list = state.list.filter(
          (company) => company.id !== action.payload
        );
      })

      .addCase(deleteCompany.rejected, (state, action) => {
        state.error = action.payload || "Failed to delete company";
      })
      .addMatcher(
        isAnyOf(createCompany.fulfilled, updateCompany.fulfilled, deleteCompany.fulfilled, sessionChanged),
        (state) => { bumpVersion(state); }
      );
  },
});

// =====================================================
// ACTIONS
// =====================================================

export const { setSelectedCompany, clearCompanyError } = companySlice.actions;

// =====================================================
// SELECTORS
// =====================================================

export const selectAllCompanies = (state) => state.company.list;
export const selectCompanyStatus = (state) => state.company.status;
export const selectCompanySaveStatus = (state) => state.company.saveStatus;
export const selectCompanyError = (state) => state.company.error;

// =====================================================
// REDUCER
// =====================================================

export default companySlice.reducer;
