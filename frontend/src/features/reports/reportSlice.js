import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import apiClient from "../../services/apiClient";

// -------------------------------------------------
// Initial state
// -------------------------------------------------

const initialState = {
  // Quick Summary cards
  summary: null,
  summaryStatus: "idle", // idle | loading | succeeded | failed
  summaryError: null,

  // Recent ledger entries table
  ledger: [],
  ledgerStatus: "idle",
  ledgerError: null,

  // Stock Ledger page (per-item detail)
  stockLedger: [],
  stockLedgerTotals: null,
  stockLedgerPagination: null,
  stockLedgerStatus: "idle",
  stockLedgerError: null,
  // id of the newest stock-ledger request, so a slow response for an
  // earlier company / warehouse choice can't overwrite the current one
  stockLedgerRequestId: null,
};

// -------------------------------------------------
// Thunks
// -------------------------------------------------

export const fetchReportSummary = createAsyncThunk(
  "reports/fetchSummary",
  async ({ warehouseId, dateFrom, dateTo } = {}, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get("/api/reports/summary", {
        params: { warehouseId, dateFrom, dateTo },
      });
      return data.data || data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to load report summary"
      );
    }
  }
);

export const fetchReportLedger = createAsyncThunk(
  "reports/fetchLedger",
  async ({ warehouseId, dateFrom, dateTo, limit } = {}, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get("/api/reports/ledger", {
        params: { warehouseId, dateFrom, dateTo, limit },
      });
      return Array.isArray(data) ? data : data.data || [];
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to load recent ledger entries"
      );
    }
  }
);

export const fetchStockLedger = createAsyncThunk(
  "reports/fetchStockLedger",
  // warehouseId -> that warehouse; companyId only -> that company's warehouses;
  // neither -> total stock across everything the user can see.
  async ({ warehouseId, companyId, search, page, pageSize } = {}, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get("/api/reports/stock-ledger", {
        params: { warehouseId, companyId, search, page, pageSize },
      });
      return {
        rows: data.data || [],
        totals: data.totals || null,
        pagination: data.pagination || null,
      };
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to load stock ledger"
      );
    }
  }
);

// -------------------------------------------------
// Slice
// -------------------------------------------------

const reportSlice = createSlice({
  name: "reports",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      // ---------------- summary ----------------
      .addCase(fetchReportSummary.pending, (state) => {
        state.summaryStatus = "loading";
        state.summaryError = null;
      })
      .addCase(fetchReportSummary.fulfilled, (state, action) => {
        state.summaryStatus = "succeeded";
        state.summary = action.payload;
      })
      .addCase(fetchReportSummary.rejected, (state, action) => {
        state.summaryStatus = "failed";
        state.summaryError = action.payload;
      })

      // ---------------- ledger ----------------
      .addCase(fetchReportLedger.pending, (state) => {
        state.ledgerStatus = "loading";
        state.ledgerError = null;
      })
      .addCase(fetchReportLedger.fulfilled, (state, action) => {
        state.ledgerStatus = "succeeded";
        state.ledger = action.payload;
      })
      .addCase(fetchReportLedger.rejected, (state, action) => {
        state.ledgerStatus = "failed";
        state.ledgerError = action.payload;
      })

      // ---------------- stock ledger ----------------
      .addCase(fetchStockLedger.pending, (state, action) => {
        state.stockLedgerStatus = "loading";
        state.stockLedgerError = null;
        state.stockLedgerRequestId = action.meta.requestId;
      })
      .addCase(fetchStockLedger.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.stockLedgerRequestId) return; // out of date
        state.stockLedgerStatus = "succeeded";
        state.stockLedger = action.payload.rows;
        state.stockLedgerTotals = action.payload.totals;
        state.stockLedgerPagination = action.payload.pagination;
      })
      .addCase(fetchStockLedger.rejected, (state, action) => {
        if (action.meta.requestId !== state.stockLedgerRequestId) return; // out of date
        state.stockLedgerStatus = "failed";
        state.stockLedgerError = action.payload;
      });
  },
});

// -------------------------------------------------
// Selectors
// -------------------------------------------------

export const selectReportSummary = (state) => state.reports.summary;
export const selectReportSummaryStatus = (state) => state.reports.summaryStatus;
export const selectReportSummaryError = (state) => state.reports.summaryError;

export const selectReportLedger = (state) => state.reports.ledger;
export const selectReportLedgerStatus = (state) => state.reports.ledgerStatus;
export const selectReportLedgerError = (state) => state.reports.ledgerError;

export const selectStockLedger = (state) => state.reports.stockLedger;
export const selectStockLedgerTotals = (state) => state.reports.stockLedgerTotals;
export const selectStockLedgerPagination = (state) => state.reports.stockLedgerPagination;
export const selectStockLedgerStatus = (state) => state.reports.stockLedgerStatus;
export const selectStockLedgerError = (state) => state.reports.stockLedgerError;

export default reportSlice.reducer;
