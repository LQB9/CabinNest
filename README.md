<p align="center"><img src="assets/icon.png" width="80" alt="CabinNest"></p>

# CabinNest

一个轻巧的 Windows 本地项目资料与待办管理工具。按「项目 → 需求 → 多份文件」整理资料，把说明书、技术文档、交接记录与待办放在一起。

[下载 Windows 便携版](https://github.com/LQB9/CabinNest/releases/latest) · [更新记录](CHANGELOG.md) · [使用说明](使用说明.txt)

![跨项目待办清单](docs/images/todos.png)

## 主要功能

- **按需求整理文件**：同一需求可关联多份 Word、Excel、PDF、图片及技术笔记，支持从资源管理器直接拖入。
- **统一待办**：待办与项目同级，打开即可查看跨项目的未完成事项，每条待办可直接选择所属项目。
- **轻量总览**：查看项目、未完成、已完成及逾期事项数量，点击进入对应列表。
- **三种使用方式**：独立窗口、侧边面板、托盘弹窗，均支持最小化与收起。
- **自动贴边入口**：收起为 CN 标签，拖动松手后向最近的左右边缘平滑吸附，记住高度与位置，点击恢复原使用方式。
- **文档与版本**：应用内笔记自动保存，支持历史快照、DOCX 预览与外部编辑后收回；Excel、PPT 等通过默认软件打开。
- **文件与项目导出**：文件行右键导出单份文件，笔记可导出为 Word；项目右键可导出完整项目归档并重新导入。
- **本地备份**：业务记录、附件及历史版本保存在本机，支持完整备份和恢复。

![按需求管理资料](docs/images/requirements.png)

截图使用虚构示例项目，下载包首次启动为空资料库。

## 下载与使用

1. 在 [Releases](https://github.com/LQB9/CabinNest/releases/latest) 下载 `CabinNest-v1.10.0-windows-x64.zip`。
2. 解压到有写入权限的位置，双击 `CabinNest.exe`。保留同目录的全部程序文件。
3. 新建项目和需求，将文件拖到需求卡片中；在「待办」中记录事项并选择所属项目。

便携包不包含演示数据或个人资料，首次启动会创建空资料库。

### 文件与备份

业务数据位于程序旁的 `data` 文件夹，包括 SQLite 数据库、附件、历史版本和外部编辑副本。迁移时复制整个应用文件夹；更新前先在「备份与设置」创建完整备份，更新时保留原 `data` 文件夹。

导入文件会复制一份到资料库，原文件保持不变。外部编辑后，需要先保存并在应用内「收回编辑」，再导出最新版本。

右键左侧项目可导出项目归档。归档可以保存到 Google 云端硬盘客户端的同步目录，也可以手动上传；应用目前不直接连接云盘账号，归档为导出时点的快照。

### 常用操作

| 操作 | 入口 |
| --- | --- |
| 全局搜索 | `Ctrl K` 或「全部资料」 |
| 新建资料 / 导入资料 | `Ctrl N` / `Ctrl O` |
| 保存正文 | `Ctrl S` |
| 导出单份文件 | 文件行右键或行尾 `⋯` |
| 导出项目归档 | 左侧项目右键 |
| 切换窗口方式 / 完全退出 | 右上角窗口菜单，或托盘菜单 |

DOCX 预览适合常见文字、图片和表格；复杂排版、宏及嵌入对象需在原软件中查看。扫描 PDF 暂不提供 OCR。当前版本面向 Windows x64。

## 开发与构建

技术栈：Electron、React、Tiptap、SQLite。开发环境需要 Node.js 24 或以上与 pnpm；使用发布包无需另装 Node.js 或服务端。

```powershell
git clone https://github.com/LQB9/CabinNest.git
cd CabinNest
pnpm install --frozen-lockfile
node node_modules/electron/install.js
pnpm build
pnpm test
pnpm start
```

生成 Windows 便携程序：

```powershell
pnpm package
```

输出目录为 `release/CabinNest-win32-x64`。先执行 `pnpm build` 再打包。

后端测试覆盖文档、需求归属、项目归档、备份恢复与贴边位置。桌面流程测试位于 `tests/`，需要另装 Playwright；可设置 `PROJECTDESK_PLAYWRIGHT_MODULE` 指向已有模块目录。

`PROJECTDESK_DATA_DIR` 可指定独立测试资料库，`PROJECTDESK_TEST=1` 用于界面自动化。保留 `PROJECTDESK_*` 环境变量和旧版数据库标识，以兼容已有数据；正式使用无需设置这些变量。

## 许可

本项目目前标记为 `UNLICENSED`，尚未授予开源使用许可。第三方组件遵循各自许可，详见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) 及发布包中的 Electron / Chromium 许可文件。
