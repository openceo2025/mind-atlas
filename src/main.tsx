import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MindAtlasI18nProvider } from "./i18n/I18nProvider";
import "./styles.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Notifications still fall back to the page Notification API where supported.
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MindAtlasI18nProvider>
      <App />
    </MindAtlasI18nProvider>
  </StrictMode>,
);
