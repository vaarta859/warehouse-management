import { Loader2 } from "lucide-react";

// Shown while a lazily-loaded page chunk is being fetched.
// Inside the app shell (Navbar + Sidebar) it only fills the content area;
// for full-screen pages (forms, details, signup) it fills the viewport.
export default function RouteFallback({ fullScreen = false }) {
  return (
    <div
      role="status"
      aria-label="Loading page"
      className={`flex items-center justify-center ${
        fullScreen ? "min-h-dvh bg-[#F1EFE8]" : "min-h-[60vh]"
      }`}
    >
      <Loader2 size={28} className="animate-spin text-blue-600" />
    </div>
  );
}
