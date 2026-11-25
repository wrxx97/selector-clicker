import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Toast, useToast } from "@/components/ui/toast";
import { previewRuleImport, validateSelector } from "@/lib/backup";
import { RULE_NAME_MAX_LENGTH, getExecutionOptions, normalizeSiteHostname, send } from "@/lib/extension";

function RuleDialogContent({ children, feedback, dismiss, ...props }) {
  return <DialogContent {...props} className="gap-0 p-0 sm:max-w-lg" showCloseButton={false}>
    <div className="grid max-h-[calc(100dvh-2rem)] gap-4 overflow-auto p-5">
      {children}
    </div>
    <Toast feedback={feedback} dismiss={dismiss} className="absolute inset-x-3.5 bottom-3.5 z-10 mx-auto" />
  </DialogContent>;
}

export function EditorDialog({ action, onClose, onSaved, returnFocus }) {
  const { hostname, rule, remove } = action;
  const [draft, setDraft] = useState({
    name: rule.name, selector: rule.selector, path: rule.pathPrefix, limit: rule.maxClicks || ""
  });
  const { feedback, setFeedback, dismiss } = useToast();
  const reportError = (text) => setFeedback({ text, error: true });
  const [saving, setSaving] = useState(false);
  const nameInput = useRef(null);
  const cancelButton = useRef(null);
  const update = (key) => (event) => setDraft((previous) => ({ ...previous, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const execution = event.currentTarget.checkValidity() ? getExecutionOptions(draft.path, Number(draft.limit)) : null;
    const invalid = !remove && (validateSelector(draft.selector) || (!execution &&
      "请输入以 / 开头的路径（不含查询参数）和非负整数点击次数。"));
    if (invalid) {
      reportError(invalid);
      return;
    }
    setSaving(true);
    setFeedback(null);
    const failure = remove ? "移除规则失败，请重试。" : "保存修改失败，请重试。";
    try {
      const message = {
        type: remove ? "remove-site-selector" : "edit-site-selector",
        hostname, selector: rule.selector, expectedId: rule.id
      };
      if (!remove) Object.assign(message, { replacement: draft.selector, name: draft.name, ...execution });
      const result = await send(message);
      if (!result?.ok) {
        const errors = { duplicate: "此网站已有相同的选择器。", missing: "这条规则已变更，请返回列表重新选择。" };
        reportError(errors[result?.reason] || failure);
        return;
      }
      await onSaved(remove ? "已移除规则。" : "已保存修改。");
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
        <DialogTitle>{remove ? "移除这条规则？" : "编辑规则"}</DialogTitle>
        <DialogDescription>{hostname}{remove && rule.name ? ` · ${rule.name}` : ""}</DialogDescription>
      </DialogHeader>
      <form id="rule-form" className="grid gap-3" onSubmit={submit} noValidate>
        {remove ? <code className="break-all rounded-lg bg-muted p-3 text-xs">{rule.selector}</code> : <>
          <label className="grid gap-1.5">
            备注名称（选填）
            <Input ref={nameInput} id="name-input" value={draft.name} maxLength={RULE_NAME_MAX_LENGTH}
              onChange={update("name")} readOnly={saving} />
          </label>
          <label className="grid gap-1.5">
            CSS 选择器
            <Textarea id="selector-input" className="font-mono" value={draft.selector} rows={3} spellCheck={false}
              onChange={update("selector")} readOnly={saving} />
          </label>
          <label className="grid gap-1.5">
            生效路径（选填）
            <Input id="path-prefix" value={draft.path} onChange={update("path")} readOnly={saving}
              placeholder="例如 /dashboard，留空表示全站" spellCheck={false} />
          </label>
          <label className="grid gap-1.5">
            每次页面加载最多点击
            <Input id="max-clicks" type="number" min="0" step="1" value={draft.limit} onChange={update("limit")}
              readOnly={saving} placeholder="0 表示不限次数" />
          </label>
        </>}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button ref={cancelButton} type="button" variant="outline" disabled={saving} onClick={onClose}>取消</Button>
          <Button type="submit" variant={remove ? "destructive" : "default"} disabled={saving}>
            {remove ? "移除规则" : "保存修改"}
          </Button>
        </div>
      </form>
    </RuleDialogContent>
  </Dialog>;
}

export function SiteDialog({ action, onClose, onSaved, returnFocus }) {
  const { site, remove } = action;
  const { hostname, rules } = site;
  const [destination, setDestination] = useState(hostname);
  const [saving, setSaving] = useState(false);
  const { feedback, setFeedback, dismiss } = useToast();
  const input = useRef(null);
  const cancel = useRef(null);

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const target = normalizeSiteHostname(destination);
    if (!remove && (!target || target === hostname)) {
      setFeedback({ text: "请输入一个不同的有效主机名，例如 example.com。", error: true });
      return;
    }
    setSaving(true);
    setFeedback(null);
    const failure = remove ? "删除站点规则失败，请重试。" : "修改站点失败，请重试。";
    try {
      const request = { hostname, expectedRuleIds: rules.map((rule) => rule.id) };
      const result = await send(remove
        ? { ...request, type: "remove-site-rules" }
        : { ...request, type: "rename-site", destination: target });
      if (!result?.ok) {
        const errors = {
          duplicate: "目标站点已有规则，请使用其他主机名。",
          changed: "站点规则已变更，请关闭窗口后重新操作。"
        };
        setFeedback({ text: errors[result?.reason] || failure, error: true });
        return;
      }
      await onSaved(remove ? "已删除该站点的全部规则。" : "已更新站点主机名。");
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
        <DialogTitle>{remove ? "删除此站点的全部规则？" : "编辑站点"}</DialogTitle>
        <DialogDescription>{remove
          ? `将删除 ${hostname} 的全部 ${rules.length} 条规则。此操作无法撤销。`
          : `修改主机名会迁移 ${hostname} 的全部 ${rules.length} 条规则，目标网站需单独授权。`}</DialogDescription>
      </DialogHeader>
      <form id="site-form" className="grid gap-3" onSubmit={submit}>
        {!remove && <label className="grid gap-1.5">
          主机名
          <Input ref={input} id="site-hostname" value={destination} onChange={(event) => setDestination(event.target.value)}
            readOnly={saving} spellCheck={false} autoCapitalize="none" autoComplete="off" />
        </label>}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button ref={cancel} type="button" variant="outline" disabled={saving} onClick={onClose}>取消</Button>
          <Button type="submit" variant={remove ? "destructive" : "default"} disabled={saving}>
            {remove ? "删除全部规则" : "保存站点"}
          </Button>
        </div>
      </form>
    </RuleDialogContent>
  </Dialog>;
}

export function BackupDialog({ source, onClose, onSaved, returnFocus }) {
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(source.preview);
  const [busy, setBusy] = useState(false);
  const { feedback, setFeedback, dismiss } = useToast();
  const reportError = (text) => setFeedback({ text, error: true });
  const input = useRef(null);
  const primary = useRef(null);
  const cancel = useRef(null);

  function focusCurrent() {
    (preview ? (preview.added ? primary : cancel) : input).current?.focus();
  }

  useEffect(focusCurrent, [preview]);

  async function submit(event) {
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
      await onSaved(`已导入 ${result.addedCount} 条规则，跳过 ${result.duplicateCount} 条重复规则。`);
    } catch (failure) {
      reportError(preview ? "导入失败，请检查浏览器同步存储空间后重试。" : failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <RuleDialogContent feedback={feedback} dismiss={dismiss} onCloseAutoFocus={returnFocus}
      onOpenAutoFocus={(event) => { event.preventDefault(); focusCurrent(); }}>
      <DialogHeader>
        <DialogTitle>{preview ? "预览导入规则" : "粘贴 JSON 导入"}</DialogTitle>
        <DialogDescription>{preview
          ? `将新增 ${preview.added} 条规则，跳过 ${preview.duplicates} 条重复规则。`
          : "粘贴或输入由 Selector Clicker 导出的规则 JSON。"}</DialogDescription>
      </DialogHeader>
      <form id="import-form" className="grid gap-3" onSubmit={submit}>
        {preview ? <ul className="grid max-h-56 gap-1.5 overflow-auto" aria-label="按站点预览">
          {preview.entries.map(({ hostname, added, duplicates }) =>
            <li key={hostname} className="break-all rounded-lg border bg-muted/50 px-3 py-2">
              <strong>{hostname}</strong>
              <span className="ml-2 text-xs text-muted-foreground">新增 {added.length} 条 · 重复 {duplicates} 条</span>
            </li>)}
        </ul> : <label className="grid gap-1.5">
          规则 JSON
          <Textarea ref={input} id="backup-text" value={draft} onChange={(event) => setDraft(event.target.value)}
            className="min-h-40 resize-y font-mono text-xs" spellCheck={false} readOnly={busy} />
        </label>}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          {preview && source.type === "text" && <Button type="button" variant="ghost"
            disabled={busy} onClick={() => { setPreview(null); setFeedback(null); }}>返回修改</Button>}
          <Button ref={cancel} type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button ref={primary} id="confirm-import" type="submit" disabled={busy || (preview && !preview.added)}>
            {preview ? "导入新增规则" : "预览导入"}
          </Button>
        </div>
      </form>
    </RuleDialogContent>
  </Dialog>;
}
