# 连续轨迹审核与可撤销人脸扩展

日期：2026-10-06。任务：AIRI-029。状态：已实施，真人质量待验收。

## 问题与选择

单帧角度或光照变化会降低匹配。直接把同一track_id视为本人并写库，会把跟踪错误变成长期模板污染。
当前AIRI已有YOLOX、ByteTrack、YuNet、EdgeFace S、SFace登记与加密图库。
本轮保留既有检测和特征网络，在同一worker内加入TrajectoryLearning。

| 候选 | 官方能力 | 本轮取舍 |
| --- | --- | --- |
| InspireFace | 稳定跟踪、质量选帧、采集状态；轨迹编号不是身份 | 借鉴采集与身份审核分离，不新增SDK、模型包和DLL生命周期 |
| BoT-FaceSORT | 人脸外观记忆、关联及镜头切换检测 | 借鉴不连续事件清空；当前单摄像头先补身份管理。复杂多人关联仍待独立对比 |
| PersonAnalysis | 脸、身体ReID与身体参考更新；输出当前帧 | 不替换。自动更新不补人脸，本项目仍需独立轨迹、入库和持久化管理 |
| 轨迹自更新研究 | 用更严格的轨迹证据审核困难样本 | 采用前后基础匹配、连续观测及候选暂存，未复现论文完整分类器 |
| OSDe-SVM与模板污染研究 | 可追溯适应、撤销、漂移风险 | 扩展分批保存，基础参考不覆盖；扩展不能继续担保扩库 |

这是针对当前工程的选型推论，不是这些SDK在本机的速度或准确率比较。
若后续独立录像证明检测或多人关联是主因，再单独验证替换组件。

## 运行规则

仅当前EdgeFace索引开启轨迹补采。SFace保留普通识别与明确介绍登记。
基础照片和自动扩展索引分离。识别允许使用两类参考，补采锚点只查询基础照片。
姓名须已明确确认。基础最高余弦至少0.70、候选差至少0.15，三次间隔至少0.25秒的证据建立锚点。

单人、同一轨迹、完整可见过程，帧间隔至多0.8秒、整轮至多12秒。
身体框单帧归一化变化至多0.07，人脸框变化至多0.10，尺度比为0.65–1.5。
相邻有效特征余弦至少0.70。任何丢失、多人、冲突、断流、版本变化或授权撤回清空候选。
这些是保守工程参数，不是已标定的误认率保证。

候选必须通过原登记质量条件。每轮最多三个角度/光照代表，重复基础外观不补采。
结束时再获得三次同一基础身份的可靠匹配才提交。候选及已有自动扩展都不能用于此证明。
每人物、模型最多十二个扩展样本，相似度至少0.98的重复扩展跳过。达到上限不覆盖基础或偷偷替换记录。
扩展独立保存模型版本、基础版本、观察批次、条件、加密向量和加密裁剪，可整批撤销。

原已认识人物的单帧add_pose不再自动改变基础照片。明确介绍期间的受控登记仍沿用原流程。
轨迹持续状态只提示“待复核”。它不附带人物ID、姓名或私人记忆，不扩大对话授权。

## 接口与维护

帧新增可空adaptation进度，和recognition诊断一样只在本地显示。
metrics保留最近200帧的质量/匹配类别计数，无人物标识或图像。
模糊与曝光分为face-blurry和face-exposure，避免把不同原因混成一句提示。
开发者人物维护页显示补采批次数量，DELETE /admin/persons/{person}/face-extensions/{round_id}撤销单批。
沿用现有开发者会话与worker复核，撤销会清空在途视觉证据。

## 证据

- [InspireFace跟踪](https://doc.inspireface.online/guides/tracking.html)、[采集](https://doc.inspireface.online/guides/face-capture.html)。
- [BoT-FaceSORT官方仓库](https://github.com/bellhyeon/BoT-FaceSORT)。
- [PersonAnalysis官方文档](https://github.com/deepinsight/insightface/blob/master/python-package/docs/person_analysis.md)。
- [轨迹自更新论文](https://espace2.etsmtl.ca/id/eprint/9302/)、[OSDe-SVM](https://arxiv.org/abs/2012.09571)、[模板污染论文](https://arxiv.org/abs/1905.09162)。
- [本轮中文报告](../reports/2026-10-06-trajectory-face-adaptation.md)。
