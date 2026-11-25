import { useCallback, useEffect, useState } from "react";
import { CircleAlert, Info, X } from "lucide-react";
import { Button } from "./button";

export interface ToastFeedback {
  text: string;
  error?: boolean;
}

export function useToast() {
  const [feedback, setFeedback] = useState<ToastFeedback | null>(null);
  const dismiss = useCallback((message: ToastFeedback) => {
    setFeedback((current) => current === message ? null : current);
  }, []);
  return { feedback, setFeedback, dismiss };
}

interface ToastProps {
  feedback: ToastFeedback | null;
  dismiss(feedback: ToastFeedback): void;
  className?: string;
}

export function Toast({ feedback, dismiss, className = "fixed inset-x-3.5 bottom-4 z-30 mx-auto" }: ToastProps) {
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => dismiss(feedback), feedback.error ? 5500 : 3500);
    return () => window.clearTimeout(timer);
  }, [dismiss, feedback]);

  const Icon = feedback?.error ? CircleAlert : Info;
  return <div data-slot="toast" className={`pointer-events-none max-w-[22.25rem] ${className}`}>
    <span className="sr-only" role="status" aria-atomic="true">{feedback?.text}</span>
    {feedback && <div className={`pointer-events-auto flex items-start gap-2 rounded-xl border bg-card p-2.5 text-xs
      leading-relaxed shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-150 ${
        feedback.error ? "border-red-200 text-destructive" : "border-input text-primary"
      }`}>
      <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1 self-center" aria-hidden="true">{feedback.text}</p>
      <Button type="button" size="icon-xs" variant="ghost" className="-my-0.5"
        aria-label="关闭提示" onClick={() => dismiss(feedback)}><X /></Button>
    </div>}
  </div>;
}
