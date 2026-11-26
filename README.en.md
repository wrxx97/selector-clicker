<p align="center">
  <img src="docs/assets/icon.svg" width="80" height="80" alt="Selector Clicker icon">
</p>

<h1 align="center">Selector Clicker</h1>

<p align="center">Pick elements on web pages and automate repetitive clicks in Chrome and Microsoft Edge, such as dismissing popups and overlays.</p>

<p align="center">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://wrxx97.github.io/selector-clicker/">Extension overview (Chinese)</a> ·
  <a href="https://wrxx97.github.io/selector-clicker/privacy/">Privacy policy (Chinese)</a>
</p>

## Interface language

In Rule Manager, open **Language** and choose **Follow browser**, **简体中文** (Simplified Chinese), or **English**. The setting syncs through your browser account and applies immediately to the popup, Rule Manager, and on-page picker.

## Features

| Feature | What it does |
| --- | --- |
| 🎯 **Pick elements on the page** | Hover to highlight an element, then click to generate a rule. Review the match count and site before saving. |
| 🌐 **Site-specific rules** | Rules are tied to the current hostname. The extension clicks only when the selector matches exactly one visible, enabled element. |
| ⚡ **Scan when the page changes** | The extension scans when enabled and when page elements or their attributes change. To scan manually, choose **Scan now** in the popup. |
| ⏱️ **Adjustable click cooldown** | The default minimum interval between clicks on the same element is 8 seconds. You can set it to 1–300 seconds. |
| 🔍 **Test rules and pick new targets** | Check a rule's match status and highlight its target. If the page layout changes, you can pick a new target and keep the rule's name and statistics. |
| ⏸️ **Pause rules and limit clicks** | Pause or resume individual rules or all rules for a site. Set a path scope and a click limit per page load. |
| 📂 **Back up rules** | Export rules as JSON and preview imports. Duplicate entries leave existing rules in place. |
| 🔐 **Site-by-site access** | Grant access in the popup to let the extension run on the current site. |

## 📦 Installation

Requires Chrome or Microsoft Edge 111 or later.

1. Download and extract `selector-clicker-<version>.zip` from [GitHub Releases](https://github.com/wrxx97/selector-clicker/releases). To install from source, build the extension using the steps in [Development and testing](#-development-and-testing).
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
4. Open or refresh the target page, then open **Selector Clicker** from the browser toolbar.

## 🖱️ Save your first rule

1. Open the popup on the target page. Choose **Allow access and pick** and confirm the browser's permission prompt. On an authorized site, choose **Pick an element on the page**.
2. Hover over the target until it is highlighted, then click it. Press `Esc` to cancel.
3. Review the match count and site. Edit the suggested name if needed, then select **Save rule**.
4. Reopen the popup and turn on **Auto-click** in the upper-right corner.

The popup shows rules for the current site and the click count for the current page. Use each rule's actions to test it, pick a new target, pause it, or remove it. **Pause site** pauses every existing rule for that site. You can resume rules individually.

After upgrading from an earlier version, open the target site and choose **Allow access to this site** to resume using its rules. The browser manages site access and grants permissions separately for HTTP and HTTPS.

## Manage site rules

Open **Settings** in the lower-right corner of the popup to view rules for all sites. Choose Sky blue, Lavender, Peach pink, Warm orange, or Night to update the theme in the popup and Rule Manager.

Set **Cooldown per element** in milliseconds. For example, `2000` equals two seconds. The adjustment buttons change the value by one second, and changes apply automatically.

Search by hostname, rule name, or CSS selector. You can edit individual rules, move all rules to another hostname, or delete all rules for a site. Rule names sync alongside the rules.

When editing a rule, you can limit it to a path such as `/dashboard` and its subpaths. The click limit applies to each page load. Leave the limit blank or enter `0` to allow unlimited clicks.

Use **Export file** to save a JSON backup or **Copy rule JSON** to copy the same backup to the clipboard. Use **Import file** or **Paste JSON** to preview new and duplicate rules before importing. Importing preserves existing rules and statistics. You can grant each imported site access from its own page.

The popup shows the click count for the current page and the total for this device. Rule Manager also shows each rule's click count and last click time. The current browser stores these statistics. Edits preserve the rule's statistics, and clicks recorded before a rule is removed continue to count toward the device total. JSON backups contain rules and their settings.

## 🔎 Frequently asked questions

### What if the popup cannot connect to the page or start the picker?

Reload Selector Clicker from the browser's extension management page, then refresh the target page. Browser settings, extension stores, and built-in PDF viewers are protected pages that restrict the extension.

### Why does a saved rule do nothing?

Turn on **Auto-click**, wait for the target to appear, and choose **Scan now**. Each rule requires exactly one match. If the site changed its layout, you can remove the old rule and pick the target again.

### Why does a newly visible button sometimes need a manual scan?

Visibility changes caused only by CSS animation may leave the page's DOM unchanged. Once the button is fully visible, choose **Scan now**. After a cooldown expires, the next scan checks the rule again.

### Which parts of a web page can I pick?

The picker supports the main document of HTTP and HTTPS pages. Elements inside iframes or shadow roots are outside its scope. Each hostname has its own rules, so `example.com` and `www.example.com` are managed separately.

## 🧪 Development and testing

The popup and Rule Manager use React, Vite, shadcn/ui, Tailwind CSS v4, and Zustand. The runtime scripts, UI, build tools, and tests use TypeScript. Node.js 22.12 or a later LTS release is recommended. The pnpm version is listed in `package.json`.

Run these commands from the project root.

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run i18n:check
pnpm test
pnpm run build
```

The extension uses i18next and react-i18next, with translations in `src/i18n/locales/`. The `pnpm run i18n:check` command checks for missing translations and mismatched placeholders. The release workflow runs the same check.

After building, load `dist/` from the browser's extension management page. Run `pnpm dev` to rebuild as you edit, then reload the extension in the browser.

- `src/extension/` contains the background worker, page scripts, element picker, and shared rule logic.
- `src/popup/` and `src/rules/` contain the popup and Rule Manager.
- `src/build/` contains the build and packaging tools.
- `tests/` covers site-specific execution, ambiguous selectors, page changes, cooldowns, and rule management.

## 📦 Automated builds and releases

The **Build extension ZIP** workflow runs on pushes that change `manifest.json`. It compares the version at the previous and new branch tips. When the version changes, it checks translations, runs tests, and packages the new version, including when a push contains several commits.

Download `selector-clicker-<version>.zip` from the run's **Artifacts** section. You can also choose **Run workflow** to package the current version. [GitHub Actions](https://github.com/wrxx97/selector-clicker/actions/workflows/chrome-web-store.yml)

When a new version is pushed to `main` and the build passes, the workflow creates a `v<version>` tag and a GitHub Release with the same ZIP and the matching changelog entry. Builds on other branches and manual runs provide the ZIP as an Actions artifact. [GitHub Releases](https://github.com/wrxx97/selector-clicker/releases) · [Changelog](CHANGELOG.md)

After building locally, package `dist/` as a ZIP with the following command.

```powershell
pnpm run package selector-clicker-1.5.0.zip
```

## License

Selector Clicker is licensed under Apache-2.0. The release ZIP includes the project license, NOTICE, and the generated third-party license notices. [Apache License 2.0](LICENSE) · [NOTICE](NOTICE)
