import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { autoDetectBatterySaver } from "./util/batterySaver";

autoDetectBatterySaver();

createRoot(document.getElementById("root")!).render(<App />);
