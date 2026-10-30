# 架构与数据约定

## 运行结构

浏览器（原生 HTML/CSS/ES Modules）→ 本机 Node HTTP API → OnStage 场次编排 → 本地 JSON/文件存储。

模型调用复用 InterviewPal 的 `src/llm/provider.js`；域模型、界面、评分约束及升学流程重新实现。保留上游完整 Git 历史，旧求职模块从当前主版本移除，不存在“改名后仍调用公司档案”的隐式依赖。

`src/domain.js`：院校入口、环节、训练评分、身份与校验。
`src/materials.js`：PDF/TXT/MD/JSON 解析、页码、原件信息与不可读状态。
`src/app.js`：档案、单场快照、预分析缓存、问答状态机、复盘和设备事件。
`src/ai.js`：考官预分析、教练评价、原文证据校验、确定性权重计算与可比历史。
`src/store.js`：限制路径标识、临时文件后原子替换。
`src/server.js`：仅绑定 127.0.0.1、同源访问校验、上传上限、API 与报告导出。

## 缓存与身份

场次缓存键是以下对象的 SHA-256：

```json
{"nickname":"学生自选昵称","school":"院校","major":"专业名称","interviewTime":"含日期和时间的面试时间","attempt":1}
```

内容指纹另外包含完整场次设置和材料哈希。材料、细则、评分、年份、招生类型或环节变化不能命中旧计划。已创建的同身份场次不可再次创建；继续原场或修改时间/次数。场次保存自己的材料和规则快照，不随之后的材料变化改写。

历史比较同时检查：昵称、院校、专业、招生年份、招生类型、评分版本、环节与时长、评价模式。缺少可比样本时显示空状态。单机 JSON 存储面向单进程；生产需迁移到事务数据库。

## 状态机

active → paused → active；active → complete。

每题考官发问后，学生只能提交一次回答；通过 questionId 防止重复或过期题提交。回答后可 followup 或 next。单场最多 160 条问答记录；请求互斥锁防止并发重复写入。complete 后不允许继续回答与提交状态事件。

## 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config` | 模式、院校入口、环节和训练评分 |
| GET / POST | `/api/materials` | 材料元数据 / multipart 文件上传 |
| GET | `/api/materials/:id/file` | 仅通过受限 ID 读取已保存原件 |
| GET / POST | `/api/profiles` | 读取 / 保存学生与院校规则设置 |
| GET / POST | `/api/sessions` | 记录列表 / 根据 profileId 开始面试 |
| GET | `/api/sessions/:id` | 本场完整状态 |
| POST | `/api/sessions/:id/answer` | `{questionId, answer, inputMode, durationMs}` |
| POST | `/api/sessions/:id/action` | `{action: pause/resume/followup/next/finish}` |
| POST | `/api/sessions/:id/sensors` | `{events:[...]}` |
| GET | `/api/sessions/:id/export` | JSON；`?format=md` 为 Markdown |
| GET / POST | `/api/sources` | 按院校专业标注的来源缓存 |
| POST | `/api/search` | `{school,major,year}`；需配置搜索服务 |

## 传感器接口

```json
{"events":[{"channel":"gaze","type":"tracking_state","atMs":1234,"value":"tracking_lost"}]}
```

channel：camera/audio/hand/gaze；type：device_state/speech_interval/tracking_state。atMs 为相对于本场开始的毫秒数，不能用服务接收时间替代声学或硬件采样时间。本版仅存储状态事件，不生成推断标签，不计算精确语速、注视点或手势。每批不超过 200 条、单场不超过 10000 条。多模态数据不进入内容得分公式。

## 资料与模型

联网只发送院校、专业、年份等公开检索词。结果和手动链接均待核验；用户选择“官方”仅声明来源类别，不等于已验证。经验贴不能覆盖院校细则。作品集参考用于讨论维度，不作为学生排名依据。

配置模型后，材料文字、对话和目标规则会发送给所选模型服务。扫描件/图片尚未接入 OCR 和视觉评分。浏览器语音服务可能把音频发给浏览器供应商，界面要求单独勾选。视频仅本机预览；仓库忽略 `data/`、`.env.local` 等运行数据和凭据。

## 原型部署边界

本机单用户，无账户认证、文件加密、云端持久化与生产级并发。不要把监听地址改为公网使用；生产部署需先完成身份与授权、用户数据隔离、留存/删除、上传隔离、请求限流和日志脱敏。
