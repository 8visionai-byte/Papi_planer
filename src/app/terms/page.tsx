import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Regulamin — PAPI PLANER",
  description: "Regulamin korzystania z aplikacji PAPI PLANER",
};

/* Legal pages sit outside the app shell, but they still follow the active theme:
   every colour below is a design token, so the page is dark by default and turns
   light for a user who picked the light theme. No hardcoded hex here. */
const wrap: React.CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "40px 20px 80px",
  fontFamily: "var(--font-ui, system-ui, -apple-system, sans-serif)",
  color: "var(--text)",
  lineHeight: 1.6,
};
const h1: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  marginBottom: 4,
  color: "var(--text)",
};
const h2: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  marginTop: 28,
  marginBottom: 8,
  color: "var(--text)",
};
const p: React.CSSProperties = { fontSize: 15, margin: "8px 0", color: "var(--text-2)" };
const meta: React.CSSProperties = { color: "var(--text-3)", fontSize: 14 };
/* No global `a` rule exists, so links would fall back to the browser blue,
   which is unreadable on the dark background. */
const link: React.CSSProperties = { color: "var(--accent-text)" };

export default function TermsPage() {
  return (
    <main style={wrap}>
      <h1 style={h1}>Regulamin</h1>
      <p style={meta}>PAPI PLANER · Ostatnia aktualizacja: czerwiec 2026</p>

      <h2 style={h2}>1. Charakter aplikacji</h2>
      <p style={p}>
        PAPI PLANER to osobista aplikacja do planowania dnia, śledzenia nawyków, diety, treningów
        i celów, wspierana przez mentorów AI. Korzystasz z niej na własną odpowiedzialność.
      </p>

      <h2 style={h2}>2. Treści generowane przez AI</h2>
      <p style={p}>
        Plany treningowe, dietetyczne, podsumowania i sugestie generowane przez sztuczną
        inteligencję mają charakter wyłącznie informacyjny i motywacyjny. Nie zastępują porady
        lekarza, dietetyka, trenera ani innego specjalisty. Przed rozpoczęciem intensywnych
        treningów lub diety skonsultuj się ze specjalistą.
      </p>

      <h2 style={h2}>3. Odpowiedzialność</h2>
      <p style={p}>
        Administrator nie ponosi odpowiedzialności za decyzje podjęte na podstawie sugestii
        aplikacji ani za ewentualne skutki zdrowotne. Korzystasz z aplikacji świadomie i na własne
        ryzyko.
      </p>

      <h2 style={h2}>4. Dane</h2>
      <p style={p}>
        Zasady przetwarzania danych opisuje{" "}
        <a href="/privacy-policy" style={link}>
          Polityka Prywatności
        </a>
        .
      </p>

      <h2 style={h2}>5. Kontakt</h2>
      <p style={p}>
        <a href="mailto:8visionai@gmail.com" style={link}>
          8visionai@gmail.com
        </a>
      </p>

      <p style={{ marginTop: 32, fontSize: 14, color: "var(--text-3)" }}>
        <a href="/privacy-policy" style={link}>
          Polityka Prywatności
        </a>{" "}
        ·{" "}
        <a href="/login" style={link}>
          Powrót do aplikacji
        </a>
      </p>
    </main>
  );
}
