import bcrypt from "bcrypt";
import prisma from "../config/prisma.js";
import { signToken } from "../utils/jwt.js";
import { invalidateCachedUser } from "../utils/userCache.js";
import {
  USER_COMPANIES_SELECT,
  parseCompanyIds,
  findMissingCompanyIds,
  pickPrimaryCompanyId,
  shapeUser,
} from "../utils/userCompanies.js";

const SALT_ROUNDS = 10;
const ROLES = ["SUPER_ADMIN", "WAREHOUSE_MANAGER", "SALES", "ACCOUNT"];

// =====================================================
// Small internal helper — can `req.user` manage `targetUser`?
// Used by updateUser / deleteUser / getUserWarehouses so the
// same company-scoping rule lives in one place.
//
//   SUPER_ADMIN     -> can manage anyone
//   WAREHOUSE_MANAGER -> can only manage themself (e.g. change own password)
// =====================================================

function canManageUser(reqUser, targetUser) {
  if (reqUser.role === "SUPER_ADMIN") return true;
  if (reqUser.id === targetUser.id) return true;

  return false;
}

// =====================================================
// POST /api/auth/signup
// Public
//
// role: SUPER_ADMIN | WAREHOUSE_MANAGER
// companyIds: array of company ids — at least one is required for
//   WAREHOUSE_MANAGER, who can belong to several companies.
//   (The old single `companyId` field is still accepted.)
// warehouseAccess: optional, WAREHOUSE_MANAGER only —
//   [{ warehouseId, canInward, canOutward, canManageDocuments }]
//   Grants access to one or more warehouses in the same
//   transaction the user is created in.
// =====================================================

export async function signup(req, res) {
  try {
    const {
      name,
      email,
      password,
      role,
      warehouseAccess,
    } = req.body;

    // Companies — SUPER_ADMIN isn't scoped to any company.
    const companyIds =
      role === "SUPER_ADMIN" ? [] : parseCompanyIds(req.body) || [];

    // ---------------------------------------------
    // Basic validation
    // ---------------------------------------------

    if (!name || !name.trim()) {
      return res.status(400).json({
        message: "Full name is required",
      });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    if (!password) {
      return res.status(400).json({
        message: "Password is required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    if (!role || !ROLES.includes(role)) {
      return res.status(400).json({
        message: "Role must be one of: " + ROLES.join(", "),
      });
    }

    // ---------------------------------------------
    // Company requirement
    // WAREHOUSE_MANAGER accounts belong to one or more companies.
    // ---------------------------------------------

    if (role !== "SUPER_ADMIN" && companyIds.length === 0) {
      return res.status(400).json({
        message: "Select at least one company for this role",
      });
    }

    const missingCompanyIds = await findMissingCompanyIds(companyIds);

    if (missingCompanyIds.length) {
      return res.status(400).json({
        message: "One or more selected companies do not exist",
      });
    }

    // ---------------------------------------------
    // Check existing user
    // ---------------------------------------------

    const existingUser = await prisma.user.findUnique({
      where: {
        email: email.trim(),
      },
    });

    if (existingUser) {
      return res.status(409).json({
        message: "An account with this email already exists",
      });
    }

    // ---------------------------------------------
    // Validate warehouseAccess (WAREHOUSE_MANAGER only)
    // Every warehouse granted must belong to one of the user's companies.
    // ---------------------------------------------

    let accessRows = [];

    if (role === "WAREHOUSE_MANAGER" && Array.isArray(warehouseAccess)) {
      const warehouseIds = warehouseAccess
        .map((a) => a?.warehouseId)
        .filter(Boolean);

      if (warehouseIds.length) {
        const warehouses = await prisma.warehouse.findMany({
          where: { id: { in: warehouseIds } },
          select: { id: true, companyId: true },
        });

        const validIds = new Set(
          warehouses
            .filter((w) => companyIds.includes(w.companyId))
            .map((w) => w.id)
        );

        if (validIds.size !== warehouseIds.length) {
          return res.status(400).json({
            message:
              "One or more warehouses do not exist or don't belong to the selected companies",
          });
        }

        accessRows = warehouseAccess.map((a) => ({
          warehouseId: a.warehouseId,
          accessLevel: "MANAGE",
          canInward: Boolean(a.canInward),
          canOutward: Boolean(a.canOutward),
          canManageDocuments: Boolean(a.canManageDocuments),
        }));
      }
    }

    // ---------------------------------------------
    // Hash password
    // ---------------------------------------------

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // ---------------------------------------------
    // Create user (+ warehouse access rows) atomically
    // ---------------------------------------------

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.trim(),
        passwordHash,
        role,
        // Primary company (first selected) kept for backward compatibility.
        companyId: companyIds[0] || null,
        companies: companyIds.length
          ? { create: companyIds.map((id) => ({ companyId: id })) }
          : undefined,
        warehouseAccess: accessRows.length
          ? { create: accessRows }
          : undefined,
      },

      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        companies: USER_COMPANIES_SELECT,
        warehouseAccess: {
          select: {
            warehouseId: true,
            accessLevel: true,
            canInward: true,
            canOutward: true,
            canManageDocuments: true,
          },
        },
      },
    });

    // ---------------------------------------------
    // Create JWT
    // ---------------------------------------------

    const token = signToken({
      userId: user.id,
      role: user.role,
    });

    // ---------------------------------------------
    // Response
    // ---------------------------------------------

    return res.status(201).json({
      message: "Account created successfully",
      token,
      user: shapeUser(user),
    });
  } catch (error) {
    console.error("Signup error:", error);

    return res.status(500).json({
      message: "Something went wrong while creating the account",
    });
  }
}

