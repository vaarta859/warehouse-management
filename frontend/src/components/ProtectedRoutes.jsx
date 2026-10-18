import { Navigate } from "react-router-dom";

// `roles` (optional): only these roles may open the page. Anyone else is
// sent to the page every role can use - the outward list.
export default function ProtectedRoute({ children, roles }) {
  const token = localStorage.getItem("token");

  if (!token) {
    return <Navigate to="/" replace />;
  }

  if (roles) {
    let role = null;
    try {
      role = JSON.parse(localStorage.getItem("user"))?.role;
    } catch {
      role = null;
    }
    if (!roles.includes(role)) {
      return <Navigate to="/outward" replace />;
    }
  }

  return children;
}
