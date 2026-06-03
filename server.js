import { createServer } from "node:http";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { readFile, mkdir, appendFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomInt, randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";
import sharp from "sharp";
import {
  isDrawableVisualKind as registryIsDrawableVisualKind,
  isSupportedVisualKind as registryIsSupportedVisualKind,
  supportedTemplateValueList,
  visualGenerationGuideLines,
  visualKindMatchesRegistry,
  visualMarkerExampleText,
  visualRecognitionGuideText,
  visualTypeValueList
} from "./src/visualTemplates.js";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const isMainModule = fileURLToPath(import.meta.url) === process.argv[1];

function loadLocalEnv() {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const matched = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!matched) continue;

    const [, key, rawValue] = matched;
    if (process.env[key] !== undefined) continue;

    const value = rawValue.trim().replace(/^(['"])(.*)\1$/, "$2");
    process.env[key] = value;
  }
}

loadLocalEnv();

const dataDir = join(rootDir, "data");
const distDir = join(rootDir, "dist");
const pdfDir = join(rootDir, "output", "pdf");
const uploadDir = join(rootDir, "output", "uploads");
const historyFile = join(dataDir, "generations.jsonl");
const mistakeBookFile = join(dataDir, "mistake-book.jsonl");
const authFile = join(dataDir, "auth.jsonl");
const examPapersFile = join(dataDir, "exam-papers.jsonl");
const masteryEventsFile = join(dataDir, "mastery-events.jsonl");
function persistentRuntimeFile(filename) {
  const marker = "/releases/";
  if (rootDir.includes(marker)) {
    return join(rootDir.split(marker)[0], "shared", filename);
  }
  return join(dataDir, filename);
}
const sessionsFile = process.env.AI_EDU_SESSIONS_FILE || persistentRuntimeFile("sessions.jsonl");
const port = Number(process.env.PORT || 4173);
const mysqlConfig = {
  enabled: process.env.MYSQL_ENABLED !== "false" && Boolean(process.env.MYSQL_PASSWORD || process.env.MYSQL_URL),
  url: process.env.MYSQL_URL || "",
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE || "ai_edu",
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  tablePrefix: process.env.MYSQL_TABLE_PREFIX || "edu_"
};
const mailConfig = {
  host: process.env.SMTP_HOST || process.env.MAIL_HOST || "",
  port: Number(process.env.SMTP_PORT || process.env.MAIL_PORT || 0),
  secure: (process.env.SMTP_SECURE || process.env.MAIL_SECURE || "").toLowerCase(),
  user: process.env.SMTP_USER || process.env.MAIL_USER || "",
  pass: process.env.SMTP_PASS || process.env.MAIL_PASS || "",
  from: process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || process.env.MAIL_USER || "",
  appName: process.env.MAIL_APP_NAME || "AI 学习工作台",
  exposeDevCode: process.env.AUTH_EXPOSE_DEV_CODE !== "false" && process.env.NODE_ENV !== "production"
};
mailConfig.enabled = Boolean(mailConfig.host && mailConfig.user && mailConfig.pass);
mailConfig.port = mailConfig.port || (mailConfig.secure === "false" ? 587 : 465);
mailConfig.secure = mailConfig.secure ? mailConfig.secure !== "false" : mailConfig.port === 465;

function openAiChatEndpoint(value) {
  const endpoint = String(value || "").trim().replace(/\/$/, "");
  if (!endpoint) return "";
  if (/\/chat\/completions$/.test(endpoint)) return endpoint;
  return `${endpoint}/chat/completions`;
}

const aiConfig = {
  provider: process.env.AI_PROVIDER || "openai",
  endpoint: openAiChatEndpoint(
    process.env.AI_ENDPOINT ||
      process.env.OPENAI_API_BASE ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com/v1"
  ),
  apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "",
  model: process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
  visionModel: process.env.AI_VISION_MODEL || "gpt-4o-mini",
  enableThinking: process.env.AI_ENABLE_THINKING !== "false",
  timeoutMs: Number(process.env.AI_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || 25000),
  deepseekEndpoint: process.env.DEEPSEEK_API_ENDPOINT || "https://api.deepseek.com/chat/completions",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  deepseekThinking: process.env.DEEPSEEK_THINKING || "disabled",
  deepseekReasoningEffort: process.env.DEEPSEEK_REASONING_EFFORT || ""
};

function logInfo(message, meta = {}) {
  console.log(JSON.stringify({
    level: "info",
    time: new Date().toISOString(),
    message,
    ...meta
  }));
}

function logError(message, error, meta = {}) {
  console.error(JSON.stringify({
    level: "error",
    time: new Date().toISOString(),
    message,
    error: error?.message || String(error),
    ...meta
  }));
}

const PDF_BLANK_PLACEHOLDER = "(      )";
const pdfFontCandidates = [
  { path: "/usr/share/fonts/google-noto/NotoSansCJK-Regular.ttc", name: "NotoSansCJKsc-Regular" },
  { path: "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc", name: "NotoSansCJKsc-Regular" },
  { path: "/usr/share/fonts/google-noto-cjk/NotoSansCJKsc-Regular.otf" },
  { path: "/System/Library/Fonts/Hiragino Sans GB.ttc", name: "HiraginoSansGB-W3" },
  { path: "/System/Library/Fonts/Supplemental/Songti.ttc", name: "STSongti-SC-Regular" },
  { path: "/System/Library/Fonts/STHeiti Medium.ttc", name: "STHeitiSC-Medium" },
  { path: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", name: "NotoSansCJKsc-Regular" },
  { path: "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", name: "NotoSansCJKsc-Regular" }
];

function resolvePdfConfig() {
  if (process.env.PDF_FONT_PATH) {
    return {
      fontPath: process.env.PDF_FONT_PATH,
      fontName: process.env.PDF_FONT_NAME || ""
    };
  }

  const candidate = pdfFontCandidates.find((item) => existsSync(item.path));
  return {
    fontPath: candidate?.path || "",
    fontName: process.env.PDF_FONT_NAME || candidate?.name || ""
  };
}

const pdfConfig = resolvePdfConfig();

const tools = {
  essay: {
    icon: "文",
    title: "作文批改",
    short: "评分、诊断、修改建议",
    desc: "输入作文内容，生成评分、问题诊断和修改建议。",
    quotaCost: 1,
    offerTitle: "作文素材包",
    offerDesc: "根据批改薄弱项推荐对应素材和训练模板。",
    courseTitle: "写作提升课",
    courseDesc: "从诊断结果进入专项训练，比首页硬推更自然。",
    fields: [
      { name: "grade", label: "学段", type: "select", options: ["小学高年级", "初中", "高中", "大学 / 成人"], required: true },
      { name: "subject", label: "科目", type: "select", options: ["语文作文", "英语作文"], required: true },
      { name: "topic", label: "作文题目", placeholder: "例如：那一次，我真正理解了坚持；若图片内包含题目可简写", required: true },
      { name: "rubric", label: "批改标准", type: "select", options: ["中考标准", "高考标准", "校内作业", "雅思 / 托福思路"], required: true },
      { name: "content", label: "作文正文", type: "textarea", placeholder: "粘贴作文全文，或上传作文照片", required: true, imageAlternative: true }
    ]
  },
  mistake: {
    icon: "题",
    title: "试卷错题入库",
    short: "拍试卷、识别错题、自动入库",
    desc: "上传一张已批改试卷照片，AI 识别错题并补全题目、选项、答案和解析后入库。",
    quotaCost: 1,
    offerTitle: "高频错题包",
    offerDesc: "按年级和知识点推荐同类练习，适合考前查漏补缺。",
    courseTitle: "专项突破课",
    courseDesc: "针对错因推荐知识点小课或一对一讲解线索。",
    fields: [
      { name: "subject", label: "学科", type: "select", options: ["数学", "物理", "化学", "英语", "语文"], required: true },
      { name: "grade", label: "年级", type: "select", options: ["小学", "初一", "初二", "初三", "高一", "高二", "高三"], required: true },
      { name: "paperName", label: "试卷名称", placeholder: "例如：五下数学单元测试，可选" },
      { name: "question", label: "补充说明", type: "textarea", placeholder: "可补充老师批改符号、错题范围、页码；主要请上传试卷照片", required: true, imageAlternative: true },
      { name: "studentAnswer", label: "学生答案补充", placeholder: "看不清时可手动补充，支持多题简写" },
      { name: "correctAnswer", label: "标准答案补充", placeholder: "看不清时可手动补充，可选" }
    ]
  },
  outline: {
    icon: "纲",
    title: "PPT / 报告大纲",
    short: "结构、页标题、讲稿",
    desc: "输入主题和受众，生成 PPT 或报告的页面结构和讲稿提示。",
    quotaCost: 1,
    offerTitle: "PPT 模板包",
    offerDesc: "按汇报、课堂展示、开题答辩等场景推荐模板。",
    courseTitle: "表达汇报课",
    courseDesc: "从大纲生成结果导向表达训练和汇报优化服务。",
    fields: [
      { name: "topic", label: "主题", placeholder: "例如：人工智能在教育中的应用", required: true },
      { name: "audience", label: "受众", placeholder: "例如：老师、同学、管理层、客户", required: true },
      { name: "pages", label: "页数", type: "select", options: ["5 页", "8 页", "10 页", "15 页"], required: true },
      { name: "scenario", label: "使用场景", type: "select", options: ["课堂展示", "工作汇报", "开题答辩", "课程培训"], required: true },
      { name: "materials", label: "重点素材", type: "textarea", placeholder: "填写已有资料、观点、数据或必须出现的内容；也可上传资料截图", imageAlternative: true }
    ]
  }
};

const defaultChildId = "legacy-child";
// TODO(QUOTA-002): 上线或多人测试前恢复正式每日限额、自然日重置和次数包/会员规则。
const quotaEnforced = process.env.EDU_QUOTA_ENFORCED === "true";
let children = [];

const sessions = new Map();
const uploads = new Map();
const users = new Map();
const loginCodes = new Map();
const generations = new Map();
const mistakeRecords = new Map();
const examPapers = new Map();
const masteryEvents = [];
let dbPool = null;
let storageMode = "jsonl";

function getSession(req, res) {
  const cookie = req.headers.cookie || "";
  const matched = cookie.match(/edu_session=([^;]+)/);
  const sessionId = matched?.[1] || randomUUID();

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { id: sessionId, quotaLeft: 3, userId: "", createdAt: new Date().toISOString() });
  }

  res.setHeader("Set-Cookie", `edu_session=${sessionId}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`);

  return sessions.get(sessionId);
}

function publicQuotaLeft(session) {
  return quotaEnforced ? session.quotaLeft : "不限";
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || ""
  };
}

function publicTools() {
  return Object.fromEntries(
    Object.entries(tools).map(([slug, tool]) => [slug, { ...tool }])
  );
}

function publicChild(child) {
  if (!child) return null;
  return {
    id: child.id,
    userId: child.userId || "",
    name: child.name,
    grade: child.grade || "",
    birthYear: child.birthYear || null,
    birthMonth: child.birthMonth || null,
    role: child.role || "student",
    createdAt: child.createdAt || ""
  };
}

function childrenForUser(userId) {
  if (!userId) return [];
  return children.filter((child) => child.userId === userId);
}

function publicChildren(userId) {
  return childrenForUser(userId).map(publicChild);
}

function resolveChildId(value, userId = "") {
  const userChildren = childrenForUser(userId);
  const childId = String(value || "");
  return userChildren.some((child) => child.id === childId) ? childId : userChildren[0]?.id || "";
}

function childName(childId) {
  return children.find((child) => child.id === childId)?.name || "孩子";
}

function childSnapshot(childId) {
  return children.find((child) => child.id === childId) || null;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hashLoginCode(email, code) {
  return createHash("sha256").update(`${email}:${code}:${process.env.LOGIN_CODE_SECRET || "edu-local-secret"}`).digest("hex");
}

function createLoginCode() {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

function latestLoginCode(email) {
  return [...loginCodes.values()]
    .filter((item) => item.email === email && !item.usedAt)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
}

function requireUser(session, res) {
  const user = users.get(session.userId);
  if (!user) {
    sendJson(res, 401, { error: "请先登录" });
    return null;
  }

  return user;
}

function tableName(name) {
  const identifier = `${mysqlConfig.tablePrefix}${name}`;
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error("MYSQL_TABLE_PREFIX 只能包含字母、数字和下划线");
  }

  return `\`${identifier}\``;
}

function jsonValue(value, fallback = null) {
  if (value === undefined) return JSON.stringify(fallback);
  return JSON.stringify(value ?? fallback);
}

function parseJsonValue(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mysqlDate(value) {
  if (!value) return null;
  return new Date(value);
}

function isoDate(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function hasImageAttachment(attachment) {
  return Boolean(
    attachment &&
      typeof attachment === "object" &&
      typeof attachment.dataUrl === "string" &&
      attachment.dataUrl.startsWith("data:image/")
  );
}

function validateAttachment(attachment) {
  if (!attachment) return "";

  if (!hasImageAttachment(attachment)) {
    return "图片格式不正确";
  }

  if (Number(attachment.size || 0) > 5 * 1024 * 1024) {
    return "图片不能超过 5MB";
  }

  return "";
}

function resolveAttachment(fileId, inlineAttachment = null) {
  if (fileId) {
    return uploads.get(String(fileId)) || null;
  }

  return inlineAttachment;
}

function uploadedAttachmentMetas(fileIds = []) {
  if (!Array.isArray(fileIds)) return [];

  return fileIds
    .map((fileId) => uploads.get(String(fileId)))
    .filter(Boolean)
    .map(attachmentMeta)
    .filter(Boolean)
    .slice(0, 20);
}

function validateInput(tool, input, attachment) {
  const imageAttached = hasImageAttachment(attachment);
  const missing = tool.fields
    .filter((field) => field.required && !field.imageAlternative && !String(input[field.name] || "").trim())
    .map((field) => field.label);

  const missingImageAlternative = tool.fields
    .filter((field) => field.required && field.imageAlternative && !String(input[field.name] || "").trim() && !imageAttached)
    .map((field) => field.label);

  missing.push(...missingImageAlternative);

  if (missing.length > 0) {
    return `${missing.join("、")}不能为空`;
  }

  return "";
}

function generateTemplateOutput(toolSlug, input) {
  if (toolSlug === "essay") {
    return `总体评分：82 / 100

分项评价：
内容：主题明确，能围绕“${input.topic || "作文题目"}”展开，但例子还可以更具体。
结构：开头进入较快，中段层次需要更清楚，结尾可以回扣主题。
表达：语句基本通顺，有少量口语化表达。
规范：标点和分段建议再整理一次。

主要问题：
1. 关键事件写得偏概括，读者不容易看到画面。
2. 情绪变化有，但缺少转折点。
3. 结尾升华略急，可以用一句具体感受承接。

修改建议：
把中间段落改成“动作 + 心理 + 结果”的结构，至少补充一个细节。比如写坚持时，不只写“我没有放弃”，而是写手上的动作、当时的犹豫、最后完成后的反馈。

优化示例：
原句可以从“我很努力，最后成功了”改成“我把草稿纸翻到背面，又重新算了一遍。那一刻我才发现，坚持不是喊口号，而是在想放弃时再往前多走一步。”

推荐转化：
适合推荐「作文素材包」和「写作提升课」，因为当前问题集中在素材细节和表达层次。`;
  }

  if (toolSlug === "mistake") {
    return `考察知识点：
${input.subject || "本学科"}核心概念、题目信息提取、解题步骤完整性。

错因判断：
学生答案「${input.studentAnswer || "未填写"}」暴露的问题大概率不是单纯粗心，而是题干条件没有完全转化成可计算 / 可推理的信息。

分步讲解：
1. 先圈出题目中的已知条件和目标问题。
2. 判断它属于哪个知识点或题型。
3. 写出对应公式、规则或推理路径。
4. 把条件逐步代入，不跳步。
5. 用答案反推题目要求，检查单位、范围和表达。

同类题提醒：
下次遇到类似题目，先问自己两个问题：题目真正要求什么？哪些条件还没有被用上？

推荐转化：
适合推荐「高频错题包」和「专项突破课」，尤其适合把错因沉淀到个人错题本。`;
  }

  return `整体结构：
主题「${input.topic || "待补充主题"}」适合采用“背景 - 问题 - 方案 - 案例 - 总结”的结构，便于${input.audience || "目标受众"}快速理解。

页面大纲：
1. 封面：${input.topic || "主题名称"}
2. 背景：为什么现在需要关注这个主题
3. 现状：当前已有做法和主要痛点
4. 核心观点：最重要的 3 个判断
5. 案例 / 数据：用具体材料增强可信度
6. 方案：可以怎么落地
7. 风险与边界：哪些问题需要提前说明
8. 总结：一句话结论和下一步行动

讲稿提示：
每页只保留一个核心观点。讲述时先说结论，再补充例子，最后回到听众关心的问题。

推荐转化：
适合推荐「PPT 模板包」和「表达汇报课」，后续还可以扩展为一键生成讲稿和逐页文案。`;
}

function imageInstruction(attachment) {
  if (!hasImageAttachment(attachment)) return "";

  return `\n\n用户还上传了一张图片。请先识别图片中的题目、作文或资料内容，再结合上面的文字信息完成任务。如果文字输入和图片冲突，以图片内容为主要依据，并在输出中简短说明“已根据图片内容识别”。`;
}

function buildPrompt(toolSlug, input, attachment) {
  if (toolSlug === "essay") {
    return `请你作为专业作文批改老师，按以下信息输出结构化批改结果。

学段：${input.grade}
科目：${input.subject}
题目：${input.topic}
批改标准：${input.rubric}
作文正文：
${input.content || "见用户上传图片"}
${imageInstruction(attachment)}

请严格按以下结构输出：
总体评分：
分项评价：
主要问题：
修改建议：
优化示例：
推荐转化：

要求：中文自然、建议具体、避免夸大承诺。`;
  }

  if (toolSlug === "mistake") {
    return `请你作为错题库整理老师，识别试卷照片中的错题，并输出可入库的结构化错题。

学科：${input.subject}
年级：${input.grade}
试卷名称：${input.paperName || "未提供"}
补充说明：
${input.question || "主要依据用户上传的已批改试卷照片"}
学生答案补充：${input.studentAnswer || "未提供"}
标准答案补充：${input.correctAnswer || "未提供"}
${imageInstruction(attachment)}

补充说明范围规则：
如果补充说明中出现“本次只识别以下补充说明指定的题目”，或任意条目填写了明确的大题、小题、题号，请把这些条目当成本次识别的硬范围。
每一条补充说明内部的条件必须按交集理解：同一条里的大题、小题、页码、批改符号、图片情况和图片复杂度需要同时满足，不能按“大题或小题或批改符号任一命中”扩大范围。
多条补充说明之间才按多个指定题目范围处理。
这种情况下，mistakes 数组只能输出补充说明条目交集定位到的题目；不要输出同一张图片里的其他错题、同一大题的相邻小题或其他老师标记题。
如果指定题在图片中无法确认，可以输出该指定题并标注“需人工确认”，但不能用其他题补足数量。
只有补充说明未指定明确题号/大题/小题时，才按整张已批改试卷照片识别所有明确错题。

请只识别学生做错或被老师标记错误的题目，不要把做对的题目入库。
请严格输出 JSON，不要输出 Markdown：
{
  "summary": "本次识别概览",
  "mistakes": [
    {
      "questionNumber": "题号",
      "question": "完整题干",
      "options": ["A. ...", "B. ..."],
      "studentAnswer": "学生答案",
      "correctAnswer": "正确答案",
      "analysis": "解析，包含关键步骤和为什么错",
      "visualType": "${visualTypeValueList()}",
      "visualComplexity": "none/simple_template/complex_image",
      "visualRenderStrategy": "none/template/source_crop",
      "supportedTemplate": "${supportedTemplateValueList()}",
      "needsCrop": true,
      "visualConfidence": 0.8,
      "visualDescription": "如果题目依赖图片，请详细描述图片内容；没有图片则填空字符串",
      "visualMarker": "可选。若能结构化，请输出 ${visualMarkerExampleText()}",
      "imageRegion": { "x": 0.1, "y": 0.2, "width": 0.8, "height": 0.18, "unit": "ratio" },
      "knowledgePoints": ["知识点1"],
      "wrongReasons": ["审题错误"],
      "questionType": "选择题/填空题/解答题/阅读理解等",
      "difficulty": "简单/中等/困难",
      "tags": ["试卷错题"]
    }
  ]
}

要求：
1. 题干、选项、解析尽量补全；图片看不清时在对应字段写“图片不清，需人工确认”，但仍保留可识别信息。
2. 对依赖图片才能作答的题，必须填写 visualType、visualComplexity、visualRenderStrategy、supportedTemplate、needsCrop、visualConfidence、visualDescription，并尽量给出 visualMarker。
3. visualComplexity 规则：纯文字题写 none；钟面、纸条重叠、杯子叠放等可程序稳定绘制的题写 simple_template；三角板复杂拼接、多角标、遮挡、依赖相对位置的图写 complex_image。visualRenderStrategy 对应写 none/template/source_crop。
4. 专项模板识别规则：${visualRecognitionGuideText()}
5. 当前优先服务数学错题。数学图形题请尽量输出 imageRegion，使用 0 到 1 的相对坐标描述这道错题在整张试卷图中的区域；区域不确定时可以省略或写 null，用户会人工调整截图。
6. 解析要简洁确定，不要输出反复猜测、自我纠正或大段犹豫；如果无法确认，直接写“需人工确认”。`;
  }

  return `请你作为课程展示和汇报大纲顾问，按以下信息输出 PPT / 报告大纲。

主题：${input.topic}
受众：${input.audience}
页数：${input.pages}
使用场景：${input.scenario}
重点素材：
${input.materials || "未提供"}
${imageInstruction(attachment)}

请严格按以下结构输出：
整体结构：
页面大纲：
讲稿提示：
推荐转化：

要求：每页标题明确，每页要点可直接用于制作 PPT。`;
}

function parseSseContent(rawText) {
  let content = "";

  for (const line of rawText.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;

    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;

    try {
      const payload = JSON.parse(data);
      const delta = payload.choices?.[0]?.delta || {};
      if (typeof delta.content === "string") {
        content += delta.content;
      }
    } catch {
      // Ignore malformed SSE lines from intermediary gateways.
    }
  }

  return content.trim();
}

function parseModelContent(rawText) {
  const streamed = parseSseContent(rawText);
  if (streamed) return streamed;

  try {
    const payload = JSON.parse(rawText);
    return String(payload.choices?.[0]?.message?.content || payload.output_text || "").trim();
  } catch {
    return "";
  }
}

function buildUserContent(toolSlug, input, attachment) {
  const text = buildPrompt(toolSlug, input, attachment);

  if (!hasImageAttachment(attachment)) {
    return text;
  }

  return [
    { type: "text", text },
    {
      type: "image_url",
      image_url: {
        url: attachment.dataUrl
      }
    }
  ];
}

function attachmentMeta(attachment) {
  if (!hasImageAttachment(attachment)) return null;
  const meta = {
    id: String(attachment.id || ""),
    name: String(attachment.name || "uploaded-image"),
    type: String(attachment.type || "image"),
    size: Number(attachment.size || 0),
    url: String(attachment.url || "")
  };
  if (attachment.enhanced?.url) {
    meta.enhanced = {
      id: String(attachment.enhanced.id || ""),
      name: String(attachment.enhanced.name || "enhanced-image.png"),
      type: String(attachment.enhanced.type || "image/png"),
      size: Number(attachment.enhanced.size || 0),
      url: String(attachment.enhanced.url || "")
    };
  }
  return meta;
}

function uploadExtension(type = "") {
  if (/png/i.test(type)) return ".png";
  if (/webp/i.test(type)) return ".webp";
  if (/gif/i.test(type)) return ".gif";
  return ".jpg";
}

function decodeImageDataUrl(dataUrl = "") {
  const matched = String(dataUrl).match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([\s\S]+)$/);
  if (!matched) return null;
  return {
    type: matched[1],
    buffer: Buffer.from(matched[2], "base64")
  };
}

async function createEnhancedQuestionImage(buffer, fileId) {
  try {
    const enhancedFilename = `${fileId}-clean.png`;
    const enhancedPath = join(uploadDir, enhancedFilename);
    // 拍照/扫描的纸张通常背景是 RGB(190~220) 的浅灰；这套管线把背景推到接近纯白、墨迹保持深色。
    // 关键步骤：
    //   linear(a, b)：output = a*input + b，a=1.6 提高对比度，b=-60 让浅灰背景超过 255 截断为白。
    //   gamma(0.95)：略提亮中间调。
    //   modulate saturation=0.45：降饱和，避免泛黄/泛灰。
    //   sharpen：边缘锐化保留字迹。
    const enhancedBuffer = await sharp(buffer)
      .rotate()
      .flatten({ background: "#ffffff" })
      .trim({ background: "#ffffff", threshold: 18 })
      .normalize()
      .linear(1.6, -60)
      .modulate({ brightness: 1.08, saturation: 0.45 })
      .sharpen({ sigma: 0.8, m1: 0.9, m2: 1.4 })
      .png({ compressionLevel: 8, adaptiveFiltering: true })
      .toBuffer();

    await writeFile(enhancedPath, enhancedBuffer);
    return {
      id: `${fileId}-clean`,
      name: "题图白底增强版.png",
      type: "image/png",
      size: enhancedBuffer.length,
      url: `/output/uploads/${enhancedFilename}`,
      filename: enhancedFilename
    };
  } catch (error) {
    logError("upload.enhance.failed", error, { fileId });
    return null;
  }
}

function requireImageModel(attachment) {
  if (!hasImageAttachment(attachment) || aiConfig.apiKey) return "";

  return "图片识别需要配置 AI_API_KEY 后调用视觉模型。当前未配置视觉模型密钥，无法根据照片识别答题内容。";
}

async function callModelMessages(messages, model = aiConfig.model) {
  const startedAt = Date.now();
  const controller = aiConfig.timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), aiConfig.timeoutMs) : null;
  logInfo("model.request.start", {
    provider: aiConfig.provider,
    model,
    endpoint: aiConfig.endpoint,
    timeoutMs: aiConfig.timeoutMs || "disabled",
    messageCount: messages.length
  });

  try {
    const response = await fetch(aiConfig.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${aiConfig.apiKey}`
      },
      signal: controller?.signal,
      body: JSON.stringify({
        stream: true,
        model,
        enable_thinking: aiConfig.enableThinking,
        messages
      })
    });

    const rawText = await response.text();
    logInfo("model.request.end", {
      provider: aiConfig.provider,
      model,
      status: response.status,
      durationMs: Date.now() - startedAt,
      responseChars: rawText.length
    });

    if (!response.ok) {
      throw new Error(`模型接口调用失败：${response.status} ${rawText.slice(0, 160)}`);
    }

    const output = parseModelContent(rawText);
    if (!output) {
      throw new Error("模型接口没有返回可展示内容");
    }

    return output;
  } catch (error) {
    const message = error?.name === "AbortError"
      ? `模型接口调用超时：${Math.round(aiConfig.timeoutMs / 1000)} 秒内没有返回`
      : error.message;
    const normalized = new Error(message);
    logError("model.request.failed", normalized, {
      provider: aiConfig.provider,
      model,
      durationMs: Date.now() - startedAt
    });
    throw normalized;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callYmcasModel(toolSlug, input, attachment) {
  const model = hasImageAttachment(attachment) ? aiConfig.visionModel : aiConfig.model;

  return callModelMessages([
    {
      role: "system",
      content: "你是一个面向教育学习场景的 AI 助手。只输出最终答案，不输出思考过程。"
    },
    {
      role: "user",
      content: buildUserContent(toolSlug, input, attachment)
    }
  ], model);
}

async function callDeepseekModel(toolSlug, input) {
  if (!aiConfig.deepseekApiKey) {
    throw new Error("DeepSeek 调用需要配置 DEEPSEEK_API_KEY。当前未配置 DeepSeek 密钥。");
  }

  const body = {
    stream: false,
    model: aiConfig.deepseekModel,
    messages: [
      {
        role: "system",
        content: "你是一个面向教育学习场景的 AI 助手。只输出最终答案，不输出思考过程。"
      },
      {
        role: "user",
        content: buildPrompt(toolSlug, input, null)
      }
    ]
  };

  if (aiConfig.deepseekThinking) {
    body.thinking = { type: aiConfig.deepseekThinking };
  }

  if (aiConfig.deepseekReasoningEffort) {
    body.reasoning_effort = aiConfig.deepseekReasoningEffort;
  }

  const response = await fetch(aiConfig.deepseekEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${aiConfig.deepseekApiKey}`
    },
    body: JSON.stringify(body)
  });

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(`DeepSeek 接口调用失败：${response.status} ${rawText.slice(0, 160)}`);
  }

  let payload = null;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new Error("DeepSeek 接口返回不是合法 JSON");
  }

  const output = payload.choices?.[0]?.message?.content;
  if (typeof output !== "string" || !output.trim()) {
    throw new Error("DeepSeek 接口没有返回可展示内容");
  }

  return output.trim();
}

