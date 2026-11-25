<p align="center">
  <img src="icons/icon-128.png" width="80" height="80" alt="Selector Clicker 图标">
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

## 📦 安装

1. 下载或克隆本仓库。下载 ZIP 时先解压。
2. 在 Chrome 打开 `chrome://extensions`，或在 Edge 打开 `edge://extensions`。
3. 开启「开发者模式」，选择「加载已解压的扩展程序」（Load unpacked），然后选中包含 `manifest.json` 的目录。
4. 打开或刷新目标网页，再通过浏览器工具栏打开 **Selector Clicker**。

## 🖱️ 保存第一条规则

1. 在目标网页打开扩展弹窗，点击 **「在页面上选取元素」**。
2. 将鼠标移到目标按钮上，看到高亮后单击。按 `Esc` 可取消。
3. 核对匹配数量与网站，按需填写备注名称，再点击 **「保存规则」**。
4. 重新打开扩展弹窗，开启右上角的 **自动点击** 开关。

弹窗会显示当前网站的规则和本页点击次数。点击规则旁的「移除」可删除该条规则。冷却时间以毫秒为单位，`2000` 表示 2 秒。修改后点击「保存设置」即可应用。

## 管理站点规则

在弹窗点「管理规则」可查看所有网站的规则。支持按主机名、备注或 CSS 选择器搜索、编辑规则和移除规则。新增的备注随规则通过浏览器同步。

弹窗显示本页点击次数和本机累计次数，管理页还会显示每条规则的累计次数。统计从此版本开始，保存在当前浏览器的本地存储中。编辑规则时保留原计数，移除规则前已触发的点击仍计入本机累计次数。

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

测试仅依赖 Node.js 18 或更高版本。在项目目录运行以下任一命令。

```powershell
npm test
```

```powershell
node --test
```

测试覆盖按站点执行、匹配歧义、页面变化触发、点击冷却、规则移除和旧版全局规则停用。

## 🚀 Chrome 商店发布

在仓库的 **Actions → Chrome Web Store release → Run workflow** 手动运行。默认执行测试并生成 ZIP。在运行详情的 **Artifacts** 中下载 `selector-clicker.zip`，可以直接上传到商店。

首次上架时，将 ZIP 上传到 Chrome 商店开发者后台的新项目，填写商店资料和隐私信息并完成首版发布。后续发版前提升 `manifest.json` 的版本号，在运行工作流时从 `main` 勾选 **submit_for_review**。审核通过后，在商店后台手动发布。 [Chrome 开发者后台](https://chrome.google.com/webstore/devconsole) · [Chrome 商店 API](https://developer.chrome.com/docs/webstore/using-api)

启用提交审核前，在 Google Cloud 项目中启用 Chrome Web Store API，并在商店后台授权服务账号。然后在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 配置以下值。 [服务账号配置](https://developer.chrome.com/docs/webstore/service-accounts)

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Variable | `CWS_PUBLISHER_ID` | 商店后台 **Publisher → Settings** 中的发布者 ID |
| Variable | `CWS_ITEM_ID` | 商店项目 **Package** 页的 Item ID |
| Secret | `CWS_SERVICE_ACCOUNT_JSON` | Google Cloud 下载的服务账号 JSON 密钥内容 |

本地也可以用 Python 3 生成同样的上传包。

```powershell
python scripts/package-chrome.py selector-clicker.zip
```
