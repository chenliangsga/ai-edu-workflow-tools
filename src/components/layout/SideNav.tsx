import { Bot, Maximize, Calendar, Users, BookOpen, Brain, TrendingUp, LogOut, ClipboardList } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export function SideNav({ currentView, setCurrentView, masteryRate, onUploadPaper, onLogout }: any) {
  return (
    <aside className="hidden lg:flex flex-col fixed left-0 top-16 bottom-0 w-64 p-5 space-y-4 bg-[#f8f9fc] border-r border-gray-200 z-40">
      <div className="flex items-center gap-3 p-2 mb-2 mt-2">
        <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white overflow-hidden shadow-sm flex-shrink-0">
          <Bot className="w-7 h-7" />
        </div>
        <div>
          <h2 className="text-[15px] font-bold text-gray-900 leading-tight">学习助手</h2>
          <p className="text-[12px] text-gray-500 mt-1">
            {typeof masteryRate === 'number' ? `当前掌握度 ${masteryRate}%` : '暂无掌握度'}
          </p>
        </div>
      </div>
      
      <button className="w-full bg-blue-600 text-white rounded-xl py-3.5 px-4 flex items-center justify-center gap-2 text-[14px] hover:bg-blue-700 transition-colors mb-4 shadow-sm font-medium" onClick={onUploadPaper}>
        <Maximize className="w-4 h-4" />
        上传纸质卷子
      </button>

      <nav className="flex-1 space-y-1.5 pt-2">
        <a className={cn("flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-all active:scale-95 text-[14px] font-medium", currentView === 'home' ? "bg-blue-600 text-white shadow-sm" : "text-gray-700 hover:bg-gray-200/60")} onClick={() => setCurrentView('home')}>
          <Calendar className="w-5 h-5" />
          <span>今日任务</span>
        </a>
        <a className={cn("flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-all active:scale-95 text-[14px] font-medium", currentView === 'students' ? "bg-blue-600 text-white shadow-sm" : "text-gray-700 hover:bg-gray-200/60")} onClick={() => setCurrentView('students')}>
          <Users className="w-5 h-5" />
          <span>学生管理</span>
        </a>
        <a className={cn("flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-all active:scale-95 text-[14px] font-medium", currentView === 'repository' ? "bg-blue-600 text-white shadow-sm" : "text-gray-700 hover:bg-gray-200/60")} onClick={() => setCurrentView('repository')}>
          <BookOpen className="w-5 h-5" />
          <span>错题仓库</span>
        </a>
        <a className={cn("flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-all active:scale-95 text-[14px] font-medium", currentView === 'practice' ? "bg-blue-600 text-white shadow-sm" : "text-gray-700 hover:bg-gray-200/60")} onClick={() => setCurrentView('practice')}>
          <Brain className="w-5 h-5" />
          <span>智能练习</span>
        </a>
        <a className={cn("flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-all active:scale-95 text-[14px] font-medium", currentView === 'records' ? "bg-blue-600 text-white shadow-sm" : "text-gray-700 hover:bg-gray-200/60")} onClick={() => setCurrentView('records')}>
          <ClipboardList className="w-5 h-5" />
          <span>练习记录</span>
        </a>
        <a className={cn("flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-all active:scale-95 text-[14px] font-medium", currentView === 'report' ? "bg-blue-600 text-white shadow-sm" : "text-gray-700 hover:bg-gray-200/60")} onClick={() => setCurrentView('report')}>
          <TrendingUp className="w-5 h-5" />
          <span>成长报告</span>
        </a>
      </nav>
      
      <div className="mt-auto space-y-1.5 pt-4 border-t border-gray-200 pt-5">
        <button className="w-full flex items-center gap-3 p-3 text-gray-600 hover:bg-gray-200/60 rounded-xl cursor-pointer transition-all active:scale-95 text-[13px] font-medium bg-transparent border-0" onClick={onLogout}>
          <LogOut className="w-5 h-5 opacity-70" />
          <span>退出登录</span>
        </button>
      </div>
    </aside>
  );
}
