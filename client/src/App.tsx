import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { setFailureNoticeText } from "@hatch/space-sdk/client";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { api, type ApiRequest, type ApiResponse } from "./api";
import { Plaza3D, type PlazaAgent, type SceneTheme } from "./Plaza3D";
import { characterDataUrl } from "./characters";
import {
BUBBLES,
MISSION_PRESETS,
ROLES,
buildContribution,
buildSynthesis,
roleRank,
suggestRoleForModel,
} from "./catalog";

const FIELDS = actionFields<typeof Actions>();

try {
  setFailureNoticeText(
    (_error: unknown, message: string) =>
      `Terjadi kendala: ${message} Silakan coba lagi.`,
  );
} catch {
  // Penamaan notifikasi gagal tidak boleh menghalangi aplikasi.
}

type Agent = ApiResponse<typeof api, "listAgents">["agents"][number];
type UpdateAgentArgs = ApiRequest<typeof api, "updateAgent">;
type AddAgentArgs = ApiRequest<typeof api, "addAgent">;
type SaveRunArgs = ApiRequest<typeof api, "saveRun">;

type StepStatus = "thinking" | "done";
interface LiveStep {
  agentId: number;
  label: string;
  role: string;
  color: string;
  charKey: string;
  headline: string;
  text: string;
  status: StepStatus;
}
interface LogEntry {
  time: string;
  text: string;
}
type Phase = "idle" | "running" | "done" | "stopped";

const ROLE_LIST: string[] = [...ROLES];

/* Nama pendek satu baris, sama seperti label 3D di Plaza3D. */
const SHORT_NAMES: Record<string, string> = {
  "GPT-5": "GPT-5",
  "Claude Sonnet 4.5": "Claude",
  "Gemini 2.5 Pro": "Gemini",
  "Muse Wonder": "Muse",
  "Grok 4": "Grok",
  "DeepSeek R1": "DeepSeek",
  "Qwen3-Max": "Qwen",
  "Mistral Large": "Mistral",
};
function shortName(name: string): string {
  return SHORT_NAMES[name] ?? name.split(" ")[0] ?? name;
}

function nowTime(): string {
  return new Date().toLocaleTimeString("id-ID", { hour12: false });
}

