// Actions for Space 3D Agen: roster agen (provider + model + role) dan
// riwayat misi. Misi sendiri adalah simulasi orkestrasi lokal di klien;
// server hanya menyimpan roster dan hasil yang disimpan pengguna.

import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { asc, desc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";

export const ROLES = [
  "Koordinator Misi",
  "Peneliti",
  "Penalar Logika",
  "Programmer",
  "Penulis dan Perencana",
  "Spesialis Multibahasa",
  "Pengkritik",
  "Editor dan Peringkas",
  "Perancang",
] as const;

const roleSchema = z.enum(ROLES);

interface DefaultAgent {
  provider: string;
  model: string;
  role: (typeof ROLES)[number];
  strength: string;
  color: string;
  charKey: string;
}

const DEFAULT_AGENTS: DefaultAgent[] = [
  {
    provider: "OpenAI",
    model: "GPT-5",
    role: "Koordinator Misi",
    strength:
      "Memecah tujuan besar menjadi langkah kerja yang jelas dan membagi tugas ke agen lain.",
    color: "#37C978",
    charKey: "robot",
  },
  {
    provider: "Anthropic",
    model: "Claude Sonnet 4.5",
    role: "Programmer",
    strength:
      "Menulis dan memeriksa kode dengan hati-hati, termasuk penjelasan langkahnya.",
    color: "#E8833A",
    charKey: "book",
  },
  {
    provider: "Google",
    model: "Gemini 2.5 Pro",
    role: "Peneliti",
    strength:
      "Menyusun pertanyaan riset yang tajam dan memetakan hal yang perlu diverifikasi.",
    color: "#4C8DFF",
    charKey: "star",
  },
  {
    provider: "Meta",
    model: "Muse Wonder",
    role: "Penulis dan Perencana",
    strength:
      "Mengubah ide mentah menjadi kerangka tulisan dan rencana yang mengalir.",
    color: "#B465E8",
    charKey: "spark",
  },
  {
    provider: "xAI",
    model: "Grok 4",
    role: "Pengkritik",
    strength:
      "Menguji asumsi, mencari celah, dan menyampaikan keberatan secara langsung.",
    color: "#E5484D",
    charKey: "visor",
  },
  {
    provider: "DeepSeek",
    model: "DeepSeek R1",
    role: "Penalar Logika",
    strength:
      "Menalar langkah demi langkah untuk masalah logika, angka, dan keputusan bercabang.",
    color: "#00B8A9",
    charKey: "whale",
  },
  {
    provider: "Alibaba",
    model: "Qwen3-Max",
    role: "Spesialis Multibahasa",
    strength:
      "Menjaga istilah dan nuansa tetap konsisten saat materi berpindah bahasa.",
    color: "#FF6B9D",
    charKey: "scarf",
  },
  {
    provider: "Mistral",
    model: "Mistral Large",
    role: "Editor dan Peringkas",
    strength:
      "Memadatkan hasil semua agen menjadi ringkasan akhir yang rapi dan mudah dibaca.",
    color: "#F4B942",
    charKey: "wind",
  },
];

const CUSTOM_COLORS = [
  "#7BD88F",
  "#6EC1FF",
  "#FFA8A8",
  "#FFD93D",
  "#C39BFF",
  "#5EEAD4",
  "#FCA5A5",
  "#A5B4FC",
];
const CUSTOM_CHARS = ["robot", "star", "spark", "visor", "book", "scarf", "wind", "whale"];

const agentOut = z.object({
  id: z.number(),
  provider: z.string(),
  model: z.string(),
  role: z.string(),
  instruction: z.string(),
  strength: z.string(),
  color: z.string(),
  charKey: z.string(),
  active: z.boolean(),
  isCustom: z.boolean(),
  sortOrder: z.number(),
});

type AgentRow = typeof schema.agents.$inferSelect;

function toAgentOut(row: AgentRow): z.infer<typeof agentOut> {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    role: row.role,
    instruction: row.instruction,
    strength: row.strength,
    color: row.color,
    charKey: row.charKey,
    active: row.active === 1,
    isCustom: row.isCustom === 1,
    sortOrder: row.sortOrder,
  };
}

const okResponse = z.object({ ok: z.literal(true) });

export const SCENE_THEMES = ["fuji", "burj", "space"] as const;
const sceneThemeSchema = z.enum(SCENE_THEMES);
const THEME_KEY = "scene_theme";

