# 2026-10-01 本地连续识别优化验证

任务：AIRI-014。用途：本地非商业、非盈利科学研究。
用户授权按开源调研实施。原项目、模型与 ONNX 转换项目各自保留许可证。

本机已加载 EdgeFace S，CPU ONNX Runtime 使用两个计算线程。
YOLOX 仍使用 CUDA，ByteTrack、YuNet、MediaPipe 与摄像头采集保持原有职责。
稳定确认后特征约每秒提取一次。新轨迹、明显变化与登记恢复高频。
质量检查最多每秒五次。多人、冲突与过期证据撤销姓名，不用历史高分掩盖陌生脸。
最多四次、两秒内的质量加权得分用于确认。这里没有部署完整 CAFace 网络。

原 SFace 128 维登记模板与人物档案保留。EdgeFace 512 维索引独立加密，按模型 hash 与照片角度隔离。
修改数据库前已保存可恢复的本地备份。照片只在内存解密，没有导出私人图片、向量或姓名。
部署后只读核查：一个带姓名的档案、三张照片、十三条交流记忆和三份独立识别特征索引。
实际服务 ready=true，YOLOX device=cuda，perception.model=edgeface-s。

## 本机模型对比

执行 `scripts/vision.ps1 prepare-recognition` 和 `scripts/vision.ps1 recognition-benchmark`，均退出 0。
对每个模型预热五次，计时六十次。使用三个已有加密对齐裁剪和转换项目的三个公开示例。

| 模型 | 单次特征中位耗时 | p95 | 三对跨角度最低相似度 |
| --- | --- | --- | --- |
| SFace | 6.29 ms | 6.78 ms | 0.832 |
| EdgeFace XS | 2.22 ms | 2.25 ms | 0.843 |
| EdgeFace S | 3.26 ms | 3.41 ms | 0.898 |

选择 S 是本次速度与跨角度样本结果的工程判断。
相对 SFace 的单次特征中位耗时降低约 48%，不能解释为整机 CPU 或耗电降低 48%。
模型的分数尺度不同。三个裁剪与少量公开示例不能确定真人误认率或通用准确率。
ONNX 来自 yakhyo/edgeface-onnx 转换项目，权重与许可证 hash 已锁定。
已按转换源码核对 RGB、112×112 与归一化。没有运行 PyTorch 与 ONNX 逐元素等价验证。
证据：[benchmark JSON](recognition-benchmark.actual.json)、工作区 `.runtime/recognition-benchmark.log`。

## 本轮实际检查

| 位置与命令 | 结果 | 证据与方式 |
| --- | --- | --- |
| 工作区 `scripts/vision.ps1 test` | 46 项通过，退出 0 | `unit-tests.actual.json`，`.runtime/recognition-unit-tests.log`。真实 DPAPI 与临时 SQLite，替换外部模型边界 |
| 工作区 `scripts/vision.ps1 recognition-probe` | 两次新会面均确认同一档案，失脸后姓名过期，退出 0 | `recognition-probe.actual.json`。真实 YuNet、对齐、EdgeFace、ByteTrack、数据库。人体框和时间由测试提供 |
| 工作区 `scripts/vision.ps1 integration` | 最新源码重启后五帧通过，退出 0 | `service-integration.actual.json`，`.runtime/recognition-integration.log`。真实 CUDA 推理与生成灰图，网关、LV01、拥有者、释放检查 |
| airi 根 `pnpm typecheck` | 55 个任务成功，退出 0 | `.runtime/recognition-typecheck.log` |
| airi 根 `pnpm lint` | 0 错误、605 个既有警告，退出 0 | `.runtime/recognition-lint.log` |
| airi 根 `git diff --check` | 退出 0 | `.runtime/recognition-diff-check.log`，只有换行转换提示 |
| 工作区 `scripts/generate-project-index.mjs` | 退出 0，72 个包、5507 个源码文件 | 现有 Node，架构分析仍单独维护 |

Node 与 pnpm 使用 `scripts/airi-env.ps1` 初始化的运行时。
两次各 120 秒现场采样期间处理帧数均未增长，未取得现场摄像头样本。
零身份跳变不能作为识别稳定的证据。匿名采样结果位于工作区 `.runtime/recognition-live-*.json`。

## 尚待验证

真人姓名跳变、陌生人误认、重新确认延迟、实际语音答案和整机功耗继续由 AIRI-009 跟踪。
原八十二项矩阵、完整性能、角色帧率与八小时稳定性没有执行。
FaceLiVTv2、完整 AdaFace/CAFace 和替换跟踪器没有部署。未新增 PyTorch、timm 或收费服务。
本报告不标记 FULL_ACCEPTED，也不把保存裁剪回放称为真人摄像头验收。

实现决策见 [ADR](../../../docs/ai/adr/2026-10-01-adaptive-face-recognition.md)。
