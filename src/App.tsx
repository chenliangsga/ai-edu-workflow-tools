import { FormEvent, useEffect, useMemo, useState } from 'react';
import { TopNav } from './components/layout/TopNav';
import { SideNav } from './components/layout/SideNav';
import { BottomNav } from './components/layout/BottomNav';
import Home from './pages/Home';
import StudentManagement from './pages/StudentManagement';
import ErrorRepository from './pages/ErrorRepository';
import SmartPractice from './pages/SmartPractice';
import PracticeRecords from './pages/PracticeRecords';
import GrowthReport from './pages/GrowthReport';
import { Child, CurrentUser, ExamPaper, Generation, MasteryItem, Mistake, MistakeStats, apiGet, apiJson, childMeta, readJson } from './lib/api';

type ViewKey = 'home' | 'students' | 'repository' | 'practice' | 'records' | 'report';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewKey>('home');
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [activeChildId, setActiveChildId] = useState(() => localStorage.getItem('edu_active_child_id') || '');
  const [loading, setLoading] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [authStatus, setAuthStatus] = useState('');
  const [childModalOpen, setChildModalOpen] = useState(false);
  const [childStatus, setChildStatus] = useState('');
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [stats, setStats] = useState<MistakeStats>({ total: 0, due: 0, knowledgePointCount: 0, knowledgePointTop: [], wrongReasonTop: [] });
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [examPapers, setExamPapers] = useState<ExamPaper[]>([]);
  const [mastery, setMastery] = useState<MasteryItem[]>([]);
  const [weakPoints, setWeakPoints] = useState<string[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [paperUploadOpen, setPaperUploadOpen] = useState(false);

  const activeChild = useMemo(
    () => children.find((child) => child.id === activeChildId) || children[0],
    [activeChildId, children],
  );
  const masteryRate = useMemo(() => {
    const total = stats?.total || mistakes.length;
    if (!total) return null;
    const mastered = stats?.mastered ?? mistakes.filter((item) => item.masteryStatus === '已掌握').length;
    return Math.round((mastered / total) * 100);
  }, [mistakes, stats]);

  useEffect(() => {
    fetch('/api/v1/session')
      .then(readJson)
      .then((data) => {
        setCurrentUser(data.currentUser || null);
        setChildren(data.children || []);
        const firstChild = data.children?.[0]?.id || '';
        const storedChild = localStorage.getItem('edu_active_child_id') || '';
        const nextChild = data.children?.some((child: Child) => child.id === storedChild) ? storedChild : firstChild;
        setActiveChildId(nextChild);
        if (nextChild) localStorage.setItem('edu_active_child_id', nextChild);
      })
      .catch(() => {
        setCurrentUser(null);
        setChildren([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!children.length) return;
    if (children.some((child) => child.id === activeChildId)) return;
    const nextChildId = children[0].id;
    setActiveChildId(nextChildId);
    localStorage.setItem('edu_active_child_id', nextChildId);
  }, [activeChildId, children]);

  async function refreshDashboard(childId = activeChildId) {
    if (!currentUser || !childId) {
      setMistakes([]);
      setStats({ total: 0, due: 0, knowledgePointCount: 0, knowledgePointTop: [], wrongReasonTop: [] });
      setGenerations([]);
      setExamPapers([]);
      setMastery([]);
      setWeakPoints([]);
      return;
    }

    setDataLoading(true);
    try {
      const query = `childId=${encodeURIComponent(childId)}`;
      const [mistakeData, statsData, generationData, masteryData, paperData] = await Promise.all([
        apiGet(`/api/v1/mistakes?${query}`),
        apiGet(`/api/v1/mistake-stats?${query}`),
        apiGet(`/api/v1/generations?${query}`),
        apiGet(`/api/v1/mastery-stats?${query}`),
        apiGet(`/api/v1/exam-papers?${query}`),
      ]);
      setMistakes(mistakeData.items || []);
      setStats(statsData.stats || { total: 0, due: 0, knowledgePointCount: 0, knowledgePointTop: [], wrongReasonTop: [] });
      setGenerations(generationData.items || []);
      setExamPapers(paperData.items || []);
      setMastery(masteryData.items || []);
      setWeakPoints(masteryData.weakKnowledgePoints || []);
    } catch (error) {
      console.error(error);
    } finally {
      setDataLoading(false);
    }
  }

  useEffect(() => {
    refreshDashboard();
  }, [currentUser?.email, activeChildId]);

  async function sendCode() {
    setAuthStatus('正在发送验证码');
    try {
      const data = await readJson(await fetch('/api/v1/auth/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail }),
      }));
      setAuthStatus(data.message || '验证码已发送');
    } catch (error: any) {
      setAuthStatus(error.message);
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setAuthStatus('正在登录');
    try {
      const data = await readJson(await fetch('/api/v1/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, code: authCode }),
      }));
      setCurrentUser(data.currentUser);
      setChildren(data.children || []);
      const nextChildId = data.children?.[0]?.id || '';
      setActiveChildId(nextChildId);
      if (nextChildId) localStorage.setItem('edu_active_child_id', nextChildId);
      setAuthStatus('');
      if (!data.children?.length) setChildModalOpen(true);
    } catch (error: any) {
      setAuthStatus(error.message);
    }
  }

  async function logout() {
    await fetch('/api/v1/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    setCurrentUser(null);
    setChildren([]);
    localStorage.removeItem('edu_active_child_id');
  }

  async function addChild(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChildStatus('正在添加学生');
    const input = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const data = await apiJson('/api/v1/children', input);
      setChildren(data.items || []);
      setActiveChildId(data.child?.id || '');
      if (data.child?.id) localStorage.setItem('edu_active_child_id', data.child.id);
      event.currentTarget.reset();
      setChildStatus('已添加');
    } catch (error: any) {
      setChildStatus(error.message);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#f4f5f7] text-gray-500">
        正在加载学习工作台...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#f4f5f7] px-5 font-body-base">
        <section className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          <h1 className="text-[28px] font-bold text-gray-900 mb-2">登录</h1>
          <p className="text-[14px] text-gray-500 mb-6">继续使用 AI 学习成长工作台。</p>
          <form className="space-y-4" onSubmit={login}>
            <label className="block">
              <span className="block text-[13px] font-bold text-gray-700 mb-2">邮箱</span>
              <input className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none focus:border-blue-500" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} type="email" placeholder="you@example.com" required />
            </label>
            <label className="block">
              <span className="block text-[13px] font-bold text-gray-700 mb-2">验证码</span>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none focus:border-blue-500" value={authCode} onChange={(event) => setAuthCode(event.target.value)} inputMode="numeric" maxLength={6} placeholder="6 位验证码" required />
                <button className="rounded-xl border border-blue-200 px-4 text-[14px] font-bold text-blue-600 hover:bg-blue-50" type="button" onClick={sendCode}>发送验证码</button>
              </div>
            </label>
            <button className="w-full rounded-xl bg-blue-600 py-3 text-[15px] font-bold text-white hover:bg-blue-700" type="submit">登录</button>
            <p className="min-h-5 text-[13px] font-medium text-blue-600">{authStatus}</p>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="bg-[#f4f5f7] text-gray-900 min-h-screen pt-16 pb-20 lg:pb-0 lg:pl-64 font-body-base">
      <TopNav
        currentView={currentView}
        setCurrentView={setCurrentView}
        currentUser={currentUser}
        activeChild={activeChild}
        children={children}
        activeChildId={activeChildId}
        setActiveChildId={setActiveChildId}
        onManageChildren={() => setChildModalOpen(true)}
        onLogout={logout}
      />
      <SideNav
        currentView={currentView}
        setCurrentView={setCurrentView}
        masteryRate={masteryRate}
        onLogout={logout}
        onUploadPaper={() => {
          setCurrentView('repository');
          setPaperUploadOpen(true);
        }}
      />
      <main className="max-w-[1440px] mx-auto p-6 lg:p-8 space-y-6 lg:space-y-8 min-h-[calc(100vh-64px)]">
        {currentView === 'home' && <Home mistakes={mistakes} stats={stats} mastery={mastery} weakPoints={weakPoints} generations={generations} loading={dataLoading} setCurrentView={setCurrentView} />}
        {currentView === 'students' && <StudentManagement children={children} activeChildId={activeChildId} setActiveChildId={setActiveChildId} mistakes={mistakes} onAddStudent={() => setChildModalOpen(true)} setCurrentView={setCurrentView} />}
        {currentView === 'repository' && (
          <ErrorRepository
            mistakes={mistakes}
            stats={stats}
            activeChildId={activeChildId}
            activeChild={activeChild}
            refreshData={refreshDashboard}
            setCurrentView={setCurrentView}
            paperUploadOpen={paperUploadOpen}
            setPaperUploadOpen={setPaperUploadOpen}
          />
        )}
        {currentView === 'practice' && <SmartPractice mistakes={mistakes} stats={stats} mastery={mastery} weakPoints={weakPoints} activeChildId={activeChildId} refreshData={refreshDashboard} />}
        {currentView === 'records' && <PracticeRecords examPapers={examPapers} activeChildId={activeChildId} refreshData={refreshDashboard} />}
        {currentView === 'report' && <GrowthReport stats={stats} mastery={mastery} weakPoints={weakPoints} mistakes={mistakes} setCurrentView={setCurrentView} />}
      </main>
      <BottomNav currentView={currentView} setCurrentView={setCurrentView} />

      {childModalOpen && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-gray-950/40 p-5" onClick={() => setChildModalOpen(false)}>
          <section className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
              <div>
                <p className="text-[12px] font-bold text-blue-600">学生管理</p>
                <h2 className="text-[22px] font-bold text-gray-900">添加和切换学生</h2>
              </div>
              <button className="rounded-full border border-gray-200 px-3 py-1 text-gray-500 hover:bg-gray-50" type="button" onClick={() => setChildModalOpen(false)}>关闭</button>
            </div>
            <div className="grid gap-3 py-5">
              {children.length ? children.map((child) => (
                <button
                  key={child.id}
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left ${child.id === activeChildId ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
                  type="button"
                  onClick={() => {
                    setActiveChildId(child.id);
                    localStorage.setItem('edu_active_child_id', child.id);
                  }}
                >
                  <span>
                    <strong className="block text-gray-900">{child.name}</strong>
                    <small className="text-gray-500">{childMeta(child)}</small>
                  </span>
                  <span className="text-[13px] font-bold text-blue-600">{child.id === activeChildId ? '当前' : '切换'}</span>
                </button>
              )) : <p className="rounded-xl bg-gray-50 p-4 text-[14px] text-gray-500">还没有学生档案，先添加一个。</p>}
            </div>
            <form className="grid gap-3 border-t border-gray-100 pt-5 md:grid-cols-2" onSubmit={addChild}>
              <label className="grid gap-2 text-[13px] font-bold text-gray-700">
                学生姓名
                <input className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none focus:border-blue-500" name="name" placeholder="例如：小禾" required />
              </label>
              <label className="grid gap-2 text-[13px] font-bold text-gray-700">
                当前年级
                <input className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none focus:border-blue-500" name="grade" placeholder="例如：初一" />
              </label>
              <label className="grid gap-2 text-[13px] font-bold text-gray-700">
                出生年份
                <input className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none focus:border-blue-500" name="birthYear" type="number" min="1990" max="2026" placeholder="例如：2013" required />
              </label>
              <label className="grid gap-2 text-[13px] font-bold text-gray-700">
                出生月份
                <select className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none focus:border-blue-500" name="birthMonth" required>
                  <option value="">选择月份</option>
                  {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 月</option>)}
                </select>
              </label>
              <button className="rounded-xl bg-blue-600 py-3 font-bold text-white hover:bg-blue-700 md:col-span-2" type="submit">添加学生</button>
              <p className="text-[13px] font-medium text-blue-600 md:col-span-2">{childStatus}</p>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
