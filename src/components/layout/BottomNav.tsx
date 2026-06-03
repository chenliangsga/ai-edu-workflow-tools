import { Calendar, Package, FileEdit, TrendingUp, ClipboardList } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export function BottomNav({ currentView, setCurrentView }: any) {
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 pb-4 pt-2 bg-surface shadow-lg border-t border-neutral rounded-t-xl h-[72px]">
      <a className={cn("flex flex-col items-center justify-center p-2 rounded-xl transition-all w-16 cursor-pointer", currentView === 'home' || currentView === 'students' ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100")} onClick={() => setCurrentView('home')}>
        <Calendar className="w-6 h-6 border-transparent" />
        <span className="text-[10px] mt-1 font-medium">今日</span>
      </a>
      <a className={cn("flex flex-col items-center justify-center p-2 rounded-xl transition-all w-16 cursor-pointer", currentView === 'repository' ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100")} onClick={() => setCurrentView('repository')}>
         <Package className="w-6 h-6" />
         <span className="text-[10px] mt-1 font-medium">仓库</span>
      </a>
      <a className={cn("flex flex-col items-center justify-center p-2 rounded-xl transition-all w-16 cursor-pointer", currentView === 'practice' ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100")} onClick={() => setCurrentView('practice')}>
        <FileEdit className="w-6 h-6" />
        <span className="text-[10px] mt-1 font-medium">练习</span>
      </a>
      <a className={cn("flex flex-col items-center justify-center p-2 rounded-xl transition-all w-16 cursor-pointer", currentView === 'records' ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100")} onClick={() => setCurrentView('records')}>
        <ClipboardList className="w-6 h-6" />
        <span className="text-[10px] mt-1 font-medium">记录</span>
      </a>
      <a className={cn("flex flex-col items-center justify-center p-2 rounded-xl transition-all w-16 cursor-pointer", currentView === 'report' ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100")} onClick={() => setCurrentView('report')}>
        <TrendingUp className="w-6 h-6" />
        <span className="text-[10px] mt-1 font-medium">成长</span>
      </a>
    </nav>
  );
}
