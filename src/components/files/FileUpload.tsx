"use client";

import { useState, useRef, useCallback } from "react";

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

const categoryColors: Record<string, string> = {
  training: "#3b82f6",
  diet: "#22c55e",
  medical: "#ef4444",
  other: "#8b5cf6",
};

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
        onClick={() => !uploading && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--primary)" : "var(--border)"}`,
          borderRadius: 16,
          padding: "32px 20px",
          textAlign: "center",
          cursor: uploading ? "default" : "pointer",
          background: dragging ? "rgba(59, 130, 246, 0.05)" : "var(--card)",
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
                fontSize: 14,
                color: "var(--muted)",
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
              style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}
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
                fontSize: 14,
                fontWeight: 600,
                color: "var(--foreground)",
                marginBottom: 4,
              }}
            >
              Przeciagnij plik lub kliknij
            </p>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>
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
            background: "#fef2f2",
            color: "var(--danger)",
            fontSize: 13,
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
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 10px",
                borderRadius: 12,
                background: categoryColors[analysis.category] || "#8b5cf6",
                color: "#fff",
              }}
            >
              {categoryLabels[analysis.category] || analysis.category}
            </span>
          </div>

          <p
            style={{
              fontSize: 14,
              color: "var(--foreground)",
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
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--muted)",
                  marginBottom: 6,
                }}
              >
                Rekomendacje:
              </p>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 20,
                  fontSize: 13,
                  color: "var(--foreground)",
                  lineHeight: 1.6,
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
