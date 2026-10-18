import { z } from 'zod';

export const ROLES = ['SUPER_ADMIN', 'WAREHOUSE_MANAGER', 'SALES', 'ACCOUNT'];

export const signupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(ROLES),
  // A warehouse manager can belong to several companies.
  companyIds: z.array(z.string().uuid()).optional(),
  companyId: z.string().uuid().optional(), // legacy single company
  warehouseAccess: z
    .array(
      z.object({
        warehouseId: z.string().uuid(),
        canInward: z.boolean().optional(),
        canOutward: z.boolean().optional(),
        canManageDocuments: z.boolean().optional(),
      })
    )
    .optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const updateRoleSchema = z.object({
  role: z.enum(ROLES),
  companyIds: z.array(z.string().uuid()).optional(),
  companyId: z.string().uuid().optional(), // legacy single company
});
