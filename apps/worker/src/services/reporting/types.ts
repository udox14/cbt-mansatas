// ============================================================
// Reporting Service — Canonical Types & Contracts
// ============================================================

import type { ExamMode } from '../../types.ts';

export interface ReportFilter {
  examId?: string;
  eventId?: string;
  mode?: ExamMode;
  subjectId?: string;
  grade?: string;
  classId?: string;
  className?: string;
  roomId?: string;
  roomName?: string;
  tanggalTes?: string;
  sesiTes?: string;
  status?: 'all' | 'not_started' | 'in_progress' | 'submitted' | 'locked';
  search?: string;
}

export interface PaginationOptions {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ExamOverviewReport {
  examId: string;
  title: string;
  mode: string;
  eventId?: string;
  eventName?: string;
  subjectName?: string;
  durationMinutes: number;
  passingScore: number;
  isScoreVisible: boolean;
  activeStatus: string;
  totalEnrolled: number;
  notStartedCount: number;
  inProgressCount: number;
  submittedCount: number;
  lockedCount: number;
  scoreSummary: {
    average: number;
    highest: number;
    lowest: number;
    median: number;
    passedCount: number;
    failedCount: number;
    passRate: number;
  };
}

export interface ParticipationItem {
  key: string;
  label: string;
  type: 'room' | 'class' | 'session' | 'date';
  totalEnrolled: number;
  notStarted: number;
  inProgress: number;
  submitted: number;
  locked: number;
  averageScore: number;
}

export interface ParticipationReport {
  examId: string;
  totalEnrolled: number;
  byRoom: ParticipationItem[];
  byClass: ParticipationItem[];
  bySession: ParticipationItem[];
}

export interface ParticipantReportRow {
  userId: string;
  userType: string;
  fullName: string;
  nisn: string;
  username: string;
  className: string;
  grade: string;
  roomName: string;
  tanggalTes: string;
  sesiTes: string;
  status: 'not_started' | 'in_progress' | 'submitted' | 'locked';
  statusLabel: string;
  totalQuestions: number | '';
  totalCorrect: number | '';
  totalWrong: number | '';
  totalUnanswered: number | '';
  score: number | '';
  startedAt?: string | null;
  finishedAt?: string | null;
  isTimeLocked: boolean;
  cheatWarnings: number;
}

export interface QuestionAnalyticsItem {
  id: string;
  order: number;
  text: string;
  type: string;
  points: number;
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  blankCount: number;
  correctRate: number;
  difficulty: 'Mudah' | 'Sedang' | 'Sukar';
  options: {
    id: string;
    label: string;
    text: string;
    isCorrect: boolean;
    chosenCount: number;
    chosenRate: number;
  }[];
}

export interface VerifiedReportContext {
  examId: string;
  eventId?: string;
  mode: ExamMode;
  staffId?: string;
  isStaffAdmin: boolean;
  user?: any;
}
