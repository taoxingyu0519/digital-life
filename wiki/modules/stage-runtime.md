# 舞台统一启停与交付回归

AIRI-046：关闭清空本次通话字幕，未完成助手片段沿用原打断保存；迟到字幕受认证、会话和代际约束。阅读偏好与已存原文在重启后保留。固定门禁新增阅读/滚动/历史组件用例，实际页面另验100条原文、字体及回到最新入口。

2026-10-11，AIRI-037。首读入口：舞台“启动/关闭”、关闭后自动重连、再次启动、交付旧功能回归。

## 生命周期与资源

共享 chat.send、retry 与 rerunToolCall 在休眠时先拒绝，不截断历史、不执行模型或工具；输入层也保留草稿并显示启动提示。关闭不删除已有记录与整理。

同步 `stage-runtime` action 由领导窗口执行。状态包括 running、starting、closing、sleeping；偏好持久化而设备、AbortController 和 Promise 留在当前运行时。外部 storage 更新不生成状态提案，防止跟随窗口旧快照覆盖关闭状态。所有窗口收到 disabled 后释放自己的音频和摄像头。启动可重复自检，启动中重复点击不再分配；关闭先提升代际，迟到自检、音频和设备权限结果不得复活已关闭资源。

启动顺序：停旧采集/通话/任务→唤醒已有本机视觉进程并等待模型 ready→真实语音网关配置连接→后台文字模型配置→本地会话初始化/当前身份激活→恢复原模式。AIRI-045 中该身份为真实认证身份，人脸只改变消息归档对象，不反复触发会话激活。用户点击启动清除视觉自动重试的15秒退避；这不改变主动/被动或普通麦克风偏好。状态为运行中允许可用模块使用，某模块不可用/未配置逐项显示，不伪报全部正常。

关闭顺序：禁用输入和自动定时器→停止摄像头/PCM/WebSocket/TTS/快慢脑及普通生成→视觉服务确认 idle 并挡住新绑定→核对已记录 PID 和启动时间→停止 Python 进程树释放 CUDA。其他摄像头绑定或查询仍在使用时报告 busy 并保留进程；未知进程不杀。网页、设置、历史与轻量网关仍可用。刷新后继续休眠。远程厂商服务器不能由本应用启停，只关闭连接和请求。

本机控制仅允许固定路径和无请求体 POST，需要回环 Host、同源 Origin/Sec-Fetch-Site 与 x-airi-runtime 头。服务凭据保留在宿主；不暴露任意命令、脚本路径或参数，不改变 SSH/LAN/开发者权限。

## 交付检查

AIRI-042：人物全部记忆清除复用统一关闭以取消所有生产者并释放资源，完成后由用户重新启动，避免旧通话继续写入。固定门禁保留全部原基线，新增人物清除双窗口与维护组件回归。真实舞台启停、休眠设置→机体模块→长期记忆导航单独验证，删除界面使用生成档案替身，不操作真实人物删除。

AIRI-041：交付脚本按当前项目web-process.json中的端口检查运行服务，支持显式-WebPort。当前4173不影响被其他项目使用的5173。result.json记录webOrigin。启停人工检查须完成并恢复运行后再做最终网关检查，休眠中的视觉服务不能记为ready。

固定命令：`scripts/test-airi-delivery.ps1 -Task <task-id>`。i18n/语音/视觉重建、类型/lint、原13组浏览器/会话基线加共享配置浏览器回归、真实颜色采样空值回归、协议/后端、加密配置宿主和 Web 构建、实际服务读取必须通过。浏览器文件顺序执行，避免测试环境并发争抢。失败记录并修复原因，不删除断言。实际进程更新后才做真实检查，不能把 dist 构建成功视为运行中进程已更新。

实际 UI 启停循环及休眠中的设置/记忆入口另行观察；真人音频和身份质量按设备与模型条件记录，未测试项不能称已验收。日志 `.runtime/delivery/<task>/result.json` 不保存凭据或私人聊天内容。

本次测试抓出的教训：手动重启不能沿用无人值守退避；同步 store 的持久设置监听会产生旧状态提案；隐藏/挂载中的空背景颜色须保持旧主题，避免整页错误边界。参考 [开发指南](../../开发文档/04-development-guide.md) 与 [验证报告](../../airi/docs/ai/reports/2026-10-11-stage-runtime-and-delivery.md)。

## 源码

- `airi/packages/stage-ui/src/stores/stage-runtime.ts`：领导窗口、代际、检查与资源释放。
- `airi/apps/stage-web/src/stage-runtime-gateway.ts`、`scripts/vision.ps1`：串行固定进程操作及归属检查。
- `airi/services/local-vision/service.py`：休眠前绑定保护。
- `airi/apps/stage-web/src/components/local-vision-runtime.vue`、`pages/index.vue`、音频设备/实时语音/companion store：输入和定时器门控。
- `scripts/test-airi-delivery.ps1`、`check-airi-gateways.mjs`：可重复交付入口。
