import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./sw-register.js";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
