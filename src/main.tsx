import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Fonts are bundled (no Google Fonts request), so they also work offline.
import "@fontsource/ibm-plex-sans/latin-400";
import "@fontsource/ibm-plex-sans/latin-500";
import "@fontsource/ibm-plex-sans/latin-600";
import "@fontsource/ibm-plex-mono/latin-400";
import "@fontsource/ibm-plex-mono/latin-500";
import "@fontsource-variable/newsreader/opsz";
import "@fontsource/oswald/latin-500";
import "@fontsource/barlow-condensed/latin-700-italic";
import "@fontsource/cinzel/latin-600";
import "@fontsource/big-shoulders-display/latin-800";
import "@fontsource/russo-one/latin-400";
import "./styles.css";
import { liveModel } from "./model/live";
import { initTheme } from "./theme";

initTheme();

void liveModel.init();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
