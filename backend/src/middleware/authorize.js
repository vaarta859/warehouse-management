/**
 * authorize — restricts a route to specific roles.
 * MUST run AFTER authenticate() on the route, since it reads req.user.role.
 *
 * Usage on a route:
 *   router.delete('/users/:id', authenticate, authorize('ACCOUNTS_ADMIN'), deleteUser)
 *
 * Multiple roles allowed:
 *   authorize('WAREHOUSE_MANAGER', 'ACCOUNTS_ADMIN')
 */
export default function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      // Should never trigger if authenticate() ran first, but guard anyway
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Role '${req.user.role}' is not permitted to perform this action`,
      });
    }

    next();
  };
}
