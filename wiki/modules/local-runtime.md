# 本地运行与服务排查

2026-10-11，AIRI-037：Web 同源固定启停接口调用已有 vision.ps1，关闭在 idle 后以 PID 和 UTC ticks 双重核对归属，失败不杀未知进程。实际关闭释放18765监听、启动恢复CUDA ready，网页和设置保持可用。后台恢复脚本本轮完成缺失 Web 的冷启动，更新下文历史未验边界，详见[统一启停](stage-runtime.md)。

核对日期：2026-10-08。范围：当前 Windows 工作区及 LAN/UU 入口。关联任务：AIRI-003、AIRI-010、AIRI-013、AIRI-025、AIRI-030。

工作区脚本选择已有 Node、pnpm 和 Python 环境。不要用另一套临时安装替代它们。
项目管理、Web、视觉和局域网网关有各自生命周期。

## 进程与流向

| 服务 | 地址或端口 | 启动与职责 |
| --- | --- | --- |
| Web | 127.0.0.1:5173 | start-airi.ps1，Vue/Vite 与同源网关 |
| 管理 | 127.0.0.1:5174 | start-project-manager.ps1，任务、Wiki 和索引 |
| Python 视觉 | 127.0.0.1:18765 | vision.ps1，本机模型推理 |
| LAN HTTPS | 主机 5443 | start-airi-lan.ps1，同源 Web/WSS 转发 |
| 公开证书说明 | 主机 5442 | 证书安装说明，不含私人凭据 |
| SSH | 127.0.0.1 / 当前家庭地址:22 | 原公钥鉴权，UU 映射回环入口 |

笔记本摄像头 → HTTPS/WSS 网关 → 回环 Vite → 主机 Python。
笔记本麦克风 → 同源实时语音网关 → 外部豆包服务。
设备属于浏览器所在机器，推理和网关属于主机。浏览器设置与历史各自保存。
私人访问链接只保存在受控本地位置，不进入 Wiki 或任务。

## 按证据排查

1. 核对端口对应进程及本轮启动日志。
2. 核对安全上下文和浏览器设备权限。
3. 核对摄像头唯一拥有者和当前会话。
4. 核对实际处理帧数、帧年龄及质量拒绝原因。
5. 最后核对人物识别、主动调度和模型服务。

ready 不能替代摄像头帧证据。合成灰图集成不能替代真人识别质量。
修改 Python 后重启视觉。修改实时语音网关后重建该包并重启实际 Web。
修改本机记忆代理后重建 local-vision 并重启 Web。开发者账号轮换后重启视觉以撤销旧会话。
stop-airi.ps1 以 PID 与 UTC ticks 核对已记录 Web 进程，避免 JSON 日期类型变化导致错误比较。
本轮遇到日期对象与字符串比较失败，核对实际时间相同后改为 UTC ticks，并验证了正常停止和重新启动。
轻量人脸权重使用 vision.ps1 prepare-recognition 准备。recognition-benchmark 记录本机提取耗时和少量裁剪分数。
recognition-probe 使用真实人脸模型、已有加密照片和测试人体框。它不能替代摄像头现场验收。
adaptation-probe 使用真实编码器与隔离临时图库，检查构造姿态/光照补采和撤销，不向真人库写测试扩展。
视觉帧包含recognition与adaptation诊断。Python重启后刷新旧客户端；帧计数、采集FPS和拒绝分类用于区分断流、低帧率与画面质量。
运行配置与权重位于忽略目录，运行时不下载模型。模型 hash 和许可证在启动时校验。
LAN 直接 HTTP 缺少安全上下文。首次 HTTPS 设备按 [LAN 指南](../../开发文档/08-lan-testing.md) 安装证书。

这些进程尚未注册为 Windows 开机服务。主机进程停止后，在主机重新运行
`start-airi-lan.cmd` 恢复缺失服务，现有证书和私人访问凭据会保留。
先看当前 5443、5173 和 18765 监听状态；旧的进程记录文件与无错误日志不能证明服务仍在运行。
2026-10-01 链接故障中五个服务端口均停止监听，重启后 HTTPS、语音 WSS 和合成帧 CUDA 推理恢复。
未取得停止触发原因的证据，笔记本真人画面和实际通话仍须现场验收。

2026-10-08 家庭 IP 从 `192.168.1.5` 变成 `192.168.1.2`，旧地址绑定仍显示 LISTENING，
但无法完成 SSH 握手。核对真实网卡地址比“进程仍在运行”更能定位这类故障。
已备份并修复 SSH 到回环与当前家庭地址，原密钥鉴权、主机公钥和防火墙远端范围保留。
UU 映射改成笔记本 `127.0.0.1:22022` → 台式机 `127.0.0.1:22` 后，
用户确认公司网络 SSH 登录、网页 200 和视觉 ready 成功。家庭 LAN 尚未现场验证。
旧 HTTPS 网关与证书仍使用旧 IP，当前连接助手改走 SSH，不将旧 HTTPS 链接称为已恢复。

`start-airi-background.ps1` 供远程服务恢复使用，复用健康服务，缺失 Web 在独立隐藏进程中启动。
恢复命令等待 Web 与同源视觉 ready 后返回，不等待前台 Vite 退出。
助手的 PID 归属核对使用 UTC ticks。旧 Web 记录本轮相差约 3.5ms，现有停止保护拒绝结束该进程。
没有放宽比较或强行结束服务。本轮只完成健康复用分支，缺失 Web 的实际冷启动仍未验。

AIRI-031 从台式机经 UU 主动连接在线笔记本，普通远控请求成功，但远程终端分别出现
协议版本不兼容和 `terminal_bridge_unavailable (code 503)`。台式机与官网公开安装包同为
4.42.0.2770，不能据报错直接断言有新版可装。界面捕获/点击也失败，未取得笔记本网页验证。
台式机首页 200、视觉 ready 已独立核对。保留上一轮公司现场成功记录，区分历史成功和本轮未验。
详见 [现场连接边界](../../开发文档/08-lan-testing.md#7-从台式机主动连接笔记本的现场边界airi-031)。

## 管理 Wiki

管理服务读取 Wiki catalog 白名单，提供专题检索和阅读。
它不调用模型，也不将开发文档注入角色。目录同步只生成机械索引与证据状态。
详细维护见 [维护流程](../maintenance.md)。

## 证据

- [airi-env.ps1](../../scripts/airi-env.ps1)：运行环境。
- [start-airi.ps1](../../scripts/start-airi.ps1)：Web 和服务启动。
- [start-airi-background.ps1](../../scripts/start-airi-background.ps1)：有界远程恢复与健康检查。
- [stop-airi.ps1](../../scripts/stop-airi.ps1)：核对后仅停止项目记录的进程树。
- [start-airi-lan.ps1](../../scripts/start-airi-lan.ps1)：复用证书并启动缺失的 LAN 服务。
- [vision.ps1](../../scripts/vision.ps1)：视觉准备、运行和验证。
- [lan-gateway.mjs](../../scripts/lan-gateway.mjs)：TLS、访问检查与代理。
- [project-manager.mjs](../../scripts/project-manager.mjs)：任务与 Wiki API。
- [project-wiki.mjs](../../scripts/project-wiki.mjs)：检索与证据状态。

返回 [Wiki 首页](../README.md)。


AIRI-033新增提示词公开出口后，旧Vite缓存尚未识别。先核对5173监听者的完整工作区命令再重新加载，实际中文页面恢复。
旧记录与实际启动时间相差3.5ms导致保护脚本拒绝停止，本轮保留保护并只重启已核对的Vite。模型与私人配置未重置。
