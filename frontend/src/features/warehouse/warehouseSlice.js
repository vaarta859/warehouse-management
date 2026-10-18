import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import apiClient from "../../services/apiClient";
import { isAnyOf } from "@reduxjs/toolkit";
import {
  initialCache, makeFetchGuard, markPending, markLoaded, markFailed, bumpVersion, sessionChanged,
} from "../shared/fetchGuard";

const API_URL = "/api/warehouses";

export const fetchWarehouses = createAsyncThunk(
  "warehouse/fetchAll",
  async ({ search = "", companyId } = {}, { rejectWithValue }) => {
    try {
      const params = { search };
      if (companyId) params.companyId = companyId;
      const { data } = await apiClient.get(API_URL, { params });
      return Array.isArray(data) ? data : data?.data || [];
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch warehouses"
      );
    }
  },
  { condition: makeFetchGuard("warehouse", (s) => s.loading) }
);

export const fetchWarehouseById = createAsyncThunk(
  "warehouse/fetchById",
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get(`${API_URL}/${id}`);
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch warehouse"
      );
    }
  }
);

export const createWarehouse = createAsyncThunk(
  "warehouse/create",
  async (warehouseData, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post(API_URL, warehouseData);
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to create warehouse"
      );
    }
  }
);

export const updateWarehouse = createAsyncThunk(
  "warehouse/update",
  async ({ id, ...updates }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.put(`${API_URL}/${id}`, updates);
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to update warehouse"
      );
    }
  }
);

export const toggleInwardStatus = createAsyncThunk(
  "warehouse/toggleInward",
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.patch(`${API_URL}/${id}/inward`);
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to update inward status"
      );
    }
  }
);

export const toggleOutwardStatus = createAsyncThunk(
  "warehouse/toggleOutward",
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.patch(`${API_URL}/${id}/outward`);
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to update outward status"
      );
    }
  }
);

// Kept as a compatibility helper for older components. It toggles Inward.
export const toggleWarehouseStatus = toggleInwardStatus;

export const deleteWarehouse = createAsyncThunk(
  "warehouse/delete",
  async ({ id, force = false }, { rejectWithValue }) => {
    try {
      await apiClient.delete(`${API_URL}/${id}`, {
        params: force ? { force: "true" } : undefined,
      });
      return id;
    } catch (error) {
      return rejectWithValue({
        status: error.response?.status,
        message: error.response?.data?.message || "Failed to delete warehouse",
      });
    }
  }
);

export const fetchWarehouseAccess = createAsyncThunk(
  "warehouse/fetchAccess",
  async (warehouseId, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get(`${API_URL}/${warehouseId}/access`);
      return { warehouseId, access: data?.data || [] };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch warehouse access"
      );
    }
  }
);

export const grantWarehouseAccess = createAsyncThunk(
  "warehouse/grantAccess",
  async ({ warehouseId, userId, canInward, canOutward, canManageDocuments }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.put(`${API_URL}/${warehouseId}/access`, {
        userId,
        canInward,
        canOutward,
        canManageDocuments,
      });
      return { warehouseId, access: data.access };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to grant warehouse access"
      );
    }
  }
);

export const revokeWarehouseAccess = createAsyncThunk(
  "warehouse/revokeAccess",
  async ({ warehouseId, userId }, { rejectWithValue }) => {
    try {
      await apiClient.delete(`${API_URL}/${warehouseId}/access/${userId}`);
      return { warehouseId, userId };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to revoke warehouse access"
      );
    }
  }
);

// Restore the manager's last navbar choice after a page reload. It is checked
// against the freshly fetched warehouse list in fetchWarehouses.fulfilled, so a
// stale entry (other user / revoked access) falls back to the first warehouse.
const getStoredSelectedWarehouse = () => {
  try {
    return JSON.parse(localStorage.getItem("selectedWarehouse")) || null;
  } catch {
    return null;
  }
};

const initialState = {
  ...initialCache,
  list: [],
  selectedWarehouse: getStoredSelectedWarehouse(),
  loading: false,
  error: null,
  access: [],
  accessLoading: false,
};

const upsertWarehouse = (state, warehouse) => {
  if (!warehouse?.id) return;
  const index = state.list.findIndex((item) => item.id === warehouse.id);
  if (index === -1) state.list.unshift(warehouse);
  else state.list[index] = warehouse;
};