// =====================================================
// POST /api/auth/login
// Public
// =====================================================

export async function login(req, res) {
  try {
    const { email, password } = req.body;

    // ---------------------------------------------
    // Basic validation
    // ---------------------------------------------

    if (!email || !email.trim()) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    if (!password) {
      return res.status(400).json({
        message: "Password is required",
      });
    }

    // ---------------------------------------------
    // Find user
    // ---------------------------------------------

    const user = await prisma.user.findUnique({
      where: {
        email: email.trim(),
      },

      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        companies: USER_COMPANIES_SELECT,
        passwordHash: true,
        warehouseAccess: {
          select: {
            warehouseId: true,
            accessLevel: true,
            canInward: true,
            canOutward: true,
            canManageDocuments: true,
          },
        },
      },
    });

    // ---------------------------------------------
    // Invalid user
    // ---------------------------------------------

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // ---------------------------------------------
    // Compare password
    // ---------------------------------------------

    const passwordMatches = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // ---------------------------------------------
    // Create JWT
    // ---------------------------------------------

    const token = signToken({
      userId: user.id,
      role: user.role,
    });

    // ---------------------------------------------
    // Response
    // Warehouse managers get their access list back so the
    // frontend knows which warehouses to show without an extra call.
    // ---------------------------------------------

    const { passwordHash: _omit, warehouseAccess, ...safeUser } = user;

    return res.json({
      token,

      user: {
        ...shapeUser(safeUser),
        warehouseAccess:
          user.role === "WAREHOUSE_MANAGER" ? warehouseAccess : undefined,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "Something went wrong while logging in",
    });
  }
}

// =====================================================
// GET /api/auth/me
// Protected
// =====================================================

export async function me(req, res) {
  try {
    // authenticate() keeps its per-request query small, so the
    // company list is loaded here, only for this endpoint.
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        companies: USER_COMPANIES_SELECT,
      },
    });

    return res.json({
      user: shapeUser(user),
    });
  } catch (error) {
    console.error("Get current user error:", error);

    return res.status(500).json({
      message: "Something went wrong",
    });
  }
}

// =====================================================
// PATCH /api/users/:id/role
// Protected + SUPER_ADMIN
//
// body: { role, companyIds? }   (old `companyId` still accepted)
//
// A non-SUPER_ADMIN must end up with at least one company —
// the ones sent in this request, or the ones they already have.
// `companyIds` REPLACES the user's company list, so this is also
// how a company is added to / removed from a user.
//
// When a company is removed from a manager, their access to that
// company's warehouses is revoked in the same transaction.
// =====================================================

