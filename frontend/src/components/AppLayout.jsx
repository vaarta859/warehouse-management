import { Suspense, useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Navbar from "./Navbar";
import Sidebar from "./Sidebar";
import RouteFallback from "./RouteFallback";
import { prefetchRoute } from "../routes/lazyPages";

// Derives which sidebar/bottom-nav item should be highlighted
// from the actual URL, instead of local component state - this
// is what makes browser/`navigate(-1)` back-navigation land on
// the right page instead of resetting to the dashboard tab.
function getActiveKey(pathname) {
  if (pathname.startsWith("/inward")) return "inward";
  if (pathname.startsWith("/outward")) return "outward";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/companies")) return "companies";
  if (pathname.startsWith("/products")) return "products";
  if (pathname.startsWith("/allusers")) return "allusers";
  if (pathname.startsWith("/warehousemanagement")) return "warehousemanagement";
  return "dashboard";
}

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const active = getActiveKey(location.pathname);
  const mainRef = useRef(null);

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

  // Back from any main page (Inward, Outward, Reports...) should land on the
  // Dashboard. So opening a page FROM the dashboard adds a history entry, but
  // switching between pages from the sidebar replaces the current one - the
  // entry just below it stays the dashboard.
  const handleNavigate = (key) => {
    if (`/${key}` === location.pathname) return;
    navigate(`/${key}`, { replace: active !== "dashboard" });
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
