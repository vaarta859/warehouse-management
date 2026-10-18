import { configureStore } from "@reduxjs/toolkit";
import authReducer from "../features/auth/authSlice";
import inwardReducer from "../features/inward/inwardSlice";
import outwardReducer from "../features/outward/outwardSlice";
import warehouseSlice from "../features/warehouse/warehouseSlice";
import companyReducer from "../features/company/companySlice";
import reportReducer from "../features/reports/reportSlice";
import productReducer from "../features/product/productSlice";
export const store = configureStore({
  reducer: {
    auth: authReducer,
    inward: inwardReducer,
    outward: outwardReducer,
    warehouse: warehouseSlice,
    company: companyReducer,
    reports: reportReducer,
    product: productReducer,
  },
});