export async function updateUserRole(req, res) {
  try {
    const { role } = req.body;

    // ---------------------------------------------
    // Validate role
    // ---------------------------------------------

    if (!role || !ROLES.includes(role)) {
      return res.status(400).json({
        message: "Role must be one of: " + ROLES.join(", "),
      });
    }

    // ---------------------------------------------
    // Find target user
    // ---------------------------------------------

    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        companyId: true,
        companies: { select: { companyId: true } },
      },
    });

    if (!targetUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!canManageUser(req.user, targetUser)) {
      return res.status(403).json({
        message: "You don't have permission to manage this user",
      });
    }

    // ---------------------------------------------
    // Work out the final company list
    // ---------------------------------------------

    const currentIds = [
      ...new Set([
        ...targetUser.companies.map((link) => link.companyId),
        ...(targetUser.companyId ? [targetUser.companyId] : []),
      ]),
    ];

    const requestedIds = parseCompanyIds(req.body);

    const resolvedIds =
      role === "SUPER_ADMIN" ? [] : requestedIds ?? currentIds;

    if (role !== "SUPER_ADMIN" && resolvedIds.length === 0) {
      return res.status(400).json({
        message: "Select at least one company for this role",
      });
    }

    const missingCompanyIds = await findMissingCompanyIds(resolvedIds);

    if (missingCompanyIds.length) {
      return res.status(400).json({
        message: "One or more selected companies do not exist",
      });
    }

    // ---------------------------------------------
    // Update role + companies atomically
    // ---------------------------------------------

    const updatedUser = await prisma.$transaction(async (tx) => {
      // Drop links to companies that are no longer selected
      await tx.userCompany.deleteMany({
        where: resolvedIds.length
          ? { userId: targetUser.id, companyId: { notIn: resolvedIds } }
          : { userId: targetUser.id },
      });

      // Add the new ones (existing links are left untouched)
      if (resolvedIds.length) {
        await tx.userCompany.createMany({
          data: resolvedIds.map((companyId) => ({
            userId: targetUser.id,
            companyId,
          })),
          skipDuplicates: true,
        });
      }

      // A manager can't keep access to a company they were removed from
      if (role === "WAREHOUSE_MANAGER") {
        await tx.warehouseAccess.deleteMany({
          where: {
            userId: targetUser.id,
            warehouse: { companyId: { notIn: resolvedIds } },
          },
        });
      }

      return tx.user.update({
        where: { id: targetUser.id },

        data: {
          role,
          companyId: pickPrimaryCompanyId(resolvedIds, targetUser.companyId),
        },

        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          companyId: true,
          companies: USER_COMPANIES_SELECT,
          warehouseAccess: {
            select: {
              warehouseId: true,
              accessLevel: true,
              canInward: true,
              canOutward: true,
              canManageDocuments: true,
              warehouse: { select: { id: true, name: true, code: true } },
            },
          },
        },
      });
    });

    // The signed-in-user lookup is cached briefly (utils/userCache.js) -
    // clear it so the new role applies immediately.
    invalidateCachedUser(targetUser.id);

    // ---------------------------------------------
    // Response
    // ---------------------------------------------

    return res.json({
      message: "User role updated successfully",
      user: shapeUser(updatedUser),
    });
  } catch (error) {
    console.error("Update role error:", error);

    return res.status(500).json({
      message: "Something went wrong while updating the role",
    });
  }
}

// =====================================================
// PATCH /api/users/:id
// Protected + SUPER_ADMIN (or self)
//
// General profile update: name, email, and an optional
// password change. Role and companyId changes go through
// updateUserRole instead — keeps that sensitive path separate.
// Warehouse access is managed via the warehouse access endpoints,
// not here (it's a list of relations, not a scalar field).
// =====================================================

export async function updateUser(req, res) {
  try {
    const { name, email, password } = req.body;

    // ---------------------------------------------
    // Find target user
    // ---------------------------------------------

    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!targetUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!canManageUser(req.user, targetUser)) {
      return res.status(403).json({
        message: "You don't have permission to manage this user",
      });
    }

    // ---------------------------------------------
    // Validate email + uniqueness (if provided)
    // ---------------------------------------------

    if (email !== undefined) {
      if (!email.trim()) {
        return res.status(400).json({
          message: "Email is required",
        });
      }

      const existingUser = await prisma.user.findUnique({
        where: { email: email.trim() },
      });

      if (existingUser && existingUser.id !== targetUser.id) {
        return res.status(409).json({
          message: "Another account with this email already exists",
        });
      }
    }

    // ---------------------------------------------
    // Validate name (if provided)
    // ---------------------------------------------

    if (name !== undefined && !name.trim()) {
      return res.status(400).json({
        message: "Full name is required",
      });
    }

    // ---------------------------------------------
    // Validate + hash password (if provided)
    // ---------------------------------------------

    let passwordHash;

    if (password !== undefined && password !== "") {
      if (password.length < 8) {
        return res.status(400).json({
          message: "Password must be at least 8 characters",
        });
      }

      passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    }

    // ---------------------------------------------
    // Build update payload
    // ---------------------------------------------

    const data = {};

    if (name !== undefined) data.name = name.trim();
    if (email !== undefined) data.email = email.trim();
    if (passwordHash !== undefined) data.passwordHash = passwordHash;

    // ---------------------------------------------
    // Update user
    // ---------------------------------------------

    const updatedUser = await prisma.user.update({
      where: { id: req.params.id },

      data,

      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        createdAt: true,
      },
    });

    invalidateCachedUser(req.params.id);

    // ---------------------------------------------
    // Response
    // ---------------------------------------------

    return res.json({
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Update user error:", error);

    return res.status(500).json({
      message: "Something went wrong while updating the user",
    });
  }
}

