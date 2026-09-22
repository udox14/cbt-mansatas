-- ============================================================
-- PHASE 3 Migration: Additive columns for cbt_events
--
-- Safely adds optional description, starts_at, and ends_at
-- scheduling columns to cbt_events without altering or dropping
-- any existing data or constraints.
-- ============================================================

ALTER TABLE cbt_events ADD COLUMN description TEXT;
ALTER TABLE cbt_events ADD COLUMN starts_at TEXT;
ALTER TABLE cbt_events ADD COLUMN ends_at TEXT;
