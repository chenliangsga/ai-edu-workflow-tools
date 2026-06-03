let tools = {};
let activeTool = "essay";
let mistakeItems = [];
let selectedMistakeIds = new Set();
let activeMistakeId = "";
let children = [];
let currentUser = null;
let activeChildId = localStorage.getItem("edu_active_child_id") || "";

const authView = document.querySelector("#authView");
const homeView = document.querySelector("#homeView");
const toolView = document.querySelector("#toolView");
const mistakeBankView = document.querySelector("#mistakeBankView");
const studentsView = document.querySelector("#studentsView");
const practiceView = document.querySelector("#practiceView");
const reportView = document.querySelector("#reportView");
const resourcesView = document.querySelector("#resourcesView");
const homeToolGrid = document.querySelector("#homeToolGrid");
const studentGrid = document.querySelector("#studentGrid");
const addStudentPageBtn = document.querySelector("#addStudentPageBtn");
const childSelect = document.querySelector("#childSelect");
const activeChildNameNodes = document.querySelectorAll("[data-active-child-name]");
const accountActions = document.querySelector("#accountActions");
const userEmailText = document.querySelector("#userEmailText");
const logoutBtn = document.querySelector("#logoutBtn");
const manageChildrenBtn = document.querySelector("#manageChildrenBtn");
const authForm = document.querySelector("#authForm");
const authEmail = document.querySelector("#authEmail");
const authCode = document.querySelector("#authCode");
const sendCodeBtn = document.querySelector("#sendCodeBtn");
const authStatus = document.querySelector("#authStatus");
const childModal = document.querySelector("#childModal");
const closeChildModalBtn = document.querySelector("#closeChildModalBtn");
const childList = document.querySelector("#childList");
const childForm = document.querySelector("#childForm");
const childSubmitBtn = document.querySelector("#childSubmitBtn");
const childStatus = document.querySelector("#childStatus");
const toolList = document.querySelector("#toolList");
const toolTitle = document.querySelector("#toolTitle");
const toolDesc = document.querySelector("#toolDesc");
const fields = document.querySelector("#fields");
const form = document.querySelector("#toolForm");
const resultBox = document.querySelector("#resultBox");
const quotaText = document.querySelector("#quotaLeft");
const copyBtn = document.querySelector("#copyBtn");
const resetBtn = document.querySelector("#resetBtn");
const submitBtn = document.querySelector("#submitBtn");
const imageInput = document.querySelector("#imageInput");
const imagePreview = document.querySelector("#imagePreview");
const previewImage = document.querySelector("#previewImage");
const imageName = document.querySelector("#imageName");
const imageMeta = document.querySelector("#imageMeta");
const removeImageBtn = document.querySelector("#removeImageBtn");
const refreshMistakesBtn = document.querySelector("#refreshMistakesBtn");
const mistakeFilters = document.querySelector("#mistakeFilters");
const clearMistakeFiltersBtn = document.querySelector("#clearMistakeFiltersBtn");
const mistakeList = document.querySelector("#mistakeList");
const mistakeDetail = document.querySelector("#mistakeDetail");
const mistakeDetailTitle = document.querySelector("#mistakeDetailTitle");
const mistakeTotal = document.querySelector("#mistakeTotal");
const mistakeDue = document.querySelector("#mistakeDue");
const knowledgeTotal = document.querySelector("#knowledgeTotal");
const selectedTotal = document.querySelector("#selectedTotal");
const examForm = document.querySelector("#examForm");
const examSubmitBtn = document.querySelector("#examSubmitBtn");
const examResult = document.querySelector("#examResult");
const mobileTabs = document.querySelectorAll(".mobile-tabbar a");
const appBaseUrl = new URL("./", document.currentScript?.src || window.location.href);

function appUrl(path) {
  const value = String(path || "");
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value.replace(/^\/+/, ""), appBaseUrl).toString();
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    if (/^\s*</.test(text)) {
      throw new Error(`接口返回了 HTML 页面，请检查访问地址或代理配置：${response.status} ${response.url}`);
    }
    throw new Error(`接口返回不是合法 JSON：${text.slice(0, 120)}`);
  }
}

let imageAttachment = null;

function setQuota(value) {
  quotaText.textContent = value;
  document.querySelectorAll("[data-quota-left]").forEach((node) => {
    node.textContent = value;
  });
}

function childMeta(child) {
  if (!child) return "未选择孩子";
  const birth = child.birthYear && child.birthMonth ? `${child.birthYear}年${child.birthMonth}月` : "出生年月未填";
  return child.grade ? `${birth} · ${child.grade}` : birth;
}

function childLabel(child) {
  return child ? `${child.name} · ${childMeta(child)}` : "未选择孩子";
}

function activeChild() {
  return children.find((child) => child.id === activeChildId) || children[0] || null;
}

function renderChildContext() {
  const child = activeChild();
  const label = child ? childLabel(child) : "请先添加孩子";

  activeChildNameNodes.forEach((node) => {
    node.textContent = label;
  });
}

