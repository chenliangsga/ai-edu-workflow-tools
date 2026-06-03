import { BookOpen, CheckCircle2, History, TrendingUp, Search, GraduationCap } from 'lucide-react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { MasteryItem, Mistake, MistakeStats } from '@/src/lib/api';

export default function GrowthReport({ stats, mastery = [], weakPoints = [], mistakes = [], setCurrentView }: any) {
  const stat = stats as MistakeStats;
  const masteryList = mastery as MasteryItem[];
  const mistakeList = mistakes as Mistake[];
  const mastered = mistakeList.filter((item) => item.masteryStatus === '已掌握').length;
  const rate = stat?.total ? Math.round((mastered / stat.total) * 100) : 0;
  const accuracy = masteryList.length ? Math.round((masteryList.reduce((sum, item) => sum + item.accuracy, 0) / masteryList.length) * 100) : 0;
  const chartData = (masteryList.length ? masteryList : [{ accuracy: rate / 100 }]).map((item, index) => ({ day: String(index + 1), value: Math.round((item.accuracy || 0) * 100) }));

  return (
    <div className="pb-10 min-h-full">
      <div className="mb-8">
        <h2 className="text-[28px] lg:text-[32px] font-bold text-gray-900 mb-2 leading-tight">成长报告</h2>
        <p className="text-[14px] lg:text-[15px] text-gray-500 leading-relaxed">基于现有错题、复习状态和练习答题事件生成的学习分析。</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
        <ReportCard icon={<GraduationCap className="w-5 h-5" />} label="综合掌握度" value={`${rate}%`} note="来自错题掌握状态" color="text-blue-600" />
        <ReportCard icon={<CheckCircle2 className="w-5 h-5" />} label="练习正确率" value={`${accuracy}%`} note="来自练习卷作答事件" color="text-emerald-500" />
        <ReportCard icon={<History className="w-5 h-5" />} label="待复习题数" value={stat?.due || 0} note="当前待复习压力" color="text-orange-500" />
        <ReportCard icon={<BookOpen className="w-5 h-5" />} label="已掌握错题" value={mastered} note="转化为知识储备" color="text-purple-600" />
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 lg:p-8 mb-8 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <h3 className="text-[20px] font-bold text-gray-900">学习成长趋势</h3>
        </div>
        <div className="h-72 w-full pt-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} dy={10} />
              <Tooltip cursor={false} />
              <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={3} fillOpacity={0.16} fill="#2563eb" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 p-6 lg:p-8 shadow-sm">
          <h3 className="text-[18px] font-bold text-gray-900 mb-6 flex items-center gap-2">
            <Search className="w-5 h-5 text-orange-500" /> 薄弱知识点突破
          </h3>
          <div className="space-y-6">
            {(masteryList.length ? masteryList : (weakPoints as string[]).map((point) => ({ knowledgePoint: point, accuracy: 0.5, total: 1 }))).slice(0, 6).map((item: any) => (
              <div key={item.knowledgePoint}>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-gray-800 text-[14px]">{item.knowledgePoint}</span>
                  <span className="text-[13px] text-emerald-500 font-medium flex items-center gap-1">
                    <TrendingUp className="w-4 h-4" /> 掌握度 {Math.round((item.accuracy || 0) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${Math.round((item.accuracy || 0) * 100)}%` }}></div>
                </div>
              </div>
            ))}
            {!masteryList.length && !(weakPoints as string[]).length && <p className="text-[14px] text-gray-500">暂无练习答题数据，生成练习卷并记录作答后会形成趋势。</p>}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm flex flex-col items-center justify-center min-h-[300px]">
          <h3 className="text-[18px] font-bold text-gray-900 mb-2">知识点覆盖</h3>
          <p className="text-[13px] text-gray-500">当前错题涉及 {stat?.knowledgePointCount || 0} 个知识点</p>
          <div className="w-48 h-48 rounded-full border-4 border-gray-100 mt-6 flex items-center justify-center text-gray-300">
            <GraduationCap className="w-16 h-16" />
          </div>
        </div>
      </div>

      <div className="bg-blue-600 rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-md shadow-blue-500/20">
        <div className="flex-1">
          <h4 className="text-[20px] text-white font-bold mb-3">本周学习建议</h4>
          <p className="text-white/90 text-[15px] leading-relaxed max-w-3xl">
            当前共有 <strong className="font-bold text-white">{stat?.due || 0}</strong> 道待复习错题。建议优先处理 {stat?.knowledgePointTop?.[0]?.name || '薄弱知识点'}，并生成同类变式练习。
          </p>
        </div>
        <button className="px-6 py-3.5 bg-white text-blue-600 rounded-xl font-bold hover:bg-gray-50 transition-colors shadow-sm text-[14px]" onClick={() => setCurrentView?.('practice')}>
          开始今日复习
        </button>
      </div>
    </div>
  );
}

function ReportCard({ icon, label, value, note, color }: any) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col justify-between shadow-sm">
      <div className="flex items-center gap-2 text-gray-500 mb-4 font-medium">
        {icon} <span className="text-[13px]">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-[36px] font-bold leading-none ${color}`}>{value}</span>
      </div>
      <div className="mt-3 text-[13px] text-gray-500">{note}</div>
    </div>
  );
}
