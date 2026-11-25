import { useShallow } from "zustand/react/shallow";
import { Switch } from "@/components/ui/switch";
import { usePopupStore } from "./store";

export function PopupHeader() {
  const { enabled, initialized, settingsBusy, setEnabled } = usePopupStore(useShallow((state) => ({
    enabled: state.enabled, initialized: state.initialized,
    settingsBusy: state.settingsBusy, setEnabled: state.setEnabled
  })));

  return <header className="flex items-center gap-3 rounded-2xl border border-[#cfe2fa] bg-linear-to-br from-[#eaf4ff] to-[#d6e9ff] px-3.5 py-3">
    <img src="./icons/icon-48.png" alt="" width="40" height="40" className="shrink-0 rounded-xl" />
    <div className="min-w-0 flex-1">
      <h1 className="text-base font-bold tracking-tight">元素自动点击</h1>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={`size-1.5 rounded-full ${enabled ? "bg-primary" : "bg-slate-400"}`} />
        {initialized ? (enabled ? "已启用" : "已停用") : "正在读取…"}
      </p>
    </div>
    <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled}
      disabled={!initialized || settingsBusy} aria-label="自动点击" />
  </header>;
}
