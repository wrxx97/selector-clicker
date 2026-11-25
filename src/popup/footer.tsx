import { Settings } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { usePopupStore } from "./store";

function ClickStats() {
  const { page, total } = usePopupStore(useShallow((state) => ({ page: state.pageClicks, total: state.totalClicks })));
  return <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
    {page != null && <span>本页已点击 <strong className="font-semibold text-foreground">{page.toLocaleString("zh-CN")}</strong> 次</span>}
    {total != null && <span>本机累计 <strong className="font-semibold text-foreground">{total.toLocaleString("zh-CN")}</strong> 次</span>}
  </div>;
}

export function PopupFooter() {
  const { busy, manage } = usePopupStore(useShallow((state) => ({ busy: state.siteBusy, manage: state.manage })));
  return <footer className="flex items-center justify-between gap-2">
    <ClickStats />
    <div className="flex shrink-0 items-center gap-0.5">
      <Button asChild size="icon-sm" variant="ghost" className="text-primary">
        <a href="https://github.com/wrxx97/selector-clicker/releases" target="_blank" rel="noopener noreferrer"
          aria-label="GitHub Releases" title="GitHub Releases">
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
      </Button>
      <Button id="manage-rules" type="button" size="icon-sm" variant="ghost"
        className="text-primary" aria-label="设置" title="设置" disabled={busy} onClick={manage}>
        <Settings />
      </Button>
    </div>
  </footer>;
}
