import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/rubik/400.css";
import "@fontsource/rubik/500.css";
import "@fontsource/rubik/600.css";
import "./styles.css";
import App from "./App";
import { initAppearance } from "./appearance";

initAppearance(); // theme the island before the first paint

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
