import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import { Brain, Play, CheckCircle2, Clock, FileCheck, Check, Download, Target, Upload, ClipboardCheck } from 'lucide-react';
import { MasteryItem, Mistake, MistakeStats, apiJson, compact, isDue, uploadImageFiles } from '@/src/lib/api';
import PaperContent from '@/src/components/PaperContent';

export default function SmartPractice({ mistakes = [], stats, mastery = [], weakPoints = [], activeChildId, refreshData }: any) {
  const mistakeList = mistakes as Mistake[];
  const stat = stats as MistakeStats;
  const masteryList = mastery as MasteryItem[];
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState('中等');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [paper, setPaper] = useState<any>(null);
  const [answerResults, setAnswerResults] = useState<Record<number, boolean>>({});
  const [answerSheetFileIds, setAnswerSheetFileIds] = useState<string[]>([]);
  const [answerSheetUploading, setAnswerSheetUploading] = useState(false);
  const [attemptStatus, setAttemptStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const knowledgeTargets = useMemo(() => {
    const byName = new Map<string, { name: string; count: number; accuracy?: number }>();

    for (const item of stat?.knowledgePointTop || []) {
      byName.set(item.name, { name: item.name, count: item.count });
    }
    for (const point of weakPoints as string[]) {
      if (!byName.has(point)) byName.set(point, { name: point, count: 1, accuracy: 0 });
    }
    for (const item of masteryList) {
      const current = byName.get(item.knowledgePoint);
      byName.set(item.knowledgePoint, {
        name: item.knowledgePoint,
        count: current?.count || item.total,
        accuracy: item.accuracy,
      });
    }

    return [...byName.values()]
      .sort((a, b) => (a.accuracy ?? 0.5) - (b.accuracy ?? 0.5) || b.count - a.count)
      .slice(0, 8);
  }, [masteryList, stat?.knowledgePointTop, weakPoints]);

  const baseSource = useMemo(() => {
    if (selectedIds.length) return mistakeList.filter((item) => selectedIds.includes(item.id));
    const defaultPoints = knowledgeTargets.slice(0, 3).map((item) => item.name);
    const matchesPoint = (item: Mistake) => (item.knowledgePoints || []).some((point) =>
      defaultPoints.some((target) => point.includes(target) || target.includes(point))
    );
    const chosen = defaultPoints.length ? mistakeList.filter(matchesPoint) : mistakeList.filter(isDue);
    return chosen.length ? chosen : mistakeList.slice(0, count);
  }, [count, knowledgeTargets, mistakeList, selectedIds]);

  const effectivePoints = useMemo(() => {
    const points = new Map<string, number>();
    for (const item of baseSource) {
      for (const point of item.knowledgePoints || []) {
        points.set(point, (points.get(point) || 0) + 1);
      }
    }
    return [...points.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
      .slice(0, 6);
  }, [baseSource]);

  const source = baseSource;

  async function generate(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await apiJson('/api/v1/exam-papers', {
        childId: activeChildId,
        count,
        difficulty,
        questionType: '同类变式题',
        knowledgePoints: effectivePoints,
        mistakeIds: selectedIds,
      });
      setPaper(data.paper);
      setAnswerResults(Object.fromEntries((data.paper?.questions || []).map((question: any) => [question.number, true])));
      setAnswerSheetFileIds([]);
      setAttemptStatus('');
      await refreshData?.();
    } catch (err: any) {
      setError(err.message || '练习卷生成失败');
    } finally {
      setLoading(false);
    }
  }

  async function submitAttempt() {
    if (!paper?.id) return;
    setAttemptStatus('正在更新知识点掌握度');
    try {
      const answers = (paper.questions || []).map((question: any) => ({
        questionId: question.id,
        number: question.number,
        isCorrect: answerResults[question.number] !== false,
        knowledgePoints: question.knowledgePoints || [],
      }));
      const data = await apiJson(`/api/v1/exam-papers/${paper.id}/attempts`, {
        answers,
        answerSheetFileIds,
        note: '复习卷批改结果回写',
      });
      setAttemptStatus(`已回写 ${data.attempt?.total || 0} 题，正确 ${data.attempt?.correct || 0} 题`);
      await refreshData?.();
    } catch (err: any) {
      setAttemptStatus(err.message || '掌握度更新失败');
    }
  }

  async function uploadAnswerSheets(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files || []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) {
      setAttemptStatus('请选择答卷图片');
      input.value = '';
      return;
    }

    setAnswerSheetUploading(true);
    setAttemptStatus(`正在上传 ${files.length} 张答卷图片`);
    try {
      const uploaded = await uploadImageFiles(files);
      const fileIds = uploaded.map((item) => item.fileId).filter(Boolean);
      setAnswerSheetFileIds(fileIds);
      setAttemptStatus(`已上传 ${fileIds.length} 张答卷图片，自动批改接口接入后会在这里识别对错`);
    } catch (err: any) {
      setAttemptStatus(err.message || '答卷图片上传失败');
    } finally {
      setAnswerSheetUploading(false);
      input.value = '';
    }
  }

  return (
    <div className="pb-10 min-h-full">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="md:col-span-2 bg-white rounded-2xl p-6 lg:p-8 border border-gray-200 shadow-sm relative overflow-hidden flex flex-col justify-between h-[200px]">
          <div className="absolute right-0 top-0 opacity-[0.03] transform translate-x-4 -translate-y-4">
            <Brain className="w-[140px] h-[140px]" />
          </div>
          <div className="relative z-10">
            <h2 className="text-[20px] font-bold text-gray-900 mb-2.5 flex items-center gap-2">
              <span className="text-blue-500"><Brain className="w-5 h-5" /></span>
              知识点复习任务
            </h2>
            <p className="text-[14px] text-gray-500 w-full sm:w-3/4 leading-relaxed">选择错题后自动识别知识点生成复习卷；未选择时优先使用待复习和薄弱错题。</p>
          </div>
          <button className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold w-fit hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2 text-[14px] relative z-10" onClick={() => generate()} disabled={loading}>
            <Play className="w-4 h-4" /> {loading ? '生成中...' : '生成复习卷'}
          </button>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm flex flex-col justify-center items-center text-center h-[200px]">
          <Clock className="text-orange-500 w-8 h-8 mb-4" />
          <div className="text-[40px] font-bold text-gray-900 leading-none mb-2">{stat?.due || 0}</div>
          <div className="text-[13px] text-gray-500 font-medium">待生成练习数量</div>
        </div>
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm flex flex-col justify-center items-center text-center h-[200px]">
          <CheckCircle2 className="text-emerald-500 w-8 h-8 mb-4" />
          <div className="text-[40px] font-bold text-gray-900 leading-none mb-2">{mistakeList.filter((item) => item.masteryStatus === '已掌握').length}</div>
          <div className="text-[13px] text-gray-500 font-medium">已掌握错题</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 lg:p-7">
            <h3 className="text-[18px] font-bold text-gray-900 mb-6 border-b border-gray-100 pb-4">复习生成配置</h3>
            <form className="space-y-6" onSubmit={generate}>
              <div>
                <label className="block text-[14px] font-bold text-gray-800 mb-3">自动识别知识点</label>
                <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="text-[13px] font-bold text-gray-800">{selectedIds.length ? '来自已选错题' : '来自待复习与薄弱错题'}</span>
                    <span className="shrink-0 rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white">{source.length} 道错题</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {effectivePoints.map((point) => (
                      <span key={point} className="rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-[12px] font-bold text-blue-700">{point}</span>
                    ))}
                    {!effectivePoints.length && <span className="text-[13px] text-blue-800">这些错题还没有知识点标签，生成时会按题目内容综合出题。</span>}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[14px] font-bold text-gray-800 mb-3">题量选择</label>
                <div className="flex gap-2">
                  {[5, 10, 15, 20].map((item) => (
                    <button key={item} type="button" className={`flex-1 py-2.5 rounded-xl border text-[14px] font-medium transition-colors ${count === item ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`} onClick={() => setCount(item)}>{item}</button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[14px] font-bold text-gray-800 mb-3">难度设置</label>
                <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)} className="w-full rounded-xl border border-gray-200 py-3 px-4 text-[14px] text-gray-700 bg-gray-50 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none">
                  <option>混合</option>
                  <option>简单</option>
                  <option>中等</option>
                  <option>困难</option>
                </select>
              </div>

              <div>
                <label className="block text-[14px] font-bold text-gray-800 mb-3">错题来源微调</label>
                <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {mistakeList.slice(0, 20).map((item) => (
                    <label key={item.id} className="flex items-start gap-3 cursor-pointer rounded-xl border border-gray-100 p-3 hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))}
                        className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 shrink-0 border-gray-300 mt-1"
                      />
                      <span className="text-[13px] text-gray-700 leading-relaxed">{compact(item.question, '见上传图片', 54)}</span>
                    </label>
                  ))}
                  {!mistakeList.length && <p className="text-[13px] text-gray-500">暂无错题可选。</p>}
                </div>
              </div>

              <div className="bg-blue-50 rounded-xl p-4 flex items-start gap-3 mt-6 border border-blue-100">
                <Target className="text-blue-500 w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-[13px] text-blue-800 leading-relaxed font-medium">将围绕 {effectivePoints.length ? effectivePoints.join('、') : '待复习错题'} 出题，使用 {selectedIds.length || source.length} 道错题作为依据。</p>
              </div>

              {error && <p className="text-[13px] text-red-600">{error}</p>}
              <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-sm flex justify-center items-center gap-2 mt-2">
                <FileCheck className="w-5 h-5" /> {loading ? '生成中...' : '生成练习卷'}
              </button>
            </form>
          </div>
        </div>

        <div className="lg:col-span-8">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 lg:p-8 min-h-[800px] flex flex-col h-full">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pb-5 border-b border-gray-100">
              <div>
                <h3 className="text-[20px] font-bold text-gray-900 mb-1.5">{paper?.title || '智能练习卷预览'}</h3>
                <p className="text-[13px] text-gray-500">{paper ? `复习目标 ${paper.targetKnowledgePoints?.join('、') || effectivePoints.join('、') || '错题知识点'} · 来源错题 ${paper.sourceMistakeIds?.length || 0} 道` : `将生成 ${count} 题 · 难度 ${difficulty}`}</p>
              </div>
              {paper?.pdfUrl && (
                <a className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-[13px] font-bold hover:bg-blue-700 transition-colors shadow-sm" href={paper.pdfUrl} target="_blank" rel="noreferrer">
                  <Download className="w-4 h-4" /> 下载 PDF
                </a>
              )}
            </div>

            {paper ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-xl bg-white p-2 text-blue-600 shadow-sm">
                        <Upload className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="text-[14px] font-bold text-gray-900">作答卷批改与掌握度回写</h4>
                        <p className="mt-1 text-[13px] leading-relaxed text-blue-800">上传批改识别会接入这里；当前可先按题标记对错，提交后更新知识点掌握度。</p>
                      </div>
                    </div>
                    <label className={`inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2 text-[13px] font-bold text-blue-600 hover:bg-blue-50 ${answerSheetUploading ? 'cursor-wait opacity-70' : 'cursor-pointer'}`}>
                      <Upload className="h-4 w-4" /> {answerSheetUploading ? '上传中...' : '上传作答卷'}
                      <input className="hidden" type="file" accept="image/*" multiple disabled={answerSheetUploading} onChange={uploadAnswerSheets} />
                    </label>
                  </div>

                  {!!paper.questions?.length && (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {paper.questions.map((question: any) => (
                        <button
                          key={question.id || question.number}
                          type="button"
                          className={`rounded-xl border px-3 py-2 text-left transition-colors ${answerResults[question.number] === false ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}
                          onClick={() => setAnswerResults((results) => ({ ...results, [question.number]: results[question.number] === false }))}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-bold">第 {question.number} 题</span>
                            <span className="text-[12px] font-bold">{answerResults[question.number] === false ? '错了' : '做对'}</span>
                          </span>
                          <span className="mt-1 block truncate text-[11px] opacity-80">{question.knowledgePoints?.join('、') || '综合知识点'}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="min-h-5 text-[13px] font-medium text-blue-700">{attemptStatus}</p>
                    <button className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-[14px] font-bold text-white shadow-sm hover:bg-blue-700" type="button" onClick={submitAttempt}>
                      <ClipboardCheck className="h-4 w-4" /> 更新掌握度
                    </button>
                  </div>
                </div>

                <PaperContent content={paper.content || ''} />
              </div>
            ) : (
              <div className="space-y-6 flex-1 overflow-y-auto">
                {source.slice(0, 5).map((item, index) => (
                  <div key={item.id} className="border border-gray-200 rounded-2xl p-5 lg:p-6 hover:border-blue-300 transition-colors bg-gray-50/30">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <span className="bg-gray-200 text-gray-800 font-bold w-7 h-7 rounded-full flex items-center justify-center text-[13px]">{index + 1}</span>
                        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[12px] font-medium">{item.knowledgePoints?.[0] || item.subject || '综合题'}</span>
                      </div>
                      <span className="text-orange-600 text-[12px] font-medium flex items-center gap-1 bg-orange-50 px-2 py-1 rounded">源自错题</span>
                    </div>
                    <div className="text-[15px] text-gray-800 mb-5 leading-relaxed font-medium">{compact(item.question, '见上传图片', 180)}</div>
                    <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                      <h4 className="font-bold text-gray-900 text-[14px] mb-2 flex items-center gap-2">
                        <Brain className="text-blue-500 w-4 h-4" /> AI 解析与关联提示
                      </h4>
                      <p className="text-[13px] text-gray-600 mb-3 leading-relaxed">{compact(item.analysis, '生成后会展示新试卷题目、答案和解析。', 160)}</p>
                      <div className="flex gap-2 flex-wrap">
                        {(item.knowledgePoints || []).slice(0, 2).map((point) => (
                          <span key={point} className="inline-flex items-center gap-1 text-emerald-600 text-[12px] font-medium bg-emerald-50 border border-emerald-100 px-2 py-1 rounded">
                            <Check className="w-3.5 h-3.5" /> {point}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
                {!source.length && <div className="text-gray-500">暂无可出卷的错题。</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
