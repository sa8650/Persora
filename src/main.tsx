import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./landing.css";
import "./workspace.css";
import "./overlays.css";
import "./billing.css";
import "./public-pages.css";
import "./admin-portal.css";
import "./persora-theme.css";
import "./console-refinements.css";
import "./design-system/system.css";
import "./design-system/typography.css";
import { PersoraThemeProvider } from "./design-system";
import { PersoraSkulletProvider } from "./components/skullet/PersoraSkulletProvider";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PersoraThemeProvider>
      <PersoraSkulletProvider>
        <App />
      </PersoraSkulletProvider>
    </PersoraThemeProvider>
  </React.StrictMode>,
);