// =====================================================
// GET /api/users?companyId=
// Protected + SUPER_ADMIN
//
// SUPER_ADMIN sees everyone. With ?companyId= only the users that
// belong to that company are returned (a user with several companies
// appears under each of them).
// =====================================================

export async function listUsers(req, res) {
  try {
    const where = {};

    // A user shows up under every company they belong to.
    if (req.query.companyId) {
      where.OR = [
        { companies: { some: { companyId: req.query.companyId } } },
        { companyId: req.query.companyId },
      ];
    }

    const users = await prisma.user.findMany({
      where,

      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        createdAt: true,
        company: {
          select: { id: true, name: true, code: true },
        },
        companies: USER_COMPANIES_SELECT,
        warehouseAccess: {
          select: {
            warehouseId: true,
            accessLevel: true,
            canInward: true,
            canOutward: true,
            canManageDocuments: true,
            warehouse: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },

      orderBy: { createdAt: "desc" },
    });

    return res.json({ data: users.map(shapeUser) });
  } catch (error) {
    console.error("List users error:", error);

    return res.status(500).json({
      message: "Something went wrong while fetching users",
    });
  }
}

// =====================================================
// GET /api/users/:id/warehouses
// Protected — self, or SUPER_ADMIN of that user
//
// Every warehouse this user currently has access to, with the
// specific permissions granted on each one.
// =====================================================

export async function getUserWarehouses(req, res) {
  try {
    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!targetUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!canManageUser(req.user, targetUser)) {
      return res.status(403).json({
        message: "You don't have permission to view this user's access",
      });
    }

    const access = await prisma.warehouseAccess.findMany({
      where: { userId: req.params.id },

      select: {
        accessLevel: true,
        canInward: true,
        canOutward: true,
        canManageDocuments: true,
        grantedAt: true,
        warehouse: {
          select: {
            id: true,
            name: true,
            code: true,
            city: true,
            state: true,
          },
        },
      },
    });

    return res.json({ data: access });
  } catch (error) {
    console.error("Get user warehouses error:", error);

    return res.status(500).json({
      message: "Something went wrong while fetching the user's warehouses",
    });
  }
}

// =====================================================
// DELETE /api/users/:id
// Protected + SUPER_ADMIN
// =====================================================

export async function deleteUser(req, res) {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({
        message: "You can't delete your own account",
      });
    }

    // ---------------------------------------------
    // Find user
    // ---------------------------------------------

    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!canManageUser(req.user, user)) {
      return res.status(403).json({
        message: "You don't have permission to delete this user",
      });
    }

    // ---------------------------------------------
    // Delete user
    // WarehouseAccess rows cascade automatically (onDelete: Cascade).
    // ---------------------------------------------

    await prisma.user.delete({
      where: { id: req.params.id },
    });

    invalidateCachedUser(req.params.id);

    // ---------------------------------------------
    // Response
    // ---------------------------------------------

    return res.json({
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Delete user error:", error);

    return res.status(500).json({
      message: "Something went wrong while deleting the user",
    });
  }
}


// =====================================================
// GET /api/auth/companies
// Public — id + name of active companies only, so the signup
// page can let non-Super-Admin roles choose their company.
// =====================================================
export async function listPublicCompanies(req, res) {
  try {
    const companies = await prisma.company.findMany({
      where: { status: { not: "Inactive" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return res.json({ data: companies });
  } catch (error) {
    console.error("List public companies error:", error);
    return res.status(500).json({ message: "Something went wrong while fetching companies" });
  }
}
