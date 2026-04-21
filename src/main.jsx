import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./sw-register.js";
import { Analytics } from "@vercel/analytics/react";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <Analytics />
  </React.StrictMode>
);
