# Local vision boundary

This package owns the browser camera transport, validation, privacy projection, and greeting policy.
The Windows Python service runs detection and tracking on loopback port 18765.

## Use

The Web app installs `localVisionPlugin()` in Vite.
Active mode creates one `LocalVisionCapture` automatically. Passive mode releases it.
`CameraLease` prevents competing capture in the MediaPipe workshop.

The camera sends one bounded JPEG at a time.
The browser obtains a stream ticket with POST, then connects to the same-origin `/api/local-vision/stream` WebSocket.
Vite forwards that stream to the loopback Python service. HTTPS pages use WSS.
The `LV01` header binds each frame to its source, sequence, and privacy generation.
The client discards stale results.

`projectObservation()` checks consent on each request.
Its output belongs to that request and never enters persistent context.
`SocialScheduler` requires stable presence and checks actual speech and response activity.
It schedules greetings and memory-aware small talk with per-person and global cooldowns.

`FaceGaze` consumes current normalized face boxes for local stage attention. A known name is not required.
It keeps one target, mirrors horizontal coordinates, smooths motion, and rejects camera evidence older than 500 ms.
The Stage UI render scope owns its timer. Gaze does not enter model prompts or persistent memory.

## Checks

Run `pnpm -F @proj-airi/local-vision test:run` and `pnpm -F @proj-airi/local-vision typecheck`.
Browser lifecycle tests live in Stage UI's `local-vision-capture.browser.test.ts`.

## Limits

The Python service and Vite gateway accept loopback traffic. The workspace LAN gateway adds authenticated HTTPS access.
LAN cameras use that same-origin gateway. Read `开发文档/08-lan-testing.md` for certificate setup and the private entry link.
It does not provide automatic cloud video streaming.
Read the service README and workspace `开发文档/07-local-vision.md` before deployment.

## 本机记忆维护接口

同源 Vite 代理转发开发者会话 Cookie，Python 验证管理权限。前端标记不是授权凭证。
social 契约包含姓名候选状态与持久行为规则，普通聊天和实时语音共用当前投影。
未确认候选不投影旧姓名和个人回忆。人物总表、维护和手工登记要求独立开发者登录。
普通性能统计保留，含人物的观察只向开发者返回。详细边界见工作区数据与记忆 Wiki。

`social.recipient` 表示当前已验证的归档人物，`profile` 表示可读的有界个人记忆。姓名核对期间可隐藏后者，同时保留同一 UUID 的消息归属。人脸结果不再改变浏览器登录或舞台会话。匿名人物先按许可保存合格特征和随机 ID，确认名字后更新显示名。
