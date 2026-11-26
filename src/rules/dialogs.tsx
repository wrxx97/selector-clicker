import { useEffect, useRef, useState, type ChangeEvent, type ComponentProps, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Toast, useToast, type ToastFeedback } from "@/components/ui/toast";
import { previewRuleImport, validateSelector, type BackupPreview } from "@/lib/backup";
import { RULE_NAME_MAX_LENGTH, getExecutionOptions, normalizeSiteHostname, send } from "@/lib/extension";
import { useTranslation } from "react-i18next";
import type { Rule, RuleSite, WorkerRequest } from "@/lib/extension-types";

type RuleAction = { kind: "rule"; hostname: string; rule: Rule; remove: boolean };
type SiteAction = { kind: "site"; site: RuleSite; remove: boolean };
type BackupSource = { type: "text"; preview?: never } | { type: "file"; preview: BackupPreview };

export type ManagerDialog = RuleAction | SiteAction | { kind: "backup"; source: BackupSource };
export type OpenManagerDialog = (dialog: ManagerDialog, trigger: HTMLElement | null) => void;

interface DialogCallbacks {
  onClose(): void;
  onSaved(message: string): Promise<void>;
  returnFocus(event: Event): void;
}

interface RuleDialogContentProps extends Omit<ComponentProps<typeof DialogContent>, "className" | "showCloseButton"> {
  feedback: ToastFeedback | null;
  dismiss(feedback: ToastFeedback): void;
}

function RuleDialogContent({ children, feedback, dismiss, ...props }: RuleDialogContentProps) {
  return <DialogContent {...props} className="gap-0 p-0 sm:max-w-lg" showCloseButton={false}>
    <div className="grid max-h-[calc(100dvh-2rem)] gap-4 overflow-auto p-5">
      {children}
    </div>
    <Toast feedback={feedback} dismiss={dismiss} className="absolute inset-x-3.5 bottom-3.5 z-10 mx-auto" />
  </DialogContent>;
}

export function EditorDialog({ action, onClose, onSaved, returnFocus }: DialogCallbacks & { action: RuleAction }) {
  const { t } = useTranslation();
  const { hostname, rule, remove } = action;
  const [draft, setDraft] = useState({
    name: rule.name, selector: rule.selector, path: rule.pathPrefix, limit: rule.maxClicks || ""
  });
  const { feedback, setFeedback, dismiss } = useToast();
  const reportError = (text: string) => setFeedback({ text, error: true });
  const [saving, setSaving] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const update = (key: keyof typeof draft) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { value } = event.target;
    setDraft((previous) => ({ ...previous, [key]: value }));
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const target = { hostname, selector: rule.selector, expectedId: rule.id };
    let message: WorkerRequest = { type: "remove-site-selector", ...target };
    if (!remove) {
      const execution = event.currentTarget.checkValidity()
        ? getExecutionOptions(draft.path, Number(draft.limit)) : null;
      const invalid = validateSelector(draft.selector);
      if (invalid || !execution) {
        reportError(invalid || t("invalidExecution"));
        return;
      }
      message = { type: "edit-site-selector", ...target, replacement: draft.selector, name: draft.name, ...execution };
    }
    setSaving(true);
    setFeedback(null);
    const failure = remove ? t("removeRuleError") : t("saveEditError");
    try {
      const result = await send(message);
      if (!result?.ok) {
        const errors: Record<string, string> = { duplicate: t("selectorDuplicate"), missing: t("ruleChanged") };
        reportError(errors[result?.reason ?? ""] || failure);
        return;
      }
      await onSaved(remove ? t("ruleRemoved") : t("changesSaved"));
    } catch {
      reportError(failure);
    } finally {
      setSaving(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <RuleDialogContent feedback={feedback} dismiss={dismiss}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        (remove ? cancelButton : nameInput).current?.focus();
      }} onCloseAutoFocus={returnFocus}>
      <DialogHeader>
        <DialogTitle>{remove ? t("removeRuleConfirm") : t("editRule")}</DialogTitle>
        <DialogDescription>{hostname}{remove && rule.name ? ` · ${rule.name}` : ""}</DialogDescription>
      </DialogHeader>
      <form id="rule-form" className="grid gap-3" onSubmit={submit} noValidate>
        {remove ? <code className="break-all rounded-lg bg-muted p-3 text-xs">{rule.selector}</code> : <>
          <label className="grid gap-1.5">
            {t("ruleNameOptional")}
            <Input ref={nameInput} id="name-input" value={draft.name} maxLength={RULE_NAME_MAX_LENGTH}
              onChange={update("name")} readOnly={saving} />
          </label>
          <label className="grid gap-1.5">
            {t("cssSelector")}
            <Textarea id="selector-input" className="font-mono" value={draft.selector} rows={3} spellCheck={false}
              onChange={update("selector")} readOnly={saving} />
          </label>
          <label className="grid gap-1.5">
            {t("pathOptional")}
            <Input id="path-prefix" value={draft.path} onChange={update("path")} readOnly={saving}
              placeholder={t("pathPlaceholder")} spellCheck={false} />
          </label>
          <label className="grid gap-1.5">
            {t("clickLimit")}
            <Input id="max-clicks" type="number" min="0" step="1" value={draft.limit} onChange={update("limit")}
              readOnly={saving} placeholder={t("limitPlaceholder")} />
          </label>
        </>}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button ref={cancelButton} type="button" variant="outline" disabled={saving} onClick={onClose}>{t("cancel")}</Button>
          <Button type="submit" variant={remove ? "destructive" : "default"} disabled={saving}>
            {remove ? t("removeRuleAction") : t("saveChanges")}
          </Button>
        </div>
      </form>
    </RuleDialogContent>
  </Dialog>;
}

