"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  MentorCard,
  sameLabel,
  type MentorData as ViewMentor,
} from "@/components/mentors/MentorCard";
import { MentorChat } from "@/components/mentors/MentorChat";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import { DEFAULT_MENTOR_MODEL, MENTOR_MODELS, mentorModelShort } from "@/lib/mentors-constants";
import { haptic } from "@/lib/haptics";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Pressable,
  Sheet,
  Skeleton,
  fieldControlStyle,
  fieldTextareaStyle,
  T,
  TYPO,
} from "@/components/ui";
import { SegmentedTabs, SwipeDeck } from "@/components/motion";

type PageTab = "view" | "edit";
const TABS: PageTab[] = ["view", "edit"];

interface MentorLifeArea {
  id: string;
  name: string;
}

/** One row of GET /api/life-areas. */
interface LifeAreaRow {
  id: string;
  name: string;
  slug: string | null;
  category: string | null;
  description: string | null;
  priority: number;
  active: boolean;
  /** How many mentors point at this area. Shown in the management list. */
  mentorCount: number;
  /** Mentors + goals + activities + schedules + logs + records + energy pillars. */
  linkedCount: number;
}

/** Categories accepted by /api/life-areas. Keys are ASCII, labels are Polish. */
const AREA_CATEGORIES: { key: string; label: string }[] = [
  { key: "zdrowie", label: "Zdrowie" },
  { key: "nauka", label: "Nauka" },
  { key: "praca", label: "Praca" },
  { key: "rozwoj", label: "Rozwój" },
  { key: "energia", label: "Energia" },
];

/**
 * The seven energy pillars from docs/ENERGIA-SPEC.md, offered as one-tap suggestions.
 * Nothing is created automatically: the user taps a chip and that single area is added.
 */
const ENERGY_AREA_SUGGESTIONS = [
  "Umysł",
  "Odżywianie",
  "Nawodnienie",
  "Ruch",
  "Sen",
  "Świeże powietrze",
  "Suplementacja",
];

