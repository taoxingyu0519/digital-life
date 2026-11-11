# Local social vision

This service runs YOLOX, ByteTrack, YuNet, local face encoders, and MediaPipe for the AIRI Web app.
This local project is for non-commercial, non-profit scientific research, as specified by its owner.
It accepts paired frames from the local camera owner.
It does not expose arbitrary file or URL inference endpoints.

## Windows setup

Run these commands from the parent AIRI workspace:

```powershell
./scripts/vision.ps1 install
./scripts/vision.ps1 install-cuda
./scripts/vision.ps1 prepare
./scripts/vision.ps1 doctor
./scripts/vision.ps1 smoke
./scripts/vision.ps1 start
```

Open AIRI. Active mode starts local camera capture and social perception by default.
Use the stage button to switch to passive mode. The mode persists locally.
Image transmission stays disabled. Text, name, identity and greeting choices are separate controls.
Keep camera participants informed and obtain consent before enrollment.

Optional Grounding DINO preparation:

```powershell
./scripts/vision.ps1 install-grounding
./scripts/vision.ps1 prepare-grounding
```

These commands download several gigabytes from the official model and package publishers.
Restart the service after installation.
No model download happens inside an inference request.

## Checks and reports

```powershell
./scripts/vision.ps1 test
./scripts/vision.ps1 integration
./scripts/vision.ps1 accept --profile engineering
```

Integration sends synthetic JPEGs to the real service. It does not use a camera.
`accept` lists missing full-matrix evidence and exits nonzero until acceptance is complete.
Synthetic execution never proves recognition quality or real camera performance.

Reports live in `reports/`.
Models, the service credential, encrypted templates, and calibration stay in the ignored `airi/.local/vision/` directory.
Windows DPAPI protects templates under the current operating-system user.
The database stores conversational names, encounters, encrypted face crops and encrypted user statements.
It saves one face crop per angle and never records full camera video.
Memories are scoped to the visible person and active character. They are not verified facts or instructions.

## Constraints

With enrollment consent, one fresh, quality-checked face can reserve an anonymous profile and permanent random ID before a name is known.
The person must confirm the written name before it replaces the blank display name. Early memories keep the same ID.
The existing named and manual enrollment paths still collect ten consistent samples.
Other angles accumulate during later conversations.
Conservative social matching works without manual calibration. Independent quality evaluation remains open.
The current machine uses EdgeFace S through the existing ONNX Runtime. SFace remains the enrollment encoder.
Encrypted 512-dimensional indexes remain separate from the original 128-dimensional templates.
Stable, confirmed faces use about one embedding per second. Face visibility and quality checks continue at up to five per second.
New tracks, changed appearance and enrollment restore frequent embeddings. Current-frame disagreement cannot inherit historical scores.
Confirmed tracks retain names through brief score dips and up to 1.5 seconds of blur.
Conflicting faces, overlapping ownership and expired evidence require fresh confirmation.
Moderate frames support recognition. Only clear, larger faces can update templates or photos.
Strong agreement from ten new samples can reuse one existing profile. Equal names alone cannot merge people.
Multiple people, stale evidence and lost ownership prevent speaker attribution.
Saying “do not remember me” discards learning and removes the matched local profile.
Actions describe visible motion. They do not establish emotions, intentions, or psychological states.
Face recognition never grants access to private data or account features.
No liveness or presentation-attack detection is included.

Detailed operation and validation limits: workspace `开发文档/07-local-vision.md`.

## Recognition comparison

```powershell
./scripts/vision.ps1 prepare-recognition
./scripts/vision.ps1 recognition-benchmark
./scripts/vision.ps1 recognition-probe
```

The fixed ONNX artifacts come from `yakhyo/edgeface-onnx`. The lock records hashes and both upstream licenses.
These commands never export private crops or names. The probe supplies body boxes and timestamps to real face models.
Saved-crop and public-example results do not establish live-camera accuracy or whole-machine power savings.
The private `recognition.json` selects `sface`, `edgeface-xs`, or `edgeface-s`. Restart the service after changing the model.

## 姓名确认与开发者维护

姓名确认习惯保存在 SQLite 行为规则，候选状态与写库保护由 SocialLearning 执行。
明确确认后修改原人物 ID，保留照片和角色交流记忆。完整操作、验证与未建设能力见工作区中文报告。
此处“修改原人物”指更新原 ID 对应的显示名，UUID 本身不变。`social.recipient` 与可读记忆 `profile` 分离，核对姓名不丢失归档对象。拒绝记忆撤销匿名档案及当前浏览器对应原文，并转为被动模式，避免立即重新采集。
管理 API 要求本机开发者会话，密码只存加盐摘要。`developer.py --username <用户名>` 用隐藏输入配置账号。
轮换后重启服务撤销旧会话。不要把密码、摘要、Cookie、真人姓名或照片写入报告和 Git。

## 连续轨迹补采

AIRI-029保留既有模型，EdgeFace索引加入候选暂存、基础前后复核和可撤销扩展。
已认识人物的自动补采不覆盖基础照片；明确介绍期间的登记保留。扩展不能继续担保扩库。
帧新增本地adaptation状态。严重模糊与曝光分别报告。metrics保留最近200帧类别计数，无图像/人物标识。
开发者记忆页可按观察批次撤销扩展。原姓名、登记与交流记忆保留，人物删除同时清除扩展。
工作区`vision.ps1 adaptation-probe`使用真实编码器、授权裁剪与临时图库验证构造变化及撤销。
细节见[中文决策](../../docs/ai/adr/2026-10-06-trajectory-face-adaptation.md)。真人准确率仍待验收。
