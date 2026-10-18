import prismaPackage from '@prisma/client';
 
const { PrismaClient } = prismaPackage;
 
// Reuse a single Prisma instance across the app (important in dev with hot-reload,
// where re-importing this file shouldn't open a new DB connection each time)
const baseClient = new PrismaClient({
  // Default is maxWait 2000ms / timeout 5000ms, which a slow (remote) database
  // easily exceeds -> "Transaction already closed" (P2028). Applies to every
  // prisma.$transaction(async tx => ...) in the app.
  transactionOptions: { maxWait: 10000, timeout: 10000 },
});

// The remote database sometimes can't be reached for a moment (P1001) - e.g. a flaky
// network or the pooler dropping an idle connection. The query never reached the
// database in that case, so it is safe to simply try again a couple of times.
const RETRY_DELAYS_MS = [400, 1200, 2500];
const TRANSIENT_CODES = new Set(['P1001', 'P1002', 'P1017']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withRetry = baseClient.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        for (let attempt = 0; ; attempt += 1) {
          try {
            return await query(args);
          } catch (error) {
            if (!TRANSIENT_CODES.has(error?.code) || attempt >= RETRY_DELAYS_MS.length) throw error;
            await sleep(RETRY_DELAYS_MS[attempt]);
          }
        }
      },
    },
  },
});

const prisma = global.prisma || withRetry;
if (process.env.NODE_ENV !== 'production') global.prisma = prisma;
 
export default prisma;
