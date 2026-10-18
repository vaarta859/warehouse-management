import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import apiClient from "../../services/apiClient";

const readStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem("user"));
  } catch {
    return null;
  }
};

const initialState = {
  user: readStoredUser(),
  users: [],
  token: localStorage.getItem("token") || null,
  status: "idle",
  usersStatus: "idle",
  error: null,
  usersError: null,
};

// POST /api/auth/signup
export const signupUser = createAsyncThunk(
  "auth/signupUser",
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post("/api/auth/signup", payload);
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to create account"
      );
    }
  }
);

// Creates a user from User Management without replacing the currently
// authenticated admin session. The public signup flow below still logs
// the newly created account in, but admin-created users must not do that.
export const createUser = createAsyncThunk(
  "auth/createUser",
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post("/api/auth/signup", payload);
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to create account"
      );
    }
  }
);

// POST /api/auth/login
export const loginUser = createAsyncThunk(
  "auth/loginUser",
  async ({ email, password }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post("/api/auth/login", {
        email: email.trim(),
        password,
      });
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Invalid email or password"
      );
    }
  }
);

// GET /api/auth/me
export const fetchMe = createAsyncThunk(
  "auth/fetchMe",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get("/api/auth/me");
      return data.user;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to load your account"
      );
    }
  }
);

// GET /api/users
export const getAllUsers = createAsyncThunk(
  "auth/getAllUsers",
  async ({ companyId } = {}, { rejectWithValue }) => {
    try {
      const params = companyId ? { companyId } : {};
      const { data } = await apiClient.get("/api/users", { params });
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to fetch users"
      );
    }
  }
);

// PATCH /api/users/:id/role
// `companyIds` replaces the user's whole company list (a user can belong to
// several companies). Leave it out to keep the companies they already have.
export const updateUserRole = createAsyncThunk(
  "auth/updateUserRole",
  async ({ id, role, companyIds }, { rejectWithValue }) => {
    try {
      const body = { role };
      if (Array.isArray(companyIds)) body.companyIds = companyIds;
      const { data } = await apiClient.patch(`/api/users/${id}/role`, body);
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to update user role"
      );
    }
  }
);

// PATCH /api/users/:id — only name, email and password are accepted by backend.
export const updateUser = createAsyncThunk(
  "auth/updateUser",
  async ({ id, ...fields }, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.patch(`/api/users/${id}`, fields);
      return data;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to update user"
      );
    }
  }
);

// DELETE /api/users/:id
export const deleteUser = createAsyncThunk(
  "auth/deleteUser",
  async (id, { rejectWithValue }) => {
    try {
      await apiClient.delete(`/api/users/${id}`);
      return id;
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.message || "Failed to delete user"
      );
    }
  }
);

const persistSession = (state, data) => {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    logout: (state) => {
      state.user = null;
      state.users = [];
      state.token = null;
      state.status = "idle";
      state.usersStatus = "idle";
      state.error = null;
      state.usersError = null;
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    },
    sessionExpired: (state) => {
      state.user = null;
      state.users = [];
      state.token = null;
      state.status = "idle";
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    },
    clearAuthError: (state) => {
      state.error = null;
      state.usersError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(signupUser.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(signupUser.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.error = null;
        persistSession(state, action.payload);
      })
      .addCase(signupUser.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || "Failed to create account";
      })
      .addCase(createUser.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(createUser.fulfilled, (state) => {
        // Important: do not persist the created user's token/session.
        // The currently logged-in Super Admin remains authenticated.
        state.status = "succeeded";
        state.error = null;
      })
      .addCase(createUser.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || "Failed to create account";
      })
      .addCase(loginUser.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.error = null;
        persistSession(state, action.payload);
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || "Login failed";
      })
      .addCase(fetchMe.fulfilled, (state, action) => {
        state.user = action.payload;
        localStorage.setItem("user", JSON.stringify(action.payload));
      })
      .addCase(fetchMe.rejected, (state, action) => {
        state.error = action.payload || "Failed to load account";
      })
      .addCase(getAllUsers.pending, (state) => {
        state.usersStatus = "loading";
        state.usersError = null;
      })
      .addCase(getAllUsers.fulfilled, (state, action) => {
        state.usersStatus = "succeeded";
        state.users = Array.isArray(action.payload)
          ? action.payload
          : action.payload?.data || [];
      })
      .addCase(getAllUsers.rejected, (state, action) => {
        state.usersStatus = "failed";
        state.usersError = action.payload || "Failed to fetch users";
      })
      .addCase(updateUserRole.fulfilled, (state, action) => {
        const updatedUser = action.payload?.user;
        if (!updatedUser?.id) return;
        const index = state.users.findIndex((user) => user.id === updatedUser.id);
        if (index !== -1) state.users[index] = { ...state.users[index], ...updatedUser };
        if (state.user?.id === updatedUser.id) {
          state.user = { ...state.user, ...updatedUser };
          localStorage.setItem("user", JSON.stringify(state.user));
        }
      })
      .addCase(updateUserRole.rejected, (state, action) => {
        state.usersError = action.payload || "Failed to update user role";
      })
      .addCase(updateUser.fulfilled, (state, action) => {
        const updatedUser = action.payload?.user;
        if (!updatedUser?.id) return;
        const index = state.users.findIndex((user) => user.id === updatedUser.id);
        if (index !== -1) state.users[index] = { ...state.users[index], ...updatedUser };
        if (state.user?.id === updatedUser.id) {
          state.user = { ...state.user, ...updatedUser };
          localStorage.setItem("user", JSON.stringify(state.user));
        }
      })
      .addCase(updateUser.rejected, (state, action) => {
        state.usersError = action.payload || "Failed to update user";
      })
      .addCase(deleteUser.fulfilled, (state, action) => {
        state.users = state.users.filter((user) => user.id !== action.payload);
      })
      .addCase(deleteUser.rejected, (state, action) => {
        state.usersError = action.payload || "Failed to delete user";
      });
  },
});

export const { logout, sessionExpired, clearAuthError } = authSlice.actions;

export const selectCurrentUser = (state) => state.auth.user;
export const selectAuthToken = (state) => state.auth.token;
export const selectAuthStatus = (state) => state.auth.status;
export const selectAuthError = (state) => state.auth.error;
export const selectAllUsers = (state) => state.auth.users;
export const selectUsersStatus = (state) => state.auth.usersStatus;
export const selectUsersError = (state) => state.auth.usersError;

export default authSlice.reducer;
