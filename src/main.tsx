import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Overlay from "./Overlay";
import "./styles.css";

// 按 URL 参数路由：?view=overlay 加载 Overlay，否则加载主控制台
const params = new URLSearchParams(window.location.search);
const view = params.get("view");

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (view === "overlay") {
  root.render(
    <React.StrictMode>
      <Overlay />
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
