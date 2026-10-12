# 主动模式未联动实时语音：调查与修复

日期：2026-10-08（Asia/Shanghai）。任务：AIRI-032。

## 结论与改动

用户通过笔记本连接助手访问 AIRI。开启主动模式后，快慢脑协作仍显示“开始通话”，文字能回复但没有语音。
该按钮说明实时通话尚未启动，不能据此将原因归为用户没有手动开始通话。

`companion.ts` 的 `maintainVoice` 要求 `!devices.enabled` 才能自动通话。
普通麦克风开关是持久配置，即使普通 VAD 初始化失败，它仍保持开启。
当前 Web 日志多次出现 `Audio interaction failed: Error: Failed to fetch`，位于普通 VAD 初始化路径。
日志不能确定那次网络请求失败的具体原因，也不能单独证明笔记本当前所有配置。

浏览器回归复现了确定的代码问题：普通麦克风关闭时自动接通，开启时始终停在 `idle`。
实时 store 从 `connecting` 起已标记 `active`，Web 页面已有普通 ASR 暂停绑定。
修复移除重复且错误的麦克风开关门控，不改动设备偏好、豆包配置或身份认证。

仍需单个有效视觉人物、当前采集拥有者、问候权限、语音配置、音频宿主和空闲状态。
手动挂断后同一次相遇不自动重连，被动模式停止自动通话，再开启主动可重新接入。
改动为客户端源文件，现有 Vite 开发服务提供更新，笔记本需刷新载入。

## 验证证据

命令均使用 `scripts/airi-env.ps1` 初始化的现有 Node/pnpm。
浏览器测试使用 `$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $AiriWorkspace '.tools/playwright'`。

| 命令 | 实际结果 | 证据与限制 |
| --- | --- | --- |
| `node .runtime/voice-gateway-delivery-probe.mjs` | 退出0，两段音频为163080/75790字节，各有对应结束事件 | `.runtime/airi032-live-voice.log`。本机5173到真实豆包，公开测试句，不发送麦克风或私人对话 |
| `pnpm -F @proj-airi/stage-ui exec vitest run src/stores/modules/realtime-brain.browser.test.ts -t aIRI-032`（修复前） | 1通过、1失败，开启输入时预期listening，实际idle | `.runtime/airi032-reproduce.log`。真实浏览器/Pinia/视觉传输，语音厂商与音频边界模拟 |
| `pnpm -F @proj-airi/stage-ui exec vitest run src/stores/modules/realtime-brain.browser.test.ts src/stores/companion.browser.test.ts src/stores/modules/realtime-audio.browser.test.ts` | 45通过，退出0 | `.runtime/airi032-browser-tests.log`。含两种输入状态、挂断、被动/主动切换及真实AudioWorklet生命周期 |
| `pnpm -F @proj-airi/realtime-voice test:run` | 26通过，退出0 | `.runtime/airi032-voice-tests.log`。模拟上游协议回归 |
| `pnpm -F @proj-airi/stage-ui typecheck` | 退出0 | `.runtime/airi032-stage-ui-typecheck.log` |
| `pnpm typecheck` | 55任务成功，退出0，45任务使用缓存 | `.runtime/airi032-typecheck.log` |
| `pnpm exec eslint packages/stage-ui/src/stores/companion.ts packages/stage-ui/src/stores/modules/realtime-brain.browser.test.ts` | 退出0，无错误或警告 | `.runtime/airi032-scope-lint.log` |
| `pnpm lint` | 退出0，0错误、603警告 | `.runtime/airi032-lint.log`。警告来自工作目录其他已有代码 |
| 本机5173请求Vite转换后的companion模块 | HTTP 200，已包含修复后的门控，旧门控不存在 | 当前服务已提供新源码，无语音网关改动，无需重启网关 |

Wiki人工复核、`project-wiki.mjs check` 和 `generate-project-index.mjs` 结果记录在 AIRI-032 任务。

初次 Vitest 运行受沙箱 `spawn EPERM` 限制，使用获准的现有命令在沙箱外完成。
浏览器首次未指定工作区路径，未找到默认用户目录的 Playwright 浏览器；指定已有目录后正常执行，无新增安装。

## 现场边界

本轮未直接控制笔记本页面，也没有取得修复后的麦克风往返和扬声器声音回执。
真实豆包返回音频证明厂商路径可用，不能代替笔记本实际播放验收。
普通 VAD 的外部模型请求失败仍是独立问题，本轮未将它误报为已修复。
真人设备和模型体验继续由 AIRI-004 跟踪。

证据入口：[companion.ts](../../../packages/stage-ui/src/stores/companion.ts)、[回归测试](../../../packages/stage-ui/src/stores/modules/realtime-brain.browser.test.ts)、[Web输入绑定](../../../apps/stage-web/src/pages/index.vue)、[语音专题](../../../../wiki/modules/voice.md)。
