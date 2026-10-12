# 姓名确认、记忆与数据库管理交付报告

日期：2026-10-05。任务：AIRI-025。范围：本机 Web、Python 视觉服务和共享设置页。

## 采用的方案

姓名确认习惯适合做行为记忆。它是持续的交往规则，不需要新增独立智能体插件。
确认状态、人物归属、数据库事务和权限检查必须由代码执行，模型记忆不能保证这些约束。
本轮复用已有 SQLite、DPAPI、普通聊天投影、实时语音更新和浏览器会话仓库。

## 已实现的能力

- 姓名先作为候选，角色复述完整拼写并请本人确认。确认前不采集登记模板、不保存候选姓名。
- 支持完整姓名纠正与明确字词替换，例如“把明改成铭”。不确定时请求完整书面姓名，再确认。
- 确认后的改名更新原人物 ID，保留原照片、识别模板、相遇与角色交流记忆。
- 旧档案补问一次本人确认。多人、换轨迹、过期和拒绝记忆撤销当前候选。
- `/settings/memory` 和长期记忆页管理行为规则、人物姓名和最多八十条角色交流记忆。
- 短期记忆页显示当前浏览器已加载的聊天历史。完整导入、导出、删除继续使用数据页。
- `/settings/data` 增加数据库表统计，并保留既有历史、配置和重置能力。
- 以上管理页仅在开发者会话有效时挂载，服务端对管理读取和写入再次验权。
- 开发者密码保存为加盐 scrypt 摘要，私密配置被忽略并拒绝浏览器文件访问。
- 登录五次失败后暂停一分钟，会话一小时失效，退出或服务重启撤销访问。

真实人物数据库在变更前通过 SQLite backup 保存到本机私密备份目录。
没有猜测用户正确姓名，没有批量改名。用户可在再次对话中纠正，或登录管理页修改对应档案。
本人对话中的自动学习、纠错和拒绝记忆仍走当前清晰单人的归属检查。
这项权限保护管理访问，不能阻止设备所有者直接读取浏览器 IndexedDB 或主机文件。
开发者账号不登录 hosted 后端，不获得模型额度，也不改变陌生人的云权限。

## 验证与验收边界

首次回归复现了缺少确认状态和错字无法更新的问题，随后修改实现。
自动测试使用生成身份、临时真实 SQLite、Windows DPAPI、真实 Vue/Pinia 与 Chromium。
真实同源网关验证了访客 403、开发者登录、管理读取、退出后 403 和外部 Origin 拒绝。
1280px 与 390px 页面使用生成档案检查布局和选择器，不保存真人姓名或私人交流截图。
类型检查、lint、构建和最终回归结果记录在 AIRI-025 任务及本报告后附表。

未调用真实对话模型来验收确认话术，也未完成真人麦克风、摄像头和同音字往返。
提示词能要求确认，但不能保证模型每次按预期说话。写库保护独立于模型话术。
当前持久人物身份仍依赖已有视觉链路。无摄像头的新朋友持久身份尚未建设。
Electron/Pocket 仅共享页面源码，没有新增本机管理网关，不能声称全部客户端已验收。

## 缺失能力的建设顺序

| 能力 | 后续建设方法 | 验收条件 |
| --- | --- | --- |
| 无摄像头认识人 | 复用已有会话身份，增加用户明确同意的持久人物关联和文字姓名确认 | 切换会话、账号和角色不串档，陌生人不变成伪造账号 |
| 自动提取长期事实 | 让已配置模型从真实对话提出候选事实，用户确认后写入独立事实表，保留来源、人物、角色、修订与删除 | 否认和更正能替换旧事实，普通交流正文不会自动获得事实权威 |
| 任意错字解释 | 让现有模型提出结构化候选拼写，校验当前轨迹与会话，再复述并请本人确认 | “某字的某字”等表述不会未经确认直接写库，声音同音歧义可以转为文字 |
| 语义检索 | 先验证事实提取，再选本地 embedding 或已有显式配置的服务。保留 SQLite 主记录，索引可重建 | 人物和角色先过滤，检索有界且可追溯，删除同时移除索引 |
| 跨设备同步 | 复用真实后端账号检查，设计明确同意、设备归属、冲突和撤销流程 | 不把人物 ID 或本机开发者 Cookie 当 hosted 认证，不默认上传照片和模板 |

`memory-pgvector` 仍是骨架。本轮没有安装 PostgreSQL、向量服务或新的付费模型。
新增插件只在已有记忆、存储接口和模型能力无法满足明确需求时考虑。

## 关键源码

- `services/local-vision/social.py`：候选、确认、纠错和轨迹归属。
- `services/local-vision/identity.py`：行为规则、姓名确认和原人物修改。
- `services/local-vision/developer.py`：本机登录、失效及管理 API。
- `packages/local-vision/src/vite.ts`：同源代理与受保护 Cookie。
- `packages/stage-ui/src/stores/local-vision.ts`：普通/实时对话上下文。
- `packages/stage-ui/src/components/scenarios/memory-manager.vue`：既有记忆和数据库能力的管理界面。

## 最终检查结果

Node/pnpm 使用 `scripts/airi-env.ps1` 初始化的现有环境，Python 使用已有 vision-venv。
pnpm 命令加 `--config.verify-deps-before-run=false`，本轮未更改依赖。

| 命令 | 结果 |
| --- | --- |
| vision-venv Python `-m unittest discover -s tests`，在 services/local-vision 中执行 | 57 项通过 |
| pnpm `-F @proj-airi/local-vision test:run` | 16 项通过 |
| pnpm `-F @proj-airi/stage-ui test:run --project browser`，指定两个管理组件、local-vision、companion 与采集 browser test | 5 个文件、9 项通过 |
| pnpm `-F @proj-airi/stage-ui typecheck`、`-F @proj-airi/local-vision typecheck` | 通过 |
| pnpm `typecheck` | 55 个任务通过，包含 stage-pages 与客户端 |
| pnpm `lint` | 0 错误、603 条既有警告，退出 0 |
| pnpm `-F @proj-airi/local-vision build`、`-F @proj-airi/i18n build` | 通过，最终网关已重启加载 |
| Node `.runtime/AIRI-025-ui.mjs` | 真实同源鉴权与生成数据桌面/390px管理页面通过 |
| Git `diff --check` | 通过，有既有 LF/CRLF 提示 |
| Node `scripts/project-wiki.mjs check` | 32 篇当前，待复核 0，错误 0 |
| Node `scripts/generate-project-index.mjs` | 生成成功，72 个包、5545 个源码文件 |

首次 Python 临时目录和浏览器子进程受沙箱限制，随后获准用同一测试命令执行，未修改断言规避边界。
实际页面验收发现选择器不允许空字符串选项，改用已有 placeholder API，并增加真实选择器回归。
停止脚本的日期比较受 JSON 日期类型影响，改为与其他项目脚本一致的 UTC ticks 核对，实际停止和启动通过。
源码、报告、Wiki 与任务已检查，未发现开发者明文密码。私密数据库备份和凭据均被 Git 忽略。
Wiki 已人工复核并登记源码指纹。目录生成的 Git 子进程首次受沙箱限制，获准后生成成功。
变更和验证结果登记在 AIRI-025；真人对话验收及上表后续建设仍单独保留边界。
