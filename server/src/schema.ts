import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  role: text("role").notNull(),
  instruction: text("instruction").notNull().default(""),
  strength: text("strength").notNull().default(""),
  color: text("color").notNull(),
  charKey: text("char_key").notNull(),
  active: integer("active").notNull().default(1),
  isCustom: integer("is_custom").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const missionRuns = sqliteTable("mission_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mission: text("mission").notNull(),
  synthesis: text("synthesis").notNull(),
  agentsUsed: text("agents_used").notNull(),
  steps: text("steps").notNull(),
  durationMs: integer("duration_ms").notNull(),
  agentCount: integer("agent_count").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
