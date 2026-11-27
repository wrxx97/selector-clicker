import { useEffect, useState } from "react";
import { EyeOff, MousePointer2 } from "lucide-react";
import { Tabs } from "radix-ui";
import { useTranslation } from "react-i18next";
import { createRoot } from "react-dom/client";
import { startLanguage } from "@/lib/i18n";
import { startTheme } from "@/lib/theme";
import { PopupToast } from "./feedback";
import { PopupHeader } from "./header";
import { SiteCard } from "./site";
import { PopupFooter } from "./footer";
import { startPopup } from "./store";
import "../styles/theme.css";
import "./popup.css";

function Popup() {
  const { t } = useTranslation();
  const [tab, setTab] = useState(() => localStorage.getItem("automationTab") === "hide" ? "hide" : "click");
  function selectTab(value: string) {
    const next = value === "hide" ? "hide" : "click";
    setTab(next);
    localStorage.setItem("automationTab", next);
  }
  useEffect(() => startLanguage("appName"), []);
  useEffect(startTheme, []);
  useEffect(startPopup, []);
  return <main className="grid w-96 max-w-full gap-3 p-3.5 text-sm">
    <PopupHeader hiding={tab === "hide"} />
    <Tabs.Root value={tab} onValueChange={selectTab} className="grid gap-3">
      <Tabs.List aria-label={t("automationTypes")} className="grid grid-cols-2 gap-1 rounded-xl border bg-muted p-1">
        <Tabs.Trigger value="click" className="popup-tab"><MousePointer2 />{t("autoClick")}</Tabs.Trigger>
        <Tabs.Trigger value="hide" className="popup-tab"><EyeOff />{t("autoHide")}</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="click"><SiteCard hiding={false} /></Tabs.Content>
      <Tabs.Content value="hide"><SiteCard hiding /></Tabs.Content>
    </Tabs.Root>
    <PopupFooter showClicks={tab === "click"} />
    <PopupToast />
  </main>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Popup />);
