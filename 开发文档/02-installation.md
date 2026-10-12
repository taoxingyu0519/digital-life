# 安装与验证记录

安装日期：2026-09-29。平台：Windows x64。
工作区：`F:\codex\数字生命`。

## 1. 来源与版本

| 项目 | 实际值 |
| --- | --- |
| 官方仓库 | https://github.com/moeru-ai/airi |
| 本地源码 | `F:\codex\数字生命\airi` |
| 分支 | `main`，跟踪 `origin/main` |
| 提交 | `2e0e963670e5435a2909149fff1f83b93f8ffd11` |
| 提交说明 | `fix(stage-ui): keep provider errors compact (#2695)` |
| 根包版本 | `0.12.0-beta.5` |
| Git | `2.53.0.windows.3` |
| 实际运行 Node.js | `24.19.0`，使用本机已有运行时 |
| 实际 pnpm | `11.24.0`，与 packageManager 一致，存于工作区 `.tools` |
| Web 开发服务 | Vite `8.2.2` |
| pnpm 内容存储 | 安装日志记录为 `F:\.pnpm-store\v11` |
| 依赖目录 | `airi\node_modules` 与各子包链接 |

上游 `.tool-versions` 标注 Node.js `26.7.0`，贡献指南要求 Node.js 23+。
本次使用已有 24.19.0，依赖安装、共享包构建和 Web 启动均成功。
这不代表所有桌面、移动端或服务端脚本均已在 Node.js 24 上验证。

源码通过 Git 下载，保留官方远端与提交信息。
当前仓库为浅层、按需下载对象的克隆，未下载完整历史。
最初 Git TLS 下载异常，重试后成功。备用归档与失败临时包已清理。

## 2. 已完成的安装

- 安装全仓库 74 个工作区的依赖，新增依赖包 2,701 个。
- 使用冻结锁文件安装，没有改写上游依赖版本。
- 执行根 postinstall，共 34 个构建任务成功。
- 执行桌面端 `electron-builder install-app-deps`，原生依赖安装成功。
- 首次 Web 启动下载 Cubism SDK、Hiyori 模型和两个 VRM 示例。
- 生成中文架构说明、开发指南、73 个子包索引及 5,645 个跟踪文件清单。
- 保留官方源码干净状态。安装脚本产生的格式改动已还原。

日志：[install.log](../install.log)。安装命令：

```powershell
cd F:\codex\数字生命
. .\scripts\airi-env.ps1
cd airi
pnpm install --frozen-lockfile --reporter append-only
```

脚本将正确的 Node、pnpm 和 Git 路径加入当前进程环境。
它不修改系统 PATH，也不修改全局 PowerShell 执行策略。

## 3. 实际验证结果

