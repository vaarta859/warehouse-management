export const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem("user"));
  } catch {
    return null;
  }
};

export const isAdminRole = (role) =>
  role === "SUPER_ADMIN";

export const getWarehouseIdFromAccess = (access) =>
  access?.warehouseId || access?.warehouse?.id || access?.warehouseId?._id || null;

/**
 * A user's access grant is only effective when the company and the
 * corresponding warehouse operation are active.
 *
 * Admins can manage the warehouse, but they should still not be able
 * to create an inward/outward transaction against an inactive operation.
 */
export const getWarehousePermissions = (user, warehouseOrId) => {
  const warehouse =
    warehouseOrId && typeof warehouseOrId === "object"
      ? warehouseOrId
      : null;
  const warehouseId = warehouse?.id || warehouseOrId;

  const companyActive = warehouse?.company?.status !== "Inactive";
  const inwardActive = warehouse?.Inward === "Active";
  const outwardActive = warehouse?.Outward === "Active";

  if (isAdminRole(user?.role)) {
    return {
      canInward: companyActive && (!warehouse || inwardActive),
      canOutward: companyActive && (!warehouse || outwardActive),
      canManageDocuments: companyActive,
    };
  }

  // Sales creates outward entries for the warehouses of their company.
  // Account only approves; neither works with inward or documents.
  if (user?.role === "SALES") {
    return {
      canInward: false,
      canOutward: companyActive && (!warehouse || outwardActive),
      canManageDocuments: false,
    };
  }

  if (user?.role !== "WAREHOUSE_MANAGER" || !warehouseId) {
    return { canInward: false, canOutward: false, canManageDocuments: false };
  }

  const accessList = Array.isArray(user?.warehouseAccess)
    ? user.warehouseAccess
    : [];

  const access = accessList.find(
    (item) => getWarehouseIdFromAccess(item) === warehouseId
  );

  return {
    canInward: companyActive && inwardActive && Boolean(access?.canInward),
    canOutward: companyActive && outwardActive && Boolean(access?.canOutward),
    canManageDocuments: companyActive && Boolean(access?.canManageDocuments),
  };
};

export const isWarehouseOperationActive = (warehouse, type) => {
  if (!warehouse || warehouse.company?.status === "Inactive") return false;
  return type === "inward"
    ? warehouse.Inward === "Active"
    : warehouse.Outward === "Active";
};