function renderChildSwitcher() {
  if (!children.length) {
    childSelect.innerHTML = '<option value="">请先添加孩子</option>';
    activeChildId = "";
    renderChildContext();
    renderChildList();
    renderStudentCards();
    return;
  }

  if (!children.some((child) => child.id === activeChildId)) {
    activeChildId = children[0].id;
    localStorage.setItem("edu_active_child_id", activeChildId);
  }

  childSelect.innerHTML = children
    .map((child) => `<option value="${escapeHtml(child.id)}">${escapeHtml(childLabel(child))}</option>`)
    .join("");
  childSelect.value = activeChildId;
  renderChildContext();
  renderChildList();
  renderStudentCards();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatText(value) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

function formatDate(value) {
  if (!value) return "待计算";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "待计算";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function joinTags(value) {
  return (Array.isArray(value) ? value : []).join("、");
}

function splitTags(value) {
  return String(value || "")
    .split(/[、，,；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLines(value) {
  return String(value || "")
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isDue(record) {
  return record?.nextReviewAt && new Date(record.nextReviewAt).getTime() <= Date.now();
}

function setMobileActive(view) {
  mobileTabs.forEach((tab) => {
    const isActive =
      (view === "home" && tab.matches("[data-view-home]")) ||
      (view === "mistakes" && tab.matches("[data-view-mistakes]")) ||
      (view === "practice" && tab.matches("[data-view-practice]")) ||
      (view === "report" && tab.matches("[data-view-report]"));
    tab.classList.toggle("active", isActive);
  });
}

function renderAuthState() {
  document.body.classList.toggle("is-authenticated", Boolean(currentUser));
  accountActions.hidden = !currentUser;
  userEmailText.textContent = currentUser?.email || "";
}

function setActiveNav(view) {
  const key = view === "mistakes" ? "repository" : view;
  document.querySelectorAll("[data-nav-key]").forEach((node) => {
    node.classList.toggle("active", node.dataset.navKey === key);
  });
}

function hideAppViews() {
  homeView.hidden = true;
  toolView.hidden = true;
  mistakeBankView.hidden = true;
  if (studentsView) studentsView.hidden = true;
  if (practiceView) practiceView.hidden = true;
  if (reportView) reportView.hidden = true;
  if (resourcesView) resourcesView.hidden = true;
}

function showAuth() {
  authView.hidden = false;
  hideAppViews();
  setActiveNav("");
  setMobileActive("");
  window.scrollTo({ top: 0, behavior: "auto" });
}

function showHome() {
  if (!currentUser) {
    showAuth();
    return;
  }
  authView.hidden = true;
  hideAppViews();
  homeView.hidden = false;
  window.location.hash = "home";
  setActiveNav("home");
  setMobileActive("home");
  window.scrollTo({ top: 0, behavior: "auto" });
}

function showStudents() {
  if (!currentUser) {
    showAuth();
    return;
  }
  authView.hidden = true;
  hideAppViews();
  studentsView.hidden = false;
  renderStudentCards();
  window.location.hash = "students";
  setActiveNav("students");
  setMobileActive("");
  window.scrollTo({ top: 0, behavior: "auto" });
}

function showPractice() {
  if (!currentUser) {
    showAuth();
    return;
  }
  authView.hidden = true;
  hideAppViews();
  practiceView.hidden = false;
  window.location.hash = "practice";
  setActiveNav("practice");
  setMobileActive("practice");
  window.scrollTo({ top: 0, behavior: "auto" });
}

function showReport() {
  if (!currentUser) {
    showAuth();
    return;
  }
  authView.hidden = true;
  hideAppViews();
  reportView.hidden = false;
  window.location.hash = "report";
  setActiveNav("report");
  setMobileActive("report");
  window.scrollTo({ top: 0, behavior: "auto" });
}

function showResources() {
  if (!currentUser) {
    showAuth();
    return;
  }
  authView.hidden = true;
  hideAppViews();
  resourcesView.hidden = false;
  window.location.hash = "resources";
  setActiveNav("resources");
  setMobileActive("");
  window.scrollTo({ top: 0, behavior: "auto" });
}

function showTool(toolKey = activeTool) {
  if (!currentUser) {
    showAuth();
    return;
  }
  if (!activeChildId) {
    openChildModal();
    return;
  }
  activeTool = toolKey;
  authView.hidden = true;
  hideAppViews();
  toolView.hidden = false;
  clearImageAttachment();
  renderToolList();
  renderFields();
  window.location.hash = toolKey;
  setActiveNav("");
  setMobileActive("tools");
  window.scrollTo({ top: 0, behavior: "auto" });
}

async function showMistakeBank() {
  if (!currentUser) {
    showAuth();
    return;
  }
  if (!activeChildId) {
    openChildModal();
    return;
  }
  authView.hidden = true;
  hideAppViews();
  mistakeBankView.hidden = false;
  window.location.hash = "mistakes";
  setActiveNav("mistakes");
  setMobileActive("mistakes");
  window.scrollTo({ top: 0, behavior: "auto" });
  await loadMistakes();
}

function toolTone(key) {
  return {
    essay: "blue",
    mistake: "cyan",
    outline: "indigo"
  }[key] || "blue";
}

function renderHomeTools() {
  homeToolGrid.innerHTML = Object.entries(tools)
    .map(([key, tool]) => `
      <article class="home-tool-card ${toolTone(key)}">
        <div class="home-tool-icon">${tool.icon}</div>
        <div>
          <span>${tool.short}</span>
          <h3>${tool.title}</h3>
          <p>${tool.desc}</p>
        </div>
        <button class="tool-entry-button" type="button" data-tool-entry="${key}">进入功能</button>
      </article>
    `)
    .join("");
}

function renderToolList() {
  toolList.innerHTML = Object.entries(tools)
    .map(([key, tool]) => `
      <button class="tool-tab ${key === activeTool ? "active" : ""}" type="button" data-tool="${key}">
        <span class="tool-icon">${tool.icon}</span>
        <span>
          <strong>${tool.title}</strong>
          <span>${tool.short}</span>
        </span>
      </button>
    `)
    .join("");
}

function renderFields() {
  const tool = tools[activeTool];
  toolTitle.textContent = tool.title;
  toolDesc.textContent = tool.desc;

  fields.innerHTML = tool.fields
    .map((field) => {
      const required = field.required && !field.imageAlternative ? "required" : "";
      const requiredMark = field.required ? '<span class="required">*</span>' : "";
      const hint = field.imageAlternative ? '<span class="field-hint">可留空，改用下方图片上传</span>' : "";

      if (field.type === "textarea") {
        return `<div class="field">
          <label for="${field.name}">${field.label}${requiredMark}${hint}</label>
          <textarea id="${field.name}" name="${field.name}" placeholder="${field.placeholder || ""}" ${required}></textarea>
        </div>`;
      }

      if (field.type === "select") {
        return `<div class="field">
          <label for="${field.name}">${field.label}${requiredMark}</label>
          <select id="${field.name}" name="${field.name}" ${required}>
            ${field.options.map((option) => `<option>${option}</option>`).join("")}
          </select>
        </div>`;
      }

      return `<div class="field">
        <label for="${field.name}">${field.label}${requiredMark}</label>
        <input id="${field.name}" name="${field.name}" placeholder="${field.placeholder || ""}" ${required} />
      </div>`;
    })
    .join("");
}

function renderResult(text, type = "success") {
  resultBox.innerHTML = `<div class="result-content ${type === "error" ? "error" : ""}">${formatText(text)}</div>`;
}

function compactText(value, fallback = "题目待补充", maxLength = 42) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function mistakeListTitle(mistake) {
  const knowledgePoint = (mistake?.knowledgePoints || []).find(Boolean);
  return compactText(knowledgePoint || mistake?.questionNumber || mistake?.question, "知识点待提取", 22);
}

function mistakeListSubtitle(mistake) {
  const question = compactText(mistake?.question, "见上传图片", 54);
  return mistake?.questionNumber ? `${mistake.questionNumber}：${question}` : question;
}

function mistakeDisplayTitle(mistake, index) {
  const knowledgePoint = (mistake?.knowledgePoints || []).find(Boolean);
  if (knowledgePoint) return compactText(knowledgePoint, `错题 ${index + 1}`, 18);
  if (mistake?.questionNumber) return compactText(mistake.questionNumber, `错题 ${index + 1}`, 18);
  return `错题 ${index + 1}`;
}

function mistakeDisplaySubtitle(mistake, index) {
  const title = mistake?.questionNumber || `第 ${index + 1} 题`;
  const question = compactText(mistake?.question, "", 48);
  return question ? `${title}：${question}` : title;
}

function renderMistakeSavedResult(output, generationId, mistakeIds = [], mistakes = []) {
  const child = activeChild();
  const ids = Array.isArray(mistakeIds) ? mistakeIds : [mistakeIds].filter(Boolean);
  const summaries = (Array.isArray(mistakes) ? mistakes : []).slice(0, ids.length || undefined);

  resultBox.innerHTML = `<div class="result-content">
    ${formatText(output)}
    <div class="result-meta">
      <span>孩子：${escapeHtml(child?.name || "默认孩子")}</span>
      <span>已入库 ${escapeHtml(ids.length)} 道错题</span>
      <span>来源：本次错题识别</span>
    </div>
    ${ids.length ? `<div class="mistake-saved-list">
      ${(summaries.length ? summaries : ids.map((id, index) => ({ questionNumber: `错题 ${index + 1}` }))).map((mistake, index) => `
        <article class="mistake-saved-item">
          <strong>${escapeHtml(mistakeDisplayTitle(mistake, index))}</strong>
          <span>${escapeHtml(mistakeDisplaySubtitle(mistake, index))}</span>
        </article>
      `).join("")}
    </div>` : ""}
    <button class="ghost-button compact" type="button" data-view-mistakes>查看错题库</button>
  </div>`;
}

function renderMistakeReviewResult(output, generationId, mistakes = []) {
  const child = activeChild();

  if (!mistakes.length) {
    renderResult(`${output}\n\n没有识别到明确错题。可以补充说明错题位置后再生成一次。`);
    return;
  }

  resultBox.innerHTML = `<form class="mistake-review-form" data-mistake-review="${escapeHtml(generationId)}">
    <div class="mistake-review-head">
      <div>
        <span class="eyebrow">待确认入库</span>
        <h3>识别到 ${escapeHtml(mistakes.length)} 道错题</h3>
        <p>先核对题目和解析，取消不需要入库的题目；知识点、错因和标签可以直接修改。</p>
      </div>
      <button class="primary-button compact" type="submit">确认入库</button>
    </div>
    <div class="result-meta">
      <span>孩子：${escapeHtml(child?.name || "默认孩子")}</span>
      <span>待确认 ${escapeHtml(mistakes.length)} 道错题</span>
    </div>
    <div class="model-summary">${formatText(output)}</div>
    <label class="review-select-all">
      <input type="checkbox" data-review-select-all checked />
      <span>全选本次识别错题</span>
    </label>
    <div class="mistake-review-list">
      ${mistakes.map((item, index) => `
        <article class="mistake-review-card" data-review-card>
          <label class="mistake-review-check">
            <input type="checkbox" data-review-include checked />
            <span>入库</span>
          </label>
          <div class="review-card-grid">
            <label>
              <span>题号</span>
              <input data-field="questionNumber" value="${escapeHtml(item.questionNumber || `错题 ${index + 1}`)}" />
            </label>
            <label>
              <span>题型</span>
              <input data-field="questionType" value="${escapeHtml(item.questionType || "")}" placeholder="选择题、填空题" />
            </label>
            <label>
              <span>难度</span>
              <select data-field="difficulty">
                ${["简单", "中等", "困难"].map((level) => `<option ${level === (item.difficulty || "中等") ? "selected" : ""}>${level}</option>`).join("")}
              </select>
            </label>
            <label class="wide">
              <span>题干</span>
              <textarea data-field="question" rows="3">${escapeHtml(item.question || "")}</textarea>
            </label>
            <label class="wide">
              <span>选项</span>
              <textarea data-field="options" rows="3" placeholder="每行一个选项">${escapeHtml((item.options || []).join("\n"))}</textarea>
            </label>
            <label>
              <span>学生答案</span>
              <input data-field="studentAnswer" value="${escapeHtml(item.studentAnswer || "")}" />
            </label>
            <label>
              <span>正确答案</span>
              <input data-field="correctAnswer" value="${escapeHtml(item.correctAnswer || "")}" />
            </label>
            <label class="wide">
              <span>知识点</span>
              <input data-field="knowledgePoints" value="${escapeHtml(joinTags(item.knowledgePoints))}" placeholder="用顿号、逗号或换行分隔" />
            </label>
            <label class="wide">
              <span>错因</span>
              <input data-field="wrongReasons" value="${escapeHtml(joinTags(item.wrongReasons))}" placeholder="审题错误、计算错误" />
            </label>
            <label class="wide">
              <span>解析</span>
              <textarea data-field="analysis" rows="4">${escapeHtml(item.analysis || "")}</textarea>
            </label>
            <label class="wide">
              <span>标签</span>
              <input data-field="tags" value="${escapeHtml(joinTags(item.tags?.length ? item.tags : ["试卷错题"]))}" />
            </label>
          </div>
        </article>`).join("")}
    </div>
  </form>`;
}

function renderLoading() {
  const loadingTitle = activeTool === "mistake" ? "正在识别试卷错题" : "正在生成结构化结果";
  const loadingDesc = activeTool === "mistake"
    ? "模型会先识别已批改试卷中的错题，再补全题目、选项、答案和解析，稍后由你确认入库。"
    : "如果上传了图片，模型会先识别图片内容，再生成结构化结果。";

  resultBox.innerHTML = `<div class="empty-state">
    <div class="empty-visual loading"></div>
    <strong>${escapeHtml(loadingTitle)}</strong>
    <span>${escapeHtml(loadingDesc)}</span>
  </div>`;
}

function readInput() {
  return Object.fromEntries(new FormData(form).entries());
}

function clearImageAttachment() {
  imageAttachment = null;
  imageInput.value = "";
  previewImage.removeAttribute("src");
  imagePreview.hidden = true;
}

function formatFileSize(size) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("图片读取失败")));
    reader.readAsDataURL(file);
  });
}

async function loadTools() {
  const response = await fetch(appUrl("/api/v1/tools"));
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "工具配置加载失败");
  tools = data.tools;
  currentUser = data.currentUser || null;
  children = data.children || [];
  setQuota(data.quotaLeft);
  renderAuthState();
  renderChildSwitcher();
  renderHomeTools();
  renderToolList();
  renderFields();
  if (!currentUser) showAuth();
}

