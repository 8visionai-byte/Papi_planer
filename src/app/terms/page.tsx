import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Regulamin — PAPI PLANER",
  description: "Regulamin korzystania z aplikacji PAPI PLANER",
};

const wrap: React.CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "40px 20px 80px",
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#0f172a",
  lineHeight: 1.6,
};
const h1: React.CSSProperties = { fontSize: 28, fontWeight: 700, marginBottom: 4 };
const h2: React.CSSProperties = { fontSize: 18, fontWeight: 600, marginTop: 28, marginBottom: 8 };
const p: React.CSSProperties = { fontSize: 15, margin: "8px 0", color: "#334155" };

export default function TermsPage() {
  return (
    <main style={wrap}>
      <h1 style={h1}>Regulamin</h1>
      <p style={{ color: "#64748b", fontSize: 14 }}>
        PAPI PLANER · Ostatnia aktualizacja: czerwiec 2026
      </p>

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
        Zasady przetwarzania danych opisuje <a href="/privacy-policy">Polityka Prywatności</a>.
      </p>

      <h2 style={h2}>5. Kontakt</h2>
      <p style={p}>
        <a href="mailto:8visionai@gmail.com">8visionai@gmail.com</a>
      </p>

      <p style={{ marginTop: 32, fontSize: 14 }}>
        <a href="/privacy-policy">Polityka Prywatności</a> ·{" "}
        <a href="/login">Powrót do aplikacji</a>
      </p>
    </main>
  );
}
