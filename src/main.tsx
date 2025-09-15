import React from "react";
import ReactDOM from "react-dom/client";
import AppMedidas from "./App";  // también podría ser: import App from "./App"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppMedidas />                {/* si arriba usaste App, pon <App /> */}
  </React.StrictMode>
);
