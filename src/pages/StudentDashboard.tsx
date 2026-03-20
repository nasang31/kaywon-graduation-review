import React, { useState, useEffect, useRef } from 'react';
import { User, Proposal, Work } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, Plus, Trash2, CheckCircle, Lock, Key, Save } from 'lucide-react';
import imageCompression from 'browser-image-compression';

interface StudentDashboardProps {
  user: User;
}

export default function StudentDashboard({ user }: StudentDashboardProps) {
  const [selectedRound, setSelectedRound] = useState(1);
  const [rounds, setRounds] = useState<any[]>([]);
  const [previousProposal, setPreviousProposal] = useState<any | null>(null);
  const [showPreviousProposal, setShowPreviousProposal] = useState(false);
  const didSetInitialRound = useRef(false);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [proposal, setProposal] = useState<Partial<Proposal>>({
    userId: user.id,
    roundNumber: 1,
    studentId: user.student_id || '',
    name: user.name,
    careerPath: '',
    title: '',
    author: '',
    genre: '',
    plot: '',
    subject: '',
    reason: '',
    is_submitted: false,
    works: [
      { workNumber: 1, title: '', category: '공간설계', summary: '', keywords: '', purpose: '', effect: '', images: [] },
      { workNumber: 2, title: '', category: '공간설계', summary: '', keywords: '', purpose: '', effect: '', images: [] },
      { workNumber: 3, title: '', category: '공간설계', summary: '', keywords: '', purpose: '', effect: '', images: [] },
    ]
  });

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMount = useRef(true);
  const [showConfirmModal, setShowConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDanger?: boolean;
  }>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const currentRoundInfo = rounds.find(r => r.round_number === selectedRound);
  const isLocked = proposal.is_submitted || !currentRoundInfo?.is_open;
  const canToggleSubmit = !!currentRoundInfo?.is_open;
  
  useEffect(() => {
    fetchRounds();
  }, []);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
    }
     fetchProposal();
  fetchPreviousProposal();
}, [user.id, selectedRound]);
  
  // Auto-save to localStorage
  useEffect(() => {
    if (fetching || !proposal.userId) return;
    
    // Only save if we have a base proposal or are actively editing
    localStorage.setItem(`proposal_draft_${user.id}_${selectedRound}`, JSON.stringify(proposal));
  }, [proposal, user.id, selectedRound, fetching]);

  // Periodic auto-save to Server (every 2 minutes)
  useEffect(() => {
    if (isLocked || fetching) return;

    autoSaveTimerRef.current = setInterval(() => {
      if (!proposal.is_submitted && !proposal.is_evaluated && !fetching) {
        executeSubmit();
        setLastAutoSave(new Date());
      }
    }, 120000);

    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    };
  }, [proposal, isLocked, fetching]);

  const fetchRounds = async () => {
  try {
    const res = await fetch('/api/admin/rounds');
    const data = await res.json();

    if (Array.isArray(data)) {
      setRounds(data);

      const activeRound = data.find((r: any) => Number(r.is_open) === 1);

      if (activeRound && !didSetInitialRound.current) {
        didSetInitialRound.current = true;
        setSelectedRound(activeRound.round_number);
      }
    } else {
      console.error('Rounds data is not an array:', data);
      setRounds([]);
    }
  } catch (err) {
    console.error('Failed to fetch rounds:', err);
    setRounds([]);
  }
};

  const fetchProposal = async () => {
    setFetching(true);
    // Reset state first to avoid showing old round data
    const defaultProposal = {
      userId: user.id,
      roundNumber: selectedRound,
      studentId: user.student_id || '',
      name: user.name,
      careerPath: '',
      title: '',
      author: '',
      genre: '',
      plot: '',
      subject: '',
      reason: '',
      is_submitted: false,
      works: [
        { workNumber: 1, title: '', category: '공간설계' as const, summary: '', keywords: '', purpose: '', effect: '', images: [] },
        { workNumber: 2, title: '', category: '공간설계' as const, summary: '', keywords: '', purpose: '', effect: '', images: [] },
        { workNumber: 3, title: '', category: '공간설계' as const, summary: '', keywords: '', purpose: '', effect: '', images: [] },
      ]
    };
    setProposal(defaultProposal);

    try {
      const res = await fetch(`/api/proposals/my/${user.id}/${selectedRound}`);
      const data = await res.json();
      
      if (data && data.id) {
        // Ensure we always have 3 works, even if some are missing in DB
        const works: Work[] = [
          { workNumber: 1, title: '', category: '공간설계' as const, summary: '', keywords: '', purpose: '', effect: '', images: [] },
          { workNumber: 2, title: '', category: '공간설계' as const, summary: '', keywords: '', purpose: '', effect: '', images: [] },
          { workNumber: 3, title: '', category: '공간설계' as const, summary: '', keywords: '', purpose: '', effect: '', images: [] },
        ];

        if (data.works && data.works.length > 0) {
          data.works.forEach((w: any) => {
            const idx = w.work_number - 1;
            if (idx >= 0 && idx < 3) {
              works[idx] = {
                id: w.id,
                workNumber: w.work_number,
                title: w.title || '',
                category: w.category || '공간설계',
                summary: w.summary || '',
                keywords: w.keywords || '',
                purpose: w.purpose || '',
                effect: w.effect || '',
                images: w.images || []
              };
            }
          });
        }

        setProposal({
          id: data.id,
          userId: data.user_id,
          roundNumber: data.round_number,
          studentId: data.student_id,
          name: data.name,
          careerPath: data.career_path,
          title: data.title,
          author: data.author,
          genre: data.genre,
          plot: data.plot,
          subject: data.subject,
          reason: data.reason,
          is_submitted: !!data.is_submitted,
          is_evaluated: !!data.is_evaluated,
          works
        });
      } else {
        // If no server data, check localStorage for this specific round
        const savedData = localStorage.getItem(`proposal_draft_${user.id}_${selectedRound}`);
        if (savedData) {
          try {
            const parsed = JSON.parse(savedData);
            // Ensure we don't accidentally load a draft from another round if the key was somehow wrong
            if (parsed.roundNumber === selectedRound) {
              setProposal(prev => ({ ...prev, ...parsed }));
            }
          } catch (e) {
            console.error('Failed to parse saved draft', e);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch proposal', err);
    } finally {
      setFetching(false);
    }
  };

  const handleImageUpload = async (index: number, file: File) => {
    if (isLocked) return;
    
    console.log('[UPLOAD] Starting upload for index:', index, 'file:', file.name, 'size:', file.size);
    setUploading(index);
    try {
      // Client-side compression
      const options = {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true
      };
      
      console.log('[UPLOAD] Compressing image...');
      let compressedFile;
      try {
        compressedFile = await imageCompression(file, options);
        console.log('[UPLOAD] Compression complete. New size:', compressedFile.size);
      } catch (compressErr) {
        console.error('[UPLOAD] Compression failed:', compressErr);
        compressedFile = file; // Fallback to original file if compression fails
      }
      
      const formData = new FormData();
      // Preserve original filename
      formData.append('image', compressedFile, file.name);

      console.log('[UPLOAD] Sending fetch request to /api/upload');
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      console.log('[UPLOAD] Fetch response status:', response.status);
      const data = await response.json();
      console.log('[UPLOAD] Fetch response data:', data);

      if (response.ok) {
        const newWorks = proposal.works ? [...proposal.works] : [];
        newWorks[index] = {
          ...newWorks[index],
          images: [...(newWorks[index].images || []), data.url]
        };
        setProposal({ ...proposal, works: newWorks });
      } else {
        alert(data.error || '업로드에 실패했습니다.');
      }
    } catch (err) {
      console.error('[UPLOAD] Catch block error:', err);
      alert(`서버와 통신 중 오류가 발생했습니다: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(null);
    }
  };

  const removeImage = (workIndex: number, imageIndex: number) => {
    if (isLocked) return;
    const newWorks = [...(proposal.works || [])];
    newWorks[workIndex].images = newWorks[workIndex].images.filter((_, i) => i !== imageIndex);
    setProposal({ ...proposal, works: newWorks });
  };

  const handleSubmit = async (e?: React.FormEvent, forceSubmit?: boolean) => {
    if (e) e.preventDefault();
    if (!currentRoundInfo?.is_open) return;
    
    if (forceSubmit === true) {
      setShowConfirmModal({
        show: true,
        title: '기획안 최종 저장',
        message: '기획안을 최종 저장하시겠습니까? 저장 후에는 심사 전까지 수정이 불가능합니다.',
        onConfirm: () => executeSubmit(true),
        isDanger: false
      });
      return;
    }
    
    if (forceSubmit === false) {
      setShowConfirmModal({
        show: true,
        title: '최종 저장 취소',
        message: '최종 저장을 취소하고 내용을 수정하시겠습니까?',
        onConfirm: () => executeSubmit(false),
        isDanger: true
      });
      return;
    }

    executeSubmit();
  };

  const executeSubmit = async (forceSubmit?: boolean) => {
    setLoading(true);
    setError(null);
    setShowConfirmModal(prev => ({ ...prev, show: false }));
    
    try {
      const payload = { 
        ...proposal, 
        roundNumber: selectedRound,
        is_submitted: forceSubmit !== undefined ? forceSubmit : !!proposal.is_submitted 
      };
      
      const response = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      if (response.ok) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
        // Clear localStorage on successful manual submit
        localStorage.removeItem(`proposal_draft_${user.id}_${selectedRound}`);
        await fetchProposal();
      } else {
        const errData = await response.json();
        setError(errData.error || '저장에 실패했습니다.');
      }
    } catch (err) {
      console.error('Submit failed', err);
      setError('서버와 통신 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const updateWork = (index: number, field: keyof Work, value: string) => {
    if (isLocked) return;
    const newWorks = [...(proposal.works || [])];
    (newWorks[index] as any)[field] = value;
    setProposal({ ...proposal, works: newWorks });
  };

  const fetchPreviousProposal = async () => {
  if (selectedRound <= 1) {
    setPreviousProposal(null);
    return;
  }

  try {
    const res = await fetch(`/api/proposals/reference/${user.id}/${selectedRound - 1}`);
    const data = await res.json();
    setPreviousProposal(data || null);
  } catch (err) {
    console.error('Failed to fetch previous proposal', err);
    setPreviousProposal(null);
  }
};

const handleCopyFromPrevious = () => {
  if (!previousProposal || isLocked) return;

  setShowConfirmModal({
    show: true,
    title: `${selectedRound - 1}차 내용 불러오기`,
    message: `${selectedRound - 1}차 내용을 현재 ${selectedRound}차 작성란에 복사합니다. 현재 작성 중인 내용은 덮어써집니다.`,
    onConfirm: () => {
      const copiedWorks: Work[] = [1, 2, 3].map((num) => {
        const found = previousProposal.works?.find((w: any) => Number(w.work_number ?? w.workNumber) === num);
        return {
          workNumber: num,
          title: found?.title || '',
          category: found?.category || '공간설계',
          summary: found?.summary || '',
          keywords: found?.keywords || '',
          purpose: found?.purpose || '',
          effect: found?.effect || '',
          images: Array.isArray(found?.images) ? found.images : [],
        };
      });

      setProposal((prev) => ({
        ...prev,
        userId: user.id,
        roundNumber: selectedRound,
        studentId: user.student_id || '',
        name: user.name,
        careerPath: previousProposal.career_path || '',
        title: previousProposal.title || '',
        author: previousProposal.author || '',
        genre: previousProposal.genre || '',
        plot: previousProposal.plot || '',
        subject: previousProposal.subject || '',
        reason: previousProposal.reason || '',
        is_submitted: false,
        is_evaluated: false,
        works: copiedWorks,
      }));

      setShowConfirmModal(prev => ({ ...prev, show: false }));
    },
    isDanger: false
  });
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
    }
  } catch (err) {
    alert('비밀번호 변경에 실패했습니다.');
  }
};

  return (
    <div className="space-y-8">
    <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
  <div>
    <h2 className="text-3xl font-bold tracking-tight">졸업작품 기획안 제출</h2>
    <p className="text-black/50 mt-1">차수별 기획안을 작성하고 심사 결과를 확인하세요.</p>
  </div>

  <div className="flex flex-col items-end gap-2">
    <div className="flex gap-2 flex-wrap justify-end">
      <button
        onClick={() => setShowPasswordModal(true)}
        className="flex items-center gap-2 px-4 py-1.5 bg-white border border-black/10 rounded-xl text-xs font-bold hover:bg-black/5 transition-all"
      >
        <Lock size={14} /> 비밀번호 변경
      </button>

      {selectedRound > 1 && previousProposal && (
        <>
          <button
            type="button"
            onClick={() => setShowPreviousProposal(v => !v)}
            className="px-4 py-1.5 bg-white border border-black/10 rounded-xl text-xs font-bold hover:bg-black/5 transition-all"
          >
            {showPreviousProposal ? `${selectedRound - 1}차 숨기기` : `${selectedRound - 1}차 보기`}
          </button>

          {!isLocked && (
            <button
              type="button"
              onClick={handleCopyFromPrevious}
              className="px-4 py-1.5 bg-blue-50 text-blue-700 border border-blue-100 rounded-xl text-xs font-bold hover:bg-blue-100 transition-all"
            >
              {selectedRound - 1}차 내용 불러오기
            </button>
          )}
        </>
      )}

      <div className="flex gap-2 bg-black/5 p-1 rounded-xl">
        {[1, 2, 3].map(num => (
          <button
            key={num}
            onClick={() => setSelectedRound(num)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              selectedRound === num ? 'bg-white text-black shadow-sm' : 'text-black/40 hover:text-black'
            }`}
          >
            {num}차
          </button>
        ))}
      </div>
    </div>

    {currentRoundInfo && (
      <div className="flex flex-col items-end gap-1">
        {lastAutoSave && (
          <span className="text-[10px] font-bold text-black/20 flex items-center gap-1">
            <Save size={10} /> {lastAutoSave.toLocaleTimeString()} 자동 저장됨
          </span>
        )}
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
          currentRoundInfo.is_open ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
        }`}>
          {currentRoundInfo.is_open ? '입력 가능 기간' : '입력 마감'}
        </span>
      </div>
    )}

    {selectedRound > 1 && previousProposal && showPreviousProposal && (
      <div className="mt-4 w-full bg-blue-50 border border-blue-100 rounded-2xl p-5 text-sm">
        <div className="font-bold text-blue-800 mb-3">
          {selectedRound - 1}차 제출안 참고
        </div>
        <div className="grid md:grid-cols-2 gap-4 text-black/70">
          <div>
            <div><span className="font-bold">텍스트명:</span> {previousProposal.title || '-'}</div>
            <div><span className="font-bold">작가명:</span> {previousProposal.author || '-'}</div>
            <div><span className="font-bold">장르:</span> {previousProposal.genre || '-'}</div>
          </div>
          <div>
            <div><span className="font-bold">주제:</span> {previousProposal.subject || '-'}</div>
            <div><span className="font-bold">기획 의도:</span> {previousProposal.reason || '-'}</div>
          </div>
        </div>
      </div>
    )}
  </div>
</header>

      {/* Password Modal */}
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
                  <label className="block text-xs font-bold text-black/40 uppercase mb-2">새 비밀번호</label>
                  <input
                    type="password"
                    value={passwords.new || ''}
                    onChange={e => setPasswords({...passwords, new: e.target.value})}
                    className="w-full px-4 py-2.5 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-black/40 uppercase mb-2">새 비밀번호 확인</label>
                  <input
                    type="password"
                    value={passwords.confirm || ''}
                    onChange={e => setPasswords({...passwords, confirm: e.target.value})}
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

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirmModal.show && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[32px] p-10 w-full max-w-md shadow-2xl text-center"
            >
              <div className={`w-16 h-16 mx-auto mb-6 rounded-2xl flex items-center justify-center ${showConfirmModal.isDanger ? 'bg-red-50 text-red-600' : 'bg-black/5 text-black'}`}>
                {showConfirmModal.isDanger ? <Trash2 size={32} /> : <CheckCircle size={32} />}
              </div>
              <h3 className="text-2xl font-bold mb-3">{showConfirmModal.title}</h3>
              <p className="text-black/50 text-sm leading-relaxed mb-8">
                {showConfirmModal.message}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(prev => ({ ...prev, show: false }))}
                  className="flex-1 py-4 rounded-2xl font-bold border border-black/10 hover:bg-black/5 transition-all"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={showConfirmModal.onConfirm}
                  className={`flex-1 py-4 rounded-2xl font-bold text-white transition-all ${showConfirmModal.isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-black hover:bg-black/90'}`}
                >
                  확인
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 px-6 py-4 rounded-2xl text-sm font-medium">
          {error}
        </div>
      )}

      {proposal.is_evaluated && (
        <div className="bg-amber-50 border border-amber-100 text-amber-700 px-6 py-4 rounded-2xl text-sm font-medium flex items-center gap-2">
          <CheckCircle size={18} />
         최종 저장된 상태입니다. 수정하려면 수정 버튼을 눌러주세요.
        </div>
      )}

      {proposal.is_submitted && !proposal.is_evaluated && (
        <div className="bg-blue-50 border border-blue-100 text-blue-700 px-6 py-4 rounded-2xl text-sm font-medium flex items-center gap-2">
          <Lock size={18} />
          기획안이 최종 저장되었습니다. 수정을 원하시면 하단의 '저장 취소' 버튼을 눌러주세요.
        </div>
      )}

      <form onSubmit={(e) => handleSubmit(e)} className="space-y-8 pb-20">
        {/* 개인정보 및 텍스트 정보 */}
        <section className={`bg-white p-8 rounded-3xl shadow-sm border border-black/5 space-y-6 ${isLocked ? 'opacity-80' : ''}`}>
          <div className="flex justify-between items-center border-b border-black/5 pb-4">
            <h3 className="text-xl font-semibold">기본 정보</h3>
            <span className="text-xs font-mono text-black/30 uppercase tracking-widest">{currentRoundInfo?.name}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">학번</label>
              <input
                type="text"
                value={proposal.studentId || ''}
                readOnly
                className="w-full px-4 py-2.5 rounded-xl border border-black/10 bg-black/[0.02] outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">이름</label>
              <input
                type="text"
                value={proposal.name || ''}
                readOnly
                className="w-full px-4 py-2.5 rounded-xl border border-black/10 bg-black/[0.02] outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">희망진로</label>
              <input
                type="text"
                value={proposal.careerPath || ''}
                onChange={e => setProposal({...proposal, careerPath: e.target.value})}
                disabled={isLocked}
                className="w-full px-4 py-2.5 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none disabled:bg-black/[0.02]"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">선정 텍스트 명</label>
              <input
                type="text"
                value={proposal.title || ''}
                onChange={e => setProposal({...proposal, title: e.target.value})}
                disabled={isLocked}
                className="w-full px-4 py-2.5 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none disabled:bg-black/[0.02] break-words"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">작가명</label>
              <input
                type="text"
                value={proposal.author || ''}
                onChange={e => setProposal({...proposal, author: e.target.value})}
                disabled={isLocked}
                className="w-full px-4 py-2.5 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none disabled:bg-black/[0.02] break-words"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">장르</label>
              <input
                type="text"
                value={proposal.genre || ''}
                onChange={e => setProposal({...proposal, genre: e.target.value})}
                disabled={isLocked}
                className="w-full px-4 py-2.5 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none disabled:bg-black/[0.02] break-words"
                required
              />
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2">줄거리</label>
              <textarea
                value={proposal.plot || ''}
                onChange={e => setProposal({...proposal, plot: e.target.value})}
                disabled={isLocked}
                className="w-full px-4 py-3 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none min-h-[100px] disabled:bg-black/[0.02] break-words"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">주제</label>
              <textarea
                value={proposal.subject || ''}
                onChange={e => setProposal({...proposal, subject: e.target.value})}
                disabled={isLocked}
                className="w-full px-4 py-3 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none min-h-[80px] disabled:bg-black/[0.02] break-words"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">선정이유</label>
              <textarea
                value={proposal.reason || ''}
                onChange={e => setProposal({...proposal, reason: e.target.value})}
                disabled={isLocked}
                className="w-full px-4 py-3 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none min-h-[80px] disabled:bg-black/[0.02] break-words"
                required
              />
            </div>
          </div>
        </section>

        {/* 작품 정보 (1, 2, 3) */}
        <div className="space-y-8">
          {proposal.works?.map((work, idx) => (
            <section key={idx} className={`bg-white p-8 rounded-3xl shadow-sm border border-black/5 space-y-6 ${isLocked ? 'opacity-80' : ''}`}>
              <div className="flex justify-between items-center border-b border-black/5 pb-4">
                <h3 className="text-xl font-semibold">작품{work.workNumber}</h3>
                <span className="text-xs font-mono text-black/30 uppercase tracking-widest">작품 상세 정보</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium mb-2">작품명</label>
                    <input
                      type="text"
                      value={work.title || ''}
                      onChange={e => updateWork(idx, 'title', e.target.value)}
                      disabled={isLocked}
                      className="w-full px-4 py-2.5 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none disabled:bg-black/[0.02] break-words"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">분야</label>
                    <select
                      value={work.category || '공간설계'}
                      onChange={e => updateWork(idx, 'category', e.target.value as any)}
                      disabled={isLocked}
                      className="w-full px-4 py-2.5 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none bg-white disabled:bg-black/[0.02]"
                      required
                    >
                      <option value="공간설계">공간설계</option>
                      <option value="3D 프레젠테이션">3D 프레젠테이션</option>
                      <option value="오브제">오브제</option>
                      <option value="디지로그">디지로그</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">작업개요</label>
                    <textarea
                      value={work.summary || ''}
                      onChange={e => updateWork(idx, 'summary', e.target.value)}
                      disabled={isLocked}
                      className="w-full px-4 py-3 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none min-h-[80px] disabled:bg-black/[0.02] break-words"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">키워드</label>
                    <input
                      type="text"
                      value={work.keywords || ''}
                      onChange={e => updateWork(idx, 'keywords', e.target.value)}
                      disabled={isLocked}
                      className="w-full px-4 py-2.5 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none disabled:bg-black/[0.02] break-words"
                      placeholder="콤마(,)로 구분"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium mb-2">이미지 업로드 (최대 5장)</label>
                    <div className="grid grid-cols-3 gap-2">
                      {work.images?.map((img, i) => (
                        <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-black/5 group">
                          <img src={img} alt="Preview" className="w-full h-full object-cover" loading="lazy" />
                          {!isLocked && (
                            <button
                              type="button"
                              onClick={() => removeImage(idx, i)}
                              className="absolute top-1 right-1 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                      {!isLocked && (!work.images || work.images.length < 5) && (
                        <label className={`flex flex-col items-center justify-center aspect-square rounded-xl border-2 border-dashed border-black/10 hover:border-black/20 hover:bg-black/[0.02] cursor-pointer transition-all ${uploading === idx ? 'opacity-50 cursor-wait' : ''}`}>
                          {uploading === idx ? (
                            <div className="w-6 h-6 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                          ) : (
                            <Plus className="text-black/20" size={24} />
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={uploading !== null}
                            onChange={e => e.target.files?.[0] && handleImageUpload(idx, e.target.files[0])}
                          />
                        </label>
                      )}
                    </div>
                    <p className="text-[10px] text-black/30 mt-2">장당 최대 10MB까지 업로드 가능합니다.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">내용 및 목적</label>
                    <textarea
                      value={work.purpose || ''}
                      onChange={e => updateWork(idx, 'purpose', e.target.value)}
                      disabled={isLocked}
                      className="w-full px-4 py-3 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none min-h-[80px] disabled:bg-black/[0.02] break-words"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">기대효과</label>
                    <textarea
                      value={work.effect || ''}
                      onChange={e => updateWork(idx, 'effect', e.target.value)}
                      disabled={isLocked}
                      className="w-full px-4 py-3 rounded-xl border border-black/10 focus:ring-2 focus:ring-black/5 outline-none min-h-[80px] disabled:bg-black/[0.02] break-words"
                      required
                    />
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>

        {canToggleSubmit && (
          <div className="fixed bottom-8 right-8 left-8 max-w-7xl mx-auto flex justify-end pointer-events-none gap-4">
            {proposal.is_submitted ? (
              <>
                <button
                  type="button"
                  disabled
                  className="pointer-events-auto bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-12 py-4 rounded-2xl font-bold flex items-center gap-2"
                >
                  <CheckCircle size={18} /> 최종 저장 완료
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmit(undefined, false)}
                  disabled={loading}
                  className="pointer-events-auto bg-white text-black border border-black/10 px-8 py-4 rounded-2xl font-bold shadow-2xl hover:bg-black/5 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {loading ? '처리 중...' : '저장 취소'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit(undefined, true)}
                disabled={loading}
                className="pointer-events-auto bg-black text-white px-12 py-4 rounded-2xl font-bold shadow-2xl hover:bg-black/80 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? '저장 중...' : '기획안 최종 저장'}
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