const warehouseSlice = createSlice({
  name: "warehouse",
  initialState,
  reducers: {
    setSelectedWarehouse: (state, action) => {
      state.selectedWarehouse = action.payload;
      if (action.payload) {
        localStorage.setItem("selectedWarehouse", JSON.stringify(action.payload));
      } else {
        localStorage.removeItem("selectedWarehouse");
      }
    },
    clearWarehouseError: (state) => {
      state.error = null;
    },
    clearWarehouseAccess: (state) => {
      state.access = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchWarehouses.pending, (state, action) => {
        markPending(state, action.meta.arg);
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchWarehouses.fulfilled, (state, action) => {
        markLoaded(state);
        state.loading = false;
        state.list = action.payload;
        const stored = state.selectedWarehouse;
        const matched = stored && state.list.find((item) => item.id === stored.id);
        if (matched) {
          state.selectedWarehouse = matched;
        } else if (state.list.length > 0) {
          state.selectedWarehouse = state.list[0];
          localStorage.setItem("selectedWarehouse", JSON.stringify(state.list[0]));
        } else if (stored) {
          state.selectedWarehouse = null;
          localStorage.removeItem("selectedWarehouse");
        }
      })
      .addCase(fetchWarehouses.rejected, (state, action) => {
        markFailed(state);
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchWarehouseById.fulfilled, (state, action) => {
        state.selectedWarehouse = action.payload;
        upsertWarehouse(state, action.payload);
      })
      .addCase(createWarehouse.fulfilled, (state, action) => {
        upsertWarehouse(state, action.payload);
      })
      .addCase(createWarehouse.rejected, (state, action) => {
        state.error = action.payload;
      })
      .addCase(updateWarehouse.fulfilled, (state, action) => {
        state.selectedWarehouse = action.payload;
        upsertWarehouse(state, action.payload);
      })
      .addCase(updateWarehouse.rejected, (state, action) => {
        state.error = action.payload;
      })
      .addCase(toggleInwardStatus.fulfilled, (state, action) => {
        state.selectedWarehouse = action.payload;
        upsertWarehouse(state, action.payload);
      })
      .addCase(toggleOutwardStatus.fulfilled, (state, action) => {
        state.selectedWarehouse = action.payload;
        upsertWarehouse(state, action.payload);
      })
      .addCase(toggleInwardStatus.rejected, (state, action) => {
        state.error = action.payload;
      })
      .addCase(toggleOutwardStatus.rejected, (state, action) => {
        state.error = action.payload;
      })
      .addCase(deleteWarehouse.fulfilled, (state, action) => {
        state.list = state.list.filter((item) => item.id !== action.payload);
      })
      .addCase(deleteWarehouse.rejected, (state, action) => {
        state.error = action.payload;
      })
      .addCase(fetchWarehouseAccess.pending, (state) => {
        state.accessLoading = true;
      })
      .addCase(fetchWarehouseAccess.fulfilled, (state, action) => {
        state.accessLoading = false;
        state.access = action.payload.access;
      })
      .addCase(fetchWarehouseAccess.rejected, (state, action) => {
        state.accessLoading = false;
        state.error = action.payload;
      })
      .addCase(grantWarehouseAccess.fulfilled, (state, action) => {
        const newAccess = action.payload.access;
        const userId = newAccess?.user?.id;
        const index = state.access.findIndex((item) => item.user?.id === userId);
        if (index === -1) state.access.push(newAccess);
        else state.access[index] = newAccess;
      })
      .addCase(grantWarehouseAccess.rejected, (state, action) => {
        state.error = action.payload;
      })
      .addCase(revokeWarehouseAccess.fulfilled, (state, action) => {
        state.access = state.access.filter((item) => item.user?.id !== action.payload.userId);
      })
      .addCase(revokeWarehouseAccess.rejected, (state, action) => {
        state.error = action.payload;
      })
      .addMatcher(
        isAnyOf(
          createWarehouse.fulfilled, updateWarehouse.fulfilled, toggleInwardStatus.fulfilled, toggleOutwardStatus.fulfilled,
          deleteWarehouse.fulfilled, grantWarehouseAccess.fulfilled, revokeWarehouseAccess.fulfilled, sessionChanged
        ),
        (state) => { bumpVersion(state); }
      );
  },
});

export const {
  setSelectedWarehouse,
  clearWarehouseError,
  clearWarehouseAccess,
} = warehouseSlice.actions;

export const selectWarehouses = (state) => state.warehouse.list;
export const selectWarehouseLoading = (state) => state.warehouse.loading;
export const selectWarehouseError = (state) => state.warehouse.error;
export const selectSelectedWarehouse = (state) => state.warehouse.selectedWarehouse;
export const selectWarehouseAccess = (state) => state.warehouse.access;
export const selectWarehouseAccessLoading = (state) => state.warehouse.accessLoading;

export default warehouseSlice.reducer;
