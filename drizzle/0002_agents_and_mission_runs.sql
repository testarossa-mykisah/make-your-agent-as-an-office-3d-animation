DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL,
  instruction TEXT NOT NULL DEFAULT '',
  strength TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  char_key TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  is_custom INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE mission_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission TEXT NOT NULL,
  synthesis TEXT NOT NULL,
  agents_used TEXT NOT NULL,
  steps TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  agent_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
