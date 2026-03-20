import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Download, Users, FileText, BarChart3, Search, UserPlus, RotateCcw, Trash2,
  ShieldCheck, GraduationCap, Database, FlaskConical, Upload, ChevronLeft, ChevronRight
} from 'lucide-react';
import { User as UserType, User } from '../types';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import JudgeDashboard from './JudgeDashboard';

interface AdminDashboardProps {
  user: User;
}

export default function AdminDashboard({ user }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<'stats' | 'users' | 'rounds' | 'ordering'>('stats');
  const [selectedStudentId, setSelectedStudentId] = useState<string | number | null>(null);
  const [stats, setStats] = useState<any[]>([]);
  const [users, setUsers] = useState<UserType[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [selectedRound, setSelectedRound] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');

  const didSetInitialRound = useRef(false);
  const latestStatsRequestId = useRef(0);

  const [newUser, setNewUser] = useState({
    username: '',
    name: '',
    role: 'student' as const,
    student_id: ''
  });
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDanger?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const [deletingId, setDeletingId] = useState<string | number | null>(null);
  const [orderingMode, setOrderingMode] = useState<'id_asc' | 'id_desc' | 'manual'>('id_asc');
  const [manualOrders, setManualOrders] = useState<Record<string, number>>({});

  const showConfirm = (title: string, message: string, onConfirm: () => void, isDanger = false) => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, isDanger });
  };

  useEffect(() => {
    fetchRounds();
  }, []);

  useEffect(() => {
  if (activeTab === 'stats' || activeTab === 'ordering') fetchStats();
  if (activeTab === 'users') fetchUsers();
  if (activeTab === 'rounds') fetchRounds();
}, [activeTab, selectedRound]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  useEffect(() => {
    if (Array.isArray(stats) && stats.length > 0) {
      const initialManualOrders: Record<string, number> = {};
      stats.forEach(s => {
        initialManualOrders[String(s.user_id)] = s.presentation_order || 0;
      });
      setManualOrders(initialManualOrders);
    }
  }, [stats]);

  const fetchStats = async () => {
    const requestId = ++latestStatsRequestId.current;

    try {
      const res = await fetch(`/api/admin/stats/${selectedRound}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();

      if (requestId !== latestStatsRequestId.current) return;

      setStats(Array.isArray(data) ? data : []);
    } catch (err) {
      if (requestId !== latestStatsRequestId.current) return;
      console.error('[ADMIN] Failed to fetch stats:', err);
      setStats([]);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[ADMIN] Failed to fetch users:', err);
      setUsers([]);
    }
  };

  const fetchRounds = async () => {
    try {
      const res = await fetch('/api/admin/rounds');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();

      if (Array.isArray(data)) {
        setRounds(data);

        const activeRound = data.find((r: any) => Number(r.is_open) === 1);
        if (activeRound && !didSetInitialRound.current) {
          didSetInitialRound.current = true;
          setSelectedRound(activeRound.round_number);
        }
      } else {
        setRounds([]);
      }
    } catch (err) {
      console.error('[ADMIN] Failed to fetch rounds:', err);
      setRounds([]);
    }
  };

  const handleToggleRound = async (roundNumber: number, isOpen: boolean) => {
    const res = await fetch('/api/admin/rounds/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roundNumber, isOpen }),
    });

    if (res.ok) {
      if (isOpen) {
        setSelectedRound(roundNumber);
      }
      await fetchRounds();
      if (activeTab === 'stats' || activeTab === 'ordering') {
        await fetchStats();
      }
    }
  };

  const handleClearData = async () => {
    showConfirm(
      '데이터 전체 초기화',
      '경고: 모든 학생의 기획안, 심사 결과, 그리고 등록된 모든 사용자(관리자 제외)가 영구적으로 삭제됩니다. 정말로 초기화하시겠습니까?',
      async () => {
        const res = await fetch('/api/admin/clear-data', { method: 'POST' });
        if (res.ok) {
          alert('모든 데이터가 초기화되었습니다.');
          fetchStats();
          fetchUsers();
        }
      },
      true
    );
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });
      if (res.ok) {
        alert('사용자가 등록되었습니다. 초기 비밀번호는 아이디와 동일합니다.');
        setNewUser({ username: '', name: '', role: 'student', student_id: '' });
        fetchUsers();
      } else {
        const err = await res.json();
        alert(err.error);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (userId: string | number) => {
    showConfirm(
      '비밀번호 초기화',
      '비밀번호를 초기 비밀번호(아이디)로 되돌리시겠습니까?',
      async () => {
        const res = await fetch('/api/admin/users/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        if (res.ok) alert('비밀번호가 초기화되었습니다.');
      }
    );
  };

  const handleManualOrderChange = (userId: string | number, order: number) => {
    setManualOrders(prev => ({ ...prev, [String(userId)]: order }));
  };

  const handleApplyManualOrders = async () => {
    if (!Array.isArray(stats)) return;

    const newOrders = stats.map(s => ({
      proposalId: s.id,
      userId: s.user_id,
      order: manualOrders[String(s.user_id)] || 0,
      isParticipating: !!s.is_participating
    }));

    await handleBulkOrderUpdate(newOrders);
    alert('발표 순서가 저장되었습니다.');
  };

  const handleApplyAutoOrder = async (mode: 'id_asc' | 'id_desc') => {
    if (!Array.isArray(stats)) return;

    const sorted = [...stats].sort((a, b) => {
      if (mode === 'id_asc') return (a.student_id || '').localeCompare(b.student_id || '');
      return (b.student_id || '').localeCompare(a.student_id || '');
    });

    const newOrders = sorted.map((s, idx) => ({
      proposalId: s.id,
      userId: s.user_id,
      order: idx + 1,
      isParticipating: !!s.is_participating
    }));

    await handleBulkOrderUpdate(newOrders);
    alert(`${mode === 'id_asc' ? '학번순' : '학번역순'}으로 순서가 재배정되었습니다.`);
  };

  const handleToggleAllParticipation = async (participate: boolean) => {
    if (!Array.isArray(stats)) return;

    showConfirm(
      participate ? '전체 발표 참여' : '전체 발표 제외',
      `모든 학생을 발표 ${participate ? '참여' : '제외'} 상태로 변경하시겠습니까?`,
      async () => {
        const newOrders = stats.map(s => ({
          proposalId: s.id,
          userId: s.user_id,
          order: s.presentation_order || 0,
          isParticipating: participate
        }));
        await handleBulkOrderUpdate(newOrders);
      }
    );
  };

  const handleDeleteUser = async (userId: string | number) => {
    showConfirm(
      '사용자 삭제',
      '정말로 이 사용자를 삭제하시겠습니까? 관련 데이터가 모두 삭제될 수 있습니다.',
      async () => {
        setDeletingId(userId);
        try {
          const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
          const data = await res.json();

          if (res.ok) {
            alert('사용자가 성공적으로 삭제되었습니다.');
            fetchUsers();
          } else {
            alert(data.error || '삭제에 실패했습니다.');
          }
        } catch (err) {
          alert('서버 통신 오류가 발생했습니다: ' + (err as Error).message);
        } finally {
          setDeletingId(null);
        }
      },
      true
    );
  };

  const handleFullBackup = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/backup');
      const data = await res.json();

      const wb = XLSX.utils.book_new();

      const proposalsWs = XLSX.utils.json_to_sheet(data.proposals);
      XLSX.utils.book_append_sheet(wb, proposalsWs, '기획안_전체');

      const evalsWs = XLSX.utils.json_to_sheet(data.evaluations);
      XLSX.utils.book_append_sheet(wb, evalsWs, '심사_전체');

      const usersWs = XLSX.utils.json_to_sheet(data.users);
      XLSX.utils.book_append_sheet(wb, usersWs, '사용자_전체');

      XLSX.writeFile(wb, `시스템_전체_백업_${new Date().toISOString().split('T')[0]}.xlsx`);
      alert('전체 백업 파일이 생성되었습니다.');
    } catch (err) {
      alert('백업 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleSeedData = async () => {
    showConfirm(
      '테스트 데이터 생성',
      '가상의 학생 30명과 교수 5명의 심사 데이터를 자동으로 생성합니다. 기존 데이터(관리자 제외)는 모두 삭제됩니다. 계속하시겠습니까?',
      async () => {
        setLoading(true);
        try {
          const res = await fetch('/api/admin/seed', { method: 'POST' });
          if (res.ok) {
            alert('테스트 데이터 30명(학생) 및 5명(교수) 생성이 완료되었습니다.');
            fetchStats();
            fetchUsers();
          } else {
            const err = await res.json();
            alert(err.error || '데이터 생성에 실패했습니다.');
          }
        } catch (err) {
          alert('서버 통신 오류가 발생했습니다.');
        } finally {
          setLoading(false);
        }
      },
      true
    );
  };

  const exportToExcel = () => {
    if (!Array.isArray(stats)) return;

    const data = stats.map(s => {
      const row: any = {
        '상태': s.is_submitted ? '최종 제출' : '작성 중',
        '학번': s.student_id,
        '이름': s.name,
        '선정 텍스트 명': s.title,
        '평균 총점': s.averageScore,
        '텍스트 선정 점수': s.avgText,
        '작품1 평균': s.avgWork1,
        '작품2 평균': s.avgWork2,
        '작품3 평균': s.avgWork3,
      };

      if (Array.isArray(s.evaluations)) {
        s.evaluations.forEach((e: any, idx: number) => {
          row[`교수${idx + 1} 총점`] = e.totalScore?.toFixed(2) || '0.00';
          row[`교수${idx + 1} 텍스트 선정 점수`] = e.scores?.text || 0;
          row[`교수${idx + 1} 작품1 점수`] = e.scores?.work1 || 0;
          row[`교수${idx + 1} 작품2 점수`] = e.scores?.work2 || 0;
          row[`교수${idx + 1} 작품3 점수`] = e.scores?.work3 || 0;
        });
      }

      const feedbacks = Array.isArray(s.evaluations)
        ? s.evaluations.map((e: any, idx: number) => `교수${idx + 1}: ${e.comment || '의견 없음'}`).join(' / ')
        : '';

      row['교수진 피드백'] = feedbacks;
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${selectedRound}차 심사결과`);
    XLSX.writeFile(wb, `졸업작품_${selectedRound}차_심사결과_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleBulkUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;

      const utf8Decoder = new TextDecoder('utf-8');
      let text = utf8Decoder.decode(buffer);

      if (text.includes('�')) {
        const eucKrDecoder = new TextDecoder('euc-kr');
        text = eucKrDecoder.decode(buffer);
      }

      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const data = results.data as any[];
          const validUsers = data.filter(u => u.role && u.username && u.name);

          if (validUsers.length === 0) {
            alert('유효한 사용자 데이터가 없습니다. CSV 형식을 확인해주세요. (필수: role, username, name)');
            return;
          }

          showConfirm(
            '일괄 등록 확인',
            `${validUsers.length}명의 사용자를 일괄 등록하시겠습니까?`,
            async () => {
              setLoading(true);
              try {
                const res = await fetch('/api/admin/users/bulk', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ users: validUsers }),
                });
                if (res.ok) {
                  alert(`${validUsers.length}명이 성공적으로 등록되었습니다.`);
                  fetchUsers();
                } else {
                  const err = await res.json();
                  alert(err.error || '일괄 등록에 실패했습니다.');
                }
              } catch (err) {
                alert('서버 통신 오류가 발생했습니다.');
              } finally {
                setLoading(false);
              }
            }
          );
        }
      });
    };

    reader.readAsArrayBuffer(file);
    event.target.value = '';
  };

  const filteredStats = Array.isArray(stats)
    ? stats.filter(s =>
        s.name?.includes(searchTerm) ||
        s.student_id?.includes(searchTerm) ||
        s.title?.includes(searchTerm)
      )
    : [];

  const filteredUsers = Array.isArray(users)
    ? users.filter(u =>
        u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.student_id?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : [];

  const totalPages = Math.ceil(filteredUsers.length / pageSize);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleUpdateOrder = async (
    proposalId: string | number | null,
    userId: string | number,
    newOrder: number,
    isParticipating?: boolean
  ) => {
    if (!Array.isArray(stats)) return;

    const updatedStats = stats.map(s => {
      if (s.id === proposalId && proposalId !== null) {
        return {
          ...s,
          presentation_order: newOrder,
          is_participating: isParticipating !== undefined ? isParticipating : s.is_participating
        };
      }
      if (s.user_id === userId) {
        return {
          ...s,
          presentation_order: newOrder,
          is_participating: isParticipating !== undefined ? isParticipating : s.is_participating
        };
      }
      return s;
    });

    setStats(updatedStats);

    try {
      const target = updatedStats.find(s => s.user_id === userId);
      await fetch('/api/admin/presentation-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orders: [{
            proposalId,
            userId,
            order: newOrder,
            isParticipating: target?.is_participating,
            roundNumber: selectedRound
          }]
        }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleBulkOrderUpdate = async (
    newOrders: { proposalId: string | number | null; userId: string | number; order: number; isParticipating: boolean }[]
  ) => {
    try {
      const res = await fetch('/api/admin/presentation-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orders: newOrders.map(o => ({ ...o, roundNumber: selectedRound }))
        }),
      });
      if (res.ok) {
        fetchStats();
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (selectedStudentId) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => setSelectedStudentId(null)}
          className="flex items-center gap-2 text-black/50 hover:text-black transition-colors"
        >
          <RotateCcw size={18} />
          통계 목록으로 돌아가기
        </button>
        <JudgeDashboard user={user} forcedProposalId={selectedStudentId} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">관리자 대시보드</h2>
          <div className="flex flex-wrap gap-4 mt-4">
            <button
              onClick={() => setActiveTab('stats')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'stats' ? 'bg-black text-white' : 'bg-white border border-black/10 text-black/40 hover:text-black'}`}
            >
              심사 현황 및 통계
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'users' ? 'bg-black text-white' : 'bg-white border border-black/10 text-black/40 hover:text-black'}`}
            >
              사용자 관리
            </button>
            <button
              onClick={() => setActiveTab('rounds')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'rounds' ? 'bg-black text-white' : 'bg-white border border-black/10 text-black/40 hover:text-black'}`}
            >
              심사 차수 관리
            </button>
            <button
              onClick={() => setActiveTab('ordering')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'ordering' ? 'bg-black text-white' : 'bg-white border border-black/10 text-black/40 hover:text-black'}`}
            >
              발표 순서 관리
            </button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {activeTab === 'stats' && (
            <button
              onClick={handleSeedData}
              disabled={loading}
              className="flex items-center gap-2 px-6 py-3 bg-amber-50 text-amber-600 rounded-2xl font-bold hover:bg-amber-100 transition-all border border-amber-100"
            >
              <FlaskConical size={20} />
              테스트 데이터 생성
            </button>
          )}
          {activeTab === 'stats' && (
            <button
              onClick={handleFullBackup}
              className="flex items-center gap-2 px-6 py-3 bg-black text-white rounded-2xl font-bold hover:bg-black/90 transition-all shadow-lg shadow-black/20"
            >
              <Database size={20} />
              전체 백업 (DB)
            </button>
          )}
          {activeTab === 'stats' && (
            <button
              onClick={exportToExcel}
              className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20"
            >
              <Download size={20} />
              엑셀 다운로드
            </button>
          )}
          <button
            onClick={handleClearData}
            className="flex items-center gap-2 px-6 py-3 bg-red-50 text-red-600 rounded-2xl font-bold hover:bg-red-100 transition-all border border-red-100"
          >
            <Trash2 size={20} />
            전체 데이터 초기화
          </button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {activeTab === 'stats' ? (
          <motion.div
            key="stats"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            <div className="flex items-center gap-3 flex-wrap">
              {rounds.some((r: any) => Number(r.is_open) === 1) && (
                <div className="text-[11px] font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-700">
                  현재 진행 차수: {rounds.find((r: any) => Number(r.is_open) === 1)?.round_number}차
                </div>
              )}

              <div className="flex gap-2 bg-black/5 p-1.5 rounded-2xl w-fit">
                {[1, 2, 3].map(num => (
                  <button
                    key={num}
                    onClick={() => setSelectedRound(num)}
                    className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${selectedRound === num ? 'bg-white text-black shadow-sm' : 'text-black/40 hover:text-black'}`}
                  >
                    {num}차 심사
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                    <Users size={20} />
                  </div>
                  <span className="text-sm font-bold text-black/40 uppercase tracking-wider">제출 학생</span>
                </div>
                <div className="text-4xl font-bold">{Array.isArray(stats) ? stats.filter(s => s.is_submitted).length : 0}명</div>
              </div>

              <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                    <FileText size={20} />
                  </div>
                  <span className="text-sm font-bold text-black/40 uppercase tracking-wider">심사 완료</span>
                </div>
                <div className="text-4xl font-bold">{Array.isArray(stats) ? stats.filter(s => Array.isArray(s.evaluations) && s.evaluations.length > 0).length : 0}명</div>
              </div>

              <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center">
                    <BarChart3 size={20} />
                  </div>
                  <span className="text-sm font-bold text-black/40 uppercase tracking-wider">평균 총점</span>
                </div>
                <div className="text-4xl font-bold">
                  {Array.isArray(stats)
                    ? (
                        stats.reduce((acc, s) => acc + (parseFloat(s.averageScore) || 0), 0) /
                        (stats.filter(s => Array.isArray(s.evaluations) && s.evaluations.length > 0).length || 1)
                      ).toFixed(2)
                    : '0.00'}
                </div>
              </div>
            </div>

            <section className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
              <div className="p-6 border-b border-black/5 flex justify-between items-center">
                <h3 className="text-lg font-bold">{selectedRound}차 심사 현황</h3>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-black/30" size={18} />
                  <input
                    type="text"
                    placeholder="검색..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-10 pr-4 py-2 bg-black/5 rounded-xl text-sm focus:outline-none w-64"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-black/[0.02] text-[10px] font-bold text-black/40 uppercase tracking-widest">
                      <th className="px-6 py-4">참여</th>
                      <th className="px-6 py-4">상태</th>
                      <th className="px-6 py-4">학번</th>
                      <th className="px-6 py-4">이름</th>
                      <th className="px-6 py-4">선정 텍스트 명</th>
                      <th className="px-6 py-4">평균 총점</th>
                      <th className="px-6 py-4">텍스트 선정 점수</th>
                      <th className="px-6 py-4">작품1 평균</th>
                      <th className="px-6 py-4">작품2 평균</th>
                      <th className="px-6 py-4">작품3 평균</th>
                      <th className="px-6 py-4">교수진 피드백</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5">
                    {filteredStats.map((s) => (
                      <tr key={s.user_id} className={`hover:bg-black/[0.01] transition-colors ${s.is_participating ? 'bg-emerald-50/30' : ''}`}>
                        <td className="px-6 py-4">
                          {s.is_participating ? (
                            <span className="text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded-full font-bold">참여</span>
                          ) : (
                            <span className="text-[10px] bg-black/5 text-black/30 px-2 py-0.5 rounded-full font-bold">미참여</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {s.is_submitted ? (
                            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">최종 제출</span>
                          ) : (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">작성 중</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm font-mono">{s.student_id}</td>
                        <td className="px-6 py-4 text-sm font-bold">
                          <button
                            onClick={() => s.id && setSelectedStudentId(s.id)}
                            disabled={!s.id}
                            className={`${s.id ? 'hover:text-blue-600 transition-colors' : 'cursor-default'} text-left`}
                          >
                            {s.name}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-sm">{s.title}</td>
                        <td className="px-6 py-4">
                          <span className="px-3 py-1 bg-black text-white rounded-full font-bold text-xs">
                            {s.averageScore}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-black/60">{s.avgText}</td>
                        <td className="px-6 py-4 text-sm font-medium text-black/60">{s.avgWork1}</td>
                        <td className="px-6 py-4 text-sm font-medium text-black/60">{s.avgWork2}</td>
                        <td className="px-6 py-4 text-sm font-medium text-black/60">{s.avgWork3}</td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-2">
                            {(s.evaluations || []).map((e: any, i: number) => (
                              <div key={i} className="group relative">
                                <div className="w-8 h-8 bg-black/5 rounded-full flex items-center justify-center text-[10px] font-bold cursor-help hover:bg-black hover:text-white transition-all">
                                  {i + 1}
                                </div>
                                <div className="absolute top-1/2 -translate-y-1/2 right-full mr-3 w-72 p-4 bg-black text-white text-[11px] rounded-2xl opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 shadow-2xl border border-white/10">
                                  <div className="flex justify-between mb-2 border-b border-white/10 pb-1">
                                    <span className="font-bold">교수{i + 1}</span>
                                    <span className="text-amber-400 font-bold">총점: {e.totalScore.toFixed(2)}</span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2 text-[9px] text-white/60">
                                    <span>텍스트: {e.scores.text}</span>
                                    <span>작품1: {e.scores.work1}</span>
                                    <span>작품2: {e.scores.work2}</span>
                                    <span>작품3: {e.scores.work3}</span>
                                  </div>
                                  <p className="leading-relaxed italic whitespace-pre-wrap">"{e.comment}"</p>
                                  <div className="absolute top-1/2 -translate-y-1/2 -right-1 w-2 h-2 bg-black rotate-45 border-r border-t border-white/10" />
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </motion.div>
        ) : activeTab === 'users' ? (
          <motion.div
            key="users"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-8"
          >
            <div className="lg:col-span-1">
              <section className="bg-white p-8 rounded-3xl shadow-sm border border-black/5 sticky top-24">
                <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <UserPlus size={20} />
                  신규 등록
                </h3>
                <form onSubmit={handleCreateUser} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-black/40 uppercase mb-2">구분</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setNewUser({ ...newUser, role: 'student' })}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${newUser.role === 'student' ? 'bg-black text-white border-black' : 'bg-white text-black/40 border-black/10'}`}
                      >
                        학생
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewUser({ ...newUser, role: 'judge' })}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${newUser.role === 'judge' ? 'bg-black text-white border-black' : 'bg-white text-black/40 border-black/10'}`}
                      >
                        교수
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-black/40 uppercase mb-2">아이디 (학번/성함)</label>
                    <input
                      type="text"
                      value={newUser.username}
                      onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none"
                      placeholder="예: 20240001 또는 김교수"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-black/40 uppercase mb-2">이름</label>
                    <input
                      type="text"
                      value={newUser.name}
                      onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none"
                      placeholder="실명 입력"
                      required
                    />
                  </div>

                  {newUser.role === 'student' && (
                    <div>
                      <label className="block text-xs font-bold text-black/40 uppercase mb-2">학번 확인</label>
                      <input
                        type="text"
                        value={newUser.student_id}
                        onChange={e => setNewUser({ ...newUser, student_id: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none"
                        placeholder="학번 다시 입력"
                        required
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-black text-white py-3 rounded-xl font-bold hover:bg-black/90 transition-all disabled:opacity-50 mt-4"
                  >
                    등록하기
                  </button>
                </form>
              </section>
            </div>

            <div className="lg:col-span-2">
              <section className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                <div className="p-6 border-b border-black/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h3 className="text-lg font-bold">등록된 사용자 목록</h3>
                    <p className="text-xs text-black/40 mt-1 font-bold">총 등록 인원: {users.length}명</p>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="relative flex-1 sm:flex-none">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-black/30" size={18} />
                      <input
                        type="text"
                        placeholder="사용자 검색..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="pl-10 pr-4 py-2 bg-black/5 rounded-xl text-sm focus:outline-none w-full sm:w-48"
                      />
                    </div>
                    <label className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-sm font-bold cursor-pointer hover:bg-emerald-100 transition-all">
                      <Upload size={16} />
                      일괄 등록
                      <input type="file" accept=".csv" className="hidden" onChange={handleBulkUpload} />
                    </label>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-black/[0.02] text-[10px] font-bold text-black/40 uppercase tracking-widest">
                        <th className="px-6 py-4 w-16">No.</th>
                        <th className="px-6 py-4">역할</th>
                        <th className="px-6 py-4">아이디</th>
                        <th className="px-6 py-4">이름</th>
                        <th className="px-6 py-4">비번 상태</th>
                        <th className="px-6 py-4 text-right">관리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {paginatedUsers.map((u, idx) => (
                        <tr key={u.id} className="hover:bg-black/[0.01] transition-colors">
                          <td className="px-6 py-4 text-xs font-mono text-black/30">
                            {(currentPage - 1) * pageSize + idx + 1}
                          </td>
                          <td className="px-6 py-4">
                            {u.role === 'student' ? (
                              <span className="flex items-center gap-1 text-blue-600 font-bold text-xs">
                                <GraduationCap size={14} /> 학생
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-purple-600 font-bold text-xs">
                                <ShieldCheck size={14} /> 교수
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm font-mono">{u.username}</td>
                          <td className="px-6 py-4 text-sm font-bold">{u.name}</td>
                          <td className="px-6 py-4">
                            {u.needs_password_change ? (
                              <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">초기 상태</span>
                            ) : (
                              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">변경 완료</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right space-x-2">
                            <button
                              onClick={() => handleResetPassword(u.id)}
                              className="p-2 text-black/30 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                              title="비밀번호 초기화"
                            >
                              <RotateCcw size={16} />
                            </button>
                            <button
                              onClick={() => handleDeleteUser(u.id)}
                              disabled={deletingId === u.id}
                              className={`p-2 rounded-lg transition-all ${deletingId === u.id ? 'text-black/10 bg-black/5 cursor-not-allowed' : 'text-black/30 hover:text-red-600 hover:bg-red-50'}`}
                              title="삭제"
                            >
                              {deletingId === u.id ? (
                                <div className="w-4 h-4 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
                              ) : (
                                <Trash2 size={16} />
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="p-6 border-t border-black/5 flex justify-center items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="p-2 rounded-lg hover:bg-black/5 disabled:opacity-20 transition-all"
                    >
                      <ChevronLeft size={20} />
                    </button>

                    <div className="flex gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${currentPage === page ? 'bg-black text-white' : 'hover:bg-black/5 text-black/40'}`}
                        >
                          {page}
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="p-2 rounded-lg hover:bg-black/5 disabled:opacity-20 transition-all"
                    >
                      <ChevronRight size={20} />
                    </button>
                  </div>
                )}
              </section>
            </div>
          </motion.div>
        ) : activeTab === 'ordering' ? (
          <motion.div
            key="ordering"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex items-center gap-3 flex-wrap">
                {rounds.some((r: any) => Number(r.is_open) === 1) && (
                  <div className="text-[11px] font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-700">
                    현재 진행 차수: {rounds.find((r: any) => Number(r.is_open) === 1)?.round_number}차
                  </div>
                )}

                <div className="flex gap-2 bg-black/5 p-1.5 rounded-2xl w-fit">
                  {[1, 2, 3].map(num => (
                    <button
                      key={num}
                      onClick={() => setSelectedRound(num)}
                      className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${selectedRound === num ? 'bg-white text-black shadow-sm' : 'text-black/40 hover:text-black'}`}
                    >
                      {num}차 심사
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex gap-1 bg-black/5 p-1 rounded-xl">
                  <button
                    onClick={() => handleToggleAllParticipation(true)}
                    className="px-3 py-1.5 text-[10px] font-bold bg-white text-emerald-600 rounded-lg shadow-sm hover:bg-emerald-50"
                  >
                    전체 참여
                  </button>
                  <button
                    onClick={() => handleToggleAllParticipation(false)}
                    className="px-3 py-1.5 text-[10px] font-bold bg-white text-red-600 rounded-lg shadow-sm hover:bg-red-50"
                  >
                    전체 제외
                  </button>
                </div>

                <div className="h-6 w-px bg-black/10" />

                <select
                  value={orderingMode}
                  onChange={(e) => {
                    const mode = e.target.value as 'id_asc' | 'id_desc' | 'manual';
                    setOrderingMode(mode);
                    if (mode === 'id_asc' || mode === 'id_desc') {
                      handleApplyAutoOrder(mode);
                    }
                  }}
                  className="px-4 py-2 bg-white border border-black/10 rounded-xl text-xs font-bold outline-none"
                >
                  <option value="id_asc">학번순 정렬</option>
                  <option value="id_desc">학번역순 정렬</option>
                  <option value="manual">관리자 수동 설정</option>
                </select>

                {orderingMode === 'manual' && (
                  <button
                    onClick={handleApplyManualOrders}
                    className="px-6 py-2 bg-black text-white rounded-xl text-xs font-bold hover:bg-black/80 transition-all"
                  >
                    순서 저장
                  </button>
                )}
              </div>
            </div>

            <section className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
              <div className="p-6 border-b border-black/5 flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <h3 className="text-lg font-bold">{selectedRound}차 발표 순서 설정</h3>
                  <span className="text-xs text-black/30 font-medium">
                    {Array.isArray(stats) ? stats.filter(s => s.is_participating).length : 0}명 참여 중
                  </span>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-black/30" size={18} />
                  <input
                    type="text"
                    placeholder="검색..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-10 pr-4 py-2 bg-black/5 rounded-xl text-sm focus:outline-none w-64"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-black/[0.02] text-[10px] font-bold text-black/40 uppercase tracking-widest">
                      <th className="px-6 py-4 w-24">발표 참여</th>
                      <th className="px-6 py-4 w-24">발표 순서</th>
                      <th className="px-6 py-4">학번</th>
                      <th className="px-6 py-4">이름</th>
                      <th className="px-6 py-4">제출 상태</th>
                      <th className="px-6 py-4">선정 텍스트 명</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5">
                    {(Array.isArray(stats) ? [...stats] : [])
                      .sort((a, b) => {
                        if (orderingMode === 'manual') return (manualOrders[String(a.user_id)] || 999) - (manualOrders[String(b.user_id)] || 999);
                        if (orderingMode === 'id_asc') return (a.student_id || '').localeCompare(b.student_id || '');
                        if (orderingMode === 'id_desc') return (b.student_id || '').localeCompare(a.student_id || '');
                        return (a.presentation_order || 999) - (b.presentation_order || 999);
                      })
                      .map((s) => (
                        <tr key={s.user_id} className={`hover:bg-black/[0.01] transition-colors ${s.is_participating ? 'bg-emerald-50/30' : ''}`}>
                          <td className="px-6 py-4">
                            <input
                              type="checkbox"
                              checked={!!s.is_participating}
                              onChange={(e) => handleUpdateOrder(s.id, s.user_id, s.presentation_order || 0, e.target.checked)}
                              className="w-5 h-5 rounded border-black/10 text-black focus:ring-black cursor-pointer"
                            />
                          </td>
                          <td className="px-6 py-4">
                            <input
                              type="number"
                              value={orderingMode === 'manual' ? (manualOrders[String(s.user_id)] || 0) : (s.presentation_order || 0)}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                if (orderingMode === 'manual') {
                                  handleManualOrderChange(s.user_id, val);
                                } else {
                                  handleUpdateOrder(s.id, s.user_id, val);
                                }
                              }}
                              className="w-16 px-2 py-1 bg-black/5 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-black/10"
                            />
                          </td>
                          <td className="px-6 py-4 text-sm font-mono">{s.student_id}</td>
                          <td className="px-6 py-4 text-sm font-bold">{s.name}</td>
                          <td className="px-6 py-4">
                            {s.is_submitted ? (
                              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">제출 완료</span>
                            ) : (
                              <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">미제출</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm">{s.title}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          </motion.div>
        ) : activeTab === 'rounds' ? (
          <motion.div
            key="rounds"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="max-w-3xl mx-auto space-y-6"
          >
            <section className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
              <h3 className="text-xl font-bold mb-6">심사 차수 활성화 설정</h3>
              <p className="text-sm text-black/50 mb-8">관리자가 활성화한 차수만 학생이 기획안을 제출하거나 수정할 수 있습니다.</p>

              <div className="space-y-4">
                {Array.isArray(rounds) && rounds.map(r => (
                  <div key={r.round_number} className="flex items-center justify-between p-6 bg-black/[0.02] rounded-2xl border border-black/5">
                    <div>
                      <h4 className="font-bold">{r.name}</h4>
                      <p className="text-xs text-black/40 mt-1">{r.round_number}차 심사 기간 설정</p>
                    </div>
                    <button
                      onClick={() => handleToggleRound(r.round_number, !r.is_open)}
                      className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${r.is_open ? 'bg-emerald-600 text-white' : 'bg-white border border-black/10 text-black/40'}`}
                    >
                      {r.is_open ? '활성화됨' : '비활성'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {confirmModal.isOpen && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
              className="fixed inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className="relative w-full max-w-md bg-white rounded-[32px] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.3)] overflow-hidden"
            >
              <div className="p-10 text-center">
                <div className={`w-16 h-16 mx-auto mb-6 rounded-2xl flex items-center justify-center ${confirmModal.isDanger ? 'bg-red-50 text-red-600' : 'bg-black/5 text-black'}`}>
                  {confirmModal.isDanger ? <Trash2 size={32} /> : <ShieldCheck size={32} />}
                </div>
                <h4 className="text-2xl font-bold mb-3">{confirmModal.title}</h4>
                <p className="text-black/50 text-sm leading-relaxed mb-10">
                  {confirmModal.message}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                    className="flex-1 px-6 py-4 bg-black/5 hover:bg-black/10 rounded-2xl font-bold transition-all text-black/60"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => {
                      const action = confirmModal.onConfirm;
                      setConfirmModal(prev => ({ ...prev, isOpen: false }));
                      setTimeout(() => action(), 100);
                    }}
                    className={`flex-1 px-6 py-4 rounded-2xl font-bold text-white transition-all shadow-lg ${confirmModal.isDanger ? 'bg-red-600 hover:bg-red-700 shadow-red-600/20' : 'bg-black hover:bg-black/90 shadow-black/20'}`}
                  >
                    확인
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
