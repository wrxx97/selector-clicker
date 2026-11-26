import type { TOptions } from "i18next";
import { createI18n, resolveLocale, type ExtensionLocale, type TranslationKey } from "../i18n/core";

export { languageStorageKey, normalizePreference, resolveLocale } from "../i18n/core";

interface PickerSession {
  host: HTMLElement;
  controller: AbortController;
  finish(saved?: boolean): void;
  localize(): void;
}
type PickerSelection = { target: HTMLElement; selector: string };
type PickerSave = (selector: string, name: string, editing?: RuntimeRule) => Promise<TranslationKey | void>;

var PICKER_CONTROL = 'button, a[href], input, select, textarea, summary, label, [role="button"], [role="link"], [onclick]';
var PICKER_ATTRIBUTES = ["data-testid", "data-test", "data-qa", "aria-label", "name", "title"];

function getPickerTarget(hit: Element | null) {
  const element = hit?.closest(PICKER_CONTROL) || hit;
  return element instanceof HTMLElement &&
    !element.matches("html, body, iframe, frame") &&
    typeof element.click === "function" ? element : null;
}

function getPickerSelector(target: HTMLElement) {
  let relativePath = "";
  for (let element: HTMLElement | null = target; element; element = element.parentElement) {
    const tag = CSS.escape(element.localName);
    const candidates = [];
    if (element.id) candidates.push(`#${CSS.escape(element.id)}`);
    for (const attribute of PICKER_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (value) candidates.push(`${tag}[${attribute}="${CSS.escape(value)}"]`);
    }
    const classes = [...element.classList].slice(0, 3).map((name) => `.${CSS.escape(name)}`);
    for (const name of classes) candidates.push(tag + name);
    if (classes.length > 1) candidates.push(tag + classes.join(""));

    const siblings = element.parentElement
      ? [...element.parentElement.children].filter((child) => child.localName === element.localName)
      : [];
    const position = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(element) + 1})` : "";
    if (element.parentElement === null) candidates.push(tag);
    for (const anchor of candidates) {
      const selector = anchor + relativePath;
      const matches = document.querySelectorAll(selector);
      if (matches.length === 1 && matches[0] === target) return selector;
    }
    relativePath = ` > ${tag}${position}${relativePath}`;
  }
  return "";
}

var PICKER_STYLES = `
  :host {
    all: initial;
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    pointer-events: none;
    color-scheme: light;
  }
  [hidden] { display: none !important; }
  .surface { position: absolute; inset: 0; pointer-events: auto; cursor: crosshair; }
  .outline {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid #347fc9;
    border-radius: 6px;
    background: rgb(103 177 245 / 20%);
    box-shadow: 0 0 0 1px #f0f8ff;
  }
  .panel {
    position: absolute;
    inset: auto auto 20px 20px;
    box-sizing: border-box;
    width: max-content;
    max-width: min(390px, calc(100% - 40px));
    max-height: calc(100% - 40px);
    overflow: auto;
    padding: 15px 16px;
    border: 1px solid #d6e4f4;
    border-radius: 14px;
    background: #fff;
    color: #172e4b;
    box-shadow: 0 6px 28px rgb(22 55 96 / 23%);
    font: 14px/1.5 "Microsoft YaHei UI", "Segoe UI", sans-serif;
    overflow-wrap: anywhere;
  }
  .panel.confirming { pointer-events: auto; }
  .title { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-weight: 700; }
  .title::before {
    width: 7px;
    height: 7px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: #347fc9;
    content: "";
  }
  .status { margin: 0; color: #4e647f; }
  .selector {
    display: block;
    margin-top: 10px;
    padding: 7px 9px;
    border-radius: 7px;
    background: #eff6ff;
    color: #234e7b;
    font: 12px/1.45 ui-monospace, monospace;
  }
  .name-field { display: block; margin-top: 10px; font-size: 13px; font-weight: 600; }
  .name-field input {
    box-sizing: border-box;
    width: 100%;
    margin-top: 4px;
    padding: 7px 9px;
    border: 1px solid #d6e4f4;
    border-radius: 7px;
    color: #172e4b;
    font: inherit;
    font-weight: 400;
  }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  button {
    padding: 6px 10px;
    border: 1px solid #d6e4f4;
    border-radius: 8px;
    background: #fff;
    color: #172e4b;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover:enabled { background: #eff6ff; }
  button:focus-visible, input:focus-visible { outline: 2px solid #296fb1; outline-offset: 2px; }
  .save { margin-left: auto; border-color: #225f9d; background: #225f9d; color: #fff; }
  .save:hover:enabled { border-color: #194d82; background: #194d82; }
  button:disabled { opacity: .55; cursor: default; }
`;

export function createElementPicker(saveRule: PickerSave, resumeScan: () => void) {
  let session: PickerSession | undefined;
  let locale = resolveLocale("auto");
  let translations: ReturnType<typeof createI18n> | undefined;

  function start(hostname: string, editing?: RuntimeRule) {
    if (session?.host.isConnected) return;
    session?.controller.abort();
    const i18n = translations ??= createI18n(locale);
    const { t } = i18n;

    const host = document.createElement("selector-clicker-picker");
    const shadow = host.attachShadow({ mode: "closed" });
    const styles = new CSSStyleSheet();
    styles.replaceSync(PICKER_STYLES);
    shadow.adoptedStyleSheets = [styles];
    const controller = new AbortController();
    const { signal } = controller;

    function createNode<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, className: string) {
      const node = document.createElement(tag);
      node.className = className;
      return node;
    }

    const surface = createNode("div", "surface");
    const outline = createNode("div", "outline");
    const panel = createNode("section", "panel");
    const title = createNode("p", "title");
    const status = createNode("p", "status");
    status.setAttribute("role", "status");
    const preview = createNode("code", "selector");
    const nameField = createNode("label", "name-field");
    const nameCaption = document.createTextNode("");
    const nameInput = createNode("input", "");
    nameInput.type = "text";
    nameInput.maxLength = RULE_NAME_MAX_LENGTH;
    nameField.append(nameCaption, nameInput);
    const actions = createNode("div", "actions");
    const cancel = createNode("button", "");
    const retry = createNode("button", "");
    const save = createNode("button", "save");
    for (const button of [cancel, retry, save]) button.type = "button";
    actions.append(cancel, retry, save);
    panel.append(title, status, preview, nameField, actions);
    shadow.append(surface, outline, panel);

    let hovered: HTMLElement | null;
    let selected: PickerSelection | null;
    let saving = false;
    let titleKey: TranslationKey = editing ? "pickerRepickTitle" : "pickerPickTitle";
    let statusMessage: [TranslationKey, TOptions] = ["pickerInstructions", {}];

    function setTitle(key: TranslationKey) {
      titleKey = key;
      title.textContent = t(key);
    }

    function setStatus(key: TranslationKey, options: TOptions = {}) {
      statusMessage = [key, options];
      status.textContent = t(...statusMessage);
    }

    function localize() {
      host.lang = i18n.language;
      title.textContent = t(titleKey);
      status.textContent = t(...statusMessage);
      nameCaption.data = t("ruleNameOptional");
      nameInput.placeholder = t("pickerNamePlaceholder");
      cancel.textContent = t("cancel");
      retry.textContent = t("pickAgain");
      save.textContent = t("saveRule");
    }

    function updateOutline() {
      const target = selected?.target || hovered;
      outline.hidden = !target?.isConnected;
      if (!target?.isConnected) return;
      const { top, left, width, height } = target.getBoundingClientRect();
      Object.assign(outline.style, {
        top: `${top}px`,
        left: `${left}px`,
        width: `${width}px`,
        height: `${height}px`
      });
    }

    function resetSelection() {
      selected = null;
      hovered = null;
      preview.hidden = true;
      nameField.hidden = true;
      nameInput.value = editing?.name || "";
      actions.hidden = true;
      panel.classList.remove("confirming");
      setTitle(editing ? "pickerRepickTitle" : "pickerPickTitle");
      setStatus("pickerInstructions");
      updateOutline();
    }

    function finish(saved = false) {
      controller.abort();
      if (session?.host === host) {
        session = undefined;
        resumeScan();
      }
      if (!saved) {
        host.remove();
        return;
      }
      surface.remove();
      outline.remove();
      actions.hidden = true;
      preview.hidden = true;
      nameField.hidden = true;
      panel.classList.remove("confirming");
      setTitle("pickerSaved");
      setStatus("pickerSite", { hostname });
      window.setTimeout(() => host.remove(), 1800);
    }

    function targetAt(event: MouseEvent) {
      surface.style.pointerEvents = "none";
      try {
        return getPickerTarget(document.elementFromPoint(event.clientX, event.clientY));
      } finally {
        surface.style.pointerEvents = "";
      }
    }

    surface.addEventListener("pointermove", (event) => {
      if (selected) return;
      hovered = targetAt(event);
      updateOutline();
    }, { signal });

    surface.addEventListener("click", (event) => {
      event.preventDefault();
      if (selected) return;
      const target = targetAt(event);
      const selector = target && getPickerSelector(target);
      if (!target || !selector) {
        setStatus("pickerCannotLocate");
        return;
      }
      const count = document.querySelectorAll(selector).length;
      selected = { target, selector };
      preview.textContent = selector;
      preview.hidden = false;
      nameField.hidden = false;
      nameInput.value = editing?.name ||
        target.innerText.replace(/\s+/g, " ").trim().slice(0, RULE_NAME_MAX_LENGTH).trimEnd();
      actions.hidden = false;
      panel.classList.add("confirming");
      setTitle("pickerConfirm");
      setStatus("pickerMatch", { matches: count, hostname });
      updateOutline();
      nameInput.focus({ preventScroll: true });
    }, { signal });

    save.addEventListener("click", async () => {
      if (!selected || saving) return;
      const { target, selector } = selected;
      const matches = document.querySelectorAll(selector);
      if (matches.length !== 1 || matches[0] !== target) {
        setStatus("pickerTargetChanged", { matches: matches.length });
        save.disabled = true;
        return;
      }
      saving = true;
      nameInput.readOnly = true;
      for (const button of [cancel, retry, save]) button.disabled = true;
      setStatus("pickerSaving");
      try {
        const error = await saveRule(selector, nameInput.value, editing).catch(() => "pickerSaveError" as const);
        if (signal.aborted) return;
        if (error) {
          setStatus(error);
          for (const button of [cancel, retry, save]) button.disabled = false;
        } else {
          finish(true);
        }
      } finally {
        saving = false;
        nameInput.readOnly = false;
      }
    }, { signal });

    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        save.click();
      }
    }, { signal });
    retry.addEventListener("click", () => {
      save.disabled = false;
      resetSelection();
    }, { signal });
    cancel.addEventListener("click", () => finish(), { signal });
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || saving) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish();
    }, { capture: true, signal });
    for (const type of ["click", "pointerdown", "pointerup", "mousedown", "mouseup", "contextmenu", "keydown", "keyup"]) {
      shadow.addEventListener(type, (event) => event.stopPropagation(), { signal });
    }
    window.addEventListener("scroll", updateOutline, { capture: true, signal });
    window.addEventListener("resize", updateOutline, { signal });

    localize();
    resetSelection();
    document.documentElement.append(host);
    session = { host, controller, finish, localize };
  }

  return {
    start,
    stop: () => session?.finish(),
    setLocale(next: ExtensionLocale) {
      if (locale === next) return;
      locale = next;
      void translations?.changeLanguage(next, () => session?.localize());
    },
    get active() { return Boolean(session?.host.isConnected); }
  };
}
