const PICKER_CONTROL = 'button, a[href], input, select, textarea, summary, label, [role="button"], [role="link"], [onclick]';
const PICKER_ATTRIBUTES = ["data-testid", "data-test", "data-qa", "aria-label", "name", "title"];

function getPickerTarget(hit) {
  const element = hit?.closest(PICKER_CONTROL) || hit;
  return element instanceof HTMLElement &&
    !element.matches("html, body, iframe, frame") &&
    typeof element.click === "function" ? element : null;
}

function getPickerSelector(target) {
  let relativePath = "";
  for (let element = target; element; element = element.parentElement) {
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

const PICKER_STYLES = `
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
    border: 2px solid #2b9a58;
    border-radius: 5px;
    background: rgb(54 188 109 / 14%);
    box-shadow: 0 0 0 1px #fff;
  }
  .panel {
    position: absolute;
    inset: auto auto 16px 16px;
    box-sizing: border-box;
    width: max-content;
    max-width: min(380px, calc(100% - 32px));
    padding: 14px 16px;
    border: 1px solid #becdc1;
    border-radius: 10px;
    background: #f5f7f4;
    color: #1c2820;
    box-shadow: 0 4px 20px rgb(28 40 32 / 25%);
    font: 14px/1.5 "Microsoft YaHei UI", "Segoe UI", sans-serif;
    overflow-wrap: anywhere;
  }
  .panel.confirming { pointer-events: auto; }
  .title { margin: 0 0 4px; font-weight: 650; }
  .status { margin: 0; }
  .selector {
    display: block;
    margin-top: 8px;
    padding: 6px 8px;
    border-radius: 5px;
    background: #e6ede6;
    font: 12px/1.45 ui-monospace, monospace;
  }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  button {
    padding: 6px 9px;
    border: 1px solid #b8c2ba;
    border-radius: 5px;
    background: #fff;
    color: #344039;
    font: inherit;
    cursor: pointer;
  }
  .save { border-color: #287142; background: #287142; color: #fff; }
  button:disabled { opacity: .55; cursor: default; }
`;

function createElementPicker(saveRule, resumeScan) {
  let session;

  function start(hostname) {
    if (session?.host.isConnected) return;
    session?.controller.abort();

    const host = document.createElement("selector-clicker-picker");
    const shadow = host.attachShadow({ mode: "closed" });
    const styles = new CSSStyleSheet();
    styles.replaceSync(PICKER_STYLES);
    shadow.adoptedStyleSheets = [styles];
    const controller = new AbortController();
    const { signal } = controller;

    function createNode(tag, className, text) {
      const node = document.createElement(tag);
      node.className = className;
      if (text) node.textContent = text;
      return node;
    }

    const surface = createNode("div", "surface");
    const outline = createNode("div", "outline");
    const panel = createNode("section", "panel");
    const title = createNode("p", "title", "选取要自动点击的元素");
    const status = createNode("p", "status");
    status.setAttribute("role", "status");
    const preview = createNode("code", "selector");
    const actions = createNode("div", "actions");
    const cancel = createNode("button", "", "取消");
    const retry = createNode("button", "", "重新选取");
    const save = createNode("button", "save", "保存规则");
    for (const button of [cancel, retry, save]) button.type = "button";
    actions.append(cancel, retry, save);
    panel.append(title, status, preview, actions);
    shadow.append(surface, outline, panel);

    let hovered;
    let selected;
    let saving = false;

    function updateOutline() {
      const target = selected?.target || hovered;
      outline.hidden = !target?.isConnected;
      if (outline.hidden) return;
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
      actions.hidden = true;
      panel.classList.remove("confirming");
      status.textContent = "移动鼠标高亮元素，单击选取。按 Esc 取消。";
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
      panel.classList.remove("confirming");
      title.textContent = "规则已保存";
      status.textContent = `适用网站：${hostname}`;
      window.setTimeout(() => host.remove(), 1800);
    }

    function targetAt(event) {
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
      if (!selector) {
        status.textContent = "无法定位这个元素，请选取网页主框架中的按钮或链接。";
        return;
      }
      const count = document.querySelectorAll(selector).length;
      selected = { target, selector };
      preview.textContent = selector;
      preview.hidden = false;
      actions.hidden = false;
      panel.classList.add("confirming");
      status.textContent = `当前页面匹配 ${count} 个元素。仅在 ${hostname} 生效。`;
      updateOutline();
      save.focus({ preventScroll: true });
    }, { signal });

    save.addEventListener("click", async () => {
      if (!selected || saving) return;
      const { target, selector } = selected;
      const matches = document.querySelectorAll(selector);
      if (matches.length !== 1 || matches[0] !== target) {
        status.textContent = `当前页面匹配 ${matches.length} 个元素。页面已变化，请重新选取。`;
        save.disabled = true;
        return;
      }
      saving = true;
      for (const button of [cancel, retry, save]) button.disabled = true;
      status.textContent = "正在保存规则…";
      try {
        await saveRule(selector);
        finish(true);
      } catch {
        status.textContent = "保存失败，请重试。";
        for (const button of [cancel, retry, save]) button.disabled = false;
      } finally {
        saving = false;
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
    for (const type of ["click", "pointerdown", "pointerup", "mousedown", "mouseup", "contextmenu"]) {
      shadow.addEventListener(type, (event) => event.stopPropagation(), { signal });
    }
    window.addEventListener("scroll", updateOutline, { capture: true, signal });
    window.addEventListener("resize", updateOutline, { signal });

    resetSelection();
    document.documentElement.append(host);
    session = { host, controller };
  }

  return { start, get active() { return Boolean(session?.host.isConnected); } };
}