async function refreshSession() {
  const response = await fetch(appUrl("/api/v1/session"));
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "会话加载失败");
  currentUser = data.currentUser || null;
  children = data.children || [];
  setQuota(data.quotaLeft ?? quotaText.textContent);
  renderAuthState();
  renderChildSwitcher();
  return data;
}

async function apiJson(url, options = {}) {
  const response = await fetch(appUrl(url), {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await readJsonResponse(response);
  if (response.status === 401) {
    currentUser = null;
    children = [];
    renderAuthState();
    renderChildSwitcher();
    showAuth();
  }
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function readMistakeFilters() {
  const params = new URLSearchParams();
  const values = Object.fromEntries(new FormData(mistakeFilters).entries());

  if (activeChildId) params.set("childId", activeChildId);

  for (const [key, value] of Object.entries(values)) {
    if (String(value || "").trim()) params.set(key, String(value).trim());
  }

  return params;
}

function resetMistakeSelection(message = "从左侧列表选择一道错题，查看题目、选项、解析和知识点。") {
  activeMistakeId = "";
  mistakeDetailTitle.textContent = "选择一道错题";
  mistakeDetail.innerHTML = `<div class="empty-state compact-empty">
    <div class="empty-visual"></div>
    <strong>还没有选中错题</strong>
    <span>${escapeHtml(message)}</span>
  </div>`;
  examResult.innerHTML = "<p>勾选错题后出卷；如果不勾选，系统会优先使用当前孩子的待复习错题。</p>";
}

function clearMistakeFilters() {
  window.clearTimeout(mistakeFilters._timer);
  mistakeFilters.querySelectorAll("input, select, textarea").forEach((field) => {
    if (field.type === "checkbox" || field.type === "radio") {
      field.checked = false;
      return;
    }
    if (field.tagName === "SELECT") {
      field.selectedIndex = 0;
      return;
    }
    field.value = "";
  });
  selectedMistakeIds.clear();
  resetMistakeSelection("筛选条件已清空，请从左侧列表重新选择一道错题。");
  return loadMistakes();
}

function updateMistakeStats(items) {
  const points = new Set();
  const selectedCount = selectedMistakeIds.size;

  for (const item of items) {
    for (const point of item.knowledgePoints || []) {
      if (point) points.add(point);
    }
  }

  mistakeTotal.textContent = items.length;
  mistakeDue.textContent = items.filter(isDue).length;
  knowledgeTotal.textContent = points.size;
  selectedTotal.textContent = selectedCount;
}

function renderMistakeList(items) {
  updateMistakeStats(items);
  renderStudentCards();
  const child = activeChild();

  if (!items.length) {
    mistakeList.innerHTML = `<div class="empty-state compact-empty">
      <div class="empty-visual"></div>
      <strong>还没有错题记录</strong>
      <span>${escapeHtml(child?.name || "当前孩子")} 完成一次错题解析后，系统会自动把错题放进这里。</span>
    </div>`;
    return;
  }

  mistakeList.innerHTML = items
    .map((item) => {
      const checked = selectedMistakeIds.has(item.id) ? "checked" : "";
      const points = (item.knowledgePoints || []).slice(0, 3);

      return `<article class="mistake-item" data-mistake-id="${escapeHtml(item.id)}">
        <label class="mistake-check" title="加入本次出题">
          <input type="checkbox" data-select-mistake="${escapeHtml(item.id)}" ${checked} />
        </label>
        <button class="mistake-summary" type="button" data-open-mistake="${escapeHtml(item.id)}">
          <span class="mistake-badges">
            <span>${escapeHtml(item.subject || "学科")}</span>
            <span>${escapeHtml(item.grade || "年级")}</span>
            ${isDue(item) ? "<span class=\"due-badge\">待复习</span>" : ""}
          </span>
          <strong>${escapeHtml(mistakeListTitle(item))}</strong>
          <span class="mistake-points">${escapeHtml(mistakeListSubtitle(item))}</span>
          ${points.length > 1 ? `<span class="mistake-points">${points.slice(1).map(escapeHtml).join(" / ")}</span>` : ""}
          <span class="mistake-time">下次复习：${escapeHtml(formatDate(item.nextReviewAt))}</span>
        </button>
      </article>`;
    })
    .join("");
}

function renderMistakeDetail(record) {
  if (!record) return;

  activeMistakeId = record.id;
  mistakeDetailTitle.textContent = `${record.childName || activeChild()?.name || "孩子"} · ${record.subject || "错题"} · ${record.grade || "年级"}`;
  mistakeDetail.innerHTML = `<article class="detail-card">
    <div class="detail-tags">
      <span>${escapeHtml(record.childName || activeChild()?.name || "孩子")}</span>
      <span>${escapeHtml(record.subject || "学科")}</span>
      <span>${escapeHtml(record.grade || "年级")}</span>
      <span>${escapeHtml(record.masteryStatus || "待复习")}</span>
      <span>复习 ${escapeHtml(record.reviewCount || 0)} 次</span>
    </div>
    <section>
      <h3>原题</h3>
      <p>${formatText(record.question || "见上传图片")}</p>
    </section>
    ${(record.options || []).length ? `<section>
      <h3>选项</h3>
      <div class="option-list">
        ${record.options.map((option) => `<span>${escapeHtml(option)}</span>`).join("")}
      </div>
    </section>` : ""}
    <section>
      <h3>学生答案</h3>
      <p>${formatText(record.studentAnswer || "未提供")}</p>
    </section>
    <section>
      <h3>正确答案</h3>
      <p>${formatText(record.correctAnswer || "未提供")}</p>
    </section>
    <section>
      <h3>知识点</h3>
      <div class="tag-row">
        ${(record.knowledgePoints || []).length ? record.knowledgePoints.map((point) => `<span>${escapeHtml(point)}</span>`).join("") : "<span>待提取</span>"}
      </div>
    </section>
    <section>
      <h3>错因</h3>
      <div class="tag-row">
        ${(record.wrongReasons || []).length ? record.wrongReasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join("") : "<span>待归类</span>"}
      </div>
    </section>
    <section>
      <h3>AI 解析</h3>
      <p>${formatText(record.analysis || "暂无解析")}</p>
    </section>
    <section>
      <h3>复习操作</h3>
      <div class="review-actions">
        <button class="ghost-button compact" type="button" data-review-result="correct">做对了</button>
        <button class="ghost-button compact" type="button" data-review-result="wrong">又错了</button>
        <button class="primary-button compact" type="button" data-review-result="mastered">已掌握</button>
      </div>
      ${(record.reviews || []).length ? `<div class="review-timeline">
        ${(record.reviews || []).slice().reverse().map((review) => `<span>${escapeHtml(formatDate(review.createdAt))} · ${escapeHtml({ correct: "做对了", wrong: "又错了", mastered: "已掌握" }[review.result] || review.result)}${review.note ? ` · ${escapeHtml(review.note)}` : ""}</span>`).join("")}
      </div>` : ""}
    </section>
    <section>
      <h3>题目管理</h3>
      <div class="review-actions">
        <button class="danger-button compact" type="button" data-delete-mistake="${escapeHtml(record.id)}">删除题目</button>
      </div>
    </section>
    <form class="mistake-edit-form" data-mistake-edit="${escapeHtml(record.id)}">
      <h3>编辑归类</h3>
      <label>
        <span>知识点</span>
        <input name="knowledgePoints" value="${escapeHtml(joinTags(record.knowledgePoints))}" placeholder="用顿号或分号分隔" />
      </label>
      <label>
        <span>错因</span>
        <input name="wrongReasons" value="${escapeHtml(joinTags(record.wrongReasons))}" placeholder="审题错误、计算错误" />
      </label>
      <label>
        <span>题型</span>
        <input name="questionType" value="${escapeHtml(record.questionType || "")}" placeholder="选择题、填空题、解答题" />
      </label>
      <label>
        <span>难度</span>
        <select name="difficulty">
          ${["简单", "中等", "困难"].map((item) => `<option ${item === record.difficulty ? "selected" : ""}>${item}</option>`).join("")}
        </select>
      </label>
      <label>
        <span>掌握状态</span>
        <select name="masteryStatus">
          ${["待复习", "复习中", "已掌握", "已归档"].map((item) => `<option ${item === (record.masteryStatus || "待复习") ? "selected" : ""}>${item}</option>`).join("")}
        </select>
      </label>
      <label>
        <span>标签</span>
        <input name="tags" value="${escapeHtml(joinTags(record.tags))}" placeholder="试卷错题、期中、易错" />
      </label>
      <button class="primary-button compact" type="submit">保存归类</button>
    </form>
  </article>`;
}

function renderChildList() {
  if (!childList) return;

  if (!children.length) {
    childList.innerHTML = `<div class="empty-state compact-empty">
      <div class="empty-visual"></div>
      <strong>还没有孩子档案</strong>
      <span>添加孩子后，错题和批改记录会按孩子分别保存。</span>
    </div>`;
    return;
  }

  childList.innerHTML = children
    .map((child) => `
      <button class="child-item ${child.id === activeChildId ? "active" : ""}" type="button" data-select-child="${escapeHtml(child.id)}">
        <strong>${escapeHtml(child.name)}</strong>
        <span>${escapeHtml(childMeta(child))}</span>
      </button>
    `)
    .join("");
}

function renderStudentCards() {
  if (!studentGrid) return;

  if (!children.length) {
    studentGrid.innerHTML = `<div class="empty-state student-empty">
      <div class="empty-visual"></div>
      <strong>还没有学生档案</strong>
      <span>添加学生后，错题、批改记录和练习计划会按学生分别保存。</span>
      <button class="primary-button compact" type="button" data-open-child-modal>新增学生</button>
    </div>`;
    return;
  }

  studentGrid.innerHTML = children
    .map((child, index) => {
      const dueCount = mistakeItems.filter((item) => item.childId === child.id && isDue(item)).length;
      const childMistakes = mistakeItems.filter((item) => item.childId === child.id);
      const masteredCount = childMistakes.filter((item) => item.masteryStatus === "已掌握").length;
      const initials = escapeHtml(String(child.name || "学").slice(0, 1));
      const tone = ["blue", "purple", "orange"][index % 3];
      const active = child.id === activeChildId ? "active" : "";
      const mastery = childMistakes.length ? Math.round((masteredCount / childMistakes.length) * 100) : 0;

      return `<article class="student-card ${tone} ${active}">
        <div class="student-card-head">
          <div class="student-avatar">${initials}</div>
          <div>
            <h2>${escapeHtml(child.name || "未命名学生")}</h2>
            <p>${escapeHtml(childMeta(child))}</p>
          </div>
          <span class="student-state">${active ? "当前" : "可切换"}</span>
        </div>
        <div class="student-progress">
          <div>
            <span>当前掌握度</span>
            <strong>${mastery}%</strong>
          </div>
          <div class="progress-track small"><span style="width: ${mastery}%"></span></div>
        </div>
        <div class="student-alert">
          <span>待复习错题</span>
          <strong>${dueCount || "待同步"} 题</strong>
        </div>
        <div class="student-actions">
          <button class="primary-button compact" type="button" data-select-student="${escapeHtml(child.id)}">进入工作台</button>
          <button class="ghost-button compact" type="button" data-open-child-modal>编辑</button>
        </div>
      </article>`;
    })
    .join("");
}

function openChildModal() {
  childStatus.textContent = "";
  renderChildList();
  renderStudentCards();
  childModal.hidden = false;
}

function closeChildModal() {
  childModal.hidden = true;
}

async function loadMistakes() {
  mistakeList.innerHTML = `<div class="empty-state compact-empty">
    <div class="empty-visual loading"></div>
    <strong>正在加载错题库</strong>
    <span>会同步读取错题记录和复习时间。</span>
  </div>`;

  try {
    const params = readMistakeFilters();
    const response = await fetch(appUrl(`/api/v1/mistakes?${params.toString()}`));
    const data = await readJsonResponse(response);

    if (!response.ok) throw new Error(data.error || "错题库加载失败");

    mistakeItems = data.items || [];
    selectedMistakeIds = new Set([...selectedMistakeIds].filter((id) => mistakeItems.some((item) => item.id === id)));
    renderMistakeList(mistakeItems);
  } catch (error) {
    mistakeList.innerHTML = `<div class="result-content error">${formatText(error.message)}</div>`;
  }
}

toolList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tool]");
  if (!button) return;
  activeTool = button.dataset.tool;
  clearImageAttachment();
  renderToolList();
  renderFields();
});

