# 错题库专项需求

## 1. 背景和目标

当前项目已经支持“错题解析”，并在后端生成完成后自动沉淀错题记录，还具备按到期错题生成巩固卷和 PDF 的雏形。下一阶段应从单次讲题升级为“个人错题库工作流”：

```text
录入错题 -> AI 结构化 -> 人工确认 -> 自动归类 -> 复习提醒 -> 针对性出题 -> 掌握度追踪
```

核心目标不是只给一道题答案，而是帮学生、家长和老师持续回答三个问题：

- 最近主要错在哪里？
- 哪些知识点反复错？
- 现在应该练哪一批题？

## 2. 目标用户

| 用户 | 高频场景 | 核心诉求 |
| --- | --- | --- |
| 学生 | 拍照保存错题、考前刷题 | 少整理、多复习、知道下一步练什么 |
| 家长 | 帮孩子整理错题、查看薄弱项 | 不懂题也能看懂问题分布和复习建议 |
| 教培老师 | 批量沉淀学生错题、生成练习 | 按班级、学生、知识点快速组卷 |

## 3. MVP 范围

### 3.1 错题录入

支持三种录入方式：

- 试卷照片批量录入：上传一张已批改试卷照片，AI 识别被老师标记错误的题目，并补全题干、选项、答案和解析后逐条入库。
- 单题录入：粘贴题干 / 学生答案 / 正确答案，或上传题目图片。
- 解析后入库：用户使用“错题解析”生成结果后，系统自动生成一条错题记录。

MVP 优先支持单张试卷照片识别，后续再增强多页批量上传、人工确认和切题框选。

### 3.2 AI 结构化

每条错题需要沉淀为可检索、可组卷的结构化记录：

| 字段 | 说明 |
| --- | --- |
| `subject` | 学科，例如数学、物理、化学、英语、语文 |
| `grade` | 年级 |
| `question` | 原题题干 |
| `options` | 选择题选项，非选择题可为空 |
| `studentAnswer` | 学生原答案 |
| `correctAnswer` | 正确答案 |
| `analysis` | AI 解析正文 |
| `knowledgePoints` | 知识点标签，最多 6 个 |
| `wrongReasons` | 错因标签，例如概念不清、计算错误、审题错误、公式不会、表达不规范 |
| `questionType` | 题型，例如选择、填空、解答、作文片段、阅读理解 |
| `difficulty` | 难度，简单 / 中等 / 困难 |
| `tags` | 用户自定义标签 |
| `masteryStatus` | 待复习 / 复习中 / 已掌握 / 已归档 |
| `reviewCount` | 复习次数 |
| `nextReviewAt` | 下次复习时间 |
| `sourceAttachment` | 图片来源信息 |

### 3.3 归类和检索

错题库首页需要支持：

- 按学科、年级、知识点筛选。
- 按错因、题型、难度筛选。
- 按待复习、已掌握、已归档筛选。
- 支持关键词搜索题干、解析和标签。
- 支持查看知识点错题数量排行。

MVP 可以先用列表 + 筛选条，不需要复杂仪表盘。

### 3.4 复习计划

系统基于 `reviewCount` 和最近复习结果计算 `nextReviewAt`：

- 第 1 次：1 天后
- 第 2 次：3 天后
- 第 3 次：7 天后
- 第 4 次：14 天后
- 后续：30 天后

用户完成复习后可以标记：

- 做对了：`reviewCount + 1`，更新下次复习时间。
- 又错了：保留或强化错因，优先进入近期复习。
- 已掌握：从待复习列表移出，但仍保留记录。

### 3.5 针对错题库出题

出题入口支持两种模式：

- 自动出题：系统默认选取到期复习错题，按知识点覆盖生成同类变式题。
- 手动出题：用户勾选错题，指定题量、难度、题型，生成专项练习卷。

输出要求：

- 试卷标题
- 题目列表
- 答案
- 解析
- 对应知识点
- 来源错题映射
- PDF 下载 / 打印

MVP 先支持“同类变式题”和“薄弱知识点专项题”，暂不做完整真题风格套卷。

## 4. 页面和交互

