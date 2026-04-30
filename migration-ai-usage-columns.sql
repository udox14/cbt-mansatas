ALTER TABLE cbt_ai_generations ADD COLUMN prompt_tokens INTEGER DEFAULT 0;
ALTER TABLE cbt_ai_generations ADD COLUMN completion_tokens INTEGER DEFAULT 0;
ALTER TABLE cbt_ai_generations ADD COLUMN estimated_neurons REAL DEFAULT 0;