async function callTextModel(toolSlug, input, attachment) {
  if (hasImageAttachment(attachment)) {
    return {
      output: await callYmcasModel(toolSlug, input, attachment),
      model: aiConfig.visionModel
    };
  }

  if (aiConfig.provider === "deepseek") {
    return {
      output: await callDeepseekModel(toolSlug, input),
      model: aiConfig.deepseekModel
    };
  }

  return {
    output: await callYmcasModel(toolSlug, input, attachment),
    model: aiConfig.model
  };
}

function extractJsonPayload(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || raw;
  const candidates = [candidate];
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(candidate.slice(start, end + 1));
  }

  for (const item of candidates) {
    try {
      return JSON.parse(item);
    } catch {
      try {
        return JSON.parse(repairJsonStringLiterals(item));
      } catch {
        // Try the next candidate.
      }
    }
  }

  return null;
}

function repairJsonStringLiterals(value) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (const char of String(value || "")) {
    if (!inString) {
      output += char;
      if (char === "\"") inString = true;
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }

    if (char === "\"") {
      output += char;
      inString = false;
      continue;
    }

    if (char === "\n") output += "\\n";
    else if (char === "\r") output += "\\r";
    else if (char === "\t") output += "\\t";
    else output += char;
  }

  return output;
}

function toCleanString(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function toStringArray(value, limit = 8) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const label = item.label || item.key || item.option || "";
          const text = item.text || item.content || item.value || "";
          return [label, text].filter(Boolean).join(". ");
        }
        return String(item ?? "");
      })
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, limit);
  }

  return String(value || "")
    .split(/[、，,；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeDifficulty(value) {
  const text = toCleanString(value);
  if (["简单", "中等", "困难"].includes(text)) return text;
  if (/难|高/.test(text)) return "困难";
  if (/易|低|简单/.test(text)) return "简单";
  return text || "中等";
}

function normalizeMasteryStatus(value, fallback = "待复习") {
  const text = toCleanString(value, fallback);
  if (["待复习", "复习中", "已掌握", "已归档"].includes(text)) return text;
  if (/掌握|完成/.test(text)) return "已掌握";
  if (/归档|隐藏/.test(text)) return "已归档";
  if (/复习中|练习中/.test(text)) return "复习中";
  return "待复习";
}

function normalizeVisualType(value) {
  const text = toCleanString(value).toLowerCase();
  if (new Set([...visualTypeValueList().split("/"), "source_image", "original_crop"]).has(text)) return text;
  if (/钟面|分针|点钟|钟表|clock/.test(text)) return "clock";
  if (/原图|截图|照片|source|crop/.test(text)) return "source_image";
  if (/三角板.*(?:组合|拼成|拼接)|triangle.*composition/.test(text)) return "triangle_board_composition";
  if (/三角板|角/.test(text)) return "triangle_board";
  if (/黑白|瓷砖|方块|方格|正方形/.test(text)) return "tile_pattern";
  if (/纸条|重叠|粘贴|overlap/.test(text)) return "overlap_rect";
  if (/杯子/.test(text) && /叠|高度|高/.test(text)) return "stack_cups";
  if (/长方形.*ABCD|点P|路径|沿.*边|rect_path/.test(text)) return "rect_path";
  if (/规律|序列|气球|颜色/.test(text)) return "pattern";
  if (/图|几何/.test(text)) return "geometry";
  return "";
}

function normalizeImageRegion(value) {
  if (!value) return null;
  let region = value;
  if (Array.isArray(value)) {
    region = { x: value[0], y: value[1], width: value[2], height: value[3] };
  }
  if (!region || typeof region !== "object") return null;

  const x = Number(region.x ?? region.left ?? region.l);
  const y = Number(region.y ?? region.top ?? region.t);
  const width = Number(region.width ?? region.w);
  const height = Number(region.height ?? region.h);
  if (![x, y, width, height].every(Number.isFinite)) return null;

  const clampedX = Math.max(0, Math.min(0.98, x));
  const clampedY = Math.max(0, Math.min(0.98, y));
  const clampedWidth = Math.max(0.02, Math.min(1 - clampedX, width));
  const clampedHeight = Math.max(0.02, Math.min(1 - clampedY, height));

  return {
    x: Number(clampedX.toFixed(4)),
    y: Number(clampedY.toFixed(4)),
    width: Number(clampedWidth.toFixed(4)),
    height: Number(clampedHeight.toFixed(4)),
    unit: "ratio"
  };
}

function compactAttachmentMeta(value) {
  if (!value || typeof value !== "object") return null;
  const file = value.file && typeof value.file === "object" ? value.file : value;
  const url = toCleanString(file.url);
  if (!url) return null;
  const meta = {
    id: toCleanString(file.id),
    name: toCleanString(file.name, "uploaded-image"),
    type: toCleanString(file.type, "image"),
    size: Number(file.size || 0),
    url
  };
  const enhanced = compactAttachmentMeta(file.enhanced);
  if (enhanced) meta.enhanced = enhanced;
  return meta;
}

function buildMistakeSourceAttachment(generationAttachment, mistakeAttachment, imageRegion) {
  const original = compactAttachmentMeta(mistakeAttachment?.original) || compactAttachmentMeta(generationAttachment);
  const crop = compactAttachmentMeta(mistakeAttachment?.crop) || compactAttachmentMeta(mistakeAttachment);
  const enhanced = compactAttachmentMeta(mistakeAttachment?.enhanced || mistakeAttachment?.crop?.enhanced || crop?.enhanced);
  const region = normalizeImageRegion(mistakeAttachment?.region || imageRegion);

  if (crop) {
    return {
      ...crop,
      kind: "mistake_crop",
      enhanced,
      crop: enhanced ? { ...crop, enhanced } : crop,
      original,
      region
    };
  }

  if (original) {
    return {
      ...original,
      kind: "original_paper",
      original,
      region
    };
  }

  return null;
}

function normalizeVisualComplexity(value = "") {
  const text = toCleanString(value).toLowerCase();
  if (["none", "simple_template", "complex_image"].includes(text)) return text;
  if (/复杂|complex|原图|截图|crop|image/.test(text)) return "complex_image";
  if (/模板|template|简单|simple/.test(text)) return "simple_template";
  return "";
}

function normalizeVisualRenderStrategy(value = "") {
  const text = toCleanString(value).toLowerCase();
  if (["none", "template", "source_crop"].includes(text)) return text;
  if (/原图|截图|crop|image|source/.test(text)) return "source_crop";
  if (/模板|template/.test(text)) return "template";
  return "";
}

function normalizeSupportedTemplate(value = "") {
  const text = normalizeVisualType(value);
  return isDrawableVisualKind(text) ? text : "none";
}

function visualPolicyFromText(source = "", visualType = "", marker = "") {
  const text = String(source || "");
  const markerVisual = parseVisualLine(marker || "");
  const template = normalizeSupportedTemplate(markerVisual?.kind || visualType || visualLineForText(text)?.match(/^\[图:([a-z_]+)/)?.[1] || "");

  if (!questionNeedsVisual(text) && template === "none" && !/图形|图中|如下图|如图|下图/.test(text)) {
    return {
      visualComplexity: "none",
      visualRenderStrategy: "none",
      supportedTemplate: "none",
      needsCrop: false,
      visualConfidence: 0.9
    };
  }

  if (template !== "none" && visualKindMatchesSource(template, text)) {
    return {
      visualComplexity: "simple_template",
      visualRenderStrategy: "template",
      supportedTemplate: template,
      needsCrop: false,
      visualConfidence: 0.82
    };
  }

  if (/如图|下图|图中|图形|三角板|拼成|拼接|摆放|组合|阴影|圆点|遮挡|重叠/.test(text) || ["geometry", "other", "source_image"].includes(String(visualType || "").toLowerCase())) {
    return {
      visualComplexity: "complex_image",
      visualRenderStrategy: "source_crop",
      supportedTemplate: "none",
      needsCrop: true,
      visualConfidence: 0.76
    };
  }

  return {
    visualComplexity: "none",
    visualRenderStrategy: "none",
    supportedTemplate: "none",
    needsCrop: false,
    visualConfidence: 0.72
  };
}

function normalizeVisualPolicy(item = {}, source = "", visualType = "", marker = "") {
  const inferred = visualPolicyFromText(source, visualType, marker);
  let visualComplexity = normalizeVisualComplexity(item.visualComplexity || item.visual_complexity) || inferred.visualComplexity;
  let supportedTemplate = normalizeSupportedTemplate(item.supportedTemplate || item.supported_template || inferred.supportedTemplate);
  let visualRenderStrategy = normalizeVisualRenderStrategy(item.visualRenderStrategy || item.visual_render_strategy) || (
    visualComplexity === "simple_template" && supportedTemplate !== "none" ? "template" :
      visualComplexity === "complex_image" ? "source_crop" :
        "none"
  );
  if (isComplexTriangleBoardText(source) && !isSafeTriangleBoardCompositionText(source) && !isTriangleBoardOverlapText(source)) {
    visualComplexity = "complex_image";
    visualRenderStrategy = "source_crop";
    supportedTemplate = "none";
  }
  if (isTriangleBoardOverlapText(source)) {
    visualComplexity = "simple_template";
    visualRenderStrategy = "template";
    supportedTemplate = "triangle_board_overlap";
  }
  if (supportedTemplate !== "none" && !visualKindMatchesSource(supportedTemplate, source)) {
    visualComplexity = "complex_image";
    visualRenderStrategy = "source_crop";
    supportedTemplate = "none";
  }
  const rawNeedsCrop = item.needsCrop ?? item.needs_crop;
  const needsCrop = typeof rawNeedsCrop === "boolean" ? rawNeedsCrop : visualRenderStrategy === "source_crop";
  const rawConfidence = Number(item.visualConfidence ?? item.visual_confidence ?? inferred.visualConfidence);
  const visualConfidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : inferred.visualConfidence;

  return {
    visualComplexity,
    visualRenderStrategy,
    supportedTemplate,
    needsCrop,
    visualConfidence: Number(visualConfidence.toFixed(2))
  };
}

function inferVisualFields(item, question, analysis, knowledgePoints = []) {
  const source = [
    question,
    item.correctAnswer || item.correct_answer || item.answer || "",
    item.studentAnswer || item.student_answer || "",
    item.visualDescription || item.visual_description || item.imageDescription || item.figureDescription || "",
    ...(knowledgePoints || [])
  ].join("\n");
  const visualType = normalizeVisualType(item.visualType || item.visual_type || item.imageType || item.figureType);
  const visualDescription = toCleanString(
    item.visualDescription ||
      item.visual_description ||
      item.imageDescription ||
      item.figureDescription ||
      item.diagramDescription ||
      item.pictureDescription
  );
  const explicitMarker = toCleanString(item.visualMarker || item.visual_marker || item.figureMarker || item.diagramMarker);
  const inferredMarker = normalizeVisualMarker(explicitMarker, source) || visualLineForText(source);
  const inferredType = visualType || (inferredMarker ? parseVisualLine(inferredMarker)?.kind : "");
  const normalizedType = isSupportedVisualKind(inferredType) ? inferredType : (visualType || "");
  const policy = normalizeVisualPolicy(item, source, normalizedType, inferredMarker);

  return {
    visualType: normalizedType,
    ...policy,
    visualDescription: visualDescription || (inferredMarker ? visualDescriptionFromMarker(inferredMarker) : ""),
    visualMarker: inferredMarker
  };
}

function normalizeVisualMarker(marker = "", source = "") {
  const visual = parseVisualLine(marker);
  if (!visual) return "";
  const sourceText = String(source || "");

  if (visual.kind === "source_image" || visual.kind === "original_crop") {
    const url = toCleanString(visual.attrs.url || visual.attrs.src || visual.attrs.href);
    return url ? `[图:source_image url=${url}]` : "";
  }

  if (visual.kind === "triangle_board") {
    if (!visualKindMatchesSource("triangle_board", sourceText)) return "";
    if (visual.attrs.angles) return `[图:triangle_board angles=${visual.attrs.angles}]`;
    const angleAttrs = Object.entries(visual.attrs)
      .filter(([key]) => /^fig\d+_angle$/i.test(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => String(value).match(/\d{1,3}/)?.[0])
      .filter(Boolean);
    const angles = angleAttrs.length ? angleAttrs : extractAnglesFromText(source);
    return `[图:triangle_board angles=${(angles.length ? angles : [75, 135, 150]).join(",")}]`;
  }

  if (visual.kind === "triangle_board_composition") {
    if (!visualKindMatchesSource("triangle_board_composition", sourceText)) return "";
    const attrs = triangleBoardCompositionAttrs({}, sourceText);
    return `[图:triangle_board_composition angles=${attrs.angles.join(",")} relations=${attrs.relations.join(",")} labels=${attrs.labels.join(",")}]`;
  }

  if (visual.kind === "triangle_board_overlap") {
    if (!visualKindMatchesSource("triangle_board_overlap", sourceText)) return "";
    const attrs = triangleBoardOverlapAttrs(visual.attrs, sourceText);
    return `[图:triangle_board_overlap aod=${attrs.aod} labels=${attrs.labels.join(",")} kind1=${attrs.kind1} kind2=${attrs.kind2}]`;
  }

  if (visual.kind === "pattern") {
    if (!visualKindMatchesSource("pattern", sourceText)) return "";
    const sequence = String(visual.attrs.sequence || "");
    if (!sequence || !/^[红蓝绿黄紫橙,，\s]+$/.test(sequence)) return visualLineForText(sourceText);
    return `[图:pattern sequence=${sequence}]`;
  }

  if (visual.kind === "overlap_rect") {
    if (!visualKindMatchesSource("overlap_rect", sourceText)) return "";
    const attrs = overlapRectAttrs(visual.attrs, sourceText);
    return `[图:overlap_rect count=${attrs.count} length=${attrs.length} width=${attrs.width} overlap=${attrs.overlap}]`;
  }

  if (visual.kind === "tile_pattern") {
    if (!visualKindMatchesSource("tile_pattern", sourceText)) return "";
    const attrs = tilePatternAttrs(visual.attrs, sourceText);
    return `[图:tile_pattern black=${attrs.black.join(",")} rows=${attrs.rows}]`;
  }

  if (visual.kind === "stack_cups") {
    if (!visualKindMatchesSource("stack_cups", sourceText)) return "";
    const attrs = stackCupsAttrs(visual.attrs, sourceText);
    return `[图:stack_cups count=${attrs.count} first_height=${attrs.firstHeight} step=${attrs.step}]`;
  }

  if (visual.kind === "rect_path") {
    if (!visualKindMatchesSource("rect_path", sourceText)) return "";
    const attrs = rectPathAttrs(visual.attrs, sourceText);
    return `[图:rect_path width=${attrs.width} height=${attrs.height} path=${attrs.path}]`;
  }

  if (visual.kind === "clock") {
    if (!visualKindMatchesSource("clock", sourceText)) return "";
    return `[图:clock hour=${visual.attrs.hour || 5} minute=${visual.attrs.minute || 0}${visual.attrs.angle ? ` angle=${visual.attrs.angle}` : ""}]`;
  }

  return "";
}

function extractAnglesFromText(text = "") {
  const exact = [...String(text).matchAll(/∠\d\s*[=＝]\s*(\d{1,3})/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value <= 180)
    .slice(0, 3);
  if (exact.length) return exact;

  return [...String(text).matchAll(/(\d{1,3})\s*°/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value <= 180)
    .slice(0, 3);
}

function overlapRectAttrs(attrs = {}, source = "") {
  const text = String(source || "");
  const numbers = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1])).filter(Number.isFinite);
  const countFromText = Number(
    text.match(/(?:将|把|粘贴|贴|当粘贴|共|共有)?\s*(\d+)\s*张(?:这样的|相同的|完全相同的|长|宽|纸条|纸带|长方形|矩形)?/)?.[1]
  );
  const lengthFromText = Number(text.match(/长(?:为)?\s*(\d+(?:\.\d+)?)\s*(?:厘米|cm|米|m)/)?.[1]);
  const widthFromText = Number(text.match(/宽(?:为)?\s*(\d+(?:\.\d+)?)\s*(?:厘米|cm|米|m)/)?.[1]);
  const overlapFromText = Number(text.match(/重叠(?:部分)?(?:长|宽)?(?:为)?\s*(\d+(?:\.\d+)?)\s*(?:厘米|cm|米|m)/)?.[1]);

  return {
    count: clampNumber(Number(attrs.count || attrs.n || countFromText || numbers[3] || 5), 2, 10),
    length: clampNumber(Number(attrs.length || attrs.len || lengthFromText || numbers[0] || 20), 1, 999),
    width: clampNumber(Number(attrs.width || attrs.w || widthFromText || numbers[1] || 10), 1, 999),
    overlap: clampNumber(Number(attrs.overlap || attrs.o || overlapFromText || numbers[2] || 2), 0, 999)
  };
}

function tilePatternAttrs(attrs = {}, source = "") {
  const text = String(source || "");
  const listed = String(attrs.black || attrs.counts || "")
    .split(/[,，]/)
    .map((item) => Number(item))
    .filter(Number.isFinite)
    .slice(0, 5);
  const blackCounts = listed.length
    ? listed
    : [...text.matchAll(/第?\s*\d+\s*个图形中有\s*(\d+)\s*块?黑/g)].map((match) => Number(match[1])).filter(Number.isFinite).slice(0, 5);
  const fallbackCounts = blackCounts.length >= 2 ? blackCounts : [4, 6, 8];
  return {
    black: fallbackCounts.map((item) => clampNumber(item, 1, 99)),
    rows: clampNumber(Number(attrs.rows || text.match(/(\d+)\s*行/)?.[1] || 2), 1, 6)
  };
}

function stackCupsAttrs(attrs = {}, source = "") {
  const text = String(source || "");
  const pairs = [...text.matchAll(/(\d+)\s*个杯子[^，。；;]*?(?:高|高度|叠起来高|叠起来).*?(\d+(?:\.\d+)?)/g)]
    .map((match) => ({ count: Number(match[1]), height: Number(match[2]) }))
    .filter((item) => Number.isFinite(item.count) && Number.isFinite(item.height))
    .slice(0, 3);
  const first = pairs[0] || { count: Number(attrs.count || 5), height: Number(attrs.first_height || attrs.firstHeight || 16) };
  const second = pairs[1];
  const step = Number(attrs.step || (second ? (second.height - first.height) / Math.max(1, second.count - first.count) : 3));
  return {
    count: clampNumber(Number(attrs.count || second?.count || first.count || 5), 2, 10),
    firstHeight: clampNumber(Number(attrs.first_height || attrs.firstHeight || first.height || 16), 1, 999),
    step: clampNumber(step, 0.5, 999)
  };
}

function rectPathAttrs(attrs = {}, source = "") {
  const text = String(source || "");
  const width = Number(attrs.width || attrs.w || text.match(/AB\s*=\s*(\d+(?:\.\d+)?)/)?.[1] || text.match(/长(?:为)?\s*(\d+(?:\.\d+)?)/)?.[1] || 15);
  const height = Number(attrs.height || attrs.h || text.match(/BC\s*=\s*(\d+(?:\.\d+)?)/)?.[1] || text.match(/宽(?:为)?\s*(\d+(?:\.\d+)?)/)?.[1] || 10);
  const path = toCleanString(attrs.path || text.match(/([A-D](?:\s*[→>-]\s*[A-D]){2,})/)?.[1] || "A-D-C-B")
    .replace(/\s+/g, "")
    .replace(/[→>]/g, "-");
  return {
    width: clampNumber(width, 1, 999),
    height: clampNumber(height, 1, 999),
    path
  };
}

function triangleBoardCompositionAttrs(attrs = {}, source = "") {
  const text = String(source || "");
  const explicitAngles = String(attrs.angles || "")
    .split(/[,，]/)
    .map((item) => Number(String(item).match(/\d{1,3}/)?.[0]))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 180)
    .slice(0, 3);
  const inferredAngles = inferTriangleBoardCompositionAngles(text);
  const angles = explicitAngles.length ? explicitAngles : inferredAngles;
  const normalizedAngles = (angles.length ? angles : [105, 135, 15]).slice(0, 3);
  const relations = String(attrs.relations || "")
    .split(/[,，]/)
    .map((item) => toCleanString(item))
    .filter(Boolean)
    .slice(0, 3);
  const inferredRelations = inferTriangleBoardCompositionRelations(text, normalizedAngles);
  const labels = String(attrs.labels || "")
    .split(/[,，]/)
    .map((item) => toCleanString(item).replace(/^∠/, ""))
    .filter(Boolean)
    .slice(0, 3);
  return {
    angles: normalizedAngles,
    relations: (relations.length ? relations : (inferredRelations.length ? inferredRelations : ["60+45", "180-45", "45-30"])).slice(0, normalizedAngles.length),
    labels: (labels.length ? labels : ["1", "2", "3"]).slice(0, normalizedAngles.length)
  };
}

function inferTriangleBoardCompositionAngles(text = "") {
  const value = stripBoardDescriptors(text);
  const rawText = String(text || "");
  const allowed = new Set([30, 45, 60, 90]);
  const angles = [];
  const combine = /(\d{1,3})\s*°[^0-9°]{0,16}(?:和|与|加|[+＋]|拼|连同|相加)[^0-9°]{0,16}(\d{1,3})\s*°/.exec(value);
  const subtract = /(\d{1,3})\s*°[^0-9°]{0,16}(?:减去?|差|[-－])[^0-9°]{0,16}(\d{1,3})\s*°/.exec(value);
  const bigSmall = /大角\s*(?:为|是|=)?\s*(\d{1,3})\s*°[\s\S]{0,40}?小角\s*(?:为|是|=)?\s*(\d{1,3})\s*°[\s\S]{0,40}?(?:差|差角|差是|相差)/.exec(value);
  if (combine && allowed.has(Number(combine[1])) && allowed.has(Number(combine[2]))) {
    angles.push(Number(combine[1]) + Number(combine[2]));
  }
  if (subtract && allowed.has(Number(subtract[1])) && allowed.has(Number(subtract[2]))) {
    angles.push(Math.abs(Number(subtract[1]) - Number(subtract[2])));
  }
  if (bigSmall && allowed.has(Number(bigSmall[1])) && allowed.has(Number(bigSmall[2]))) {
    angles.push(Math.abs(Number(bigSmall[1]) - Number(bigSmall[2])));
  }
  if (/(?:平角|180\s*°?).*(?:减|差|[-－])\s*45\s*°?/.test(value)) angles.push(135);
  if (/最小锐角|含\s*30\s*°?\s*角.*最小/.test(value)) angles.push(30);
  if (!angles.length) {
    // 兜底：宽松规则
    const nums = [...value.matchAll(/(\d{1,3})\s*°/g)].map((m) => Number(m[1])).filter((n) => allowed.has(n));
    const uniq = [...new Set(nums)];
    if (uniq.length >= 2) {
      const hasSubKw = /(?:差|减去?|相减|之差|相差)/.test(rawText);
      const hasAddKw = /(?:和|加|拼接|拼成|相加|拼出|组成|合起来)/.test(rawText);
      if (hasSubKw) angles.push(Math.abs(uniq[0] - uniq[1]));
      else if (hasAddKw) angles.push(uniq[0] + uniq[1]);
    }
  }
  if (angles.length) return [...new Set(angles)].slice(0, 3);
  const exact = [...value.matchAll(/∠\d\s*[=＝]\s*(\d{1,3})/g)]
    .map((match) => Number(match[1]))
    .filter((angle) => angle > 0 && angle <= 180);
  return exact.slice(0, 3);
}

function inferTriangleBoardCompositionRelations(text = "", angles = []) {
  const value = stripBoardDescriptors(text);
  const rawText = String(text || "");
  const allowed = new Set([30, 45, 60, 90]);
  const relations = [];
  const combine = /(\d{1,3})\s*°[^0-9°]{0,16}(?:和|与|加|[+＋]|拼|连同|相加)[^0-9°]{0,16}(\d{1,3})\s*°/.exec(value);
  const subtract = /(\d{1,3})\s*°[^0-9°]{0,16}(?:减去?|差|[-－])[^0-9°]{0,16}(\d{1,3})\s*°/.exec(value);
  const bigSmall = /大角\s*(?:为|是|=)?\s*(\d{1,3})\s*°[\s\S]{0,40}?小角\s*(?:为|是|=)?\s*(\d{1,3})\s*°[\s\S]{0,40}?(?:差|差角|差是|相差)/.exec(value);
  if (combine && allowed.has(Number(combine[1])) && allowed.has(Number(combine[2]))) {
    relations.push(`${combine[1]}+${combine[2]}`);
  }
  if (subtract && allowed.has(Number(subtract[1])) && allowed.has(Number(subtract[2]))) {
    relations.push(`${subtract[1]}-${subtract[2]}`);
  }
  if (bigSmall && allowed.has(Number(bigSmall[1])) && allowed.has(Number(bigSmall[2]))) {
    relations.push(`${bigSmall[1]}-${bigSmall[2]}`);
  }
  if (/(?:平角|180\s*°?).*(?:减|差|[-－])\s*45\s*°?/.test(value)) relations.push("180-45");
  if (/最小锐角|含\s*30\s*°?\s*角.*最小/.test(value)) relations.push("30");
  if (!relations.length) {
    const nums = [...value.matchAll(/(\d{1,3})\s*°/g)].map((m) => Number(m[1])).filter((n) => allowed.has(n));
    const uniq = [...new Set(nums)];
    if (uniq.length >= 2) {
      const hasSubKw = /(?:差|减去?|相减|之差|相差)/.test(rawText);
      const hasAddKw = /(?:和|加|拼接|拼成|相加|拼出|组成|合起来)/.test(rawText);
      const big = Math.max(uniq[0], uniq[1]);
      const small = Math.min(uniq[0], uniq[1]);
      if (hasSubKw) relations.push(`${big}-${small}`);
      else if (hasAddKw) relations.push(`${uniq[0]}+${uniq[1]}`);
    }
  }
  if (relations.length) return [...new Set(relations)].slice(0, 3);
  return angles.length === 1 ? [String(angles[0])] : [];
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function visualDescriptionFromMarker(marker = "") {
  const visual = parseVisualLine(marker);
  if (!visual) return "";
  if (visual.kind === "clock") return `钟面图：${visual.attrs.hour || "?"} 时 ${visual.attrs.minute || 0} 分，夹角标注 ${visual.attrs.angle || "待确认"}°。`;
  if (visual.kind === "triangle_board") return `三角板拼角图：角度标注为 ${String(visual.attrs.angles || "").replace(/,/g, "、")}°。`;
  if (visual.kind === "triangle_board_composition") return `三角板组合角图：角度 ${String(visual.attrs.angles || "").replace(/,/g, "、")}°，关系 ${String(visual.attrs.relations || "").replace(/,/g, "、")}。`;
  if (visual.kind === "triangle_board_overlap") return `两块三角板共直角顶点图：外角 ∠${String(visual.attrs.labels || "A,B,C,D").split(",")[0] || "A"}O${String(visual.attrs.labels || "A,B,C,D").split(",")[3] || "D"}=${visual.attrs.aod || "?"}°，重叠角 ∠${String(visual.attrs.labels || "A,B,C,D").split(",")[1] || "B"}O${String(visual.attrs.labels || "A,B,C,D").split(",")[2] || "C"}。`;
  if (visual.kind === "pattern") return `规律图：序列为 ${String(visual.attrs.sequence || "").replace(/,/g, "、")}。`;
  if (visual.kind === "tile_pattern") return `黑白瓷砖规律图：黑砖数量 ${String(visual.attrs.black || "").replace(/,/g, "、")}。`;
  if (visual.kind === "overlap_rect") return `长方形纸条重叠图：${visual.attrs.count || "?"} 张纸条，每张长 ${visual.attrs.length || "?"}、宽 ${visual.attrs.width || "?"}，重叠 ${visual.attrs.overlap || "?"}。`;
  if (visual.kind === "stack_cups") return `杯子叠放图：${visual.attrs.count || "?"} 个杯子，首个高度 ${visual.attrs.first_height || "?"}，每增加一个约增高 ${visual.attrs.step || "?"}。`;
  if (visual.kind === "rect_path") return `长方形路径图：宽 ${visual.attrs.width || "?"}，高 ${visual.attrs.height || "?"}，路径 ${visual.attrs.path || "A-D-C-B"}。`;
  if (visual.kind === "source_image") return "复杂图形题：使用原始试卷图片展示。";
  return "";
}

function normalizeReviewResult(value) {
  const text = toCleanString(value);
  if (["correct", "wrong", "mastered"].includes(text)) return text;
  if (/掌握/.test(text)) return "mastered";
  if (/错|不会|again/.test(text)) return "wrong";
  return "correct";
}

function extractPaperSupplementScopes(input) {
  const text = toCleanString(input?.question || "");
  if (!text) return [];
  return text
    .split(/\n+/)
    .map((line) => {
      const majorNumber = extractSupplementField(line, "大题");
      const minorNumber = extractSupplementField(line, "小题");
      if (!isExplicitSupplementValue(majorNumber) && !isExplicitSupplementValue(minorNumber)) return null;
      return { majorNumber, minorNumber };
    })
    .filter(Boolean);
}

function extractSupplementField(line, label) {
  const match = toCleanString(line).match(new RegExp(`${label}：([^；\\n]+)`));
  return match ? toCleanString(match[1]) : "";
}

function isExplicitSupplementValue(value) {
  const text = toCleanString(value);
  return Boolean(text && !/未说明|选择/.test(text));
}

function scopedMistakeMatches(item, scope) {
  const numberText = toCleanString(item.questionNumber || item.number || item.no || "");
  const fallbackText = numberText || toCleanString(item.question || item.stem || item.title || "").slice(0, 80);
  if (!fallbackText) return false;
  const hasMinorScope = isExplicitSupplementValue(scope.minorNumber);
  const sourceMentionsMajor = /大题|选择题|填空题|计算题|应用题|压轴题/.test(fallbackText);
  const majorMatched = !isExplicitSupplementValue(scope.majorNumber) || (hasMinorScope && !sourceMentionsMajor) || textContainsQuestionScope(fallbackText, scope.majorNumber);
  const minorMatched = !isExplicitSupplementValue(scope.minorNumber) || textContainsQuestionScope(fallbackText, scope.minorNumber);
  return majorMatched && minorMatched;
}

function textContainsQuestionScope(text, scopeValue) {
  const target = toCleanString(scopeValue);
  const source = toCleanString(text);
  if (!target || !source) return false;
  if (source.includes(target)) return true;
  const numbers = target.match(/\d+/g) || [];
  if (!numbers.length) return false;
  return numbers.every((number) => new RegExp(`(^|[^\\d])${number}([^\\d]|$)`).test(source));
}

function normalizeStructuredMistakes(payload, input) {
  const root = Array.isArray(payload) ? { mistakes: payload } : (payload && typeof payload === "object" ? payload : {});
  const scopes = extractPaperSupplementScopes(input);
  const rawMistakes = Array.isArray(root.mistakes) ? root.mistakes : [];
  const scopedMistakes = scopes.length ? rawMistakes.filter((item) => scopes.some((scope) => scopedMistakeMatches(item, scope))) : rawMistakes;
  const mistakes = scopes.length && scopedMistakes.length ? scopedMistakes : rawMistakes;

  return mistakes
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const question = toCleanString(item.question || item.stem || item.title);
      const questionNumber = toCleanString(item.questionNumber || item.number || item.no || "");
      const options = toStringArray(item.options || item.choices, 10);
      const analysis = toCleanString(item.analysis || item.explanation || item.solution);
      const fallbackQuestion = questionNumber ? `${questionNumber}. ${question}`.trim() : question;
      const knowledgePoints = toStringArray(item.knowledgePoints || item.knowledge_points, 6);
      const visual = inferVisualFields(item, fallbackQuestion, analysis, knowledgePoints);
      const imageRegion = normalizeImageRegion(item.imageRegion || item.image_region || item.region || item.bbox || item.boundingBox || item.bounding_box);

      if (!fallbackQuestion && !analysis) return null;

      return {
        questionNumber,
        subject: toCleanString(item.subject, input.subject || ""),
        grade: toCleanString(item.grade, input.grade || ""),
        question: fallbackQuestion || `第 ${index + 1} 道错题，题干需人工确认`,
        options,
        studentAnswer: toCleanString(item.studentAnswer || item.student_answer, input.studentAnswer || ""),
        correctAnswer: toCleanString(item.correctAnswer || item.correct_answer || item.answer, input.correctAnswer || ""),
        analysis: analysis || "图片信息有限，解析需人工确认。",
        visualType: visual.visualType,
        visualComplexity: visual.visualComplexity,
        visualRenderStrategy: visual.visualRenderStrategy,
        supportedTemplate: visual.supportedTemplate,
        needsCrop: visual.needsCrop,
        visualConfidence: visual.visualConfidence,
        visualDescription: visual.visualDescription,
        visualMarker: visual.visualMarker,
        imageRegion,
        sourceAttachment: item.sourceAttachment || item.source_attachment || null,
        knowledgePoints,
        wrongReasons: toStringArray(item.wrongReasons || item.wrong_reasons, 6),
        questionType: toCleanString(item.questionType || item.question_type || item.type, "待确认"),
        difficulty: normalizeDifficulty(item.difficulty),
        tags: [...new Set([...toStringArray(item.tags, 6), "试卷错题"].filter(Boolean))]
      };
    })
    .filter(Boolean);
}

function buildTemplateMistakePayload(input) {
  return {
    summary: "本地演示模式：已模拟从试卷照片中识别 1 道错题。接入模型密钥后会按图片实际批改痕迹识别多道错题。",
    mistakes: [
      {
        questionNumber: "示例 1",
        subject: input.subject || "数学",
        grade: input.grade || "小学",
        question: input.question || "见上传试卷照片：请根据题干条件求解目标问题。",
        options: [],
        studentAnswer: input.studentAnswer || "未提供",
        correctAnswer: input.correctAnswer || "待模型识别",
        analysis: "先提取题干已知条件，再判断对应知识点。学生错误通常来自条件遗漏或计算步骤跳跃，建议订正时写出完整推理过程。",
        knowledgePoints: [input.subject ? `${input.subject}基础知识` : "基础知识"],
        wrongReasons: ["审题不完整"],
        questionType: "待确认",
        difficulty: "中等",
        tags: ["试卷错题"]
      }
    ]
  };
}

function formatMistakeBatchOutput(summary, mistakes) {
  if (!mistakes.length) {
    return `${summary || "本次没有识别到明确错题。"}\n\n建议：请确认上传的是已批改试卷，或在补充说明中写明老师标记错题的位置。`;
  }

  return `${summary || `本次识别到 ${mistakes.length} 道错题。`}

待确认错题：
${mistakes.map((item, index) => `【错题 ${index + 1}】${item.questionNumber ? `（${item.questionNumber}）` : ""}
题目：${item.question}
${item.options?.length ? `选项：\n${item.options.join("\n")}\n` : ""}学生答案：${item.studentAnswer || "未识别"}
正确答案：${item.correctAnswer || "需人工确认"}
知识点：${item.knowledgePoints?.join("、") || "待归类"}
错因：${item.wrongReasons?.join("、") || "待归类"}
题型 / 难度：${item.questionType || "待确认"} / ${item.difficulty || "中等"}
解析：${item.analysis}`).join("\n\n")}`;
}

async function generateMistakeOutput(input, attachment) {
  const imageModelError = requireImageModel(attachment);
  if (imageModelError) {
    throw new Error(imageModelError);
  }

  if (!aiConfig.apiKey) {
    const payload = buildTemplateMistakePayload(input);
    const mistakes = normalizeStructuredMistakes(payload, input);
    return {
      output: formatMistakeBatchOutput(payload.summary, mistakes),
      model: "local-template",
      structuredMistakes: mistakes
    };
  }

  const generation = await callTextModel("mistake", input, attachment);
  const rawOutput = generation.output;
  const payload = extractJsonPayload(rawOutput);
  const mistakes = normalizeStructuredMistakes(payload, input);

  if (!mistakes.length) {
    return {
      output: rawOutput,
      model: generation.model,
      structuredMistakes: []
    };
  }

  return {
    output: formatMistakeBatchOutput(toCleanString(payload?.summary), mistakes),
    model: generation.model,
    structuredMistakes: mistakes
  };
}

async function generateOutput(toolSlug, input, attachment) {
  if (toolSlug === "mistake") {
    return generateMistakeOutput(input, attachment);
  }

  const imageModelError = requireImageModel(attachment);
  if (imageModelError) {
    throw new Error(imageModelError);
  }

  if (!aiConfig.apiKey) {
    return {
      output: generateTemplateOutput(toolSlug, input),
      model: "local-template"
    };
  }

  return callTextModel(toolSlug, input, attachment);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function loadJsonl(filePath, onRecord) {
  try {
    const raw = await readFile(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        onRecord(JSON.parse(line));
      } catch {
        // Ignore damaged local prototype records.
      }
    }
  } catch {
    // Local prototype data files are created lazily.
  }
}

async function createMysqlPool() {
  if (mysqlConfig.url) {
    return mysql.createPool(mysqlConfig.url);
  }

  return mysql.createPool({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    database: mysqlConfig.database,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    charset: "utf8mb4",
    timezone: "+08:00",
    waitForConnections: true,
    connectionLimit: 6,
    maxIdle: 2,
    enableKeepAlive: true,
    ssl: false
  });
}

async function ensureMysqlSchema() {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName("users")} (
      id CHAR(36) PRIMARY KEY,
      email VARCHAR(180) NOT NULL,
      data_json JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      last_login_at DATETIME(3) NULL,
      UNIQUE KEY uk_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName("login_codes")} (
      id CHAR(36) PRIMARY KEY,
      email VARCHAR(180) NOT NULL,
      code_hash CHAR(64) NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      expires_at DATETIME(3) NOT NULL,
      used_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL,
      KEY idx_email_created (email, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName("children")} (
      id VARCHAR(64) PRIMARY KEY,
      user_id CHAR(36) NOT NULL DEFAULT '',
      name VARCHAR(80) NOT NULL,
      grade VARCHAR(80) NOT NULL DEFAULT '',
      birth_year SMALLINT NULL,
      birth_month TINYINT NULL,
      role VARCHAR(40) NOT NULL DEFAULT 'student',
      data_json JSON NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName("generations")} (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL DEFAULT '',
      child_id VARCHAR(64) NOT NULL,
      tool_slug VARCHAR(64) NOT NULL,
      input_json JSON NOT NULL,
      attachment_json JSON NULL,
      output MEDIUMTEXT NOT NULL,
      model VARCHAR(120) NOT NULL DEFAULT '',
      quota_cost INT NOT NULL DEFAULT 1,
      data_json JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      KEY idx_user_created (user_id, created_at),
      KEY idx_child_created (child_id, created_at),
      KEY idx_tool_created (tool_slug, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName("mistake_records")} (
      id CHAR(36) PRIMARY KEY,
      generation_id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL DEFAULT '',
      child_id VARCHAR(64) NOT NULL,
      subject VARCHAR(80) NOT NULL DEFAULT '',
      grade VARCHAR(80) NOT NULL DEFAULT '',
      question TEXT NULL,
      student_answer TEXT NULL,
      correct_answer TEXT NULL,
      options_json JSON NULL,
      analysis MEDIUMTEXT NULL,
      knowledge_points JSON NULL,
      wrong_reasons JSON NULL,
      question_type VARCHAR(80) NOT NULL DEFAULT '',
      difficulty VARCHAR(40) NOT NULL DEFAULT '',
      tags JSON NULL,
      source_attachment JSON NULL,
      review_count INT NOT NULL DEFAULT 0,
      next_review_at DATETIME(3) NULL,
      mastery_status VARCHAR(40) NOT NULL DEFAULT 'active',
      status VARCHAR(40) NOT NULL DEFAULT 'active',
      data_json JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      KEY idx_user_created (user_id, created_at),
      KEY idx_child_status (child_id, status),
      KEY idx_child_review (child_id, next_review_at),
      KEY idx_subject_grade (subject, grade)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName("exam_papers")} (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL DEFAULT '',
      child_id VARCHAR(64) NOT NULL,
      title VARCHAR(200) NOT NULL DEFAULT '',
      content MEDIUMTEXT NULL,
      questions_json JSON NULL,
      weak_knowledge_points JSON NULL,
      target_knowledge_points JSON NULL,
      source_mistake_ids JSON NULL,
      pdf_url VARCHAR(500) NOT NULL DEFAULT '',
      pdf_filename VARCHAR(240) NOT NULL DEFAULT '',
      generation_warning TEXT NULL,
      data_json JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      KEY idx_user_created (user_id, created_at),
      KEY idx_child_created (child_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName("mastery_events")} (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL DEFAULT '',
      child_id VARCHAR(64) NOT NULL,
      paper_id CHAR(36) NOT NULL DEFAULT '',
      question_id VARCHAR(80) NOT NULL DEFAULT '',
      question_number INT NOT NULL DEFAULT 0,
      knowledge_points JSON NULL,
      is_correct TINYINT(1) NOT NULL DEFAULT 0,
      answer TEXT NULL,
      note TEXT NULL,
      data_json JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      KEY idx_user_created (user_id, created_at),
      KEY idx_child_created (child_id, created_at),
      KEY idx_paper_created (paper_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await ensureMysqlColumn("children", "user_id", "user_id CHAR(36) NOT NULL DEFAULT '' AFTER id");
  await ensureMysqlColumn("children", "birth_year", "birth_year SMALLINT NULL AFTER grade");
  await ensureMysqlColumn("children", "birth_month", "birth_month TINYINT NULL AFTER birth_year");
  await ensureMysqlColumn("generations", "user_id", "user_id CHAR(36) NOT NULL DEFAULT '' AFTER id");
  await ensureMysqlColumn("mistake_records", "user_id", "user_id CHAR(36) NOT NULL DEFAULT '' AFTER generation_id");
  await ensureMysqlColumn("mistake_records", "options_json", "options_json JSON NULL AFTER correct_answer");
}

async function ensureMysqlColumn(table, column, definition) {
  try {
    await dbPool.query(`ALTER TABLE ${tableName(table)} ADD COLUMN ${definition}`);
  } catch (error) {
    if (error.code !== "ER_DUP_FIELDNAME") throw error;
  }
}

async function writeMysqlUser(user) {
  await dbPool.execute(
    `INSERT INTO ${tableName("users")} (id, email, data_json, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       data_json = VALUES(data_json),
       updated_at = VALUES(updated_at),
       last_login_at = VALUES(last_login_at)`,
    [
      user.id,
      user.email,
      jsonValue(user, {}),
      mysqlDate(user.createdAt),
      mysqlDate(user.updatedAt || user.createdAt),
      mysqlDate(user.lastLoginAt)
    ]
  );
}

async function writeMysqlLoginCode(record) {
  await dbPool.execute(
    `INSERT INTO ${tableName("login_codes")} (id, email, code_hash, attempts, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       attempts = VALUES(attempts),
       used_at = VALUES(used_at)`,
    [
      record.id,
      record.email,
      record.codeHash,
      Number(record.attempts || 0),
      mysqlDate(record.expiresAt),
      mysqlDate(record.usedAt),
      mysqlDate(record.createdAt)
    ]
  );
}

async function writeMysqlChild(child) {
  await dbPool.execute(
    `INSERT INTO ${tableName("children")} (id, user_id, name, grade, birth_year, birth_month, role, data_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       name = VALUES(name),
       grade = VALUES(grade),
       birth_year = VALUES(birth_year),
       birth_month = VALUES(birth_month),
       role = VALUES(role),
       data_json = VALUES(data_json),
       updated_at = VALUES(updated_at)`,
    [
      child.id,
      child.userId,
      child.name,
      child.grade || "",
      child.birthYear || null,
      child.birthMonth || null,
      child.role || "student",
      jsonValue(child, {}),
      mysqlDate(child.createdAt),
      mysqlDate(child.updatedAt || child.createdAt)
    ]
  );
}

async function writeMysqlGeneration(record) {
  await dbPool.execute(
    `INSERT INTO ${tableName("generations")}
      (id, user_id, child_id, tool_slug, input_json, attachment_json, output, model, quota_cost, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       child_id = VALUES(child_id),
       tool_slug = VALUES(tool_slug),
       input_json = VALUES(input_json),
       attachment_json = VALUES(attachment_json),
       output = VALUES(output),
       model = VALUES(model),
       quota_cost = VALUES(quota_cost),
       data_json = VALUES(data_json),
       created_at = VALUES(created_at)`,
    [
      record.id,
      record.userId || "",
      record.childId || defaultChildId,
      record.toolSlug,
      jsonValue(record.input, {}),
      jsonValue(record.attachment),
      record.output || "",
      record.model || "",
      Number(record.quotaCost || 1),
      jsonValue(record, {}),
      mysqlDate(record.createdAt)
    ]
  );
}

async function writeMysqlMistakeRecord(record) {
  await dbPool.execute(
    `INSERT INTO ${tableName("mistake_records")}
      (id, generation_id, user_id, child_id, subject, grade, question, student_answer, correct_answer, options_json, analysis,
       knowledge_points, wrong_reasons, question_type, difficulty, tags, source_attachment, review_count,
       next_review_at, mastery_status, status, data_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       generation_id = VALUES(generation_id),
       user_id = VALUES(user_id),
       child_id = VALUES(child_id),
       subject = VALUES(subject),
       grade = VALUES(grade),
       question = VALUES(question),
       student_answer = VALUES(student_answer),
       correct_answer = VALUES(correct_answer),
       options_json = VALUES(options_json),
       analysis = VALUES(analysis),
       knowledge_points = VALUES(knowledge_points),
       wrong_reasons = VALUES(wrong_reasons),
       question_type = VALUES(question_type),
       difficulty = VALUES(difficulty),
       tags = VALUES(tags),
       source_attachment = VALUES(source_attachment),
       review_count = VALUES(review_count),
       next_review_at = VALUES(next_review_at),
       mastery_status = VALUES(mastery_status),
       status = VALUES(status),
       data_json = VALUES(data_json),
       created_at = VALUES(created_at),
       updated_at = VALUES(updated_at)`,
    [
      record.id,
      record.generationId,
      record.userId || "",
      record.childId || defaultChildId,
      record.subject || "",
      record.grade || "",
      record.question || "",
      record.studentAnswer || "",
      record.correctAnswer || "",
      jsonValue(record.options, []),
      record.analysis || "",
      jsonValue(record.knowledgePoints, []),
      jsonValue(record.wrongReasons, []),
      record.questionType || "",
      record.difficulty || "",
      jsonValue(record.tags, []),
      jsonValue(record.sourceAttachment),
      Number(record.reviewCount || 0),
      mysqlDate(record.nextReviewAt),
      record.masteryStatus || record.status || "active",
      record.status || "active",
      jsonValue(record, {}),
      mysqlDate(record.createdAt),
      mysqlDate(record.updatedAt || record.createdAt)
    ]
  );
}

async function writeMysqlExamPaper(record) {
  await dbPool.execute(
    `INSERT INTO ${tableName("exam_papers")}
      (id, user_id, child_id, title, content, questions_json, weak_knowledge_points, target_knowledge_points,
       source_mistake_ids, pdf_url, pdf_filename, generation_warning, data_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       child_id = VALUES(child_id),
       title = VALUES(title),
       content = VALUES(content),
       questions_json = VALUES(questions_json),
       weak_knowledge_points = VALUES(weak_knowledge_points),
       target_knowledge_points = VALUES(target_knowledge_points),
       source_mistake_ids = VALUES(source_mistake_ids),
       pdf_url = VALUES(pdf_url),
       pdf_filename = VALUES(pdf_filename),
       generation_warning = VALUES(generation_warning),
       data_json = VALUES(data_json),
       updated_at = VALUES(updated_at)`,
    [
      record.id,
      record.userId || "",
      record.childId || defaultChildId,
      record.title || "",
      record.content || "",
      jsonValue(record.questions, []),
      jsonValue(record.weakKnowledgePoints, []),
      jsonValue(record.targetKnowledgePoints, []),
      jsonValue(record.sourceMistakeIds, []),
      record.pdfUrl || "",
      record.pdfFilename || "",
      record.generationWarning || "",
      jsonValue(record, {}),
      mysqlDate(record.createdAt),
      mysqlDate(record.updatedAt || record.createdAt)
    ]
  );
}

async function writeMysqlMasteryEvent(record) {
  await dbPool.execute(
    `INSERT INTO ${tableName("mastery_events")}
      (id, user_id, child_id, paper_id, question_id, question_number, knowledge_points, is_correct, answer, note, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       child_id = VALUES(child_id),
       paper_id = VALUES(paper_id),
       question_id = VALUES(question_id),
       question_number = VALUES(question_number),
       knowledge_points = VALUES(knowledge_points),
       is_correct = VALUES(is_correct),
       answer = VALUES(answer),
       note = VALUES(note),
       data_json = VALUES(data_json)`,
    [
      record.id,
      record.userId || "",
      record.childId || defaultChildId,
      record.paperId || "",
      record.questionId || "",
      Number(record.questionNumber || 0),
      jsonValue(record.knowledgePoints, []),
      record.isCorrect ? 1 : 0,
      record.answer || "",
      record.note || "",
      jsonValue(record, {}),
      mysqlDate(record.createdAt)
    ]
  );
}

async function migrateJsonlToMysql() {
  await loadJsonl(historyFile, async (record) => {
    if (record?.id) {
      generations.set(record.id, record);
    }
  });
  await loadJsonl(mistakeBookFile, async (record) => {
    if (record?.id) {
      mistakeRecords.set(record.id, record);
    }
  });
  await loadJsonl(examPapersFile, async (record) => {
    if (record?.id) {
      examPapers.set(record.id, record);
    }
  });
  await loadJsonl(masteryEventsFile, async (record) => {
    if (record?.id) {
      masteryEvents.push(record);
    }
  });

  for (const record of generations.values()) {
    await writeMysqlGeneration({
      userId: record.userId || "",
      childId: defaultChildId,
      childSnapshot: childSnapshot(defaultChildId),
      ...record
    });
  }

  for (const record of mistakeRecords.values()) {
    await writeMysqlMistakeRecord({
      userId: record.userId || "",
      childId: defaultChildId,
      childSnapshot: childSnapshot(defaultChildId),
      ...record
    });
  }

  for (const record of examPapers.values()) {
    await writeMysqlExamPaper({
      userId: record.userId || "",
      childId: record.childId || defaultChildId,
      ...record
    });
  }

  for (const record of masteryEvents) {
    await writeMysqlMasteryEvent({
      userId: record.userId || "",
      childId: record.childId || defaultChildId,
      ...record
    });
  }
}

async function loadMysqlData() {
  const [userRows] = await dbPool.query(`SELECT data_json FROM ${tableName("users")} ORDER BY created_at ASC`);
  users.clear();
  for (const row of userRows) {
    const user = parseJsonValue(row.data_json);
    if (user?.id) users.set(user.id, user);
  }

  const [codeRows] = await dbPool.query(
    `SELECT id, email, code_hash AS codeHash, attempts, expires_at AS expiresAt, used_at AS usedAt, created_at AS createdAt
     FROM ${tableName("login_codes")}
     WHERE used_at IS NULL AND expires_at > NOW(3)
     ORDER BY created_at ASC`
  );
  loginCodes.clear();
  for (const row of codeRows) {
    loginCodes.set(row.id, {
      ...row,
      expiresAt: isoDate(row.expiresAt),
      usedAt: isoDate(row.usedAt),
      createdAt: isoDate(row.createdAt)
    });
  }

  const [childRows] = await dbPool.query(`SELECT data_json FROM ${tableName("children")} ORDER BY created_at ASC`);
  const loadedChildren = childRows
    .map((row) => parseJsonValue(row.data_json))
    .filter((child) => child?.id);

  children = loadedChildren;

  const [generationRows] = await dbPool.query(`SELECT data_json FROM ${tableName("generations")} ORDER BY created_at ASC`);
  generations.clear();
  for (const row of generationRows) {
    const record = parseJsonValue(row.data_json);
    if (record?.id) generations.set(record.id, record);
  }

  const [mistakeRows] = await dbPool.query(`SELECT data_json FROM ${tableName("mistake_records")} ORDER BY created_at ASC`);
  mistakeRecords.clear();
  for (const row of mistakeRows) {
    const record = parseJsonValue(row.data_json);
    if (record?.id) mistakeRecords.set(record.id, record);
  }

  const [paperRows] = await dbPool.query(`SELECT data_json FROM ${tableName("exam_papers")} ORDER BY created_at ASC`);
  examPapers.clear();
  for (const row of paperRows) {
    const record = parseJsonValue(row.data_json);
    if (record?.id) examPapers.set(record.id, record);
  }

  const [masteryRows] = await dbPool.query(`SELECT data_json FROM ${tableName("mastery_events")} ORDER BY created_at ASC`);
  masteryEvents.length = 0;
  for (const row of masteryRows) {
    const record = parseJsonValue(row.data_json);
    if (record?.id) masteryEvents.push(record);
  }
}

async function initMysqlStorage() {
  if (!mysqlConfig.enabled) return false;

  try {
    dbPool = await createMysqlPool();
    await dbPool.query("SELECT 1");
    await ensureMysqlSchema();
    await migrateJsonlToMysql();
    await loadMysqlData();
    storageMode = "mysql";
    console.log(`Using MySQL storage: ${mysqlConfig.database}.${mysqlConfig.tablePrefix}*`);
    return true;
  } catch (error) {
    dbPool = null;
    storageMode = "jsonl";
    console.warn(`MySQL storage unavailable, falling back to jsonl: ${error.message}`);
    return false;
  }
}

async function loadLocalData() {
  await loadJsonl(authFile, (record) => {
    if (record?.type === "user" && record.user?.id) users.set(record.user.id, record.user);
    if (record?.type === "child" && record.child?.id) {
      const index = children.findIndex((item) => item.id === record.child.id);
      if (index >= 0) {
        children[index] = record.child;
      } else {
        children.push(record.child);
      }
    }
  });
  await loadJsonl(historyFile, (record) => {
    if (record?.id) generations.set(record.id, record);
  });
  await loadJsonl(mistakeBookFile, (record) => {
    if (record?.id) mistakeRecords.set(record.id, record);
  });
  await loadJsonl(examPapersFile, (record) => {
    if (record?.id) examPapers.set(record.id, record);
  });
  await loadJsonl(masteryEventsFile, (record) => {
    if (record?.id) masteryEvents.push(record);
  });
}

async function loadSessionData() {
  await loadJsonl(sessionsFile, (record) => {
    if (record?.type !== "session" || !record.id) return;
    const session = record.session || {};
    sessions.set(record.id, {
      id: record.id,
      quotaLeft: Number.isFinite(Number(session.quotaLeft)) ? Number(session.quotaLeft) : 3,
      userId: session.userId || "",
      createdAt: session.createdAt || record.createdAt || new Date().toISOString(),
      updatedAt: session.updatedAt || record.updatedAt || ""
    });
  });
}

async function loadPersistentData() {
  if (await initMysqlStorage()) {
    await loadSessionData();
    return;
  }
  await loadLocalData();
  await loadSessionData();
}

async function refreshMysqlDataIfNeeded() {
  if (storageMode !== "mysql" || !dbPool) return;
  await loadMysqlData();
}

async function listExamPaperRecords(userId, childId) {
  if (storageMode !== "mysql" || !dbPool) {
    return [...examPapers.values()]
      .filter((paper) => paper.userId === userId)
      .filter((paper) => (paper.status || "active") === "active")
      .filter((paper) => (paper.childId || defaultChildId) === childId)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  const [rows] = await dbPool.execute(
    `SELECT data_json FROM ${tableName("exam_papers")}
     WHERE user_id = ? AND child_id = ?
     ORDER BY created_at DESC`,
    [userId, childId]
  );

  const records = [];
  for (const row of rows) {
    const record = parseJsonValue(row.data_json);
    if (!record?.id || (record.status || "active") !== "active") continue;
    examPapers.set(record.id, record);
    records.push(record);
  }
  return records;
}

async function findExamPaperRecord(paperId) {
  if (storageMode !== "mysql" || !dbPool) {
    return examPapers.get(paperId);
  }

  const [rows] = await dbPool.execute(
    `SELECT data_json FROM ${tableName("exam_papers")} WHERE id = ? LIMIT 1`,
    [paperId]
  );
  const record = parseJsonValue(rows[0]?.data_json);
  if (record?.id) {
    examPapers.set(record.id, record);
    return record;
  }
  examPapers.delete(paperId);
  return null;
}

async function writeUser(user) {
  users.set(user.id, user);

  if (storageMode === "mysql" && dbPool) {
    await writeMysqlUser(user);
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await appendFile(authFile, `${JSON.stringify({ type: "user", user })}\n`, "utf8");
}

async function writeLoginCode(record) {
  loginCodes.set(record.id, record);

  if (storageMode === "mysql" && dbPool) {
    await writeMysqlLoginCode(record);
  }
}

async function writeSessionRecord(session) {
  if (!session?.id) return;
  const now = new Date().toISOString();
  const persisted = {
    ...session,
    quotaLeft: Number.isFinite(Number(session.quotaLeft)) ? Number(session.quotaLeft) : 3,
    userId: session.userId || "",
    updatedAt: now
  };
  sessions.set(session.id, persisted);
  await mkdir(dirname(sessionsFile), { recursive: true });
  await appendFile(sessionsFile, `${JSON.stringify({ type: "session", id: session.id, session: persisted, updatedAt: now })}\n`, "utf8");
}

async function writeChild(child) {
  const index = children.findIndex((item) => item.id === child.id);
  if (index >= 0) {
    children[index] = child;
  } else {
    children.push(child);
  }

  if (storageMode === "mysql" && dbPool) {
    await writeMysqlChild(child);
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await appendFile(authFile, `${JSON.stringify({ type: "child", child })}\n`, "utf8");
}

async function writeGeneration(record) {
  generations.set(record.id, record);

  if (storageMode === "mysql" && dbPool) {
    await writeMysqlGeneration(record);
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await appendFile(historyFile, `${JSON.stringify(record)}\n`, "utf8");
}

async function writeMistakeRecord(record) {
  mistakeRecords.set(record.id, record);

  if (storageMode === "mysql" && dbPool) {
    await writeMysqlMistakeRecord(record);
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await appendFile(mistakeBookFile, `${JSON.stringify(record)}\n`, "utf8");
}

async function writeExamPaperRecord(record) {
  examPapers.set(record.id, record);

  if (storageMode === "mysql" && dbPool) {
    await writeMysqlExamPaper(record);
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await appendFile(examPapersFile, `${JSON.stringify(record)}\n`, "utf8");
}

async function updateExamPaperRecord(record, patch) {
  const now = new Date().toISOString();
  const updated = {
    ...record,
    ...patch,
    updatedAt: now
  };

  await writeExamPaperRecord(updated);
  return updated;
}

async function writeMasteryEvent(record) {
  masteryEvents.push(record);

  if (storageMode === "mysql" && dbPool) {
    await writeMysqlMasteryEvent(record);
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await appendFile(masteryEventsFile, `${JSON.stringify(record)}\n`, "utf8");
}

async function updateMistakeRecord(record, patch) {
  const now = new Date().toISOString();
  const updated = {
    ...record,
    ...patch,
    updatedAt: now
  };

  await writeMistakeRecord(updated);
  return updated;
}

function nextReviewAt(createdAt, reviewCount = 0) {
  const intervals = [1, 3, 7, 14, 30];
  const date = new Date(createdAt);
  date.setDate(date.getDate() + intervals[Math.min(reviewCount, intervals.length - 1)]);
  return date.toISOString();
}

function extractKnowledgePoints(output) {
  const match = String(output).match(/考察知识点[:：]\s*([\s\S]*?)(?:\n\s*\n|错因判断[:：]|分步讲解[:：]|$)/);
  if (!match) return [];

  return match[1]
    .split(/[、，,；;\n]/)
    .map((item) => item.replace(/^[-\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function publicMistakeRecord(record) {
  if (!record) return null;

  return {
    id: record.id,
    generationId: record.generationId,
    userId: record.userId || "",
    childId: record.childId || defaultChildId,
    childName: record.childSnapshot?.name || childName(record.childId),
    subject: record.subject,
    grade: record.grade,
    question: record.question,
    options: record.options || [],
    studentAnswer: record.studentAnswer,
    correctAnswer: record.correctAnswer,
    analysis: record.analysis,
    visualType: record.visualType || "",
    visualComplexity: record.visualComplexity || "",
    visualRenderStrategy: record.visualRenderStrategy || "",
    supportedTemplate: record.supportedTemplate || "",
    needsCrop: Boolean(record.needsCrop),
    visualConfidence: Number(record.visualConfidence || 0),
    visualDescription: record.visualDescription || "",
    visualMarker: record.visualMarker || "",
    imageRegion: record.imageRegion || null,
    knowledgePoints: record.knowledgePoints,
    wrongReasons: record.wrongReasons || [],
    questionType: record.questionType || "",
    difficulty: record.difficulty || "",
    tags: record.tags || [],
    sourceAttachment: record.sourceAttachment,
    reviewCount: record.reviewCount,
    nextReviewAt: record.nextReviewAt,
    masteryStatus: record.masteryStatus || record.status,
    status: record.status,
    reviews: record.reviews || [],
    createdAt: record.createdAt
  };
}

function buildMistakeRecord(generationRecord, mistake, index = 0) {
  const createdAt = generationRecord.createdAt;
  const input = generationRecord.input || {};

  return {
    id: randomUUID(),
    generationId: generationRecord.id,
    userId: generationRecord.userId || "",
    childId: generationRecord.childId || defaultChildId,
    childSnapshot: generationRecord.childSnapshot || childSnapshot(generationRecord.childId),
    subject: mistake.subject || input.subject || "",
    grade: mistake.grade || input.grade || "",
    question: mistake.question || input.question || `第 ${index + 1} 道错题，题干需人工确认`,
    options: mistake.options || [],
    studentAnswer: mistake.studentAnswer || input.studentAnswer || "",
    correctAnswer: mistake.correctAnswer || input.correctAnswer || "",
    analysis: mistake.analysis || generationRecord.output,
    visualType: mistake.visualType || "",
    visualComplexity: mistake.visualComplexity || "",
    visualRenderStrategy: mistake.visualRenderStrategy || "",
    supportedTemplate: mistake.supportedTemplate || "",
    needsCrop: Boolean(mistake.needsCrop),
    visualConfidence: Number(mistake.visualConfidence || 0),
    visualDescription: mistake.visualDescription || "",
    visualMarker: mistake.visualMarker || "",
    imageRegion: normalizeImageRegion(mistake.imageRegion),
    knowledgePoints: mistake.knowledgePoints?.length ? mistake.knowledgePoints : extractKnowledgePoints(generationRecord.output),
    wrongReasons: mistake.wrongReasons || [],
    questionType: mistake.questionType || "",
    difficulty: mistake.difficulty || "",
    tags: mistake.tags || [],
    sourceType: "paper_photo",
    sourceName: input.paperName || "",
    sourceAttachment: buildMistakeSourceAttachment(generationRecord.attachment, mistake.sourceAttachment, mistake.imageRegion),
    reviewCount: 0,
    nextReviewAt: nextReviewAt(createdAt, 0),
    masteryStatus: "待复习",
    status: "active",
    reviews: [],
    createdAt,
    updatedAt: createdAt
  };
}

async function createMistakeRecordsFromGeneration(generationRecord) {
  if (generationRecord.toolSlug !== "mistake") return [];

  const createdAt = generationRecord.createdAt;
  const input = generationRecord.input || {};
  const hasStructuredMistakes = Object.prototype.hasOwnProperty.call(generationRecord, "structuredMistakes");
  const structuredMistakes = Array.isArray(generationRecord.structuredMistakes) ? generationRecord.structuredMistakes : [];
  const source = structuredMistakes.length
    ? structuredMistakes
    : (hasStructuredMistakes ? [] : [{
        subject: input.subject || "",
        grade: input.grade || "",
        question: input.question || "见上传图片",
        options: [],
        studentAnswer: input.studentAnswer || "",
        correctAnswer: input.correctAnswer || "",
        analysis: generationRecord.output,
        knowledgePoints: extractKnowledgePoints(generationRecord.output),
        wrongReasons: [],
        questionType: "",
        difficulty: "",
        tags: ["试卷错题"]
      }]);
  const records = source.map((mistake, index) => buildMistakeRecord({ ...generationRecord, createdAt }, mistake, index));

  for (const record of records) {
    await writeMistakeRecord(record);
  }

  return records;
}

async function createMistakeRecordsFromDraft(generationRecord, draftMistakes = []) {
  if (generationRecord.toolSlug !== "mistake") return [];

  const source = normalizeStructuredMistakes({ mistakes: draftMistakes }, generationRecord.input || {})
    .map((mistake, index) => {
      const draft = draftMistakes[index] && typeof draftMistakes[index] === "object" ? draftMistakes[index] : {};
      const editedQuestion = toCleanString(draft.question);
      return editedQuestion ? { ...mistake, question: editedQuestion } : mistake;
    });
  const records = source.map((mistake, index) => buildMistakeRecord(generationRecord, mistake, index));

  for (const record of records) {
    await writeMistakeRecord(record);
  }

  return records;
}

function publicGeneration(record) {
  if (!record) return null;

  return {
    id: record.id,
    toolSlug: record.toolSlug,
    userId: record.userId || "",
    childId: record.childId || defaultChildId,
    childName: record.childSnapshot?.name || childName(record.childId),
    input: record.input,
    attachment: record.attachment,
    output: record.output,
    structuredMistakes: record.structuredMistakes || [],
    importedMistakeIds: record.importedMistakeIds || [],
    model: record.model,
    quotaCost: record.quotaCost,
    createdAt: record.createdAt
  };
}

function filterMistakeRecords(query, userId = "") {
  const childId = resolveChildId(query.get("childId"), userId);
  const subject = query.get("subject");
  const grade = query.get("grade");
  const knowledgePoint = query.get("knowledgePoint");
  const wrongReason = query.get("wrongReason");
  const questionType = query.get("questionType");
  const difficulty = query.get("difficulty");
  const status = query.get("status");
  const keyword = query.get("keyword");
  const dueOnly = query.get("dueOnly") === "true";
  const now = new Date(query.get("now") || Date.now()).toISOString();

  return Array.from(mistakeRecords.values())
    .filter((record) => (record.status || "active") === "active")
    .filter((record) => (record.userId || "") === userId)
    .filter((record) => (record.childId || defaultChildId) === childId)
    .filter((record) => !subject || record.subject === subject)
    .filter((record) => !grade || record.grade === grade)
    .filter((record) => !knowledgePoint || (record.knowledgePoints || []).some((item) => item.includes(knowledgePoint)))
    .filter((record) => !wrongReason || (record.wrongReasons || []).some((item) => item.includes(wrongReason)))
    .filter((record) => !questionType || record.questionType === questionType)
    .filter((record) => !difficulty || record.difficulty === difficulty)
    .filter((record) => !status || (record.masteryStatus || record.status) === status)
    .filter((record) => {
      if (!keyword) return true;
      const haystack = [
        record.question,
        record.studentAnswer,
        record.correctAnswer,
        record.analysis,
        ...(record.knowledgePoints || []),
        ...(record.wrongReasons || []),
        ...(record.tags || [])
      ].join("\n");
      return haystack.includes(keyword);
    })
    .filter((record) => !dueOnly || (record.nextReviewAt && record.nextReviewAt <= now))
    .sort((a, b) => String(a.nextReviewAt).localeCompare(String(b.nextReviewAt)))
    .map(publicMistakeRecord);
}

function mistakeStats(query = new URLSearchParams(), userId = "") {
  const childId = resolveChildId(query.get("childId"), userId);
  const activeRecords = Array.from(mistakeRecords.values())
    .filter((record) => (record.status || "active") === "active")
    .filter((record) => (record.userId || "") === userId)
    .filter((record) => (record.childId || defaultChildId) === childId);
  const now = new Date().toISOString();
  const knowledgePointCounts = new Map();
  const wrongReasonCounts = new Map();

  for (const record of activeRecords) {
    for (const point of record.knowledgePoints || []) {
      knowledgePointCounts.set(point, (knowledgePointCounts.get(point) || 0) + 1);
    }
    for (const reason of record.wrongReasons || []) {
      wrongReasonCounts.set(reason, (wrongReasonCounts.get(reason) || 0) + 1);
    }
  }

  const toRank = (map) => Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    total: activeRecords.length,
    mastered: activeRecords.filter((record) => record.masteryStatus === "已掌握").length,
    due: activeRecords.filter((record) => record.nextReviewAt && record.nextReviewAt <= now).length,
    knowledgePointCount: knowledgePointCounts.size,
    knowledgePointTop: toRank(knowledgePointCounts),
    wrongReasonTop: toRank(wrongReasonCounts)
  };
}

function editableMistakePatch(input = {}) {
  const patch = {};
  const stringFields = ["subject", "grade", "question", "studentAnswer", "correctAnswer", "analysis", "questionType"];

  for (const field of stringFields) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      patch[field] = toCleanString(input[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "options")) patch.options = toStringArray(input.options, 10);
  if (Object.prototype.hasOwnProperty.call(input, "knowledgePoints")) patch.knowledgePoints = toStringArray(input.knowledgePoints, 6);
  if (Object.prototype.hasOwnProperty.call(input, "wrongReasons")) patch.wrongReasons = toStringArray(input.wrongReasons, 6);
  if (Object.prototype.hasOwnProperty.call(input, "tags")) patch.tags = toStringArray(input.tags, 8);
  if (Object.prototype.hasOwnProperty.call(input, "difficulty")) patch.difficulty = normalizeDifficulty(input.difficulty);

  if (Object.prototype.hasOwnProperty.call(input, "masteryStatus")) {
    patch.masteryStatus = normalizeMasteryStatus(input.masteryStatus);
    patch.status = patch.masteryStatus === "已归档" ? "archived" : "active";
  }

  return patch;
}

async function addMistakeReview(record, input = {}) {
  const result = normalizeReviewResult(input.result);
  const now = new Date().toISOString();
  const reviewCount = Number(record.reviewCount || 0) + 1;
  const nextAt = result === "wrong" ? nextReviewAt(now, 0) : nextReviewAt(now, reviewCount);
  const review = {
    id: randomUUID(),
    result,
    note: toCleanString(input.note),
    createdAt: now,
    nextReviewAt: result === "mastered" ? "" : nextAt
  };

  const patch = {
    reviewCount,
    reviews: [...(record.reviews || []), review],
    nextReviewAt: result === "mastered" ? "" : nextAt,
    masteryStatus: result === "mastered" ? "已掌握" : (result === "wrong" ? "待复习" : "复习中"),
    status: "active"
  };

  if (result === "wrong") {
    const reasons = toStringArray(input.wrongReasons, 6);
    if (reasons.length) patch.wrongReasons = [...new Set([...(record.wrongReasons || []), ...reasons])].slice(0, 6);
  }

  return updateMistakeRecord(record, patch);
}

function masteryEventsForChild(userId, childId) {
  return masteryEvents
    .filter((event) => event.userId === userId)
    .filter((event) => (event.childId || defaultChildId) === childId);
}

function knowledgePointMasteryStats(userId, childId) {
  const byPoint = new Map();

  for (const event of masteryEventsForChild(userId, childId)) {
    for (const point of event.knowledgePoints || []) {
      if (!byPoint.has(point)) {
        byPoint.set(point, { knowledgePoint: point, total: 0, correct: 0, wrong: 0, recent: [] });
      }
      const stat = byPoint.get(point);
      stat.total += 1;
      if (event.isCorrect) stat.correct += 1;
      else stat.wrong += 1;
      stat.recent.push({
        date: event.createdAt,
        isCorrect: Boolean(event.isCorrect),
        paperId: event.paperId,
        questionId: event.questionId
      });
    }
  }

  return [...byPoint.values()]
    .map((stat) => ({
      ...stat,
      accuracy: stat.total ? Number((stat.correct / stat.total).toFixed(3)) : 0,
      recent: stat.recent.slice(-20)
    }))
    .sort((a, b) => (a.accuracy - b.accuracy) || (b.total - a.total));
}

function weakKnowledgePoints(userId, childId, limit = 8) {
  return knowledgePointMasteryStats(userId, childId)
    .filter((stat) => stat.total >= 1 && stat.accuracy < 0.8)
    .slice(0, limit)
    .map((stat) => stat.knowledgePoint);
}

function recordWeakScore(record, weakPoints) {
  if (!weakPoints.length) return 0;
  const points = record.knowledgePoints || [];
  return points.reduce((score, point) => score + (weakPoints.some((weak) => point.includes(weak) || weak.includes(point)) ? 1 : 0), 0);
}

function fallbackQuestionType(record) {
  const type = String(record.questionType || "");
  if (/选择/.test(type) || (record.options || []).length) return "选择题";
  if (/判断/.test(type)) return "判断题";
  if (/填空/.test(type)) return "填空题";
  return "问答题";
}

function buildFallbackExamContent(source, input, childId, requestedCount) {
  const grouped = new Map();
  const orderedTypes = ["选择题", "填空题", "判断题", "问答题"];

  source.forEach((record) => {
    const type = fallbackQuestionType(record);
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type).push(record);
  });

  let questionNumber = 1;
  const body = [];
  const answerLines = ["参考答案与解析"];
  const sectionNumbers = ["一", "二", "三", "四"];

  orderedTypes.forEach((type) => {
    const records = grouped.get(type) || [];
    if (!records.length) return;

    body.push(`${sectionNumbers[body.filter((line) => /^[一二三四]、/.test(line)).length]}、${type}`);
    body.push("");

    records.forEach((record) => {
      const question = toCleanString(record.question || "请根据原错题知识点完成练习。")
        .replace(/^\d+\s*[.、]\s*/, "");
      body.push(`${questionNumber}. ${question}`);
      const visualLine = visualLineForRecord(record);
      if (visualLine) body.push(visualLine);
      for (const option of record.options || []) {
        body.push(toCleanString(option));
      }
      if (type === "问答题") {
        body.push("答：");
        body.push("");
        body.push("");
      }
      body.push("");

      answerLines.push("");
      answerLines.push(`${questionNumber}. 答案：${record.correctAnswer || "略"}`);
      answerLines.push(`解析：${record.analysis || "请结合原错题解析复盘同类知识点。"}`);
      const points = (record.knowledgePoints || []).filter(Boolean);
      if (points.length) answerLines.push(`对应知识点：${points.join("、")}`);
      questionNumber += 1;
    });
  });

  return normalizePaperContent([
    `学生姓名：${childName(childId)}`,
    `年级：${source[0]?.grade || ""}`,
    `题量：${requestedCount || source.length} 题`,
    `难度：${input.difficulty || "中等"}`,
    "时间：20 分钟",
    "",
    ...body,
    "",
    ...answerLines
  ].join("\n"));
}

function bindPaperQuestions(content, source) {
  const lines = splitPaperLines(normalizePaperContent(content));
  const questions = [];
  let currentType = "";
  let inAnswerSection = false;

  for (const line of lines) {
    const text = line.trim();
    if (isAnswerSectionLine(text)) {
      inAnswerSection = true;
      continue;
    }
    if (inAnswerSection || isInlineAnswerLine(text)) continue;

    if (/选择题/.test(text)) currentType = "选择题";
    if (/填空题/.test(text)) currentType = "填空题";
    if (/判断题/.test(text)) currentType = "判断题";
    if (/问答题|解答题|应用题|计算题/.test(text)) currentType = "问答题";
    if (!isQuestionLine(text)) continue;

    const sourceRecord = source[questions.length % source.length] || {};
    questions.push({
      id: randomUUID(),
      number: questions.length + 1,
      type: currentType || "综合题",
      prompt: text.replace(/^\d+\s*[.、]\s*/, "").slice(0, 180),
      knowledgePoints: sourceRecord.knowledgePoints || [],
      sourceMistakeId: sourceRecord.id || ""
    });
  }

  return questions;
}

async function recordPaperAttempt(paper, input, userId) {
  const answers = Array.isArray(input.answers) ? input.answers : [];
  const answerSheetAttachments = uploadedAttachmentMetas(input.answerSheetFileIds);
  const now = new Date().toISOString();
  const events = [];

  for (const answer of answers) {
    const question = (paper.questions || []).find((item) => item.id === answer.questionId || item.number === Number(answer.number));
    const knowledgePoints = toStringArray(answer.knowledgePoints, 6);
    const points = knowledgePoints.length ? knowledgePoints : (question?.knowledgePoints || []);
    if (!points.length) continue;

    const event = {
      id: randomUUID(),
      userId,
      childId: paper.childId || defaultChildId,
      paperId: paper.id,
      questionId: question?.id || String(answer.questionId || answer.number || ""),
      questionNumber: question?.number || Number(answer.number || 0),
      knowledgePoints: points,
      isCorrect: Boolean(answer.isCorrect),
      answer: toCleanString(answer.answer),
      note: toCleanString(input.note || answer.note),
      answerSheetAttachments,
      createdAt: now
    };
    await writeMasteryEvent(event);
    events.push(event);
  }

  return {
    id: randomUUID(),
    paperId: paper.id,
    childId: paper.childId || defaultChildId,
    total: events.length,
    correct: events.filter((event) => event.isCorrect).length,
    wrong: events.filter((event) => !event.isCorrect).length,
    answerSheetAttachments,
    events,
    createdAt: now
  };
}

function publicExamPaper(paper, includeContent = false) {
  if (!paper) return null;
  const sourceRecords = (paper.sourceMistakeIds || []).map((id) => mistakeRecords.get(id)).filter(Boolean);
  return {
    id: paper.id,
    childId: paper.childId || defaultChildId,
    title: paper.title || "错题巩固卷",
    content: includeContent ? normalizeExamPaperVisuals(paper.content || "", sourceRecords) : undefined,
    questions: paper.questions || [],
    weakKnowledgePoints: paper.weakKnowledgePoints || [],
    targetKnowledgePoints: paper.targetKnowledgePoints || [],
    sourceMistakeIds: paper.sourceMistakeIds || [],
    pdfUrl: paper.pdfUrl || "",
    pdfFilename: paper.pdfFilename || "",
    generationWarning: paper.generationWarning || "",
    createdAt: paper.createdAt || ""
  };
}

async function generateExamPaper(input, userId) {
  const childId = resolveChildId(input.childId, userId);
  const typeCounts = normalizeExamTypeCounts(input);
  const requestedCount = typeCounts.total || Number(input.count || 5);
  const selectedIds = Array.isArray(input.mistakeIds) ? input.mistakeIds : [];
  const targetKnowledgePoints = toStringArray(input.knowledgePoints, 12);
  const weakPoints = weakKnowledgePoints(userId, childId);
  const reviewPoints = targetKnowledgePoints.length ? targetKnowledgePoints : weakPoints;
  const dueRecords = filterMistakeRecords(new URLSearchParams({ childId, dueOnly: "true" }), userId);
  const allRecords = filterMistakeRecords(new URLSearchParams({ childId }), userId);
  const knowledgePointRecords = targetKnowledgePoints.length
    ? allRecords.filter((record) => (record.knowledgePoints || []).some((point) =>
        targetKnowledgePoints.some((target) => point.includes(target) || target.includes(point))
      ))
    : [];
  const fallbackRecords = allRecords
    .sort((a, b) => recordWeakScore(b, reviewPoints) - recordWeakScore(a, reviewPoints));
  const selected = selectedIds.length
    ? selectedIds
        .map((id) => mistakeRecords.get(String(id)))
        .filter((record) => record && (record.userId || "") === userId && (record.childId || defaultChildId) === childId)
    : (knowledgePointRecords.length
        ? knowledgePointRecords.sort((a, b) => recordWeakScore(b, reviewPoints) - recordWeakScore(a, reviewPoints))
        : (dueRecords.length ? dueRecords.sort((a, b) => recordWeakScore(b, reviewPoints) - recordWeakScore(a, reviewPoints)) : fallbackRecords)
      ).slice(0, requestedCount);
  const source = selected.slice(0, Number(requestedCount || selected.length || 5));

  if (source.length === 0) {
    return {
      title: `${childName(childId)}的错题巩固卷`,
      content: "暂无可出卷的错题。请先完成错题解析，或等待错题到达复习时间。",
      sourceMistakeIds: []
    };
  }

  const prompt = `请根据以下错题本记录，生成一份巩固练习卷。

出卷要求：
- 题量：${requestedCount || source.length} 题
- 难度：${input.difficulty || "中等"}
- 题型：${input.questionType || "同类变式题"}
- 题型数量：${typeCounts.items.length ? typeCounts.items.map((item) => `${item.label} ${item.count} 题`).join("，") : "由模型按知识点自动分配"}
- 复习目标知识点：${reviewPoints.length ? reviewPoints.join("、") : "暂无历史答题统计，按错题知识点均衡覆盖"}
- 学生：${childName(childId)}
- 输出包含：试卷标题、题目、答案、解析、对应知识点
- 请输出普通试卷文本，不要使用 Markdown。
- 禁止出现 #、##、**、---、代码块标记、表格符号。
- 不要重复输出大标题，直接从“学生姓名、年级、题量、难度、时间”开始。
- 每道题之间保留空行；选择题选项单独换行。
- 题目区域只允许出现题干和选项，不能出现“答案、解析、对应知识点”。
- 答案和解析放到最后的“参考答案与解析”部分，不要紧跟在题目后。
- 如果是问答题、计算题或应用题，请在题目后保留“答：”和足够作答空行。
- 填空或选择题题干里的空位统一写成“（    ）”，不要使用 ～、＿、_ 或反引号。
- 如果题目需要配图，请在题干下一行单独输出图形标记。当前支持：
${visualGenerationGuideLines({ includeSourceImage: true }).join("\n")}
  如果错题记录给出“建议图形标记”，优先原样使用该标记；source_image 的 url 只能复制错题记录里的“建议图形标记”，严禁编造新的 /output/uploads/xxx.png 地址。只有长方形纸条按固定宽度重叠这类可控题才能使用 overlap_rect；“一副三角板拼成”、多个角标、角标位置依赖原图的题不要使用 triangle_board 简化重画，直接使用来源错题的 source_image。
- 凡是题干已经把"由 X° 和 Y°（或一个直角与 Y°）拼接而成"这种关系写清楚、并且只问一个角的题，必须使用 triangle_board_composition 模板，禁止使用 source_image 原图。X、Y 取自 {30, 45, 60, 90}（"直角"视作 90°）。例如"∠1 由 30°+45° 拼接而成"应输出 [图:triangle_board_composition angles=75 relations=30+45 labels=1]。这类题不允许调用错题源里的原图作为配图。
- 当错题涉及"一副三角板"且为依赖原图的多角标题（∠1、∠2、∠3 这类）时，欢迎改编成下面这种程序可绘制的同类变式题（任选其一，不要照搬原题文字）：
  · "如图，将一副三角板的直角顶点重合摆放，∠AOB=90°，∠COD=90°，若∠AOD=X°，则重叠部分∠BOC=（  ）°。"（X 取 91~179 的整数，答案 = 180-X）
  · 同样可以反过来给 ∠BOC 求 ∠AOD。
  这类题必须在题干下一行单独输出图形标记，例如 [图:triangle_board_overlap aod=150 labels=A,B,C,D kind1=45 kind2=30] ，aod 必须等于题干里 ∠AOD 的数值，题干字母与图标记 labels 必须完全一致。这样能直接由模板渲染图形，无需 source_image。
- 复杂图可围绕同一张图调整问法、选项或已知条件，但不要声称生成了另一张新图。
  禁止创造新的图形类型；不在上述白名单里的图形一律使用 source_image。
  带图题必须沿用来源错题的图形场景生成同类题，不要把杯子叠放改成长方形纸条、不要把黑白瓷砖改成气球颜色规律。
  图形标记只放在题目区，不要放到答案解析区。
- 格式示例：
学生姓名：${childName(childId)}
年级：${source[0]?.grade || ""}
题量：${requestedCount || source.length} 题
难度：${input.difficulty || "中等"}
时间：20 分钟

一、选择题

1. 题干文字
A. 选项
B. 选项
C. 选项

参考答案与解析

1. 答案：A
解析：简要说明

如果某类题型数量为 0 或未指定，不要输出该题型小节。各题型小节标题使用“一、选择题”“二、填空题”“三、判断题”“四、问答题”等普通文本。

错题记录：
${source.map((item, index) => `【错题 ${index + 1}】
学科：${item.subject}
年级：${item.grade}
原题：${item.question}
选项：${(item.options || []).join("；") || "无"}
学生答案：${item.studentAnswer || "未提供"}
正确答案：${item.correctAnswer || "未提供"}
知识点：${(item.knowledgePoints || []).join("、") || "待提取"}
建议图形标记：${visualLineForRecord(item) || "无"}
解析：${item.analysis}`).join("\n\n")}`;

  let output = "";
  let generationWarning = "";

  if (aiConfig.apiKey) {
    try {
      output = await callModelMessages([
        { role: "system", content: "你是一个严谨的教研出卷老师。只输出最终试卷内容。" },
        { role: "user", content: prompt }
      ]);
    } catch (error) {
      logError("exam.paper.model.failed", error, { childId, requestedCount });
      throw new Error(`大模型生成失败：${error.message}`);
    }
  } else {
    generationWarning = "未配置模型密钥，已基于错题原题生成可下载练习卷。";
  }

  const rawContent = output
    ? normalizePaperContent(output)
    : buildFallbackExamContent(source, input, childId, requestedCount);
  const content = normalizeExamPaperVisuals(rawContent, source);
  const paper = {
    id: randomUUID(),
    userId,
    childId,
    title: `${childName(childId)}的错题巩固卷`,
    content,
    questions: bindPaperQuestions(content, source),
    weakKnowledgePoints: weakPoints,
    targetKnowledgePoints: reviewPoints,
    sourceMistakeIds: source.map((item) => item.id),
    generationWarning,
    createdAt: new Date().toISOString()
  };
  await writeExamPaperRecord(paper);
  return paper;
}

function stripMarkdownMarks(value) {
  return String(value || "")
    .replace(/^\s{0,3}#{1,6}\s*/, "")
    .replace(/^\s*[-*_]{3,}\s*$/, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[`´]/g, "")
    .replace(/^#+\s*/, "")
    .replace(/#+/g, "")
    .replace(/\s*---+\s*/g, "")
    .replace(/\s*\*\*\s*/g, "")
    .replace(/[~～]\s*[＿_]+|[＿_]+\s*[~～]|[＿_]+|[~～]+/g, PDF_BLANK_PLACEHOLDER)
    .replace(/^\s*[-*]\s+/, "");
}

function normalizePdfText(value) {
  return String(value || "")
    .replace(/（\s*）/g, PDF_BLANK_PLACEHOLDER)
    .replace(/（/g, "(")
    .replace(/）/g, ")");
}

function cleanPaperLine(line) {
  const raw = String(line || "").trimEnd();
  if (/^\s*\[图:/i.test(raw)) return raw.trim();
  return stripMarkdownMarks(raw)
    .replace(/^\s*[-*]\s+/, "")
    .trimEnd();
}

function splitPaperLines(content) {
  const lines = String(content || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(cleanPaperLine);

  return lines.filter((line, index) => {
    if (line.trim()) return true;
    return lines[index - 1]?.trim() && lines[index + 1]?.trim();
  });
}

function normalizePaperContent(content) {
  return splitPaperLines(content)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isInlineAnswerLine(line) {
  return /^(答案|参考答案|解析|答案解析|对应知识点|知识点)\s*[:：]/.test(line.trim());
}

function isAnswerSectionLine(line) {
  return /^(参考答案与解析|参考答案|答案解析)\s*$/.test(line.trim());
}

function normalizeExamTypeCounts(input = {}) {
  const keys = [
    ["choiceCount", "选择题"],
    ["blankCount", "填空题"],
    ["judgeCount", "判断题"],
    ["qaCount", "问答题"]
  ];
  const items = keys
    .map(([key, label]) => ({ key, label, count: Number(input[key]) }))
    .filter((item) => Number.isInteger(item.count) && item.count > 0);
  const total = items.reduce((sum, item) => sum + item.count, 0);

  return { items, total };
}

function isDrawableVisualKind(kind = "") {
  return registryIsDrawableVisualKind(kind);
}

function isSupportedVisualKind(kind = "") {
  return registryIsSupportedVisualKind(kind);
}

function visualKindMatchesSource(kind = "", source = "") {
  const type = String(kind || "").toLowerCase();
  const text = String(source || "");
  if (!text.trim()) return false;
  if (type === "clock") return /钟面|分针|时整|点钟|钟表|时针.*分针|分针.*时针/.test(text);
  if (type === "triangle_board") return canUseTriangleBoardTemplate(text);
  if (type === "triangle_board_composition") return isTriangleBoardCompositionText(text);
  if (type === "triangle_board_overlap") return isTriangleBoardOverlapText(text);
  if (type === "pattern") return /规律|序列|气球|颜色|排列|第\s*\d+\s*个|红|蓝|绿|黄|紫|橙/.test(text);
  if (type === "tile_pattern") return /黑白|黑砖|白砖|瓷砖|方块|方格|正方形|矩形地面/.test(text);
  if (type === "overlap_rect") return isOverlapRectText(text);
  if (type === "stack_cups") return /杯子/.test(text) && /叠起来|叠放|摞起来|高度/.test(text);
  if (type === "rect_path") return /长方形.*ABCD|ABCD.*长方形|点P|沿.*边|路径|A\s*[→>-]\s*D|逆时针/.test(text);
  return visualKindMatchesRegistry(type, text);
}

function isTriangleBoardOverlapText(text = "") {
  const value = String(text || "");
  if (!/三角板/.test(value)) return false;
  const hasSharedVertex = /(?:直角顶点|顶点)\s*(?:重合|重叠|共点|相重合|重叠在一起|重叠摆放)/.test(value);
  const hasPlacementContext = /一副三角板|按图示|按图所示|图示方式|图所示摆放/.test(value);
  const twoRightAngleMarkers = (value.match(/∠\s*[A-Z]\s*O\s*[A-Z]\s*[=＝]\s*90\s*°?/g) || []).length >= 2;
  // 接受两种形式：外角 ∠AOD ∈ (90,180)，或内角 ∠BOC ∈ (0,90)（可反算 aod=180-内角）
  const hasOverlapAngleValue = [...value.matchAll(/∠\s*[A-Z]\s*O\s*[A-Z]\s*[=＝]\s*(\d{1,3})\s*°/g)]
    .map((match) => Number(match[1]))
    .some((angle) => (angle > 0 && angle < 90) || (angle > 90 && angle < 180));
  if (!hasOverlapAngleValue) return false;
  return hasSharedVertex || (hasPlacementContext && twoRightAngleMarkers);
}

function triangleBoardOverlapAttrs(attrs = {}, source = "") {
  const text = String(source || "");
  const fourLetterMatches = [...text.matchAll(/∠\s*([A-Z])\s*O\s*([A-Z])\s*[=＝]\s*(\d{1,3})\s*°/g)]
    .map((match) => ({
      a: match[1].toUpperCase(),
      b: match[2].toUpperCase(),
      value: Number(match[3])
    }))
    .filter((item) => item.value > 0 && item.value <= 180);

  const right = fourLetterMatches.filter((item) => item.value === 90);
  const outerCandidates = fourLetterMatches.filter((item) => item.value > 90 && item.value < 180);
  const innerCandidates = fourLetterMatches.filter((item) => item.value > 0 && item.value < 90);

  let aod = Number(String(attrs.aod || "").match(/\d{2,3}/)?.[0]);
  if (!Number.isFinite(aod) || aod < 91 || aod > 179) {
    if (outerCandidates.length) aod = outerCandidates[0].value;
    else if (innerCandidates.length) aod = 180 - innerCandidates[0].value;
  }
  if (!Number.isFinite(aod) || aod < 91 || aod > 179) {
    const bocCandidate = Number(String(attrs.boc || "").match(/\d{1,3}/)?.[0]);
    if (Number.isFinite(bocCandidate) && bocCandidate > 0 && bocCandidate < 90) aod = 180 - bocCandidate;
  }
  if (!Number.isFinite(aod) || aod < 91 || aod > 179) aod = 150;

  let labels = String(attrs.labels || "")
    .split(/[,，]/)
    .map((item) => item.trim().toUpperCase())
    .filter((item) => /^[A-Z]$/.test(item))
    .slice(0, 4);

  if (labels.length < 4 && right.length >= 2 && outerCandidates.length) {
    const outer = outerCandidates[0];
    const r1 = right[0];
    const r2 = right[1];
    const r1Other = r1.a === outer.a ? r1.b : (r1.b === outer.a ? r1.a : null);
    const r2Other = r2.a === outer.b ? r2.b : (r2.b === outer.b ? r2.a : null);
    if (r1Other && r2Other) labels = [outer.a, r1Other, r2Other, outer.b];
  } else if (labels.length < 4 && right.length >= 2 && innerCandidates.length) {
    // 题文只给内角 ∠BOC=X°：内角两端点是 B 和 C
    const inner = innerCandidates[0];
    const r1 = right[0];
    const r2 = right[1];
    // ∠AOB=90 包含 inner.a (=B) 与 outer A；∠COD=90 包含 inner.b (=C) 与 outer D
    const aLetter = r1.a === inner.a ? r1.b : (r1.b === inner.a ? r1.a : null);
    const dLetter = r2.a === inner.b ? r2.b : (r2.b === inner.b ? r2.a : null);
    if (aLetter && dLetter) labels = [aLetter, inner.a, inner.b, dLetter];
  }

  while (labels.length < 4) labels.push(["A", "B", "C", "D"][labels.length]);
  labels = labels.slice(0, 4);

  const kind1 = String(attrs.kind1 || "").match(/30|45|60/)?.[0] || "45";
  const kind2 = String(attrs.kind2 || "").match(/30|45|60/)?.[0] || "30";

  return {
    aod: clampNumber(aod, 91, 179),
    labels,
    kind1,
    kind2
  };
}

function isOverlapRectText(text = "") {
  const value = String(text || "");
  const hasPaperStrip = /纸条|纸带|长方形纸|矩形纸/.test(value);
  const hasOverlapAction = /重叠|重合|粘贴|首尾相接/.test(value);
  const hasLengthClue = /总长度|总长|长\s*\d+|宽\s*\d+|\d+\s*(?:厘米|cm)/i.test(value);
  return hasPaperStrip && (hasOverlapAction || /总长度|总长/.test(value)) && hasLengthClue;
}

function isComplexTriangleBoardText(text = "") {
  const value = String(text || "");
  const angleRefs = (value.match(/∠\s*\d/g) || []).length;
  const hasTriangleBoard = /三角板|∠/.test(value);
  const hasPlacement = /一副三角板|三角板.*(?:拼成|拼接|摆放|组合)|(?:拼成|拼接|摆放|组合).*三角板/.test(value);
  const asksMultipleUnknownAngles = angleRefs >= 2 || /∠\s*1.*∠\s*2|∠\s*2.*∠\s*3/.test(value);
  const imageDependent = /如下图|如图|下图|图中/.test(value) && hasTriangleBoard && /拼成|拼接|摆放|组合|∠\s*\d/.test(value);
  return hasPlacement || asksMultipleUnknownAngles || imageDependent;
}

function isTriangleBoardCompositionText(text = "") {
  return isSafeTriangleBoardCompositionText(text);
}

function stripBoardDescriptors(text = "") {
  // 题文里"含 30°角的直角三角板"、"等腰直角三角板"等是描述三角板类型的修饰短语，
  // 它们里的数字（如 30°）不是参与拼角的角度，需要剔除避免误抓。
  // "三角板的 45°角"这种结构里的 45° 才是真正参与拼角的角度，必须保留。
  return String(text || "")
    .replace(/含\s*有?\s*\d{1,3}\s*°\s*角(?:的)?/g, "")
    .replace(/(?:一?\s*副\s*)?(?:等腰\s*)?直角\s*三角板/g, "")
    .replace(/三角板/g, "")
    .replace(/直角/g, "90°");
}

function isSafeTriangleBoardCompositionText(text = "") {
  const value = String(text || "");
  if (!/三角板/.test(value)) return false;
  const hasComposition = /一副三角板|拼成|拼接|摆放|叠放|重合|重叠|组合/.test(value);
  const angleRefs = [...new Set((value.match(/∠\s*(?:\d|α|β)/g) || []).map((item) => item.replace(/\s+/g, "")))];
  const asksMultipleAngles = angleRefs.length >= 2 || /∠\s*1.*∠\s*2|∠\s*2.*∠\s*3|∠\s*1[、,，]\s*∠\s*2|计算.*∠\s*1.*∠\s*2/.test(value);
  const allowedAngles = new Set([30, 45, 60, 90]);
  const normalized = stripBoardDescriptors(value);
  const combine = /(\d{1,3})\s*°[^0-9°]{0,16}(?:和|与|加|[+＋]|拼|连同|相加)[^0-9°]{0,16}(\d{1,3})\s*°/.exec(normalized);
  const subtract = /(\d{1,3})\s*°[^0-9°]{0,16}(?:减去?|差|[-－])[^0-9°]{0,16}(\d{1,3})\s*°/.exec(normalized);
  const bigSmall = /大角\s*(?:为|是|=)?\s*(\d{1,3})\s*°[\s\S]{0,40}?小角\s*(?:为|是|=)?\s*(\d{1,3})\s*°[\s\S]{0,40}?(?:差|差角|差是|相差)/.exec(normalized);
  const isAllowedPair = (match) => match && allowedAngles.has(Number(match[1])) && allowedAngles.has(Number(match[2]));
  // 兜底：题文里同时出现 2 个允许角度 + "差|减|和|加" 关键词，宽松命中
  const looseRelation = (() => {
    const nums = [...normalized.matchAll(/(\d{1,3})\s*°/g)].map((m) => Number(m[1])).filter((n) => allowedAngles.has(n));
    const uniq = [...new Set(nums)];
    if (uniq.length < 2) return null;
    const hasSubKw = /(?:差|减去?|相减|之差|相差)/.test(value);
    const hasAddKw = /(?:和|加|拼接|拼成|相加|拼出|组成|合起来)/.test(value);
    if (hasSubKw || hasAddKw) return { type: hasSubKw ? "sub" : "add", values: uniq };
    return null;
  })();
  const hasExplicitRelation =
    isAllowedPair(combine) ||
    isAllowedPair(subtract) ||
    isAllowedPair(bigSmall) ||
    Boolean(looseRelation) ||
    /(?:平角|180\s*°?).*(?:减|差|[-－])\s*45\s*°?/.test(value) ||
    /最小锐角|含\s*30\s*°?\s*角.*最小/.test(value);
  return hasComposition && hasExplicitRelation && !asksMultipleAngles;
}

function canUseTriangleBoardTemplate(text = "") {
  const value = String(text || "");
  if (!/三角板|拼角/.test(value)) return false;
  if (isComplexTriangleBoardText(value)) return false;
  return extractAnglesFromText(value).length > 0 && !/如下图|如图|下图|图中/.test(value);
}

function sourceTextForRecord(record = {}) {
  return [
    record.question,
    record.visualType,
    record.visualComplexity,
    record.visualRenderStrategy,
    record.supportedTemplate,
    record.visualDescription,
    record.visualMarker,
    record.analysis,
    ...(record.knowledgePoints || [])
  ].join("\n");
}

function attachmentIsMistakeCrop(attachment = {}) {
  if (!attachment || typeof attachment !== "object") return false;
  return Boolean(
    attachment.kind === "mistake_crop" ||
      attachment.crop?.url ||
      (attachment.original?.url && attachment.url && attachment.url !== attachment.original.url)
  );
}

function sourceImageVisualLine(record = {}, options = {}) {
  const allowOriginal = options.allowOriginal !== false;
  const visual = parseVisualLine(record.visualMarker || "");
  if (visual && (visual.kind === "source_image" || visual.kind === "original_crop")) {
    const markerUrl = toCleanString(visual.attrs.url || visual.attrs.src || visual.attrs.href);
    if (markerUrl && (allowOriginal || markerUrl !== record.sourceAttachment?.original?.url)) return `[图:source_image url=${markerUrl}]`;
  }
  const attachment = record.sourceAttachment || {};
  if (!allowOriginal && !attachmentIsMistakeCrop(attachment)) return "";
  const url = toCleanString(attachment.enhanced?.url || attachment.crop?.enhanced?.url || attachment.crop?.url || attachment.url);
  return url ? `[图:source_image url=${url}]` : "";
}

function sourceCropVisualLine(record = {}) {
  return sourceImageVisualLine(record, { allowOriginal: false });
}

function sourceImageUrlsForRecord(record = {}) {
  const attachment = record.sourceAttachment || {};
  return new Set([
    attachment.enhanced?.url,
    attachment.crop?.enhanced?.url,
    attachment.crop?.url,
    attachment.url
  ].map(toCleanString).filter(Boolean));
}

function sourceImageUrlAllowed(url = "", record = {}) {
  const cleanUrl = toCleanString(url);
  if (!cleanUrl || !attachmentIsMistakeCrop(record.sourceAttachment || {})) return false;
  return sourceImageUrlsForRecord(record).has(cleanUrl);
}

function hasExplicitDrawableVisual(record = {}) {
  const visual = parseVisualLine(record.visualMarker || "");
  return Boolean(visual && isDrawableVisualKind(visual.kind) && visualKindMatchesSource(visual.kind, sourceTextForRecord(record)));
}

function sourceNeedsOriginalImage(record = {}) {
  if (!sourceCropVisualLine(record) || hasExplicitDrawableVisual(record)) return false;
  const text = sourceTextForRecord(record);
  const visual = parseVisualLine(record.visualMarker || "");
  return (
    String(record.visualRenderStrategy || "").toLowerCase() === "source_crop" ||
    String(record.visualComplexity || "").toLowerCase() === "complex_image" ||
    ["geometry", "other", "source_image", "original_crop"].includes(String(record.visualType || "").toLowerCase()) ||
    (visual && !isDrawableVisualKind(visual.kind)) ||
    /下图|如图|图中|图形|阴影|圆点|重叠|拼接|组合|折叠|摆放|拼成/.test(text)
  );
}

function visualLineForRecord(record) {
  const text = sourceTextForRecord(record);
  if (record.visualMarker) {
    const normalized = normalizeVisualMarker(record.visualMarker, text);
    if (normalized) return normalized;
    const sourceLine = sourceCropVisualLine(record);
    if (sourceLine) return sourceLine;
  }
  const inferred = visualLineForText(text);
  if (inferred) return inferred;
  if (sourceNeedsOriginalImage(record)) return sourceCropVisualLine(record);
  return "";
}

function visualLineForGeneratedQuestion(questionText = "", sourceRecord = {}) {
  const text = String(questionText || "");
  const inferred = visualLineForText(text);
  if (inferred) return inferred;
  if (!questionNeedsVisual(text)) return "";

  const sourceVisual = parseVisualLine(visualLineForRecord(sourceRecord));
  if (sourceVisual && isDrawableVisualKind(sourceVisual.kind) && visualKindMatchesSource(sourceVisual.kind, text)) {
    return normalizeVisualMarker(`[图:${sourceVisual.kind} ${Object.entries(sourceVisual.attrs || {}).map(([key, value]) => `${key}=${value}`).join(" ")}]`, text);
  }

  return sourceImageMatchesGeneratedQuestion(text, sourceRecord) ? sourceCropVisualLine(sourceRecord) : "";
}

function sourceImageMatchesGeneratedQuestion(questionText = "", sourceRecord = {}) {
  const question = String(questionText || "");
  if (!questionNeedsVisual(question)) return false;
  const sourceText = sourceTextForRecord(sourceRecord);
  const sourceVisual = parseVisualLine(visualLineForText(sourceText) || visualLineForRecord(sourceRecord));
  if (sourceVisual && isDrawableVisualKind(sourceVisual.kind)) {
    return visualKindMatchesSource(sourceVisual.kind, question);
  }
  if (/三角板/.test(sourceText)) return /三角板/.test(question) && /如图|下图|图中/.test(question);
  if (isOverlapRectText(sourceText)) return isOverlapRectText(question);
  if (/钟面|时针|分针/.test(sourceText)) return visualKindMatchesSource("clock", question);
  if (/黑白|瓷砖|方块|方格/.test(sourceText)) return visualKindMatchesSource("tile_pattern", question);
  if (/杯子/.test(sourceText)) return visualKindMatchesSource("stack_cups", question);
  return false;
}

function visualLineForText(text) {
  if (/黑白|黑砖|白砖|瓷砖|方块|方格|正方形/.test(text)) {
    const attrs = tilePatternAttrs({}, text);
    return `[图:tile_pattern black=${attrs.black.join(",")} rows=${attrs.rows}]`;
  }

  if (/杯子/.test(text) && /叠起来|叠放|摞起来|高度/.test(text)) {
    const attrs = stackCupsAttrs({}, text);
    return `[图:stack_cups count=${attrs.count} first_height=${attrs.firstHeight} step=${attrs.step}]`;
  }

  if (/长方形.*ABCD|ABCD.*长方形|点P|沿.*边|路径|A\s*[→>-]\s*D|逆时针/.test(text)) {
    const attrs = rectPathAttrs({}, text);
    return `[图:rect_path width=${attrs.width} height=${attrs.height} path=${attrs.path}]`;
  }

  if (isOverlapRectText(text)) {
    const attrs = overlapRectAttrs({}, text);
    return `[图:overlap_rect count=${attrs.count} length=${attrs.length} width=${attrs.width} overlap=${attrs.overlap}]`;
  }

  if (/钟面|分针|时整|点钟|钟表|时针.*分针|分针.*时针/.test(text)) {
    const hour = Number(text.match(/(\d{1,2})\s*(?:时|点)/)?.[1] || 5);
    const minute = Number(text.match(/(\d{1,2})\s*分/)?.[1] || 0);
    const angle = Number(text.match(/(\d{2,3})\s*°/)?.[1] || "");
    return `[图:clock hour=${Math.max(1, Math.min(12, hour || 5))} minute=${Math.max(0, Math.min(59, minute || 0))}${angle ? ` angle=${angle}` : ""}]`;
  }

  if (isTriangleBoardOverlapText(text)) {
    const attrs = triangleBoardOverlapAttrs({}, text);
    return `[图:triangle_board_overlap aod=${attrs.aod} labels=${attrs.labels.join(",")} kind1=${attrs.kind1} kind2=${attrs.kind2}]`;
  }

  if (isTriangleBoardCompositionText(text)) {
    const attrs = triangleBoardCompositionAttrs({}, text);
    return `[图:triangle_board_composition angles=${attrs.angles.join(",")} relations=${attrs.relations.join(",")} labels=${attrs.labels.join(",")}]`;
  }

  if (canUseTriangleBoardTemplate(text)) {
    const angles = extractAnglesFromText(text);
    return `[图:triangle_board angles=${(angles.length ? angles : [75, 135, 150]).join(",")}]`;
  }

  if (/规律|气球|颜色|排列/.test(text)) {
    const colors = [...text.matchAll(/[红蓝绿黄紫橙]/g)].map((match) => match[0]).slice(0, 8);
    if (colors.length >= 2) return `[图:pattern sequence=${colors.join(",")}]`;
  }

  return "";
}

function nextMeaningfulLine(lines, startIndex) {
  for (let i = startIndex; i < lines.length; i += 1) {
    const text = String(lines[i] || "").trim();
    if (text) return text;
  }
  return "";
}

function questionNeedsVisual(text = "") {
  return /如图|下图|图中|图形|第\d+个图形|观察图|看图/.test(String(text || ""));
}

function normalizeExamPaperVisuals(content, source = []) {
  const lines = splitPaperLines(normalizePaperContent(content));
  const output = [];
  let inAnswerSection = false;
  let questionIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const text = line.trim();

    if (isAnswerSectionLine(text)) {
      inAnswerSection = true;
      output.push(line);
      continue;
    }

    if (inAnswerSection || isInlineAnswerLine(text)) {
      output.push(line);
      continue;
    }

    const visual = parseVisualLine(text);
    if (visual) {
      const sourceRecord = source[Math.max(0, questionIndex) % Math.max(1, source.length)] || {};
      const previousQuestion = [...output].reverse().find((item) => isQuestionLine(String(item || "").trim())) || "";
      const normalized = normalizeVisualMarker(text, previousQuestion || sourceTextForRecord(sourceRecord));
      const normalizedVisual = parseVisualLine(normalized);
      if (normalizedVisual && isSupportedVisualKind(normalizedVisual.kind)) {
        if (normalizedVisual.kind === "source_image") {
          const inferredLine = visualLineForGeneratedQuestion(previousQuestion, sourceRecord);
          const inferredVisual = parseVisualLine(inferredLine);
          if (inferredVisual && inferredVisual.kind !== "source_image") {
            output.push(inferredLine);
          } else if (
            !sourceImageUrlAllowed(normalizedVisual.attrs.url || normalizedVisual.attrs.src || "", sourceRecord) ||
            !sourceImageMatchesGeneratedQuestion(previousQuestion, sourceRecord)
          ) {
            const sourceLine = sourceCropVisualLine(sourceRecord);
            if (sourceLine && sourceImageMatchesGeneratedQuestion(previousQuestion, sourceRecord)) output.push(sourceLine);
            else removeImageCueFromLastQuestion(output);
          } else {
            output.push(normalized);
          }
        } else {
          output.push(normalized);
        }
      } else {
        const sourceLine = sourceCropVisualLine(sourceRecord);
        if (sourceLine && questionNeedsVisual(previousQuestion)) output.push(sourceLine);
      }
      continue;
    }

    if (isQuestionLine(text)) {
      questionIndex += 1;
      const sourceRecord = source[questionIndex % Math.max(1, source.length)] || {};
      const nextLine = nextMeaningfulLine(lines, index + 1);
      const missingVisual = !parseVisualLine(nextLine);
      const visualLine = visualLineForGeneratedQuestion(text, sourceRecord);
      output.push(missingVisual && !visualLine ? removeImageCueFromQuestion(line) : line);
      if (missingVisual && visualLine) {
        output.push(visualLine);
      }
      continue;
    }

    output.push(line);
  }

  return normalizePaperContent(output.join("\n"));
}

function removeImageCueFromQuestion(line = "") {
  return String(line || "")
    .replace(/如下图[，,：:]?/g, "")
    .replace(/如图[，,：:]?/g, "")
    .replace(/下图[，,：:]?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function removeImageCueFromLastQuestion(lines = []) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (isQuestionLine(String(lines[index] || "").trim())) {
      lines[index] = removeImageCueFromQuestion(lines[index]);
      return;
    }
  }
}

function parseVisualLine(line = "") {
  const matched = String(line).trim().match(/^\[图:([a-z_]+)\s*([^\]]*)\]$/i);
  if (!matched) return null;

  const attrs = {};
  for (const part of matched[2].trim().split(/\s+/).filter(Boolean)) {
    const [key, ...rest] = part.split("=");
    if (!key || !rest.length) continue;
    attrs[key] = rest.join("=");
  }

  return { kind: matched[1], attrs };
}

function colorValue(name = "") {
  const key = String(name).trim();
  return {
    红: "#ef4444",
    蓝: "#3b82f6",
    绿: "#22c55e",
    黄: "#f59e0b",
    紫: "#8b5cf6",
    橙: "#f97316"
  }[key] || "#94a3b8";
}

function isPaperSection(line) {
  return /^(试卷标题|答案|参考答案|解析|答案解析|知识点|一[、. ]|二[、. ]|三[、. ]|四[、. ]|五[、. ])/.test(line.trim());
}

function isQuestionLine(line) {
  return /^\d+\s*[.、]\s*/.test(line.trim());
}

function isOptionLine(line) {
  return /^[A-H][.、]\s*/i.test(line.trim());
}

function isMetaLine(line) {
  return /^(学生姓名|姓名|班级|年级|题量|难度|时间|学科|科目)\s*[:：]/.test(line.trim());
}

function ensurePdfSpace(doc, height = 72) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + height > bottom) doc.addPage();
}

function resetPdfCursor(doc, x, y) {
  doc.x = x;
  doc.y = y;
}

function drawPdfClock(doc, visual) {
  const startX = doc.x;
  const hour = Number(visual.attrs.hour || 5);
  const minute = Number(visual.attrs.minute || 0);
  const angle = visual.attrs.angle ? `${visual.attrs.angle}°` : "";
  const radius = 42;
  const x = startX + radius + 8;
  const y = doc.y + radius + 8;
  const hourAngle = ((hour % 12) + minute / 60) * 30 - 90;
  const minuteAngle = minute * 6 - 90;
  const point = (deg, length) => ({
    x: x + Math.cos((deg * Math.PI) / 180) * length,
    y: y + Math.sin((deg * Math.PI) / 180) * length
  });

  doc.save();
  doc.circle(x, y, radius).lineWidth(1.2).strokeColor("#94a3b8").stroke();
  for (let i = 1; i <= 12; i += 1) {
    const p = point(i * 30 - 90, radius - 10);
    doc.fontSize(7).fillColor("#334155").text(String(i), p.x - 4, p.y - 4, { width: 8, align: "center" });
  }
  const hp = point(hourAngle, 23);
  const mp = point(minuteAngle, 34);
  doc.moveTo(x, y).lineTo(hp.x, hp.y).lineWidth(3).strokeColor("#0f172a").stroke();
  doc.moveTo(x, y).lineTo(mp.x, mp.y).lineWidth(2).strokeColor("#2563eb").stroke();
  doc.circle(x, y, 3).fillColor("#2563eb").fill();
  if (angle) doc.fontSize(9).fillColor("#2563eb").text(angle, x + 16, y - 13);
  doc.restore();
  resetPdfCursor(doc, startX, y + radius + 14);
}

function drawPdfTriangleBoard(doc, visual) {
  const startX = doc.x;
  const angles = String(visual.attrs.angles || "75,135,150").split(",").filter(Boolean).slice(0, 3);
  const x = startX + 8;
  const y = doc.y + 8;
  doc.save();
  [
    [[x, y + 70], [x + 86, y + 70], [x + 44, y + 12]],
    [[x + 116, y + 12], [x + 196, y + 70], [x + 116, y + 70]],
    [[x + 228, y + 70], [x + 316, y + 70], [x + 276, y + 18]]
  ].forEach((points, index) => {
    doc.polygon(...points).lineWidth(1).fillOpacity(0.16).fillAndStroke("#dbeafe", "#64748b").fillOpacity(1);
    doc.circle(points[2][0], points[2][1] + 10, 5).fillColor("#ffffff").fill().strokeColor("#64748b").stroke();
    doc.fontSize(9).fillColor("#2563eb").text(`∠${index + 1}=${angles[index] || "?"}°`, points[0][0] + 14, points[0][1] + 8);
  });
  doc.restore();
  resetPdfCursor(doc, startX, y + 96);
}

function drawPdfTriangleBoardComposition(doc, visual) {
  const startX = doc.x;
  const attrs = triangleBoardCompositionAttrs(visual.attrs);
  const x = startX + 10;
  const y = doc.y + 12;
  const panelWidth = 108;
  const gap = 18;

  doc.save();
  attrs.angles.forEach((angle, index) => {
    const left = x + index * (panelWidth + gap);
    const top = y;
    const vertex = [left + 48, top + 74];
    const first = [
      [left + 12, top + 74],
      vertex,
      [left + 48, top + 20]
    ];
    const second = [
      vertex,
      [left + 94, top + 74],
      [left + 78, top + 28]
    ];
    const relation = attrs.relations[index] || "";
    const label = attrs.labels[index] || index + 1;

    doc.roundedRect(left, top, panelWidth, 94, 4).lineWidth(0.6).strokeColor("#dbeafe").stroke();
    doc.polygon(...first).lineWidth(1).fillOpacity(0.2).fillAndStroke("#bfdbfe", "#64748b").fillOpacity(1);
    doc.polygon(...second).lineWidth(1).fillOpacity(0.18).fillAndStroke("#bbf7d0", "#64748b").fillOpacity(1);
    doc.moveTo(vertex[0], vertex[1]).lineTo(left + 48, top + 20).lineWidth(1.6).strokeColor("#2563eb").stroke();
    doc.moveTo(vertex[0], vertex[1]).lineTo(left + 78, top + 28).lineWidth(1.6).strokeColor("#16a34a").stroke();
    doc.circle(vertex[0], vertex[1], 3).fillColor("#2563eb").fill();
    doc.fontSize(8).fillColor("#0f172a").text(`∠${label}`, left + 18, top + 48, { width: 26, align: "center" });
    doc.fontSize(8).fillColor("#2563eb").text(`${angle}°`, left + 62, top + 48, { width: 34, align: "center" });
    if (relation) doc.fontSize(7).fillColor("#64748b").text(relation, left + 24, top + 80, { width: 60, align: "center" });
  });
  doc.restore();
  resetPdfCursor(doc, startX, y + 106);
}

function drawPdfPattern(doc, visual) {
  const startX = doc.x;
  const sequence = String(visual.attrs.sequence || "红,红,蓝,绿").split(",").filter(Boolean).slice(0, 10);
  const x = startX + 8;
  const y = doc.y + 24;
  doc.save();
  sequence.forEach((name, index) => {
    const cx = x + index * 34;
    doc.circle(cx, y, 12).fillColor(colorValue(name)).fill().strokeColor("#64748b").stroke();
    doc.moveTo(cx, y + 12).lineTo(cx - 3, y + 24).lineTo(cx + 3, y + 24).strokeColor("#94a3b8").stroke();
    doc.fontSize(7).fillColor("#0f172a").text(name, cx - 8, y - 4, { width: 16, align: "center" });
  });
  doc.fontSize(12).fillColor("#94a3b8").text("...", x + sequence.length * 34 + 4, y - 7);
  doc.restore();
  resetPdfCursor(doc, startX, y + 42);
}

function drawPdfTilePattern(doc, visual) {
  const startX = doc.x;
  const attrs = tilePatternAttrs(visual.attrs);
  const blackCounts = attrs.black.slice(0, 4);
  const rows = attrs.rows;
  const tile = 12;
  const gap = 1.5;
  const blockGap = 20;
  const maxCols = Math.max(...blackCounts.map((count) => Math.ceil(count / rows)), 3);
  const blockWidth = maxCols * (tile + gap) + 8;
  const y = doc.y + 14;

  doc.save();
  blackCounts.forEach((black, groupIndex) => {
    const x0 = startX + 8 + groupIndex * (blockWidth + blockGap);
    const cols = Math.ceil(black / rows);
    for (let index = 0; index < rows * cols; index += 1) {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const isBlack = index < black;
      doc.rect(x0 + col * (tile + gap), y + row * (tile + gap), tile, tile)
        .lineWidth(0.6)
        .fillAndStroke(isBlack ? "#0f172a" : "#f8fafc", "#64748b");
    }
    doc.fontSize(7).fillColor("#334155").text(`第${groupIndex + 1}个：${black}块黑砖`, x0 - 2, y + rows * (tile + gap) + 8, {
      width: blockWidth + 8,
      align: "center"
    });
  });
  doc.fontSize(12).fillColor("#94a3b8").text("...", startX + 12 + blackCounts.length * (blockWidth + blockGap), y + 8);
  doc.restore();
  resetPdfCursor(doc, startX, y + rows * (tile + gap) + 32);
}

function drawPdfOverlapRect(doc, visual) {
  const startX = doc.x;
  const attrs = overlapRectAttrs(visual.attrs);
  const count = Math.min(8, attrs.count);
  const rectWidth = 88;
  const rectHeight = Math.max(26, Math.min(54, rectWidth * (attrs.width / attrs.length)));
  const step = rectWidth * Math.max(0.18, (attrs.length - attrs.overlap) / attrs.length);
  const x = startX + 12;
  const y = doc.y + 22;

  doc.save();
  for (let index = 0; index < count; index += 1) {
    const rx = x + index * step;
    doc.roundedRect(rx, y, rectWidth, rectHeight, 3)
      .lineWidth(1)
      .fillOpacity(0.24)
      .fillAndStroke(index % 2 ? "#eff6ff" : "#dbeafe", "#64748b")
      .fillOpacity(1);
    doc.fontSize(7).fillColor("#334155").text(`第${index + 1}张`, rx + 20, y + rectHeight / 2 - 4, { width: 46, align: "center" });
  }

  doc.moveTo(x, y - 8).lineTo(x + rectWidth, y - 8).lineWidth(1).strokeColor("#0f172a").stroke();
  doc.fontSize(8).fillColor("#0f172a").text(`长 ${attrs.length}`, x + rectWidth / 2 - 18, y - 22, { width: 36, align: "center" });
  if (attrs.overlap > 0 && count > 1) {
    doc.moveTo(x + step, y + rectHeight + 12).lineTo(x + rectWidth, y + rectHeight + 12).lineWidth(1).strokeColor("#2563eb").stroke();
    doc.fontSize(8).fillColor("#2563eb").text(`重叠 ${attrs.overlap}`, x + step + (rectWidth - step) / 2 - 24, y + rectHeight + 16, { width: 48, align: "center" });
  }
  doc.fontSize(8).fillColor("#64748b").text(`共 ${attrs.count} 张，每张宽 ${attrs.width}`, x, y + rectHeight + 34, { width: 220 });
  doc.restore();
  resetPdfCursor(doc, startX, y + rectHeight + 56);
}

function drawPdfStackCups(doc, visual) {
  const startX = doc.x;
  const attrs = stackCupsAttrs(visual.attrs);
  const count = Math.min(8, attrs.count);
  const cupWidth = 40;
  const cupHeight = 30;
  const offset = 9;
  const x = startX + 26;
  const yBase = doc.y + 78;
  const totalHeight = attrs.firstHeight + (attrs.count - 1) * attrs.step;

  doc.save();
  for (let index = 0; index < count; index += 1) {
    const y = yBase - index * offset;
    doc.moveTo(x, y)
      .lineTo(x + cupWidth, y)
      .lineTo(x + cupWidth - 7, y + cupHeight)
      .lineTo(x + 7, y + cupHeight)
      .closePath()
      .lineWidth(1)
      .fillAndStroke("#dbeafe", "#64748b");
    doc.ellipse(x + cupWidth / 2, y, cupWidth / 2, 5).fillAndStroke("#eff6ff", "#64748b");
  }
  doc.moveTo(x + cupWidth + 22, yBase - (count - 1) * offset - 5).lineTo(x + cupWidth + 22, yBase + cupHeight).lineWidth(1).strokeColor("#2563eb").stroke();
  doc.fontSize(8).fillColor("#2563eb").text(`约 ${totalHeight} 高`, x + cupWidth + 30, yBase - (count - 1) * offset + 2, { width: 80 });
  doc.fontSize(8).fillColor("#64748b").text(`共 ${attrs.count} 个杯子，每增加一个约增高 ${attrs.step}`, x, yBase + cupHeight + 12, { width: 240 });
  doc.restore();
  resetPdfCursor(doc, startX, yBase + cupHeight + 34);
}

function drawPdfRectPath(doc, visual) {
  const startX = doc.x;
  const attrs = rectPathAttrs(visual.attrs);
  const width = 150;
  const height = Math.max(68, Math.min(110, width * (attrs.height / attrs.width)));
  const x = startX + 24;
  const y = doc.y + 18;
  const points = {
    A: [x, y],
    B: [x + width, y],
    C: [x + width, y + height],
    D: [x, y + height]
  };
  const path = String(attrs.path || "A-D-C-B").split("-").filter(Boolean);

  doc.save();
  doc.rect(x, y, width, height).lineWidth(1.2).fillAndStroke("#f8fafc", "#64748b");
  if (path.length > 1) {
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = points[path[index]];
      const to = points[path[index + 1]];
      if (!from || !to) continue;
      doc.moveTo(from[0], from[1]).lineTo(to[0], to[1]).lineWidth(2).strokeColor("#2563eb").stroke();
    }
  }
  Object.entries(points).forEach(([name, point]) => {
    doc.circle(point[0], point[1], 3).fillColor("#2563eb").fill();
    doc.fontSize(8).fillColor("#334155").text(name, point[0] + (name === "A" || name === "D" ? -14 : 6), point[1] + (name === "A" || name === "B" ? -15 : 6), { width: 18 });
  });
  doc.fontSize(8).fillColor("#64748b").text(`AB=${attrs.width}`, x + width / 2 - 16, y - 16, { width: 36, align: "center" });
  doc.fontSize(8).fillColor("#64748b").text(`BC=${attrs.height}`, x + width + 8, y + height / 2 - 5, { width: 48 });
  doc.fontSize(8).fillColor("#2563eb").text(`路径：${path.join("→")}`, x, y + height + 18, { width: 220 });
  doc.restore();
  resetPdfCursor(doc, startX, y + height + 42);
}

function outputFilePathFromUrl(url = "") {
  const cleanPath = decodeURIComponent(String(url || "").split(/[?#]/)[0]).replace(/^\/+/, "");
  if (!cleanPath.startsWith("output/")) return "";
  const filePath = normalize(join(rootDir, cleanPath));
  const outputRoot = normalize(join(rootDir, "output"));
  return filePath.startsWith(outputRoot) ? filePath : "";
}

function drawPdfSourceImage(doc, visual) {
  const imagePath = outputFilePathFromUrl(visual.attrs.url || visual.attrs.src || "");
  const ext = extname(imagePath).toLowerCase();
  const width = Math.min(360, doc.page.width - doc.page.margins.left - doc.page.margins.right - 16);
  const height = 170;

  ensurePdfSpace(doc, height + 28);
  const startX = doc.x;
  const startY = doc.y;
  doc.save();
  doc.roundedRect(startX + 8, startY + 4, width + 16, height + 16, 8).lineWidth(0.8).strokeColor("#bfdbfe").stroke();
  if (imagePath && existsSync(imagePath) && [".png", ".jpg", ".jpeg"].includes(ext)) {
    doc.image(imagePath, startX + 16, startY + 12, { fit: [width, height], align: "left", valign: "center" });
  } else {
    doc.fontSize(9).fillColor("#64748b").text("复杂图形题使用原始图片；当前 PDF 暂无法嵌入该图片格式。", startX + 18, startY + 72, {
      width: width - 4,
      lineGap: 4
    });
  }
  doc.restore();
  resetPdfCursor(doc, startX, startY + height + 28);
}

function drawPdfVisual(doc, visual) {
  const startX = doc.x;
  ensurePdfSpace(doc, 120);
  doc.moveDown(0.4);
  if (visual.kind === "clock") drawPdfClock(doc, visual);
  else if (visual.kind === "triangle_board") drawPdfTriangleBoard(doc, visual);
  else if (visual.kind === "triangle_board_composition") drawPdfTriangleBoardComposition(doc, visual);
  else if (visual.kind === "pattern") drawPdfPattern(doc, visual);
  else if (visual.kind === "tile_pattern") drawPdfTilePattern(doc, visual);
  else if (visual.kind === "overlap_rect") drawPdfOverlapRect(doc, visual);
  else if (visual.kind === "stack_cups") drawPdfStackCups(doc, visual);
  else if (visual.kind === "rect_path") drawPdfRectPath(doc, visual);
  else if (visual.kind === "source_image") drawPdfSourceImage(doc, visual);
  else doc.fontSize(9).fillColor("#64748b").text("复杂图形题需查看原始图片。", { lineGap: 4 });
  doc.x = startX;
  doc.moveDown(0.4);
  doc.x = startX;
}

async function writeExamPaperPdf(paper) {
  await mkdir(pdfDir, { recursive: true });

  const id = randomUUID();
  const filename = `exam-paper-${id}.pdf`;
  const filePath = join(pdfDir, filename);
  const pdfUrl = `/output/pdf/${filename}`;

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      bufferPages: true,
      margins: { top: 60, right: 60, bottom: 62, left: 60 },
      info: {
        Title: paper.title || "错题巩固卷",
        Author: "AI 教学工具箱"
      }
    });
    const stream = createWriteStream(filePath);

    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);

    if (pdfConfig.fontPath) {
      if (pdfConfig.fontPath.endsWith(".ttc")) {
        doc.font(pdfConfig.fontPath, pdfConfig.fontName);
      } else {
        doc.font(pdfConfig.fontPath);
      }
    } else {
      doc.font("Helvetica");
    }

    doc
      .fontSize(20)
      .fillColor("#102033")
      .text(normalizePdfText(paper.title || "错题巩固卷"), { align: "center" })
      .moveDown(0.35);

    doc
      .fontSize(9)
      .fillColor("#66758a")
      .text("AI 教学工具箱 · 错题本自动出卷", { align: "center" })
      .moveDown(1.5);

    const answerLines = [];
    let inAnswerSection = false;

    for (const line of splitPaperLines(normalizePaperContent(paper.content))) {
      const text = normalizePdfText(line.trim());
      if (!text) {
        doc.moveDown(0.85);
        continue;
      }

      if (isAnswerSectionLine(text)) {
        inAnswerSection = true;
        answerLines.push(text);
        continue;
      }

      if (inAnswerSection || isInlineAnswerLine(text)) {
        answerLines.push(text);
        continue;
      }

      const visual = parseVisualLine(text);
      if (visual) {
        drawPdfVisual(doc, visual);
        continue;
      }

      if (isPaperSection(text)) {
        ensurePdfSpace(doc, 88);
        doc.moveDown(0.75);
        doc.fontSize(13).fillColor("#1d6ee8").text(text, {
          lineGap: 8,
          paragraphGap: 6
        });
      } else if (isQuestionLine(text)) {
        ensurePdfSpace(doc, 96);
        doc.moveDown(1.2);
        doc.fontSize(11.5).fillColor("#102033").text(text, {
          lineGap: 8,
          paragraphGap: 4
        });
        doc.moveDown(0.7);
      } else if (isOptionLine(text)) {
        doc.fontSize(10.8).fillColor("#26384f").text(text, {
          indent: 18,
          lineGap: 7,
          paragraphGap: 2
        });
      } else if (isMetaLine(text)) {
        doc.fontSize(10.5).fillColor("#40536b").text(text, {
          lineGap: 7,
          paragraphGap: 2
        });
      } else {
        doc.fontSize(10.8).fillColor("#102033").text(text, {
          lineGap: 7,
          paragraphGap: 3
        });
      }
    }

    if (answerLines.length) {
      doc.addPage();
      doc.fontSize(15).fillColor("#1d6ee8").text("参考答案与解析", { lineGap: 8 });
      doc.moveDown(0.8);

      for (const line of answerLines) {
        const text = normalizePdfText(line.trim());
        if (!text || isAnswerSectionLine(text)) continue;
        if (isQuestionLine(text) || isInlineAnswerLine(text)) {
          ensurePdfSpace(doc, 72);
          doc.moveDown(0.55);
          doc.fontSize(11).fillColor("#102033").text(text, { lineGap: 7, paragraphGap: 4 });
        } else {
          doc.fontSize(10.5).fillColor("#26384f").text(text, { lineGap: 7, paragraphGap: 3 });
        }
      }
    }

    doc.addPage();
    doc.fontSize(13).fillColor("#1d6ee8").text("来源错题", { lineGap: 5 });
    doc.moveDown(0.6);

    const sourceIds = paper.sourceMistakeIds || [];
    if (sourceIds.length) {
      sourceIds.forEach((sourceId, index) => {
        doc.fontSize(10).fillColor("#102033").text(`${index + 1}. ${sourceId}`, { lineGap: 4 });
      });
    } else {
      doc.fontSize(10).fillColor("#102033").text("暂无来源错题。", { lineGap: 4 });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i += 1) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .fillColor("#66758a")
        .text(`第 ${i + 1} 页`, 54, doc.page.height - 38, {
          align: "center",
          width: doc.page.width - 108
        });
    }

    doc.end();
  });

  return { id, filename, filePath, pdfUrl };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function userByEmail(email) {
  return [...users.values()].find((user) => user.email === email) || null;
}

let mailTransporter = null;

function getMailTransporter() {
  if (mailTransporter) return mailTransporter;

  mailTransporter = nodemailer.createTransport({
    host: mailConfig.host,
    port: mailConfig.port,
    secure: mailConfig.secure,
    auth: {
      user: mailConfig.user,
      pass: mailConfig.pass
    }
  });
  return mailTransporter;
}

function loginCodeMailText(code) {
  return [
    `你的${mailConfig.appName}登录验证码是：${code}`,
    "",
    "验证码 10 分钟内有效。若不是你本人操作，可以忽略这封邮件。"
  ].join("\n");
}

function loginCodeMailHtml(code) {
  const digits = code.split("").map((digit) => `<span style="display:inline-block;margin-right:6px;padding:8px 10px;border-radius:8px;background:#eef4ff;color:#1d4ed8;font-size:22px;font-weight:700;letter-spacing:0;">${digit}</span>`).join("");
  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:24px;background:#f6f8fb;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#102033;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dbe5f5;border-radius:12px;padding:28px;">
      <p style="margin:0 0 10px;color:#2563eb;font-size:14px;font-weight:700;">邮箱验证码登录</p>
      <h1 style="margin:0 0 18px;font-size:22px;line-height:1.35;">进入${mailConfig.appName}</h1>
      <p style="margin:0 0 18px;color:#526176;line-height:1.7;">请在登录页输入下面的 6 位验证码。验证码 10 分钟内有效，新邮箱验证成功后会自动注册账号。</p>
      <div style="margin:0 0 20px;">${digits}</div>
      <p style="margin:0;color:#7b8798;font-size:13px;line-height:1.6;">如果不是你本人操作，可以忽略这封邮件。</p>
    </div>
  </body>
</html>`;
}

async function sendLoginCode(email, code) {
  if (!mailConfig.enabled) {
    console.log(`邮箱验证码 ${email}: ${code}`);
    if (process.env.NODE_ENV === "production") {
      throw new Error("邮件服务未配置，请设置 SMTP_HOST、SMTP_USER、SMTP_PASS 和 MAIL_FROM。");
    }
    return { delivery: "console" };
  }

  try {
    const info = await getMailTransporter().sendMail({
      from: mailConfig.from,
      to: email,
      subject: `${mailConfig.appName}登录验证码：${code}`,
      text: loginCodeMailText(code),
      html: loginCodeMailHtml(code)
    });
    logInfo("auth.mail.sent", { email, messageId: info.messageId || "" });
    return { delivery: "smtp", messageId: info.messageId || "" };
  } catch (error) {
    logError("auth.mail.failed", error, { email, host: mailConfig.host, port: mailConfig.port });
    throw new Error("验证码邮件发送失败，请稍后重试或检查 SMTP 配置。");
  }
}

function validateChildInput(input) {
  const name = String(input.name || "").trim();
  const birthYear = Number(input.birthYear);
  const birthMonth = Number(input.birthMonth);
  const grade = String(input.grade || "").trim();
  const currentYear = new Date().getFullYear();

  if (!name) return { error: "孩子姓名不能为空" };
  if (!Number.isInteger(birthYear) || birthYear < 1990 || birthYear > currentYear) return { error: "出生年份不正确" };
  if (!Number.isInteger(birthMonth) || birthMonth < 1 || birthMonth > 12) return { error: "出生月份不正确" };

  return { name, birthYear, birthMonth, grade };
}

async function handleApi(req, res, pathname) {
  const session = getSession(req, res);

  if (req.method === "GET" && (pathname === "/api/tools" || pathname === "/api/v1/tools")) {
    const user = users.get(session.userId);
    sendJson(res, 200, {
      tools: publicTools(),
      currentUser: publicUser(user),
      children: publicChildren(user?.id),
      defaultChildId: resolveChildId("", user?.id),
      quotaLeft: publicQuotaLeft(session)
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/v1/session") {
    const user = users.get(session.userId);
    sendJson(res, 200, { currentUser: publicUser(user), children: publicChildren(user?.id), quotaLeft: publicQuotaLeft(session) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/v1/auth/code") {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);

    if (!isValidEmail(email)) {
      sendJson(res, 400, { error: "请输入正确的邮箱" });
      return;
    }

    const code = createLoginCode();
    const now = new Date();
    const record = {
      id: randomUUID(),
      email,
      codeHash: hashLoginCode(email, code),
      attempts: 0,
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      usedAt: "",
      createdAt: now.toISOString()
    };

    await writeLoginCode(record);
    const delivery = await sendLoginCode(email, code);
    sendJson(res, 201, {
      message: "验证码已发送，有效期 10 分钟",
      devCode: mailConfig.exposeDevCode && delivery.delivery === "console" ? code : undefined
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/v1/auth/verify") {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const code = String(body.code || "").trim();
    const record = latestLoginCode(email);

    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
      sendJson(res, 400, { error: "邮箱或验证码格式不正确" });
      return;
    }

    if (!record || new Date(record.expiresAt).getTime() < Date.now()) {
      sendJson(res, 400, { error: "验证码已过期，请重新获取" });
      return;
    }

    if (record.attempts >= 5) {
      sendJson(res, 429, { error: "验证码尝试次数过多，请重新获取" });
      return;
    }

    record.attempts += 1;
    if (record.codeHash !== hashLoginCode(email, code)) {
      await writeLoginCode(record);
      sendJson(res, 400, { error: "验证码不正确" });
      return;
    }

    const now = new Date().toISOString();
    let user = userByEmail(email);
    if (!user) {
      user = { id: randomUUID(), email, createdAt: now, updatedAt: now, lastLoginAt: now };
    } else {
      user = { ...user, updatedAt: now, lastLoginAt: now };
    }

    record.usedAt = now;
    await writeLoginCode(record);
    await writeUser(user);
    session.userId = user.id;
    await writeSessionRecord(session);
    sendJson(res, 200, { currentUser: publicUser(user), children: publicChildren(user.id), quotaLeft: publicQuotaLeft(session) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/v1/logout") {
    session.userId = "";
    await writeSessionRecord(session);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/v1/children") {
    const user = requireUser(session, res);
    if (!user) return;
    sendJson(res, 200, { items: publicChildren(user.id), defaultChildId: resolveChildId("", user.id) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/v1/children") {
    const user = requireUser(session, res);
    if (!user) return;
    const body = await readJson(req);
    const validated = validateChildInput(body);

    if (validated.error) {
      sendJson(res, 400, { error: validated.error });
      return;
    }

    const now = new Date().toISOString();
    const child = {
      id: randomUUID(),
      userId: user.id,
      name: validated.name,
      grade: validated.grade,
      birthYear: validated.birthYear,
      birthMonth: validated.birthMonth,
      role: "student",
      createdAt: now,
      updatedAt: now
    };

    await writeChild(child);
    sendJson(res, 201, { child: publicChild(child), items: publicChildren(user.id) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/v1/uploads") {
    const user = requireUser(session, res);
    if (!user) return;
    const body = await readJson(req);
    const attachment = body.attachment && typeof body.attachment === "object" ? body.attachment : null;
    const attachmentError = validateAttachment(attachment);

    if (attachmentError) {
      sendJson(res, 400, { error: attachmentError });
      return;
    }

    if (!attachment) {
      sendJson(res, 400, { error: "请选择图片" });
      return;
    }

    const fileId = randomUUID();
    const decoded = decodeImageDataUrl(attachment.dataUrl);
    if (!decoded) {
      sendJson(res, 400, { error: "图片数据不正确" });
      return;
    }
    const filename = `${fileId}${uploadExtension(attachment.type || decoded.type)}`;
    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, filename), decoded.buffer);
    const shouldEnhance = attachment.purpose === "mistake_crop" || attachment.enhance === true || attachment.enhance === "worksheet";
    const enhanced = shouldEnhance ? await createEnhancedQuestionImage(decoded.buffer, fileId) : null;

    const stored = {
      id: fileId,
      name: String(attachment.name || "uploaded-image"),
      type: String(attachment.type || "image"),
      size: Number(attachment.size || 0),
      dataUrl: attachment.dataUrl,
      url: `/output/uploads/${filename}`,
      filename,
      enhanced,
      createdAt: new Date().toISOString()
    };

    uploads.set(fileId, stored);
    sendJson(res, 201, { fileId, file: attachmentMeta(stored) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/v1/generations") {
    const user = requireUser(session, res);
    if (!user) return;
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const childId = resolveChildId(url.searchParams.get("childId"), user.id);
    const items = Array.from(generations.values())
      .filter((record) => (record.userId || "") === user.id)
      .filter((record) => (record.childId || defaultChildId) === childId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 20)
      .map(publicGeneration);

    sendJson(res, 200, { items });
    return;
  }

  if (req.method === "GET" && pathname === "/api/v1/mistakes") {
    const user = requireUser(session, res);
    if (!user) return;
    await refreshMysqlDataIfNeeded();
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    sendJson(res, 200, { items: filterMistakeRecords(url.searchParams, user.id) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/v1/mistake-stats") {
    const user = requireUser(session, res);
    if (!user) return;
    await refreshMysqlDataIfNeeded();
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    sendJson(res, 200, { stats: mistakeStats(url.searchParams, user.id) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/v1/mistakes/due") {
    const user = requireUser(session, res);
    if (!user) return;
    await refreshMysqlDataIfNeeded();
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    url.searchParams.set("dueOnly", "true");
    sendJson(res, 200, { items: filterMistakeRecords(url.searchParams, user.id) });
    return;
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/v1/mistakes/")) {
    const user = requireUser(session, res);
    if (!user) return;
    const mistakeId = pathname.split("/").pop();
    const rawRecord = mistakeRecords.get(mistakeId);

    if (!rawRecord || rawRecord.userId !== user.id) {
      sendJson(res, 404, { error: "错题记录不存在" });
      return;
    }

    const body = await readJson(req);
    const updated = await updateMistakeRecord(rawRecord, editableMistakePatch(body));
    sendJson(res, 200, { mistake: publicMistakeRecord(updated) });
    return;
  }

  if (req.method === "POST" && pathname.endsWith("/reviews") && pathname.startsWith("/api/v1/mistakes/")) {
    const user = requireUser(session, res);
    if (!user) return;
    const mistakeId = pathname.split("/").slice(-2)[0];
    const rawRecord = mistakeRecords.get(mistakeId);

    if (!rawRecord || rawRecord.userId !== user.id) {
      sendJson(res, 404, { error: "错题记录不存在" });
      return;
    }

    const body = await readJson(req);
    const updated = await addMistakeReview(rawRecord, body);
    sendJson(res, 201, { mistake: publicMistakeRecord(updated) });
    return;
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/v1/mistakes/")) {
    const user = requireUser(session, res);
    if (!user) return;
    const mistakeId = pathname.split("/").pop();
    const rawRecord = mistakeRecords.get(mistakeId);

    if (!rawRecord || rawRecord.userId !== user.id || (rawRecord.status || "active") !== "active") {
      sendJson(res, 404, { error: "错题记录不存在" });
      return;
    }

    const deleted = await updateMistakeRecord(rawRecord, {
      status: "deleted",
      masteryStatus: "已归档",
      deletedAt: new Date().toISOString()
    });
    sendJson(res, 200, { deleted: true, mistake: publicMistakeRecord(deleted) });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/v1/mistakes/")) {
    const user = requireUser(session, res);
    if (!user) return;
    const mistakeId = pathname.split("/").pop();
    const rawRecord = mistakeRecords.get(mistakeId);
    const record = rawRecord && rawRecord.userId === user.id ? publicMistakeRecord(rawRecord) : null;

    if (!record) {
      sendJson(res, 404, { error: "错题记录不存在" });
      return;
    }

    sendJson(res, 200, { mistake: record });
    return;
  }

  if (req.method === "GET" && pathname === "/api/v1/mastery-stats") {
    const user = requireUser(session, res);
    if (!user) return;
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const childId = resolveChildId(url.searchParams.get("childId"), user.id);
    sendJson(res, 200, {
      childId,
      weakKnowledgePoints: weakKnowledgePoints(user.id, childId),
      items: knowledgePointMasteryStats(user.id, childId)
    });
    return;
  }

  if (req.method === "POST" && pathname.endsWith("/attempts") && pathname.startsWith("/api/v1/exam-papers/")) {
    const user = requireUser(session, res);
    if (!user) return;
    const paperId = pathname.split("/").slice(-2)[0];
    const paper = await findExamPaperRecord(paperId);

    if (!paper || paper.userId !== user.id || (paper.status || "active") !== "active") {
      sendJson(res, 404, { error: "练习卷不存在" });
      return;
    }

    const body = await readJson(req);
    const attempt = await recordPaperAttempt(paper, body, user.id);
    sendJson(res, 201, {
      attempt,
      mastery: knowledgePointMasteryStats(user.id, paper.childId || defaultChildId)
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/v1/exam-papers") {
    const user = requireUser(session, res);
    if (!user) return;
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const childId = resolveChildId(url.searchParams.get("childId"), user.id);
    const items = (await listExamPaperRecords(user.id, childId)).map((paper) => publicExamPaper(paper));
    sendJson(res, 200, { childId, items });
    return;
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/v1/exam-papers/")) {
    const user = requireUser(session, res);
    if (!user) return;
    const paperId = pathname.split("/").pop();
    const paper = await findExamPaperRecord(paperId);

    if (!paper || paper.userId !== user.id || (paper.status || "active") !== "active") {
      sendJson(res, 404, { error: "练习卷不存在" });
      return;
    }

    const deleted = await updateExamPaperRecord(paper, {
      status: "deleted",
      deletedAt: new Date().toISOString()
    });
    sendJson(res, 200, { deleted: true, paper: publicExamPaper(deleted) });
    return;
  }

  if (req.method === "GET" && pathname.endsWith("/pdf") && pathname.startsWith("/api/v1/exam-papers/")) {
    const user = requireUser(session, res);
    if (!user) return;
    const paperId = pathname.split("/").slice(-2)[0];
    const paper = await findExamPaperRecord(paperId);

    if (!paper || paper.userId !== user.id || (paper.status || "active") !== "active") {
      sendJson(res, 404, { error: "练习卷不存在" });
      return;
    }

    const pdf = await writeExamPaperPdf(paper);
    const updated = await updateExamPaperRecord(paper, {
      pdfUrl: pdf.pdfUrl,
      pdfFilename: pdf.filename
    });

    res.writeHead(302, {
      Location: updated.pdfUrl,
      "Cache-Control": "no-store"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/v1/exam-papers/")) {
    const user = requireUser(session, res);
    if (!user) return;
    const paperId = pathname.split("/").pop();
    const paper = await findExamPaperRecord(paperId);

    if (!paper || paper.userId !== user.id || (paper.status || "active") !== "active") {
      sendJson(res, 404, { error: "练习卷不存在" });
      return;
    }

    sendJson(res, 200, { paper: publicExamPaper(paper, true) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/v1/exam-papers") {
    const user = requireUser(session, res);
    if (!user) return;
    const body = await readJson(req);
    const paper = await generateExamPaper(body, user.id);
    const pdf = await writeExamPaperPdf(paper);
    const paperWithPdf = { ...paper, pdfUrl: pdf.pdfUrl, pdfFilename: pdf.filename };
    await writeExamPaperRecord(paperWithPdf);
    sendJson(res, 201, { paper: publicExamPaper(paperWithPdf, true) });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/v1/generations/")) {
    const user = requireUser(session, res);
    if (!user) return;
    const generationId = pathname.split("/").pop();
    const rawRecord = generations.get(generationId);
    const record = rawRecord && rawRecord.userId === user.id ? publicGeneration(rawRecord) : null;

    if (!record) {
      sendJson(res, 404, { error: "生成记录不存在" });
      return;
    }

    sendJson(res, 200, { generation: record });
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/api/v1/generations/") && pathname.endsWith("/mistakes")) {
    const user = requireUser(session, res);
    if (!user) return;

    const parts = pathname.split("/");
    const generationId = parts[4];
    const generationRecord = generations.get(generationId);

    if (!generationRecord || generationRecord.userId !== user.id || generationRecord.toolSlug !== "mistake") {
      sendJson(res, 404, { error: "识别记录不存在" });
      return;
    }

    const body = await readJson(req);
    const draftMistakes = Array.isArray(body.mistakes) ? body.mistakes : [];

    if (!draftMistakes.length) {
      sendJson(res, 400, { error: "请至少选择一道错题入库" });
      return;
    }

    const created = await createMistakeRecordsFromDraft(generationRecord, draftMistakes);
    generationRecord.importedMistakeIds = [...(generationRecord.importedMistakeIds || []), ...created.map((item) => item.id)];
    await writeGeneration(generationRecord);

    sendJson(res, 201, {
      mistakeIds: created.map((item) => item.id),
      mistakeCount: created.length,
      mistakes: created.map(publicMistakeRecord)
    });
    return;
  }

  if (req.method === "POST" && (pathname === "/api/generate" || pathname === "/api/v1/generations")) {
    const user = requireUser(session, res);
    if (!user) return;
    const requestId = randomUUID();
    const startedAt = Date.now();
    const body = await readJson(req);
    const toolSlug = String(body.toolSlug || "");
    const tool = tools[toolSlug];

    if (!tool) {
      sendJson(res, 404, { error: "未知工具" });
      return;
    }

    const input = body.input && typeof body.input === "object" ? body.input : {};
    const childId = resolveChildId(body.childId, user.id);
    if (!childId) {
      sendJson(res, 400, { error: "请先添加并选择孩子" });
      return;
    }
    const inlineAttachment = body.attachment && typeof body.attachment === "object" ? body.attachment : null;
    const attachment = resolveAttachment(body.fileId, inlineAttachment);
    logInfo("generation.request.start", {
      requestId,
      toolSlug,
      userId: user.id,
      childId,
      hasAttachment: Boolean(attachment),
      attachmentType: attachment?.type || "",
      attachmentSize: attachment?.size || 0
    });

    if (body.fileId && !attachment) {
      sendJson(res, 404, { error: "上传文件不存在或已过期" });
      return;
    }

    const attachmentError = validateAttachment(attachment);
    if (attachmentError) {
      sendJson(res, 400, { error: attachmentError });
      return;
    }

    const validationError = validateInput(tool, input, attachment);
    if (validationError) {
      sendJson(res, 400, { error: validationError });
      return;
    }

    if (quotaEnforced && session.quotaLeft < tool.quotaCost) {
      sendJson(res, 402, {
        error: "今日免费次数已用完",
        quotaLeft: publicQuotaLeft(session),
        upgradeHint: "可以购买次数包或开通会员继续生成。"
      });
      return;
    }

    try {
      const generation = await generateOutput(toolSlug, input, attachment);
      if (quotaEnforced) {
        session.quotaLeft -= tool.quotaCost;
        await writeSessionRecord(session);
      }
      const record = {
        id: randomUUID(),
        userId: user.id,
        toolSlug,
        childId,
        childSnapshot: childSnapshot(childId),
        input,
        attachment: attachmentMeta(attachment),
        output: generation.output,
        structuredMistakes: generation.structuredMistakes || [],
        model: generation.model,
        quotaCost: tool.quotaCost,
        createdAt: new Date().toISOString()
      };

      await writeGeneration(record);
      const mistakeDrafts = toolSlug === "mistake" ? (generation.structuredMistakes || []) : [];
      logInfo("generation.request.end", {
        requestId,
        generationId: record.id,
        model: generation.model,
        durationMs: Date.now() - startedAt,
        outputChars: generation.output.length,
        mistakeDraftCount: mistakeDrafts.length
      });
      sendJson(res, 201, {
        output: generation.output,
        quotaLeft: publicQuotaLeft(session),
        generationId: record.id,
        model: generation.model,
        structuredMistakes: mistakeDrafts,
        mistakeCount: mistakeDrafts.length
      });
    } catch (error) {
      logError("generation.request.failed", error, {
        requestId,
        toolSlug,
        durationMs: Date.now() - startedAt
      });
      sendJson(res, 502, { error: error.message || "生成失败，请稍后重试" });
    }
    return;
  }

  sendJson(res, 404, { error: "接口不存在" });
}

async function serveStatic(req, res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const staticRoot = pathname.startsWith("/output/") ? rootDir : (existsSync(join(distDir, "index.html")) ? distDir : rootDir);
  let filePath = normalize(join(staticRoot, cleanPath));

  if (!filePath.startsWith(staticRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".pdf": "application/pdf",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".ico": "image/x-icon"
    }[extname(filePath)] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  } catch {
    const acceptsHtml = !extname(filePath) || pathname === "/" || req.headers.accept?.includes("text/html");
    const spaIndex = normalize(join(staticRoot, "index.html"));

    if (acceptsHtml && spaIndex.startsWith(staticRoot) && existsSync(spaIndex)) {
      const content = await readFile(spaIndex);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }

    await serveStatic(req, res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "服务异常" });
  }
});

export const __debugVisuals = {
  normalizeExamPaperVisuals,
  visualLineForText,
  visualLineForRecord,
  parseVisualLine
};

if (isMainModule) {
  await loadPersistentData();

  server.listen(port, () => {
    console.log(`AI Edu Workflow Tools running at http://localhost:${port}`);
  });
}
