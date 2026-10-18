import { Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";

// Login stays in the main bundle - it is the first screen most
// visitors see. Everything else is loaded on demand (see lazyPages.js).
import Login from "../pages/Login";
import AppLayout from "../components/AppLayout";
import ProtectedRoute from "../components/ProtectedRoutes";
import RouteFallback from "../components/RouteFallback";
import {
  Signup,
  Dashboard,
  Reports,
  InwardForm,
  InwardList,
  InwardDetail,
  OutwardForm,
  OutwardList,
  OutwardDetail,
  OutwardTransportation,
  OutwardDispatch,
  OutwardReceiving,
  AllUsers,
  WarehouseManagement,
  CompanyManagement,
  StockLedger,
  ProductManagement,
} from "./lazyPages";

// Full-screen flows have no shell around them, so they get their own
// Suspense boundary + a protected wrapper.
const fullScreen = (page, roles) => (
  <ProtectedRoute roles={roles}>
    <Suspense fallback={<RouteFallback fullScreen />}>{page}</Suspense>
  </ProtectedRoute>
);

// Who may open what. Sales and Account work with outward entries and can also
// VIEW inward details, reports and the dashboard (no inward create / edit).
const INVENTORY_ROLES = ["SUPER_ADMIN", "WAREHOUSE_MANAGER"];
const VIEW_ROLES = ["SUPER_ADMIN", "WAREHOUSE_MANAGER", "SALES", "ACCOUNT"];
const SALES_ROLES = ["SUPER_ADMIN", "SALES"];
const DISPATCH_ROLES = ["SUPER_ADMIN", "WAREHOUSE_MANAGER"];

const Home = () => <Dashboard />;

const inventoryOnly = (page) => (
  <ProtectedRoute roles={INVENTORY_ROLES}>{page}</ProtectedRoute>
);

const viewable = (page) => (
  <ProtectedRoute roles={VIEW_ROLES}>{page}</ProtectedRoute>
);

const router = createBrowserRouter([
  {
    path: "/",
    element: <Login />,
  },

  {
    path: "/signup",
    element: (
      <Suspense fallback={<RouteFallback fullScreen />}>
        <Signup />
      </Suspense>
    ),
  },

  // Pages that live inside the shared Navbar + Sidebar shell.
  // AppLayout derives which tab is active from the URL itself,
  // so switching tabs (or hitting Back after opening a detail
  // page) always lands on the right page instead of resetting
  // to the dashboard. AppLayout also owns the Suspense boundary,
  // so the Navbar + Sidebar stay on screen while a page chunk loads.
  {
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: "/dashboard", element: <Home /> },
      { path: "/inward", element: viewable(<InwardList />) },
      { path: "/outward", element: <OutwardList /> },
      { path: "/reports", element: viewable(<Reports />) },
      { path: "/allusers", element: <AllUsers /> },
      { path: "/stock-ledger", element: inventoryOnly(<StockLedger />) },
      { path: "/warehousemanagement", element: <WarehouseManagement /> },
      { path: "/companies", element: <CompanyManagement /> },
      { path: "/products", element: <ProductManagement /> },
    ],
  },

  // Full-screen flows (create forms + detail pages) - these have
  // their own header + Back button and intentionally render
  // without the sidebar/navbar shell.
  { path: "/inward/create", element: fullScreen(<InwardForm />, INVENTORY_ROLES) },
  { path: "/inward/:id/edit", element: fullScreen(<InwardForm />, INVENTORY_ROLES) },
  { path: "/inward/:id", element: fullScreen(<InwardDetail />, VIEW_ROLES) },

  // Sales fills customer + item + cost details (and edits them until Account approves).
  { path: "/outward/create", element: fullScreen(<OutwardForm />, SALES_ROLES) },
  { path: "/outward/:id/edit", element: fullScreen(<OutwardForm />, SALES_ROLES) },
  // Warehouse manager: transportation form first (after Account's approval), then the dispatch form once Account shares the documents.
  { path: "/outward/:id/transportation", element: fullScreen(<OutwardTransportation />, DISPATCH_ROLES) },
  { path: "/outward/:id/dispatch", element: fullScreen(<OutwardDispatch />, DISPATCH_ROLES) },
  // Right after dispatch: receiving date, receiver details and receiving documents.
  { path: "/outward/:id/receiving", element: fullScreen(<OutwardReceiving />, DISPATCH_ROLES) },
  { path: "/outward/:id", element: fullScreen(<OutwardDetail />) },
]);

export default router;