sendCodeBtn.addEventListener("click", async () => {
  sendCodeBtn.disabled = true;
  authStatus.textContent = "正在发送验证码";

  try {
    const data = await apiJson("/api/v1/auth/code", {
      method: "POST",
      body: JSON.stringify({ email: authEmail.value })
    });
    authStatus.textContent = data.message;
  } catch (error) {
    authStatus.textContent = error.message;
  } finally {
    sendCodeBtn.disabled = false;
  }
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authStatus.textContent = "正在登录";

  try {
    const data = await apiJson("/api/v1/auth/verify", {
      method: "POST",
      body: JSON.stringify({ email: authEmail.value, code: authCode.value })
    });
    currentUser = data.currentUser;
    children = data.children || [];
    setQuota(data.quotaLeft);
    renderAuthState();
    renderChildSwitcher();
    authStatus.textContent = "";
    showHome();
    if (!children.length) openChildModal();
  } catch (error) {
    authStatus.textContent = error.message;
  }
});

logoutBtn.addEventListener("click", async () => {
  await apiJson("/api/v1/logout", { method: "POST", body: "{}" });
  currentUser = null;
  children = [];
  selectedMistakeIds.clear();
  localStorage.removeItem("edu_active_child_id");
  renderAuthState();
  renderChildSwitcher();
  showAuth();
});

