import "dotenv/config";
import app from "./app.js";
import prisma from "./config/prisma.js";

const PORT = process.env.PORT || 4000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The remote database is sometimes unreachable for a few seconds. Retry the first
// connection instead of crashing, so nodemon doesn't need a manual restart.
async function connectWithRetry(maxAttempts = 8) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await prisma.$connect();
      return;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      console.warn(`Database not reachable (attempt ${attempt}/${maxAttempts}). Retrying in ${attempt * 2}s...`);
      await sleep(attempt * 2000);
    }
  }
}

const startServer = async () => {
  try {
    await connectWithRetry();

    console.log("PostgreSQL connected successfully");

    // Prisma opens database connections lazily, and each new one costs a slow
    // handshake. Open a few now (in parallel) so the first page load after a
    // restart doesn't pay for them.
    await Promise.all(Array.from({ length: 4 }, () => prisma.$queryRaw`SELECT 1`)).catch(() => {});

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Database connection failed:", error.message);
    process.exit(1);
  }
};

startServer();
