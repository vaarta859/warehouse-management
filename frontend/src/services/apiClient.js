import axios from "axios";
const API_URL = import.meta.env?.VITE_API_URL || "http://localhost:4000";

const apiClient = axios.create({
  baseURL: API_URL,
});

// -------------------------------------------------
// Attach token to every request
// -------------------------------------------------

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

let onUnauthorized = null;

export const setUnauthorizedHandler = (handler) => {
  onUnauthorized = handler;
};

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");

      if (onUnauthorized) {
        // Pass the server message along when an admin has deactivated this
        // account mid-session, so the login page can explain why.
        onUnauthorized(
          error.response?.data?.code === "ACCOUNT_INACTIVE"
            ? error.response.data.message
            : undefined
        );
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