function categoryLabel(key: string | null): string | null {
  if (!key) return null;
  return AREA_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

/** "1 mentor" / "4 mentorów" — same plural rule as the header of this screen. */
function mentorCountLabel(n: number): string {
  if (n === 0) return "brak mentorów";
  return n === 1 ? "1 mentor" : `${n} mentorów`;
}

/** Sort used everywhere the area list is rebuilt: active first, then priority, then name. */
function byArea(a: LifeAreaRow, b: LifeAreaRow): number {
  if (a.active !== b.active) return a.active ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.name.localeCompare(b.name, "pl");
}

interface EditMentor {
  id: string;
  name: string;
  role: string;
  persona: string;
  systemPrompt: string;
  avatarEmoji: string | null;
  model: string;
  active: boolean;
  sortOrder: number;
  lifeAreas: MentorLifeArea[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/* ------------------------------------------------------------------ */
/*  Interface icons — SVG, stroke 1.75, round caps (never emoji)       */
/* ------------------------------------------------------------------ */

function Icon({ children, size = 20 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

const ChatIcon = () => (
  <Icon>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </Icon>
);

const HistoryIcon = () => (
  <Icon>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </Icon>
);

const PencilIcon = () => (
  <Icon>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Icon>
);

const PlusIcon = () => (
  <Icon>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Icon>
);

const TrashIcon = () => (
  <Icon size={18}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Icon>
);

/* ------------------------------------------------------------------ */
/*  Shared chip                                                        */
/* ------------------------------------------------------------------ */

function AreaChip({ children, tone = "accent" }: { children: React.ReactNode; tone?: "accent" | "muted" }) {
  const accent = tone === "accent";
  return (
    <span
      style={{
        // TYPO.footnote (13px), not a hardcoded 12: the same chip rendered by
        // MentorCard on the tile uses it, and a name printed at two different sizes
        // on one screen reads as a rendering bug.
        ...TYPO.footnote,
        fontWeight: 700,
        color: accent ? T.primaryOnSurface : T.text3,
        background: accent ? T.primarySoft : T.surface2,
        border: `1px solid ${accent ? T.borderAccent : T.border}`,
        borderRadius: T.rFull,
        padding: "4px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Switch drawing (track + knob). Tokens only, no hex anywhere. */
function SwitchTrack({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        flexShrink: 0,
        width: 52,
        height: 32,
        borderRadius: T.rFull,
        background: on ? T.primary : T.surface3,
        border: `1px solid ${on ? T.borderAccent : T.border}`,
        transition: "background-color 140ms linear",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 23 : 3,
          width: 24,
          height: 24,
          borderRadius: T.rFull,
          background: T.bgElevated,
          boxShadow: T.elev1,
          transition: "left 160ms var(--ease-ios, ease)",
        }}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function MentorsPage() {
  const [tab, setTab] = useState<PageTab>("view");

  // View tab
  const [mentors, setMentors] = useState<ViewMentor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsMentor, setDetailsMentor] = useState<ViewMentor | null>(null);
  const [chatMentor, setChatMentor] = useState<ViewMentor | null>(null);

  // Edit tab
  const [editMentors, setEditMentors] = useState<EditMentor[]>([]);
  const [areas, setAreas] = useState<LifeAreaRow[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");
  const [editingMentor, setEditingMentor] = useState<EditMentor | null>(null);
  const [showMentorForm, setShowMentorForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [mentorForm, setMentorForm] = useState({
    name: "",
    role: "",
    persona: "",
    systemPrompt: "",
    avatarEmoji: "🧑‍🏫",
    model: DEFAULT_MENTOR_MODEL,
    active: true,
    lifeAreaIds: [] as string[],
  });

  // ─── Life areas: the owner had no place to add one, only a read-only GET ───
  const [areaSheetOpen, setAreaSheetOpen] = useState(false);
  const [areaEditingId, setAreaEditingId] = useState<string | null>(null);
  const [areaForm, setAreaForm] = useState({ name: "", category: "", description: "" });
  const [areaSaving, setAreaSaving] = useState(false);
  const [areaError, setAreaError] = useState("");
  /** Sheet opened from inside the mentor form: a freshly created area is ticked at once. */
  const [areaSelectAfterCreate, setAreaSelectAfterCreate] = useState(false);
  /** Area waiting for the "it has history attached" confirmation before it goes off. */
  const [confirmAreaOff, setConfirmAreaOff] = useState<LifeAreaRow | null>(null);

  /** The editor card. Used to scroll it into view, see the effect below. */
  const formRef = useRef<HTMLDivElement | null>(null);

  // The chat is rendered from `chatMentor`; the scroll lock must key off exactly the
  // same condition, so it can never outlive the overlay.
  const chatOpen = Boolean(chatMentor);

  // ─── Fetch view mentors ───
  useEffect(() => {
    fetch("/api/mentors")
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Błąd serwera" }));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => setMentors(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  /** Reload the read-only mentor list (names, roles and area chips live there). */
  const refreshMentors = useCallback(() => {
    fetch("/api/mentors")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMentors(d))
      .catch(() => {});
  }, []);

  // ─── Fetch edit data ───
  const fetchEditData = useCallback(async () => {
    try {
      const [mentorsRes, areasRes] = await Promise.all([
        fetch("/api/admin/mentors"),
        // /api/life-areas, not /api/admin/life-areas: this one also writes (POST, PATCH,
        // DELETE) and returns the disabled areas plus the counts the list needs.
        fetch("/api/life-areas"),
      ]);
      if (mentorsRes.ok) {
        setEditMentors(await mentorsRes.json());
      } else {
        // Silence here meant an empty "Edytuj" tab with no explanation of why.
        const data = await mentorsRes.json().catch(() => ({}));
        setEditError(data.error || "Nie udało się wczytać listy mentorów");
      }
      if (areasRes.ok) setAreas(((await areasRes.json()) as LifeAreaRow[]).sort(byArea));
      else setAreas([]);
    } catch {
      setEditError("Błąd połączenia. Odśwież stronę.");
    }
  }, []);

  /**
   * Body scroll lock for the full-screen chat.
   *
   * It deliberately does NOT save and restore the previous value. "Pogadaj z mentorem"
   * lives in the details Sheet footer, and a Sheet keeps its own reference-counted lock
   * (`position: fixed` + `overflow: hidden`) until its slide-out ends. Reading the body
   * style at that moment saved "hidden" as the "previous" value and wrote it back when
   * the chat closed: the page then stayed unscrollable forever, which is the frozen
   * screen ("nie moge palcem przejechac").
   *
   * So: we only ever add our own lock, the teardown is unconditional, and it steps aside
   * when a Sheet lock is live (only a Sheet writes `position: fixed`, this effect never
   * does). Closing by Escape, by the back arrow or by leaving the route all run the same
   * teardown, because it hangs off the render condition itself.
   */
  useEffect(() => {
    if (!chatOpen) return;
    const body = document.body;
    body.style.overflow = "hidden";
    return () => {
      if (body.style.position === "fixed") return; // a Sheet owns the lock right now
      body.style.overflow = "";
    };
  }, [chatOpen]);

  // Close chat on Escape
  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setChatMentor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen]);

  // ─── Edit actions ───
  const resetMentorForm = () => {
    setMentorForm({
      name: "",
      role: "",
      persona: "",
      systemPrompt: "",
      avatarEmoji: "🧑‍🏫",
      model: DEFAULT_MENTOR_MODEL,
      active: true,
      lifeAreaIds: [],
    });
    setEditingMentor(null);
    setShowMentorForm(false);
    setEditError("");
  };

  const openNewMentorForm = () => {
    resetMentorForm();
    // resetMentorForm() closes the form; both writes land in one batch, this one wins.
    setShowMentorForm(true);
  };

  const openEditMentor = (m: EditMentor) => {
    setEditingMentor(m);
    setMentorForm({
      name: m.name,
      role: m.role,
      persona: m.persona,
      systemPrompt: m.systemPrompt,
      avatarEmoji: m.avatarEmoji || "🧑‍🏫",
      model: m.model || DEFAULT_MENTOR_MODEL,
      active: m.active,
      lifeAreaIds: m.lifeAreas.map((la) => la.id),
    });
    setEditError("");
    setShowMentorForm(true);
  };

  /**
   * "Edytuj" from the details sheet: the editable copy of a mentor (with systemPrompt and
   * life-area ids) only exists in /api/admin/mentors, the view list does not carry it.
   *
   * Every failure used to be swallowed, so a lost connection looked exactly like a button
   * that does nothing. Now the user gets told.
   */
  const openEditById = async (id: string) => {
    try {
      const res = await fetch("/api/admin/mentors");
      if (!res.ok) throw new Error();
      const data: EditMentor[] = await res.json();
      setEditMentors(data);
      const target = data.find((m) => m.id === id);
      if (target) openEditMentor(target);
      else setEditError("Nie znaleziono tego mentora. Odśwież stronę.");
    } catch {
      setEditError("Nie udało się otworzyć edycji. Sprawdź połączenie.");
    }
  };

  /**
   * Bring the editor into view.
   *
   * The form always renders at the TOP of the "Edytuj" tab, while the "Edytuj" buttons
   * sit on cards further down the list (and one of them lives in the details Sheet, i.e.
   * on the other tab entirely). Without this, tapping "Edytuj" filled a form the user
   * could not see and read as "klikam edytuj i nic sie nie da zmienic".
   *
   * The delay lets the tab switch and the SwipeDeck height animation settle first,
   * otherwise we scroll to a position that is about to move.
   */
  useEffect(() => {
    if (!showMentorForm) return;
    const id = window.setTimeout(() => {
      formRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(id);
  }, [showMentorForm, editingMentor?.id]);

  const saveMentor = async () => {
    if (
      !mentorForm.name ||
      !mentorForm.role ||
      !mentorForm.persona ||
      !mentorForm.systemPrompt
    ) {
      haptic.warning();
      setEditError("Wypełnij wszystkie wymagane pola");
      return;
    }
    setEditLoading(true);
    setEditError("");
    try {
      const method = editingMentor ? "PUT" : "POST";
      // `active` only means something on PUT: the create endpoint ignores it and every
      // new mentor starts active, which is why the switch is rendered for edits only.
      const payload = editingMentor
        ? { id: editingMentor.id, ...mentorForm }
        : mentorForm;
      const res = await fetch("/api/admin/mentors", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        haptic.error();
        setEditError(data.error || "Błąd zapisu");
      } else {
        haptic.success();
        resetMentorForm();
        fetchEditData();
        // Refresh view list too — added/edited mentor may affect grid
        refreshMentors();
      }
    } catch {
      haptic.error();
      setEditError("Błąd połączenia");
    }
    setEditLoading(false);
  };

  const deleteMentor = async (id: string) => {
    setEditLoading(true);
    try {
      const res = await fetch("/api/admin/mentors", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      // The response used to be ignored: a failed delete still buzzed "success" and the
      // mentor quietly stayed in the list.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        haptic.error();
        setEditError(data.error || "Nie udało się usunąć mentora");
      } else {
        haptic.success();
        // Editing the mentor we just deleted would leave a form saving into nothing.
        if (editingMentor?.id === id) resetMentorForm();
        fetchEditData();
        // Refresh view list too
        refreshMentors();
      }
    } catch {
      haptic.error();
      setEditError("Błąd połączenia przy usuwaniu");
    }
    setEditLoading(false);
    setConfirmDelete(null);
  };

  /* ---------------- Life area actions ---------------- */

  const openNewArea = (selectAfterCreate: boolean) => {
    setAreaEditingId(null);
    setAreaForm({ name: "", category: "", description: "" });
    setAreaError("");
    setAreaSelectAfterCreate(selectAfterCreate);
    setAreaSheetOpen(true);
  };

  const openEditArea = (area: LifeAreaRow) => {
    setAreaEditingId(area.id);
    setAreaForm({
      name: area.name,
      category: area.category ?? "",
      description: area.description ?? "",
    });
    setAreaError("");
    setAreaSelectAfterCreate(false);
    setAreaSheetOpen(true);
  };

  /**
   * Create one area. Used by the sheet button and by every suggestion chip, so a chip
   * really is one tap: create, drop it into the list, tick it if we came from the mentor
   * form. Returns null on failure and leaves the message in the sheet.
   */
  const createArea = async (
    name: string,
    category: string,
    description: string,
  ): Promise<LifeAreaRow | null> => {
    setAreaSaving(true);
    setAreaError("");
    try {
      const res = await fetch("/api/life-areas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category: category || null, description: description || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        haptic.error();
        setAreaError(data.error || "Nie udało się dodać obszaru");
        return null;
      }
      haptic.success();
      const created = data as LifeAreaRow;
      setAreas((prev) => [...prev.filter((a) => a.id !== created.id), created].sort(byArea));
      if (areaSelectAfterCreate) {
        setMentorForm((form) =>
          form.lifeAreaIds.includes(created.id)
            ? form
            : { ...form, lifeAreaIds: [...form.lifeAreaIds, created.id] },
        );
      }
      return created;
    } catch {
      haptic.error();
      setAreaError("Błąd połączenia");
      return null;
    } finally {
      setAreaSaving(false);
    }
  };

  const saveArea = async () => {
    const name = areaForm.name.trim();
    if (name.length < 2 || name.length > 40) {
      haptic.warning();
      setAreaError("Nazwa obszaru musi mieć od 2 do 40 znaków.");
      return;
    }

    if (!areaEditingId) {
      const created = await createArea(name, areaForm.category, areaForm.description);
      if (created) setAreaSheetOpen(false);
      return;
    }

    setAreaSaving(true);
    setAreaError("");
    try {
      const res = await fetch("/api/life-areas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: areaEditingId,
          name,
          category: areaForm.category || null,
          description: areaForm.description || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        haptic.error();
        setAreaError(data.error || "Nie udało się zapisać obszaru");
      } else {
        haptic.success();
        const saved = data as LifeAreaRow;
        setAreas((prev) => prev.map((a) => (a.id === saved.id ? saved : a)).sort(byArea));
        setAreaSheetOpen(false);
        // The area name is printed on every mentor tile, so the read-only list is stale now.
        refreshMentors();
      }
    } catch {
      haptic.error();
      setAreaError("Błąd połączenia");
    }
    setAreaSaving(false);
  };

  /**
   * Turn an area off. DELETE only sets `active = false` on purpose: mentors, goals,
   * training logs and records hang off the area with a cascade, so a hard delete would
   * take the whole history with it.
   */
  const disableArea = async (area: LifeAreaRow) => {
    setEditLoading(true);
    try {
      const res = await fetch("/api/life-areas", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: area.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        haptic.error();
        setEditError(data.error || "Nie udało się wyłączyć obszaru");
      } else {
        haptic.success();
        const saved = data.area as LifeAreaRow;
        setAreas((prev) => prev.map((a) => (a.id === saved.id ? saved : a)).sort(byArea));
        refreshMentors();
      }
    } catch {
      haptic.error();
      setEditError("Błąd połączenia");
    }
    setEditLoading(false);
    setConfirmAreaOff(null);
  };

  const enableArea = async (area: LifeAreaRow) => {
    try {
      const res = await fetch("/api/life-areas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: area.id, active: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        haptic.error();
        setEditError(data.error || "Nie udało się włączyć obszaru");
      } else {
        haptic.success();
        const saved = data as LifeAreaRow;
        setAreas((prev) => prev.map((a) => (a.id === saved.id ? saved : a)).sort(byArea));
        refreshMentors();
      }
    } catch {
      haptic.error();
      setEditError("Błąd połączenia");
    }
  };

  /** The switch on an area row. Off needs a confirmation only when something hangs off it. */
  const toggleArea = (area: LifeAreaRow) => {
    if (!area.active) {
      enableArea(area);
      return;
    }
    if (area.linkedCount > 0) {
      haptic.warning();
      setConfirmAreaOff(area);
      return;
    }
    disableArea(area);
  };

  /**
   * Areas offered in the mentor form: the active ones, plus any disabled area this mentor
   * is already linked to. Without that second part, saving a mentor after switching an
   * area off would silently unlink it (the picker sends the full id list).
   */
  const pickerAreas = areas.filter(
    (a) => a.active || mentorForm.lifeAreaIds.includes(a.id),
  );

  const tabIndex = TABS.indexOf(tab);
  const changeTab = (next: PageTab) => {
    if (next === tab) return;
    haptic.selection();
    setTab(next);
    // The editable copies are loaded when the tab is actually opened. This used to be an
    // effect on `tab`, which both broke the "no setState inside an effect" rule and
    // re-ran on every identity change of the fetcher. Every route into this tab (the
    // segmented control, the swipe, both empty states, the details sheet) goes through
    // here, so one call site is enough.
    if (next === "edit") fetchEditData();
  };

  /* ---------------- VIEW PANEL ---------------- */

  const viewPanel = (
    <div>
      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: T.sp3 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="block" height={212} radius={20} />
          ))}
        </div>
      )}

      {error && (
        <div
          style={{
            ...TYPO.callout,
            color: T.dangerOnSurface,
            background: T.dangerSoft,
            border: `1px solid ${T.danger}`,
            borderRadius: T.rMd,
            padding: `${T.sp4} ${T.sp4}`,
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}

      {!loading && !error && mentors.length === 0 && (
        <Card>
          <EmptyState
            icon="🧑‍🏫"
            title="Brak mentorów"
            body="Dodaj pierwszego mentora, żeby mieć z kim rozmawiać i prowadzić dyscypliny."
            action={{
              label: "Dodaj mentora",
              onPress: () => {
                changeTab("edit");
                openNewMentorForm();
              },
            }}
          />
        </Card>
      )}

      {!loading && !error && mentors.length > 0 && (
        <div
          className="anim-stagger"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: T.sp3,
          }}
        >
          {mentors.map((mentor) => {
            const firstArea = mentor.lifeAreas[0];
            const disciplineSlug = firstArea ? slugify(firstArea) : null;
            return (
              // The tile is MentorCard now: emoji, ONE line, chips, actions. No persona,
              // no description — the full text is one tap away in the details sheet.
              <MentorCard
                key={mentor.id}
                mentor={mentor}
                onClick={setDetailsMentor}
                actions={
                  <>
                    <Button
                      size="sm"
                      fullWidth
                      iconLeft={<ChatIcon />}
                      haptic="impact"
                      onPress={(e) => {
                        e.stopPropagation();
                        setChatMentor(mentor);
                      }}
                    >
                      Pogadaj
                    </Button>

                    {disciplineSlug && (
                      <Link
                        href={`/discipline/${disciplineSlug}`}
                        onClick={(e) => e.stopPropagation()}
                        className="pressable"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          minHeight: T.tapMin,
                          width: "100%",
                          boxSizing: "border-box",
                          ...TYPO.footnote,
                          fontWeight: 700,
                          color: T.primaryOnSurface,
                          background: T.surface2,
                          border: `1px solid ${T.border}`,
                          borderRadius: T.rMd,
                          padding: `0 ${T.sp3}`,
                          textDecoration: "none",
                        }}
                      >
                        <HistoryIcon />
                        Trening
                      </Link>
                    )}
                  </>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );

  /* ---------------- EDIT PANEL ---------------- */

  const editPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
      {editError && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: T.sp3,
            ...TYPO.callout,
            color: T.dangerOnSurface,
            background: T.dangerSoft,
            border: `1px solid ${T.danger}`,
            borderRadius: T.rMd,
            padding: `${T.sp3} ${T.sp4}`,
          }}
        >
          <span style={{ minWidth: 0 }}>{editError}</span>
          <Pressable
            onPress={() => setEditError("")}
            ariaLabel="Zamknij komunikat"
            style={{ color: T.dangerOnSurface, flexShrink: 0 }}
          >
            <Icon size={18}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </Icon>
          </Pressable>
        </div>
      )}

      {showMentorForm ? (
        <div ref={formRef} style={{ scrollMarginTop: T.sp4 }}>
          <Card padding="lg">
            <h3 style={{ ...TYPO.title2, color: T.text, margin: `0 0 ${T.sp4}` }}>
              {editingMentor ? `Edytuj: ${editingMentor.name}` : "Nowy mentor"}
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: T.sp4 }}>
              <Field label="Nazwa" required>
                {(p) => (
                  <input
                    {...p}
                    style={fieldControlStyle}
                    value={mentorForm.name}
                    onChange={(e) => setMentorForm({ ...mentorForm, name: e.target.value })}
                    placeholder="np. Coach Marek"
                  />
                )}
              </Field>

              <div style={{ display: "flex", gap: T.sp3 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Field label="Rola" required>
                    {(p) => (
                      <input
                        {...p}
                        style={fieldControlStyle}
                        value={mentorForm.role}
                        onChange={(e) => setMentorForm({ ...mentorForm, role: e.target.value })}
                        placeholder="np. Trener personalny"
                      />
                    )}
                  </Field>
                </div>
                <div style={{ width: 88, flexShrink: 0 }}>
                  <Field label="Emoji">
                    {(p) => (
                      <input
                        {...p}
                        style={{ ...fieldControlStyle, textAlign: "center", padding: 0 }}
                        value={mentorForm.avatarEmoji}
                        onChange={(e) => setMentorForm({ ...mentorForm, avatarEmoji: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
              </div>

              <div>
                <label style={{ ...TYPO.footnote, fontWeight: 600, color: T.text2, display: "block", marginBottom: 6 }}>
                  Persona *
                </label>
                <VoiceTextarea
                  value={mentorForm.persona}
                  onChange={(v) => setMentorForm({ ...mentorForm, persona: v })}
                  minHeight={100}
                  placeholder="Opis osobowości i stylu mentora..."
                />
              </div>

              <div>
                <label style={{ ...TYPO.footnote, fontWeight: 600, color: T.text2, display: "block", marginBottom: 6 }}>
                  System Prompt * (realny prompt wysyłany do API)
                </label>
                <VoiceTextarea
                  value={mentorForm.systemPrompt}
                  onChange={(v) => setMentorForm({ ...mentorForm, systemPrompt: v })}
                  minHeight={150}
                  placeholder="Instrukcje systemowe dla AI..."
                />
              </div>

              <Field
                label="Model LLM"
                required
                hint="Opus dla mentorów strategicznych, Sonnet dla większości, Haiku dla szybkich odpowiedzi"
              >
                {(p) => (
                  <select
                    {...p}
                    style={fieldControlStyle}
                    value={mentorForm.model}
                    onChange={(e) => setMentorForm({ ...mentorForm, model: e.target.value })}
                  >
                    {MENTOR_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              {/* Obszary życia + zakładanie nowego bez wychodzenia z formularza */}
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: T.sp2,
                    marginBottom: T.sp2,
                  }}
                >
                  <label style={{ ...TYPO.footnote, fontWeight: 600, color: T.text2 }}>
                    Obszary życia
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconLeft={<PlusIcon />}
                    onPress={() => openNewArea(true)}
                  >
                    Nowy obszar
                  </Button>
                </div>

                {pickerAreas.length === 0 ? (
                  <p style={{ ...TYPO.footnote, color: T.text3, margin: 0 }}>
                    Nie masz jeszcze obszarów. Załóż pierwszy przyciskiem „Nowy obszar”, a
                    zaznaczy się od razu.
                  </p>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: T.sp2 }}>
                    {pickerAreas.map((la) => {
                      const checked = mentorForm.lifeAreaIds.includes(la.id);
                      return (
                        <Pressable
                          key={la.id}
                          role="checkbox"
                          ariaChecked={checked}
                          ariaLabel={la.active ? la.name : `${la.name}, wyłączony`}
                          haptic="selection"
                          noMinSize
                          onPress={() => {
                            const ids = checked
                              ? mentorForm.lifeAreaIds.filter((id) => id !== la.id)
                              : [...mentorForm.lifeAreaIds, la.id];
                            setMentorForm({ ...mentorForm, lifeAreaIds: ids });
                          }}
                          style={{
                            minHeight: T.tapMin,
                            padding: `0 ${T.sp4}`,
                            borderRadius: T.rFull,
                            ...TYPO.footnote,
                            fontWeight: 700,
                            background: checked ? T.primarySoft : T.surface2,
                            color: checked ? T.primaryOnSurface : T.text2,
                            border: `1.5px solid ${checked ? T.borderAccent : T.border}`,
                            boxShadow: checked ? T.glowAccentSoft : "none",
                            opacity: la.active ? 1 : 0.6,
                            transition: "background-color 140ms linear, color 140ms linear",
                          }}
                        >
                          {la.active ? la.name : `${la.name} (wyłączony)`}
                        </Pressable>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Aktywność: only on edit. A brand new mentor is always created active. */}
              {editingMentor && (
                <Pressable
                  role="switch"
                  ariaChecked={mentorForm.active}
                  haptic="selection"
                  noMinSize
                  onPress={() => setMentorForm({ ...mentorForm, active: !mentorForm.active })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: T.sp3,
                    width: "100%",
                    minHeight: T.tapMin,
                    padding: `${T.sp2} ${T.sp3}`,
                    borderRadius: T.rMd,
                    background: T.surface2,
                    border: `1px solid ${T.border}`,
                    textAlign: "left",
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", ...TYPO.callout, fontWeight: 600, color: T.text }}>
                      Aktywny
                    </span>
                    <span style={{ display: "block", ...TYPO.footnote, color: T.text3, marginTop: 2 }}>
                      {mentorForm.active
                        ? "Widoczny na liście mentorów i w Okrągłym Stole"
                        : "Ukryty: zostaje w bazie, ale nie pojawia się na liście"}
                    </span>
                  </span>
                  <SwitchTrack on={mentorForm.active} />
                </Pressable>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: T.sp2, marginTop: T.sp1 }}>
                <Button size="lg" fullWidth loading={editLoading} haptic="impact" onPress={saveMentor}>
                  {editingMentor ? "Zapisz zmiany" : "Dodaj mentora"}
                </Button>
                <Button variant="ghost" size="md" fullWidth onPress={resetMentorForm}>
                  Anuluj
                </Button>
              </div>

              {/* Usuwanie mentora z poziomu formularza. Ghost, nie czerwony przycisk obok
                  zapisu: prawdziwe potwierdzenie i tak dzieje się w arkuszu niżej. */}
              {editingMentor && (
                <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: T.sp3 }}>
                  <Button
                    variant="ghost"
                    size="md"
                    fullWidth
                    iconLeft={<TrashIcon />}
                    haptic="warning"
                    style={{ color: T.dangerOnSurface }}
                    onPress={() => setConfirmDelete(editingMentor.id)}
                  >
                    Usuń mentora
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      ) : (
        <Button size="md" iconLeft={<PlusIcon />} onPress={openNewMentorForm}>
          Dodaj mentora
        </Button>
      )}

      {/* ─── Obszary życia ───
          Do tej pory istniał tylko odczyt (GET /api/admin/life-areas) i żaden ekran,
          więc obszaru nie dało się dodać. Teraz siedzi tam, gdzie tworzy się trenera. */}
      <Card padding="lg">
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: T.sp3,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h3 style={{ ...TYPO.title3, color: T.text, margin: 0 }}>Obszary życia</h3>
            <p style={{ ...TYPO.footnote, color: T.text3, margin: `${T.sp1} 0 0` }}>
              Mówią, w czym pomaga mentor. Widać je na kartach i w treningach.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<PlusIcon />}
            onPress={() => openNewArea(false)}
          >
            Dodaj obszar
          </Button>
        </div>

        {areas.length === 0 ? (
          <p style={{ ...TYPO.callout, color: T.text2, margin: `${T.sp4} 0 0` }}>
            Nie masz jeszcze żadnego obszaru. Dodaj pierwszy, na przykład Ruch albo Sen.
          </p>
        ) : (
          <div style={{ marginTop: T.sp3 }}>
            {areas.map((a, i) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: T.sp2,
                  minHeight: T.tapMin,
                  paddingTop: T.sp2,
                  paddingBottom: T.sp2,
                  borderTop: i === 0 ? "none" : `1px solid ${T.border}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      ...TYPO.callout,
                      fontWeight: 600,
                      color: a.active ? T.text : T.text3,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {a.name}
                  </div>
                  <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>
                    {[
                      mentorCountLabel(a.mentorCount),
                      categoryLabel(a.category),
                      a.active ? null : "wyłączony",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>

                <Pressable
                  onPress={() => openEditArea(a)}
                  ariaLabel={`Edytuj obszar ${a.name}`}
                  style={{
                    width: T.tapMin,
                    minWidth: T.tapMin,
                    height: T.tapMin,
                    borderRadius: T.rMd,
                    background: T.surface2,
                    color: T.text2,
                    border: `1px solid ${T.border}`,
                    flexShrink: 0,
                  }}
                >
                  <PencilIcon />
                </Pressable>

                <Pressable
                  role="switch"
                  ariaChecked={a.active}
                  ariaLabel={a.active ? `Wyłącz obszar ${a.name}` : `Włącz obszar ${a.name}`}
                  haptic="selection"
                  noMinSize
                  onPress={() => toggleArea(a)}
                  style={{
                    minHeight: T.tapMin,
                    paddingLeft: T.sp1,
                    paddingRight: T.sp1,
                    flexShrink: 0,
                    background: "transparent",
                    border: "none",
                  }}
                >
                  <SwitchTrack on={a.active} />
                </Pressable>
              </div>
            ))}
          </div>
        )}
      </Card>

      {editMentors.map((m) => (
        <Card key={m.id}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: T.sp3 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: T.rFull,
                background: T.surface2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              {m.avatarEmoji || "🧑‍🏫"}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Nazwa i rola bywają tym samym zdaniem ("Psycholog zmiany nawyków"),
                  więc drugą linię drukujemy tylko wtedy, gdy naprawdę coś dokłada.
                  Persony tu nie ma: pełny opis żyje w formularzu edycji. */}
              <div style={{ ...TYPO.title3, color: T.text, overflowWrap: "anywhere" }}>{m.name}</div>
              {!sameLabel(m.name, m.role) && m.role.trim() && (
                <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>{m.role}</div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: T.sp3 }}>
                {m.lifeAreas.map((la) => (
                  <AreaChip key={la.id} tone="muted">
                    {la.name}
                  </AreaChip>
                ))}
                <span
                  style={{
                    ...TYPO.footnote,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: T.rFull,
                    background: m.active ? T.successSoft : T.dangerSoft,
                    color: m.active ? T.successOnSurface : T.dangerOnSurface,
                    border: `1px solid ${m.active ? T.success : T.danger}`,
                  }}
                >
                  {m.active ? "Aktywny" : "Nieaktywny"}
                </span>
                {/* model badge: discreet, full id only in the tooltip */}
                <span
                  title={m.model}
                  style={{
                    ...TYPO.footnote,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: T.rFull,
                    background: T.surface2,
                    color: T.text3,
                    border: `1px solid ${T.border}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {mentorModelShort(m.model)}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: T.sp2, marginTop: T.sp4 }}>
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              iconLeft={<PencilIcon />}
              onPress={() => openEditMentor(m)}
            >
              Edytuj
            </Button>
            <Pressable
              onPress={() => {
                haptic.warning();
                setConfirmDelete(m.id);
              }}
              ariaLabel={`Usuń mentora ${m.name}`}
              style={{
                width: T.tapMin,
                minWidth: T.tapMin,
                height: T.tapMin,
                borderRadius: T.rMd,
                background: T.dangerSoft,
                color: T.dangerOnSurface,
                border: `1px solid ${T.danger}`,
                flexShrink: 0,
              }}
            >
              <TrashIcon />
            </Pressable>
          </div>
        </Card>
      ))}

      {editMentors.length === 0 && !showMentorForm && (
        <Card>
          <EmptyState
            icon="🧑‍🏫"
            title="Nie masz jeszcze mentorów"
            body="Mentor to persona AI z własnym promptem i obszarami życia."
            action={{ label: "Dodaj pierwszego", onPress: openNewMentorForm }}
          />
        </Card>
      )}
    </div>
  );

  /* ---------------- RENDER ---------------- */

  const detailsSlug = detailsMentor?.lifeAreas[0] ? slugify(detailsMentor.lifeAreas[0]) : null;

  return (
    <div style={{ padding: `${T.sp6} ${T.gutter} ${T.sp6}` }}>
      {/* Header */}
      <header className="anim-in" style={{ marginBottom: T.sp5 }}>
        <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>Twój zespół</div>
        <h1 style={{ ...TYPO.title1, color: T.text, margin: 0 }}>Mentorzy</h1>
        <p style={{ ...TYPO.callout, color: T.text2, margin: `${T.sp1} 0 0` }}>
          {loading
            ? "Ładuję..."
            : mentors.length === 0
              ? "Jeszcze nikogo tu nie ma"
              : `${mentors.length} ${mentors.length === 1 ? "mentor gotowy" : "mentorów gotowych"} do rozmowy`}
        </p>
      </header>

      <SegmentedTabs
        tabs={[
          { key: "view", label: "Twoi mentorzy" },
          { key: "edit", label: "Edytuj" },
        ]}
        active={tab}
        onChange={(k) => changeTab(k as PageTab)}
        ariaLabel="Widok mentorów"
        style={{ marginBottom: T.sp4 }}
      />

      <SwipeDeck
        index={tabIndex}
        onChange={(i) => changeTab(TABS[i])}
        labels={["Twoi mentorzy", "Edytuj"]}
        ariaLabel="Panele mentorów"
        enabled={
          !detailsMentor && !confirmDelete && !chatMentor && !areaSheetOpen && !confirmAreaOff
        }
      >
        {viewPanel}
        {editPanel}
      </SwipeDeck>

      {/* ─── Details sheet ─── */}
      <Sheet
        open={Boolean(detailsMentor)}
        onClose={() => setDetailsMentor(null)}
        ariaLabel={detailsMentor?.name ?? "Mentor"}
        footer={
          detailsMentor ? (
            <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
              <Button
                size="lg"
                fullWidth
                iconLeft={<ChatIcon />}
                haptic="impact"
                onPress={() => {
                  const target = detailsMentor;
                  setDetailsMentor(null);
                  setChatMentor(target);
                }}
              >
                Pogadaj z mentorem
              </Button>
              <div style={{ display: "flex", gap: T.sp2 }}>
                {detailsSlug && (
                  <Link
                    href={`/discipline/${detailsSlug}`}
                    onClick={() => setDetailsMentor(null)}
                    className="pressable"
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      minHeight: T.ctrlMd,
                      boxSizing: "border-box",
                      ...TYPO.callout,
                      fontWeight: 700,
                      color: T.primaryOnSurface,
                      background: T.surface2,
                      border: `1px solid ${T.border}`,
                      borderRadius: T.rMd,
                      textDecoration: "none",
                    }}
                  >
                    <HistoryIcon />
                    Trening
                  </Link>
                )}
                <Button
                  variant="secondary"
                  size="md"
                  fullWidth={!detailsSlug}
                  iconLeft={<PencilIcon />}
                  style={detailsSlug ? { flex: 1 } : undefined}
                  onPress={() => {
                    const targetId = detailsMentor.id;
                    setDetailsMentor(null);
                    changeTab("edit");
                    openEditById(targetId);
                  }}
                >
                  Edytuj
                </Button>
              </div>
            </div>
          ) : null
        }
      >
        {detailsMentor && (
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: T.sp4 }}>
              <div
                className="glow-soft"
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: T.rFull,
                  background: T.primarySoft,
                  border: `1px solid ${T.borderAccent}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 38,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                {detailsMentor.avatarEmoji || "🧑‍🏫"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...TYPO.title2, color: T.text, overflowWrap: "anywhere" }}>
                  {detailsMentor.name}
                </div>
                {/* Ta sama zasada co na karcie: nie drukujemy dwa razy tego samego zdania. */}
                {!sameLabel(detailsMentor.name, detailsMentor.role) &&
                  detailsMentor.role.trim() && (
                    <div style={{ ...TYPO.footnote, color: T.text3, marginTop: T.sp1 }}>
                      {detailsMentor.role}
                    </div>
                  )}
              </div>
            </div>

            {detailsMentor.persona && (
              <section>
                <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp2 }}>Opis</div>
                <div style={{ ...TYPO.callout, color: T.text2, whiteSpace: "pre-wrap" }}>
                  {detailsMentor.persona}
                </div>
              </section>
            )}

            {detailsMentor.lifeAreas.length > 0 && (
              <section>
                <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp2 }}>Twoje obszary</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {detailsMentor.lifeAreas.map((area) => (
                    <AreaChip key={area}>{area}</AreaChip>
                  ))}
                </div>
              </section>
            )}

            {/* Styl + model w jednym rzędzie. Model jest informacją techniczną, więc
                zostaje małym znaczkiem tutaj, a nie dopiskiem przy każdej wypowiedzi. */}
            <section>
              <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp2 }}>
                {detailsMentor.style ? "Styl i model" : "Model"}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {detailsMentor.style && <AreaChip tone="muted">{detailsMentor.style}</AreaChip>}
                <span title={detailsMentor.model}>
                  <AreaChip tone="muted">{mentorModelShort(detailsMentor.model)}</AreaChip>
                </span>
              </div>
            </section>
          </div>
        )}
      </Sheet>

      {/* ─── Delete confirmation sheet ─── */}
      <Sheet
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Usunąć mentora?"
        dismissOnBackdrop={false}
        footer={
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
            <Button
              variant="danger"
              size="lg"
              fullWidth
              loading={editLoading}
              haptic="warning"
              onPress={() => confirmDelete && deleteMentor(confirmDelete)}
            >
              Usuń mentora
            </Button>
            <Button variant="ghost" size="md" fullWidth onPress={() => setConfirmDelete(null)}>
              Anuluj
            </Button>
          </div>
        }
      >
        <p style={{ ...TYPO.callout, color: T.text2, margin: 0 }}>
          Tej operacji nie da się cofnąć. Rozmowy z tym mentorem przestaną być dostępne.
        </p>
      </Sheet>

      {/* ─── Obszar życia: dodawanie i edycja ─── */}
      <Sheet
        open={areaSheetOpen}
        onClose={() => setAreaSheetOpen(false)}
        title={areaEditingId ? "Edytuj obszar" : "Nowy obszar życia"}
        footer={
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
            <Button size="lg" fullWidth loading={areaSaving} haptic="impact" onPress={saveArea}>
              {areaEditingId ? "Zapisz obszar" : "Dodaj obszar"}
            </Button>
            <Button variant="ghost" size="md" fullWidth onPress={() => setAreaSheetOpen(false)}>
              Anuluj
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: T.sp4 }}>
          {areaError && (
            <div
              role="alert"
              style={{
                ...TYPO.callout,
                color: T.dangerOnSurface,
                background: T.dangerSoft,
                border: `1px solid ${T.danger}`,
                borderRadius: T.rMd,
                padding: `${T.sp3} ${T.sp4}`,
              }}
            >
              {areaError}
            </div>
          )}

          <Field label="Nazwa" required hint="Od 2 do 40 znaków, na przykład Sen albo Nawodnienie.">
            {(p) => (
              <input
                {...p}
                style={fieldControlStyle}
                value={areaForm.name}
                onChange={(e) => setAreaForm({ ...areaForm, name: e.target.value })}
                placeholder="np. Ruch"
              />
            )}
          </Field>

          <div>
            <label
              style={{
                ...TYPO.footnote,
                fontWeight: 600,
                color: T.text2,
                display: "block",
                marginBottom: T.sp2,
              }}
            >
              Kategoria (opcjonalna)
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: T.sp2 }}>
              {[{ key: "", label: "Bez kategorii" }, ...AREA_CATEGORIES].map((c) => {
                const checked = areaForm.category === c.key;
                return (
                  <Pressable
                    key={c.key || "brak"}
                    role="radio"
                    ariaChecked={checked}
                    haptic="selection"
                    noMinSize
                    onPress={() => setAreaForm({ ...areaForm, category: c.key })}
                    style={{
                      minHeight: T.tapMin,
                      padding: `0 ${T.sp4}`,
                      borderRadius: T.rFull,
                      ...TYPO.footnote,
                      fontWeight: 700,
                      background: checked ? T.primarySoft : T.surface2,
                      color: checked ? T.primaryOnSurface : T.text2,
                      border: `1.5px solid ${checked ? T.borderAccent : T.border}`,
                      transition: "background-color 140ms linear, color 140ms linear",
                    }}
                  >
                    {c.label}
                  </Pressable>
                );
              })}
            </div>
          </div>

          <div>
            <label
              style={{
                ...TYPO.footnote,
                fontWeight: 600,
                color: T.text2,
                display: "block",
                marginBottom: 6,
              }}
            >
              Opis (opcjonalny)
            </label>
            <textarea
              style={fieldTextareaStyle}
              value={areaForm.description}
              onChange={(e) => setAreaForm({ ...areaForm, description: e.target.value })}
              placeholder="Po co ten obszar i co się w nim liczy..."
            />
          </div>

          {/* Podpowiedzi: siedem filarów energii. Nic nie powstaje samo, jedno
              dotknięcie zakłada dokładnie ten jeden obszar. */}
          {!areaEditingId && (
            <div>
              <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp2 }}>
                Filary energii, jednym dotknięciem
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: T.sp2 }}>
                {ENERGY_AREA_SUGGESTIONS.map((name) => {
                  const exists = areas.some(
                    (a) => a.name.trim().toLowerCase() === name.toLowerCase(),
                  );
                  return (
                    <Pressable
                      key={name}
                      disabled={exists || areaSaving}
                      ariaLabel={exists ? `${name}, już masz ten obszar` : `Dodaj obszar ${name}`}
                      haptic="impact"
                      noMinSize
                      onPress={() => createArea(name, "energia", "")}
                      style={{
                        minHeight: T.tapMin,
                        padding: `0 ${T.sp4}`,
                        borderRadius: T.rFull,
                        ...TYPO.footnote,
                        fontWeight: 700,
                        background: T.surface2,
                        color: exists ? T.text3 : T.primaryOnSurface,
                        border: `1.5px solid ${exists ? T.border : T.borderAccent}`,
                        opacity: exists ? 0.6 : 1,
                      }}
                    >
                      {exists ? `${name} ✓` : `+ ${name}`}
                    </Pressable>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Sheet>

      {/* ─── Potwierdzenie wyłączenia obszaru z historią ─── */}
      <Sheet
        open={Boolean(confirmAreaOff)}
        onClose={() => setConfirmAreaOff(null)}
        title="Wyłączyć ten obszar?"
        dismissOnBackdrop={false}
        footer={
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
            <Button
              variant="danger"
              size="lg"
              fullWidth
              loading={editLoading}
              haptic="warning"
              onPress={() => confirmAreaOff && disableArea(confirmAreaOff)}
            >
              Wyłącz obszar
            </Button>
            <Button variant="ghost" size="md" fullWidth onPress={() => setConfirmAreaOff(null)}>
              Anuluj
            </Button>
          </div>
        }
      >
        {confirmAreaOff && (
          <p style={{ ...TYPO.callout, color: T.text2, margin: 0 }}>
            Do obszaru „{confirmAreaOff.name}” jest podpiętych {confirmAreaOff.linkedCount}{" "}
            {confirmAreaOff.linkedCount === 1 ? "powiązanie" : "powiązań"} (mentorzy, cele,
            treningi, rekordy). Nic nie znika: obszar chowa się z list i wyborów, a historia
            zostaje. Możesz go włączyć z powrotem tym samym przełącznikiem.
          </p>
        )}
      </Sheet>

      {/* Mentor 1-on-1 chat overlay */}
      {chatMentor && (
        <MentorChat
          mentor={{
            id: chatMentor.id,
            name: chatMentor.name,
            role: chatMentor.role,
            avatarEmoji: chatMentor.avatarEmoji,
          }}
          onClose={() => setChatMentor(null)}
        />
      )}
    </div>
  );
}
