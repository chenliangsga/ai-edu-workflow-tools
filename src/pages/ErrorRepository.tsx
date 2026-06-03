import { FormEvent, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, Brain, Calculator, CalendarCheck, Camera, CheckCheck, CheckCircle2, Clock, FileImage, Loader2, Plus, Search, Star, Trash2, Upload, X, XCircle } from 'lucide-react';
import { ImageRegion, Mistake, MistakeDraft, MistakeStats, UploadedFileMeta, apiJson, compact, formatDate, isDue, readJson } from '@/src/lib/api';
import PaperContent from '@/src/components/PaperContent';

type UploadStage = 'idle' | 'reading' | 'uploading' | 'reviewing' | 'saving' | 'saved';
type PaperSupplementDraft = {
  majorNumber: string;
  minorNumber: string;
  pageNumber: string;
  teacherMark: string;
  imagePresence: string;
  imageComplexity: string;
  note: string;
};
type PaperSupplementItem = PaperSupplementDraft & { id: number };

export default function ErrorRepository({
  mistakes = [],
  stats,
  activeChildId,
  activeChild,
  refreshData,
  setCurrentView,
  paperUploadOpen,
  setPaperUploadOpen,
}: any) {
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState('');
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle');
  const [uploadStatus, setUploadStatus] = useState('');
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [paperDataUrl, setPaperDataUrl] = useState('');
  const [paperAttachment, setPaperAttachment] = useState<UploadedFileMeta | null>(null);
  const [paperFileInputKey, setPaperFileInputKey] = useState(0);
  const [generationId, setGenerationId] = useState('');
  const [recognizedOutput, setRecognizedOutput] = useState('');
  const [drafts, setDrafts] = useState<MistakeDraft[]>([]);
  const [cropBusyIndex, setCropBusyIndex] = useState<number | null>(null);
  const [paperSupplementDraft, setPaperSupplementDraft] = useState<PaperSupplementDraft>(createEmptyPaperSupplementDraft());
  const [paperSupplementItems, setPaperSupplementItems] = useState<PaperSupplementItem[]>([]);
  const recognitionAbortRef = useRef<AbortController | null>(null);
  const recognitionRunRef = useRef(0);
  const mistakeList = mistakes as Mistake[];
  const stat = stats as MistakeStats;

  const filtered = useMemo(() => {
    const key = keyword.trim();
    if (!key) return mistakeList;
    return mistakeList.filter((item) => [
      item.subject,
      item.grade,
      item.question,
      item.analysis,
      ...(item.knowledgePoints || []),
      ...(item.wrongReasons || []),
    ].join('\n').includes(key));
  }, [keyword, mistakeList]);

  const selected = filtered.find((item) => item.id === selectedId) || filtered[0];
  const paperSupplementText = useMemo(() => buildPaperSupplementText(paperSupplementItems), [paperSupplementItems]);

  async function review(result: 'correct' | 'wrong' | 'mastered') {
    if (!selected) return;
    setBusy(result);
    try {
      await apiJson(`/api/v1/mistakes/${selected.id}/reviews`, { result });
      await refreshData();
    } finally {
      setBusy('');
    }
  }

  async function removeMistake() {
    if (!selected || !window.confirm('确定删除这道错题吗？')) return;
    setBusy('delete');
    try {
      await fetch(`/api/v1/mistakes/${selected.id}`, { method: 'DELETE' });
      await refreshData();
      setSelectedId('');
    } finally {
      setBusy('');
    }
  }

  function closeUploadModal() {
    if (uploadStage === 'saving') return;
    if (uploadStage === 'uploading') cancelRecognition('');
    resetUploadState();
    setPaperUploadOpen?.(false);
  }

  function resetUploadState() {
    recognitionAbortRef.current?.abort();
    recognitionAbortRef.current = null;
    recognitionRunRef.current += 1;
    setUploadStage('idle');
    setUploadStatus('');
    setPaperFile(null);
    setPaperDataUrl('');
    setPaperAttachment(null);
    setPaperFileInputKey((key) => key + 1);
    setGenerationId('');
    setRecognizedOutput('');
    setDrafts([]);
    setCropBusyIndex(null);
    setPaperSupplementDraft(createEmptyPaperSupplementDraft());
    setPaperSupplementItems([]);
  }

  async function choosePaperFile(file?: File | null) {
    recognitionAbortRef.current?.abort();
    recognitionAbortRef.current = null;
    const runId = recognitionRunRef.current + 1;
    recognitionRunRef.current = runId;
    setPaperFile(file || null);
    setUploadStage('idle');
    setUploadStatus('');
    setPaperDataUrl('');
    setPaperAttachment(null);
    setGenerationId('');
    setRecognizedOutput('');
    setDrafts([]);
    setCropBusyIndex(null);

    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadStatus('目前支持 JPG、PNG、WebP 等图片。');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadStatus('图片不能超过 5MB。');
      return;
    }

    setUploadStage('reading');
    setUploadStatus('正在读取图片...');
    try {
      const dataUrl = await fileToDataUrl(file);
      if (recognitionRunRef.current !== runId) return;
      setPaperDataUrl(dataUrl);
      setUploadStage('idle');
      setUploadStatus('');
    } catch (error: any) {
      if (recognitionRunRef.current !== runId) return;
      setUploadStage('idle');
      setUploadStatus(error.message || '图片读取失败，请重新选择图片后再试。');
    }
  }

  function updatePaperSupplementDraft(patch: Partial<PaperSupplementDraft>) {
    setPaperSupplementDraft((draft) => ({ ...draft, ...patch }));
  }

  function addPaperSupplementItem() {
    const item = normalizePaperSupplementDraft(paperSupplementDraft);
    if (!hasPaperSupplementContent(item)) {
      setUploadStatus('请先填写题号、图片情况或备注，再添加补充说明。');
      return;
    }
    setPaperSupplementItems((items) => [...items, { ...item, id: Date.now() + items.length }]);
    setPaperSupplementDraft(createEmptyPaperSupplementDraft());
    setUploadStatus('');
  }

  function removePaperSupplementItem(id: number) {
    setPaperSupplementItems((items) => items.filter((item) => item.id !== id));
  }

  function cancelRecognition(message = '已取消识别，可重新点击上传并识别错题。') {
    recognitionAbortRef.current?.abort();
    recognitionAbortRef.current = null;
    recognitionRunRef.current += 1;
    setUploadStage('idle');
    setUploadStatus(message);
    setGenerationId('');
    setRecognizedOutput('');
    setDrafts([]);
  }

  async function recognizePaper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeChildId) {
      setUploadStatus('请先添加并选择学生。');
      return;
    }
    if (!paperFile) {
      setUploadStatus('请先上传一张已批改试卷照片。');
      return;
    }
    if (!paperFile.type.startsWith('image/')) {
      setUploadStatus('目前支持 JPG、PNG、WebP 等图片。');
      return;
    }
    if (paperFile.size > 5 * 1024 * 1024) {
      setUploadStatus('图片不能超过 5MB。');
      return;
    }
    if (!paperDataUrl) {
      setUploadStatus('图片还没有读取完成，请重新选择图片后再试。');
      return;
    }

    const form = event.currentTarget;
    const input = Object.fromEntries(new FormData(form).entries());

    setUploadStage('uploading');
    setUploadStatus('正在上传试卷照片并识别错题...');
    setGenerationId('');
    setRecognizedOutput('');
    setDrafts([]);

    recognitionAbortRef.current?.abort();
    const runId = recognitionRunRef.current + 1;
    recognitionRunRef.current = runId;
    const controller = new AbortController();
    recognitionAbortRef.current = controller;

    try {
      const uploadData = await postJsonWithSignal('/api/v1/uploads', {
        attachment: {
          name: paperFile.name,
          type: paperFile.type,
          size: paperFile.size,
          dataUrl: paperDataUrl,
        },
      }, controller.signal);
      if (recognitionRunRef.current !== runId || controller.signal.aborted) return;
      setPaperAttachment(uploadData.file || null);
      const generation = await postJsonWithSignal('/api/v1/generations', {
        toolSlug: 'mistake',
        childId: activeChildId,
        fileId: uploadData.fileId,
        input: {
          subject: input.subject,
          grade: input.grade,
          paperName: input.paperName,
          question: input.question,
          studentAnswer: input.studentAnswer,
          correctAnswer: input.correctAnswer,
        },
      }, controller.signal);
      if (recognitionRunRef.current !== runId || controller.signal.aborted) return;
      const nextDrafts = normalizeDrafts(
        generation.structuredMistakes?.length ? generation.structuredMistakes : extractDraftsFromOutput(generation.output || '')
      );
      setGenerationId(generation.generationId || '');
      setRecognizedOutput(generation.output || '');
      setDrafts(nextDrafts);
      setUploadStage('reviewing');
      setUploadStatus(nextDrafts.length ? `识别到 ${nextDrafts.length} 道错题，请核对后选择入库。` : '没有识别到明确错题，可以补充错题范围后重新识别。');
    } catch (error: any) {
      if (recognitionRunRef.current !== runId) return;
      setUploadStage('idle');
      setUploadStatus(isAbortError(error) ? '已取消识别，可重新点击上传并识别错题。' : (error.message || '识别失败，请稍后重试。'));
    } finally {
      if (recognitionRunRef.current === runId) {
        recognitionAbortRef.current = null;
      }
    }
  }

  async function confirmDrafts() {
    const selectedDrafts = drafts.filter((draft) => draft.include !== false);
    if (!generationId) {
      setUploadStatus('识别记录不存在，请重新上传识别。');
      return;
    }
    if (!selectedDrafts.length) {
      setUploadStatus('请至少选择一道错题入库。');
      return;
    }

    setUploadStage('saving');
    setUploadStatus('正在写入错题库...');
    try {
      const data = await apiJson(`/api/v1/generations/${encodeURIComponent(generationId)}/mistakes`, { mistakes: selectedDrafts });
      await refreshData();
      const firstId = data.mistakeIds?.[0] || data.mistakes?.[0]?.id || '';
      if (firstId) setSelectedId(firstId);
      setUploadStage('saved');
      setUploadStatus(`已入库 ${data.mistakeCount || selectedDrafts.length} 道错题。`);
    } catch (error: any) {
      setUploadStage('reviewing');
      setUploadStatus(error.message || '入库失败，请稍后重试。');
    }
  }

  function updateDraft(index: number, patch: Partial<MistakeDraft>) {
    setDrafts((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function selectAllDrafts(include: boolean) {
    setDrafts((items) => items.map((item) => ({ ...item, include })));
  }

  async function generateDraftCrop(index: number, region: ImageRegion) {
    const draft = drafts[index];
    if (!draft || !paperDataUrl || !paperAttachment) {
      setUploadStatus('请先上传并识别数学试卷，再生成单题截图。');
      return;
    }

    setCropBusyIndex(index);
    setUploadStatus(`正在生成第 ${index + 1} 道错题的单题截图...`);
    try {
      const croppedDataUrl = await cropImageDataUrl(paperDataUrl, region);
      const uploadData = await apiJson('/api/v1/uploads', {
        attachment: {
          name: `${paperFile?.name || 'math-paper'}-错题${index + 1}.png`,
          type: 'image/png',
          size: estimateDataUrlSize(croppedDataUrl),
          dataUrl: croppedDataUrl,
          purpose: 'mistake_crop',
          enhance: 'worksheet',
        },
      });
      const crop = uploadData.file || null;
      updateDraft(index, {
        imageRegion: normalizeRegion(region),
        sourceAttachment: {
          ...(crop || {}),
          kind: 'mistake_crop',
          enhanced: crop?.enhanced || null,
          crop,
          original: paperAttachment,
          region: normalizeRegion(region),
        },
      });
      setUploadStatus(`已生成第 ${index + 1} 道错题截图，确认无误后可入库。`);
    } catch (error: any) {
      setUploadStatus(error.message || '单题截图生成失败，请调整区域后重试。');
    } finally {
      setCropBusyIndex(null);
    }
  }

  return (
    <div className="pb-10 min-h-full">
      <header className="mb-6 lg:mb-8">
        <div className="flex items-center justify-between gap-4 mb-6">
          <h1 className="text-[28px] lg:text-[32px] font-bold text-gray-900 leading-tight">错题仓库</h1>
          <div className="flex flex-wrap justify-end gap-3">
            <button className="border border-blue-200 bg-white text-blue-600 px-5 py-2.5 rounded-xl text-[14px] font-bold flex items-center gap-2 hover:bg-blue-50" type="button" onClick={() => setPaperUploadOpen?.(true)}>
              <Upload className="w-4 h-4" /> 上传试卷
            </button>
            <button className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-[14px] font-bold flex items-center gap-2 hover:bg-blue-700" type="button" onClick={() => setCurrentView?.('practice')}>
              <Camera className="w-4 h-4" /> 生成练习
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard label="错题总数" value={stat?.total || 0} icon={<Calculator className="w-4 h-4" />} />
          <StatCard label="今日待复习" value={stat?.due || 0} icon={<CalendarCheck className="w-4 h-4" />} tone="blue" />
          <StatCard label="知识点数量" value={stat?.knowledgePointCount || 0} icon={<AlertTriangle className="w-4 h-4" />} tone="orange" />
          <StatCard label="已掌握数量" value={mistakeList.filter((item) => item.masteryStatus === '已掌握').length} icon={<CheckCircle2 className="w-4 h-4" />} tone="green" />
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-6 h-[800px]">
        <section className="lg:w-[40%] flex flex-col bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm flex-shrink-0">
          <div className="p-4 border-b border-gray-200 bg-gray-50/50 space-y-4">
            <div className="relative w-full">
              <input value={keyword} onChange={(event) => setKeyword(event.target.value)} className="w-full bg-white border border-gray-200 rounded-xl py-2.5 pl-10 pr-4 text-[14px] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="搜索题目内容、知识点..." type="text" />
              <Search className="absolute left-3.5 top-3 text-gray-400 w-4 h-4" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50/30">
            {filtered.length ? filtered.map((item) => (
              <button key={item.id} className={`w-full text-left bg-white p-4 rounded-xl cursor-pointer shadow-sm transition-colors ${selected?.id === item.id ? 'border-2 border-blue-500' : 'border border-gray-200 hover:border-blue-300'}`} onClick={() => setSelectedId(item.id)}>
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[12px] font-medium bg-gray-100 text-gray-700">{item.subject || '学科'}</span>
                    <div className="flex text-blue-500">
                      {Array.from({ length: item.difficulty === '困难' ? 4 : 3 }, (_, index) => <Star key={index} className="w-3.5 h-3.5 fill-current" />)}
                    </div>
                  </div>
                  <span className={`text-[12px] font-medium flex items-center gap-1 ${isDue(item) ? 'text-orange-500' : 'text-gray-400'}`}>
                    <Clock className="w-3.5 h-3.5" /> {isDue(item) ? '今日复习' : formatDate(item.nextReviewAt)}
                  </span>
                </div>
                <p className="text-[14px] text-gray-800 line-clamp-2 mb-3 leading-relaxed">{compact(item.question, '见上传图片')}</p>
                <div className="flex flex-wrap gap-2">
                  {(item.knowledgePoints?.length ? item.knowledgePoints : ['知识点待提取']).slice(0, 2).map((point) => (
                    <span key={point} className="px-2 py-1 rounded bg-gray-50 border border-gray-200 text-[11px] text-gray-500">{point}</span>
                  ))}
                </div>
              </button>
            )) : (
              <div className="p-6 text-center text-gray-500">暂无错题。完成一次试卷错题入库后会显示在这里。</div>
            )}
          </div>
        </section>

        <section className="lg:w-[60%] flex flex-col bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm relative">
          {selected ? (
            <>
              <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
                <div>
                  <h2 className="text-[20px] font-bold text-gray-900 mb-3">{selected.subject || '错题'} - {selected.questionType || '原题详情'}</h2>
                  <div className="flex gap-2 flex-wrap">
                    {(selected.knowledgePoints || []).map((point) => <span key={point} className="px-2.5 py-1 rounded bg-gray-50 border border-gray-200 text-[12px] text-gray-600">{point}</span>)}
                    {(selected.wrongReasons || []).map((reason) => <span key={reason} className="px-2.5 py-1 rounded bg-red-50 border border-red-100 text-[12px] text-red-600">{reason}</span>)}
                  </div>
                </div>
                <button className="text-red-500 hover:bg-red-50 rounded-xl px-3 py-2 text-[13px] font-bold" disabled={busy === 'delete'} onClick={removeMistake}>删除</button>
              </div>

              <div className="p-6 flex-1 overflow-y-auto space-y-6 pb-32">
                <OriginalQuestionBlock mistake={selected} />
                {selected.options?.length ? <DetailBlock title="选项">{selected.options.join('\n')}</DetailBlock> : null}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <AnswerBox icon={<XCircle className="w-4 h-4 text-red-500" />} title="学生作答" text={selected.studentAnswer || '未提供'} tone="red" />
                  <AnswerBox icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} title="正确答案" text={selected.correctAnswer || '未提供'} tone="green" />
                </div>
                <div className="bg-blue-50/50 rounded-xl border border-blue-100 overflow-hidden relative mt-8">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-purple-500"></div>
                  <div className="p-5 flex items-start gap-4 bg-white">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
                      <Brain className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 text-[15px]">AI 诊断解析</h3>
                      <p className="text-[14px] text-gray-600 mt-1.5 leading-relaxed whitespace-pre-wrap">{selected.analysis || '暂无解析'}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="absolute bottom-0 left-0 w-full p-4 bg-white border-t border-gray-100 shadow-[0_-4px_10px_rgba(0,0,0,0.03)] flex justify-between items-center z-10">
                <button className="px-4 py-2.5 border border-blue-200 text-blue-600 font-bold rounded-xl hover:bg-blue-50 transition-colors flex items-center gap-2 text-[14px]" onClick={() => setCurrentView?.('practice')}>
                  <Bot className="w-4 h-4" /> 生成同类题
                </button>
                <div className="flex gap-3">
                  <button className="px-6 py-2.5 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-colors text-[14px]" disabled={Boolean(busy)} onClick={() => review('wrong')}>又错了</button>
                  <button className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-sm text-[14px]" disabled={Boolean(busy)} onClick={() => review('correct')}>做对了</button>
                  <button className="px-6 py-2.5 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-colors shadow-sm flex items-center gap-1.5 text-[14px]" disabled={Boolean(busy)} onClick={() => review('mastered')}>
                    <CheckCheck className="w-4 h-4" /> 已掌握
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="grid place-items-center h-full text-gray-500">选择一道错题查看详情。</div>
          )}
        </section>
      </div>

      {paperUploadOpen && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-gray-950/45 p-4" onClick={closeUploadModal}>
          <section className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
              <div>
                <p className="text-[12px] font-bold text-blue-600">试卷错题入库</p>
                <h2 className="mt-1 text-[22px] font-bold text-gray-900">上传已批改试卷，AI 识别后确认入库</h2>
                <p className="mt-1 text-[13px] text-gray-500">当前学生：{activeChild?.name || '未选择'}</p>
              </div>
              <button className="rounded-full p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50" type="button" disabled={uploadStage === 'saving'} onClick={closeUploadModal} title={uploadStage === 'uploading' ? '取消识别并关闭' : '关闭'}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(92vh-84px)] overflow-y-auto px-6 pb-14 pt-6">
              <form className="grid items-start gap-4 lg:grid-cols-[1fr_1.1fr]" onSubmit={recognizePaper}>
                <div className="space-y-4">
                  <label className="grid min-h-[220px] cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/40 p-5 text-center hover:border-blue-400">
                    <input key={paperFileInputKey} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => choosePaperFile(event.target.files?.[0] || null)} />
                    <span className="grid gap-3 place-items-center">
                      <FileImage className="h-10 w-10 text-blue-600" />
                      <span className="text-[15px] font-bold text-gray-900">{paperFile ? paperFile.name : '选择或拖入试卷照片'}</span>
                      <span className="text-[12px] text-gray-500">支持 JPG / PNG / WebP，最大 5MB</span>
                    </span>
                  </label>
                  <div className="grid grid-cols-2 items-start gap-3">
                    <label className="grid gap-2 text-[13px] font-bold text-gray-700">
                      学科
                      <select className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none focus:border-blue-500" name="subject" defaultValue="数学" required>
                        {['数学'].map((item) => <option key={item}>{item}</option>)}
                      </select>
                      <span className="text-[11px] font-medium text-gray-400">当前阶段先把数学错题闭环做完整，其他学科图形题暂不扩展。</span>
                    </label>
                    <label className="grid gap-2 text-[13px] font-bold text-gray-700">
                      年级
                      <select className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none focus:border-blue-500" name="grade" defaultValue={activeChild?.grade || '小学'} required>
                        {['小学', '初一', '初二', '初三', '高一', '高二', '高三'].map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="grid gap-2 text-[13px] font-bold text-gray-700">
                    试卷名称
                    <input className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none focus:border-blue-500" name="paperName" placeholder="例如：五下数学单元测试" />
                  </label>
                  <input type="hidden" name="question" value={paperSupplementText} readOnly />
                  <PaperSupplementEditor
                    draft={paperSupplementDraft}
                    items={paperSupplementItems}
                    onDraftChange={updatePaperSupplementDraft}
                    onAdd={addPaperSupplementItem}
                    onRemove={removePaperSupplementItem}
                  />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[13px] outline-none focus:border-blue-500" name="studentAnswer" placeholder="学生答案补充，可选" />
                    <input className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[13px] outline-none focus:border-blue-500" name="correctAnswer" placeholder="标准答案补充，可选" />
                  </div>
                  <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                    <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-[15px] font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={uploadStage === 'reading' || uploadStage === 'uploading' || uploadStage === 'saving'}>
                      {uploadStage === 'reading' || uploadStage === 'uploading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {uploadStage === 'reading' ? '读取中...' : uploadStage === 'uploading' ? '识别中...' : '上传并识别错题'}
                    </button>
                    {uploadStage === 'uploading' && (
                      <button className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-[14px] font-bold text-gray-700 hover:bg-gray-100" type="button" onClick={() => cancelRecognition()}>
                        取消识别
                      </button>
                    )}
                  </div>
                  {uploadStatus && <p className={`rounded-xl px-4 py-3 text-[13px] font-medium ${uploadStage === 'saved' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{uploadStatus}</p>}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-[16px] font-bold text-gray-900">识别结果</h3>
                      <p className="text-[12px] text-gray-500">勾选要进入错题库的题目，可先修改字段。</p>
                    </div>
                    {drafts.length ? (
                      <div className="flex gap-2">
                        <button className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-bold text-gray-600 hover:bg-gray-100" type="button" onClick={() => selectAllDrafts(true)}>全选</button>
                        <button className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-bold text-gray-600 hover:bg-gray-100" type="button" onClick={() => selectAllDrafts(false)}>全不选</button>
                      </div>
                    ) : null}
                  </div>

                  <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
                    {drafts.map((draft, index) => (
                      <MistakeDraftCard
                        key={index}
                        draft={draft}
                        index={index}
                        paperDataUrl={paperDataUrl}
                        cropBusy={cropBusyIndex === index}
                        onChange={(patch: Partial<MistakeDraft>) => updateDraft(index, patch)}
                        onGenerateCrop={(region: ImageRegion) => generateDraftCrop(index, region)}
                      />
                    ))}
                    {!drafts.length && (
                      <div className="grid min-h-[260px] place-items-center rounded-xl border border-dashed border-gray-200 bg-white p-6 text-center text-[14px] text-gray-500">
                        {recognizedOutput || '上传试卷后，这里会显示 AI 识别到的错题。'}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
                    <span className="text-[13px] font-medium text-gray-500">已选择 {drafts.filter((draft) => draft.include !== false).length} / {drafts.length} 道</span>
                    <div className="flex gap-3">
                      {uploadStage === 'saved' && <button className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13px] font-bold text-gray-700 hover:bg-gray-100" type="button" onClick={resetUploadState}>继续上传</button>}
                      <button className="rounded-xl bg-emerald-500 px-5 py-2.5 text-[13px] font-bold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60" type="button" disabled={!drafts.length || uploadStage === 'uploading' || uploadStage === 'saving' || uploadStage === 'saved'} onClick={confirmDrafts}>
                        {uploadStage === 'saving' ? '入库中...' : '确认入库'}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function PaperSupplementEditor({ draft, items, onDraftChange, onAdd, onRemove }: any) {
  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div>
        <h3 className="text-[13px] font-bold text-gray-800">补充说明</h3>
        <p className="mt-1 text-[11px] font-semibold text-red-500">按题目逐条添加；填写题号后，本次只识别这些指定题目。</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-[12px] font-bold text-gray-500">
          第几大题
          <select className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-800 outline-none focus:border-blue-500" value={draft.majorNumber} onChange={(event) => onDraftChange({ majorNumber: event.target.value })}>
            {PAPER_MAJOR_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] font-bold text-gray-500">
          第几小题
          <input className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-800 outline-none focus:border-blue-500" value={draft.minorNumber} onChange={(event) => onDraftChange({ minorNumber: event.target.value })} placeholder="例如：3、4(2)、第5小题" />
        </label>
        <label className="grid gap-1 text-[12px] font-bold text-gray-500">
          页码
          <input className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-800 outline-none focus:border-blue-500" value={draft.pageNumber} onChange={(event) => onDraftChange({ pageNumber: event.target.value })} placeholder="例如：第2页、P3" />
        </label>
        <label className="grid gap-1 text-[12px] font-bold text-gray-500">
          老师批改符号
          <select className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-800 outline-none focus:border-blue-500" value={draft.teacherMark} onChange={(event) => onDraftChange({ teacherMark: event.target.value })}>
            {PAPER_MARK_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] font-bold text-gray-500">
          是否有图片
          <select className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-800 outline-none focus:border-blue-500" value={draft.imagePresence} onChange={(event) => onDraftChange({ imagePresence: event.target.value })}>
            {PAPER_IMAGE_PRESENCE_OPTIONS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] font-bold text-gray-500">
          图片复杂度
          <select className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-800 outline-none focus:border-blue-500" value={draft.imageComplexity} onChange={(event) => onDraftChange({ imageComplexity: event.target.value })}>
            {PAPER_IMAGE_COMPLEXITY_OPTIONS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] font-bold text-gray-500 sm:col-span-2">
          备注
          <textarea className="min-h-16 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-800 outline-none focus:border-blue-500" value={draft.note} onChange={(event) => onDraftChange({ note: event.target.value })} placeholder="例如：老师画圈的是错题，图中角标看不清，答案在右侧空白处。" />
        </label>
      </div>
      <div className="flex justify-end">
        <button className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-gray-800" type="button" onClick={onAdd}>
          <Plus className="h-4 w-4" /> 添加一条
        </button>
      </div>
      {items.length ? (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          {items.map((item: PaperSupplementItem, index: number) => (
            <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/40 px-3 py-2">
              <p className="text-[12px] leading-relaxed text-blue-900">{formatPaperSupplementItem(item, index)}</p>
              <button className="rounded-lg p-1.5 text-blue-700 hover:bg-blue-100" type="button" onClick={() => onRemove(item.id)} title="删除这条补充说明" aria-label="删除这条补充说明">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-gray-50 px-3 py-2 text-[12px] text-gray-400">不添加也可以直接识别图片；如图片较复杂，建议先按题号补充。</p>
      )}
    </section>
  );
}

function MistakeDraftCard({ draft, index, paperDataUrl, cropBusy, onChange, onGenerateCrop }: any) {
  const region = normalizeRegion(draft.imageRegion || defaultImageRegion(index));
  const cropUrl = draft.sourceAttachment?.crop?.url || draft.sourceAttachment?.url || '';
  const updateRegion = (patch: Partial<ImageRegion>) => onChange({ imageRegion: normalizeRegion({ ...region, ...patch }) });

  return (
    <article className={`rounded-xl border bg-white p-4 shadow-sm ${draft.include === false ? 'border-gray-200 opacity-70' : 'border-blue-200'}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[13px] font-bold text-gray-800">
          <input className="h-4 w-4 accent-blue-600" type="checkbox" checked={draft.include !== false} onChange={(event) => onChange({ include: event.target.checked })} />
          入库错题 {index + 1}
        </label>
        <input className="w-28 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-[12px] outline-none focus:border-blue-500" value={draft.questionNumber || ''} onChange={(event) => onChange({ questionNumber: event.target.value })} placeholder="题号" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-[12px] font-bold text-gray-500 sm:col-span-2">
          题干
          <textarea className="min-h-20 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-800 outline-none focus:border-blue-500" value={draft.question || ''} onChange={(event) => onChange({ question: event.target.value })} />
        </label>
        <label className="grid gap-1 text-[12px] font-bold text-gray-500 sm:col-span-2">
          选项
          <textarea className="min-h-16 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-800 outline-none focus:border-blue-500" value={(draft.options || []).join('\n')} onChange={(event) => onChange({ options: splitLines(event.target.value) })} placeholder="每行一个选项" />
        </label>
        <Field label="学生答案" value={draft.studentAnswer || ''} onChange={(value: string) => onChange({ studentAnswer: value })} />
        <Field label="正确答案" value={draft.correctAnswer || ''} onChange={(value: string) => onChange({ correctAnswer: value })} />
        <Field label="题型" value={draft.questionType || ''} onChange={(value: string) => onChange({ questionType: value })} />
        <label className="grid gap-1 text-[12px] font-bold text-gray-500">
          难度
          <select className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-800 outline-none focus:border-blue-500" value={draft.difficulty || '中等'} onChange={(event) => onChange({ difficulty: event.target.value })}>
            {['简单', '中等', '困难'].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <Field className="sm:col-span-2" label="知识点" value={joinTags(draft.knowledgePoints)} onChange={(value: string) => onChange({ knowledgePoints: splitTags(value) })} placeholder="用逗号、顿号或换行分隔" />
        <Field className="sm:col-span-2" label="错因" value={joinTags(draft.wrongReasons)} onChange={(value: string) => onChange({ wrongReasons: splitTags(value) })} placeholder="审题错误、计算错误" />
        <div className="grid gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3 text-[12px] text-gray-600 sm:col-span-2 sm:grid-cols-4">
          <span><b className="text-gray-800">图像复杂度：</b>{visualComplexityLabel(draft.visualComplexity)}</span>
          <span><b className="text-gray-800">出图策略：</b>{renderStrategyLabel(draft.visualRenderStrategy)}</span>
          <span><b className="text-gray-800">模板：</b>{draft.supportedTemplate || 'none'}</span>
          <span><b className="text-gray-800">需截图：</b>{draft.needsCrop ? '是' : '否'}</span>
        </div>
        <Field className="sm:col-span-2" label="题图说明" value={draft.visualDescription || ''} onChange={(value: string) => onChange({ visualDescription: value })} placeholder="例如：三个三角板拼出的角度图、钟面 5 时整、红红蓝绿气球序列" />
        <Field className="sm:col-span-2" label="图形标记" value={draft.visualMarker || ''} onChange={(value: string) => onChange({ visualMarker: value })} placeholder="[图:clock hour=5 minute=0 angle=150]" />
        {paperDataUrl ? (
          <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[12px] font-bold text-blue-700">数学单题截图</p>
                <p className="text-[11px] text-blue-600/80">调整百分比区域后生成截图，后续出题会优先使用这张单题图。</p>
              </div>
              <button
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                disabled={cropBusy}
                onClick={() => onGenerateCrop(region)}
              >
                {cropBusy ? '生成中...' : cropUrl ? '重新生成截图' : '生成单题截图'}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <RegionInput label="左" value={region.x} onChange={(value: number) => updateRegion({ x: value })} />
              <RegionInput label="上" value={region.y} onChange={(value: number) => updateRegion({ y: value })} />
              <RegionInput label="宽" value={region.width} onChange={(value: number) => updateRegion({ width: value })} />
              <RegionInput label="高" value={region.height} onChange={(value: number) => updateRegion({ height: value })} />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="overflow-hidden rounded-lg border border-blue-100 bg-white">
                <div className="relative">
                  <img className="max-h-48 w-full object-contain" src={paperDataUrl} alt="原始试卷预览" />
                  <div
                    className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/10"
                    style={{
                      left: `${region.x * 100}%`,
                      top: `${region.y * 100}%`,
                      width: `${region.width * 100}%`,
                      height: `${region.height * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="grid min-h-28 place-items-center overflow-hidden rounded-lg border border-blue-100 bg-white p-2 text-center text-[12px] text-gray-500">
                {cropUrl ? <img className="max-h-44 w-full object-contain" src={cropUrl} alt="单题截图" /> : '生成后这里展示单题截图'}
              </div>
            </div>
          </div>
        ) : null}
        <label className="grid gap-1 text-[12px] font-bold text-gray-500 sm:col-span-2">
          解析
          <textarea className="min-h-20 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-800 outline-none focus:border-blue-500" value={draft.analysis || ''} onChange={(event) => onChange({ analysis: event.target.value })} />
        </label>
      </div>
    </article>
  );
}

function Field({ label, value, onChange, placeholder = '', className = '' }: any) {
  return (
    <label className={`grid gap-1 text-[12px] font-bold text-gray-500 ${className}`}>
      {label}
      <input className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-800 outline-none focus:border-blue-500" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function RegionInput({ label, value, onChange }: any) {
  return (
    <label className="grid gap-1 text-[11px] font-bold text-blue-700">
      {label}（%）
      <input
        className="rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-[12px] text-gray-800 outline-none focus:border-blue-500"
        type="number"
        min={0}
        max={100}
        value={Math.round(Number(value || 0) * 100)}
        onChange={(event) => onChange(Number(event.target.value || 0) / 100)}
      />
    </label>
  );
}

function StatCard({ label, value, icon, tone = 'gray' }: any) {
  const color = tone === 'blue' ? 'text-blue-600 bg-blue-100' : tone === 'orange' ? 'text-orange-500 bg-orange-100' : tone === 'green' ? 'text-emerald-600 bg-emerald-100' : 'text-gray-500 bg-gray-100';
  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-200 flex flex-col justify-between shadow-sm">
      <div className="flex justify-between items-start mb-2">
        <span className="text-[13px] font-medium text-gray-500">{label}</span>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${color}`}>{icon}</div>
      </div>
      <div className="text-[32px] font-bold text-gray-900">{value}</div>
    </div>
  );
}

function DetailBlock({ title, children }: any) {
  return (
    <div className="space-y-4">
      <h3 className="font-bold text-gray-900 flex items-center gap-2 text-[15px]">
        <div className="w-1 h-3.5 bg-blue-500 rounded-full"></div> {title}
      </h3>
      <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 text-[15px] text-gray-800 leading-relaxed whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function OriginalQuestionBlock({ mistake }: { mistake: Mistake }) {
  const imageUrl = mistake.sourceAttachment?.enhanced?.url || mistake.sourceAttachment?.crop?.enhanced?.url || mistake.sourceAttachment?.url;
  const originalUrl = mistake.sourceAttachment?.original?.url;
  const isCrop = mistake.sourceAttachment?.kind === 'mistake_crop';
  return (
    <div className="space-y-4">
      <h3 className="font-bold text-gray-900 flex items-center gap-2 text-[15px]">
        <div className="w-1 h-3.5 bg-blue-500 rounded-full"></div> 原题展示
      </h3>
      <div className="space-y-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
        {imageUrl ? (
          <figure className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <img className="max-h-[420px] w-full object-contain" src={imageUrl} alt={mistake.sourceAttachment?.name || '原始试卷图片'} />
            {isCrop ? (
              <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-[12px] text-gray-500">
                <span>{mistake.sourceAttachment?.enhanced?.url || mistake.sourceAttachment?.crop?.enhanced?.url ? '已展示白底增强题图，出题和 PDF 会优先使用。' : '已优先展示单题截图，适合后续生成数学同类题。'}</span>
                {originalUrl && originalUrl !== imageUrl ? <a className="font-bold text-blue-600 hover:text-blue-700" href={originalUrl} target="_blank" rel="noreferrer">查看整张原图</a> : null}
              </figcaption>
            ) : null}
          </figure>
        ) : null}
        <div className="rounded-xl border border-gray-100 bg-white p-4 text-[15px] leading-relaxed text-gray-800 whitespace-pre-wrap">
          {compact(mistake.question, imageUrl ? '题干见上方试卷图片' : '见上传图片', 500)}
        </div>
        {(mistake.visualDescription || mistake.visualMarker) ? (
          <div className="rounded-xl border border-blue-100 bg-white p-4">
            <p className="mb-2 text-[13px] font-bold text-blue-700">题图识别</p>
            <p className="mb-2 text-[12px] text-blue-700/80">
              {visualComplexityLabel(mistake.visualComplexity)} · {renderStrategyLabel(mistake.visualRenderStrategy)} · 模板 {mistake.supportedTemplate || 'none'}
            </p>
            {mistake.visualDescription ? <p className="mb-3 text-[14px] leading-relaxed text-gray-700">{mistake.visualDescription}</p> : null}
            {mistake.visualMarker ? <PaperContent content={mistake.visualMarker} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AnswerBox({ icon, title, text, tone }: any) {
  const styles = tone === 'red' ? 'bg-red-50/50 border-red-100' : 'bg-emerald-50/30 border-emerald-100';
  return (
    <div className="space-y-3">
      <h4 className="text-[14px] font-bold text-gray-700 flex items-center gap-2">{icon} {title}</h4>
      <div className={`p-5 rounded-xl min-h-[120px] text-[14px] text-gray-800 leading-loose whitespace-pre-wrap border ${styles}`}>{text}</div>
    </div>
  );
}

const PAPER_MAJOR_OPTIONS = [
  { value: '', label: '选择大题' },
  ...Array.from({ length: 12 }, (_, index) => {
    const value = `第${index + 1}大题`;
    return { value, label: value };
  }),
  { value: '选择题', label: '选择题区域' },
  { value: '填空题', label: '填空题区域' },
  { value: '计算题', label: '计算题区域' },
  { value: '应用题', label: '应用题区域' },
  { value: '压轴题', label: '压轴题区域' },
];
const PAPER_MARK_OPTIONS = [
  { value: '', label: '选择批改符号' },
  { value: '打叉', label: '打叉' },
  { value: '半对', label: '半对' },
  { value: '画圈', label: '画圈' },
  { value: '扣分', label: '扣分' },
  { value: '老师标注订正', label: '老师标注订正' },
  { value: '其他符号', label: '其他符号' },
];
const PAPER_IMAGE_PRESENCE_OPTIONS = ['未说明', '无图片', '有图片', '看不清', '需要裁剪确认'];
const PAPER_IMAGE_COMPLEXITY_OPTIONS = ['未说明', '无图', '简单图', '复杂图', '公式/几何标注多', '图片模糊'];

function createEmptyPaperSupplementDraft(): PaperSupplementDraft {
  return {
    majorNumber: '',
    minorNumber: '',
    pageNumber: '',
    teacherMark: '',
    imagePresence: '未说明',
    imageComplexity: '未说明',
    note: '',
  };
}

function normalizePaperSupplementDraft(draft: PaperSupplementDraft): PaperSupplementDraft {
  return {
    majorNumber: draft.majorNumber.trim(),
    minorNumber: draft.minorNumber.trim(),
    pageNumber: draft.pageNumber.trim(),
    teacherMark: draft.teacherMark.trim(),
    imagePresence: draft.imagePresence.trim() || '未说明',
    imageComplexity: draft.imageComplexity.trim() || '未说明',
    note: draft.note.trim(),
  };
}

function hasPaperSupplementContent(item: PaperSupplementDraft) {
  return Boolean(
    item.majorNumber ||
    item.minorNumber ||
    item.pageNumber ||
    item.teacherMark ||
    item.note ||
    item.imagePresence !== '未说明' ||
    item.imageComplexity !== '未说明'
  );
}

function formatPaperSupplementItem(item: PaperSupplementItem, index: number) {
  const parts = [
    `第${index + 1}条`,
    `大题：${item.majorNumber || '未说明'}`,
    `小题：${item.minorNumber || '未说明'}`,
    `页码：${item.pageNumber || '未说明'}`,
    `批改符号：${item.teacherMark || '未说明'}`,
    `图片：${item.imagePresence || '未说明'}`,
    `图片复杂度：${item.imageComplexity || '未说明'}`,
  ];
  if (item.note) parts.push(`备注：${item.note}`);
  return parts.join('；');
}

function buildPaperSupplementText(items: PaperSupplementItem[]) {
  if (!items.length) return '';
  const text = items.map(formatPaperSupplementItem).join('\n');
  return hasExplicitPaperSupplementScope(items)
    ? `本次只识别以下补充说明指定的题目，不要识别图片中的其他错题。每一条内部字段按交集理解，必须同时满足该条的大题、小题、页码、批改符号和图片条件；多条之间才是多个指定题目范围：\n${text}`
    : text;
}

function hasExplicitPaperSupplementScope(items: PaperSupplementItem[]) {
  return items.some((item) => Boolean(item.majorNumber || item.minorNumber));
}

async function fileToDataUrl(file: File) {
  try {
    const buffer = await file.arrayBuffer();
    return arrayBufferToDataUrl(buffer, file.type);
  } catch {
    try {
      return await fileToDataUrlWithReader(file);
    } catch {
      throw new Error('图片读取失败，请重新选择图片后再试。');
    }
  }
}

function arrayBufferToDataUrl(buffer: ArrayBuffer, type?: string) {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return `data:${type || 'application/octet-stream'};base64,${window.btoa(chunks.join(''))}`;
}

function fileToDataUrlWithReader(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function postJsonWithSignal(path: string, body: Record<string, any>, signal: AbortSignal) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }).then(readJson);
}

function cropImageDataUrl(dataUrl: string, region: ImageRegion) {
  const normalized = normalizeRegion(region);
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      const sx = Math.floor(normalized.x * sourceWidth);
      const sy = Math.floor(normalized.y * sourceHeight);
      const sw = Math.max(1, Math.floor(normalized.width * sourceWidth));
      const sh = Math.max(1, Math.floor(normalized.height * sourceHeight));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('浏览器无法生成截图'));
        return;
      }
      context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('试卷图片解码失败，请重新选择图片'));
    image.src = dataUrl;
  });
}

function estimateDataUrlSize(dataUrl = '') {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.floor(base64.length * 0.75);
}

function isAbortError(error: any) {
  return error?.name === 'AbortError';
}

function normalizeDrafts(items: MistakeDraft[]) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    ...item,
    questionNumber: item.questionNumber || `错题 ${index + 1}`,
    difficulty: item.difficulty || '中等',
    imageRegion: normalizeRegion(item.imageRegion || defaultImageRegion(index)),
    tags: item.tags?.length ? item.tags : ['试卷错题'],
    include: true,
  }));
}

function defaultImageRegion(index: number): ImageRegion {
  return normalizeRegion({
    x: 0.05,
    y: Math.min(0.78, 0.08 + index * 0.16),
    width: 0.9,
    height: 0.14,
    unit: 'ratio',
  });
}

function normalizeRegion(region?: Partial<ImageRegion> | null): ImageRegion {
  const x = clampRatio(Number(region?.x ?? 0.05), 0.98);
  const y = clampRatio(Number(region?.y ?? 0.08), 0.98);
  const width = Math.max(0.02, Math.min(1 - x, Number(region?.width ?? 0.9)));
  const height = Math.max(0.02, Math.min(1 - y, Number(region?.height ?? 0.14)));
  return {
    x: roundRatio(x),
    y: roundRatio(y),
    width: roundRatio(width),
    height: roundRatio(height),
    unit: 'ratio',
  };
}

function clampRatio(value: number, max = 1) {
  return Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
}

function roundRatio(value: number) {
  return Number(value.toFixed(4));
}

function extractDraftsFromOutput(output = '') {
  const payload = extractJsonPayload(output);
  return Array.isArray(payload?.mistakes) ? payload.mistakes : [];
}

function extractJsonPayload(text = '') {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || raw;
  const candidates = [candidate];
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(candidate.slice(start, end + 1));

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

function repairJsonStringLiterals(value = '') {
  let output = '';
  let inString = false;
  let escaped = false;
  for (const char of String(value || '')) {
    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      output += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      output += char;
      inString = false;
      continue;
    }
    if (char === '\n') output += '\\n';
    else if (char === '\r') output += '\\r';
    else if (char === '\t') output += '\\t';
    else output += char;
  }
  return output;
}

function splitTags(value = '') {
  return String(value)
    .split(/[\n,，、;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLines(value = '') {
  return String(value)
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinTags(value?: string[]) {
  return (Array.isArray(value) ? value : []).join('、');
}

function visualComplexityLabel(value = '') {
  return ({
    none: '纯文字',
    simple_template: '简单模板图',
    complex_image: '复杂截图题',
  } as Record<string, string>)[String(value || '')] || '待判断';
}

function renderStrategyLabel(value = '') {
  return ({
    none: '不插图',
    template: '程序绘图',
    source_crop: '使用单题截图',
  } as Record<string, string>)[String(value || '')] || '待判断';
}
