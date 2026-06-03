import { FolderOpen, Zap, FileText, BarChart2, Search, Download, RefreshCcw } from 'lucide-react';
import { Generation, Mistake, MistakeStats, compact, formatDate } from '@/src/lib/api';

export default function ResourceDownload({ generations = [], mistakes = [], stats }: any) {
  const generationList = generations as Generation[];
  const mistakeList = mistakes as Mistake[];
  const stat = stats as MistakeStats;
  const resources = [
    ...generationList.map((item) => ({
      id: item.id,
      type: item.toolSlug === 'mistake' ? '错题清单' : item.toolSlug === 'essay' ? '作文批改' : '报告大纲',
      subject: item.input?.subject || item.input?.grade || '综合',
      title: item.input?.paperName || item.input?.topic || `${item.childName || '学生'}的 AI 生成记录`,
      desc: compact(item.output, '生成内容已保存，可在历史记录中继续查看。', 90),
      time: formatDate(item.createdAt),
      action: '查看',
    })),
    ...mistakeList.slice(0, 6).map((item) => ({
      id: item.id,
      type: '错题资料',
      subject: item.subject || '综合',
      title: compact(item.question, '错题清单', 32),
      desc: compact(item.analysis, '包含题目、答案、解析和知识点。', 90),
      time: formatDate(item.createdAt),
      action: '同步',
    })),
  ];

  return (
    <div className="pb-10 min-h-full">
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between border-b border-gray-200 pb-6 gap-4">
        <div>
          <h1 className="text-[28px] lg:text-[32px] font-bold text-gray-900 mb-2 leading-tight">资料中心</h1>
          <p className="text-[14px] lg:text-[15px] text-gray-500 leading-relaxed">这里汇总现有生成记录和错题资料，练习卷 PDF 会在生成后直接提供下载。</p>
        </div>
        <div className="hidden md:flex gap-3">
          <button className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 rounded-xl text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm">
            <RefreshCcw className="w-4 h-4 text-gray-400" />
            已同步
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
        <Overview label="可下载资源总数" value={resources.length} icon={<FolderOpen className="w-4 h-4" />} />
        <Overview label="最近生成资料" value={generationList.length} icon={<Zap className="w-4 h-4 fill-current" />} active />
        <Overview label="错题资料数量" value={stat?.total || mistakeList.length} icon={<FileText className="w-4 h-4" />} />
        <Overview label="知识点数量" value={stat?.knowledgePointCount || 0} icon={<BarChart2 className="w-4 h-4" />} />
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5 lg:p-6 shadow-sm mb-6">
        <div className="relative w-full md:w-80 shrink-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[13px] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-medium" placeholder="搜索资源名称..." type="text" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {resources.map((item) => (
          <div key={`${item.type}-${item.id}`} className="bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition-shadow p-6 flex flex-col group">
            <div className="flex justify-between items-start mb-5">
              <div className="flex items-center gap-2.5">
                <span className="px-2.5 py-1 bg-blue-50 text-blue-700 font-bold text-[11px] rounded flex items-center gap-1">{item.type}</span>
                <span className="px-2.5 py-1 bg-gray-100 text-gray-600 font-bold text-[11px] rounded">{item.subject}</span>
              </div>
            </div>
            <h3 className="font-bold text-gray-900 text-[18px] mb-2 leading-snug">{item.title}</h3>
            <p className="text-[13px] text-gray-500 mb-6 line-clamp-2 leading-relaxed">{item.desc}</p>
            <div className="mt-auto pt-5 border-t border-gray-100 flex items-center justify-between">
              <span className="text-[11px] font-medium text-gray-400">生成于 {item.time}</span>
              <button className="px-4 py-2 bg-blue-600 text-white rounded-full text-[13px] font-bold hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-1.5">
                <Download className="w-4 h-4" /> {item.action}
              </button>
            </div>
          </div>
        ))}
        {!resources.length && <div className="text-gray-500">暂无资料。生成一次练习卷或错题解析后会展示在这里。</div>}
      </div>
    </div>
  );
}

function Overview({ label, value, icon, active }: any) {
  return (
    <div className={`bg-white border ${active ? 'border-blue-100' : 'border-gray-200'} rounded-2xl p-5 shadow-sm relative overflow-hidden flex flex-col justify-between h-36`}>
      <div className="flex items-center justify-between">
        <span className={`text-[13px] font-medium ${active ? 'text-blue-600 font-bold' : 'text-gray-500'}`}>{label}</span>
        <div className={`${active ? 'bg-blue-50 text-blue-500' : 'bg-gray-50 text-gray-400'} p-2 rounded-lg`}>{icon}</div>
      </div>
      <div className={`text-[36px] font-bold ${active ? 'text-blue-600' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}