manageChildrenBtn.addEventListener("click", () => {
  openChildModal();
});

addStudentPageBtn?.addEventListener("click", () => {
  openChildModal();
});

closeChildModalBtn.addEventListener("click", () => {
  closeChildModal();
});

childModal.addEventListener("click", (event) => {
  if (event.target === childModal) closeChildModal();
});

childList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-child]");
  if (!button) return;
  activeChildId = button.dataset.selectChild;
  localStorage.setItem("edu_active_child_id", activeChildId);
  selectedMistakeIds.clear();
  activeMistakeId = "";
  renderChildSwitcher();
  if (!mistakeBankView.hidden) loadMistakes();
});

childForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  childSubmitBtn.disabled = true;
  childStatus.textContent = "正在添加孩子";

  try {
    const input = Object.fromEntries(new FormData(childForm).entries());
    const data = await apiJson("/api/v1/children", {
      method: "POST",
      body: JSON.stringify(input)
    });
    children = data.items || [];
    activeChildId = data.child?.id || activeChildId;
    localStorage.setItem("edu_active_child_id", activeChildId);
    childForm.reset();
    childStatus.textContent = "已添加";
    renderChildSwitcher();
    if (!homeView.hidden || !toolView.hidden || !mistakeBankView.hidden) renderChildContext();
  } catch (error) {
    childStatus.textContent = error.message;
  } finally {
    childSubmitBtn.disabled = false;
  }
});

