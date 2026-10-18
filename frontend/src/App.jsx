import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";

import { setUnauthorizedHandler } from "./services/apiClient";
import { sessionExpired } from "./features/auth/authSlice";

export default function App() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      dispatch(sessionExpired());
      navigate("/", { replace: true });
    });
  }, [dispatch, navigate]);

  return null;
}