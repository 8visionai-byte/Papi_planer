"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import VoiceInput from "@/components/forms/VoiceInput";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import {
  getTemplateForLifeArea,
  buildLogSummaryPills,
  type TrainingTemplate,
  type TemplateField,
} from "@/lib/training-templates";
import {
  Button,
  Card,
  EmptyState,
  Field,
  ListRow,
  Pressable,
  Sheet,
  Skeleton,
  fieldControlStyle,
  T,
  TYPO,
} from "@/components/ui";
import { AnimatedNumber } from "@/components/motion";
import { useIsomorphicLayoutEffect } from "@/hooks/useIsomorphicLayoutEffect";
import { haptic } from "@/lib/haptics";

interface LifeAreaRef {
  id: string;
  name: string;
  slug: string | null;
  category: string | null;
  description: string | null;
}

interface TrainingLog {
  id: string;
  date: string;
  exerciseName: string;
  sets: number | null;
  reps: number | null;
  weightKg: number | null;
  durationMin: number | null;
  distance: number | null;
  notes: string | null;
  rating: number | null;
  metrics: Record<string, unknown> | null;
}

interface PersonalRecord {
  id: string;
  exerciseName: string;
  value: number;
  unit: string;
  achievedAt: string;
  notes: string | null;
}

interface Milestone {
  id: string;
  title: string;
  completed: boolean;
}

interface Goal {
  id: string;
  title: string;
  description: string | null;
  status: string;
  progress: number;
  milestones: Milestone[];
  mentor: { id: string; name: string; avatarEmoji: string | null; role: string } | null;
}

interface MentorInfo {
  id: string;
  name: string;
  role: string;
  persona: string;
  avatarEmoji: string | null;
  style: string | null;
}

