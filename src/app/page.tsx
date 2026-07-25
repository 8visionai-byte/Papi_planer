import type { Metadata } from "next";
import { HomeRedirectIfAuthed } from "@/components/landing/HomeRedirectIfAuthed";

export const metadata: Metadata = {
  title: "PAPI PLANER — osobisty system transformacji z mentorami AI",
  description:
    "PAPI PLANER to osobista aplikacja do planowania dnia, nawyków, diety, treningów i celów, prowadzona przez mentorów AI.",
};

const FEATURES = [
  {
    icon: "🤖",
    title: "Mentorzy AI",
    desc: "Zespół mentorów AI tworzy spersonalizowane plany treningowe, dietetyczne i rozwojowe — każdy w swojej specjalizacji.",
  },
  {
    icon: "📅",
    title: "Plan dnia",
    desc: "Inteligentny plan dnia generowany na podstawie Twoich celów, harmonogramu i spotkań z Google Calendar.",
  },
  {
    icon: "✅",
    title: "Nawyki",
    desc: "Śledź codzienne nawyki — rano, popołudniu i wieczorem — i obserwuj swoją serię i statystyki.",
  },
  {
    icon: "🍽️",
    title: "Dieta",
    desc: "Bilans kaloryczny, makroskładniki i rozpoznawanie posiłków ze zdjęcia. BMR i TDEE liczone z Twojego profilu.",
  },
  {
    icon: "🏋️",
    title: "Treningi",
    desc: "Historia treningów i rekordy osobiste dla każdej dyscypliny — siłownia, karate, pływanie, kalistenika, bieganie.",
  },
  {
    icon: "🎯",
    title: "Cele",
    desc: "Wyznaczaj cele, a mentorzy rozpiszą plan krok po kroku z mierzalnym postępem.",
  },
];

/**
 * Brand colours, written out instead of read from `var(--token)`.
 *
 * This is the only page in the app that deliberately ignores the user's theme:
 * it is the public marketing shot (and what Google renders), so it always shows
 * the dark cyan brand. Values are copied verbatim from the dark palette in
 * docs/audit/PREMIUM-DIRECTION.md — keep them in sync with the --dark-* block of
 * globals.css if the palette ever moves.
 */
const BRAND = {
  bg: "#0B0E13", // --dark-bg
  surface: "#141922", // --dark-surface
  border: "rgba(255, 255, 255, 0.07)", // --dark-border
  text: "#F2F6FA", // --dark-text
  text2: "#B6C2D0", // --dark-text-2
  text3: "#96A1B0", // --dark-text-3
  accentText: "#41DFF5", // --accent-300, safe as text on every dark surface
  accentSoft: "#8EEEFF", // --accent-200
  /** label ON the cyan fill — white on cyan is 2.14:1 and must never be used */
  accentInk: "#04161A",
  gradient: "linear-gradient(135deg, #2BE1F5 0%, #12C2DE 45%, #2C9BF0 100%)",
  wash: "radial-gradient(900px 480px at 50% -160px, rgba(18, 194, 222, 0.20), transparent 70%)",
  glow: "0 10px 30px -8px rgba(18, 194, 222, 0.55)",
} as const;

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: `${BRAND.wash}, ${BRAND.bg}`,
        color: BRAND.text,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <HomeRedirectIfAuthed />

      {/* Hero */}
      <section
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "72px 20px 48px",
          textAlign: "center",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-512.png"
          alt="PAPI PLANER"
          width={104}
          height={104}
          style={{
            width: 104,
            height: 104,
            borderRadius: 24,
            boxShadow: "0 8px 40px rgba(18, 194, 222, 0.38)",
            margin: "0 auto 24px",
            display: "block",
          }}
        />
        <h1
          style={{
            fontSize: 44,
            fontWeight: 800,
            letterSpacing: -1,
            margin: "0 0 12px",
            background: `linear-gradient(90deg, ${BRAND.text}, ${BRAND.accentSoft} 60%, ${BRAND.accentText})`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          PAPI PLANER
        </h1>
        <p
          style={{
            fontSize: 19,
            lineHeight: 1.5,
            color: BRAND.text2,
            maxWidth: 560,
            margin: "0 auto 32px",
          }}
        >
          Osobisty system zarządzania transformacją prowadzony przez mentorów AI.
          Plan dnia, nawyki, dieta, treningi i cele — wszystko w jednym miejscu.
        </p>
        <a
          href="/login"
          style={{
            display: "inline-block",
            padding: "14px 34px",
            borderRadius: 14,
            background: BRAND.gradient,
            color: BRAND.accentInk,
            fontSize: 16,
            fontWeight: 700,
            textDecoration: "none",
            boxShadow: BRAND.glow,
          }}
        >
          Zaloguj się →
        </a>
      </section>

      {/* What it is / features */}
      <section
        style={{
          maxWidth: 980,
          margin: "0 auto",
          padding: "16px 20px 64px",
        }}
      >
        <h2
          style={{
            fontSize: 24,
            fontWeight: 700,
            textAlign: "center",
            margin: "0 0 8px",
          }}
        >
          Czym jest PAPI PLANER?
        </h2>
        <p
          style={{
            fontSize: 16,
            color: BRAND.text3,
            textAlign: "center",
            maxWidth: 640,
            margin: "0 auto 40px",
            lineHeight: 1.6,
          }}
        >
          To prywatna aplikacja, która łączy planowanie dnia, śledzenie nawyków,
          dietę, treningi i rozwój osobisty. Mentorzy AI analizują Twoje dane i
          prowadzą Cię krok po kroku w stronę Twoich celów.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {FEATURES.map((f) => (
            <div
              key={f.title}
              style={{
                background: BRAND.surface,
                border: `1px solid ${BRAND.border}`,
                borderRadius: 18,
                padding: 22,
              }}
            >
              <div style={{ fontSize: 30, marginBottom: 10 }}>{f.icon}</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
                {f.title}
              </div>
              <div style={{ fontSize: 14, color: BRAND.text2, lineHeight: 1.55 }}>
                {f.desc}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          borderTop: `1px solid ${BRAND.border}`,
          padding: "28px 20px 48px",
          textAlign: "center",
          fontSize: 14,
          color: BRAND.text3,
        }}
      >
        <div style={{ marginBottom: 10 }}>
          <a href="/privacy-policy" style={{ color: BRAND.accentText, margin: "0 10px" }}>
            Polityka prywatności
          </a>
          <a href="/terms" style={{ color: BRAND.accentText, margin: "0 10px" }}>
            Regulamin
          </a>
          <a href="/login" style={{ color: BRAND.accentText, margin: "0 10px" }}>
            Logowanie
          </a>
        </div>
        <div>© 2026 PAPI PLANER · kontakt: 8visionai@gmail.com</div>
      </footer>
    </main>
  );
}
