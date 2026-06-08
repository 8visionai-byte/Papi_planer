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

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0f172a",
        color: "#f8fafc",
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
            boxShadow: "0 8px 40px rgba(29, 78, 216, 0.45)",
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
            background: "linear-gradient(90deg, #f8fafc, #93c5fd)",
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
            color: "#cbd5e1",
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
            padding: "14px 32px",
            borderRadius: 12,
            background: "#1d4ed8",
            color: "#fff",
            fontSize: 16,
            fontWeight: 700,
            textDecoration: "none",
            boxShadow: "0 4px 20px rgba(29, 78, 216, 0.5)",
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
            color: "#94a3b8",
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
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 16,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 30, marginBottom: 10 }}>{f.icon}</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
                {f.title}
              </div>
              <div style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.55 }}>
                {f.desc}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid #1e293b",
          padding: "28px 20px 48px",
          textAlign: "center",
          fontSize: 14,
          color: "#64748b",
        }}
      >
        <div style={{ marginBottom: 10 }}>
          <a href="/privacy-policy" style={{ color: "#93c5fd", margin: "0 10px" }}>
            Polityka prywatności
          </a>
          <a href="/terms" style={{ color: "#93c5fd", margin: "0 10px" }}>
            Regulamin
          </a>
          <a href="/login" style={{ color: "#93c5fd", margin: "0 10px" }}>
            Logowanie
          </a>
        </div>
        <div>© 2026 PAPI PLANER · kontakt: 8visionai@gmail.com</div>
      </footer>
    </main>
  );
}