interface DisciplineData {
  lifeArea: LifeAreaRef;
  trainingLogs: TrainingLog[];
  personalRecords: PersonalRecord[];
  goals: Goal[];
  mentor: MentorInfo | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/* ------------------------------------------------------------------ */
/*  Small shared pieces                                                */
/* ------------------------------------------------------------------ */

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: T.sp2, marginBottom: T.sp3 }}>
      <h2 style={{ ...TYPO.title2, color: T.text, margin: 0 }}>{children}</h2>
      {count !== undefined && (
        <span
          style={{
            ...TYPO.footnote,
            fontWeight: 700,
            color: T.text3,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

/** Metric chip used under a training log row. */
function MetricChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.3,
        padding: "4px 10px",
        borderRadius: T.rFull,
        background: T.surface2,
        border: `1px solid ${T.border}`,
        color: T.text2,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function TrashIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

type PendingDelete = { kind: "log" | "record"; id: string; label: string };

export default function DisciplinePage() {
  const params = useParams();
  const slug = (params?.slug as string) || "";

  const [data, setData] = useState<DisciplineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTrainingForm, setShowTrainingForm] = useState(false);
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/discipline/${encodeURIComponent(slug)}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "Błąd serwera" }));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (slug) load();
  }, [slug, load]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const endpoint = pendingDelete.kind === "log" ? "/api/training-logs" : "/api/personal-records";
    try {
      const res = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pendingDelete.id }),
      });
      if (res.ok) {
        haptic.success();
        load();
      } else {
        haptic.error();
      }
    } catch {
      haptic.error();
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  if (loading) {
    return (
      <div
        style={{
          padding: `${T.sp6} ${T.gutter}`,
          display: "flex",
          flexDirection: "column",
          gap: T.sp4,
        }}
      >
        <Skeleton variant="line" width="60%" height={32} />
        <Skeleton variant="block" height={104} radius={20} />
        <Skeleton variant="block" height={120} radius={20} />
        <Skeleton variant="block" height={120} radius={20} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: `${T.sp6} ${T.gutter}` }}>
        <Card>
          <EmptyState
            icon="⚠️"
            tone="danger"
            title="Nie udało się otworzyć dyscypliny"
            body={error || "Nie znaleziono dyscypliny"}
            action={{ label: "Spróbuj ponownie", onPress: () => load() }}
          />
        </Card>
      </div>
    );
  }

  const { lifeArea, trainingLogs, personalRecords, goals, mentor } = data;
  const template = getTemplateForLifeArea(lifeArea.name);

  return (
    <div
      style={{
        padding: `${T.sp6} ${T.gutter}`,
        paddingBottom: `calc(${T.sp6} + ${T.aboveTabbar})`,
        display: "flex",
        flexDirection: "column",
        gap: T.sp8,
      }}
    >
      {/* ---- Header ---- */}
      <header className="anim-in">
        {lifeArea.category && (
          <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>{lifeArea.category}</div>
        )}
        <h1 style={{ ...TYPO.title1, color: T.text, margin: 0 }}>{lifeArea.name}</h1>
        {lifeArea.description && (
          <p style={{ ...TYPO.callout, color: T.text2, margin: `${T.sp1} 0 0` }}>
            {lifeArea.description}
          </p>
        )}

        {/* Mentor of the discipline */}
        {mentor && (
          <Card style={{ marginTop: T.sp4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: T.sp3 }}>
              <div
                className="glow-soft"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: T.rFull,
                  background: T.primarySoft,
                  border: `1px solid ${T.borderAccent}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 28,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                {mentor.avatarEmoji || "🧑‍🏫"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...TYPO.label, color: T.text3, marginBottom: 4 }}>Twój mentor</div>
                <div style={{ ...TYPO.title3, color: T.text, overflowWrap: "anywhere" }}>
                  {mentor.name}
                </div>
                <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>{mentor.role}</div>
              </div>
            </div>
          </Card>
        )}
      </header>

      {/* ---- Primary actions ---- */}
      <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
        <Button
          size="lg"
          fullWidth
          haptic="impact"
          onPress={() => setShowTrainingForm(true)}
        >
          Dodaj trening
        </Button>
        <Button variant="secondary" size="md" fullWidth onPress={() => setShowRecordForm(true)}>
          Nowy rekord
        </Button>
      </div>

      {/* ---- Active goals ---- */}
      <section>
        <SectionTitle count={goals.length}>Cele aktywne</SectionTitle>
        {goals.length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon="🎯"
              title="Brak aktywnych celów"
              body="Cele z tej dyscypliny pojawią się tutaj, gdy je dodasz w zakładce Cele."
            />
          </Card>
        ) : (
          <div className="anim-stagger" style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
            {goals.map((g) => (
              <Card key={g.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: T.sp3 }}>
                  <div style={{ ...TYPO.title3, color: T.text, minWidth: 0, overflowWrap: "anywhere" }}>
                    {g.title}
                  </div>
                  <div
                    style={{
                      ...TYPO.footnote,
                      fontWeight: 700,
                      color: T.primaryOnSurface,
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <AnimatedNumber value={g.progress} suffix="%" />
                  </div>
                </div>

                {g.description && (
                  <div style={{ ...TYPO.callout, color: T.text2, marginTop: T.sp2 }}>
                    {g.description}
                  </div>
                )}

                <div
                  style={{
                    marginTop: T.sp3,
                    height: 6,
                    background: T.surface2,
                    borderRadius: T.rFull,
                    overflow: "hidden",
                  }}
                >
                  <div
                    className="anim-bar"
                    style={{
                      width: `${g.progress}%`,
                      height: "100%",
                      borderRadius: T.rFull,
                      background: "var(--grad-accent)",
                    }}
                  />
                </div>

                {g.milestones.length > 0 && (
                  <div style={{ ...TYPO.footnote, color: T.text3, marginTop: T.sp3 }}>
                    Kamienie milowe: {g.milestones.filter((m) => m.completed).length}/
                    {g.milestones.length}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ---- Personal records ---- */}
      <section>
        <SectionTitle count={personalRecords.length}>Rekordy</SectionTitle>
        {personalRecords.length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon="🏆"
              title="Brak rekordów"
              body="Zapisz swój pierwszy rekord, żeby mieć punkt odniesienia."
              action={{ label: "Dodaj rekord", onPress: () => setShowRecordForm(true) }}
            />
          </Card>
        ) : (
          <div
            className="anim-stagger"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: T.sp3,
            }}
          >
            {personalRecords.map((r) => (
              <div
                key={r.id}
                style={{
                  position: "relative",
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderRadius: T.rLg,
                  boxShadow: T.elev1,
                  padding: T.sp4,
                  minHeight: 92,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    ...TYPO.label,
                    color: T.text3,
                    // The delete button is a 44 px target pinned at right: 4, so it
                    // covers 48 px of this line. Reserving only 24 px let a long
                    // exercise name run underneath it: the name looked tappable and
                    // the tap deleted the record instead.
                    paddingRight: 48,
                    overflowWrap: "anywhere",
                  }}
                >
                  {r.exerciseName}
                </span>

                <span style={{ display: "inline-flex", alignItems: "baseline" }}>
                  <AnimatedNumber
                    value={r.value}
                    decimals={Number.isInteger(r.value) ? 0 : 2}
                    className="tile-num"
                  />
                  <span className="tile-unit">{r.unit}</span>
                </span>

                <span style={{ fontSize: 13, color: T.text3, fontVariantNumeric: "tabular-nums" }}>
                  {formatDate(r.achievedAt)}
                </span>

                {r.notes && (
                  <span style={{ ...TYPO.footnote, color: T.text2, marginTop: 2 }}>{r.notes}</span>
                )}

                <Pressable
                  onPress={() =>
                    setPendingDelete({ kind: "record", id: r.id, label: r.exerciseName })
                  }
                  ariaLabel={`Usuń rekord ${r.exerciseName}`}
                  haptic="warning"
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    color: T.text3,
                    borderRadius: T.rMd,
                  }}
                >
                  <TrashIcon />
                </Pressable>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Training history ---- */}
      <section>
        <SectionTitle count={trainingLogs.length}>Historia treningów</SectionTitle>
        {trainingLogs.length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon="📋"
              title="Brak treningów"
              body="Pierwszy wpis zajmie 30 sekund i od razu zobaczysz go tutaj."
              action={{ label: "Dodaj trening", onPress: () => setShowTrainingForm(true) }}
            />
          </Card>
        ) : (
          <Card padding="sm">
            <div className="anim-stagger" style={{ display: "flex", flexDirection: "column", gap: T.sp1 }}>
              {trainingLogs.slice(0, 10).map((log) => {
                const pills = buildLogSummaryPills(template, log);
                return (
                  <ListRow
                    key={log.id}
                    minHeight={56}
                    title={log.exerciseName}
                    subtitle={
                      <span style={{ display: "block" }}>
                        <span style={{ display: "block", fontVariantNumeric: "tabular-nums" }}>
                          {formatDate(log.date)}
                        </span>
                        {(pills.length > 0 || log.rating != null) && (
                          <span
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 6,
                              marginTop: 6,
                            }}
                          >
                            {pills.map((p, i) => (
                              <MetricChip key={i}>{p}</MetricChip>
                            ))}
                            {log.rating != null && <MetricChip>⭐ {log.rating}/5</MetricChip>}
                          </span>
                        )}
                        {log.notes && (
                          <span
                            style={{
                              display: "block",
                              marginTop: 6,
                              color: T.text3,
                              fontStyle: "italic",
                            }}
                          >
                            {log.notes}
                          </span>
                        )}
                      </span>
                    }
                    trailing={
                      <Pressable
                        stopPropagation
                        onPress={() =>
                          setPendingDelete({ kind: "log", id: log.id, label: log.exerciseName })
                        }
                        ariaLabel={`Usuń trening ${log.exerciseName}`}
                        haptic="warning"
                        style={{ color: T.text3, borderRadius: T.rMd }}
                      >
                        <TrashIcon />
                      </Pressable>
                    }
                  />
                );
              })}
            </div>

            {trainingLogs.length > 10 && (
              <div
                style={{
                  ...TYPO.footnote,
                  color: T.text3,
                  textAlign: "center",
                  padding: `${T.sp3} 0 ${T.sp1}`,
                }}
              >
                Pokazano 10 z {trainingLogs.length}
              </div>
            )}
          </Card>
        )}
      </section>

      {/* ---- Sheets ---- */}
      <TrainingForm
        open={showTrainingForm}
        lifeAreaId={lifeArea.id}
        template={template}
        onClose={() => setShowTrainingForm(false)}
        onSaved={() => {
          setShowTrainingForm(false);
          load();
        }}
      />

      <RecordForm
        open={showRecordForm}
        lifeAreaId={lifeArea.id}
        onClose={() => setShowRecordForm(false)}
        onSaved={() => {
          setShowRecordForm(false);
          load();
        }}
      />

      <Sheet
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title={pendingDelete?.kind === "log" ? "Usunąć ten trening?" : "Usunąć ten rekord?"}
        dismissOnBackdrop={false}
        footer={
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
            <Button
              variant="danger"
              size="lg"
              fullWidth
              loading={deleting}
              haptic="warning"
              onPress={confirmDelete}
            >
              Usuń
            </Button>
            <Button variant="ghost" size="md" fullWidth onPress={() => setPendingDelete(null)}>
              Anuluj
            </Button>
          </div>
        }
      >
        <p style={{ ...TYPO.callout, color: T.text2, margin: 0 }}>
          {pendingDelete?.label}. Tej operacji nie da się cofnąć.
        </p>
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Training form (bottom sheet)                                       */
/* ------------------------------------------------------------------ */

function TrainingForm({
  open,
  lifeAreaId,
  template,
  onClose,
  onSaved,
}: {
  open: boolean;
  lifeAreaId: string;
  template: TrainingTemplate;
  onClose: () => void;
  onSaved: () => void;
}) {
  // values[fieldKey] = string (form state is always string until submit)
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of template.fields) init[f.key] = "";
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setField = useCallback((key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  }, []);

  // The sheet stays mounted between openings (so it can animate out), so the form
  // has to clear itself on every fresh open - otherwise the user sees the previous
  // entry.
  //
  // This used to be the "adjust state during render" pattern
  // (`if (prevOpen !== open) { setPrevOpen(open); ...reset... }`). React 19 drops
  // that update whenever the same event also queues an update in a parent - the
  // exact failure that kept Sheet from mounting - and here it showed up as the
  // previous training reappearing in a "fresh" form. A layout effect runs after
  // the commit but BEFORE paint, so the cleared fields are the first thing the
  // user ever sees and there is no cascading render to worry about.
  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    const init: Record<string, string> = {};
    for (const f of template.fields) init[f.key] = "";
    setValues(init);
    setErr(null);
  }, [open, template]);

  // Split fields for layout — group consecutive number/select fields into 2-col rows
  // for compactness, but render long fields (text, notes) full width.
  const rows = useMemo(() => buildFieldRows(template.fields), [template]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    // Validate required
    for (const f of template.fields) {
      if (f.required && !values[f.key]?.toString().trim()) {
        haptic.warning();
        setErr(`${f.label} jest wymagane`);
        return;
      }
    }

    setSubmitting(true);
    try {
      // Build body — pass all non-empty values; the API splits standard vs metrics.
      const body: Record<string, unknown> = { lifeAreaId };
      for (const f of template.fields) {
        const v = values[f.key];
        if (v === undefined || v === "") continue;
        body[f.key] = v;
      }

      const res = await fetch("/api/training-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "Błąd zapisu" }));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      haptic.success();
      onSaved();
    } catch (e) {
      haptic.error();
      setErr(e instanceof Error ? e.message : "Błąd");
    } finally {
      setSubmitting(false);
    }
  }

  // Notes field is rendered with VoiceTextarea — treated specially.
  const notesField = template.fields.find((f) => f.key === "notes");

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Dodaj trening — ${template.name}`}
      size="full"
      footer={
        <Button
          size="lg"
          fullWidth
          loading={submitting}
          haptic="impact"
          onPress={(e) => submit(e as unknown as React.FormEvent)}
        >
          Zapisz trening
        </Button>
      }
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: T.sp4 }}>
        {rows.map((row, i) => (
          <FieldRow key={i} fields={row} values={values} setField={setField} isFirst={i === 0} />
        ))}

        {notesField && (
          <div>
            <label style={labelStyle}>{notesField.label}</label>
            <VoiceTextarea
              value={values.notes || ""}
              onChange={(v) => setField("notes", v)}
              minHeight={72}
              placeholder={notesField.placeholder || "Wrażenia, technika..."}
            />
          </div>
        )}

        {err && (
          <div
            role="alert"
            style={{
              ...TYPO.footnote,
              color: T.dangerOnSurface,
              background: T.dangerSoft,
              border: `1px solid ${T.danger}`,
              borderRadius: T.rMd,
              padding: `${T.sp2} ${T.sp3}`,
            }}
          >
            {err}
          </div>
        )}

        {/* keeps Enter-to-submit working while the visible CTA lives in the footer */}
        <button type="submit" style={{ display: "none" }} aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}

