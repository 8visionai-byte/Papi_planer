import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Polityka Prywatności — PAPI PLANER",
  description: "Polityka prywatności aplikacji PAPI PLANER",
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
const li: React.CSSProperties = { fontSize: 15, margin: "4px 0", color: "#334155" };

export default function PrivacyPolicyPage() {
  return (
    <main style={wrap}>
      <h1 style={h1}>Polityka Prywatności</h1>
      <p style={{ color: "#64748b", fontSize: 14 }}>
        PAPI PLANER · Ostatnia aktualizacja: czerwiec 2026
      </p>

      <h2 style={h2}>1. Administrator</h2>
      <p style={p}>
        PAPI PLANER to osobista aplikacja do zarządzania transformacją i planowania dnia.
        Administratorem danych jest Paweł Pieloch. Kontakt:{" "}
        <a href="mailto:8visionai@gmail.com">8visionai@gmail.com</a>.
      </p>

      <h2 style={h2}>2. Jakie dane zbieramy</h2>
      <ul>
        <li style={li}>Dane konta Google (imię, adres e-mail) — wyłącznie do logowania.</li>
        <li style={li}>
          Dane wprowadzane przez Ciebie: cele, nawyki, posiłki, treningi, wpisy w dzienniku,
          dane profilu (np. waga, wzrost, wiek, poziom aktywności).
        </li>
        <li style={li}>
          Dane z Google Calendar (tylko do odczytu) — wydarzenia z Twojego kalendarza, aby
          pokazać spotkania w planie dnia.
        </li>
      </ul>

      <h2 style={h2}>3. Wykorzystanie danych Google (Limited Use)</h2>
      <p style={p}>
        Dane z Google Calendar wykorzystujemy wyłącznie do wyświetlania Twoich spotkań w planie
        dnia w aplikacji. W szczególności:
      </p>
      <ul>
        <li style={li}>NIE przekazujemy ich osobom trzecim.</li>
        <li style={li}>NIE wykorzystujemy ich do reklam.</li>
        <li style={li}>NIE wykorzystujemy ich do trenowania modeli sztucznej inteligencji.</li>
      </ul>
      <p style={p}>
        Korzystanie i przekazywanie informacji otrzymanych z interfejsów Google API podlega{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , w tym wymogom Limited Use.
      </p>

      <h2 style={h2}>4. Sztuczna inteligencja</h2>
      <p style={p}>
        Treści wprowadzane przez Ciebie (cele, dziennik, opisy aktywności) mogą być przesyłane do
        API Anthropic (Claude) w celu generowania planów, podsumowań i odpowiedzi mentorów AI.
        Dane nie są wykorzystywane do trenowania modeli.
      </p>

      <h2 style={h2}>5. Przechowywanie i usuwanie danych</h2>
      <p style={p}>
        Dane przechowujemy na serwerze aplikacji tak długo, jak korzystasz z aplikacji. W każdej
        chwili możesz zażądać ich usunięcia, pisząc na{" "}
        <a href="mailto:8visionai@gmail.com">8visionai@gmail.com</a>.
      </p>

      <h2 style={h2}>6. Bezpieczeństwo</h2>
      <p style={p}>
        Połączenie z aplikacją jest szyfrowane (HTTPS). Tokeny dostępu Google przechowujemy
        bezpiecznie i wykorzystujemy wyłącznie do pobierania wydarzeń z Twojego kalendarza.
      </p>

      <h2 style={h2}>7. Kontakt</h2>
      <p style={p}>
        W sprawach dotyczących prywatności:{" "}
        <a href="mailto:8visionai@gmail.com">8visionai@gmail.com</a>.
      </p>

      <p style={{ marginTop: 32, fontSize: 14 }}>
        <a href="/terms">Regulamin</a> · <a href="/login">Powrót do aplikacji</a>
      </p>
    </main>
  );
}
