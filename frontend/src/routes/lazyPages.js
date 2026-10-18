import { lazy } from "react";

// -------------------------------------------------
// Route-level code splitting.
//
// Every page below is downloaded only when its route is opened,
// so the first load only ships the login page + app shell instead
// of the whole application.
//
// `prefetchRoute(key)` warms a page's chunk ahead of the click
// (sidebar hover, browser idle time), so the lazy load is
// usually already finished by the time the user navigates.
// -------------------------------------------------

const importers = {
  signup: () => import("../pages/Signup"),
  dashboard: () => import("../pages/Dashboard"),
  inward: () => import("../pages/InwardList"),
  inwardForm: () => import("../pages/InwardForm"),
  inwardDetail: () => import("../pages/InwardDetail"),
  outward: () => import("../pages/OutwardList"),
  outwardForm: () => import("../pages/OutwardForm"),
  outwardDetail: () => import("../pages/OutwardDetail"),
  outwardTransportation: () => import("../pages/OutwardTransportation"),
  outwardDispatch: () => import("../pages/OutwardDispatch"),
  outwardReceiving: () => import("../pages/OutwardReceiving"),
  reports: () => import("../pages/Reports"),
  allusers: () => import("../pages/AllUsers"),
  stockLedger: () => import("../pages/StockLedger"),
  warehousemanagement: () => import("../pages/WarehouseMangement"),
  companies: () => import("../pages/CompanyManagement"),
  products: () => import("../pages/ProductManagement"),
};

const RELOAD_FLAG = "lazy-chunk-reloaded";

// After a new deploy, a tab that is still running the old build asks for
// chunk files that no longer exist. Reload once to pick up the new build
// instead of leaving the user on a blank error screen.
function lazyPage(importer) {
  return lazy(async () => {
    try {
      const module = await importer();
      sessionStorage.removeItem(RELOAD_FLAG);
      return module;
    } catch (error) {
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, "1");
        window.location.reload();
        return new Promise(() => {}); // page is reloading
      }
      throw error;
    }
  });
}

export const Signup = lazyPage(importers.signup);
export const Dashboard = lazyPage(importers.dashboard);
export const InwardList = lazyPage(importers.inward);
export const InwardForm = lazyPage(importers.inwardForm);
export const InwardDetail = lazyPage(importers.inwardDetail);
export const OutwardList = lazyPage(importers.outward);
export const OutwardForm = lazyPage(importers.outwardForm);
export const OutwardDetail = lazyPage(importers.outwardDetail);
export const OutwardTransportation = lazyPage(importers.outwardTransportation);
export const OutwardDispatch = lazyPage(importers.outwardDispatch);
export const OutwardReceiving = lazyPage(importers.outwardReceiving);
export const Reports = lazyPage(importers.reports);
export const AllUsers = lazyPage(importers.allusers);
export const StockLedger = lazyPage(importers.stockLedger);
export const WarehouseManagement = lazyPage(importers.warehousemanagement);
export const CompanyManagement = lazyPage(importers.companies);
export const ProductManagement = lazyPage(importers.products);

// `key` matches the sidebar keys (dashboard, inward, outward, reports,
// companies, allusers, warehousemanagement, products) plus the form keys.
export function prefetchRoute(key) {
  const importer = importers[key];
  if (importer) importer().catch(() => {});
}
