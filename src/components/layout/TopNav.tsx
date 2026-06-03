import { User, ChevronDown, Settings, LogOut } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export function TopNav({
  currentView,
  setCurrentView,
  currentUser,
  activeChild,
  children = [],
  activeChildId,
  setActiveChildId,
  onManageChildren,
  onLogout,
}: any) {
  return (
    <nav className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-6 lg:px-8 h-16 bg-white border-b border-gray-200">
      <div className="flex items-center gap-10 max-w-[1440px] w-full mx-auto">
        <h1 className="text-[20px] font-bold text-blue-600 cursor-pointer whitespace-nowrap" onClick={() => setCurrentView('home')}>
          AI学习成长工作台
        </h1>
        <div className="hidden md:flex gap-8 items-center flex-1 ml-4 lg:ml-8">
          <a
            className={cn("font-bold pb-4 pt-4 mt-1 border-b-2 cursor-pointer transition-colors flex items-center text-[15px]", currentView === 'home' || currentView === 'students' ? "text-blue-600 border-blue-600" : "text-gray-600 border-transparent hover:text-blue-600")}
            onClick={() => setCurrentView('home')}
          >
            首页
          </a>
          <a className={cn("font-medium text-[15px] border-b-2 pb-4 pt-4 mt-1 transition-colors cursor-pointer flex items-center", currentView === 'repository' ? "text-blue-600 border-blue-600 font-bold" : "text-gray-600 border-transparent hover:text-blue-600")} onClick={() => setCurrentView('repository')}>
            错题本
          </a>
          <a className={cn("font-medium text-[15px] border-b-2 pb-4 pt-4 mt-1 transition-colors cursor-pointer flex items-center", currentView === 'practice' ? "text-blue-600 border-blue-600 font-bold" : "text-gray-600 border-transparent hover:text-blue-600")} onClick={() => setCurrentView('practice')}>
            练习中心
          </a>
          <a className={cn("font-medium text-[15px] border-b-2 pb-4 pt-4 mt-1 transition-colors cursor-pointer flex items-center", currentView === 'report' ? "text-blue-600 border-blue-600 font-bold" : "text-gray-600 border-transparent hover:text-blue-600")} onClick={() => setCurrentView('report')}>
            学情分析
          </a>
        </div>
        <div className="flex items-center gap-5">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-full border border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors mr-2 group">
              <div className="text-blue-600"><User className="w-4 h-4" /></div>
              <div className="flex flex-col">
                <span className="text-[10px] leading-none text-gray-500 mb-0.5">当前学生</span>
                <span className="text-[13px] font-medium text-gray-800 tracking-wide leading-none">{activeChild?.name || '未选择'}</span>
              </div>
              {children.length > 0 ? (
                <select
                  aria-label="切换学生"
                  className="w-5 bg-transparent text-transparent outline-none cursor-pointer"
                  value={activeChildId || ''}
                  onChange={(event) => {
                    setActiveChildId(event.target.value);
                    localStorage.setItem('edu_active_child_id', event.target.value);
                  }}
                >
                  {children.map((child: any) => <option key={child.id} value={child.id}>{child.name}</option>)}
                </select>
              ) : <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-blue-600 transition-colors" />}
            </div>
          <button className="text-gray-700 hover:text-blue-600 transition-colors" type="button" onClick={onManageChildren} title="学生管理">
            <Settings className="w-5 h-5" />
          </button>
          <button className="text-gray-700 hover:text-blue-600 transition-colors" type="button" onClick={onLogout} title="退出登录">
            <LogOut className="w-5 h-5" />
          </button>
          <div className="w-9 h-9 rounded-full overflow-hidden border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0">
            <div className="w-full h-full bg-blue-600 text-white grid place-items-center text-[13px] font-bold">
              {String(currentUser?.email || 'AI').slice(0, 1).toUpperCase()}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