export function SiteDialog({ action, onClose, onSaved, returnFocus }: DialogCallbacks & { action: SiteAction }) {
  const { t } = useTranslation();
  const { site, remove } = action;
  const { hostname, rules } = site;
  const [destination, setDestination] = useState(hostname);
  const [saving, setSaving] = useState(false);
  const { feedback, setFeedback, dismiss } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const target = normalizeSiteHostname(destination);
    if (!remove && (!target || target === hostname)) {
      setFeedback({ text: t("invalidHostname"), error: true });
      return;
    }
    setSaving(true);
    setFeedback(null);
    const failure = remove ? t("deleteSiteError") : t("editSiteError");
    try {
      const request = { hostname, expectedRuleIds: rules.map((rule) => rule.id) };
      const result = await send(remove
        ? { ...request, type: "remove-site-rules" }
        : { ...request, type: "rename-site", destination: target });
      if (!result?.ok) {
        const errors: Record<string, string> = {
          duplicate: t("destinationRulesExist"),
          changed: t("siteRulesChanged")
        };
        setFeedback({ text: errors[result?.reason ?? ""] || failure, error: true });
        return;
      }
      await onSaved(remove ? t("siteRulesDeleted") : t("siteUpdated"));
    } catch {
      setFeedback({ text: failure, error: true });
    } finally {
      setSaving(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <RuleDialogContent feedback={feedback} dismiss={dismiss} onCloseAutoFocus={returnFocus}
      onOpenAutoFocus={(event) => { event.preventDefault(); (remove ? cancel : input).current?.focus(); }}>
      <DialogHeader>
        <DialogTitle>{remove ? t("deleteSiteConfirm") : t("editSite")}</DialogTitle>
        <DialogDescription>{remove
          ? t("deleteSiteDescription", { hostname, rules: t("rules", { count: rules.length }) })
          : t("editSiteDescription", { hostname, rules: t("rules", { count: rules.length }) })}</DialogDescription>
      </DialogHeader>
      <form id="site-form" className="grid gap-3" onSubmit={submit}>
        {!remove && <label className="grid gap-1.5">
          {t("hostname")}
          <Input ref={input} id="site-hostname" value={destination} onChange={(event) => setDestination(event.target.value)}
            readOnly={saving} spellCheck={false} autoCapitalize="none" autoComplete="off" />
        </label>}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button ref={cancel} type="button" variant="outline" disabled={saving} onClick={onClose}>{t("cancel")}</Button>
          <Button type="submit" variant={remove ? "destructive" : "default"} disabled={saving}>
            {remove ? t("deleteAllRules") : t("saveSite")}
          </Button>
        </div>
      </form>
    </RuleDialogContent>
  </Dialog>;
}

export function BackupDialog({ source, onClose, onSaved, returnFocus }: DialogCallbacks & { source: BackupSource }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<BackupPreview | null>(source.preview ?? null);
  const [busy, setBusy] = useState(false);
  const { feedback, setFeedback, dismiss } = useToast();
  const reportError = (text: string) => setFeedback({ text, error: true });
  const input = useRef<HTMLTextAreaElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  function focusCurrent() {
    (preview ? (preview.added ? primary : cancel) : input).current?.focus();
  }

  useEffect(focusCurrent, [preview]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (preview && !preview.added)) return;
    setBusy(true);
    setFeedback(null);
    try {
      if (!preview) {
        setPreview(await previewRuleImport(draft));
        return;
      }
      const result = await send({ type: "import-rules", backup: preview.backup });
      if (!result?.ok) throw new Error("Could not import rules");
      await onSaved(t("importComplete", {
        rules: t("rules", { count: result.addedCount ?? 0 }),
        duplicates: result.duplicateCount ?? 0
      }));
    } catch (failure) {
      reportError(preview || !(failure instanceof Error) ? t("importError") : failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <RuleDialogContent feedback={feedback} dismiss={dismiss} onCloseAutoFocus={returnFocus}
      onOpenAutoFocus={(event) => { event.preventDefault(); focusCurrent(); }}>
      <DialogHeader>
        <DialogTitle>{preview ? t("importPreviewTitle") : t("pasteImportTitle")}</DialogTitle>
        <DialogDescription>{preview
          ? t("importPreview", { rules: t("rules", { count: preview.added }), duplicates: preview.duplicates })
          : t("pasteImportDescription")}</DialogDescription>
      </DialogHeader>
      <form id="import-form" className="grid gap-3" onSubmit={submit}>
        {preview ? <ul className="grid max-h-56 gap-1.5 overflow-auto" aria-label={t("previewBySite")}>
          {preview.entries.map(({ hostname, added, duplicates }) =>
            <li key={hostname} className="break-all rounded-lg border bg-muted/50 px-3 py-2">
              <strong>{hostname}</strong>
              <span className="ml-2 text-xs text-muted-foreground">{t("siteImportCounts", { added: added.length, duplicates })}</span>
            </li>)}
        </ul> : <label className="grid gap-1.5">
          {t("ruleJson")}
          <Textarea ref={input} id="backup-text" value={draft} onChange={(event) => setDraft(event.target.value)}
            className="min-h-[min(10rem,45dvh)] max-h-[min(18rem,45dvh)] resize-y overflow-y-auto font-mono text-xs" spellCheck={false} readOnly={busy} />
        </label>}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          {preview && source.type === "text" && <Button type="button" variant="ghost"
            disabled={busy} onClick={() => { setPreview(null); setFeedback(null); }}>{t("backToEdit")}</Button>}
          <Button ref={cancel} type="button" variant="outline" disabled={busy} onClick={onClose}>{t("cancel")}</Button>
          <Button ref={primary} id="confirm-import" type="submit" disabled={busy || (preview !== null && !preview.added)}>
            {preview ? t("importNewRules") : t("previewImport")}
          </Button>
        </div>
      </form>
    </RuleDialogContent>
  </Dialog>;
}
