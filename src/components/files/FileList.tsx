"use client";

import { useState, useEffect, useCallback } from "react";

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

const categoryColors: Record<string, string> = {
  training: "#3b82f6",
  diet: "#22c55e",
  medical: "#ef4444",
  other: "#8b5cf6",
};

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
      <p style={{ color: "var(--muted)", fontSize: 14, padding: "12px 0" }}>
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
          color: "var(--muted)",
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
        <p style={{ fontSize: 14 }}>Brak przeslanych plikow</p>
        <p style={{ fontSize: 12, marginTop: 4 }}>
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
              maxWidth: 340,
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              Czy na pewno?
            </p>
            <p
              style={{
                fontSize: 14,
                color: "var(--muted)",
                marginBottom: 20,
              }}
            >
              Plik zostanie trwale usuniety.
            </p>
            <div
              style={{ display: "flex", gap: 12, justifyContent: "center" }}
            >
              <button
                onClick={() => setConfirmDeleteId(null)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "1.5px solid var(--border)",
                  background: "var(--card)",
                  color: "var(--foreground)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Anuluj
              </button>
              <button
                onClick={() => deleteFile(confirmDeleteId)}
                disabled={deleting}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--danger)",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
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
                      fontSize: 14,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {file.filename}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "1px 8px",
                      borderRadius: 10,
                      background: categoryColors[category] || "#8b5cf6",
                      color: "#fff",
                      flexShrink: 0,
                    }}
                  >
                    {categoryLabels[category] || category}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    display: "flex",
                    gap: 8,
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
                      fontSize: 12,
                      color: "var(--muted)",
                      marginTop: 6,
                      lineHeight: 1.4,
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
                  onClick={() =>
                    setExpandedId(expanded ? null : file.id)
                  }
                  style={{
                    padding: "4px 10px",
                    borderRadius: 8,
                    border: "1.5px solid var(--border)",
                    background: "var(--card)",
                    color: "var(--foreground)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {expanded ? "Zwiń" : "Więcej"}
                </button>
                <button
                  onClick={() => setConfirmDeleteId(file.id)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 8,
                    border: "none",
                    background: "var(--danger)",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
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
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--muted)",
                        marginBottom: 4,
                      }}
                    >
                      Rekomendacje:
                    </p>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 18,
                        fontSize: 12,
                        color: "var(--foreground)",
                        lineHeight: 1.6,
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
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--muted)",
                        marginBottom: 4,
                      }}
                    >
                      Wyodrebnione dane:
                    </p>
                    <pre
                      style={{
                        fontSize: 11,
                        background: "var(--background)",
                        padding: 10,
                        borderRadius: 8,
                        overflow: "auto",
                        maxHeight: 200,
                        color: "var(--foreground)",
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
