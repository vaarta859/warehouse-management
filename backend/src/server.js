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

// Close the database connections before the process ends. Without this, every nodemon restart (or Ctrl+C) leaves
// its ~9 connections open on the Supabase pooler until they time out, and a few quick restarts use up the pooler's
// limit -> "Timed out fetching a new connection from the connection pool" (P2024).
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await prisma.$disconnect();
  } catch {
    // nothing else to do - the process is ending anyway
  }
  // nodemon sends SIGUSR2 and expects the process to end by itself so it can start the new one.
  if (signal === "SIGUSR2") process.kill(process.pid, "SIGUSR2");
  else process.exit(0);
}
["SIGINT", "SIGTERM"].forEach((sig) => process.on(sig, () => shutdown(sig)));
process.once("SIGUSR2", () => shutdown("SIGUSR2"));

startServer();
