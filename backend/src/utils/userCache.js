import prisma from "../config/prisma.js";

/**
 * =========================================================
 * SIGNED-IN USER LOOKUP (cached)
 * =========================================================
 *
 * Every API request needs to know who is calling. Doing a database query for
 * that on EVERY request is expensive when the database is remote - a page that
 * loads with four API calls did the same lookup four times, at the same moment.
 *
 * This keeps the looked-up user in memory for a short time (TTL) and lets
 * requests that arrive together share ONE lookup.
 *
 * Trade-off: a role change or a deleted user can take up to TTL to be noticed on
 * OTHER server instances. On this server it takes effect immediately, because
 * invalidateCachedUser() is called wherever a user is changed or deleted.
 * =========================================================
 */

const TTL_MS = 30 * 1000;
const MAX_ENTRIES = 500;

const cache = new Map(); // userId -> { user, expires }
const pending = new Map(); // userId -> Promise (lookup already in flight)
let generation = 0; // bumped on every invalidation

const USER_SELECT = { id: true, name: true, email: true, role: true, companyId: true };

/** Returns the user (or null if they no longer exist). Never returns a shared object. */
export async function getAuthUser(userId) {
  const hit = cache.get(userId);
  if (hit && hit.expires > Date.now()) return { ...hit.user };
  if (hit) cache.delete(userId);

  let lookup = pending.get(userId);
  if (!lookup) {
    const startedAt = generation;
    lookup = prisma.user
      .findUnique({ where: { id: userId }, select: USER_SELECT })
      .then((user) => {
        // Only remember it if nothing changed a user while we were asking -
        // otherwise we could cache a value that is already out of date.
        if (user && startedAt === generation) {
          if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
          cache.set(userId, { user, expires: Date.now() + TTL_MS });
        }
        return user;
      })
      .finally(() => pending.delete(userId));
    pending.set(userId, lookup);
  }

  const user = await lookup;
  return user ? { ...user } : null;
}

/** Call after a user's role / company / profile is changed, or the user is deleted. */
export function invalidateCachedUser(userId) {
  generation += 1;
  if (userId) cache.delete(userId);
  else cache.clear();
}
