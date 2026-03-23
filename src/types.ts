export type Role = 'student' | 'judge' | 'admin';

export interface User {
  id: string;           // ✅ uuid → string
  username: string;
  role: Role;
  name: string;
  student_id?: string;
  needs_password_change?: boolean;
}

export interface Round {
  round_number: number;
  is_open: boolean;
  name: string;
}

export interface Work {
  id?: string;          // ✅ uuid → string
  workNumber: number;
  title: string;
  category: '공간설계' | '3D 프레젠테이션' | '오브제' | '디지로그';
  summary: string;
  keywords: string;
  purpose: string;
  effect: string;
  images: string[];
}

export interface Proposal {
  id?: string;          // ✅ uuid → string
  userId: string;       // ✅ uuid → string
  roundNumber: number;
  studentId: string;
  name: string;
  careerPath: string;
  title: string;
  author: string;
  genre: string;
  plot: string;
  subject: string;
  reason: string;
  works: Work[];
  evaluations?: Evaluation[];
  is_evaluated?: boolean;
  is_submitted?: boolean;
}

export interface Evaluation {
  id?: string;              // ✅ uuid → string
  proposal_id: string;      // ✅ uuid → string
  judge_id: string;         // ✅ uuid → string
  judge_name?: string;
  text_grade: string;
  work1_grade: string;
  work2_grade: string;
  work3_grade: string;
  comment: string;
  is_final?: boolean;       // ✅ 누락 필드 추가
  finalized_at?: string;    // ✅ 누락 필드 추가
  created_at?: string;
  totalScore?: number;
}

export const GRADE_SCORES: Record<string, number> = {
  "A+": 99, "A0": 95, "A-": 91,
  "B+": 89, "B0": 85, "B-": 81,
  "C+": 79, "C0": 75, "C-": 71,
  "D+": 69, "D0": 65, "F": 0
};
