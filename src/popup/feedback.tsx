import { Toast } from "@/components/ui/toast";
import { usePopupStore } from "./store";

export function PopupToast() {
  const feedback = usePopupStore((state) => state.toast);
  const dismiss = usePopupStore((state) => state.dismissToast);

  return <Toast feedback={feedback} dismiss={dismiss} className="fixed inset-x-3.5 bottom-12 z-30 mx-auto" />;
}
