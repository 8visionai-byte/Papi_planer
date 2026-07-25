"use client";

import { useState, useRef, useCallback } from "react";
import { haptic } from "@/lib/haptics";

interface FileAnalysis {
  summary: string;
  category: string;
  extractedData: Record<string, unknown>;
  recommendations: string[];
}

interface Props {
  onUploadComplete?: (fileId: string) => void;
}

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".xls",
  ".txt",
  ".csv",
  ".jpg",
  ".jpeg",
  ".png",
];

const categoryLabels: Record<string, string> = {
  training: "Trening",
  diet: "Dieta",
  medical: "Medyczne",
  other: "Inne",
};

/* Fills for the category badge. Tokens, not hex: the old indigo / green / red /
   violet set was light-theme only and clashed with the cyan brand. The label on
   top of every one of these is --text-inverse (see below). */
const categoryColors: Record<string, string> = {
  training: "var(--primary)",
  diet: "var(--success)",
  medical: "var(--danger)",
  other: "var(--accent)",
};
const CATEGORY_FALLBACK = "var(--accent)";

export default function FileUpload({ onUploadComplete }: Props) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<FileAnalysis | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_SIZE) {
      return "Plik jest za duzy. Maksymalny rozmiar to 10MB.";
    }
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return "Nieobslugiwany typ pliku. Dozwolone: PDF, DOCX, XLSX, TXT, CSV, JPG, PNG.";
    }
    return null;
  };

  const uploadFile = useCallback(
    async (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      setError("");
      setUploading(true);
      setAnalysis(null);
      setProgress(0);

      // Simulate progress during upload
      const progressInterval = setInterval(() => {
        setProgress((p) => {
          if (p >= 85) {
            clearInterval(progressInterval);
            return 85;
          }
          return p + Math.random() * 15;
        });
      }, 300);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/files/upload", {
          method: "POST",
          body: formData,
        });

        clearInterval(progressInterval);

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Blad przesylania pliku");
        }

        setProgress(100);
        const data = await res.json();
        setAnalysis(data.analysis);
        onUploadComplete?.(data.fileId);
      } catch (err) {
        clearInterval(progressInterval);
        setError(
          err instanceof Error ? err.message : "Blad przesylania pliku"
        );
      } finally {
        setUploading(false);
      }
    },
    [onUploadComplete]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [uploadFile]
  );

  return (
    <div>
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => {
          if (uploading) return;
          haptic.tap();
          fileInputRef.current?.click();
        }}
        style={{
          border: `2px dashed ${dragging ? "var(--primary)" : "var(--border)"}`,
          borderRadius: 16,
          padding: "32px 20px",
          textAlign: "center",
          cursor: uploading ? "default" : "pointer",
          background: dragging ? "var(--primary-soft)" : "var(--card)",
          transition: "all 0.2s",
          opacity: uploading ? 0.6 : 1,
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_EXTENSIONS.join(",")}
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />

        <div style={{ fontSize: 36, marginBottom: 8 }}>
          {uploading ? "..." : "📄"}
        </div>

        {uploading ? (
          <div>
            <p
              style={{
                fontSize: 15,
                color: "var(--text-2)",
                marginBottom: 12,
              }}
            >
              Przesylanie i analizowanie pliku...
            </p>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: "var(--border)",
                overflow: "hidden",
                maxWidth: 240,
                margin: "0 auto",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(progress, 100)}%`,
                  background: "var(--primary)",
                  borderRadius: 3,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <p
              style={{ fontSize: 13, color: "var(--text-3)", marginTop: 8, fontWeight: 500 }}
            >
              {progress < 85
                ? "Przesylanie..."
                : progress < 100
                  ? "Analizowanie z AI..."
                  : "Gotowe!"}
            </p>
          </div>
        ) : (
          <div>
            <p
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: "var(--text)",
                marginBottom: 6,
              }}
            >
              Przeciagnij plik lub kliknij
            </p>
            <p style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.4 }}>
              PDF, DOCX, XLSX, TXT, CSV, JPG, PNG (max 10MB)
            </p>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: 12,
            background: "var(--danger-soft)",
            color: "var(--danger-on-surface)",
            fontSize: 14,
            lineHeight: 1.45,
          }}
        >
          {error}
        </div>
      )}

      {/* Analysis result */}
      {analysis && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 16,
            background: "var(--card)",
            boxShadow: "var(--card-shadow)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 18 }}>&#x2705;</span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              Analiza zakonczona
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: "3px 10px",
                borderRadius: 999,
                whiteSpace: "nowrap",
                background: categoryColors[analysis.category] || CATEGORY_FALLBACK,
                // never plain white: on the cyan fill that is 2.14:1
                color: "var(--text-inverse)",
              }}
            >
              {categoryLabels[analysis.category] || analysis.category}
            </span>
          </div>

          <p
            style={{
              fontSize: 15,
              color: "var(--text)",
              lineHeight: 1.5,
              marginBottom: 12,
            }}
          >
            {analysis.summary}
          </p>

          {analysis.recommendations.length > 0 && (
            <div>
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
                  paddingLeft: 20,
                  fontSize: 15,
                  color: "var(--text)",
                  lineHeight: 1.55,
                }}
              >
                {analysis.recommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
