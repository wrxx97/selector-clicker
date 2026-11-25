import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { startTheme } from "@/lib/theme";
import { PopupToast } from "./feedback";
import { PopupHeader } from "./header";
import { SiteCard } from "./site";
import { PopupFooter } from "./footer";
import { startPopup } from "./store";
import "../styles/theme.css";
import "./popup.css";

function Popup() {
  useEffect(startTheme, []);
  useEffect(startPopup, []);
  return <main className="grid w-96 max-w-full gap-3 p-3.5 text-sm">
    <PopupHeader />
    <SiteCard />
    <PopupFooter />
    <PopupToast />
  </main>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Popup />);
