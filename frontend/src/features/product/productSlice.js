import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import apiClient from "../../services/apiClient";

// =====================================================
// PRODUCT MASTER
//
// A product is a category (Inverter, Cable, Panel...) plus a
// SKU / module name. Everyone can read the list (the inward and
// outward forms use it). SUPER_ADMIN and WAREHOUSE_MANAGER can create
// (the inward form's "Add" button); only SUPER_ADMIN can edit / delete.
// =====================================================

const initialState = {
  list: [],

  // Fetch status
  status: "idle",

  // When the list was last loaded (ms since epoch) - lets screens reuse it
  // instead of downloading it again every time they open.
  fetchedAt: null,

  // Create / update / delete status
  saveStatus: "idle",

  error: null,
};

const sortProducts = (list) =>
  list.sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.sku.localeCompare(b.sku)
  );

// The product list changes rarely, but the inward / outward forms asked for it
// every single time they opened. Reuse it if it was loaded within this window.
const PRODUCTS_FRESH_MS = 60 * 1000;

// Should fetchProducts actually hit the server?
//   - never while one request is already on its way (no duplicate requests)
//   - `{ force: true }` always refreshes (Product Management uses it)
//   - otherwise only when the list is missing or older than PRODUCTS_FRESH_MS
export const shouldFetchProducts = (arg, productState, now = Date.now()) => {
  if (productState.status === "loading") return false;
  if (arg?.force) return true;
  return !(productState.fetchedAt && now - productState.fetchedAt < PRODUCTS_FRESH_MS);
};

// GET /api/products
export const fetchProducts = createAsyncThunk(
  "product/fetchAll",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get("/api/products");
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to fetch products"
      );
    }
  },
  {
    condition: (arg, { getState }) => shouldFetchProducts(arg, getState().product),
  }
);

// POST /api/products
export const createProduct = createAsyncThunk(
  "product/create",
  async (productData, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post("/api/products", productData);
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to create product"
      );
    }
  }
);

// PATCH /api/products/:id
export const updateProduct = createAsyncThunk(
  "product/update",
  async ({ id, ...fields }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.patch(`/api/products/${id}`, fields);
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to update product"
      );
    }
  }
);

// DELETE /api/products/:id
export const deleteProduct = createAsyncThunk(
  "product/delete",
  async (id, { rejectWithValue }) => {
    try {
      await apiClient.delete(`/api/products/${id}`);
      return id;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to delete product"
      );
    }
  }
);

const productSlice = createSlice({
  name: "product",

  initialState,

  reducers: {
    clearProductError: (state) => {
      state.error = null;
    },
  },

  extraReducers: (builder) => {
    builder
      // ---------------- fetch ----------------
      .addCase(fetchProducts.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchProducts.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.fetchedAt = Date.now();
        state.list = Array.isArray(action.payload)
          ? action.payload
          : action.payload?.data || [];
      })
      .addCase(fetchProducts.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || "Failed to fetch products";
      })

      // ---------------- create ----------------
      .addCase(createProduct.pending, (state) => {
        state.saveStatus = "loading";
        state.error = null;
      })
      .addCase(createProduct.fulfilled, (state, action) => {
        state.saveStatus = "succeeded";
        const created = action.payload?.product || action.payload;
        if (created?.id) {
          state.list.push(created);
          sortProducts(state.list);
        }
      })
      .addCase(createProduct.rejected, (state) => {
        // The form shows the message itself, so don't also set the page-level error.
        state.saveStatus = "failed";
      })

      // ---------------- update ----------------
      .addCase(updateProduct.pending, (state) => {
        state.saveStatus = "loading";
        state.error = null;
      })
      .addCase(updateProduct.fulfilled, (state, action) => {
        state.saveStatus = "succeeded";
        const updated = action.payload?.product || action.payload;
        if (!updated?.id) return;
        const index = state.list.findIndex((p) => p.id === updated.id);
        if (index !== -1) {
          state.list[index] = updated;
          sortProducts(state.list);
        }
      })
      .addCase(updateProduct.rejected, (state) => {
        state.saveStatus = "failed";
      })

      // ---------------- delete ----------------
      .addCase(deleteProduct.fulfilled, (state, action) => {
        state.list = state.list.filter((p) => p.id !== action.payload);
      })
      .addCase(deleteProduct.rejected, (state, action) => {
        state.error = action.payload || "Failed to delete product";
      });
  },
});

export const { clearProductError } = productSlice.actions;

export const selectAllProducts = (state) => state.product.list;
export const selectProductStatus = (state) => state.product.status;
export const selectProductSaveStatus = (state) => state.product.saveStatus;
export const selectProductError = (state) => state.product.error;

export default productSlice.reducer;
