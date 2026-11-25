import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { previewRuleImport, validateSelector } from "@/lib/backup";
import { RULE_NAME_MAX_LENGTH, getExecutionOptions, send } from "@/lib/extension";

const dialogClass = "max-h-[calc(100dvh-2rem)] overflow-auto p-5 sm:max-w-lg";

export function EditorDialog({ action, onClose, onSaved, returnFocus }) {
  const { hostname, rule, remove } = action;
  const [draft, setDraft] = useState({
    name: rule.name, selector: rule.selector, path: rule.pathPrefix, limit: rule.maxClicks || ""
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const nameInput = useRef(null);
  const cancelButton = useRef(null);
  const update = (key) => (event) => setDraft((previous) => ({ ...previous, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const execution = getExecutionOptions(draft.path, Number(draft.limit));
    const invalid = !remove && (validateSelector(draft.selector) || (!execution &&
      "请输入以 / 开头的路径（不含查询参数）和非负整数点击次数。"));
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError("");
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
        setError(errors[result?.reason] || failure);
        return;
      }
      onSaved(remove ? "已移除规则。" : "已保存修改。");
    } catch {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent className={dialogClass} showCloseButton={false}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        (remove ? cancelButton : nameInput).current?.focus();
      }} onCloseAutoFocus={returnFocus}>
      <DialogHeader>
        <DialogTitle>{remove ? "移除这条规则？" : "编辑规则"}</DialogTitle>
        <DialogDescription>{hostname}{remove && rule.name ? ` · ${rule.name}` : ""}</DialogDescription>
      </DialogHeader>
      <form id="rule-form" className="grid gap-3" onSubmit={submit}>
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
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button ref={cancelButton} type="button" variant="outline" disabled={saving} onClick={onClose}>取消</Button>
          <Button type="submit" variant={remove ? "destructive" : "default"} disabled={saving}>
            {remove ? "移除规则" : "保存修改"}
          </Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function BackupDialog({ source, onClose, onSaved, returnFocus }) {
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(source.preview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    setError("");
    try {
      if (!preview) {
        setPreview(await previewRuleImport(draft));
        return;
      }
      const result = await send({ type: "import-rules", backup: preview.backup });
      if (!result?.ok) throw new Error("Could not import rules");
      onSaved(`已导入 ${result.addedCount} 条规则，跳过 ${result.duplicateCount} 条重复规则。`);
    } catch (failure) {
      setError(preview ? "导入失败，请检查浏览器同步存储空间后重试。" : failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className={dialogClass} showCloseButton={false} onCloseAutoFocus={returnFocus}
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
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          {preview && source.type === "text" && <Button type="button" variant="ghost"
            disabled={busy} onClick={() => { setPreview(null); setError(""); }}>返回修改</Button>}
          <Button ref={cancel} type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button ref={primary} id="confirm-import" type="submit" disabled={busy || (preview && !preview.added)}>
            {preview ? "导入新增规则" : "预览导入"}
          </Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
