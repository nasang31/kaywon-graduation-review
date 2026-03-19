import React, { useState, useEffect } from 'react';
import { User, Proposal, Evaluation, GRADE_SCORES } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, Star, MessageSquare, ExternalLink, ArrowLeft, FileText, Save, ShieldCheck, BarChart3 } from 'lucide-react';

interface JudgeDashboardProps {
  user: User;
  forcedProposalId?: number | null;
}

export default function JudgeDashboard({ user, forcedProposalId }: JudgeDashboardProps) {
  const [selectedRound, setSelectedRound] = useState(1);
  const [students, setStudents] = useState<any[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomPos, setZoomPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [evaluation, setEvaluation] = useState({ 
    text_grade: '',
    work1_grade: '', 
    work2_grade: '', 
    work3_grade: '', 
    comment: '' 
  });
  const [loading, setLoading] = useState(false);
  const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);
  const [showRanking, setShowRanking] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [listScrollPos, setListScrollPos] = useState(0);
  const [lastSelectedId, setLastSelectedId] = useState<number | null>(null);

  // Restore scroll position when returning to list
  useEffect(() => {
    if (!selectedProposal && lastSelectedId) {
      // Use multiple frames to ensure the list is fully rendered and height is stable
      let frames = 0;
      const scroll = () => {
        const element = document.getElementById(`student-card-${lastSelectedId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'auto', block: 'center' });
          // Also try window.scrollTo as a fallback if element is not yet in correct position
          if (listScrollPos > 0 && frames === 0) {
            window.scrollTo(0, listScrollPos);
          }
        } else if (listScrollPos > 0) {
          window.scrollTo(0, listScrollPos);
        }
        
        frames++;
        if (frames < 10) {
          requestAnimationFrame(scroll);
        }
      };
      // Small delay to let the list mount
      const timeout = setTimeout(() => {
        requestAnimationFrame(scroll);
      }, 50);
      return () => clearTimeout(timeout);
    }
  }, [selectedProposal, lastSelectedId]);

  // Lock body scroll when image is zoomed
  useEffect(() => {
    if (zoomImage) {
      const scrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.setAttribute('data-scroll-y', scrollY.toString());
    } else {
      const scrollY = document.body.getAttribute('data-scroll-y');
      document.body.style.overflow = '';
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY));
        document.body.removeAttribute('data-scroll-y');
      }
    }
    return () => {
      document.body.style.overflow = '';
      document.body.removeAttribute('data-scroll-y');
    };
  }, [zoomImage]);

  useEffect(() => {
    fetchStudents();
  }, [selectedRound]);

  // Load draft from localStorage
  useEffect(() => {
    if (selectedProposal) {
      const savedDraft = localStorage.getItem(`eval_draft_${user.id}_${selectedProposal.id}`);
      if (savedDraft) {
        try {
          setEvaluation(prev => ({ ...prev, ...JSON.parse(savedDraft) }));
        } catch (e) {
          console.error('Failed to parse eval draft', e);
        }
      }
    }
  }, [selectedProposal]);

  // Auto-save draft to localStorage
  useEffect(() => {
    if (selectedProposal) {
      localStorage.setItem(`eval_draft_${user.id}_${selectedProposal.id}`, JSON.stringify(evaluation));
    }
  }, [evaluation, selectedProposal]);

  // Periodic auto-save to server (every 1 minute)

  useEffect(() => {
    if (forcedProposalId) {
      handleSelectStudent(forcedProposalId);
    }
  }, [forcedProposalId]);

  const fetchStudents = async () => {
    try {
      const res = await fetch(`/api/students/${selectedRound}?judgeId=${user.id}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setStudents(data);
      } else {
        console.error('Students data is not an array:', data);
        setStudents([]);
      }
    } catch (err) {
      console.error('Failed to fetch students:', err);
      setStudents([]);
    }
  };

  const calculateAverage = (evals: any[]) => {
    if (!evals || evals.length === 0) return 0;
    const total = evals.reduce((acc, e) => {
      const st = GRADE_SCORES[e.text_grade as keyof typeof GRADE_SCORES] || 0;
      const s1 = GRADE_SCORES[e.work1_grade as keyof typeof GRADE_SCORES] || 0;
      const s2 = GRADE_SCORES[e.work2_grade as keyof typeof GRADE_SCORES] || 0;
      const s3 = GRADE_SCORES[e.work3_grade as keyof typeof GRADE_SCORES] || 0;
      return acc + (st + s1 + s2 + s3) / 4;
    }, 0);
    return (total / evals.length).toFixed(2);
  };

  const handleSelectStudent = async (id: number) => {
    // Save current scroll position before switching to detail view
    if (!selectedProposal) {
      setListScrollPos(window.scrollY);
    }
    setLastSelectedId(id);
    
    setLoading(true);
    try {
      const res = await fetch(`/api/proposals/${id}?judgeId=${user.id}&role=${user.role}`);
      const data = await res.json();
      setSelectedProposal(data);
      
      // Check if current judge already evaluated
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
        setEvaluation({ text_grade: '', work1_grade: '', work2_grade: '', work3_grade: '', comment: '' });
        setIsEditing(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveEvaluationToServer(false);
  };

  const saveEvaluationToServer = async (isAutoSave: boolean = false) => {
    if (!selectedProposal) return;
    
    if (!isAutoSave) {
      if (!evaluation.text_grade || !evaluation.work1_grade || !evaluation.work2_grade || !evaluation.work3_grade) {
        alert('모든 항목의 등급을 선택해주세요.');
        return;
      }
      setLoading(true);
    }

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

      if (response.ok) {
        if (!isAutoSave) {
          localStorage.removeItem(`eval_draft_${user.id}_${selectedProposal.id}`);
          setIsEditing(false);
          fetchStudents();
          handleSelectStudent(selectedProposal.id); // Refresh current view
        } else {
          setLastAutoSave(new Date());
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelEvaluation = async () => {
    if (!selectedProposal || !confirm('심사 내역을 삭제하시겠습니까?')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/evaluations/${selectedProposal.id}/${user.id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        alert('심사가 취소되었습니다.');
        // Reset local evaluation state
        setEvaluation({ text_grade: '', work1_grade: '', work2_grade: '', work3_grade: '', comment: '' });
        await fetchStudents();
        await handleSelectStudent(selectedProposal.id); // Refresh current view
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (selectedProposal) {
    const myEval = selectedProposal.evaluations?.find((e: any) => e.judge_id === user.id);
    const currentIndex = students.findIndex(s => s.id === selectedProposal.id);
    const prevStudent = currentIndex > 0 ? students[currentIndex - 1] : null;
    const nextStudent = currentIndex < students.length - 1 ? students[currentIndex + 1] : null;

    return (
      <div className="space-y-8 pb-20">
        <div className="flex justify-between items-center">
          <button 
            onClick={() => setSelectedProposal(null)}
            className="flex items-center gap-2 text-black/50 hover:text-black transition-colors"
          >
            <ArrowLeft size={20} />
            목록으로 돌아가기
          </button>
          
          <div className="flex gap-2">
            {prevStudent && (
              <button 
                onClick={() => handleSelectStudent(prevStudent.id)}
                className="px-4 py-2 bg-white border border-black/10 rounded-xl text-xs font-bold hover:bg-black/5 transition-all flex items-center gap-2"
              >
                <ArrowLeft size={14} /> 이전 학생
              </button>
            )}
            {nextStudent && (
              <button 
                onClick={() => handleSelectStudent(nextStudent.id)}
                className="px-4 py-2 bg-black text-white rounded-xl text-xs font-bold hover:bg-black/90 transition-all flex items-center gap-2"
              >
                다음 학생 <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="space-y-8">
          {/* Student Proposal Content */}
          {!selectedProposal.is_submitted ? (
            <section className="bg-white p-12 rounded-3xl shadow-sm border border-black/5 flex flex-col items-center justify-center text-center space-y-6">
              <div className="w-20 h-20 bg-red-50 text-red-600 rounded-3xl flex items-center justify-center shadow-inner">
                <FileText size={40} />
              </div>
              <div>
                <h2 className="text-4xl font-black tracking-tight mb-4 text-[#000000]">{selectedProposal.name}</h2>
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-[#000000] font-bold">
                  <span>학번: {selectedProposal.studentId || selectedProposal.student_id}</span>
                  <span className="w-px h-3 bg-black/20"></span>
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
              <div className="flex justify-between items-start mb-8 border-b border-black/5 pb-6">
                <div>
                  <h2 className="text-4xl font-black tracking-tight mb-4 text-[#000000]">{selectedProposal.name}</h2>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#000000] font-bold">
                    <span>학번: {selectedProposal.studentId || selectedProposal.student_id}</span>
                    <span className="w-px h-3 bg-black/20"></span>
                    <span>희망진로: {selectedProposal.careerPath || selectedProposal.career_path || '미입력'}</span>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div className="space-y-8">
                  <div>
                    <h4 className="text-xs font-bold text-black/30 uppercase tracking-widest mb-3">선정 텍스트 명</h4>
                    <p className="text-xl font-bold text-black/80 break-words">{selectedProposal.title}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-black/30 uppercase tracking-widest mb-3">작가</h4>
                    <p className="text-xl font-bold text-black/80 break-words">{selectedProposal.author}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-black/30 uppercase tracking-widest mb-3">장르</h4>
                    <p className="text-xl font-bold text-black/80 break-words">{selectedProposal.genre}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-black/30 uppercase tracking-widest mb-3">줄거리</h4>
                    <p className="text-base leading-relaxed whitespace-pre-wrap break-words text-black/70">{selectedProposal.plot}</p>
                  </div>
                </div>
                <div className="space-y-8">
                  <div>
                    <h4 className="text-xs font-bold text-black/30 uppercase tracking-widest mb-3">주제</h4>
                    <p className="text-base leading-relaxed whitespace-pre-wrap break-words text-black/70">{selectedProposal.subject}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-black/30 uppercase tracking-widest mb-3">선정이유</h4>
                    <p className="text-base leading-relaxed whitespace-pre-wrap break-words text-black/70">{selectedProposal.reason}</p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {selectedProposal.is_submitted && (
            <div className="space-y-8">
              <h3 className="text-2xl font-bold px-4">작품별 상세 내용</h3>
              {selectedProposal.works?.map((work, idx) => (
              <section key={idx} className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                <div className="bg-black/[0.02] px-8 py-4 border-b border-black/5 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black bg-black text-white px-2 py-1 rounded-md uppercase tracking-tighter">작품{idx + 1}</span>
                    <h3 className="text-lg font-bold text-black/80">{work.title}</h3>
                  </div>
                  <span className="px-3 py-1 bg-white border border-black/10 text-black/40 text-[10px] font-bold rounded-full uppercase tracking-widest">{work.category}</span>
                </div>
                
                <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-12">
                  <div className="space-y-6">
                    <div>
                      <h4 className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-2">작업개요</h4>
                      <p className="text-sm leading-relaxed text-black/80 whitespace-pre-wrap break-words">{work.summary}</p>
                    </div>
                    <div>
                      <h4 className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-2">키워드</h4>
                      <div className="flex flex-wrap gap-2">
                        {work.keywords.split(',').map((k, i) => (
                          <span key={i} className="px-3 py-1 bg-black/5 rounded-lg text-xs font-medium text-black/60 break-words">#{k.trim()}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-2">내용 및 목적</h4>
                      <p className="text-sm leading-relaxed text-black/80 whitespace-pre-wrap break-words">{work.purpose}</p>
                    </div>
                    <div>
                      <h4 className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-2">기대효과</h4>
                      <p className="text-sm leading-relaxed text-black/80 whitespace-pre-wrap break-words">{work.effect}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-2">제출 이미지</h4>
                    <div className="grid grid-cols-2 gap-4">
                      {work.images && work.images.length > 0 ? (
                        work.images.map((img, i) => (
                          <div 
                            key={i} 
                            className="group relative aspect-video rounded-2xl overflow-hidden border border-black/5 cursor-zoom-in shadow-sm"
                            onClick={() => { setZoomImage(img); setZoomScale(1); }}
                          >
                            <img src={img} alt={`${work.title} ${i}`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy" />
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
            ))}
          </div>
        )}

          {/* Grading Form at the Bottom */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              {user.role !== 'admin' ? (
                <section className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
                  <h3 className="text-xl font-bold mb-6 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Star className="text-amber-400 fill-amber-400" size={20} />
                      심사 평가 등록
                    </div>
                    {lastAutoSave && (
                      <span className="text-[10px] font-bold text-black/20 flex items-center gap-1">
                        <Save size={10} /> {lastAutoSave.toLocaleTimeString()} 자동 저장됨
                      </span>
                    )}
                  </h3>
                  
                  <form onSubmit={handleSubmitEvaluation} className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className={!isEditing ? 'opacity-40' : ''}>
                        <label className="block text-xs font-bold text-black/40 uppercase mb-3">텍스트 선정 등급</label>
                        <div className="grid grid-cols-3 gap-1">
                          {Object.keys(GRADE_SCORES).map(g => (
                            <button
                              key={g}
                              type="button"
                              disabled={!isEditing}
                              onClick={() => setEvaluation({...evaluation, text_grade: g})}
                              className={`py-2 rounded-lg text-xs font-bold border transition-all ${evaluation.text_grade === g ? 'bg-black text-white border-black' : 'bg-white text-black/40 border-black/10 hover:border-black/30'} disabled:cursor-not-allowed`}
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                      </div>
                      {[1, 2, 3].map(num => (
                        <div key={num} className={!isEditing ? 'opacity-40' : ''}>
                          <label className="block text-xs font-bold text-black/40 uppercase mb-3">작품{num} 등급</label>
                          <div className="grid grid-cols-3 gap-1">
                            {Object.keys(GRADE_SCORES).map(g => (
                              <button
                                key={g}
                                type="button"
                                disabled={!isEditing}
                                onClick={() => setEvaluation({...evaluation, [`work${num}_grade` as any]: g})}
                                className={`py-2 rounded-lg text-xs font-bold border transition-all ${evaluation[`work${num}_grade` as keyof typeof evaluation] === g ? 'bg-black text-white border-black' : 'bg-white text-black/40 border-black/10 hover:border-black/30'} disabled:cursor-not-allowed`}
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
                        onChange={e => setEvaluation({...evaluation, comment: e.target.value})}
                        className="w-full px-4 py-3 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none min-h-[120px] text-sm disabled:cursor-not-allowed"
                        placeholder="학생에게 전달될 구체적인 피드백을 작성해주세요. (선택 사항)"
                      />
                    </div>
                    <div className="flex gap-3">
                      {!isEditing ? (
                        <button
                          type="button"
                          onClick={() => setIsEditing(true)}
                          className="w-full bg-white text-black border border-black/10 py-4 rounded-xl font-bold hover:bg-black/5 transition-all shadow-sm flex items-center justify-center gap-2"
                        >
                          <FileText size={18} />
                          심사 수정 시작하기
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setIsEditing(false);
                              // Re-load original evaluation
                              const myEval = selectedProposal.evaluations?.find((e: any) => e.judge_id === user.id);
                              if (myEval) {
                                setEvaluation({ 
                                  text_grade: myEval.text_grade || '',
                                  work1_grade: myEval.work1_grade || '', 
                                  work2_grade: myEval.work2_grade || '', 
                                  work3_grade: myEval.work3_grade || '', 
                                  comment: myEval.comment || '' 
                                });
                              }
                            }}
                            className="flex-1 bg-white text-black border border-black/10 py-4 rounded-xl font-bold hover:bg-black/5 transition-all"
                          >
                            취소
                          </button>
                          <button
                            type="submit"
                            disabled={loading}
                            className="flex-[2] bg-black text-white py-4 rounded-xl font-bold hover:bg-black/90 transition-all disabled:opacity-50 shadow-lg shadow-black/10"
                          >
                            {loading ? '저장 중...' : '심사 완료 및 저장'}
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
                    {selectedProposal.evaluations && selectedProposal.evaluations.length > 0 ? (
                      selectedProposal.evaluations.map((e: any, i: number) => {
                        const st = GRADE_SCORES[e.text_grade as keyof typeof GRADE_SCORES] || 0;
                        const s1 = GRADE_SCORES[e.work1_grade as keyof typeof GRADE_SCORES] || 0;
                        const s2 = GRADE_SCORES[e.work2_grade as keyof typeof GRADE_SCORES] || 0;
                        const s3 = GRADE_SCORES[e.work3_grade as keyof typeof GRADE_SCORES] || 0;
                        const total = (st + s1 + s2 + s3) / 4;
                        
                        return (
                          <div key={i} className="p-4 bg-black/[0.02] rounded-2xl border border-black/5">
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-sm font-bold">{e.judge_name}</span>
                              <span className="text-xs font-bold text-amber-600">{total.toFixed(1)}점</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-3 text-[10px] text-black/40">
                              <span>텍스트: {e.text_grade}</span>
                              <span>작품1: {e.work1_grade}</span>
                              <span>작품2: {e.work2_grade}</span>
                              <span>작품3: {e.work3_grade}</span>
                            </div>
                            <p className="text-xs text-black/60 italic leading-relaxed">"{e.comment || '의견 없음'}"</p>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-center py-8 text-black/20 text-sm">아직 등록된 평가가 없습니다.</p>
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center pt-12 border-t border-black/5">
          <button 
            onClick={() => setSelectedProposal(null)}
            className="flex items-center gap-2 text-black/50 hover:text-black transition-colors"
          >
            <ArrowLeft size={20} />
            목록으로 돌아가기
          </button>
          
          <div className="flex gap-2">
            {prevStudent && (
              <button 
                onClick={() => handleSelectStudent(prevStudent.id)}
                className="px-4 py-2 bg-white border border-black/10 rounded-xl text-xs font-bold hover:bg-black/5 transition-all flex items-center gap-2"
              >
                <ArrowLeft size={14} /> 이전 학생
              </button>
            )}
            {nextStudent && (
              <button 
                onClick={() => handleSelectStudent(nextStudent.id)}
                className="px-4 py-2 bg-black text-white rounded-xl text-xs font-bold hover:bg-black/90 transition-all flex items-center gap-2"
              >
                다음 학생 <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Zoom Modal */}
        <AnimatePresence>
          {zoomImage && (
            <div 
              className="fixed inset-0 bg-black/95 z-[100] flex flex-col items-center justify-center p-4 overflow-hidden"
              onWheel={(e) => {
                const delta = e.deltaY > 0 ? -0.2 : 0.2;
                setZoomScale(prev => Math.min(5, Math.max(0.5, prev + delta)));
              }}
            >
              <div className="absolute top-8 right-8 flex gap-4 z-[110]">
                <div className="flex bg-white/10 backdrop-blur-md rounded-xl p-1 border border-white/10">
                  <button 
                    onClick={(e) => { e.stopPropagation(); setZoomScale(prev => Math.max(0.5, prev - 0.25)); }}
                    className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/10 rounded-lg transition-colors"
                  >
                    -
                  </button>
                  <div className="w-16 flex items-center justify-center text-white text-xs font-bold">
                    {Math.round(zoomScale * 100)}%
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setZoomScale(prev => Math.min(5, prev + 0.25)); }}
                    className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/10 rounded-lg transition-colors"
                  >
                    +
                  </button>
                </div>
                <button 
                  className="px-6 py-2 bg-white text-black rounded-xl font-bold hover:bg-white/90 transition-all"
                  onClick={() => { setZoomImage(null); setZoomScale(1); setZoomPos({ x: 0, y: 0 }); }}
                >
                  닫기
                </button>
              </div>
              
              <div 
                className="w-full h-full flex items-center justify-center overflow-hidden"
              >
                <motion.img 
                  key={zoomImage}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ 
                    opacity: 1, 
                    scale: zoomScale,
                  }}
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
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowRanking(!showRanking)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${showRanking ? 'bg-black text-white border-black' : 'bg-white text-black/40 border-black/10 hover:border-black/30'}`}
          >
            {showRanking ? '순위 숨기기' : '내 순위 보기'}
          </button>
          <div className="flex gap-2 bg-black/5 p-1 rounded-xl">
            {[1, 2, 3].map(num => (
              <button
                key={num}
                onClick={() => setSelectedRound(num)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedRound === num ? 'bg-white text-black shadow-sm' : 'text-black/40 hover:text-black'}`}
              >
                {num}차 심사
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className={`flex-1 grid grid-cols-1 md:grid-cols-2 ${showRanking ? 'lg:grid-cols-2' : 'lg:grid-cols-3'} gap-6`}>
          {students.map((student) => (
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
                  <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${student.my_eval_count > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {student.my_eval_count > 0 ? '심사 완료' : '심사 대기'}
                  </div>
                </div>
                <h3 className="text-xl font-bold mb-1 line-clamp-1">{student.title}</h3>
                <p className="text-sm text-black/50 mb-4">{student.student_name} ({student.student_id})</p>
                <div className="flex items-center gap-4 text-xs text-black/40">
                  <span className="flex items-center gap-1"><MessageSquare size={14} /> {student.total_eval_count} 의견</span>
                  {student.my_eval_count > 0 && (
                    <span className="text-emerald-600 font-bold">
                      내 점수: {((GRADE_SCORES[student.my_text_grade] + GRADE_SCORES[student.my_work1_grade] + GRADE_SCORES[student.my_work2_grade] + GRADE_SCORES[student.my_work3_grade]) / 4).toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
              
              <div className="mt-6 pt-4 border-t border-black/5 flex justify-between items-center">
                <span className="text-xs font-medium text-black/30">기획안 상세보기</span>
                <ChevronRight size={18} className="text-black/20 group-hover:text-black group-hover:translate-x-1 transition-all" />
              </div>
            </motion.div>
          ))}
        </div>

        {showRanking && (
          <aside className="w-full lg:w-80 space-y-6">
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-black/5 sticky top-24">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <BarChart3 size={20} className="text-blue-600" />
                내 평가 순위
              </h3>
              <p className="text-[10px] text-black/40 mb-6 font-medium leading-relaxed">
                본인이 부여한 점수만을 기준으로 산출된 실시간 순위입니다. (다른 교수님의 점수는 반영되지 않습니다.)
              </p>
              
              <div className="space-y-3">
                {students
                  .filter(s => s.my_eval_count > 0)
                  .map(s => ({
                    ...s,
                    myScore: (GRADE_SCORES[s.my_text_grade] + GRADE_SCORES[s.my_work1_grade] + GRADE_SCORES[s.my_work2_grade] + GRADE_SCORES[s.my_work3_grade]) / 4
                  }))
                  .sort((a, b) => b.myScore - a.myScore)
                  .map((student, idx) => (
                    <div 
                      key={student.id}
                      onClick={() => handleSelectStudent(student.id)}
                      className="flex items-center gap-3 p-3 rounded-2xl hover:bg-black/5 transition-all cursor-pointer group"
                    >
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${idx === 0 ? 'bg-amber-400 text-white' : idx === 1 ? 'bg-slate-300 text-white' : idx === 2 ? 'bg-orange-300 text-white' : 'bg-black/5 text-black/40'}`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-black group-hover:text-blue-600 transition-colors truncate">{student.student_name}</div>
                        <div className="text-[10px] text-black/40 truncate">{student.title}</div>
                      </div>
                      <div className="text-xs font-bold text-black/80">{student.myScore.toFixed(1)}</div>
                    </div>
                  ))}
                
                {students.filter(s => s.my_eval_count > 0).length === 0 && (
                  <div className="text-center py-12 text-black/20">
                    <p className="text-xs font-medium">아직 평가한 학생이 없습니다.</p>
                  </div>
                )}
              </div>
            </section>
          </aside>
        )}
      </div>

      {students.length === 0 && (
        <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-black/10">
          <p className="text-black/30">아직 제출된 기획안이 없습니다.</p>
        </div>
      )}
    </div>
  );
}

function UserIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
