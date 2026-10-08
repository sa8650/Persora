import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./shadcn-theme.css";
import "./landing.css";
import "./workspace.css";
import "./overlays.css";
import "./billing.css";
import "./public-pages.css";
import "./admin-portal.css";
import "./persora-theme.css";
import "./document-panels.css";
import "./console-refinements.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
