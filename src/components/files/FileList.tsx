"use client";

import { useState, useEffect, useCallback } from "react";
import { haptic } from "@/lib/haptics";

interface FileAnalysis {
  summary: string;
  category: string;
  extractedData: Record<string, unknown>;
  recommendations: string[];
}

interface UserFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  analysis: FileAnalysis | null;
  createdAt: string;
}

const categoryLabels: Record<string, string> = {
  training: "Trening",
  diet: "Dieta",
  medical: "Medyczne",
  other: "Inne",
};

/* Same token set as FileUpload — see the note there. */
const categoryColors: Record<string, string> = {
  training: "var(--primary)",
  diet: "var(--success)",
  medical: "var(--danger)",
  other: "var(--accent)",
};
const CATEGORY_FALLBACK = "var(--accent)";

const fileIcons: Record<string, string> = {
  "application/pdf": "📕",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "📘",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "📗",
  "text/plain": "📄",
  "text/csv": "📊",
  "image/jpeg": "🖼️",
  "image/png": "🖼️",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileList({ refreshTrigger }: { refreshTrigger?: number }) {
  const [files, setFiles] = useState<UserFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/files");
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles, refreshTrigger]);

  const deleteFile = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (res.ok) {
        setFiles((prev) => prev.filter((f) => f.id !== id));
      }
    } catch {
      // silently fail
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  if (loading) {
    return (
      <p style={{ color: "var(--text-3)", fontSize: 15, padding: "12px 0" }}>
        Ladowanie plikow...
      </p>
    );
  }

  if (files.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "32px 16px",
          color: "var(--text-3)",
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
        <p style={{ fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
          Brak przeslanych plikow
        </p>
        <p style={{ fontSize: 15, marginTop: 6, color: "var(--text-2)", lineHeight: 1.45 }}>
          Przeslij plik powyzej, aby rozpoczac analize.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Confirm delete modal */}
      {confirmDeleteId && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "var(--card)",
              borderRadius: 16,
              padding: 20,
              boxShadow: "var(--card-shadow)",
              width: "100%",
              maxWidth: "min(340px, calc(100vw - 32px))",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              Czy na pewno?
            </p>
            <p
              style={{
                fontSize: 15,
                color: "var(--text-2)",
                marginBottom: 20,
                lineHeight: 1.45,
              }}
            >
              Plik zostanie trwale usuniety.
            </p>
            <div
              style={{ display: "flex", gap: 12, justifyContent: "center" }}
            >
              <button
                onClick={() => {
                  haptic.tap();
                  setConfirmDeleteId(null);
                }}
                style={{
                  padding: "0 16px",
                  minHeight: 44,
                  flex: 1,
                  borderRadius: 12,
                  border: "1.5px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Anuluj
              </button>
              <button
                onClick={() => {
                  haptic.warning();
                  deleteFile(confirmDeleteId);
                }}
                disabled={deleting}
                style={{
                  padding: "0 16px",
                  minHeight: 44,
                  flex: 1,
                  borderRadius: 12,
                  border: "none",
                  background: "var(--danger)",
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: deleting ? "default" : "pointer",
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                {deleting ? "Usuwanie..." : "Usun"}
              </button>
            </div>
          </div>
        </div>
      )}

      {files.map((file) => {
        const icon = fileIcons[file.mimeType] || "📄";
        const analysis = file.analysis as FileAnalysis | null;
        const category = analysis?.category || "other";
        const expanded = expandedId === file.id;

        return (
          <div
            key={file.id}
            style={{
              background: "var(--card)",
              borderRadius: 16,
              padding: 14,
              boxShadow: "var(--card-shadow)",
            }}
          >
            {/* File header */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 24, flexShrink: 0 }}>{icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    {file.filename}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "3px 8px",
                      borderRadius: 999,
                      background: categoryColors[category] || CATEGORY_FALLBACK,
                      // never plain white: on the cyan fill that is 2.14:1
                      color: "var(--text-inverse)",
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {categoryLabels[category] || category}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--text-3)",
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>{formatSize(file.size)}</span>
                  <span>
                    {new Date(file.createdAt).toLocaleDateString("pl")}
                  </span>
                </div>

                {/* Summary excerpt */}
                {analysis?.summary && (
                  <p
                    style={{
                      fontSize: 15,
                      color: "var(--text-2)",
                      marginTop: 6,
                      lineHeight: 1.45,
                    }}
                  >
                    {expanded
                      ? analysis.summary
                      : analysis.summary.length > 100
                        ? analysis.summary.slice(0, 100) + "..."
                        : analysis.summary}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={() => {
                    haptic.tap();
                    setExpandedId(expanded ? null : file.id);
                  }}
                  style={{
                    padding: "0 12px",
                    minHeight: 44,
                    minWidth: 44,
                    borderRadius: 12,
                    border: "1.5px solid var(--border)",
                    background: "var(--surface-2)",
                    color: "var(--text)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {expanded ? "Zwiń" : "Więcej"}
                </button>
                <button
                  onClick={() => {
                    haptic.warning();
                    setConfirmDeleteId(file.id);
                  }}
                  style={{
                    padding: "0 12px",
                    minHeight: 44,
                    minWidth: 44,
                    borderRadius: 12,
                    border: "none",
                    background: "var(--danger)",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Usun
                </button>
              </div>
            </div>

            {/* Expanded analysis */}
            {expanded && analysis && (
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: "1px solid var(--border)",
                }}
              >
                {analysis.recommendations.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text-2)",
                        marginBottom: 6,
                      }}
                    >
                      Rekomendacje:
                    </p>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 18,
                        fontSize: 15,
                        color: "var(--text)",
                        lineHeight: 1.55,
                      }}
                    >
                      {analysis.recommendations.map(
                        (rec: string, i: number) => (
                          <li key={i}>{rec}</li>
                        )
                      )}
                    </ul>
                  </div>
                )}

                {Object.keys(analysis.extractedData || {}).length > 0 && (
                  <div>
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text-2)",
                        marginBottom: 6,
                      }}
                    >
                      Wyodrebnione dane:
                    </p>
                    <pre
                      style={{
                        fontSize: 13,
                        lineHeight: 1.5,
                        background: "var(--surface-2)",
                        padding: 12,
                        borderRadius: 12,
                        overflow: "auto",
                        maxHeight: 200,
                        color: "var(--text)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {JSON.stringify(analysis.extractedData, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
