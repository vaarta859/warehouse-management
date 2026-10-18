import { z } from 'zod';

export const INWARD_TYPES = [
  'Purchase - New Stock',
  'Purchase - Service Stock',
  'Return of Purchase',
  'Service/Faulty Stock from Customer',
  'Repair-Service Stock',
];

// Older entries / clients may still send the previous label.
const LEGACY_SERVICE_FROM_CUSTOMER = 'Service Stock from Customer';

const grnItemSchema = z.object({
  category: z.string().trim().min(1, 'Item category is required'),
  sku: z.string().min(1, 'SKU / model is required'),
  quantity: z.number().int().positive('Quantity must be greater than 0'),
  uom: z.enum(['Pcs', 'Meters', 'Bundles']),
});

const documentNumberSchema = z.object({
  type: z.string().min(1),
  number: z.string().min(1),
});

export const createGrnSchema = z.object({
  warehouseId: z.string().min(1),
  companyName: z.string().min(1, 'Company name is required'),
  inwardDateTime: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid inward date/time'),
  inwardType: z.preprocess(
    (v) => (v === LEGACY_SERVICE_FROM_CUSTOMER ? 'Service/Faulty Stock from Customer' : v),
    z.enum(INWARD_TYPES)
  ),
  supplierName: z.string().min(1, 'Supplier name is required'),
  refDocType: z.enum(['Invoice', 'E-way Bill', 'Delivery Challan', 'Return Note', 'Other']),
  refDocNumber: z.string().optional(),
  refDocDate: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid inward date/time'),
  otherDocumentNumbers: z.array(documentNumberSchema).optional().default([]),
  remarks: z.string().optional(),
  items: z.array(grnItemSchema).min(1, 'At least one item is required'),
  documents: z.array(z.any()).optional().default([]),
});
