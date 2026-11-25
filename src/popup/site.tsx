import { Crosshair, Globe } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RuleList } from "./rule-list";
import { usePopupStore } from "./store";

function SiteControls() {
  const { site, initialized, authorized, busy, pick } = usePopupStore(useShallow((state) => ({
    site: state.site, initialized: state.initialized, authorized: state.authorized, busy: state.siteBusy,
    pick: state.pick
  })));
  return <>
    <div className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
        <Globe size={15} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">当前网站</p>
        <h2 className="truncate font-bold" title={site?.hostname}>
          {site?.hostname || (initialized ? "当前页面不可用" : "正在读取…")}
        </h2>
      </div>
    </div>
    <Button id="pick-element" className="w-full" disabled={!initialized || !site || busy} onClick={() => pick()}>
      <Crosshair /> {site && !authorized ? "授权并选取元素" : "在页面上选取元素"}
    </Button>
  </>;
}

export function SiteCard() {
  return <Card className="gap-3 p-3.5 shadow-xs">
    <SiteControls />
    <RuleList />
  </Card>;
}