### 4.1 错题库页面

核心模块：

- 顶部筛选：学科、年级、知识点、错因、状态。
- 统计概览：总错题数、待复习数、薄弱知识点 Top 5。
- 错题列表：题干摘要、知识点、错因、下次复习时间、掌握状态。
- 批量操作：加入本次出题、标记已掌握、归档。

### 4.2 错题详情页

核心模块：

- 原题和学生答案。
- 正确答案和 AI 解析。
- 结构化标签编辑：知识点、错因、题型、难度。
- 复习记录。
- 生成同类题按钮。

### 4.3 出题配置页

核心模块：

- 选择范围：到期错题 / 勾选错题 / 指定知识点。
- 题量：5 / 10 / 15 / 20。
- 难度：简单 / 中等 / 困难 / 混合。
- 题型：同类变式题 / 知识点专项题 / 易错辨析题。
- 输出：在线预览、PDF 下载。

## 5. 接口设计

现有接口保留：

- `GET /api/v1/mistakes`
- `GET /api/v1/mistakes/due`
- `GET /api/v1/mistakes/:id`
- `POST /api/v1/exam-papers`

建议新增：

| 接口 | 用途 |
| --- | --- |
| `POST /api/v1/mistakes` | 手动创建错题，或从已有生成记录补录 |
| `PATCH /api/v1/mistakes/:id` | 编辑知识点、错因、题型、难度、标签和状态 |
| `POST /api/v1/mistakes/:id/reviews` | 提交一次复习结果，更新掌握状态和下次复习时间 |
| `GET /api/v1/mistake-stats` | 返回错题总数、待复习数、知识点排行、错因分布 |
| `POST /api/v1/exam-papers/preview` | 只生成预览，不落 PDF，便于前端调试 |

`GET /api/v1/mistakes` 建议扩展查询参数：

```text
subject, grade, knowledgePoint, wrongReason, questionType, difficulty, status, dueOnly, keyword
```

## 6. 数据模型补充

### mistakes

- `id`
- `user_id`
- `generation_id`
- `subject`
- `grade`
- `question`
- `student_answer`
- `correct_answer`
- `analysis`
- `knowledge_points`
- `wrong_reasons`
- `question_type`
- `difficulty`
- `tags`
- `mastery_status`
- `review_count`
- `next_review_at`
- `source_type`
- `source_name`
- `source_attachment`
- `created_at`
- `updated_at`

### mistake_reviews

- `id`
- `mistake_id`
- `user_id`
- `result`
- `note`
- `created_at`
- `next_review_at`

### exam_papers

- `id`
- `user_id`
- `title`
- `config_json`
- `content`
- `source_mistake_ids`
- `pdf_url`
- `created_at`

## 7. AI 输出规范

错题解析 prompt 需要从自由文本升级为结构化输出。建议识别整张试卷中的错题，并输出 JSON，至少包含：

```json
{
  "summary": "本次识别到 3 道错题",
  "mistakes": [
    {
      "questionNumber": "三、2",
      "question": "完整题干",
      "options": ["A. ...", "B. ..."],
      "studentAnswer": "学生答案",
      "correctAnswer": "正确答案",
      "analysis": "解析正文",
      "knowledgePoints": ["一元二次方程", "因式分解"],
      "wrongReasons": ["概念不清", "计算错误"],
      "questionType": "选择题",
      "difficulty": "中等",
      "tags": ["试卷错题"]
    }
  ]
}
```

前端展示仍以中文解析为主，结构化字段用于筛选、统计和组卷。

## 8. 成功指标

- 错题解析后入库率
- 错题结构化字段完整率
- 待复习错题打开率
- 出题功能使用率
- PDF 下载率
- 复习后标记完成率
- 同一知识点重复错误下降趋势

## 9. 风险和边界

- 未成年人数据需要谨慎处理，避免收集不必要身份信息。
- 图片上传要限制大小和格式，保留删除能力。
- AI 解析和出题需要提示“仅供学习辅助，答案请结合老师要求核对”。
- 不在 MVP 承诺替代老师诊断，也不做升学结果承诺。