function formatDuration(ms: number): string {
  const totalSec = ms / 1000;
  if (totalSec < 60) {
    return `${totalSec.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dtk`;
  }
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m} mnt ${String(s).padStart(2, "0")} dtk`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------- Ikon garis tipis (SVG) ---------- */
function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
const I = {
  play: "M8 5.5v13l11-6.5z",
  stop: "M7 7h10v10H7z",
  copy: "M9 9h10v12H9z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6",
  plus: "M12 5v14 M5 12h14",
  reset: "M3 12a9 9 0 1 0 3-6.7 M3 4v5h5",
  check: "M4 12.5l5 5L20 6.5",
  chevron: "M6 9l6 6 6-6",
  cube: "M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12L4 7.5 M12 12v9",
};

function PanelTitle({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-[var(--ink)]">
        <span className="inline-block h-2.5 w-2.5 bg-[var(--ink)]" aria-hidden="true" />
        {children}
      </h2>
      {right}
    </div>
  );
}

/* ---------- Latar luar (tema ruangan 3D) ---------- */
const THEME_OPTIONS: { id: SceneTheme; name: string; desc: string }[] = [
  { id: "fuji", name: "Gunung Fuji", desc: "Jepang tenang, pagi lembut" },
  { id: "burj", name: "Burj Khalifa", desc: "Dubai mewah, senja emas" },
  { id: "space", name: "Luar Angkasa", desc: "Stasiun luar angkasa" },
];

/* Warna dasar halaman menyesuaikan tema secara halus; panel tetap bone
   dengan teks tinta gelap agar kontras selalu terjaga. */
const THEME_PAGE_VARS: Record<SceneTheme, CSSProperties> = {
  fuji: {
    "--bg": "#171310",
    "--ground-2": "#221a14",
  } as CSSProperties,
  burj: {
    "--bg": "#171009",
    "--ground-2": "#251808",
  } as CSSProperties,
  space: {
    "--bg": "#0c1018",
    "--ground-2": "#131a29",
  } as CSSProperties,
};

/* Pratinjau mini prosedural (SVG) yang menggambarkan tiap tema apa adanya:
   Fuji bersalju + sakura, menara Burj di cakrawala senja, Bumi + bintang. */
function ThemePreview({ theme }: { theme: SceneTheme }) {
  if (theme === "fuji") {
    return (
      <svg width="46" height="30" viewBox="0 0 46 30" aria-hidden="true" className="shrink-0 rounded-[4px]">
        <rect width="46" height="30" fill="#BFD9E8" />
        <rect y="21" width="46" height="9" fill="#EFE3CC" />
        <polygon points="8,24 23,6 38,24" fill="#5E7791" />
        <polygon points="19.5,10.5 23,6 26.5,10.5 24.8,9.3 23,11 21.2,9.3" fill="#F8F4EC" />
        <circle cx="5" cy="5" r="2.2" fill="#F4C3D2" />
        <circle cx="9" cy="3.4" r="1.7" fill="#EEA3B8" />
        <circle cx="41" cy="6" r="2.6" fill="#FFEFC4" />
      </svg>
    );
  }
  if (theme === "burj") {
    return (
      <svg width="46" height="30" viewBox="0 0 46 30" aria-hidden="true" className="shrink-0 rounded-[4px]">
        <rect width="46" height="30" fill="#C97A36" />
        <rect y="0" width="46" height="10" fill="#7A4023" />
        <circle cx="9" cy="17" r="3.4" fill="#FFDCA6" />
        <rect x="2" y="20" width="7" height="10" fill="#2A170E" />
        <rect x="12" y="23" width="6" height="7" fill="#2A170E" />
        <rect x="36" y="19" width="8" height="11" fill="#2A170E" />
        <polygon points="26,30 28.6,9 29.4,4 30,9 32.6,30" fill="#241108" />
        <rect x="29.2" y="1.5" width="1.4" height="4" fill="#241108" />
        <rect x="27.6" y="14" width="1.6" height="1.6" fill="#FFD9A0" />
        <rect x="30.4" y="19" width="1.6" height="1.6" fill="#FFD9A0" />
        <rect x="28.4" y="24" width="1.6" height="1.6" fill="#FFC46B" />
        <rect x="38" y="22" width="1.6" height="1.6" fill="#FFC46B" />
        <rect x="4" y="23" width="1.6" height="1.6" fill="#FFC46B" />
      </svg>
    );
  }
  return (
    <svg width="46" height="30" viewBox="0 0 46 30" aria-hidden="true" className="shrink-0 rounded-[4px]">
      <rect width="46" height="30" fill="#04060B" />
      <circle cx="7" cy="6" r="1" fill="#FFFFFF" />
      <circle cx="18" cy="3.4" r="0.8" fill="#FFFFFF" opacity="0.7" />
      <circle cx="30" cy="7" r="0.9" fill="#FFFFFF" opacity="0.85" />
      <circle cx="42" cy="3.6" r="0.8" fill="#FFFFFF" opacity="0.6" />
      <circle cx="24" cy="12" r="0.7" fill="#FFFFFF" opacity="0.5" />
      <circle cx="12" cy="24" r="9.5" fill="#2E6BD8" />
      <ellipse cx="9" cy="21" rx="3.6" ry="2" fill="#4AA460" />
      <ellipse cx="15" cy="26" rx="3" ry="1.6" fill="#4AA460" opacity="0.8" />
      <ellipse cx="10" cy="26.5" rx="4" ry="1.2" fill="#FFFFFF" opacity="0.55" />
      <circle cx="37" cy="16" r="3.2" fill="#C98A5A" />
      <ellipse cx="37" cy="16" rx="5.4" ry="1.3" fill="none" stroke="#F0E6D2" strokeOpacity="0.4" strokeWidth="0.8" transform="rotate(-18 37 16)" />
    </svg>
  );
}

const panelCls =
  "rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--ink)] shadow-[0_12px_32px_rgba(0,0,0,0.35)] sm:p-5";
const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-white/60 px-3 py-2 text-base text-[var(--ink)] placeholder:text-[var(--dim)]";
const labelCls = "mb-1 block text-sm font-semibold text-[var(--ink)]";

/* ---------- Editor satu agen ---------- */
function AgentEditor({
  agent,
  onUpdate,
  onRequestDelete,
  deleteDisabled,
  deleteNote,
}: {
  agent: Agent;
  onUpdate: (patch: UpdateAgentArgs) => void;
  onRequestDelete: (agent: Agent, el: HTMLElement | null) => void;
  deleteDisabled: boolean;
  deleteNote: string | null;
}) {
  const [model, setModel] = useState(agent.model);
  const [instruction, setInstruction] = useState(agent.instruction);
  const suggestion = suggestRoleForModel(model);
  const dirtyModel = model.trim() !== agent.model && model.trim().length > 0;
  const dirtyInstruction = instruction !== agent.instruction;

  return (
    <div className="spring-in mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <img
          src={characterDataUrl(agent.charKey, agent.color)}
          alt=""
          width={52}
          height={52}
          className="pixel-img shrink-0 rounded-md border border-[var(--border)] bg-[var(--ground-2)]"
        />
        <div className="min-w-0">
          <p className="font-display text-base font-semibold leading-tight">
            {agent.provider} · {agent.model}
          </p>
          <p className="mt-1 text-sm leading-snug text-[var(--ink-soft)]">{agent.strength}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`model-${agent.id}`} className={labelCls}>
            Nama model
          </label>
          <input
            id={`model-${agent.id}`}
            className={inputCls}
            {...FIELDS.updateAgent.model}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          {suggestion && suggestion !== agent.role && (
            <button
              type="button"
              className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--ink)] px-3 text-sm font-semibold"
              onClick={() => onUpdate({ id: agent.id, role: suggestion })}
            >
              Saran role untuk model ini: {suggestion}
            </button>
          )}
          {dirtyModel && (
            <button
              type="button"
              className="mt-2 ml-2 inline-flex min-h-9 items-center rounded-md bg-[var(--ink)] px-3 text-sm font-semibold text-[var(--surface)]"
              onClick={() => onUpdate({ id: agent.id, model: model.trim() })}
            >
              Simpan model
            </button>
          )}
        </div>
        <div>
          <label htmlFor={`role-${agent.id}`} className={labelCls}>
            Role
          </label>
          <select
            id={`role-${agent.id}`}
            className={inputCls}
            value={agent.role}
            onChange={(e) => onUpdate({ id: agent.id, role: e.target.value as UpdateAgentArgs["role"] })}
          >
            {ROLE_LIST.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--dim)]">
            Role menentukan urutan bicara dan jenis kontribusi agen saat misi berjalan.
          </p>
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor={`instruksi-${agent.id}`} className={labelCls}>
          Instruksi kustom <span className="font-normal text-[var(--dim)]">(opsional)</span>
        </label>
        <textarea
          id={`instruksi-${agent.id}`}
          className={inputCls}
          rows={2}
          {...FIELDS.updateAgent.instruction}
          placeholder="cth. Selalu jawab dengan poin-poin singkat dan satu contoh nyata."
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        {dirtyInstruction && (
          <button
            type="button"
            className="mt-2 inline-flex min-h-9 items-center rounded-md bg-[var(--ink)] px-3 text-sm font-semibold text-[var(--surface)]"
            onClick={() => onUpdate({ id: agent.id, instruction: instruction })}
          >
            Simpan instruksi
          </button>
        )}
      </div>

      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <button
          type="button"
          disabled={deleteDisabled}
          aria-label={`Hapus ${shortName(agent.model)}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[var(--danger)] px-3 text-sm font-semibold text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={(e) => onRequestDelete(agent, e.currentTarget)}
        >
          <Icon d={I.trash} size={15} /> Hapus agen
        </button>
        {deleteNote && (
          <p className="mt-1.5 text-xs font-medium text-[var(--dim)]">{deleteNote}</p>
        )}
        <p className="mt-1.5 text-xs text-[var(--dim)]">
          {agent.isCustom
            ? "Agen kustom yang dihapus hilang permanen dan harus ditambah ulang bila dibutuhkan."
            : "Agen bawaan yang dihapus bisa dikembalikan lewat tombol Reset Roster."}
        </p>
      </div>
    </div>
  );
}