document.addEventListener("click", (event) => {
  const selectStudent = event.target.closest("[data-select-student]");
  if (selectStudent) {
    activeChildId = selectStudent.dataset.selectStudent;
    localStorage.setItem("edu_active_child_id", activeChildId);
    selectedMistakeIds.clear();
    activeMistakeId = "";
    renderChildSwitcher();
    showHome();
    return;
  }

  if (event.target.closest("[data-open-child-modal]")) {
    openChildModal();
    return;
  }

  const toolEntry = event.target.closest("[data-tool-entry]");
  if (toolEntry) {
    showTool(toolEntry.dataset.toolEntry);
    return;
  }

  if (event.target.closest("[data-view-students]")) {
    showStudents();
    return;
  }

  if (event.target.closest("[data-view-mistakes]")) {
    showMistakeBank();
    return;
  }

  if (event.target.closest("[data-view-practice]")) {
    showPractice();
    return;
  }

  if (event.target.closest("[data-view-report]")) {
    showReport();
    return;
  }

  if (event.target.closest("[data-view-resources]")) {
    showResources();
    return;
  }

  if (event.target.closest("[data-view-home]")) {
    showHome();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitBtn.disabled = true;
  submitBtn.textContent = "生成中";
  renderLoading();

  try {
    const response = await fetch(appUrl("/api/v1/generations"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolSlug: activeTool,
        childId: activeChildId,
        input: readInput(),
        fileId: imageAttachment?.fileId || null
      })
    });
    const data = await readJsonResponse(response);

    if (!response.ok) {
      setQuota(data.quotaLeft ?? quotaText.textContent);
      renderResult(`${data.error}\n\n${data.upgradeHint || "请补充必填信息后再试。"}`, "error");
      return;
    }

    setQuota(data.quotaLeft);

    if (activeTool === "mistake") {
      renderMistakeReviewResult(data.output, data.generationId, data.structuredMistakes || []);
    } else if (data.mistakeIds?.length || data.mistakeId) {
      const ids = data.mistakeIds?.length ? data.mistakeIds : [data.mistakeId];
      ids.forEach((id) => selectedMistakeIds.add(id));
      renderMistakeSavedResult(data.output, data.generationId, ids, data.mistakes || []);
    } else {
      renderResult(data.output);
    }
  } catch (error) {
    renderResult(`生成失败：${error.message}`, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "生成结果";
  }
});

