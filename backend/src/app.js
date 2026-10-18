import express from "express";
import cors from "cors";

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import inwardRoutes from "./routes/inwardRoutes.js";
import outwardRoutes from "./routes/outwardRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import warehouseRoutes from "./routes/warehouseRoutes.js";
import companyRoutes from "./routes/companyRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import productRoutes from "./routes/productRoutes.js";

const app = express();

// Gzip responses (JSON compresses very well - lists/reports load noticeably
// faster). Optional: needs `npm install compression`; skipped with a warning if
// it isn't installed, so nothing breaks either way.
try {
  const { default: compression } = await import("compression");
  app.use(compression());
} catch {
  console.warn("[perf] 'compression' is not installed - run `npm install compression` for faster responses.");
}

const allowedOrigins = [
  "http://localhost:5173",
  "https://warehouse-management-pi-black.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (Postman, server-to-server, etc.)
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    // Let the browser remember the CORS pre-check for a day instead of sending an
    // extra OPTIONS request before every API call (browsers cap this themselves).
    maxAge: 86400,
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Warehouse backend is running",
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/grn", inwardRoutes);
app.use("/api/outward", outwardRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/products", productRoutes);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
  });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);

  res.status(err.status || 500).json({
    message: err.message || "Internal server error",
  });
});

export default app;