/* ---------- Form tambah agen ---------- */
function AddAgentForm({
  onAdd,
  onCancel,
  pending,
}: {
  onAdd: (a: AddAgentArgs) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [role, setRole] = useState<string>("Peneliti");
  const [strength, setStrength] = useState("");
  const [error, setError] = useState("");
  const suggestion = suggestRoleForModel(model);

  return (
    <form
      className="spring-in mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!provider.trim() || !model.trim()) {
          setError("Provider dan model wajib diisi.");
          return;
        }
        setError("");
        onAdd({ provider: provider.trim(), model: model.trim(), role: role as AddAgentArgs["role"], instruction: "", strength: strength.trim() });
      }}
    >
      <p className="font-display text-base font-semibold">Tambah agen kustom</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="baru-provider" className={labelCls}>Provider</label>
          <input
            id="baru-provider"
            className={inputCls}
            {...FIELDS.addAgent.provider}
            placeholder="cth. Cohere"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="baru-model" className={labelCls}>Model</label>
          <input
            id="baru-model"
            className={inputCls}
            {...FIELDS.addAgent.model}
            placeholder="cth. Command R+"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="baru-role" className={labelCls}>Role</label>
          <select
            id="baru-role"
            className={inputCls}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {ROLE_LIST.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          {suggestion && suggestion !== role && (
            <button
              type="button"
              className="mt-2 inline-flex min-h-9 items-center rounded-full border border-[var(--ink)] px-3 text-sm font-semibold"
              onClick={() => setRole(suggestion)}
            >
              Saran otomatis: {suggestion}
            </button>
          )}
        </div>
        <div>
          <label htmlFor="baru-kuat" className={labelCls}>
            Kekuatan singkat <span className="font-normal text-[var(--dim)]">(opsional)</span>
          </label>
          <input
            id="baru-kuat"
            className={inputCls}
            {...FIELDS.addAgent.strength}
            placeholder="cth. Kuat dalam penalaran rantai panjang."
            value={strength}
            onChange={(e) => setStrength(e.target.value)}
          />
        </div>
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-[var(--danger)]">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--ink)] px-4 text-sm font-bold text-[var(--surface)] disabled:opacity-50"
        >
          <Icon d={I.plus} size={15} /> Tambahkan ke roster
        </button>
        <button
          type="button"
          className="inline-flex items-center rounded-md border border-[var(--ink)] px-4 text-sm font-semibold"
          onClick={onCancel}
        >
          Batal
        </button>
      </div>
    </form>
  );
}