const labelStyle: React.CSSProperties = {
  ...TYPO.footnote,
  fontWeight: 600,
  color: T.text2,
  display: "block",
  marginBottom: 6,
};

/**
 * Group template fields into rows.
 *  - text fields (and notes) get their own full-width row
 *  - consecutive number/select fields are paired into 2-column rows
 *  - notes is excluded (rendered separately below)
 */
function buildFieldRows(fields: TemplateField[]): TemplateField[][] {
  const rows: TemplateField[][] = [];
  let pendingPair: TemplateField | null = null;

  for (const f of fields) {
    if (f.key === "notes") continue;

    const isCompact = f.type === "number" || f.type === "select";

    if (isCompact) {
      if (pendingPair) {
        rows.push([pendingPair, f]);
        pendingPair = null;
      } else {
        pendingPair = f;
      }
    } else {
      if (pendingPair) {
        rows.push([pendingPair]);
        pendingPair = null;
      }
      rows.push([f]);
    }
  }
  if (pendingPair) rows.push([pendingPair]);

  return rows;
}

function FieldRow({
  fields,
  values,
  setField,
  isFirst,
}: {
  fields: TemplateField[];
  values: Record<string, string>;
  setField: (k: string, v: string) => void;
  isFirst: boolean;
}) {
  if (fields.length === 1) {
    return (
      <div>
        <FieldInput
          field={fields[0]}
          value={values[fields[0].key] || ""}
          onChange={(v) => setField(fields[0].key, v)}
          autoFocus={isFirst}
        />
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: T.sp3 }}>
      {fields.map((f, i) => (
        <FieldInput
          key={f.key}
          field={f}
          value={values[f.key] || ""}
          onChange={(v) => setField(f.key, v)}
          autoFocus={isFirst && i === 0}
        />
      ))}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  autoFocus,
}: {
  field: TemplateField;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const label = field.unit ? `${field.label} (${field.unit})` : field.label;

  if (field.type === "select") {
    return (
      <Field label={label} required={field.required}>
        {(p) => (
          <select {...p} style={fieldControlStyle} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">— wybierz —</option>
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        )}
      </Field>
    );
  }

  if (field.type === "number") {
    return (
      <Field label={label} required={field.required}>
        {(p) => (
          <input
            {...p}
            style={fieldControlStyle}
            type="number"
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            min={field.min}
            max={field.max}
            step={field.step ?? "any"}
            autoFocus={autoFocus}
          />
        )}
      </Field>
    );
  }

  // text — use VoiceInput for voice dictation support
  return (
    <div>
      <label style={labelStyle}>
        {label}
        {field.required ? " *" : ""}
      </label>
      <VoiceInput
        value={value}
        onChange={onChange}
        placeholder={field.placeholder}
        autoFocus={autoFocus}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Record form (bottom sheet)                                         */
/* ------------------------------------------------------------------ */

function RecordForm({
  open,
  lifeAreaId,
  onClose,
  onSaved,
}: {
  open: boolean;
  lifeAreaId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [exerciseName, setExerciseName] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("kg");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Same reason as in TrainingForm: the sheet is never unmounted, so the form
  // clears itself on every fresh open. Also rewritten away from the render-phase
  // pattern - see the comment in TrainingForm for why React 19 could lose it.
  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    setExerciseName("");
    setValue("");
    setUnit("kg");
    setNotes("");
    setErr(null);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!exerciseName.trim() || !value || !unit.trim()) {
      haptic.warning();
      setErr("Wypełnij ćwiczenie, wartość i jednostkę");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/personal-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lifeAreaId,
          exerciseName,
          value,
          unit,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "Błąd zapisu" }));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      haptic.success();
      onSaved();
    } catch (e) {
      haptic.error();
      setErr(e instanceof Error ? e.message : "Błąd");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Nowy rekord"
      footer={
        <Button
          size="lg"
          fullWidth
          loading={submitting}
          haptic="impact"
          onPress={(e) => submit(e as unknown as React.FormEvent)}
        >
          Zapisz rekord
        </Button>
      }
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: T.sp4 }}>
        <div>
          <label style={labelStyle}>Ćwiczenie *</label>
          <VoiceInput
            value={exerciseName}
            onChange={setExerciseName}
            placeholder="np. Martwy ciąg"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: T.sp3 }}>
          <Field label="Wartość" required>
            {(p) => (
              <input
                {...p}
                style={fieldControlStyle}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </Field>
          <Field label="Jednostka" required>
            {(p) => (
              <input
                {...p}
                style={fieldControlStyle}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="kg, km, s..."
              />
            )}
          </Field>
        </div>

        <div>
          <label style={labelStyle}>Notatki</label>
          <VoiceTextarea
            value={notes}
            onChange={setNotes}
            minHeight={72}
            placeholder="Jak poszło? Wrażenia, technika..."
          />
        </div>

        {err && (
          <div
            role="alert"
            style={{
              ...TYPO.footnote,
              color: T.dangerOnSurface,
              background: T.dangerSoft,
              border: `1px solid ${T.danger}`,
              borderRadius: T.rMd,
              padding: `${T.sp2} ${T.sp3}`,
            }}
          >
            {err}
          </div>
        )}

        <button type="submit" style={{ display: "none" }} aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}
