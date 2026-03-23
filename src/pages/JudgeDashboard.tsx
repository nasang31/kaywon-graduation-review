import React, { useState, useEffect, useRef } from 'react';
import { User, Proposal, GRADE_SCORES } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronRight, Star, MessageSquare, ExternalLink,
  ArrowLeft, FileText, ShieldCheck, BarChart3, Key
} from 'lucide-react';

interface JudgeDashboardProps {
  user: User;
  forcedProposalId?: string | number | null;
  forcedRound?: number;
  entrySource?: 'admin' | 'judge-list';
  onBackToAdminStats?: () => void;
}

// ── 스피너 아이콘 ──────────────────────────────────────────────────
function SpinnerIcon() {
  return (
    <svg
      className="animate-spin"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

// ── 빈 평가 초기값 ────────────────────────────────────────────────
const EMPTY_EVALUATION = {
  text_grade: '',
  work1_grade: '',
  work2_grade: '',
  work3_grade: '',
  comment: ''
};

// ── 0점(미입력) 항목 분모 제외 점수 계산 ─────────────────────────
function calcJudgeScore(e: {
  text_grade?: string;
  work1_grade?: string;
  work2_grade?: string;
  work3_grade?: string;
}): number {
  const items = [
    GRADE_SCORES[e.text_grade as keyof typeof GRADE_SCORES],
    GRADE_SCORES[e.work1_grade as keyof typeof GRADE_SCORES],
    GRADE_SCORES[e.work2_grade as keyof typeof GRADE_SCORES],
    GRADE_SCORES[e.work3_grade as keyof typeof GRADE_SCORES],
  ];
  const valid = items.filter((s): s is number => typeof s === 'number' && s > 0);
  return valid.length === 0
    ? 0
    : valid.reduce((a, b) => a + b, 0) / valid.length;
}

function calcMyScore(s: any): number {
  return calcJudgeScore({
    text_grade: s.my_text_grade,
    work1_grade: s.my_work1_grade,
    work2_grade: s.my_work2_grade,
    work3_grade: s.my_work3_grade,
  });
}

// ── 전체 평가자 평균 ──────────────────────────────────────────────
function calculateAverage(evals: any[]): string {
  if (!evals || evals.length === 0) return '0.00';

  const judgeScores = evals
    .map(calcJudgeScore)
    .filter(score => score > 0);

  if (judgeScores.length === 0) return '0.00';

  return (
    judgeScores.reduce((sum, score) => sum + score, 0) / judgeScores.length
  ).toFixed(2);
}

// ── draft JSON → evaluation 안전 변환 ────────────────────────────
function parseDraft(raw: string): typeof EMPTY_EVALUATION | null {
  try {
    const p = JSON.parse(raw);
    return {
      text_grade: p.text_grade || '',
      work1_grade: p.work1_grade || '',
      work2_grade: p.work2_grade || '',
      work3_grade: p.work3_grade || '',
      comment: p.comment || ''
    };
  } catch {
    return null;
  }
}

// ── 사용자 아이콘 ──────────────────────────────────────────────────
function UserIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export default function JudgeDashboard({
  user,
  forcedProposalId,
  forcedRound,
  entrySource = 'judge-list',
  onBackToAdminStats
}: JudgeDashboardProps) {
  const [selectedRound, setSelectedRound] = useState(forcedRound || 1);
  const [students, setStudents] = useState<any[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [evaluation, setEvaluation] = useState(EMPTY_EVALUATION);
  const [isNavigating, setIsNavigating] = useState(false);
  const [navDirection, setNavDirection] = useState<'prev' | 'next' | null>(null);
  const [isSavingEvaluation, setIsSavingEvaluation] = useState(false);
  const [showRanking, setShowRanking] = useState(true);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [isEditing, setIsEditing] = useState(false);
  const [listScrollPos, setListScrollPos] = useState(0);
  const [lastSelectedId, setLastSelectedId] = useState<string | number | null>(null);
  
  const [rounds, setRounds] = useState<any[]>([]);
  const [previousProposal, setPreviousProposal] = useState<any | null>(null);
  const [showPreviousProposal, setShowPreviousProposal] = useState(true);
  const didSetInitialRound = useRef(false);

  const latestRequestId = useRef(0);
  const latestStudentsRequestId = useRef(0);

  useEffect(() => {
    if (forcedRound) {
      setSelectedRound(forcedRound);
    }
  }, [forcedRound]);

  const setWorkGrade = (num: 1 | 2 | 3, grade: string) => {
    setEvaluation(prev => ({
      ...prev,
      ...(num === 1 && { work1_grade: grade }),
      ...(num === 2 && { work2_grade: grade }),
      ...(num === 3 && { work3_grade: grade }),
    }));
  };

  useEffect(() => {
    if (!selectedProposal && lastSelectedId) {
      let frames = 0;
      let rafId = 0;
      let cancelled = false;

      const scroll = () => {
        if (cancelled) return;

        const el = document.getElementById(`student-card-${lastSelectedId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'center' });
        } else if (listScrollPos > 0) {
          window.scrollTo(0, listScrollPos);
        }

        frames++;
        if (frames < 10) {
          rafId = requestAnimationFrame(scroll);
        }
      };

      const t = setTimeout(() => {
        rafId = requestAnimationFrame(scroll);
      }, 50);

      return () => {
        cancelled = true;
        clearTimeout(t);
        cancelAnimationFrame(rafId);
      };
    }
  }, [selectedProposal, lastSelectedId, listScrollPos]);

  useEffect(() => {
    if (zoomImage) {
      const y = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.setAttribute('data-scroll-y', y.toString());
    } else {
      const y = document.body.getAttribute('data-scroll-y');
      document.body.style.overflow = '';
      if (y) {
        window.scrollTo(0, parseInt(y));
        document.body.removeAttribute('data-scroll-y');
      }
    }
    return () => {
      document.body.style.overflow = '';
      document.body.removeAttribute('data-scroll-y');
    };
  }, [zoomImage]);

  useEffect(() => {
    fetchRounds();
  }, []);

  useEffect(() => {
    setSelectedProposal(null);
    setPreviousProposal(null);
    fetchStudents();
  }, [selectedRound]);

  useEffect(() => {
    if (forcedProposalId) handleSelectStudent(forcedProposalId);
  }, [forcedProposalId]);

  useEffect(() => {
    if (selectedProposal && isEditing) {
      localStorage.setItem(
        `eval_draft_${user.id}_${selectedProposal.id}`,
        JSON.stringify(evaluation)
      );
    }
  }, [evaluation, selectedProposal, isEditing, user.id]);

  const fetchRounds = async () => {
    try {
      const res = await fetch('/api/admin/rounds');
      const data = await res.json();

      if (Array.isArray(data)) {
        setRounds(data);

        const activeRound = data.find((r: any) => Number(r.is_open) === 1);
        if (activeRound && !didSetInitialRound.current) {
          didSetInitialRound.current = true;
          
          if (!forcedRound) {
            setSelectedRound(activeRound.round_number);
          }
        }
      } else {
        setRounds([]);
      }
    } catch (err) {
      console.error('Failed to fetch rounds:', err);
      setRounds([]);
    }
  };

  const fetchStudents = async () => {
  const requestId = ++latestStudentsRequestId.current;

  try {
    const res = await fetch(`/api/students/${selectedRound}?judgeId=${user.id}`);
    const data = await res.json();

    if (requestId !== latestStudentsRequestId.current) return;

    setStudents(Array.isArray(data) ? data : []);
    setPreviousProposal(null);
  } catch (err) {
    if (requestId !== latestStudentsRequestId.current) return;

    console.error('Failed to fetch students:', err);
    setStudents([]);
    setPreviousProposal(null);
  }
};

  const fetchPreviousProposal = async (userId: number | string) => {
    if (selectedRound <= 1) {
      setPreviousProposal(null);
      return;
    }

    try {
      const res = await fetch(`/api/proposals/reference/${userId}/${selectedRound - 1}`);
      const data = await res.json();
      setPreviousProposal(data || null);
    } catch (err) {
      console.error('Failed to fetch previous proposal:', err);
      setPreviousProposal(null);
    }
  };

   const handleSelectStudent = async (
  id: string | number,
  direction: 'prev' | 'next' | null = null
) => {
    if (!selectedProposal) setListScrollPos(window.scrollY);
    setLastSelectedId(id);
    setNavDirection(direction);

    const requestId = ++latestRequestId.current;

    try {
      setIsNavigating(true);
      const res = await fetch(`/api/proposals/${id}?judgeId=${user.id}&role=${user.role}`);
      if (!res.ok) {
        alert('학생 정보를 불러오지 못했습니다.');
        return;
      }

      const data = await res.json();

      if (requestId !== latestRequestId.current) return;

      setSelectedProposal(data);
      await fetchPreviousProposal((data as any).user_id);

      const myEval = data.evaluations?.find((e: any) => e.judge_id === user.id);

      if (myEval) {
        setEvaluation({
          text_grade: myEval.text_grade || '',
          work1_grade: myEval.work1_grade || '',
          work2_grade: myEval.work2_grade || '',
          work3_grade: myEval.work3_grade || '',
          comment: myEval.comment || ''
        });
        setIsEditing(false);
      } else {
        const raw = localStorage.getItem(`eval_draft_${user.id}_${id}`);
        setEvaluation(
          raw
            ? (parseDraft(raw) ?? { ...EMPTY_EVALUATION })
            : { ...EMPTY_EVALUATION }
        );
        setIsEditing(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (requestId === latestRequestId.current) {
        setIsNavigating(false);
        setNavDirection(null);
      }
    }
  };

  const refreshCurrentProposal = async (proposalId: number | string) => {
    try {
      const res = await fetch(
        `/api/proposals/${proposalId}?judgeId=${user.id}&role=${user.role}`
      );
      if (!res.ok) return;

      const data = await res.json();
      setSelectedProposal(data);
      await fetchPreviousProposal((data as any).user_id);

      const myEval = data.evaluations?.find((e: any) => e.judge_id === user.id);

      if (myEval) {
        setEvaluation({
          text_grade: myEval.text_grade || '',
          work1_grade: myEval.work1_grade || '',
          work2_grade: myEval.work2_grade || '',
          work3_grade: myEval.work3_grade || '',
          comment: myEval.comment || '',
        });
        setIsEditing(false);
      } else {
        setEvaluation({ ...EMPTY_EVALUATION });
        setIsEditing(true);
      }
    } catch (err) {
      console.error('refreshCurrentProposal failed:', err);
    }
  };

  const handleSubmitEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveEvaluationToServer();
  };

  const saveEvaluationToServer = async () => {
    if (!selectedProposal) return;

    if (
      !evaluation.text_grade ||
      !evaluation.work1_grade ||
      !evaluation.work2_grade ||
      !evaluation.work3_grade
    ) {
      alert('모든 항목의 등급을 선택해주세요.');
      return;
    }

    setIsSavingEvaluation(true);
    try {
      const response = await fetch('/api/evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: selectedProposal.id,
          judgeId: user.id,
          ...evaluation
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        alert(errorData?.error || '심사 저장에 실패했습니다. 다시 시도해주세요.');
        return;
      }

      localStorage.removeItem(`eval_draft_${user.id}_${selectedProposal.id}`);
      setIsEditing(false);

      await Promise.all([
        fetchStudents(),
        refreshCurrentProposal(selectedProposal.id),
      ]);
    } catch (err) {
      console.error(err);
      alert('네트워크 오류가 발생했습니다.');
    } finally {
      setIsSavingEvaluation(false);
    }
  };

  const handleCancelEvaluation = async () => {
    if (!selectedProposal || !confirm('심사 내역을 삭제하시겠습니까?')) return;

    setIsSavingEvaluation(true);
    try {
      const res = await fetch(
        `/api/evaluations/${selectedProposal.id}/${user.id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        alert('심사 삭제에 실패했습니다. 다시 시도해주세요.');
        return;
      }

      alert('심사가 취소되었습니다.');
      localStorage.removeItem(`eval_draft_${user.id}_${selectedProposal.id}`);
      setEvaluation({ ...EMPTY_EVALUATION });

      await Promise.all([
        fetchStudents(),
        refreshCurrentProposal(selectedProposal.id),
      ]);
    } catch (err) {
      console.error(err);
      alert('네트워크 오류가 발생했습니다.');
    } finally {
      setIsSavingEvaluation(false);
    }
  };

  const handleAdminDeleteEvaluation = async (judgeEvaluation: any) => {
  if (!selectedProposal) return;

  const ok = window.confirm(
    `${selectedProposal.name} 학생의 ${selectedRound}차 심사에서\n` +
    `${judgeEvaluation.judge_name} 교수 평가를 삭제하시겠습니까?\n\n` +
    `삭제 후 복구할 수 없습니다.`
  );

  if (!ok) return;

  setIsSavingEvaluation(true);

  try {
    const res = await fetch(
      `/api/evaluations/${selectedProposal.id}/${judgeEvaluation.judge_id}`,
      { method: 'DELETE' }
    );

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      alert(data?.error || '평가 삭제에 실패했습니다.');
      return;
    }

    alert('해당 교수 평가가 삭제되었습니다.');

    await Promise.all([
      fetchStudents(),
      refreshCurrentProposal(selectedProposal.id),
    ]);
  } catch (err) {
    console.error(err);
    alert('네트워크 오류가 발생했습니다.');
  } finally {
    setIsSavingEvaluation(false);
  }
};

  const handleAdminResetProposal = async () => {
  if (!selectedProposal) return;

  const ok = window.confirm(
    `${selectedProposal.name} 학생의 ${selectedRound}차 제출안을 초기화하시겠습니까?\n\n` +
    `작품, 이미지, 교수 평가가 함께 삭제되며 복구할 수 없습니다.`
  );

  if (!ok) return;

  setIsSavingEvaluation(true);

  try {
    const res = await fetch(
      `/api/admin/proposals/${selectedProposal.id}/reset`,
      { method: 'DELETE' }
    );

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      alert(data?.error || '제출안 초기화에 실패했습니다.');
      return;
    }

   alert('해당 차수 제출안이 초기화되었습니다.');

await fetchStudents();
setPreviousProposal(null);

if (entrySource === 'admin' && onBackToAdminStats) {
  onBackToAdminStats();
} else {
  setSelectedProposal(null);
}
  } catch (err) {
    console.error(err);
    alert('네트워크 오류가 발생했습니다.');
  } finally {
    setIsSavingEvaluation(false);
  }
};

  const handleBackFromDetail = () => {
  if (entrySource === 'admin' && onBackToAdminStats) {
    onBackToAdminStats();
    return;
  }

  setSelectedProposal(null);
};
  
  const handlePasswordChange = async (e: React.FormEvent) => {
  e.preventDefault();

  if (passwords.new !== passwords.confirm) {
    alert('새 비밀번호가 일치하지 않습니다.');
    return;
  }

  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, newPassword: passwords.new }),
    });

    if (res.ok) {
      alert('비밀번호가 변경되었습니다.');
      setShowPasswordModal(false);
      setPasswords({ current: '', new: '', confirm: '' });
    } else {
      alert('비밀번호 변경에 실패했습니다.');
    }
  } catch (err) {
    alert('비밀번호 변경에 실패했습니다.');
  }
};
  
  if (selectedProposal) {
    const currentIndex = students.findIndex(s => s.id === selectedProposal.id);
    const prevStudent = currentIndex > 0 ? students[currentIndex - 1] : null;
    const nextStudent = currentIndex < students.length - 1 ? students[currentIndex + 1] : null;

    const isLocked = isNavigating || isSavingEvaluation;

    return (
      <div className="space-y-8 pb-20">
        <div className="flex justify-between items-center">
          <button
           onClick={handleBackFromDetail}
            className="flex items-center gap-2 text-black/50 hover:text-black transition-colors"
          >
            <ArrowLeft size={20} /> 목록으로 돌아가기
          </button>
          <div className="flex gap-2">
            {prevStudent && (
              <button
                onClick={() => handleSelectStudent(prevStudent.id, 'prev')}
                disabled={isLocked}
                className="px-4 py-2 bg-white border border-black/10 rounded-xl text-xs font-bold hover:bg-black/5 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isNavigating && navDirection === 'prev'
                  ? <><SpinnerIcon /> 이동 중...</>
                  : <><ArrowLeft size={14} /> 이전 학생</>
                }
              </button>
            )}
            {nextStudent && (
              <button
                onClick={() => handleSelectStudent(nextStudent.id, 'next')}
                disabled={isLocked}
                className="px-4 py-2 bg-white border border-black/10 rounded-xl text-xs font-bold hover:bg-black/5 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isNavigating && navDirection === 'next'
                  ? <><SpinnerIcon /> 이동 중...</>
                  : <>다음 학생 <ChevronRight size={14} /></>
                }
              </button>
            )}
          </div>
        </div>

        <div className="space-y-8">
          {!selectedProposal.is_submitted ? (
            <section className="bg-white p-12 rounded-3xl shadow-sm border border-black/5 flex flex-col items-center justify-center text-center space-y-6">
              <div className="w-20 h-20 bg-red-50 text-red-600 rounded-3xl flex items-center justify-center shadow-inner">
                <FileText size={40} />
              </div>
              <div>
                <h2 className="text-4xl font-black tracking-tight mb-4">{selectedProposal.name}</h2>
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm font-bold">
                  <span>학번: {selectedProposal.studentId || selectedProposal.student_id}</span>
                  <span className="w-px h-3 bg-black/20" />
                  <span>희망진로: {selectedProposal.careerPath || selectedProposal.career_path || '미입력'}</span>
                </div>
              </div>
              <div className="bg-red-50/50 px-6 py-3 rounded-2xl border border-red-100">
                <p className="text-red-600 text-sm font-bold">
                  ⚠️ 자료 미제출 상태입니다. 발표 내용을 바탕으로 심사를 진행해 주세요.
                </p>
              </div>
            </section>
          ) : (
            <section className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
               <div className="flex justify-between items-start mb-8 border-b border-black/5 pb-6 gap-4">
  <div>
    <h2 className="text-4xl font-black tracking-tight mb-4">{selectedProposal.name}</h2>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-bold">
      <span>학번: {selectedProposal.studentId || selectedProposal.student_id}</span>
      <span className="w-px h-3 bg-black/20" />
      <span>희망진로: {selectedProposal.careerPath || selectedProposal.career_path || '미입력'}</span>
    </div>
  </div>

  {user.role === 'admin' && (
    <button
      type="button"
      onClick={handleAdminResetProposal}
      disabled={isSavingEvaluation}
      className="px-4 py-2 bg-red-50 text-red-700 border border-red-100 rounded-xl text-xs font-bold hover:bg-red-100 transition-all disabled:opacity-50"
    >
      해당 차수 초기화
    </button>
  )}
</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div className="space-y-8">
                  {([
                    { label: '선정 텍스트 명', value: selectedProposal.title, multiline: false },
                    { label: '작가', value: selectedProposal.author, multiline: false },
                    { label: '장르', value: selectedProposal.genre, multiline: false },
                    { label: '줄거리', value: selectedProposal.plot, multiline: true },
                  ] as const).map(({ label, value, multiline }) => (
                    <div key={label}>
                      <h4 className="text-xs font-bold text-black/30 uppercase tracking-widest mb-3">{label}</h4>
                      <p className={`break-words ${multiline
                        ? 'text-base leading-relaxed whitespace-pre-wrap text-black/70'
                        : 'text-xl font-bold text-black/80'}`}>
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="space-y-8">
                  {([
                    { label: '주제', value: selectedProposal.subject },
                    { label: '선정이유', value: selectedProposal.reason },
                  ] as const).map(({ label, value }) => (
                    <div key={label}>
                      <h4 className="text-xs font-bold text-black/30 uppercase tracking-widest mb-3">{label}</h4>
                      <p className="text-base leading-relaxed whitespace-pre-wrap break-words text-black/70">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

{selectedRound > 1 && previousProposal && (
  <section className="bg-blue-50 border border-blue-100 rounded-3xl p-6">
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-lg font-bold text-blue-800">
        {selectedRound - 1}차 제출안 참고
      </h3>
      <button
        type="button"
        onClick={() => setShowPreviousProposal(v => !v)}
        className="px-3 py-1.5 bg-white border border-blue-100 rounded-xl text-xs font-bold hover:bg-blue-100 transition-all"
      >
        {showPreviousProposal ? '숨기기' : '보기'}
      </button>
    </div>

    {showPreviousProposal && (
      <div className="space-y-5 text-sm text-black/70">
        <div>
          <span className="font-bold">텍스트명:</span> {previousProposal.title || '-'}
        </div>
        <div>
          <span className="font-bold">작가명:</span> {previousProposal.author || '-'}
        </div>
        <div>
          <span className="font-bold">주제:</span> {previousProposal.subject || '-'}
        </div>

        {[1, 2, 3].map((num) => {
          const work = (previousProposal.works || []).find(
            (w: any) => Number(w.work_number ?? w.workNumber) === num
          );

          return (
            <div
              key={num}
              className="pt-2 border-t border-blue-100 first:border-t-0 first:pt-0"
            >
              <div className="font-bold text-blue-900 mb-2">
                작품{num}: {work?.title || '-'}
              </div>
              <div>
                <span className="font-bold">작업개요:</span> {work?.summary || '-'}
              </div>
            </div>
          );
        })}
      </div>
    )}
  </section>
)}

          {selectedProposal.is_submitted && (
            <div className="space-y-8">
              <h3 className="text-2xl font-bold px-4">작품별 상세 내용</h3>
              {selectedProposal.works?.map((work, idx) => {
                const keywords = (work.keywords ?? '')
                  .split(',')
                  .map((k: string) => k.trim())
                  .filter(Boolean);

                return (
                  <section key={idx} className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                    <div className="bg-black/[0.02] px-8 py-4 border-b border-black/5 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-black bg-black text-white px-2 py-1 rounded-md uppercase tracking-tighter">
                          작품{idx + 1}
                        </span>
                        <h3 className="text-lg font-bold text-black/80">{work.title}</h3>
                      </div>
                      <span className="px-3 py-1 bg-white border border-black/10 text-black/40 text-[10px] font-bold rounded-full uppercase tracking-widest">
                        {work.category}
                      </span>
                    </div>

                    <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-12">
                      <div className="space-y-6">
                        {([
                          { label: '작업개요', value: work.summary },
                          { label: '내용 및 목적', value: work.purpose },
                          { label: '기대효과', value: work.effect },
                        ] as const).map(({ label, value }) => (
                          <div key={label}>
                            <h4 className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-2">{label}</h4>
                            <p className="text-sm leading-relaxed text-black/80 whitespace-pre-wrap break-words">{value}</p>
                          </div>
                        ))}
                        <div>
                          <h4 className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-2">키워드</h4>
                          <div className="flex flex-wrap gap-2">
                            {keywords.length > 0 ? keywords.map((k: string, i: number) => (
                              <span key={i} className="px-3 py-1 bg-black/5 rounded-lg text-xs font-medium text-black/60 break-words">
                                #{k}
                              </span>
                            )) : (
                              <span className="text-xs text-black/20">키워드 없음</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h4 className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-2">제출 이미지</h4>
                        <div className="grid grid-cols-2 gap-4">
                          {work.images && work.images.length > 0 ? (
                            work.images.map((img: string, i: number) => (
                              <div
                                key={i}
                                className="group relative aspect-video rounded-2xl overflow-hidden border border-black/5 cursor-zoom-in shadow-sm"
                                onClick={() => { setZoomImage(img); setZoomScale(1); }}
                              >
                                <img
                                  src={img}
                                  alt={`${work.title} ${i}`}
                                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                  loading="lazy"
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                  <ExternalLink className="text-white opacity-0 group-hover:opacity-100 transition-opacity" size={24} />
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="col-span-2 aspect-video bg-black/5 rounded-2xl flex flex-col items-center justify-center text-black/20 gap-2">
                              <FileText size={32} />
                              <span className="text-xs font-medium">등록된 이미지가 없습니다</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              {user.role !== 'admin' ? (
                <section className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Star className="text-amber-400 fill-amber-400" size={20} />
                    심사 평가 등록
                  </h3>

                  <form onSubmit={handleSubmitEvaluation} className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className={!isEditing ? 'opacity-40' : ''}>
                        <label className="block text-xs font-bold text-black/40 uppercase mb-3">
                          텍스트 선정 등급
                        </label>
                        <div className="grid grid-cols-3 gap-1">
                          {Object.keys(GRADE_SCORES).map(g => (
                            <button
                              key={g}
                              type="button"
                              disabled={!isEditing}
                              onClick={() => setEvaluation(prev => ({ ...prev, text_grade: g }))}
                              className={`py-2 rounded-lg text-xs font-bold border transition-all
                                ${evaluation.text_grade === g
                                  ? 'bg-black text-white border-black'
                                  : 'bg-white text-black/40 border-black/10 hover:border-black/30'}
                                disabled:cursor-not-allowed`}
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                      </div>

                      {([1, 2, 3] as const).map(num => (
                        <div key={num} className={!isEditing ? 'opacity-40' : ''}>
                          <label className="block text-xs font-bold text-black/40 uppercase mb-3">
                            작품{num} 등급
                          </label>
                          <div className="grid grid-cols-3 gap-1">
                            {Object.keys(GRADE_SCORES).map(g => (
                              <button
                                key={g}
                                type="button"
                                disabled={!isEditing}
                                onClick={() => setWorkGrade(num, g)}
                                className={`py-2 rounded-lg text-xs font-bold border transition-all
                                  ${evaluation[`work${num}_grade` as keyof typeof evaluation] === g
                                    ? 'bg-black text-white border-black'
                                    : 'bg-white text-black/40 border-black/10 hover:border-black/30'}
                                  disabled:cursor-not-allowed`}
                              >
                                {g}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className={!isEditing ? 'opacity-40' : ''}>
                      <label className="block text-xs font-bold text-black/40 uppercase mb-2">종합 심사평</label>
                      <textarea
                        value={evaluation.comment}
                        disabled={!isEditing}
                        onChange={e => setEvaluation(prev => ({ ...prev, comment: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none min-h-[120px] text-sm disabled:cursor-not-allowed"
                        placeholder="학생에게 전달될 구체적인 피드백을 작성해주세요. (선택 사항)"
                      />
                    </div>

                    <div className="flex gap-3">
                      {!isEditing ? (
                        <div className="w-full flex gap-3">
                          <button
                            type="button"
                            onClick={() => setIsEditing(true)}
                            className="flex-1 bg-white text-black border border-black/10 py-4 rounded-xl font-bold hover:bg-black/5 transition-all flex items-center justify-center gap-2"
                          >
                            <FileText size={18} /> 심사 수정 시작하기
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEvaluation}
                            disabled={isLocked}
                            className="px-6 bg-red-50 text-red-500 border border-red-100 py-4 rounded-xl font-bold hover:bg-red-100 transition-all disabled:opacity-50"
                          >
                            삭제
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              const myEval = selectedProposal.evaluations?.find(
                                (e: any) => e.judge_id === user.id
                              );
                              if (myEval) {
                                setEvaluation({
                                  text_grade: myEval.text_grade || '',
                                  work1_grade: myEval.work1_grade || '',
                                  work2_grade: myEval.work2_grade || '',
                                  work3_grade: myEval.work3_grade || '',
                                  comment: myEval.comment || ''
                                });
                                setIsEditing(false);
                              } else {
                                setSelectedProposal(null);
                              }
                            }}
                            className="flex-1 bg-white text-black border border-black/10 py-4 rounded-xl font-bold hover:bg-black/5 transition-all"
                          >
                            취소
                          </button>
                          <button
                            type="submit"
                            disabled={isSavingEvaluation}
                            className="flex-[2] bg-black text-white py-4 rounded-xl font-bold hover:bg-black/90 transition-all disabled:opacity-50 shadow-lg shadow-black/10"
                          >
                            {isSavingEvaluation ? (
                              <span className="flex items-center justify-center gap-2">
                                <SpinnerIcon /> 저장 중...
                              </span>
                            ) : '심사 완료 및 저장'}
                          </button>
                        </>
                      )}
                    </div>
                  </form>
                </section>
              ) : (
                <div className="bg-black/5 p-12 rounded-3xl border border-dashed border-black/10 flex flex-col items-center justify-center text-black/30 gap-4">
                  <ShieldCheck size={48} />
                  <p className="font-bold">관리자 모드: 심사 결과 조회만 가능합니다.</p>
                </div>
              )}
            </div>

            <div className="lg:col-span-1 space-y-6">
              {user.role === 'admin' && (
                <section className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
                  <h3 className="text-lg font-bold mb-6 flex items-center justify-between">
                    전체 교수진 평가
                    <span className="text-xs bg-black text-white px-2 py-1 rounded-full">
                      평균 {calculateAverage(selectedProposal.evaluations || [])}점
                    </span>
                  </h3>
                  <div className="space-y-4">
                     {(selectedProposal.evaluations?.length ?? 0) > 0 ? (
  selectedProposal.evaluations.map((e: any, i: number) => (
    <div key={i} className="p-4 bg-black/[0.02] rounded-2xl border border-black/5">
      <div className="flex justify-between items-start mb-2 gap-3">
        <div>
          <span className="text-sm font-bold block">{e.judge_name}</span>
          <span className="text-xs font-bold text-amber-600">
            {calcJudgeScore(e).toFixed(1)}점
          </span>
        </div>

        <button
          type="button"
          onClick={() => handleAdminDeleteEvaluation(e)}
          disabled={isSavingEvaluation}
          className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-100 rounded-xl text-[11px] font-bold hover:bg-red-100 transition-all disabled:opacity-50"
        >
          이 평가만 삭제
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3 text-[10px] text-black/40">
        <span>텍스트: {e.text_grade}</span>
        <span>작품1: {e.work1_grade}</span>
        <span>작품2: {e.work2_grade}</span>
        <span>작품3: {e.work3_grade}</span>
      </div>

      <p className="text-xs text-black/60 italic leading-relaxed">
        "{e.comment || '의견 없음'}"
      </p>
    </div>
  ))
) : (
  <p className="text-center py-8 text-black/20 text-sm">
    아직 등록된 평가가 없습니다.
  </p>
)}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center pt-12 border-t border-black/5">
          <button
            onClick={handleBackFromDetail}
            className="flex items-center gap-2 text-black/50 hover:text-black transition-colors"
          >
            <ArrowLeft size={20} /> 목록으로 돌아가기
          </button>
          <div className="flex gap-2">
            {prevStudent && (
              <button
                onClick={() => handleSelectStudent(prevStudent.id, 'prev')}
                disabled={isLocked}
                className="px-4 py-2 bg-white border border-black/10 rounded-xl text-xs font-bold hover:bg-black/5 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isNavigating && navDirection === 'prev'
                  ? <><SpinnerIcon /> 이동 중...</>
                  : <><ArrowLeft size={14} /> 이전 학생</>
                }
              </button>
            )}
            {nextStudent && (
              <button
                onClick={() => handleSelectStudent(nextStudent.id, 'next')}
                disabled={isLocked}
                className="px-4 py-2 bg-black text-white rounded-xl text-xs font-bold hover:bg-black/90 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isNavigating && navDirection === 'next'
                  ? <><SpinnerIcon /> 이동 중...</>
                  : <>다음 학생 <ChevronRight size={14} /></>
                }
              </button>
            )}
          </div>
        </div>

        <AnimatePresence>
          {zoomImage && (
            <div
              className="fixed inset-0 bg-black/95 z-[100] flex flex-col items-center justify-center p-4 overflow-hidden"
              onWheel={e => {
                const delta = e.deltaY > 0 ? -0.2 : 0.2;
                setZoomScale(prev => Math.min(5, Math.max(0.5, prev + delta)));
              }}
            >
              <div className="absolute top-8 right-8 flex gap-4 z-[110]">
                <div className="flex bg-white/10 backdrop-blur-md rounded-xl p-1 border border-white/10">
                  <button
                    onClick={e => { e.stopPropagation(); setZoomScale(prev => Math.max(0.5, prev - 0.25)); }}
                    className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/10 rounded-lg transition-colors"
                  >
                    -
                  </button>
                  <div className="w-16 flex items-center justify-center text-white text-xs font-bold">
                    {Math.round(zoomScale * 100)}%
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); setZoomScale(prev => Math.min(5, prev + 0.25)); }}
                    className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/10 rounded-lg transition-colors"
                  >
                    +
                  </button>
                </div>
                <button
                  className="px-6 py-2 bg-white text-black rounded-xl font-bold hover:bg-white/90 transition-all"
                  onClick={() => { setZoomImage(null); setZoomScale(1); }}
                >
                  닫기
                </button>
              </div>

              <div className="w-full h-full flex items-center justify-center overflow-hidden">
                <motion.img
                  key={zoomImage}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: zoomScale }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 50 }}
                  drag
                  dragMomentum={false}
                  dragElastic={0}
                  dragTransition={{ power: 0, timeConstant: 0 }}
                  src={zoomImage}
                  alt="Zoomed"
                  className="max-w-none shadow-2xl rounded-sm select-none cursor-grab active:cursor-grabbing"
                  style={{
                    transformOrigin: 'center center',
                    width: 'auto',
                    height: 'auto',
                    maxWidth: '90%',
                    maxHeight: '90%'
                  }}
                />
              </div>
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/40 text-xs font-medium bg-black/20 backdrop-blur-sm px-4 py-2 rounded-full">
                마우스 휠로 확대/축소, 드래그하여 이동
              </div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">학생 기획안 심사</h2>
          <p className="text-black/50 mt-1">학생들의 기획안을 검토하고 점수를 부여하세요.</p>
        </div>
        <div className="flex items-center gap-4 flex-wrap justify-end">
          <button
  onClick={() => setShowPasswordModal(true)}
  className="flex items-center gap-2 px-4 py-2 bg-white border border-black/10 rounded-xl text-xs font-bold hover:bg-black/5 transition-all"
>
  <Key size={14} /> 비밀번호 변경
</button>
          {rounds.some((r: any) => Number(r.is_open) === 1) && (
            <div className="text-[11px] font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-700">
              현재 진행 차수: {rounds.find((r: any) => Number(r.is_open) === 1)?.round_number}차
            </div>
          )}

          <button
            onClick={() => setShowRanking(!showRanking)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border
              ${showRanking
                ? 'bg-black text-white border-black'
                : 'bg-white text-black/40 border-black/10 hover:border-black/30'}`}
          >
            {showRanking ? '순위 숨기기' : '내 순위 보기'}
          </button>

          <div className="flex gap-2 bg-black/5 p-1 rounded-xl">
            {[1, 2, 3].map(num => (
              <button
                key={num}
                onClick={() => setSelectedRound(num)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all
                  ${selectedRound === num ? 'bg-white text-black shadow-sm' : 'text-black/40 hover:text-black'}`}
              >
                {num}차 심사
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className={`flex-1 grid grid-cols-1 md:grid-cols-2 ${showRanking ? 'lg:grid-cols-2' : 'lg:grid-cols-3'} gap-6`}>
          {students.map(student => {
            const myScore = calcMyScore(student);
            const isMyEvaluationCompleted =
              student.my_is_final === true ||
              student.my_is_final === 1 ||
              student.my_is_final === '1';

            return (
              <motion.div
                key={student.id}
                id={`student-card-${student.id}`}
                whileHover={{ y: -4 }}
                className="bg-white p-6 rounded-3xl shadow-sm border border-black/5 flex flex-col justify-between group cursor-pointer"
                onClick={() => handleSelectStudent(student.id)}
              >
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-12 h-12 bg-black/5 rounded-2xl flex items-center justify-center text-black/20">
                      <UserIcon size={24} />
                    </div>
                    <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest
                      ${isMyEvaluationCompleted ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {isMyEvaluationCompleted ? '심사 완료' : '심사 대기'}
                    </div>
                  </div>
                  <h3 className="text-xl font-bold mb-1 line-clamp-1">{student.title}</h3>
                  <p className="text-sm text-black/50 mb-4">{student.student_name} ({student.student_id})</p>
                  <div className="flex items-center gap-4 text-xs text-black/40">
                    <span className="flex items-center gap-1">
                      <MessageSquare size={14} /> {student.total_eval_count} 의견
                    </span>
                    {isMyEvaluationCompleted && (
                      <span className="text-emerald-600 font-bold">
                        내 점수: {myScore.toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-6 pt-4 border-t border-black/5 flex justify-between items-center">
                  <span className="text-xs font-medium text-black/30">기획안 상세보기</span>
                  <ChevronRight size={18} className="text-black/20 group-hover:text-black group-hover:translate-x-1 transition-all" />
                </div>
              </motion.div>
            );
          })}
        </div>

        {showRanking && (
          <aside className="w-full lg:w-80 space-y-6">
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-black/5 sticky top-24">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <BarChart3 size={20} className="text-blue-600" /> 내 평가 순위
              </h3>
              <p className="text-[10px] text-black/40 mb-6 font-medium leading-relaxed">
                본인이 부여한 점수만을 기준으로 산출된 실시간 순위입니다.
                (다른 교수님의 점수는 반영되지 않습니다.)
              </p>
              <div className="space-y-3">
                {students
                  .filter(s =>
                    s.my_is_final === true ||
                    s.my_is_final === 1 ||
                    s.my_is_final === '1'
                  )
                  .map(s => ({ ...s, myScore: calcMyScore(s) }))
                  .sort((a, b) => b.myScore - a.myScore)
                  .map((student, idx) => (
                    <div
                      key={student.id}
                      onClick={() => handleSelectStudent(student.id)}
                      className="flex items-center gap-3 p-3 rounded-2xl hover:bg-black/5 transition-all cursor-pointer group"
                    >
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold
                        ${idx === 0 ? 'bg-amber-400 text-white'
                          : idx === 1 ? 'bg-slate-300 text-white'
                          : idx === 2 ? 'bg-orange-300 text-white'
                          : 'bg-black/5 text-black/40'}`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-black group-hover:text-blue-600 transition-colors truncate">
                          {student.student_name}
                        </div>
                        <div className="text-[10px] text-black/40 truncate">{student.title}</div>
                      </div>
                      <div className="text-xs font-bold text-black/80">{student.myScore.toFixed(1)}</div>
                    </div>
                  ))}

                {students.filter(s =>
                  s.my_is_final === true ||
                  s.my_is_final === 1 ||
                  s.my_is_final === '1'
                ).length === 0 && (
                  <div className="text-center py-12 text-black/20">
                    <p className="text-xs font-medium">아직 평가한 학생이 없습니다.</p>
                  </div>
                )}
              </div>
            </section>
          </aside>
        )}
      </div>

            <AnimatePresence>
        {showPasswordModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl"
            >
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                <Key size={20} /> 비밀번호 변경
              </h3>

              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-black/40 uppercase mb-2">
                    새 비밀번호
                  </label>
                  <input
                    type="password"
                    value={passwords.new || ''}
                    onChange={e => setPasswords({ ...passwords, new: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-black/40 uppercase mb-2">
                    새 비밀번호 확인
                  </label>
                  <input
                    type="password"
                    value={passwords.confirm || ''}
                    onChange={e => setPasswords({ ...passwords, confirm: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none"
                    required
                  />
                </div>

                <div className="flex gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowPasswordModal(false)}
                    className="flex-1 py-3 rounded-xl font-bold border border-black/10 hover:bg-black/5 transition-all"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-black text-white py-3 rounded-xl font-bold hover:bg-black/90 transition-all"
                  >
                    변경하기
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      {students.length === 0 && (
        <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-black/10">
          <p className="text-black/30">아직 제출된 기획안이 없습니다.</p>
        </div>
      )}
    </div>
  );
}
