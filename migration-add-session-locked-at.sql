ALTER TABLE cbt_exam_sessions ADD COLUMN locked_at TEXT;

UPDATE cbt_exam_sessions
SET locked_at = COALESCE(
  (
    SELECT MAX(happened_at)
    FROM cbt_cheat_logs
    WHERE cbt_cheat_logs.session_id = cbt_exam_sessions.id
  ),
  last_heartbeat
)
WHERE is_time_locked = 1
  AND locked_at IS NULL;
