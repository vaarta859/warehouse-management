import { verifyToken } from '../utils/jwt.js';
import { getAuthUser } from '../utils/userCache.js';

/**
 * authenticate — verifies the JWT sent in the Authorization header.
 * On success, attaches req.user = { id, name, email, role, companyId }
 * to the request so every route after this middleware knows who's
 * making the call, and which company (if any) they're scoped to.
 *
 * Usage on a route:
 *   router.get('/some-protected-route', authenticate, someController)
 */
export default async function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing or malformed Authorization header' });
  }

  const token = header.split(' ')[1];

  try {
    const decoded = verifyToken(token); // { userId, role, iat, exp }

    // Cached for a few seconds and shared between requests that arrive together
    // (see utils/userCache.js) - this used to be a database query on every request.
    const user = await getAuthUser(decoded.userId);

    if (!user) {
      // Token is valid but the user was deleted since it was issued
      return res.status(401).json({ message: 'User no longer exists' });
    }

    // Deactivated by a Super Admin after this token was issued - lock them out.
    // 401 makes the frontend clear the session and return to the login page.
    if (user.isActive === false) {
      return res.status(401).json({
        message: 'Your account has been deactivated. You are unable to login. Please contact your administrator.',
        code: 'ACCOUNT_INACTIVE',
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}
