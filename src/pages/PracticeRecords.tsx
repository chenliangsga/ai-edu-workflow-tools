import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Download, FileText, Search, Trash2, Upload } from 'lucide-react';
import { ExamPaper, apiDelete, apiGet, apiJson, compact, formatDate, uploadImageFiles } from '@/src/lib/api';
import PaperContent from '@/src/components/PaperContent';

export default function PracticeRecords({ examPapers = [], activeChildId, refreshData }: any) {
  const paperList = examPapers as ExamPaper[];
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<ExamPaper | null>(null);
  const [answerResults, setAnswerResults] = useState<Record<number, boolean>>({});
  const [answerSheetFileIds, setAnswerSheetFileIds] = useState<string[]>([]);
  const [answerSheetUploading, setAnswerSheetUploading] = useState(false);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [deletedIds, setDeletedIds] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const key = keyword.trim();
    const visiblePapers = paperList.filter((item) => !deletedIds.includes(item.id));
    if (!key) return visiblePapers;
    return visiblePapers.filter((item) => [
      item.title,
      ...(item.targetKnowledgePoints || []),
      ...(item.weakKnowledgePoints || []),
    ].join('\n').includes(key));
  }, [deletedIds, keyword, paperList]);

  const selected = filtered.find((item) => item.id === selectedId) || filtered[0];

  useEffect(() => {
    if (!selected?.id) {
      setDetail(null);
      return;
    }

    setLoading(true);
    apiGet(`/api/v1/exam-papers/${selected.id}`)
      .then((data) => {
        setDetail(data.paper || null);
        setAnswerResults(Object.fromEntries((data.paper?.questions || []).map((question: any) => [question.number, true])));
        setAnswerSheetFileIds([]);
        setStatus('');
      })
      .catch((error) => setStatus(error.message || '练习卷读取失败'))
      .finally(() => setLoading(false));
  }, [selected?.id]);

  async function submitAttempt() {
    if (!detail?.id) return;
    setStatus('正在更新知识点掌握度');
    try {
      const answers = (detail.questions || []).map((question) => ({
        questionId: question.id,
        number: question.number,
        isCorrect: answerResults[question.number] !== false,
        knowledgePoints: question.knowledgePoints || [],
      }));
      const data = await apiJson(`/api/v1/exam-papers/${detail.id}/attempts`, {
        answers,
        answerSheetFileIds,
        note: '练习记录页回写',
      });
      setStatus(`已回写 ${data.attempt?.total || 0} 题，正确 ${data.attempt?.correct || 0} 题`);
      await refreshData?.(activeChildId);
    } catch (error: any) {
      setStatus(error.message || '掌握度更新失败');
    }
  }

  async function uploadAnswerSheets(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files || []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) {
      setStatus('请选择答卷图片');
      input.value = '';
      return;
    }

    setAnswerSheetUploading(true);
    setStatus(`正在上传 ${files.length} 张答卷图片`);
    try {
      const uploaded = await uploadImageFiles(files);
      const fileIds = uploaded.map((item) => item.fileId).filter(Boolean);
      setAnswerSheetFileIds(fileIds);
      setStatus(`已上传 ${fileIds.length} 张答卷图片，自动批改接口接入后会在这里识别对错`);
    } catch (error: any) {
      setStatus(error.message || '答卷图片上传失败');
    } finally {
      setAnswerSheetUploading(false);
      input.value = '';
    }
  }

  async function deletePaper(paper: ExamPaper) {
    if (!paper?.id || deletingId) return;
    const title = paper.title || '错题巩固卷';
    if (!window.confirm(`确定删除「${title}」吗？删除后练习记录列表里将不再显示。`)) return;

    setDeletingId(paper.id);
    setStatus('正在删除练习记录');
    try {
      await apiDelete(`/api/v1/exam-papers/${paper.id}`);
      setDeletedIds((ids) => ids.includes(paper.id) ? ids : [...ids, paper.id]);
      if (selectedId === paper.id || detail?.id === paper.id) {
        setSelectedId('');
        setDetail(null);
      }
      setStatus('练习记录已删除');
      await refreshData?.(activeChildId);
    } catch (error: any) {
      setStatus(error.message || '练习记录删除失败');
    } finally {
      setDeletingId('');
    }
  }

  return (
    <div className="pb-10 min-h-full">
      <header className="mb-6 lg:mb-8">
        <h1 className="text-[28px] lg:text-[32px] font-bold text-gray-900 leading-tight">练习记录</h1>
        <p className="mt-2 text-[14px] text-gray-500">保存已生成的复习卷，后续可回来下载 PDF、查看详情，并上传或标记作答结果。</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-4 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-4 text-[13px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="搜索知识点或卷名..."
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>
          </div>

          <div className="max-h-[720px] overflow-y-auto p-3 space-y-2.5">
            {filtered.map((item) => (
              <div
                key={item.id}
                className={`group rounded-xl border transition-colors ${selected?.id === item.id ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-white hover:bg-gray-50'}`}
              >
                <button
                  className="w-full p-4 text-left"
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <h3 className="min-w-0 flex-1 text-[14px] font-bold leading-snug text-gray-900">{item.title || '错题巩固卷'}</h3>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">{(item.questions || []).length || 0}题</span>
                  </div>
                  <p className="text-[12px] leading-relaxed text-gray-500">{compact((item.targetKnowledgePoints || []).join('、'), '综合知识点', 42)}</p>
                </button>
                <div className="flex items-center justify-between gap-3 px-4 pb-4">
                  <p className="text-[11px] font-medium text-gray-400">{formatDate(item.createdAt)}</p>
                  <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 opacity-100 transition-colors hover:bg-red-50 hover:text-red-600 lg:opacity-0 lg:group-hover:opacity-100"
                    type="button"
                    title="删除练习记录"
                    aria-label="删除练习记录"
                    disabled={deletingId === item.id}
                    onClick={() => deletePaper(item)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            {!filtered.length && <p className="rounded-xl bg-gray-50 p-4 text-[13px] text-gray-500">暂无练习记录。生成复习卷后会保存在这里。</p>}
          </div>
        </section>

        <section className="lg:col-span-8 bg-white rounded-2xl border border-gray-200 shadow-sm min-h-[780px] p-6 lg:p-8">
          {detail ? (
            <div className="space-y-5">
              <div className="grid gap-4 border-b border-gray-100 pb-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                <div className="min-w-0">
                  <h2 className="text-[22px] font-bold text-gray-900">{detail.title || '错题巩固卷'}</h2>
                  <p className="mt-2 text-[13px] text-gray-500">
                    复习目标 {(detail.targetKnowledgePoints || []).join('、') || '综合知识点'} · 来源错题 {detail.sourceMistakeIds?.length || 0} 道
                  </p>
                </div>
                <div className="grid shrink-0 grid-cols-2 items-center justify-end gap-2 md:justify-self-end">
                  {detail.pdfUrl ? (
                    <a className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-blue-600 px-4 text-[14px] font-bold text-white shadow-sm hover:bg-blue-700" href={`/api/v1/exam-papers/${detail.id}/pdf`} target="_blank" rel="noreferrer">
                      <Download className="h-4 w-4" /> 下载 PDF
                    </a>
                  ) : (
                    <button className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-gray-100 px-4 text-[14px] font-bold text-gray-400" type="button">
                      <Download className="h-4 w-4" /> PDF 未生成
                    </button>
                  )}
                  <button
                    className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-red-100 bg-white px-4 text-[14px] font-bold text-red-600 shadow-sm hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
                    type="button"
                    disabled={deletingId === detail.id}
                    onClick={() => deletePaper(detail)}
                  >
                    <Trash2 className="h-4 w-4" /> 删除
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-xl bg-white p-2 text-blue-600 shadow-sm">
                      <Upload className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-[14px] font-bold text-gray-900">上传答卷并更新掌握度</h3>
                      <p className="mt-1 text-[13px] leading-relaxed text-blue-800">可以隔几天回来下载 PDF、完成作答后上传答卷；当前先支持按题标记对错并回写知识点。</p>
                    </div>
                  </div>
                  <label className={`inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2 text-[13px] font-bold text-blue-600 hover:bg-blue-50 ${answerSheetUploading ? 'cursor-wait opacity-70' : 'cursor-pointer'}`}>
                    <Upload className="h-4 w-4" /> {answerSheetUploading ? '上传中...' : '上传答卷'}
                    <input className="hidden" type="file" accept="image/*" multiple disabled={answerSheetUploading} onChange={uploadAnswerSheets} />
                  </label>
                </div>

                {!!detail.questions?.length && (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {detail.questions.map((question) => (
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
                  <p className="min-h-5 text-[13px] font-medium text-blue-700">{status}</p>
                  <button className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-[14px] font-bold text-white shadow-sm hover:bg-blue-700" type="button" onClick={submitAttempt}>
                    <ClipboardCheck className="h-4 w-4" /> 更新掌握度
                  </button>
                </div>
              </div>

              <PaperContent content={loading ? '正在加载练习卷...' : detail.content || ''} maxHeight="max-h-[720px]" />
            </div>
          ) : (
            <div className="grid h-full min-h-[520px] place-items-center text-center">
              <div>
                <FileText className="mx-auto mb-4 h-10 w-10 text-gray-300" />
                <p className="text-[14px] text-gray-500">选择一份练习记录查看详情。</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