export const Actions = {
  seedDefaults: defineAction({
    description:
      "Mengisi roster dengan 8 agen default bila roster masih kosong; tidak mengubah roster yang sudah ada.",
    request: z.object({}),
    response: z.object({ seeded: z.boolean(), count: z.number() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const existing = await db.select({ id: schema.agents.id }).from(schema.agents);
      if (existing.length > 0) {
        return { seeded: false, count: existing.length };
      }
      const now = new Date();
      await db.insert(schema.agents).values(
        DEFAULT_AGENTS.map((a, i) => ({
          provider: a.provider,
          model: a.model,
          role: a.role,
          instruction: "",
          strength: a.strength,
          color: a.color,
          charKey: a.charKey,
          active: 1,
          isCustom: 0,
          sortOrder: i,
          createdAt: now,
        })),
      );
      ctx.invalidateQueries();
      return { seeded: true, count: DEFAULT_AGENTS.length };
    },
  }),

  listAgents: defineAction({
    description: "Mengambil seluruh roster agen, terurut sesuai urutan tampil.",
    request: z.object({}),
    response: z.object({ agents: z.array(agentOut) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.agents)
        .orderBy(asc(schema.agents.sortOrder), asc(schema.agents.id));
      return { agents: rows.map(toAgentOut) };
    },
  }),

  updateAgent: defineAction({
    description:
      "Memperbarui role, instruksi kustom, nama model, atau status aktif satu agen.",
    request: z.object({
      id: z.number().int().positive(),
      role: roleSchema.optional(),
      instruction: z.string().trim().max(400).optional(),
      model: z.string().trim().min(1).max(60).optional(),
      active: z.boolean().optional(),
    }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      const patch: Partial<AgentRow> = {};
      if (args.role !== undefined) patch.role = args.role;
      if (args.instruction !== undefined) patch.instruction = args.instruction;
      if (args.model !== undefined) patch.model = args.model;
      if (args.active !== undefined) patch.active = args.active ? 1 : 0;
      if (Object.keys(patch).length > 0) {
        await db.update(schema.agents).set(patch).where(eq(schema.agents.id, args.id));
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  addAgent: defineAction({
    description: "Menambah agen kustom baru ke roster dengan provider, model, dan role pilihan pengguna.",
    request: z.object({
      provider: z.string().trim().min(1, "Provider wajib diisi").max(40),
      model: z.string().trim().min(1, "Model wajib diisi").max(60),
      role: roleSchema,
      instruction: z.string().trim().max(400).default(""),
      strength: z.string().trim().max(200).default(""),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.agents);
      const customCount = rows.filter((r) => r.isCustom === 1).length;
      const maxSort = rows.reduce((m, r) => Math.max(m, r.sortOrder), -1);
      const color = CUSTOM_COLORS[customCount % CUSTOM_COLORS.length] ?? "#7BD88F";
      const charKey = CUSTOM_CHARS[customCount % CUSTOM_CHARS.length] ?? "robot";
      const result = await db
        .insert(schema.agents)
        .values({
          provider: args.provider,
          model: args.model,
          role: args.role,
          instruction: args.instruction,
          strength: args.strength,
          color,
          charKey,
          active: 1,
          isCustom: 1,
          sortOrder: maxSort + 1,
        })
        .returning({ id: schema.agents.id });
      const inserted = result[0];
      if (!inserted) throw new Error("addAgent: insert returned no rows");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  deleteAgent: defineAction({
    description:
      "Menghapus satu agen dari roster, bawaan maupun kustom. Minimal 1 agen harus tersisa; agen terakhir tidak bisa dihapus.",
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, args.id));
      const row = rows[0];
      if (!row) throw new Error("Agen tidak ditemukan.");
      const all = await db.select({ id: schema.agents.id }).from(schema.agents);
      if (all.length <= 1) {
        throw new Error(
          "Minimal 1 agen harus tersisa di roster, jadi agen terakhir tidak bisa dihapus.",
        );
      }
      await db.delete(schema.agents).where(eq(schema.agents.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteAgents: defineAction({
    description:
      "Menghapus beberapa agen sekaligus dari roster. Menolak bila pilihan mencakup semua agen; minimal 1 agen harus tersisa.",
    request: z.object({
      ids: z.array(z.number().int().positive()).min(1).max(64),
    }),
    response: z.object({ deleted: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const all = await db.select({ id: schema.agents.id }).from(schema.agents);
      const existing = new Set(all.map((r) => r.id));
      const targets = [...new Set(args.ids)].filter((id) => existing.has(id));
      if (targets.length === 0) {
        throw new Error("Tidak ada agen yang cocok untuk dihapus.");
      }
      if (all.length - targets.length < 1) {
        throw new Error(
          "Tidak bisa menghapus semua agen — minimal 1 agen harus tersisa di roster.",
        );
      }
      const statements: BatchItem<"sqlite">[] = targets.map((id) =>
        db.delete(schema.agents).where(eq(schema.agents.id, id)),
      );
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { deleted: targets.length };
    },
  }),

  resetRoster: defineAction({
    description: "Mengembalikan roster ke 8 agen default, menghapus agen kustom dan perubahan role.",
    request: z.object({}),
    response: okResponse,
    handler: async (ctx): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      const statements: BatchItem<"sqlite">[] = [
        db.delete(schema.agents),
        db.insert(schema.agents).values(
          DEFAULT_AGENTS.map((a, i) => ({
            provider: a.provider,
            model: a.model,
            role: a.role,
            instruction: "",
            strength: a.strength,
            color: a.color,
            charKey: a.charKey,
            active: 1,
            isCustom: 0,
            sortOrder: i,
            createdAt: now,
          })),
        ),
      ];
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  listRuns: defineAction({
    description: "Mengambil riwayat misi yang tersimpan, terbaru dulu.",
    request: z.object({
      limit: z.number().int().positive().max(50).default(30),
    }),
    response: z.object({
      runs: z.array(
        z.object({
          id: z.number(),
          mission: z.string(),
          synthesis: z.string(),
          agentsUsed: z.array(
            z.object({ provider: z.string(), model: z.string(), role: z.string() }),
          ),
          steps: z.array(
            z.object({
              provider: z.string(),
              model: z.string(),
              role: z.string(),
              text: z.string(),
            }),
          ),
          durationMs: z.number(),
          agentCount: z.number(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.missionRuns)
        .orderBy(desc(schema.missionRuns.id))
        .limit(args.limit);
      return {
        runs: rows.map((row) => ({
          id: row.id,
          mission: row.mission,
          synthesis: row.synthesis,
          agentsUsed: JSON.parse(row.agentsUsed) as {
            provider: string;
            model: string;
            role: string;
          }[],
          steps: JSON.parse(row.steps) as {
            provider: string;
            model: string;
            role: string;
            text: string;
          }[],
          durationMs: row.durationMs,
          agentCount: row.agentCount,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },
  }),

  saveRun: defineAction({
    description: "Menyimpan satu hasil misi yang selesai ke riwayat.",
    request: z.object({
      mission: z.string().trim().min(1).max(1000),
      synthesis: z.string().min(1).max(20000),
      durationMs: z.number().int().min(0).max(3600000),
      agentsUsed: z
        .array(
          z.object({
            provider: z.string().max(60),
            model: z.string().max(80),
            role: z.string().max(60),
          }),
        )
        .min(1)
        .max(24),
      steps: z
        .array(
          z.object({
            provider: z.string().max(60),
            model: z.string().max(80),
            role: z.string().max(60),
            text: z.string().max(6000),
          }),
        )
        .min(1)
        .max(24),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const result = await db
        .insert(schema.missionRuns)
        .values({
          mission: args.mission,
          synthesis: args.synthesis,
          agentsUsed: JSON.stringify(args.agentsUsed),
          steps: JSON.stringify(args.steps),
          durationMs: args.durationMs,
          agentCount: args.agentsUsed.length,
        })
        .returning({ id: schema.missionRuns.id });
      const inserted = result[0];
      if (!inserted) throw new Error("saveRun: insert returned no rows");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  getTheme: defineAction({
    description:
      "Mengambil tema latar luar kantor 3D yang tersimpan; default 'fuji' bila belum pernah dipilih.",
    request: z.object({}),
    response: z.object({ theme: sceneThemeSchema }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.key, THEME_KEY));
      const value = rows[0]?.value;
      const parsed = sceneThemeSchema.safeParse(value);
      return { theme: parsed.success ? parsed.data : ("fuji" as const) };
    },
  }),

  setTheme: defineAction({
    description:
      "Menyimpan tema latar luar kantor 3D pilihan pengguna (fuji, burj, atau space) agar tetap terpilih setelah reload.",
    request: z.object({ theme: sceneThemeSchema }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      await db
        .insert(schema.settings)
        .values({ key: THEME_KEY, value: args.theme })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: { value: args.theme },
        });
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteRun: defineAction({
    description: "Menghapus satu entri riwayat misi.",
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.missionRuns).where(eq(schema.missionRuns.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),
} satisfies ActionsModule;
