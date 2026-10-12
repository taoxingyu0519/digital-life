# AIRI 本地开发工作区

官方仓库：[moeru-ai/airi](https://github.com/moeru-ai/airi)。
源码位于 [airi](airi)。当前基准提交：`2e0e963`，包版本 `0.12.0-beta.5`。

## 使用

打开 [本地 AIRI](http://127.0.0.1:5173)，直接以“陌生人”进入，无需注册登录。
点击右上角“陌生人”进入模型服务设置。添加自己的 AI 服务来源后，选择对话模型。语音识别与语音合成分别配置。
聊天和角色设置可在本地使用；官方云端模型、额度和跨设备同步仍属于账号服务。

已删除 Discord、X/Twitter、Minecraft、Factorio 集成及机体入口。
豆包听说一体位于 [实时对话设置](http://127.0.0.1:5173/settings/modules/realtime-voice)，填写实时语音 Key 后返回舞台开始通话。
会沿用角色、陌生人身份、近期文字历史、静音及口型；使用范围和验证状态见 [实时语音说明](开发文档/06-realtime-voice.md)。

本地社交视觉位于 [视觉设置](http://127.0.0.1:5173/settings/modules/vision)。
先运行 `./scripts/vision.ps1 start`，再在页面开启摄像头和所需权限。
部署、认识的人、校准和验证边界见 [本地视觉指南](开发文档/07-local-vision.md)。

服务停止后，双击 [start-airi.cmd](start-airi.cmd) 启动 Web 开发环境。
打开 `http://127.0.0.1:5173`。保留命令窗口，按 Ctrl+C 停止。
此启动器也会启动本地项目管理和目录同步服务。

打开 [本地项目工作台](http://127.0.0.1:5174) 管理任务、记录变更和查看目录。
服务停止后双击 [manage-project.cmd](manage-project.cmd)；不需要账号或额外依赖。
使用方法见 [项目管理与目录同步](开发文档/05-project-management.md)。

本次安装启动的后台服务，可用以下命令停止：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File F:\codex\数字生命\scripts\stop-airi.ps1
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [系统架构与源码导航](开发文档/01-system-architecture.md) | 架构图、目录职责、对话时序、语音链路、数据边界 |
| [安装与验证记录](开发文档/02-installation.md) | 实际版本、命令、结果、日志、未配置项目 |
| [工作区包索引](开发文档/03-workspace-index.md) | 各子包的目录、名称、说明和脚本 |
| [二次开发指南](开发文档/04-development-guide.md) | 按需求定位源码、模型配置、开发命令和升级方法 |
| [项目管理与目录同步](开发文档/05-project-management.md) | 任务看板、变更记录、自动同步和恢复方法 |
| [豆包实时对话](开发文档/06-realtime-voice.md) | Key 配置、全双工链路、源码导航与功能边界 |
| [本地社交视觉](开发文档/07-local-vision.md) | 摄像头、本地模型、人员登记、视觉对话、权限与验收 |
| [当前源码改动](开发文档/current-changes.md) | 当前 Git 工作目录状态 |
| [三层源码目录树](开发文档/source-directory-tree.txt) | 排除 node_modules 的源码结构 |
| [依赖索引 JSON](开发文档/workspace-index.json) | 各包脚本、导出及内部依赖，可供程序读取 |
| [全部当前源码文件](开发文档/source-files.txt) | 包含未提交新文件，排除已删除文件和忽略文件 |

## 工作区布局

```text
数字生命/
├─ airi/            官方源码与 node_modules
├─ 开发文档/        本次生成的中文分析与索引
├─ 项目管理/        任务数据、看板、变更记录及备份
├─ scripts/         启动、停止、环境初始化和索引生成
├─ .tools/          本地 pnpm 11.24.0
├─ .runtime/        后台进程信息与运行日志
├─ install.log      依赖安装与共享包构建日志
├─ lint.log         仓库 lint 日志
├─ start-airi.cmd   Web 与管理工具启动入口
└─ manage-project.cmd  单独打开管理工具
```

API Key、大模型权重、语音服务和云端账号需要自行配置。
本次交付是源码开发环境。桌面发行版、完整账号后端和外部游戏服务没有自动启用。
