"use client";

import { useEffect, useRef, useState } from "react";
import { listAudioInputDevices, isVirtualDevice } from "@/hooks/useVoiceRecorder";
import { haptic } from "@/lib/haptics";

interface MicDevicePickerProps {
  value: string | null;
  onChange: (deviceId: string | null) => void;
  buttonStyle?: React.CSSProperties;
  disabled?: boolean;
}

export default function MicDevicePicker({
  value,
  onChange,
  buttonStyle,
  disabled = false,
}: MicDevicePickerProps) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const refreshDevices = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await listAudioInputDevices();
      setDevices(list);
    } catch (err) {
      console.warn("[MicDevicePicker] failed to list devices", err);
      setLoadError("Nie udało się pobrać listy urządzeń.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void refreshDevices();
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Refresh devices when the OS list changes (e.g., user plugs in a headset)
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    const handler = () => {
      if (open) void refreshDevices();
    };
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handler);
  }, [open]);

  const handleSelect = (deviceId: string | null) => {
    haptic.selection();
    onChange(deviceId);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => {
          haptic.tap();
          setOpen((v) => !v);
        }}
        disabled={disabled}
        aria-label="Wybierz mikrofon"
        title="Wybierz mikrofon"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          flexShrink: 0,
          borderRadius: "50%",
          border: "1px solid var(--border)",
          cursor: disabled ? "not-allowed" : "pointer",
          background: "var(--background)",
          color: "var(--text)",
          opacity: disabled ? 0.6 : 1,
          transition: "background 150ms ease, border-color 150ms ease",
          padding: 0,
          ...buttonStyle,
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = "var(--border)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--background)";
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Wybór mikrofonu"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            right: 0,
            zIndex: 1000,
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
            padding: 6,
            minWidth: 220,
            maxWidth: "min(280px, calc(100vw - 32px))",
            animation: "mdpFadeIn 160ms ease-out",
          }}
        >
          <div
            style={{
              padding: "8px 10px 6px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            Mikrofon
          </div>

          {/* Default option */}
          <button
            type="button"
            onClick={() => handleSelect(null)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              textAlign: "left",
              padding: "10px",
              minHeight: 44,
              borderRadius: 10,
              border: "none",
              background:
                value === null ? "var(--primary-soft)" : "transparent",
              color: "var(--text)",
              cursor: "pointer",
              fontSize: 15,
            }}
            onMouseEnter={(e) => {
              if (value !== null) {
                e.currentTarget.style.background = "var(--border)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background =
                value === null ? "var(--primary-soft)" : "transparent";
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 14,
                height: 14,
                borderRadius: "50%",
                border: `2px solid ${value === null ? "var(--primary)" : "var(--border)"}`,
                background: "var(--background)",
                flexShrink: 0,
              }}
            >
              {value === null && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--primary)",
                  }}
                />
              )}
            </span>
            <span style={{ fontWeight: value === null ? 600 : 400 }}>
              Domyślny
            </span>
          </button>

          {loading && (
            <div style={{ padding: "10px", fontSize: 14, color: "var(--text-3)" }}>
              Wczytuję urządzenia...
            </div>
          )}

          {loadError && (
            <div
              style={{
                padding: "10px",
                fontSize: 14,
                color: "var(--danger-on-surface)",
                lineHeight: 1.45,
              }}
            >
              {loadError}
            </div>
          )}

          {!loading && devices.length === 0 && !loadError && (
            <div style={{ padding: "10px", fontSize: 14, color: "var(--text-3)" }}>
              Brak dostępnych mikrofonów.
            </div>
          )}

          {devices.map((d, idx) => {
            const selected = value === d.deviceId;
            const label = d.label || `Mikrofon ${idx + 1}`;
            const isVirtual = isVirtualDevice(label);
            return (
              <button
                key={d.deviceId || `dev-${idx}`}
                type="button"
                onClick={() => handleSelect(d.deviceId)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  padding: "10px",
                  minHeight: 44,
                  borderRadius: 10,
                  border: "none",
                  background: selected ? "var(--primary-soft)" : "transparent",
                  color: isVirtual ? "var(--text-3)" : "var(--text)",
                  cursor: "pointer",
                  fontSize: 15,
                }}
                title={isVirtual ? `${label}  — uwaga: urządzenie wirtualne` : label}
                onMouseEnter={(e) => {
                  if (!selected) e.currentTarget.style.background = "var(--border)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = selected
                    ? "var(--primary-soft)"
                    : "transparent";
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    border: `2px solid ${selected ? "var(--primary)" : "var(--border)"}`,
                    background: "var(--background)",
                    flexShrink: 0,
                  }}
                >
                  {selected && (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "var(--primary)",
                      }}
                    />
                  )}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {label}
                </span>
                {isVirtual && (
                  <span style={{ fontSize: 14, color: "var(--danger-on-surface)", flexShrink: 0 }} title="Urządzenie wirtualne — nie nagrywa fizycznego mikrofonu">
                    ⚠️
                  </span>
                )}
              </button>
            );
          })}
          <div style={{ padding: "8px 10px 4px", fontSize: 12, lineHeight: 1.4, color: "var(--text-3)", borderTop: "1px solid var(--border)", marginTop: 4 }}>
            ⚠️ = urządzenie wirtualne — unikaj
          </div>
        </div>
      )}

      <style>{`
        @keyframes mdpFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
