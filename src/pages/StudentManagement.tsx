import { useEffect, useState } from 'react';
import { UserPlus, Flame, Clock, AlertCircle, LayoutDashboard, Edit2 } from 'lucide-react';
import { Child, Mistake, MistakeStats, apiGet, childMeta } from '@/src/lib/api';

export default function StudentManagement({ children = [], activeChildId, setActiveChildId, mistakes = [], onAddStudent, setCurrentView }: any) {
  const studentList = children as Child[];
  const mistakeList = mistakes as Mistake[];
  const [studentStats, setStudentStats] = useState<Record<string, MistakeStats>>({});

  useEffect(() => {
    let cancelled = false;

    async function fetchStudentStats() {
      if (!studentList.length) {
        setStudentStats({});
        return;
      }

      const entries = await Promise.all(studentList.map(async (student) => {
        try {
          const data = await apiGet(`/api/v1/mistake-stats?childId=${encodeURIComponent(student.id)}`);
          return [student.id, data.stats] as const;
        } catch (error) {
          console.error(error);
          return [student.id, null] as const;
        }
      }));

      if (cancelled) return;

      setStudentStats(Object.fromEntries(entries.filter((entry): entry is readonly [string, MistakeStats] => Boolean(entry[1]))));
    }

    fetchStudentStats();

    return () => {
      cancelled = true;
    };
  }, [studentList]);

  return (
    <div className="min-h-full pb-10">
      <div className="flex justify-between items-center mb-6 lg:mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-[28px] lg:text-[32px] font-bold text-gray-900 mb-1 lg:mb-2 leading-tight">学生管理</h1>
          <p className="text-[14px] lg:text-[15px] text-gray-500 leading-relaxed">学生档案来自现有孩子管理接口，切换后错题和练习数据会同步刷新。</p>
        </div>
        <button className="bg-blue-600 text-white px-5 py-2.5 lg:px-6 lg:py-3 rounded-xl text-[14px] flex items-center gap-2 hover:bg-blue-700 transition-colors shadow-sm cursor-pointer font-medium" onClick={onAddStudent}>
          <UserPlus className="w-5 h-5" />
          新增学生
        </button>
      </div>

      {!studentList.length ? (
        <div className="bg-white rounded-2xl p-8 border border-gray-200 shadow-sm text-gray-500">
          还没有学生档案，点击右上角新增学生。
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {studentList.map((student, index) => {
            const active = student.id === activeChildId;
            const fallbackStats = active ? {
              total: mistakeList.length,
              mastered: mistakeList.filter((item) => item.masteryStatus === '已掌握').length,
              due: mistakeList.filter((item) => Boolean(item.nextReviewAt && new Date(item.nextReviewAt).getTime() <= Date.now())).length,
              knowledgePointCount: 0,
              knowledgePointTop: [],
              wrongReasonTop: [],
            } : undefined;
            const stats = studentStats[student.id] || fallbackStats;
            const total = stats?.total || 0;
            const mastered = stats?.mastered || 0;
            const dueCount = stats?.due || 0;
            const mastery = total ? Math.round((mastered / total) * 100) : 0;

            return (
              <div key={student.id} className={`bg-white rounded-2xl p-6 border shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group ${active ? 'border-blue-400' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between mb-5 relative z-10">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-[20px] font-bold flex-shrink-0">{student.name?.slice(0, 1) || '学'}</div>
                    <div>
                      <h2 className="text-[18px] font-bold text-gray-900 leading-tight">{student.name}</h2>
                      <p className="text-[13px] text-gray-500 mt-1">{childMeta(student)}</p>
                    </div>
                  </div>
                  <span className={`${active ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'} px-3 py-1 rounded-full text-[13px] flex items-center gap-1 font-medium`}>
                    {active ? <Flame className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />} {active ? '当前' : '可切换'}
                  </span>
                </div>

                <div className="space-y-5 mb-6 relative z-10">
                  <div>
                    <div className="flex justify-between text-[13px] font-medium mb-2 leading-none">
                      <span className="text-gray-500">当前掌握度</span>
                      <span className="text-blue-600 font-bold">{mastery}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${mastery}%` }} />
                    </div>
                  </div>

                  <div className="flex justify-between items-center p-3.5 bg-orange-50/50 rounded-xl border border-orange-100">
                    <div className="flex items-center gap-2 text-gray-600 text-[14px] font-medium">
                      <AlertCircle className="w-4 h-4 text-orange-500" />
                      待复习错题
                    </div>
                    <span className="text-[16px] text-orange-500 font-bold">{dueCount} 题</span>
                  </div>
                </div>

                <div className="flex gap-3 relative z-10">
                  <button
                    className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-[14px] font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                    onClick={() => {
                      setActiveChildId(student.id);
                      localStorage.setItem('edu_active_child_id', student.id);
                      setCurrentView('home');
                    }}
                  >
                    <LayoutDashboard className="w-4 h-4" /> 进入工作台
                  </button>
                  <button className="px-4 border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center cursor-pointer shadow-sm" onClick={onAddStudent}>
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
