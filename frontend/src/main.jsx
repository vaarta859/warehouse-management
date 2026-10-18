import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { RouterProvider } from "react-router-dom";
import CenterMessageHost from "./components/CenterMessage";

import { store } from "./app/store";
import router from "./routes/AppRoutes";

import "./index.css";

createRoot(document.getElementById("root")).render(
  <Provider store={store}>
    <RouterProvider router={router} />
    <CenterMessageHost />
  </Provider>
);
