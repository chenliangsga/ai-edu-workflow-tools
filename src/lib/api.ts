export type Child = {
  id: string;
  name: string;
  birthYear?: number;
  birthMonth?: number;
  grade?: string;
};

export type CurrentUser = {
  email: string;
};

export type Mistake = {
  id: string;
  childId: string;
  childName?: string;
  subject?: string;
  grade?: string;
  question?: string;
  options?: string[];
  studentAnswer?: string;
  correctAnswer?: string;
  analysis?: string;
  visualType?: string;
  visualComplexity?: string;
  visualRenderStrategy?: string;
  supportedTemplate?: string;
  needsCrop?: boolean;
  visualConfidence?: number;
  visualDescription?: string;
  visualMarker?: string;
  imageRegion?: ImageRegion | null;
  knowledgePoints?: string[];
  wrongReasons?: string[];
  questionType?: string;
  difficulty?: string;
  tags?: string[];
  sourceAttachment?: {
    id?: string;
    name?: string;
    type?: string;
    size?: number;
    url?: string;
    enhanced?: UploadedFileMeta | null;
    kind?: string;
    crop?: UploadedFileMeta | null;
    original?: UploadedFileMeta | null;
    region?: ImageRegion | null;
  };
  reviewCount?: number;
  nextReviewAt?: string;
  masteryStatus?: string;
  createdAt?: string;
};

export type MistakeDraft = {
  questionNumber?: string;
  subject?: string;
  grade?: string;
  question?: string;
  options?: string[];
  studentAnswer?: string;
  correctAnswer?: string;
  analysis?: string;
  visualType?: string;
  visualComplexity?: string;
  visualRenderStrategy?: string;
  supportedTemplate?: string;
  needsCrop?: boolean;
  visualConfidence?: number;
  visualDescription?: string;
  visualMarker?: string;
  imageRegion?: ImageRegion | null;
  sourceAttachment?: UploadedSourceAttachment | null;
  knowledgePoints?: string[];
  wrongReasons?: string[];
  questionType?: string;
  difficulty?: string;
  tags?: string[];
  include?: boolean;
};

export type ImageRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  unit?: 'ratio';
};

export type UploadedFileMeta = {
  id?: string;
  name?: string;
  type?: string;
  size?: number;
  url?: string;
  enhanced?: UploadedFileMeta | null;
};

export type UploadedSourceAttachment = UploadedFileMeta & {
  kind?: string;
  crop?: UploadedFileMeta | null;
  enhanced?: UploadedFileMeta | null;
  original?: UploadedFileMeta | null;
  region?: ImageRegion | null;
};

export type MistakeStats = {
  total: number;
  mastered?: number;
  due: number;
  knowledgePointCount: number;
  knowledgePointTop: Array<{ name: string; count: number }>;
  wrongReasonTop: Array<{ name: string; count: number }>;
};

export type Generation = {
  id: string;
  toolSlug: string;
  childId: string;
  childName?: string;
  input?: Record<string, any>;
  output?: string;
  createdAt?: string;
};

export type MasteryItem = {
  knowledgePoint: string;
  total: number;
  correct: number;
  wrong: number;
  accuracy: number;
};

export type ExamPaperQuestion = {
  id: string;
  number: number;
  type?: string;
  prompt?: string;
  knowledgePoints?: string[];
  sourceMistakeId?: string;
};

export type ExamPaper = {
  id: string;
  childId: string;
  title?: string;
  content?: string;
  questions?: ExamPaperQuestion[];
  targetKnowledgePoints?: string[];
  weakKnowledgePoints?: string[];
  sourceMistakeIds?: string[];
  pdfUrl?: string;
  pdfFilename?: string;
  generationWarning?: string;
  createdAt?: string;
};

export type UploadedAttachment = {
  fileId: string;
  file?: {
    id?: string;
    name?: string;
    type?: string;
    size?: number;
    url?: string;
  };
};

export async function readJson(response: Response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

export function childMeta(child?: Child) {
  if (!child) return '请先添加学生';
  const birth = child.birthYear && child.birthMonth ? `${child.birthYear}年${child.birthMonth}月` : '出生年月未填';
  return child.grade ? `${birth} · ${child.grade}` : birth;
}

export function formatDate(value?: string) {
  if (!value) return '待安排';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '待安排';
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function compact(value?: string, fallback = '暂无内容', max = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function isDue(mistake: Mistake) {
  return Boolean(mistake.nextReviewAt && new Date(mistake.nextReviewAt).getTime() <= Date.now());
}

export function apiGet(path: string) {
  return fetch(path).then(readJson);
}

export function apiJson(path: string, body: Record<string, any>, method = 'POST') {
  return fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(readJson);
}

export function apiDelete(path: string) {
  return fetch(path, { method: 'DELETE' }).then(readJson);
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

export async function uploadImageFiles(files: File[]) {
  const uploaded: UploadedAttachment[] = [];

  for (const file of files) {
    const dataUrl = await fileToDataUrl(file);
    const data = await apiJson('/api/v1/uploads', {
      attachment: {
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl,
      },
    }) as UploadedAttachment;
    uploaded.push(data);
  }

  return uploaded;
}
