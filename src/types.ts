// src/types.ts

export type Role = 'student' | 'judge' | 'admin';

export interface User {
  id: string;
  username: string;
  role: Role;
  name: string;
  student_id?: string;
}

export interface Round {
  id: string;
  round_number: number;
  is_active: boolean;
  name: string;
  created_at?: string;
}

export interface Work {
  id?: string;
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
  id?: string;
  userId: string;
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

export interface EvaluationScores {
  text_grade?: string;
  work1_grade?: string;
  work2_grade?: string;
  work3_grade?: string;
}

export interface Evaluation {
  id?: string;
  proposal_id: string;
  judge_id: string;
  judge_name?: string;
  scores: EvaluationScores;
  comment: string;
  is_final?: boolean;
  total_score?: number;
  created_at?: string;
  updated_at?: string;
}

export const GRADE_SCORES: Record<string, number> = {
  "A+": 99, "A0": 95, "A-": 91,
  "B+": 89, "B0": 85, "B-": 81,
  "C+": 79, "C0": 75, "C-": 71,
  "D+": 69, "D0": 65, "F": 0,
};

export const GRADE_OPTIONS = [
  "A+", "A0", "A-",
  "B+", "B0", "B-",
  "C+", "C0", "C-",
  "D+", "D0",
  "F",
];