function collectReviewMistakes(formNode) {
  return [...formNode.querySelectorAll("[data-review-card]")]
    .filter((card) => card.querySelector("[data-review-include]")?.checked)
    .map((card) => {
      const value = (field) => card.querySelector(`[data-field="${field}"]`)?.value || "";
      return {
        questionNumber: value("questionNumber"),
        question: value("question"),
        options: splitLines(value("options")),
        studentAnswer: value("studentAnswer"),
        correctAnswer: value("correctAnswer"),
        analysis: value("analysis"),
        knowledgePoints: splitTags(value("knowledgePoints")),
        wrongReasons: splitTags(value("wrongReasons")),
        questionType: value("questionType"),
        difficulty: value("difficulty"),
        tags: splitTags(value("tags"))
      };
    });
}

resultBox.addEventListener("change", (event) => {
  const selectAll = event.target.closest("[data-review-select-all]");
  if (!selectAll) return;
  const reviewForm = event.target.closest("[data-mistake-review]");
  reviewForm?.querySelectorAll("[data-review-include]").forEach((input) => {
    input.checked = selectAll.checked;
  });
});

resultBox.addEventListener("submit", async (event) => {
  const reviewForm = event.target.closest("[data-mistake-review]");
  if (!reviewForm) return;
  event.preventDefault();

  const generationId = reviewForm.dataset.mistakeReview;
  const submit = reviewForm.querySelector("button[type='submit']");
  const mistakes = collectReviewMistakes(reviewForm);

  if (!mistakes.length) {
    reviewForm.insertAdjacentHTML("afterbegin", `<div class="result-content error compact-result">请至少勾选一道错题入库。</div>`);
    return;
  }

  submit.disabled = true;
  submit.textContent = "入库中";

  try {
    const data = await apiJson(`/api/v1/generations/${encodeURIComponent(generationId)}/mistakes`, {
      method: "POST",
      body: JSON.stringify({ mistakes })
    });
    const ids = data.mistakeIds || [];
    ids.forEach((id) => selectedMistakeIds.add(id));
    renderMistakeSavedResult(
      `已确认入库 ${ids.length} 道错题。后续可以在错题库继续编辑知识点、错因和掌握状态。`,
      generationId,
      ids,
      data.mistakes?.length ? data.mistakes : mistakes
    );
    loadMistakes();
  } catch (error) {
    reviewForm.insertAdjacentHTML("afterbegin", `<div class="result-content error compact-result">${formatText(error.message)}</div>`);
  } finally {
    submit.disabled = false;
    submit.textContent = "确认入库";
  }
});

copyBtn.addEventListener("click", async () => {
  const text = resultBox.textContent.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  copyBtn.textContent = "已复制";
  window.setTimeout(() => {
    copyBtn.textContent = "复制";
  }, 1200);
});

resetBtn.addEventListener("click", () => {
  form.reset();
  clearImageAttachment();
});

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    renderResult("只支持上传图片文件。", "error");
    clearImageAttachment();
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    renderResult("图片不能超过 5MB。建议先压缩或裁剪后再上传。", "error");
    clearImageAttachment();
    return;
  }

  try {
    const dataUrl = await readImageFile(file);
    imageAttachment = {
      fileId: null,
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl
    };
    const uploadResponse = await fetch(appUrl("/api/v1/uploads"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachment: imageAttachment })
    });
    const uploadData = await readJsonResponse(uploadResponse);

    if (!uploadResponse.ok) {
      throw new Error(uploadData.error || "图片上传失败");
    }

    imageAttachment.fileId = uploadData.fileId;
    previewImage.src = dataUrl;
    imageName.textContent = file.name;
    imageMeta.textContent = `${file.type.replace("image/", "").toUpperCase()} · ${formatFileSize(file.size)}`;
    imagePreview.hidden = false;
  } catch (error) {
    renderResult(error.message, "error");
    clearImageAttachment();
  }
});

removeImageBtn.addEventListener("click", () => {
  clearImageAttachment();
});

childSelect.addEventListener("change", () => {
  activeChildId = childSelect.value;
  if (!activeChildId) {
    openChildModal();
    return;
  }
  localStorage.setItem("edu_active_child_id", activeChildId);
  selectedMistakeIds.clear();
  activeMistakeId = "";
  renderChildContext();
  updateMistakeStats(mistakeItems);
  resetMistakeSelection("已切换孩子，请从左侧列表选择一道错题。");

  if (!mistakeBankView.hidden) loadMistakes();
});

refreshMistakesBtn.addEventListener("click", () => {
  loadMistakes();
});

clearMistakeFiltersBtn.addEventListener("click", () => {
  clearMistakeFilters();
});

mistakeFilters.addEventListener("input", () => {
  window.clearTimeout(mistakeFilters._timer);
  mistakeFilters._timer = window.setTimeout(loadMistakes, 260);
});

mistakeFilters.addEventListener("change", () => {
  loadMistakes();
});

mistakeList.addEventListener("click", async (event) => {
  const selectInput = event.target.closest("[data-select-mistake]");
  if (selectInput) {
    const id = selectInput.dataset.selectMistake;
    if (selectInput.checked) {
      selectedMistakeIds.add(id);
    } else {
      selectedMistakeIds.delete(id);
    }
    updateMistakeStats(mistakeItems);
    return;
  }

  const openButton = event.target.closest("[data-open-mistake]");
  if (!openButton) return;

  const id = openButton.dataset.openMistake;
  const localRecord = mistakeItems.find((item) => item.id === id);
  if (localRecord) renderMistakeDetail(localRecord);

  try {
    const response = await fetch(appUrl(`/api/v1/mistakes/${encodeURIComponent(id)}`));
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "错题详情加载失败");
    renderMistakeDetail(data.mistake);
  } catch (error) {
    mistakeDetail.innerHTML = `<div class="result-content error">${formatText(error.message)}</div>`;
  }
});