| 验证 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --reporter append-only` | 退出码 0，耗时约 3 分 56 秒 |
| postinstall 的 `pnpm run build:packages` | 34 / 34 构建任务成功 |
| `pnpm lint` | 退出码 0。ESLint 汇总 0 错误、651 警告，另有前置 lint 警告 |
| Web 开发服务 | Vite 启动成功，仅监听 `127.0.0.1:5173` |
| HTTP 访问 `/` | 状态码 200，包含 AIRI 页面标题 |
| 浏览器实际访问 | 中文欢迎页和“配置您自己的 AI 服务来源”按钮正常显示 |
| 浏览器控制台 | 验证时未发现 error 日志，有上游翻译与无障碍提示警告 |
| 启动、停止、环境脚本 | PowerShell 语法检查通过，0 个解析错误 |
| 文档索引脚本 | 成功生成 73 个子包和 5,645 个跟踪文件清单 |
| Git 工作目录 | 清洁 |

本次没有修改业务代码，因此没有执行全量类型检查、完整单元测试或生产 Web 打包。
共享包构建成功不能代替这些检查。开发时按修改范围执行对应命令。

构建日志中的“no output files”提示涉及不输出产物的任务。
运行日志还包含 DuckDB 依赖 sourcemap 路径警告，不影响已验证的欢迎页加载。

验证截图：

![AIRI 本地中文配置引导](../.runtime/airi-welcome.png)

## 4. 启动、停止和日志

本次已启动后台开发服务：<http://127.0.0.1:5173>。
进程记录：[web-process.json](../.runtime/web-process.json)。
运行日志：[web.log](../.runtime/web.log)、[web-error.log](../.runtime/web-error.log)。

停止本次后台服务：

```powershell
cd F:\codex\数字生命
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-airi.ps1
```

停止脚本核对进程创建时间，防止误杀复用同一 PID 的进程。
它只停止本次记录的后台服务及其子进程。

下次启动时，双击 `start-airi.cmd`，或运行：

```powershell
cd F:\codex\数字生命
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-airi.ps1
```

该脚本在前台运行。按 Ctrl+C 停止。
同一端口只运行一个实例。出现端口占用时，先检查已有 AIRI 服务。
启动命令固定端口，并用 `--strictPort` 避免悄悄切换地址。
本次未创建开机自启任务。

## 5. 尚未配置或验证

| 功能 | 当前状态 |
| --- | --- |
| 远程 LLM | 未填入个人 API Key，未进行付费调用 |
| Ollama / LM Studio | 未安装推理服务，未下载大模型权重 |
| ASR / TTS | 已安装相关代码依赖，未配置实际服务、声音和麦克风 |
| 角色渲染 | 示例资源已下载；免登录改造后已在本机浏览器看到 Live2D 舞台，未做跨设备渲染兼容性测试 |
| 桌面应用 | 源码及安装后原生依赖已准备，未下载运行 Electron 应用或安装 Windows 发行版 |
| 移动端 | 未安装 Android / iOS 工具链 |
| WebSocket 通道 | 代码可用，默认端口 6121，本次未启动 |
| API / Auth 后端 | 未启动 Docker Compose、PostgreSQL 或 Redis |
| Minecraft / Discord / Telegram | 未配置服务凭据或连接外部账户 |

配置模型服务后，才能验证完整对话链路。入口说明见 [二次开发指南](04-development-guide.md)。

## 6. 常见问题

**提示 pnpm 版本不正确**：先执行 `. .\scripts\airi-env.ps1`。本机原有 pnpm 是 11.19.0。

**页面能打开，但没有回复**：先配置 AI 服务，再在对话模型设置中选择模型。

**显示 `Failed to fetch`**：核对服务地址、协议、CORS 和模型服务状态。浏览器控制台可显示更具体原因。

**语音不可用**：先验证文字对话。再检查 ASR、TTS、设备权限与音频输出。

**切换地址后配置消失**：浏览器按来源隔离数据。本部署统一使用 `127.0.0.1:5173`。

**提示 Git 找不到 HTTPS helper**：使用本工作区环境脚本，它补齐本机捆绑 Git 的组件路径。

**准备开发桌面端**：运行 `start-airi.ps1 -Mode desktop`。首次运行会下载 Electron。
若原生依赖需要源码编译，再按官方贡献指南准备 Visual Studio C++ Build Tools。

## 7. 免登录与管理工具补充验证

2026-09-29 完成 Web 默认访客进入、共享欢迎页免登录、陌生人上下文及本地项目工作台。
本地管理服务监听 `127.0.0.1:5174`，用 Node 内置模块运行，无新增 npm 依赖。
Playwright 测试浏览器安装在工作区 `.tools/playwright`；测试时需设置 `PLAYWRIGHT_BROWSERS_PATH` 为该绝对路径。

| 检查 | 结果 |
| --- | --- |
| 根目录 `pnpm typecheck` | 53 项任务通过 |
| 根目录 `pnpm lint` | 最终重跑正常退出，0 errors、651 条仓库原有 warnings |
| stage-ui 访客相关浏览器测试 | 3 个文件、8 项通过 |
| i18n 测试 | 20 项通过 |
| stage-layouts 测试 | 5 个文件、44 项通过 |
| Web 手工浏览器验收 | 直接进入 Live2D 舞台，显示陌生人；点击可进入服务来源配置 |
| Web unit 测试项目 | 仓库当前没有匹配的 unit 测试文件，未计为通过 |
| 管理工具 | 页面新增/编辑任务，重启后数据保留；版本冲突和无来源凭据写入被拒绝 |
| 目录自动更新 | 实测新增、重复编辑、重命名、删除，索引正确更新 |

第一次浏览器测试发现尚未构建的访客文案，重新构建 i18n 后通过。
一次 lint 原生进程异常退出；单独重跑通过。日志保存在 `.runtime/guest-*.log`。
真实模型文字和语音调用尚未验证，因为没有配置模型服务。具体使用与后续维护见 [项目管理说明](05-project-management.md)。

## 8. 集成精简与豆包实时对话验证

2026-09-29 删除 Discord、X/Twitter、Minecraft、Factorio 功能与前端模块，新增 `@proj-airi/realtime-voice`。
工作区当前为 72 个（含根包）；安装成功，新包已构建，Web 仍使用 `127.0.0.1:5173`。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --no-frozen-lockfile` | 成功；保留仓库原有 canvas 构建许可，移除旧集成直接依赖及 Mineflayer 补丁 |
| `pnpm -F @proj-airi/realtime-voice build` | 成功，生成 Vite Node 网关入口 |
| `pnpm typecheck` | 54 项任务通过 |
| `pnpm lint` | 0 errors、605 warnings，正常退出 |
| `pnpm -F @proj-airi/realtime-voice test:run` | 3 个文件、13 项通过，含双向 WebSocket、打断与私有文件访问隔离 |
| stage-ui 相关 Vitest | 4 个文件、37 项通过，含真实 AudioWorklet、转写同步、聊天契约与模块重置 |
| 浏览器手工验收 | 机体列表无四个旧入口；实时对话配置页显示 Key、模型、音色与资源；未配置时禁止开始通话 |

stage-ui 命令：

```powershell
pnpm -F @proj-airi/stage-ui exec vitest run src/stores/modules/realtime-audio.browser.test.ts src/stores/chat/voice-transcript.browser.test.ts src/stores/chat.contract.test.ts src/composables/use-data-maintenance.browser.test.ts
```

文件隔离测试发现 `configResolved` 修改 deny 列表太晚，已改为 `config` 阶段注册，并验证普通、raw、import 读取均被拒绝。
原有 `session-store.browser.test.ts` 的模块模拟在当前环境未生效，涉及云同步的旧测试未通过；未更改其断言来掩盖问题。
新增转写测试独立使用真实 store 与同步插件。临时排查版本备份在 `.runtime/session-store.browser.test.before-separation.ts`。
本次未运行全量测试或桌面发行构建。没有实际 Key，未发起真实付费语音通话。
用法、数据边界和真实通话验收步骤见 [06-realtime-voice.md](06-realtime-voice.md)。日志在 `.runtime/realtime-*.log`。