/* ---------- Dialog konfirmasi hapus ---------- */
function ConfirmDialog({
  title,
  confirmLabel,
  pending,
  confirmDisabled,
  onConfirm,
  onCancel,
  getRestoreTarget,
  children,
}: {
  title: string;
  confirmLabel: string;
  pending?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  getRestoreTarget?: () => HTMLElement | null;
  children: ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const cancelCbRef = useRef(onCancel);
  cancelCbRef.current = onCancel;
  const restoreRef = useRef(getRestoreTarget);
  restoreRef.current = getRestoreTarget;

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelCbRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const el = restoreRef.current?.();
      if (el && document.contains(el)) el.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Tutup dialog konfirmasi"
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="spring-in relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--ink)] shadow-[0_24px_60px_rgba(0,0,0,0.5)] sm:p-5"
      >
        <h3 className="font-display text-lg font-bold">{title}</h3>
        <div className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">{children}</div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="inline-flex items-center rounded-md border border-[var(--ink)] px-4 text-sm font-semibold"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending || confirmDisabled}
            className="inline-flex items-center rounded-md bg-[var(--danger)] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Aplikasi utama ---------- */
export function App() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mission, setMission] = useState("");
  const [missionError, setMissionError] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  const [runTotal, setRunTotal] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [finalSynthesis, setFinalSynthesis] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stageId, setStageId] = useState<number | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [ambientPaused, setAmbientPaused] = useState(false);
  const [cameraResetNonce, setCameraResetNonce] = useState(0);
  const [hiddenLabels, setHiddenLabels] = useState(0);
  const [copyError, setCopyError] = useState("");
  const [agentStatuses, setAgentStatuses] = useState<Record<number, string>>({});
  const [webglError, setWebglError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [detailRunId, setDetailRunId] = useState<number | null>(null);
  const [checkedIds, setCheckedIds] = useState<number[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const triggerRef = useRef<HTMLElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const runIdRef = useRef(0);
  const startRef = useRef(0);
  const seededRef = useRef(false);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.listAgents({}),
  });
  const runsQuery = useQuery({
    queryKey: ["runs"],
    queryFn: () => api.listRuns({ limit: 30 }),
  });

  /* Tema latar luar: tersimpan di database; pilihan lokal diterapkan
     seketika agar ganti tema terasa langsung, lalu disimpan di server. */
  const themeQuery = useQuery({
    queryKey: ["theme"],
    queryFn: () => api.getTheme({}),
  });
  const [themeLocal, setThemeLocal] = useState<SceneTheme | null>(null);
  const [themeError, setThemeError] = useState("");
  const theme: SceneTheme = themeLocal ?? themeQuery.data?.theme ?? "fuji";
  const setThemeMut = useMutation({
    mutationFn: async (t: SceneTheme) => await api.setTheme({ theme: t }),
    onSuccess: () => {
      setThemeError("");
      queryClient.invalidateQueries({ queryKey: ["theme"] });
    },
    onError: () => {
      setThemeLocal(null);
      setThemeError(
        "Pilihan latar gagal disimpan, jadi tema dikembalikan ke yang tersimpan. Coba lagi sebentar lagi.",
      );
    },
  });
  const chooseTheme = (t: SceneTheme) => {
    if (t === theme) return;
    setThemeError("");
    setThemeLocal(t);
    setThemeMut.mutate(t);
  };

  const invalidateAgents = () =>
    queryClient.invalidateQueries({ queryKey: ["agents"] });

  const seedMut = useMutation({
    mutationFn: () => api.seedDefaults({}),
    onSuccess: invalidateAgents,
  });
  useEffect(() => {
    if (
      agentsQuery.data &&
      agentsQuery.data.agents.length === 0 &&
      !seededRef.current
    ) {
      seededRef.current = true;
      seedMut.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentsQuery.data]);

  const updateMut = useMutation({
    mutationFn: async (patch: UpdateAgentArgs) => await api.updateAgent(patch),
    onSuccess: invalidateAgents,
  });
  const addMut = useMutation({
    mutationFn: async (a: AddAgentArgs) => await api.addAgent(a),
    onSuccess: (res) => {
      invalidateAgents();
      setShowAdd(false);
      setSelectedId(res.id);
    },
  });
  const deleteMut = useMutation({
    mutationFn: async (a: { id: number; name: string }) =>
      await api.deleteAgent({ id: a.id }),
    onSuccess: (_res, vars) => {
      invalidateAgents();
      setDeleteError("");
      setDeleteTarget(null);
      setCheckedIds((prev) => prev.filter((x) => x !== vars.id));
      if (selectedId === vars.id) setSelectedId(null);
      window.setTimeout(
        () => document.getElementById("pilih-semua-agen")?.focus(),
        0,
      );
    },
    onError: (err, vars) => {
      invalidateAgents();
      setDeleteTarget(null);
      setDeleteError(
        `Gagal menghapus ${vars.name}: ${err instanceof Error ? err.message : "terjadi kendala."} Agen tetap ada di roster dan di ruangan 3D — coba lagi sebentar lagi.`,
      );
    },
  });
  const bulkDeleteMut = useMutation({
    mutationFn: async (p: { ids: number[]; names: string }) =>
      await api.deleteAgents({ ids: p.ids }),
    onSuccess: (_res, vars) => {
      invalidateAgents();
      setDeleteError("");
      setBulkConfirmOpen(false);
      setCheckedIds([]);
      if (selectedId !== null && vars.ids.includes(selectedId)) {
        setSelectedId(null);
      }
      window.setTimeout(
        () => document.getElementById("pilih-semua-agen")?.focus(),
        0,
      );
    },
    onError: (err, vars) => {
      invalidateAgents();
      setBulkConfirmOpen(false);
      setDeleteError(
        `Gagal menghapus ${vars.names}: ${err instanceof Error ? err.message : "terjadi kendala."} Roster sudah dimuat ulang sesuai data tersimpan — periksa daftarnya lalu coba lagi bila agennya masih ada.`,
      );
    },
  });
  const resetMut = useMutation({
    mutationFn: () => api.resetRoster({}),
    onSuccess: () => {
      invalidateAgents();
      setConfirmReset(false);
      setSelectedId(null);
    },
  });
  const saveRunMut = useMutation({
    mutationFn: async (args: SaveRunArgs) => await api.saveRun(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      setSavedNote(true);
    },
  });
  const deleteRunMut = useMutation({
    mutationFn: async (id: number) => await api.deleteRun({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runs"] }),
  });

  const agents = agentsQuery.data?.agents ?? [];
  const activeAgents = useMemo(
    () =>
      agents
        .filter((a) => a.active)
        .slice()
        .sort((x, y) => roleRank(x.role) - roleRank(y.role) || x.sortOrder - y.sortOrder),
    [agents],
  );
  const selectedAgent = agents.find((a) => a.id === selectedId) ?? null;
  const stageAgent = agents.find((a) => a.id === stageId) ?? null;

  const checkedAgents = useMemo(
    () => agents.filter((a) => checkedIds.includes(a.id)),
    [agents, checkedIds],
  );
  const deleteLocked = phase === "running" || agents.length <= 1;
  const deleteNote =
    phase === "running"
      ? "Tombol hapus nonaktif selama misi berjalan agar antrean misi tidak berubah di tengah jalan."
      : agents.length <= 1
        ? "Minimal 1 agen harus tersisa di roster."
        : null;
  const bulkWouldDeleteAll =
    checkedAgents.length > 0 && checkedAgents.length >= agents.length;

  useEffect(() => {
    const el = selectAllRef.current;
    if (el) {
      el.indeterminate =
        checkedAgents.length > 0 && checkedAgents.length < agents.length;
    }
  }, [checkedAgents.length, agents.length]);

  function openDelete(agent: Agent, el: HTMLElement | null) {
    triggerRef.current = el;
    setDeleteError("");
    setDeleteTarget(agent);
  }

  const plazaAgents: PlazaAgent[] = useMemo(
    () =>
      agents.map((a) => ({
        id: a.id,
        name: a.model,
        role: a.role,
        color: a.color,
        charKey: a.charKey,
        active: a.active,
      })),
    [agents],
  );

  const doneIds = useMemo(
    () => liveSteps.filter((s) => s.status === "done").map((s) => s.agentId),
    [liveSteps],
  );

  // Timer durasi nyata saat misi berjalan.
  useEffect(() => {
    if (phase !== "running") return;
    const iv = setInterval(() => {
      setElapsedMs(performance.now() - startRef.current);
    }, 100);
    return () => clearInterval(iv);
  }, [phase]);

  // Log selalu gulir ke entri terbaru.
  useEffect(() => {
    const box = logBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [log]);

  // Batalkan run saat komponen dilepas.
  useEffect(() => {
    return () => {
      runIdRef.current += 1;
    };
  }, []);

  const pushLog = (text: string) =>
    setLog((prev) => [...prev.slice(-79), { time: nowTime(), text }]);

  async function runMission() {
    const text = mission.trim();
    if (!text) {
      setMissionError("Tulis dulu misinya, lalu jalankan.");
      return;
    }
    if (activeAgents.length === 0) {
      setMissionError("Aktifkan minimal 1 agen di roster untuk menjalankan misi.");
      return;
    }
    setMissionError("");
    const queue = activeAgents;
    const myRun = runIdRef.current + 1;
    runIdRef.current = myRun;
    const alive = () => runIdRef.current === myRun;

    setLiveSteps([]);
    setRunTotal(queue.length);
    setLog([]);
    setFinalSynthesis(null);
    setSavedNote(false);
    setCopied(false);
    setCopyError("");
    setElapsedMs(0);
    startRef.current = performance.now();
    setPhase("running");
    pushLog(`Misi dimulai dengan ${queue.length} agen aktif.`);

    const headlines: string[] = [];
    const steps: LiveStep[] = [];
    let editorText: string | null = null;

    for (let i = 0; i < queue.length; i++) {
      const agent = queue[i];
      if (!agent) break;
      if (!alive()) return;
      const label = `${agent.provider} · ${agent.model}`;
      setStageId(agent.id);
      setBubble(BUBBLES[agent.role] ?? "Giliran saya berkontribusi.");
      const thinking: LiveStep = {
        agentId: agent.id,
        label,
        role: agent.role,
        color: agent.color,
        charKey: agent.charKey,
        headline: "",
        text: "",
        status: "thinking",
      };
      steps.push(thinking);
      setLiveSteps([...steps]);
      pushLog(`${label} (${agent.role}) berjalan ke mejanya, duduk, dan mulai mengetik…`);
      await sleep(reducedMotion ? 500 : 1300 + (i % 3) * 300);
      if (!alive()) return;

      const draft = buildContribution(agent.role, text, headlines);
      let body = draft.text;
      if (agent.instruction.trim()) {
        body += `\nInstruksi khusus dari pengguna untuk agen ini: “${agent.instruction.trim()}” — diterapkan pada kontribusi di atas.`;
      }
      const done: LiveStep = { ...thinking, headline: draft.headline, text: body, status: "done" };
      steps[i] = done;
      setLiveSteps([...steps]);
      headlines.push(`${label} — ${draft.headline}`);
      if (agent.role === "Editor dan Peringkas") editorText = body;
      pushLog(`${label} selesai: ${draft.headline}.`);
      setBubble(null);
      await sleep(reducedMotion ? 150 : 450);
      if (!alive()) return;
    }

    const duration = performance.now() - startRef.current;
    setElapsedMs(duration);
    const synthesis = editorText ?? buildSynthesis(text, headlines);
    setFinalSynthesis(synthesis);
    setStageId(null);
    setBubble(null);
    setPhase("done");
    pushLog(`Misi selesai dalam ${formatDuration(duration)}. Hasil akhir tersimpan otomatis ke Riwayat.`);
    saveRunMut.mutate({
      mission: text,
      synthesis,
      durationMs: Math.round(duration),
      agentsUsed: queue.map((a) => ({ provider: a.provider, model: a.model, role: a.role })),
      steps: steps.map((s) => {
        const [provider = "", model = ""] = s.label.split(" · ");
        return { provider, model, role: s.role, text: s.text };
      }),
    });
  }

  function stopMission() {
    runIdRef.current += 1;
    setPhase("stopped");
    setStageId(null);
    setBubble(null);
    setLiveSteps((prev) =>
      prev.map((s) => (s.status === "thinking" ? { ...s, status: "done", headline: "Dihentikan", text: "Langkah ini dihentikan sebelum selesai." } : s)),
    );
    pushLog("Misi dihentikan oleh pengguna. Hasil parsial tidak disimpan ke Riwayat.");
  }

  async function copySynthesis() {
    if (!finalSynthesis) return;
    setCopyError("");
    let ok = false;
    try {
      await navigator.clipboard.writeText(finalSynthesis);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = finalSynthesis;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyError(
        "Gagal menyalin otomatis. Tekan dan tahan teks hasil akhir di atas untuk menyalinnya secara manual.",
      );
    }
  }

  const doneCount = liveSteps.filter((s) => s.status === "done").length;
  const totalSteps = phase === "idle" ? activeAgents.length : runTotal || activeAgents.length;
  const progressPct = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0;
  const runs = runsQuery.data?.runs ?? [];
  const detailRun = runs.find((r) => r.id === detailRunId) ?? null;

  return (
    <div
      className="min-h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-500"
      style={THEME_PAGE_VARS[theme]}
    >
      <header className="pt-safe px-4 pb-2 pt-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="font-pixel text-[10px] leading-relaxed text-[var(--accent)] sm:text-[11px]">
              SPACE 3D AGEN
            </p>
            <h1 className="mt-2 font-display text-2xl font-bold leading-tight sm:text-3xl">
              Ruang Kendali Misi Multi-Agent
            </h1>
          </div>
          <p className="font-mono text-sm text-[var(--dim-on-dark)]" aria-live="polite">
            {agents.length} agen · {activeAgents.length} aktif
          </p>
        </div>
      </header>

      <main className="grid grid-cols-1 items-start gap-4 px-4 pb-10 sm:px-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* ===== Plaza 3D ===== */}
        <section
          aria-label="Kantor 3D agen"
          className="order-1 overflow-hidden rounded-[10px] border border-[var(--border-dark)] bg-[var(--ground-2)] shadow-[0_12px_32px_rgba(0,0,0,0.35)]"
        >
          <div className="border-b border-[var(--border-dark)] px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span
                id="latar-luar-label"
                className="font-mono text-xs font-semibold text-[var(--dim-on-dark)]"
              >
                Latar Luar
              </span>
              <div
                role="radiogroup"
                aria-labelledby="latar-luar-label"
                className="flex flex-wrap gap-2"
              >
                {THEME_OPTIONS.map((opt) => {
                  const isActive = theme === opt.id;
                  return (
                    <label key={opt.id} className="cursor-pointer">
                      <input
                        type="radio"
                        name="latar-luar"
                        value={opt.id}
                        checked={isActive}
                        onChange={() => chooseTheme(opt.id)}
                        className="peer sr-only"
                        aria-label={`Latar luar ${opt.name} — ${opt.desc}`}
                      />
                      <span
                        className={`flex min-h-11 items-center gap-2 rounded-md border px-2.5 py-1.5 text-[var(--text)] transition-colors peer-checked:border-[var(--accent)] peer-checked:bg-[var(--bg)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--ground-2)] ${
                          isActive
                            ? "border-[var(--accent)] bg-[var(--bg)]"
                            : "border-[var(--border-dark)] bg-[var(--ink)]/40"
                        }`}
                      >
                        <ThemePreview theme={opt.id} />
                        <span className="text-left leading-tight">
                          <span className="block text-sm font-bold">{opt.name}</span>
                          <span className="block text-[11px] text-[var(--dim-on-dark)]">
                            {opt.desc}
                          </span>
                        </span>
                        {isActive && (
                          <span
                            className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-bold text-[var(--accent-ink)]"
                            aria-hidden="true"
                          >
                            <Icon d={I.check} size={11} /> Terpilih
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <p className="mt-1.5 font-mono text-[11px] text-[var(--dim-on-dark)]" aria-live="polite">
              Tema aktif: {THEME_OPTIONS.find((o) => o.id === theme)?.name} — interior
              kantor ikut menyesuaikan, pilihan tersimpan otomatis.
            </p>
            {themeError && (
              <p className="mt-1 text-sm font-semibold text-[#ff9d94]" role="alert">
                {themeError}
              </p>
            )}
          </div>
          <div className="relative h-[380px] sm:h-[460px] lg:h-[540px]">
            {webglError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <Icon d={I.cube} size={34} />
                <p className="max-w-md text-base font-semibold text-[var(--text)]">{webglError}</p>
                <p className="max-w-md text-sm text-[var(--dim-on-dark)]">
                  Semua fungsi misi tetap jalan: pilih agen dari daftar di bawah atau dari panel Roster.
                </p>
                <div className="mt-2 flex max-w-full flex-wrap justify-center gap-2">
                  {agents.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      className="flex min-h-11 items-center gap-2 rounded-md border border-[var(--border-dark)] bg-[var(--bg)] px-2.5 text-sm font-semibold text-[var(--text)]"
                      aria-pressed={selectedId === a.id}
                    >
                      <img src={characterDataUrl(a.charKey, a.color)} alt="" width={26} height={26} className="pixel-img" />
                      {a.model}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <Plaza3D
                agents={plazaAgents}
                theme={theme}
                selectedId={selectedId}
                workingId={phase === "running" ? stageId : null}
                doneIds={doneIds}
                running={phase === "running"}
                bubble={bubble}
                ambientPaused={ambientPaused}
                reducedMotion={reducedMotion}
                cameraResetNonce={cameraResetNonce}
                onSelect={(id) => setSelectedId(id)}
                onError={(msg) => setWebglError(msg)}
                onStatuses={setAgentStatuses}
                onLabelsHidden={setHiddenLabels}
              />
            )}
            {!webglError && (
              <>
                {hiddenLabels > 0 && (
                  <p className="absolute left-3 top-3 max-w-[70%] rounded-md bg-[var(--ink)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text)]" role="status">
                    {hiddenLabels} label agen disembunyikan sementara agar tidak bertumpuk — putar atau zoom kamera untuk melihatnya
                  </p>
                )}
                <div className="pointer-events-none absolute inset-x-3 bottom-2 flex flex-wrap items-end gap-x-3 gap-y-2">
                  <p className="max-w-[62%] font-mono text-[11px] text-[var(--dim-on-dark)] sm:max-w-[46%]">
                    Seret untuk memutar 360°
                    <span className="hidden sm:inline"> · Cubit / gulir untuk zoom · Tombol panah memutar saat kanvas fokus</span>
                    {" "}· Ketuk karakter untuk memilih
                  </p>
                  <div className="pointer-events-auto ml-auto flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCameraResetNonce((n) => n + 1)}
                      className="inline-flex items-center rounded-md border border-[var(--border-dark)] bg-[var(--ink)] px-3 text-xs font-semibold text-[var(--text)] shadow-[0_6px_18px_rgba(0,0,0,0.4)]"
                    >
                      Reset Kamera
                    </button>
                    <button
                      type="button"
                      aria-pressed={ambientPaused}
                      onClick={() => setAmbientPaused((v) => !v)}
                      className="inline-flex items-center rounded-md border border-[var(--border-dark)] bg-[var(--ink)] px-3 text-xs font-semibold text-[var(--text)] shadow-[0_6px_18px_rgba(0,0,0,0.4)]"
                    >
                      {ambientPaused ? "Lanjutkan Animasi Santai" : "Jeda Animasi Santai"}
                    </button>
                  </div>
                </div>
              </>
            )}
            {stageAgent && phase === "running" && (
              <p className="absolute right-3 top-3 rounded-md bg-[var(--ink)] px-3 py-1.5 font-mono text-xs text-[var(--accent)]">
                Sedang bekerja: {stageAgent.provider} · {stageAgent.model}
              </p>
            )}
          </div>
        </section>

        {/* ===== Kolom kanan: Misi, Roster, Hasil, Riwayat ===== */}
        <div className="order-2 flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {/* Misi */}
          <section aria-label="Misi" className={panelCls}>
            <PanelTitle>Misi</PanelTitle>
            <label htmlFor="misi" className={labelCls}>
              Tulis misi untuk tim agen
            </label>
            <textarea
              id="misi"
              className={inputCls}
              rows={4}
              {...FIELDS.saveRun.mission}
              placeholder="cth. Rancang rencana peluncuran produk minuman herbal untuk pasar anak muda…"
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              disabled={phase === "running"}
            />
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Preset misi">
              {MISSION_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled={phase === "running"}
                  className="inline-flex min-h-9 items-center rounded-full border border-[var(--ink)] px-3 text-sm font-semibold disabled:opacity-40"
                  onClick={() => {
                    setMission(p.text);
                    setMissionError("");
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {missionError && (
              <p className="mt-2 text-sm font-semibold text-[var(--danger)]" role="alert">
                {missionError}
              </p>
            )}
            {phase === "running" ? (
              <button
                type="button"
                onClick={stopMission}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border-2 border-[var(--danger)] px-4 font-display text-base font-bold text-[var(--danger)]"
              >
                <Icon d={I.stop} size={17} /> Berhenti
              </button>
            ) : (
              <button
                type="button"
                onClick={runMission}
                disabled={activeAgents.length === 0}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 font-display text-base font-bold text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon d={I.play} size={17} /> Jalankan Misi
              </button>
            )}
            <p className="mt-2 text-center text-xs font-medium text-[var(--dim)]">
              Simulasi orkestrasi lokal — bukan panggilan API provider.
            </p>
            {(phase === "running" || phase === "done" || phase === "stopped") && (
              <div className="mt-3" aria-live="polite">
                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
                  role="progressbar"
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Kemajuan langkah misi"
                >
                  <div
                    className="h-full bg-[var(--accent)] transition-[width] duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="mt-1.5 font-mono text-xs text-[var(--ink-soft)]">
                  Langkah {doneCount}/{totalSteps} selesai · Durasi {formatDuration(elapsedMs)}
                  {phase === "stopped" ? " · Dihentikan" : ""}
                </p>
              </div>
            )}
          </section>

          {/* Roster */}
          <section aria-label="Roster agen" className={panelCls}>
            <PanelTitle
              right={
                confirmReset ? (
                  <span className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center rounded-md bg-[var(--danger)] px-2.5 text-xs font-bold text-white"
                      onClick={() => resetMut.mutate()}
                    >
                      Yakin reset
                    </button>
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center rounded-md border border-[var(--ink)] px-2.5 text-xs font-semibold"
                      onClick={() => setConfirmReset(false)}
                    >
                      Batal
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[var(--ink)] px-2.5 text-xs font-semibold"
                    onClick={() => setConfirmReset(true)}
                  >
                    <Icon d={I.reset} size={14} /> Reset roster
                  </button>
                )
              }
            >
              Roster Agen
            </PanelTitle>

            {agentsQuery.isPending ? (
              <p className="text-sm text-[var(--dim)]">Memuat roster…</p>
            ) : agentsQuery.isError ? (
              <p className="text-sm font-semibold text-[var(--danger)]">
                Roster gagal dimuat. Coba muat ulang halaman.
              </p>
            ) : (
              <>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <input
                    ref={selectAllRef}
                    id="pilih-semua-agen"
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-[#1a1813]"
                    checked={
                      agents.length > 0 &&
                      checkedAgents.length === agents.length
                    }
                    disabled={phase === "running" || agents.length === 0}
                    onChange={(e) =>
                      setCheckedIds(
                        e.target.checked ? agents.map((a) => a.id) : [],
                      )
                    }
                    aria-label="Pilih semua agen"
                  />
                  <label
                    htmlFor="pilih-semua-agen"
                    className="text-sm font-semibold"
                  >
                    Pilih semua
                  </label>
                  <span className="ml-auto font-mono text-xs text-[var(--dim)]">
                    {checkedAgents.length > 0
                      ? `${checkedAgents.length} terpilih`
                      : `${agents.length} agen`}
                  </span>
                </div>
                {checkedAgents.length > 0 && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-[var(--ink)] px-3 py-2 text-[var(--text)]">
                    <span className="text-sm font-bold" role="status">
                      {checkedAgents.length} agen terpilih
                    </span>
                    <span className="ml-auto flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={phase === "running"}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-[var(--danger)] px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={(e) => {
                          triggerRef.current = e.currentTarget;
                          setDeleteError("");
                          setBulkConfirmOpen(true);
                        }}
                      >
                        <Icon d={I.trash} size={15} /> Hapus yang dipilih
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center rounded-md border border-[var(--text)] px-3 text-sm font-semibold"
                        onClick={() => setCheckedIds([])}
                      >
                        Batalkan pilihan
                      </button>
                    </span>
                  </div>
                )}
                {deleteNote && (
                  <p className="mb-2 text-xs font-medium text-[var(--dim)]">
                    {deleteNote}
                  </p>
                )}
                {deleteError && (
                  <p
                    className="mb-2 text-sm font-semibold text-[var(--danger)]"
                    role="alert"
                  >
                    {deleteError}
                  </p>
                )}
              <ul className="divide-y divide-[var(--border)]">
                {agents.map((a) => {
                  const isSel = selectedId === a.id;
                  const isStage = stageId === a.id;
                  return (
                    <li
                      key={a.id}
                      className={`rounded-md px-1.5 py-1.5 ${
                        isSel ? "bg-[var(--surface-2)]" : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-[#1a1813]"
                        checked={checkedIds.includes(a.id)}
                        disabled={phase === "running"}
                        onChange={(e) =>
                          setCheckedIds((prev) =>
                            e.target.checked
                              ? [...prev, a.id]
                              : prev.filter((x) => x !== a.id),
                          )
                        }
                        aria-label={`Pilih ${a.provider} ${a.model} untuk hapus massal`}
                      />
                      <button
                        type="button"
                        onClick={() => setSelectedId(isSel ? null : a.id)}
                        aria-pressed={isSel}
                        aria-label={`Pilih agen ${a.provider} ${a.model}, role ${a.role}`}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <span className="relative shrink-0">
                          <img
                            src={characterDataUrl(a.charKey, a.color)}
                            alt=""
                            width={40}
                            height={40}
                            className="pixel-img rounded-md border border-[var(--border)] bg-[var(--ground-2)]"
                            style={{ opacity: a.active ? 1 : 0.45 }}
                          />
                          {a.active && (
                            <span
                              className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[var(--surface)] bg-[var(--accent)]"
                              aria-hidden="true"
                            />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold leading-tight">
                            {a.provider} · {a.model}
                          </span>
                          <span className="block truncate text-xs font-medium text-[var(--dim)]">
                            {a.role}
                            {a.isCustom ? " · kustom" : ""}
                          </span>
                          <span className="block truncate text-xs font-semibold text-[var(--ink-soft)]">
                            {!a.active
                              ? "Nonaktif"
                              : phase === "running"
                                ? isStage
                                  ? "Bekerja — mengetik"
                                  : doneIds.includes(a.id)
                                    ? "Selesai"
                                    : "Menunggu giliran"
                                : (agentStatuses[a.id] ?? "Santai")}
                          </span>
                        </span>
                      </button>
                      <div className="flex items-center gap-2 max-sm:basis-full max-sm:justify-end">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={a.active}
                        aria-label={`${a.active ? "Nonaktifkan" : "Aktifkan"} ${a.provider} ${a.model}`}
                        onClick={() => updateMut.mutate({ id: a.id, active: !a.active })}
                        className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
                          a.active
                            ? "border-[var(--ink)] bg-[var(--accent)]"
                            : "border-[var(--border)] bg-[var(--surface-2)]"
                        }`}
                      >
                        <span
                          className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-[var(--ink)] transition-[left] ${
                            a.active ? "left-6" : "left-1 bg-[var(--dim)]"
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        disabled={deleteLocked}
                        aria-label={`Hapus ${shortName(a.model)}`}
                        data-hapus-roster
                        title={
                          deleteLocked
                            ? phase === "running"
                              ? "Nonaktif selama misi berjalan"
                              : "Minimal 1 agen harus tersisa"
                            : undefined
                        }
                        onClick={(e) => openDelete(a, e.currentTarget)}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[var(--danger)] px-3 text-sm font-semibold text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Icon d={I.trash} size={15} /> Hapus
                      </button>
                      </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              </>
            )}

            {selectedAgent && (
              <AgentEditor
                key={selectedAgent.id}
                agent={selectedAgent}
                onUpdate={(patch) => updateMut.mutate(patch)}
                onRequestDelete={(agent, el) => openDelete(agent, el)}
                deleteDisabled={deleteLocked}
                deleteNote={deleteNote}
              />
            )}

            {showAdd ? (
              <AddAgentForm
                pending={addMut.isPending}
                onCancel={() => setShowAdd(false)}
                onAdd={(a) => addMut.mutate(a)}
              />
            ) : (
              <button
                type="button"
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-dashed border-[var(--ink)] px-3 text-sm font-semibold"
                onClick={() => setShowAdd(true)}
              >
                <Icon d={I.plus} size={15} /> Tambah agen kustom
              </button>
            )}
          </section>

          {/* Hasil Akhir */}
          <section aria-label="Hasil akhir" className={panelCls}>
            <PanelTitle
              right={
                finalSynthesis ? (
                  <button
                    type="button"
                    onClick={copySynthesis}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[var(--ink)] px-2.5 text-xs font-semibold"
                  >
                    <Icon d={copied ? I.check : I.copy} size={14} />
                    {copied ? "Tersalin" : "Salin"}
                  </button>
                ) : undefined
              }
            >
              Hasil Akhir
            </PanelTitle>
            {finalSynthesis ? (
              <div className="spring-in">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{finalSynthesis}</p>
                <p className="mt-3 font-mono text-xs text-[var(--dim)]">
                  {finalSynthesis.length.toLocaleString("id-ID")} karakter
                  {savedNote ? " · Tersimpan otomatis ke Riwayat" : ""}
                </p>
                {copied && (
                  <p className="mt-2 text-sm font-semibold text-[var(--ink-soft)]" role="status">
                    Hasil akhir tersalin ke clipboard.
                  </p>
                )}
                {copyError && (
                  <p className="mt-2 text-sm font-semibold text-[var(--danger)]" role="alert">
                    {copyError}
                  </p>
                )}
              </div>
            ) : phase === "stopped" ? (
              <p className="text-sm text-[var(--ink-soft)]">
                Misi dihentikan sebelum selesai, jadi belum ada hasil akhir. Kontribusi yang sempat
                masuk bisa dibaca di panel Kontribusi Agen.
              </p>
            ) : (
              <p className="text-sm text-[var(--ink-soft)]">
                Hasil akhir muncul di sini setelah misi selesai dijalankan: sintesis gabungan dari
                semua agen aktif, disusun oleh Editor atau dirangkum otomatis dari kontribusi tim.
              </p>
            )}
          </section>

          {/* Riwayat */}
          <section aria-label="Riwayat misi" className={panelCls}>
            <PanelTitle>Riwayat Misi</PanelTitle>
            {runsQuery.isPending ? (
              <p className="text-sm text-[var(--dim)]">Memuat riwayat…</p>
            ) : runs.length === 0 ? (
              <div>
                <p className="text-sm text-[var(--ink-soft)]">
                  Belum ada misi yang dijalankan, jadi riwayat masih kosong.
                </p>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">
                  Langkah berikutnya: tulis misi di panel Misi, lalu tekan Jalankan Misi — hasilnya
                  tersimpan di sini otomatis.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {runs.map((r) => (
                  <li key={r.id} className="py-2.5">
                    <p className="text-sm font-bold leading-snug">{r.mission}</p>
                    <p className="mt-0.5 font-mono text-xs text-[var(--dim)]">
                      {formatDate(r.createdAt)} · {r.agentCount} agen · {formatDuration(r.durationMs)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="inline-flex min-h-9 items-center gap-1 rounded-md border border-[var(--ink)] px-2.5 text-xs font-semibold"
                        aria-expanded={detailRunId === r.id}
                        onClick={() => setDetailRunId(detailRunId === r.id ? null : r.id)}
                      >
                        <Icon d={I.chevron} size={13} /> Detail
                      </button>
                      <button
                        type="button"
                        className="inline-flex min-h-9 items-center gap-1 rounded-md border border-[var(--danger)] px-2.5 text-xs font-semibold text-[var(--danger)]"
                        aria-label={`Hapus riwayat misi ${r.mission}`}
                        onClick={() => deleteRunMut.mutate(r.id)}
                      >
                        <Icon d={I.trash} size={13} /> Hapus
                      </button>
                    </div>
                    {detailRunId === r.id && detailRun && (
                      <div className="spring-in mt-2 rounded-md bg-[var(--surface-2)] p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-soft)]">
                          Agen yang dipakai
                        </p>
                        <p className="mt-1 text-sm">
                          {detailRun.agentsUsed
                            .map((a) => `${a.provider} · ${a.model} (${a.role})`)
                            .join("; ")}
                        </p>
                        {detailRun.steps.map((s, i) => (
                          <div key={i} className="mt-3">
                            <p className="text-sm font-bold">
                              {s.provider} · {s.model} — {s.role}
                            </p>
                            <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">
                              {s.text}
                            </p>
                          </div>
                        ))}
                        <p className="mt-3 border-t border-[var(--border)] pt-2 text-xs font-bold uppercase tracking-wide text-[var(--ink-soft)]">
                          Sintesis akhir
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                          {detailRun.synthesis}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ===== Kolom kiri bawah: Kontribusi + Log ===== */}
        <div className="order-3 flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-2">
          <section aria-label="Kontribusi agen" className={panelCls}>
            <PanelTitle>Kontribusi Agen</PanelTitle>
            {liveSteps.length === 0 ? (
              <p className="text-sm text-[var(--ink-soft)]">
                Saat misi berjalan, tiap agen aktif berjalan ke mejanya di kantor 3D, duduk, dan
                mengetik sambil menyumbang bagian sesuai role-nya di sini — koordinator membuka
                dengan rencana, lalu peneliti, penalar, programmer, penulis, spesialis bahasa,
                pengkritik, dan editor menutup dengan sintesis. Di luar misi, mereka santai:
                ngopi, main game, atau ngobrol di kantor.
              </p>
            ) : (
              <ol className="flex flex-col gap-3">
                {liveSteps.map((s) => (
                  <li
                    key={s.agentId}
                    className="log-in rounded-lg border border-[var(--border)] bg-white/50 p-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <img
                        src={characterDataUrl(s.charKey, s.color)}
                        alt=""
                        width={34}
                        height={34}
                        className="pixel-img rounded-md border border-[var(--border)] bg-[var(--ground-2)]"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold leading-tight">{s.label}</p>
                        <p className="text-xs font-medium text-[var(--dim)]">{s.role}</p>
                      </div>
                      {s.status === "thinking" && (
                        <span className="ml-auto flex items-center gap-1 font-mono text-xs text-[var(--ink-soft)]">
                          <span className="thinking-dot inline-block h-2 w-2 rounded-full bg-[var(--ink)]" />
                          berpikir…
                        </span>
                      )}
                    </div>
                    {s.status === "done" && (
                      <div className="mt-2">
                        <p className="text-sm font-bold">{s.headline}</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">
                          {s.text}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section
            aria-label="Log misi"
            className="rounded-[10px] border border-[var(--border-dark)] bg-[var(--ground-2)] p-4 shadow-[0_12px_32px_rgba(0,0,0,0.35)] sm:p-5"
          >
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-[var(--text)]">
              <span className="inline-block h-2.5 w-2.5 bg-[var(--accent)]" aria-hidden="true" />
              Log Misi
            </h2>
            <div
              ref={logBoxRef}
              className="max-h-56 overflow-y-auto pr-1 font-mono text-xs leading-relaxed text-[var(--dim-on-dark)]"
              aria-live="polite"
            >
              {log.length === 0 ? (
                <p>Log masih kosong. Entri berwaktu nyata akan muncul di sini selama misi berjalan.</p>
              ) : (
                log.map((e, i) => (
                  <p key={i} className="log-in">
                    <span className="text-[var(--accent)]">[{e.time}]</span> {e.text}
                  </p>
                ))
              )}
            </div>
          </section>
        </div>
      </main>

      {deleteTarget && (
        <ConfirmDialog
          title="Hapus agen ini?"
          confirmLabel="Hapus agen"
          pending={deleteMut.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() =>
            deleteMut.mutate({
              id: deleteTarget.id,
              name: `${deleteTarget.provider} · ${deleteTarget.model}`,
            })
          }
          getRestoreTarget={() => triggerRef.current}
        >
          <p>
            <strong className="text-[var(--ink)]">
              {shortName(deleteTarget.model)}
            </strong>{" "}
            — {deleteTarget.provider} · {deleteTarget.model}, role{" "}
            {deleteTarget.role}.
          </p>
          <p className="mt-2">
            Agen ini akan hilang dari roster dan dari ruangan 3D. Riwayat misi
            yang sudah tersimpan tidak ikut terhapus.
          </p>
          <p className="mt-2">
            {deleteTarget.isCustom
              ? "Agen kustom yang dihapus hilang permanen dan harus ditambah ulang bila dibutuhkan lagi."
              : "Agen bawaan bisa dikembalikan kapan saja lewat tombol Reset Roster."}
          </p>
        </ConfirmDialog>
      )}

      {bulkConfirmOpen && (
        <ConfirmDialog
          title={`Hapus ${checkedAgents.length} agen?`}
          confirmLabel={`Hapus ${checkedAgents.length} agen`}
          pending={bulkDeleteMut.isPending}
          confirmDisabled={bulkWouldDeleteAll}
          onCancel={() => setBulkConfirmOpen(false)}
          onConfirm={() =>
            bulkDeleteMut.mutate({
              ids: checkedAgents.map((a) => a.id),
              names: checkedAgents.map((a) => shortName(a.model)).join(", "),
            })
          }
          getRestoreTarget={() => triggerRef.current}
        >
          {bulkWouldDeleteAll ? (
            <p>
              Pilihan ini mencakup semua agen di roster. Minimal 1 agen harus
              tersisa, jadi penghapusan ini tidak bisa dilanjutkan — batalkan
              pilihan salah satu agen terlebih dahulu.
            </p>
          ) : (
            <>
              <p>Agen berikut akan hilang dari roster dan dari ruangan 3D:</p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                {checkedAgents.map((a) => (
                  <li key={a.id}>
                    <strong className="text-[var(--ink)]">
                      {shortName(a.model)}
                    </strong>{" "}
                    — {a.provider} · {a.model}, role {a.role}
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                Riwayat misi yang sudah tersimpan tidak ikut terhapus. Agen
                bawaan bisa dikembalikan lewat Reset Roster; agen kustom hilang
                permanen.
              </p>
            </>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
