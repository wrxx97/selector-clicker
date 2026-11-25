<p align="center">
  <img src="docs/assets/icon.svg" width="80" height="80" alt="Selector Clicker 图标">
</p>

<h1 align="center">Selector Clicker</h1>

<p align="center">在 Chrome 和 Microsoft Edge 上点选网页元素，自动处理反复关闭弹窗、遮罩等点击操作。</p>

<p align="center">
  <a href="https://wrxx97.github.io/selector-clicker/">插件介绍</a> ·
  <a href="https://wrxx97.github.io/selector-clicker/privacy/">隐私声明</a>
</p>

## 主要特性

| 特性 | 说明 |
| --- | --- |
| 🎯 **在网页上点选** | 鼠标悬停可预览高亮，单击后自动生成规则。保存前可以查看匹配数量和生效网站。 |
| 🌐 **规则按网站生效** | 规则绑定当前主机名。只有页面上恰好有一个匹配元素，而且它可见、可用时，扩展才会点击。 |
| ⚡ **页面变化时扫描** | 启用时先扫一次。之后，节点增删和属性变化会触发扫描，也可以在弹窗里点击「立即扫描」。 |
| ⏱️ **可调点击冷却** | 同一元素默认至少间隔 8 秒才能再次被点。可将冷却设为 1 至 300 秒。 |
| 🔍 **规则测试与重新选取** | 测试匹配状态并高亮目标。网页改版后可重新选取并保留原备注和统计。 |
| ⏸️ **暂停和执行条件** | 单独或批量暂停和恢复规则，为规则设置生效路径和每页点击上限。 |
| 📂 **规则备份** | 导出 JSON 并预览导入内容，重复条目保留现有规则。 |
| 🔐 **逐站授权** | 在弹窗为当前网站授予访问权限后，扩展才会在该网站运行。 |

## 📦 安装

需要 Chrome 或 Microsoft Edge 111 及以上版本。

1. 从 [GitHub Releases](https://github.com/wrxx97/selector-clicker/releases) 下载 `selector-clicker-<版本>.zip` 并解压。如果使用源码，请先按下方步骤构建。
2. 在 Chrome 打开 `chrome://extensions`，或在 Edge 打开 `edge://extensions`。
3. 开启「开发者模式」，选择「加载已解压的扩展程序」（Load unpacked），然后选中包含 `manifest.json` 的目录。
4. 打开或刷新目标网页，再通过浏览器工具栏打开 **Selector Clicker**。

## 🖱️ 保存第一条规则

1. 在目标网页打开扩展弹窗，首次使用时点击 **「授权并选取元素」**，确认浏览器的站点授权。授权后可使用 **「在页面上选取元素」**。
2. 将鼠标移到目标按钮上，看到高亮后单击。按 `Esc` 可取消。
3. 核对匹配数量与网站，按需填写备注名称，再点击 **「保存规则」**。
4. 重新打开扩展弹窗，开启右上角的 **自动点击** 开关。

弹窗会显示当前网站的规则和本页点击次数。可在规则旁测试、重新选取、暂停或移除规则。「暂停当前站点」会暂停该网站已有的全部规则，也可逐条恢复。

从旧版升级时，打开目标网站并点击 **「授权当前站点」** 即可恢复已有规则。HTTP 和 HTTPS 分别授权，站点权限由当前浏览器管理。

## 管理站点规则

点击弹窗右下角的设置图标可查看所有网站的规则。管理页可以选择浅蓝、梦幻紫、蜜桃粉、暖橙或夜间主题，主题同步应用到弹窗和管理页。管理页也可以调整同一元素的冷却时间，以毫秒为单位，`2000` 表示 2 秒。加减按钮每次调整 1 秒，修改后自动生效。支持按主机名、备注或 CSS 选择器搜索，也可以编辑规则、迁移站点主机名或删除某个站点的全部规则。新增的备注随规则通过浏览器同步。

编辑规则时，可填写生效路径。例如 `/dashboard` 匹配该路径及其子路径。每页点击上限从页面加载时开始计数，留空或填 `0` 表示不限次数。

在管理页点击「导出文件」保存 JSON 备份，或点击「复制规则 JSON」将同一份内容复制到剪贴板。通过「导入文件」或「粘贴 JSON」可以预览新规则和重复规则，再确认导入。导入保留现有规则和统计，站点权限可在对应页面单独授予。

弹窗显示本页点击次数和本机累计次数。管理页还显示每条规则的累计次数和上次点击时间。统计保存在当前浏览器，编辑规则后仍保留，移除规则前已触发的点击仍计入本机累计次数。上次点击时间从新版启用后开始记录，导出的规则 JSON 只包含规则和执行条件。

## 🔎 常见问题

### 弹窗提示「无法连接当前网页」或「无法进入选取模式」？

先在扩展管理页重新加载 Selector Clicker，再刷新目标网页。浏览器设置页、扩展商店和内置 PDF 查看器等受保护页面无法运行扩展。

### 规则已保存，页面却没有反应？

确认自动点击已开启，目标已经出现，然后点「立即扫描」。扩展会跳过匹配多个元素的规则。网站更新布局后，可以移除旧规则并重新点选。

### 网页上的按钮出现了，为什么没有触发扫描？

纯 CSS 动画造成的可见性变化可能不触发扫描。等元素完全显示后，可用「立即扫描」检查。冷却时间到期后，扩展会等到下一次扫描时再检查。

### 点选支持哪些网页区域？

支持普通 HTTP 和 HTTPS 网页的主文档。iframe 和 Shadow DOM 内部的元素无法直接点选。主机名彼此独立，例如 `example.com` 与 `www.example.com` 各自保存规则。

## 🧪 开发与测试

弹窗和规则管理页使用 React、Vite、shadcn/ui、Tailwind CSS v4 和 Zustand。弹窗、扩展接口及共享 UI 组件支持 TypeScript。建议使用 Node.js 22.12 或更高的 LTS 版本，pnpm 版本记录在 `package.json`。在项目目录运行以下命令。

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
```

构建后，从浏览器扩展管理页加载 `dist/`。使用 `pnpm dev` 可在编辑时自动重建，重建完成后可在浏览器里重新加载扩展。

测试覆盖按站点执行、匹配歧义、页面变化触发、点击冷却、规则移除和旧版全局规则停用。

## 📦 自动构建与发布

推送到 GitHub 分支时，如果 `manifest.json` 的 `version` 发生变化，**Build extension ZIP** 会运行测试并打包。同一次推送包含多笔提交时，按推送前后的版本比较，并打包推送后的版本。只改其他文件时不会触发工作流，只改 `manifest.json` 的其他字段时会跳过打包。

在 [GitHub Actions](https://github.com/wrxx97/selector-clicker/actions/workflows/chrome-web-store.yml) 的运行详情中，从 **Artifacts** 下载 `selector-clicker-<版本>.zip`。也可以点击 **Run workflow** 为当前版本手动打包。

将新版本推送到 `main` 后，测试和打包通过时会创建对应的 `v<版本>` 标签和 [GitHub Release](https://github.com/wrxx97/selector-clicker/releases)，并附上同一个 ZIP 和 [更新日志](CHANGELOG.md) 中对应版本的内容。其他分支和手动运行提供 Actions 构建产物。

本地构建后，可使用 Python 3.10 或更新版本将 `dist/` 打成 ZIP。

```powershell
python scripts/package-chrome.py selector-clicker-1.4.0.zip
```
