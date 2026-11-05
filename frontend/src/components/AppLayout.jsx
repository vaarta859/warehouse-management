import { Suspense, useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Navbar from "./Navbar";
import Sidebar from "./Sidebar";
import RouteFallback from "./RouteFallback";
import { prefetchRoute } from "../routes/lazyPages";
import { forgetPersistedState } from "../features/shared/usePersistedState";

// Derives which sidebar/bottom-nav item should be highlighted
// from the actual URL, instead of local component state - this
// is what makes browser/`navigate(-1)` back-navigation land on
// the right page instead of resetting to the dashboard tab.
function getActiveKey(pathname) {
  if (pathname.startsWith("/inward")) return "inward";
  if (pathname.startsWith("/outward")) return "outward";
  // The Stock Ledger (and its serial / transfer pages) is opened from Reports, so Reports stays highlighted.
  if (pathname.startsWith("/reports") || pathname.startsWith("/stock-ledger")) return "reports";
  if (pathname.startsWith("/companies")) return "companies";
  if (pathname.startsWith("/products")) return "products";
  if (pathname.startsWith("/allusers")) return "allusers";
  if (pathname.startsWith("/warehousemanagement")) return "warehousemanagement";
  return "dashboard";
}

// Where Back goes from each main page, whatever route led there:
// Stock Ledger -> Reports, Reports / Inward / Outward / the admin pages -> Dashboard.
const BACK_PARENT = {
  "/stock-ledger": "/reports",
  "/reports": "/dashboard",
  "/inward": "/dashboard",
  "/outward": "/dashboard",
  "/companies": "/dashboard",
  "/products": "/dashboard",
  "/allusers": "/dashboard",
  "/warehousemanagement": "/dashboard",
};

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const active = getActiveKey(location.pathname);
  const mainRef = useRef(null);

  // Browser / phone Back from a main page goes to its parent page (see BACK_PARENT), not to whatever page
  // happened to be open before it. Detail pages (an inward / outward entry) still go back to where they came from.
  const norm = (path) => path.replace(/\/+$/, "") || "/";
  const lastPath = useRef(norm(location.pathname)); // page shown now
  const prevPath = useRef(null); // page shown before it
  useEffect(() => {
    const now = norm(location.pathname);
    if (lastPath.current !== now) {
      prevPath.current = lastPath.current;
      lastPath.current = now;
    }
  }, [location.pathname]);
  useEffect(() => {
    const onPop = () => {
      // React may already have rendered the page we went back to when this runs (then lastPath is the new page and
      // prevPath the one we left), or not yet (then lastPath is still the page we left).
      const arrived = norm(window.location.pathname);
      const left = arrived === lastPath.current ? prevPath.current : lastPath.current;
      const target = BACK_PARENT[left];
      if (!target) return;
      setTimeout(() => {
        if (norm(window.location.pathname) !== target) navigate(target, { replace: true });
      }, 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [navigate]);

  // Tables marked "mobile-cards" turn into stacked cards on phones (see index.css);
  // each cell gets its column heading as data-label so the card shows "Heading: value".
  useEffect(() => {
    const root = mainRef.current;
    if (!root) return undefined;
    const label = () => {
      root.querySelectorAll("table.mobile-cards").forEach((table) => {
        const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent.trim());
        table.querySelectorAll("tbody tr").forEach((tr) => {
          Array.from(tr.children).forEach((td, i) => {
            if (td.tagName === "TD" && !td.hasAttribute("colspan") && heads[i] && td.getAttribute("data-label") !== heads[i]) td.setAttribute("data-label", heads[i]);
          });
        });
      });
    };
    label();
    const observer = new MutationObserver(label);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Once the shell is up and the browser is idle, download the pages people
  // open most so navigating to them doesn't wait on a network round-trip.
  useEffect(() => {
    const warm = () =>
      ["dashboard", "inward", "outward", "reports", "inwardForm", "outwardForm"].forEach(
        prefetchRoute
      );

    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }

    const id = setTimeout(warm, 2000);
    return () => clearTimeout(id);
  }, []);

  // Back from a main page (Inward, Outward, Reports...) opened from the Dashboard lands on the Dashboard:
  // switching between those main pages from the sidebar replaces the current entry, so the entry below it
  // stays the Dashboard. Only a main page itself is replaced - a page opened from it (Stock Ledger, serial
  // list, an inward / outward detail) stays in the history, so Back from the next page returns to it.
  const handleNavigate = (key) => {
    if (`/${key}` === location.pathname) return;
    // Opening Inward / Outward from the sidebar shows the newest entries (page 1). The page, search and filters
    // are still remembered when coming BACK from an entry, because that doesn't go through the sidebar.
    if (key === "inward" || key === "outward") forgetPersistedState(`${key}.page`);
    const onMainPage = active !== "dashboard" && location.pathname === `/${active}`;
    navigate(`/${key}`, { replace: onMainPage });
  };

  return (
    <div className="h-dvh flex flex-col bg-gray-50">
      <Navbar location="Delhi Warehouse" />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar active={active} onNavigate={handleNavigate} />

        {/* pb-16 reserves space for Sidebar's mobile bottom bar;
            md:pb-0 because that bar is hidden at md+ (real sidebar shown instead) */}
        <main ref={mainRef} className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
