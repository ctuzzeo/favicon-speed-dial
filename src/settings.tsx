import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppReady } from "#components/AppReady";
import { ErrorBoundary } from "#components/ErrorBoundary";
import { Settings } from "#pages/Settings";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppReady>
        <Settings />
      </AppReady>
    </ErrorBoundary>
  </StrictMode>,
);
