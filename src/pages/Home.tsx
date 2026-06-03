import { Sparkles, Edit, ListFilter } from 'lucide-react';
import { AreaChart, Area, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { Generation, MasteryItem, Mistake, MistakeStats, compact, formatDate, isDue } from '@/src/lib/api';

export default function Home({ mistakes = [], stats, mastery = [], weakPoints = [], generations = [], setCurrentView }: any) {
  const mistakeList = mistakes as Mistake[];
  const stat = stats as MistakeStats;
  const masteryList = mastery as MasteryItem[];
  const generationList = generations as Generation[];
  const mastered = mistakeList.filter((item) => item.masteryStatus === '已掌握').length;
  const masteryRate = stat?.total ? Math.round((mastered / stat.total) * 100) : 0;
  const pieData = (stat?.wrongReasonTop?.length ? stat.wrongReasonTop : [{ name: '待归类', count: stat?.total || 0 }]).slice(0, 4).map((item, index) => ({
    name: item.name,
    value: item.count,
    color: ['#ef4444', '#f97316', '#2563eb', '#10b981'][index],
  }));
  const trendData = (masteryList.length ? masteryList : [{ accuracy: 0.2 }, { accuracy: 0.4 }, { accuracy: Math.max(masteryRate / 100, 0.5) }]).map((item, index) => ({
    day: String(index + 1),
    value: Math.round((item.accuracy || 0) * 100),
  }));
  const dueMistakes = mistakeList.filter(isDue);
  const selected = dueMistakes[0] || mistakeList[0];

  return (
    <div className="space-y-6 lg:space-y-8 max-w-[1440px] mx-auto w-full pb-10">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <Metric label="今日待复习" value={stat?.due || 0} className="text-blue-600" />
        <Metric label="逾期未复习" value={dueMistakes.length} className="text-red-500" />
        <Metric label="错题总数" value={stat?.total || 0} className="text-gray-900" />
        <Metric label="已掌握数量" value={mastered} className="text-emerald-500" />
      </section>

      <section className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm min-h-[280px]">
          <h3 className="text-[20px] font-bold text-gray-900 mb-6">薄弱知识点 Top 5</h3>
          <div className="space-y-4">
            {(stat?.knowledgePointTop?.length ? stat.knowledgePointTop : weakPoints.map((name: string) => ({ name, count: 1 }))).slice(0, 5).map((item: any) => (
              <div key={item.name}>
                <div className="flex items-start justify-between gap-3 text-[14px] mb-1.5">
                  <span className="min-w-0 flex-1 break-words leading-5 text-gray-700">{item.name}</span>
                  <span className="shrink-0 whitespace-nowrap text-orange-500 font-medium">{item.count}次报错</span>
                </div>
                <div className="w-full overflow-hidden bg-gray-100 rounded-full h-2">
                  <div className="bg-orange-500 h-2 rounded-full" style={{ width: `${Math.min(100, item.count * 20)}%` }} />
                </div>
              </div>
            ))}
            {!stat?.knowledgePointTop?.length && !weakPoints.length && <p className="text-[14px] text-gray-500">暂无知识点统计。</p>}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between h-[280px]">
          <div className="flex flex-col h-full justify-center pl-2">
            <h3 className="text-[20px] font-bold text-gray-900 mb-6">错因分布</h3>
            <ul className="space-y-3">
              {pieData.map((item) => (
                <li key={item.name} className="flex items-center gap-3 text-[14px] text-gray-700">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />
                  {item.name} ({item.value})
                </li>
              ))}
            </ul>
          </div>
          <div className="w-48 h-48 mr-4">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} innerRadius={70} outerRadius={85} paddingAngle={2} dataKey="value" stroke="none">
                  {pieData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid lg:grid-cols-3 gap-6 h-[500px]">
        <div className="bg-white rounded-2xl border border-gray-200 flex flex-col overflow-hidden shadow-sm h-full">
          <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
            <h3 className="text-[18px] font-bold text-gray-900">待复习列表</h3>
            <button className="text-gray-400 hover:text-gray-600 transition-colors" onClick={() => setCurrentView?.('repository')}>
              <ListFilter className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {(dueMistakes.length ? dueMistakes : mistakeList).slice(0, 8).map((item) => (
              <button key={item.id} className="w-full text-left p-4 border border-transparent hover:border-gray-200 rounded-xl cursor-pointer transition-colors bg-white" onClick={() => setCurrentView?.('repository')}>
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[12px] bg-blue-500 text-white px-2.5 py-0.5 rounded font-medium">{item.subject || '学科'}</span>
                  <span className="text-[13px] text-orange-500 font-medium">{item.difficulty || item.masteryStatus || '待复习'}</span>
                </div>
                <p className="text-[14px] text-gray-700 leading-snug line-clamp-2">{compact(item.question, '见上传图片')}</p>
              </button>
            ))}
            {!mistakeList.length && <p className="p-4 text-[14px] text-gray-500">暂无错题。</p>}
          </div>
        </div>

        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 flex flex-col overflow-hidden shadow-sm relative h-full">
          <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
            <div>
              <h3 className="text-[20px] font-bold text-gray-900 mb-1">原题详情</h3>
              <p className="text-[13px] text-gray-500">下次复习：{formatDate(selected?.nextReviewAt)}</p>
            </div>
            <button className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors text-[14px] font-medium cursor-pointer" onClick={() => setCurrentView?.('repository')}>去复习</button>
          </div>
          <div className="p-6 flex-1 overflow-y-auto space-y-6">
            <div>
              <h4 className="text-[13px] text-gray-400 mb-2">题目内容</h4>
              <p className="text-[15px] text-gray-800 leading-relaxed">{compact(selected?.question, '暂无错题数据', 500)}</p>
            </div>
            <div>
              <h4 className="text-[13px] text-gray-400 mb-2">我的答案</h4>
              <div className="p-4 bg-red-50 text-red-800 rounded-xl border border-red-100/50 text-[14px]">{selected?.studentAnswer || '未提供'}</div>
            </div>
            <div className="relative mt-8 pt-6 pb-5 px-5 bg-blue-50/50 border border-blue-100 rounded-xl">
              <div className="absolute -top-3.5 left-5 bg-white px-3 border border-blue-100 text-blue-600 rounded-full py-1 text-[13px] flex items-center gap-1.5 font-medium shadow-sm">
                <Sparkles className="w-3.5 h-3.5 text-blue-500" /> AI 解析
              </div>
              <p className="text-[14px] text-gray-700 leading-relaxed mb-4">{compact(selected?.analysis, '暂无解析', 500)}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white p-6 rounded-2xl border border-gray-200 relative overflow-hidden shadow-sm mt-2">
        <h3 className="text-[20px] font-bold text-gray-900 mb-2">生成今日练习</h3>
        <p className="text-[14px] text-gray-500 mb-6 relative z-10">根据当前错题库中的 {stat?.due || 0} 道待复习题生成同类变式题。</p>
        <button className="bg-blue-600 text-white py-2.5 px-5 rounded-lg text-[14px] hover:bg-blue-700 transition-colors flex justify-center items-center gap-2 font-bold cursor-pointer" onClick={() => setCurrentView?.('practice')}>
          <Edit className="w-4 h-4" /> 生成练习卷
        </button>
      </section>

      <section className="space-y-4 pb-8 mt-2">
        <h3 className="text-[20px] font-bold text-gray-900 mb-4">学习成长趋势</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ChartCard title="掌握度趋势" data={trendData} color="#10b981" type="area" />
          <ChartCard title="待复习压力趋势" data={trendData.map((item) => ({ ...item, value: Math.max(0, 100 - item.value) }))} color="#f97316" type="line" />
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-[18px] font-bold text-gray-900 mb-4">最近生成</h3>
        <div className="grid md:grid-cols-3 gap-4">
          {generationList.slice(0, 3).map((item) => (
            <article key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <span className="text-[12px] font-bold text-blue-600">{item.toolSlug}</span>
              <h4 className="mt-2 font-bold text-gray-900">{compact(item.input?.topic || item.input?.paperName || item.input?.subject, 'AI 生成记录', 28)}</h4>
              <p className="mt-2 text-[13px] text-gray-500">{formatDate(item.createdAt)}</p>
            </article>
          ))}
          {!generationList.length && <p className="text-[14px] text-gray-500">暂无生成记录。</p>}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, className }: any) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-gray-200 flex flex-col gap-1.5 shadow-sm">
      <span className="text-[13px] font-medium text-gray-500 font-bold tracking-wide">{label}</span>
      <span className={`text-[40px] font-bold leading-none mt-1 ${className}`}>{value}</span>
    </div>
  );
}

function ChartCard({ title, data, color, type }: any) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
      <h4 className="text-[15px] font-bold mb-4 text-gray-900">{title}</h4>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {type === 'area' ? (
            <AreaChart data={data}>
              <Tooltip cursor={false} />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={3} fillOpacity={0.15} fill={color} />
            </AreaChart>
          ) : (
            <LineChart data={data}>
              <Tooltip cursor={false} />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={3} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
