-- ============================================================
-- Phase 9: Consolidation, Reporting & Load Hardening Migration
-- Additive, non-destructive indexes and read model optimizations
-- ============================================================

-- 1. High-Concurrency Runtime Indexes
CREATE INDEX IF NOT EXISTS idx_cbt_sessions_user_status 
  ON cbt_exam_sessions(user_id, user_type, status);

CREATE INDEX IF NOT EXISTS idx_cbt_sessions_exam_room 
  ON cbt_exam_sessions(exam_id, room_id, status);

CREATE INDEX IF NOT EXISTS idx_cbt_tokens_active 
  ON cbt_exam_tokens(exam_id, is_active);

-- 2. Reporting & Query Optimization Indexes
CREATE INDEX IF NOT EXISTS idx_cbt_results_exam_score 
  ON cbt_exam_results(exam_id, score);

CREATE INDEX IF NOT EXISTS idx_cbt_roster_exam_class 
  ON cbt_exam_roster(exam_id, class_name);

CREATE INDEX IF NOT EXISTS idx_cbt_exams_event_mode 
  ON cbt_exams(event_id, mode);

CREATE INDEX IF NOT EXISTS idx_cbt_exams_owner_status 
  ON cbt_exams(owner_staff_id, active_status);