mistakeDetail.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-mistake]");
  if (deleteButton) {
    const id = deleteButton.dataset.deleteMistake || activeMistakeId;
    if (!id || !window.confirm("确定删除这道错题吗？删除后不会再出现在错题列表和出卷范围里。")) return;

    deleteButton.disabled = true;
    const originalText = deleteButton.textContent;
    deleteButton.textContent = "删除中";

    try {
      await apiJson(`/api/v1/mistakes/${encodeURIComponent(id)}`, {
        method: "DELETE",
        body: "{}"
      });
      selectedMistakeIds.delete(id);
      mistakeItems = mistakeItems.filter((item) => item.id !== id);
      renderMistakeList(mistakeItems);
      resetMistakeSelection("题目已删除，请从左侧列表选择下一道错题。");
    } catch (error) {
      mistakeDetail.insertAdjacentHTML("afterbegin", `<div class="result-content error">${formatText(error.message)}</div>`);
      deleteButton.disabled = false;
      deleteButton.textContent = originalText;
    }
    return;
  }

  const reviewButton = event.target.closest("[data-review-result]");
  if (!reviewButton || !activeMistakeId) return;

  reviewButton.disabled = true;
  const originalText = reviewButton.textContent;
  reviewButton.textContent = "提交中";

  try {
    const data = await apiJson(`/api/v1/mistakes/${encodeURIComponent(activeMistakeId)}/reviews`, {
      method: "POST",
      body: JSON.stringify({ result: reviewButton.dataset.reviewResult })
    });
    mistakeItems = mistakeItems.map((item) => item.id === data.mistake.id ? { ...item, ...data.mistake } : item);
    renderMistakeList(mistakeItems);
    renderMistakeDetail(data.mistake);
  } catch (error) {
    mistakeDetail.insertAdjacentHTML("afterbegin", `<div class="result-content error">${formatText(error.message)}</div>`);
  } finally {
    reviewButton.disabled = false;
    reviewButton.textContent = originalText;
  }
});

mistakeDetail.addEventListener("submit", async (event) => {
  const editForm = event.target.closest("[data-mistake-edit]");
  if (!editForm) return;
  event.preventDefault();

  const id = editForm.dataset.mistakeEdit;
  const submit = editForm.querySelector("button[type='submit']");
  submit.disabled = true;
  submit.textContent = "保存中";

  try {
    const values = Object.fromEntries(new FormData(editForm).entries());
    const data = await apiJson(`/api/v1/mistakes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(values)
    });
    mistakeItems = mistakeItems
      .map((item) => item.id === data.mistake.id ? { ...item, ...data.mistake } : item)
      .filter((item) => item.status === "active");
    renderMistakeList(mistakeItems);
    renderMistakeDetail(data.mistake);
  } catch (error) {
    editForm.insertAdjacentHTML("beforebegin", `<div class="result-content error">${formatText(error.message)}</div>`);
  } finally {
    submit.disabled = false;
    submit.textContent = "保存归类";
  }
});

examForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  examSubmitBtn.disabled = true;
  examSubmitBtn.textContent = "出题中";
  examResult.innerHTML = `<div class="empty-state compact-empty">
    <div class="empty-visual loading"></div>
    <strong>正在生成练习卷</strong>
    <span>会优先使用勾选错题；未勾选时使用待复习错题。</span>
  </div>`;

  try {
    const config = Object.fromEntries(new FormData(examForm).entries());
    const response = await fetch(appUrl("/api/v1/exam-papers"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...config,
        count: Number(config.count || 5),
        choiceCount: config.choiceCount === "" ? null : Number(config.choiceCount),
        blankCount: config.blankCount === "" ? null : Number(config.blankCount),
        judgeCount: config.judgeCount === "" ? null : Number(config.judgeCount),
        qaCount: config.qaCount === "" ? null : Number(config.qaCount),
        childId: activeChildId,
        mistakeIds: [...selectedMistakeIds]
      })
    });
    const data = await readJsonResponse(response);

    if (!response.ok) throw new Error(data.error || "练习卷生成失败");

    const paper = data.paper;
    examResult.innerHTML = `<article class="paper-preview">
      <div class="paper-preview-head">
        <div>
          <span class="eyebrow">练习卷预览</span>
          <h3>${escapeHtml(paper.title || "错题巩固卷")}</h3>
        </div>
        ${paper.pdfUrl ? `<a class="ghost-button compact" href="${escapeHtml(appUrl(paper.pdfUrl))}" target="_blank" rel="noreferrer">下载 PDF</a>` : ""}
      </div>
      ${paper.generationWarning ? `<div class="paper-warning">${formatText(paper.generationWarning)}</div>` : ""}
      <pre>${escapeHtml(paper.content || "")}</pre>
    </article>`;
  } catch (error) {
    examResult.innerHTML = `<div class="result-content error">${formatText(error.message)}</div>`;
  } finally {
    examSubmitBtn.disabled = false;
    examSubmitBtn.textContent = "生成练习卷";
  }
});

loadTools()
  .then(() => {
    if (!currentUser) {
      showAuth();
      return;
    }

    if (window.location.hash === "#students") {
      showStudents();
      return;
    }

    if (window.location.hash === "#mistakes") {
      showMistakeBank();
      return;
    }

    if (window.location.hash === "#practice") {
      showPractice();
      return;
    }

    if (window.location.hash === "#report") {
      showReport();
      return;
    }

    if (window.location.hash === "#resources") {
      showResources();
      return;
    }

    const hashTool = window.location.hash.replace("#", "");
    if (tools[hashTool]) showTool(hashTool);
    else showHome();
  })
  .catch((error) => {
    renderResult(`初始化失败：${error.message}\n\n请用 npm start 启动本地服务后访问页面。`, "error");
  });
