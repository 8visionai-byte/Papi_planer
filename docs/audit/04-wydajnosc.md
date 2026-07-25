# Audyt wydajnosci — PAPI PLANER (frontend)

Data: 2026-07-25
Zakres: dashboard / diet / goals + powloka aplikacji, sieć, animacje, rozmiar paczki, postrzegana szybkosc
Tryb: READ-ONLY (zaden plik aplikacji nie zostal zmieniony)

Jak zdobylem liczby (zeby nie bylo zgadywania):
- rozmiary paczek: uruchomilem realny `npx next build` w tym folderze (25.07.2026) i policzylem wagę plikow JS,
  ktore przegladarka faktycznie pobiera dla kazdej strony (odczyt z `.next/server/app/*.html` + `.next/build-manifest.json`)
- reszta: czytanie realnego kodu, kazde znalezisko ma plik i numer linii
- NIE profilowalem aplikacji w przegladarce na zywo (patrz sekcja Ryzyka, punkt "Czego nie zmierzylem")

---

## Streszczenie

Aplikacja nie jest wolna z powodu "ciezkiego frameworka" — jest wolna, bo w kilku miejscach czeka na siec wtedy, kiedy nie musi, i nie daje zadnej odpowiedzi na dotkniecie palca. Przy wejsciu na pulpit przegladarka robi 5-6 osobnych zapytan, a jedno z nich (`/api/dashboard`) czeka na odpowiedz Google Kalendarza, zanim w ogole pokaze plan dnia — czyli caly ekran stoi przez cudzy serwer. Nawigacja dolna nie jest przygotowywana z wyprzedzeniem, wiec kazde tapniecie zakladki to pobieranie kodu strony od zera; do tego zaden przycisk w aplikacji nie reaguje na dotkniecie (brak wcisniecia, brak wibracji) — i to jest glowny powod, dla ktorego "nie czuc aplikacji", nawet gdyby dane byly natychmiastowe.

Druga warstwa problemu to przerenderowywanie. W calej aplikacji nie ma ani jednego `React.memo` (0 wystapien w 23 komponentach), a formularze trzymaja tekst na poziomie calej strony — kazda wpisana litera przerysowuje pulpit (2609 linii) albo strone celow (2405 linii) w calosci. Service worker istnieje, ale nie zapisuje nic w pamieci podrecznej (jest zwyklym przekaznikiem), wiec po powrocie do aplikacji wszystko leci z sieci od nowa i offline mamy bialy ekran.

Rozmiar jest do opanowania: pulpit to 224 KB skompresowanego JS, ale strona `/tracking` to az 311 KB, z czego 107 KB to jedna biblioteka wykresow (recharts), ktorej aplikacja i tak nie potrzebuje — na stronie diety te same wykresy sa juz narysowane recznie w SVG za darmo. Osobno 13 KB na pulpicie idzie na bibliotece dat, uzytej do sformatowania jednej daty.

Dobra wiadomosc: fundament jest zdrowy. Optymistyczne odswiezanie (checkbox zaznacza sie od razu) juz dziala na pulpicie i w celach, karuzela uzywa `transform` (czyli tego, co plynne), a struktura komponentow jest czysta — nie ma komponentow definiowanych wewnatrz komponentow, co jest najczestszym grzechem w takich plikach. Trzeba dolozyc: prefetch nawigacji, reakcje na dotyk, cache, memo i rozbicie stanu formularzy.

---

## Znaleziska krytyczne

### K1. Pulpit czeka na Google Kalendarz, zanim pokaze plan dnia
`src/app/api/dashboard/route.ts:97-181`

Endpoint najpierw robi 4 rownolegle zapytania do bazy (linia 97, dobrze), a potem **poza** tym blokiem, sekwencyjnie, dzwoni do Google (`getCalendarEvents`, linia 161) i dopiero potem zwraca cala odpowiedz (linia 183). Skutek: jesli Google odpowiada 800 ms, to plan dnia, nawyki, briefing i statystyki czekaja te 800 ms, mimo ze sa juz gotowe. Jesli Google timeoutuje — uzytkownik patrzy w szkielet.

### K2. Przy powrocie do aplikacji kazde zapytanie leci dwa razy
`src/app/(app)/dashboard/page.tsx:367-380` oraz `src/app/(app)/diet/page.tsx:1598-1613`

Ten sam handler jest podpiety pod `visibilitychange` **i** pod `focus`. Przy powrocie na karte/do aplikacji przegladarka odpala oba zdarzenia, wiec `fetchDashboard()` i `fetchHabits()` wykonuja sie po dwa razy — 4 zapytania zamiast 2. To samo w diecie. Do tego next-auth domyslnie sam odswieza sesje przy focusie, wiec dochodzi jeszcze `/api/auth/session`.

### K3. Brak przerywania zapytan — wyscig kasuje optymistyczny UI
`src/app/(app)/dashboard/page.tsx:314-338` (brak `AbortController`; jedyny `AbortController` w pliku dotyczy strumienia briefingu, linia 231/540)

`fetchDashboard()` nadpisuje caly stan (`setData(json)`). Scenariusz z zycia: uzytkownik wraca do aplikacji (leci zapytanie z K2), po 200 ms odklika aktywnosc (optymistycznie zaznacza sie ptaszek), po 600 ms wraca stara odpowiedz z serwera i **ptaszek sam sie odznacza**. Wyglada jak "aplikacja gubi dane".

### K4. Service worker nie cache'uje niczego
`public/sw.js:10-12`

```js
self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request));
});
```

To przekaznik 1:1. Zero offline, zero szybkiego startu z pamieci, a przy okazji przechwytywanie kazdego zapytania i wysylanie go od nowa odbiera przegladarce jej wlasne optymalizacje. Dodatkowo service worker jest rejestrowany **dwa razy**, przez dwa rozne komponenty: `src/components/pwa/ServiceWorkerRegister.tsx` (w `src/app/layout.tsx:38`) i `src/components/pwa/ServiceWorkerRegistrar.tsx` (w `src/app/(app)/layout.tsx:68`).

### K5. Nawigacja dolna bez prefetch — kazde tapniecie to pobieranie kodu
`src/components/shell/BottomTabBar.tsx:161` (`onClick={() => router.push(tab.path)}`)

Zakladki to zwykle `<button>` z `router.push`. Next.js pobiera kod strony z wyprzedzeniem tylko dla `<Link>` widocznych na ekranie. Tutaj: dotykasz "Dieta" → dopiero teraz leci pobranie ~50-100 KB kodu tej strony → dopiero potem strona sie montuje → dopiero potem leci jej zapytanie o dane. Trzy kroki po sobie, kazdy z opoznieniem sieci. W calej aplikacji `next/link` jest uzyty tylko w 2 miejscach (`app/(app)/mentors/page.tsx:4`, `app/not-found.tsx:1`).

### K6. Zero reakcji na dotkniecie i zero wibracji
Sprawdzone gruntownie: `navigator.vibrate` — **0 wystapien** w calym `src/`. Stan `:active` — **0 wystapien** (jest to niemozliwe przy stylach inline, ktorych aplikacja uzywa wszedzie). Tylko 2 miejsca maja efekt wcisniecia przez `onPointerDown`: `src/app/(app)/mentors/page.tsx:461` i `src/components/mentors/MentorCard.tsx:38`.

Efekt: kazde tapniecie w aplikacji jest "martwe" przez czas przelotu do serwera. Nawet jesli backend odpowie w 100 ms, mozg czyta to jako "nie zadzialalo".

### K7. Kazda litera w formularzu przerysowuje cala strone
- pulpit: `planContext` w stanie strony (`dashboard/page.tsx:224`), podpiety do `VoiceTextarea` (linie 1093-1099 i 1177-1183). `VoiceTextarea` jest sterowany z gory (`components/forms/VoiceTextarea.tsx:9-11`), wiec kazdy znak = `setState` na poziomie `DashboardPage` = przerysowanie wszystkich `ActivityRow`, `MeetingRow`, `BriefingCard`, `WeightTracker` i panelu statystyk.
- cele: `editDraft` (`goals/page.tsx:242`, uzyty w polach 1682-1717) i `feedbackDraft` (`goals/page.tsx:308`, pole 2243) — kazda litera przerysowuje **wszystkie** karty celow i wszystkie karty planow mentorow.
- dieta: 7 osobnych stanow formularza posilku (`diet/page.tsx:1531-1537`) na poziomie `DietPage`.

### K8. Zero memoizacji list — `React.memo` nie wystepuje ani razu
Sprawdzone: `grep -rn "\bmemo("` w `src/app` i `src/components` → **0 wynikow**. `useMemo` — tylko 6 wystapien w calej aplikacji (5 w diecie: `diet/page.tsx:1523,1816,1826,1832`, 1 w `discipline/[slug]/page.tsx:576`).

Konkretnie niezmemoizowane, a odtwarzane przy kazdym renderze:
- `dashboard/page.tsx:826-832` — grupowanie aktywnosci na pory dnia
- `dashboard/page.tsx:834-847` — grupowanie spotkan + `sort()` trzech tablic
- `dashboard/page.tsx:850-856` — sumy i `reduce()` po aktywnosciach
- `dashboard/page.tsx:1386-1400` — scalanie aktywnosci ze spotkaniami + `sort()`, **wewnatrz `.map()` po porach dnia** (czyli 3 razy na render)
- `goals/page.tsx:860-877` — `filter` x2, budowa dwoch `Map`, petla po planach
- `dashboard/page.tsx:1845` (`MeetingRow`), `:2043` (`ActivityRow`), `:2601` (`StatItem`) — komponenty listowe bez `memo`
- `diet/page.tsx:783` (`BalanceBarsChart`, 336 linii matematyki SVG) i `diet/page.tsx:1119` (`BurnEatLineChart`, 396 linii) — bez `memo`, przeliczaja cala geometrie wykresu przy kazdym renderze strony diety

Dodatkowo funkcje `toggleActivity` (`dashboard/page.tsx:382`) i `toggleMeeting` (`:464`) sa zwyklymi funkcjami tworzonymi od nowa przy kazdym renderze i wchodza do wierszy jako `onToggle={() => toggleActivity(act.id)}` (`:1442`) — czyli nawet po dodaniu `memo` nic by nie dalo bez `useCallback`.

### K9. Strona diety pokazuje pusty ekran z kolowrotkiem zamiast szkieletu
`src/app/(app)/diet/page.tsx:1842-1864`

`if (loading) return <spinner>` — cala strona jest zablokowana do konca zapytania. Pulpit robi to dobrze (szkielety, `dashboard/page.tsx:162-187, 960`), dieta nie. To samo w `discipline/[slug]/page.tsx:192` i w powloce `app/(app)/layout.tsx:21-43`.

### K10. Zapisy w diecie nie sa optymistyczne — dwa przeloty do serwera zanim cokolwiek drgnie
`src/app/(app)/diet/page.tsx:1711-1746` (zapis) i `:1765-1784` (usuwanie)

Po kliknieciu "Zapisz posilek": czekamy na `POST /api/meals`, potem `fetchToday()` (drugie zapytanie), i dopiero wtedy lista sie zmienia. Usuwanie tak samo, plus systemowe okienko `confirm()` (linia 1767). Takich blokujacych okienek `confirm()` jest w aplikacji 9 (m.in. `dashboard/page.tsx:740`, `habits/page.tsx:244`, `journal/page.tsx:312`, `goals/page.tsx:1250`).

### K11. Wszystkie trzy panele karuzeli sa zawsze zamontowane i pobieraja dane
`src/app/(app)/dashboard/page.tsx:978, 1465, 1479` — panele roznia sie tylko `height: 0`.

Skutek: `WeightTracker` (panel "Statystyki") montuje sie zawsze i od razu strzela `fetch("/api/weight", { cache: "no-store" })` (`components/weight/WeightTracker.tsx:145,156`), nawet jesli uzytkownik nigdy nie przesunie na trzeci panel. To jest 4. zapytanie przy wejsciu na pulpit.

### K12. Karuzela nie idzie za palcem
`src/app/(app)/dashboard/page.tsx:791-820` + `:973`

`onTouchMove` liczy przesuniecie palca do `touchDeltaRef.current` (linia 806), ale ta wartosc **nigdy nie trafia do stylu**. `transform` zalezy wylacznie od `activePanel` (linia 973). Czyli: przesuwasz palcem — nic sie nie rusza; puszczasz — panel przeskakuje. Natywna aplikacja przykleja panel do palca. Do tego wysokosc panelu przelacza sie skokowo (`height: activePanel === 0 ? "auto" : 0`), wiec podczas przesuwania kontener zmienia wysokosc natychmiast, a zawartosc jedzie 300 ms — stad "skakanie".

---

## Ile zapytan robi pulpit przy wejsciu (policzone)

Przy jednym wejsciu na `/dashboard`:

| # | Zapytanie | Skad | Rownolegle? |
|---|-----------|------|-------------|
| 1 | `GET /api/auth/session` | `SessionProvider` (next-auth) w `app/layout.tsx:39` | blokuje render powloki (`app/(app)/layout.tsx:21`) |
| 2 | `GET /api/dashboard` | `dashboard/page.tsx:316` | rownolegle z 3-5 |
| 3 | `GET /api/habits` | `dashboard/page.tsx:260` | rownolegle |
| 4 | `POST /api/briefing/finalize` | `dashboard/page.tsx:347` | rownolegle |
| 5 | `GET /api/weight` | `WeightTracker.tsx:145` (panel niewidoczny!) | rownolegle |
| 6 | `POST /api/dashboard/init` + **drugie** `GET /api/dashboard` | `dashboard/page.tsx:321-327` | **sekwencyjnie, po 2** |

Czyli 4-6 zapytan, plus sesja. Uwagi:
- **kolejnosc jest kaskadowa**: sesja (siec) → render → dane (siec). Dwa przeloty, zanim cokolwiek widac. Middleware (`src/middleware.ts:38-46`) i tak juz sprawdza ciasteczko sesji na serwerze, wiec blokowanie renderu na kliencie do konca `useSession` jest podwojna praca.
- `POST /api/briefing/finalize` moze **wywolac model Anthropic** (`app/api/briefing/finalize/route.ts:80`). Jest to strzal w tle przy kazdym wejsciu na pulpit; ma zabezpieczenia (linie 69-74), ale kiedy warunki sa spelnione — trwa kilka-kilkanascie sekund i zajmuje polaczenie.
- **cache: zaden**. Zadna trasa `/api/*` nie ustawia `Cache-Control` poza `no-cache` na strumieniach (`briefing/generate`, `chat`, `roundtable`). Zero `stale-while-revalidate`, zero pamieci w kliencie — po kazdym powrocie na strone wszystko leci od nowa.
- **optymistyczny UI**: JEST na pulpicie (aktywnosci `:386-394`, spotkania `:469-477`, nawyki `:288-289`) i w celach (`goals/page.tsx:316-325`, `:487-493`). NIE MA w diecie (K10).

Strona celow robi to lepiej: 3 zapytania w `Promise.all` (`goals/page.tsx:251-255`).

---

## Animacje: co jest OK, a co szarpie

Dobre (GPU, nie ruszaja ukladu strony):
- karuzela pulpitu — `transform: translateX` (`dashboard/page.tsx:973-974`)
- kolo kalorii w diecie — `stroke-dashoffset` (`diet/page.tsx:244`)
- wszystkie kreciolki — `transform: rotate` (`app/globals.css:26-30`)
- toast — `opacity` + `translateY` (`dashboard/page.tsx:1825-1828`)

Do poprawy (kazda z tych wlasciwosci zmusza przegladarke do ponownego liczenia ukladu strony w kazdej klatce):

| Plik:linia | Co animuje | Problem |
|---|---|---|
| `dashboard/page.tsx:1829-1832` | `@keyframes expandIn { max-height: 0 → 200px }` | `max-height` = layout w kazdej klatce; do tego przy tresci dluzszej niz 200 px animacja sie urywa |
| `dashboard/page.tsx:896` | pasek postepu, `transition: width 400ms` | layout; ma byc `transform: scaleX` |
| `dashboard/page.tsx:1579-1583` | kropki karuzeli, `width` 6↔16 px + `transition: all` | layout |
| `dashboard/page.tsx:1317, 1902, 2103` | checkboxy, `transition: all` + `border: 2px ↔ none` | `all` obejmuje tez `border-width`, wiec kazdy ptaszek przesuwa sasiadow o 2 px |
| `diet/page.tsx:382` | paski makro, `transition: width 300ms` | layout |
| `habits/page.tsx:301` | pasek postepu, `width 400ms` | layout |
| `components/tracking/MoodChart.tsx:95` | slupki, `width 500ms` | layout |
| `components/briefing/BriefingCard.tsx:305` | pasek audio, `width 200ms linear` | layout, animowany non-stop podczas odtwarzania |
| `components/files/FileUpload.tsx:199` | pasek uploadu, `width 0.3s` | layout |
| `admin/page.tsx:60`, `mentors/page.tsx:794`, `tracking/page.tsx:229`, i 8 innych | `transition: all` | `all` = przegladarka pilnuje kazdej wlasciwosci |

Brakuje tez calkowicie: `will-change`, `touch-action`, `overscroll-behavior` — **0 wystapien** w calym `src/`. Bez `overscroll-behavior: none` przewijanie do konca listy ciagnie cala strone (efekt "gumy" znany z przegladarki, nie z aplikacji).

---

## Rozmiar: realne liczby z buildu (25.07.2026)

| Strona | JS surowy | JS po kompresji (gzip) |
|---|---|---|
| `/tracking` | 1064 KB | **311 KB** |
| `/dashboard` | 763 KB | **224 KB** |
| `/goals` | 715 KB | 210 KB |
| `/diet` | 703 KB | 210 KB |
| `/mentors` | 703 KB | 210 KB |
| `/habits` | 690 KB | 207 KB |
| wspolna baza (kazda strona) | 556 KB | ~170 KB |

Co wazy najwiecej i da sie usunac:

1. **recharts — 380 KB surowo / 107 KB gzip**, jedna paczka `.next/static/chunks/0npi1b.fuf9bq.js`, ladowana **wylacznie** na `/tracking`. Uzywaja jej 3 komponenty: `components/tracking/EnergyChart.tsx:11`, `SleepChart.tsx:12`, `CompletionChart.tsx:11`. Jednoczesnie `MoodChart.tsx` i **oba wykresy w diecie** (`diet/page.tsx:783` i `:1119`) sa napisane recznie w SVG i nie waza nic. Czyli aplikacja ma juz wlasny sposob rysowania wykresow — recharts jest duplikatem.
2. **date-fns + polska lokalizacja — 47 KB surowo / 13 KB gzip** (`.next/static/chunks/156obb_lel71y.js`), na `/dashboard`. Uzycie: `import { format } from "date-fns"` + `import { pl } from "date-fns/locale"` (`dashboard/page.tsx:13-14`) do **jednej** linijki: `format(today, "EEEE, d MMMM", { locale: pl })` (`:823`). Strona diety robi dokladnie to samo bez zadnej biblioteki: `date.toLocaleDateString("pl-PL", {...})` (`diet/page.tsx:154,160`).
3. **`next-pwa` w `package.json:23`** — nieuzywany. `next.config.ts` jest pusty (4 linie, zero opcji), service worker jest reczny (`public/sw.js`). Zaleznosc do usuniecia.
4. `xlsx` (7 MB w node_modules), `mammoth` (2,5 MB), `pdf-parse` — uzywane **tylko** po stronie serwera (`src/lib/files/parser.ts`), do klienta nie trafiaja. OK, zostawic.
5. `@anthropic-ai/sdk` i `openai` — tylko trasy API. OK.

Ktore strony powinny byc ladowane leniwie (`next/dynamic`): w calej aplikacji jest **0 wystapien** `next/dynamic`. Kandydaci po kolei:
- wykresy `/tracking` (`EnergyChart`, `SleepChart`, `CompletionChart`) — `dynamic(..., { ssr: false, loading: <szkielet> })` zdejmuje 107 KB gzip z pierwszego wejscia
- `BalanceBarsChart` i `BurnEatLineChart` w diecie — sa w zakladce "Kalendarz", a laduja sie z kodem zakladki "Dzisiaj"
- modal historii briefingow (`dashboard/page.tsx:1618-1798`) i `FollowUpSheet` — potrzebne dopiero po kliknieciu
- `MicDevicePicker` / `VoiceTextarea` — sciagaja `useVoiceRecorder`, a mikrofon jest uzywany rzadko

---

## Rekomendacje

### P0 — blokuje wrazenie "premium" (bez tego nie warto ruszac reszty)

1. **Reakcja na dotyk + wibracja w kazdym elemencie klikalnym.** Bez tego zadna optymalizacja sieci nie zostanie zauwazona. Gotowy kod nizej (G1, G2).
2. **Prefetch nawigacji dolnej** — `BottomTabBar.tsx`: zamienic `router.push` na `<Link prefetch>` albo dodac `router.prefetch()` dla wszystkich zakladek po zamontowaniu paska (G3).
3. **Wyciac Google Kalendarz z krytycznej sciezki** `/api/dashboard` (K1) — osobny endpoint `/api/dashboard/calendar` pobierany rownolegle z klienta; spotkania doklejaja sie, gdy przyjda.
4. **Naprawic podwojne zapytania i wyscigi** (K2, K3) — jeden handler z blokada "nie czesciej niz co X sekund" + `AbortController` (G4).
5. **Service worker, ktory naprawde cache'uje** (K4) — powloka aplikacji i ikony `cache-first`, dane `stale-while-revalidate` (G5). Usunac jeden z dwoch rejestratorow.
6. **Szkielety zamiast pustych ekranow** w diecie (K9) i w powloce `app/(app)/layout.tsx:21` — pokazywac od razu naglowek + zakladki + szare bloki, nigdy samego kolowrotka.

### P1 — wazne (plynnosc i koszt renderowania)

7. **Wyciagnac formularze do wlasnych komponentow** (K7): "Wygeneruj z wkladem" i "Przeplanuj" z pulpitu, edycja celu i feedback z celow, formularz posilku z diety. Kazdy z wlasnym stanem, oddaje tekst dopiero przy zatwierdzeniu.
8. **`memo` + `useCallback` na wierszach list** (K8): `ActivityRow`, `MeetingRow`, `StatItem`, `GoalCard`, `MentorPlanCard`, `BalanceBarsChart`, `BurnEatLineChart` (G6).
9. **`useMemo` na przeliczeniach**: `grouped`, `meetingsByBlock`, `merged`, sumy kalorii, `plansByGoalId`.
10. **Usunac date-fns z pulpitu** → `toLocaleDateString("pl-PL", ...)` (G7). Minus 13 KB gzip z najczesciej otwieranej strony.
11. **Usunac recharts** — przepisac 3 wykresy `/tracking` w SVG (wzorzec juz jest w `diet/page.tsx:783-1515`) albo minimum `next/dynamic`. Minus 107 KB gzip.
12. **Nie montowac niewidocznych paneli karuzeli** (K11) — renderowac panel dopiero po pierwszym wejsciu na niego, potem trzymac w pamieci.
13. **Animacje na `transform`/`opacity`** — zamiana `width` na `scaleX`, `max-height` na `grid-template-rows` albo `opacity` + `transform` (G8).
14. **Karuzela za palcem** (K12) — przesuwac `translateX` w czasie rzeczywistym.
15. **Optymistyczny zapis i usuwanie w diecie** (K10) — dopisac posilek do listy od razu, wycofac przy bledzie.

### P2 — dopieszczenie

16. `next.config.ts` jest pusty — dodac `experimental.optimizePackageImports` dla `date-fns` i `recharts` (jesli zostaje) oraz rozwazyc React Compiler (automatyczna memoizacja).
17. Wywalic `next-pwa` z `package.json` (nieuzywany) i jeden z dwoch rejestratorow service workera.
18. Zamienic 9 systemowych `confirm()` na wlasny arkusz potwierdzenia (natywne okienko wyglada jak strona WWW, nie jak aplikacja).
19. `Math.random()` w szkielecie (`dashboard/page.tsx:182`) — szerokosci pasków losuja sie przy kazdym przerysowaniu, szkielet "miga". Dac staly zestaw szerokosci.
20. 15 plikow wstrzykuje wlasny `<style>` z powtarzajacymi sie `@keyframes` (m.in. `vt-spin` zdefiniowany w 4 miejscach). Przeniesc do `globals.css`.
21. Dodac `Cache-Control: private, max-age=0, stale-while-revalidate=60` na `GET /api/dashboard`, `/api/habits`, `/api/meals` — powrot na strone bedzie natychmiastowy, dane odswieza sie w tle.

---

## Gotowe do wdrozenia

### G1. Haptyka — jeden plik, uzywany wszedzie
`src/lib/haptics.ts` (nowy plik)

```ts
type Pattern = "tap" | "success" | "warning" | "error";

const PATTERNS: Record<Pattern, number | number[]> = {
  tap: 8,              // dotkniecie przycisku / checkbox
  success: [12, 40, 18], // zapisano, cel ukonczony
  warning: [20, 60, 20],
  error: [30, 50, 30, 50, 30],
};

export function haptic(pattern: Pattern = "tap") {
  if (typeof navigator === "undefined") return;
  if (!("vibrate" in navigator)) return; // iOS Safari zignoruje, to OK
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    /* nic */
  }
}
```

Uzycie w checkboxie aktywnosci (`dashboard/page.tsx:2088`):

```tsx
onClick={(e) => {
  e.stopPropagation();
  if (!toggling) { haptic("tap"); onToggle(); }
}}
```

Uwaga: iOS/Safari nie wspiera `navigator.vibrate`. Na iPhonie wrazenie "wcisniecia" musi dac animacja z G2 — dlatego oba punkty ida razem.

### G2. Wcisniecie przycisku (dziala tam, gdzie sa style inline)
`src/components/ui/Pressable.tsx` (nowy plik)

```tsx
"use client";
import { useState } from "react";
import { haptic } from "@/lib/haptics";

export function Pressable({
  children, onPress, disabled, style, scale = 0.96, hapticOnPress = true,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  scale?: number;
  hapticOnPress?: boolean;
}) {
  const [down, setDown] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={() => !disabled && setDown(true)}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      onPointerCancel={() => setDown(false)}
      onClick={() => {
        if (disabled) return;
        if (hapticOnPress) haptic("tap");
        onPress?.();
      }}
      style={{
        transform: down ? `scale(${scale})` : "scale(1)",
        opacity: down ? 0.85 : 1,
        transition: down
          ? "transform 60ms cubic-bezier(0.2,0,0.4,1), opacity 60ms linear"
          : "transform 260ms cubic-bezier(0.34,1.56,0.64,1), opacity 200ms linear",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
```

Kluczowe liczby: wcisniecie **60 ms** (natychmiast), powrot **260 ms** ze sprezyna. Taki rozklad czasow daje wrazenie "fizycznego" przycisku.

Globalnie do `src/app/globals.css` (dziala nawet bez zmian w komponentach):

```css
button, [role="button"] {
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
button:active:not(:disabled), [role="button"]:active {
  transform: scale(0.97);
  transition: transform 60ms cubic-bezier(0.2, 0, 0.4, 1);
}
body { overscroll-behavior-y: none; }
```

### G3. Prefetch zakladek — `BottomTabBar.tsx`

```tsx
// obok istniejacych useEffect (linia ~40):
useEffect(() => {
  const id = window.setTimeout(() => {
    visibleTabs.forEach((t) => router.prefetch(t.path));
  }, 1200); // po pierwszym renderze, zeby nie konkurowac o pasmo
  return () => window.clearTimeout(id);
}, [router, visibleTabs.length]);
```

Do tego w `onClick` dodac `haptic("tap")`, a `onPointerEnter`/`onPointerDown` moze wywolac `router.prefetch(tab.path)` dla pewnosci.

### G4. Jeden handler powrotu do aplikacji, bez dublowania i bez wyscigu
Zastepuje `dashboard/page.tsx:367-380` i analogicznie `diet/page.tsx:1598-1613`.

```tsx
const lastFetchRef = useRef(0);
const inflightRef = useRef<AbortController | null>(null);

const refreshIfStale = useCallback(() => {
  if (document.visibilityState !== "visible") return;
  const now = Date.now();
  if (now - lastFetchRef.current < 5000) return; // 5 s — zabija dublet focus+visibilitychange
  lastFetchRef.current = now;
  inflightRef.current?.abort();                  // anuluj poprzednie, zeby stara odpowiedz nie nadpisala nowej
  const ctrl = new AbortController();
  inflightRef.current = ctrl;
  fetchDashboard(ctrl.signal);
  fetchHabits(ctrl.signal);
}, [fetchDashboard, fetchHabits]);

useEffect(() => {
  document.addEventListener("visibilitychange", refreshIfStale);
  window.addEventListener("focus", refreshIfStale);
  return () => {
    document.removeEventListener("visibilitychange", refreshIfStale);
    window.removeEventListener("focus", refreshIfStale);
    inflightRef.current?.abort();
  };
}, [refreshIfStale]);
```

`fetchDashboard` musi przyjac `signal` i przekazac go do `fetch(url, { signal })`, a w `catch` ignorowac `AbortError` (wzorzec jest juz w pliku, linia 604).

Dodatkowo w `src/app/layout.tsx` warto wylaczyc automatyczne odswiezanie sesji przy focusie:

```tsx
<NextAuthSessionProvider refetchOnWindowFocus={false} refetchInterval={0}>
```

### G5. Service worker z prawdziwym cache — `public/sw.js`

```js
const SHELL = "papi-shell-v1";
const DATA  = "papi-data-v1";
const SHELL_ASSETS = ["/manifest.json", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                 // POST/DELETE zawsze do sieci
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/auth")) return; // sesji nigdy nie cache'ujemy

  // 1. kod i statyki Next.js — z cache, natychmiast
  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/icons")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // 2. dane — pokaz stare od razu, odswiez w tle (stale-while-revalidate)
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      caches.open(DATA).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
  // reszta (nawigacje) — domyslne zachowanie przegladarki
});
```

Uwaga: przy zmianie `sw.js` trzeba podniesc `papi-shell-v1` → `v2`, inaczej stary cache zostanie.

### G6. Memoizacja wiersza aktywnosci — `dashboard/page.tsx`

```tsx
// 1) opakowac komponent (linia 2043):
const ActivityRow = memo(function ActivityRow({ ... }) { ... });
const MeetingRow  = memo(function MeetingRow({ ... }) { ... });

// 2) funkcje przelaczajace w useCallback (zamiast zwyklych funkcji z linii 382 i 464):
const toggleActivity = useCallback(async (activityId: string, customMeal?: CustomMealPayload) => {
  ... // cialo bez zmian
}, [postInvalidate, postGoalsInvalidate]);   // NIE dawac tu togglingIds — uzyc formy funkcyjnej setTogglingIds

// 3) w miejscu uzycia (linia 1438) przekazywac same identyfikatory, nie domkniecia:
<ActivityRow
  key={act.id}
  activity={act}
  toggling={togglingIds.has(act.id)}
  isExpanded={expandedId === act.id}
  onToggle={toggleActivity}       // (id) => ... , wiersz sam wola onToggle(activity.id)
  onExpand={setExpandedId}
  ...
/>

// 4) przeliczenia w useMemo (zamiast linii 826-856):
const grouped = useMemo(() => {
  const g: Record<string, ActivityData[]> = { morning: [], afternoon: [], evening: [] };
  for (const act of data?.activities ?? []) {
    g[act.scheduledAt ? timeBlock(act.scheduledAt) : "morning"].push(act);
  }
  return g;
}, [data?.activities]);
```

Uwaga na pulapke: `togglingIds.has(act.id)` przekazywane jako `boolean` jest OK, ale `togglingIds` jako caly `Set` juz nie — `Set` to nowy obiekt przy kazdej zmianie i zabije `memo` we wszystkich wierszach naraz (dokladnie ten blad jest dzis w `goals/page.tsx:1067` i `:1205`).

### G7. Data na pulpicie bez biblioteki
Zamiast `dashboard/page.tsx:13-14` + `:823`:

```tsx
// usunac oba importy date-fns
const dateStr = new Date().toLocaleDateString("pl-PL", {
  weekday: "long",
  day: "numeric",
  month: "long",
}); // -> "sobota, 25 lipca"
```

Wynik jest identyczny wizualnie, kosztuje 0 KB. Dokladnie ten wzorzec dziala juz w `diet/page.tsx:154`.

### G8. Animacje na GPU — konkretne zamiany

Pasek postepu (`dashboard/page.tsx:889-898`, to samo `habits/page.tsx:301`):

```tsx
<div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
  <div style={{
    width: "100%", height: "100%", borderRadius: 3, background: "var(--success)",
    transform: `scaleX(${completionPct / 100})`,
    transformOrigin: "left center",
    transition: "transform 400ms cubic-bezier(0.25, 1, 0.5, 1)",
    willChange: "transform",
  }} />
</div>
```

Rozwijanie szczegolow (`dashboard/page.tsx:1829-1832`) — zamiast `max-height`:

```css
@keyframes expandIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

Kropki karuzeli (`dashboard/page.tsx:1576-1585`) — staly rozmiar 16x6, w srodku pasek skalowany:

```tsx
<div style={{ width: 16, height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
  <div style={{
    width: "100%", height: "100%", background: "var(--primary)",
    transform: i === activePanel ? "scaleX(1)" : "scaleX(0.375)",
    transformOrigin: "center",
    opacity: i === activePanel ? 1 : 0,
    transition: "transform 250ms cubic-bezier(0.25,1,0.5,1), opacity 200ms linear",
  }} />
</div>
```

Checkboxy (`dashboard/page.tsx:1317, 1902, 2103`) — zamiast `border: none` przy zaznaczeniu, zawsze `border: 2px solid` ze zmiana koloru:

```tsx
border: `2px solid ${completed ? "var(--success)" : "var(--border)"}`,
background: completed ? "var(--success)" : "transparent",
transition: "background-color 180ms ease, border-color 180ms ease, transform 200ms cubic-bezier(0.34,1.56,0.64,1)",
```

Dzieki temu ptaszek nie przesuwa sasiadow o 2 px przy kazdym kliknieciu.

### G9. Karuzela idaca za palcem (`dashboard/page.tsx:791-820, 968-975`)

```tsx
const [dragX, setDragX] = useState(0);
const [dragging, setDragging] = useState(false);

const onTouchMove = useCallback((e: React.TouchEvent) => {
  const dx = e.touches[0].clientX - touchStartRef.current.x;
  const dy = e.touches[0].clientY - touchStartRef.current.y;
  if (isHorizontalSwipe.current === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
    isHorizontalSwipe.current = Math.abs(dx) > Math.abs(dy);
    if (isHorizontalSwipe.current) setDragging(true);
  }
  if (isHorizontalSwipe.current) {
    touchDeltaRef.current = dx;
    // opor na krawedziach, jak w iOS
    const atEdge = (dx > 0 && activePanel === 0) || (dx < 0 && activePanel === 2);
    setDragX(atEdge ? dx * 0.35 : dx);
  }
}, [activePanel]);

// w onTouchEnd: setDragging(false); setDragX(0);

// styl kontenera:
style={{
  display: "flex",
  transform: `translate3d(calc(-${activePanel * 100}% + ${dragX}px), 0, 0)`,
  transition: dragging ? "none" : "transform 340ms cubic-bezier(0.25, 1, 0.5, 1)",
  willChange: "transform",
}}
```

Prog przejscia warto oprzec o predkosc, nie tylko o 50 px: jesli `Math.abs(dx) > 50 || Math.abs(dx / czasTrwania) > 0.5 px/ms` — przejdz do nastepnego panelu.

### G10. Szkielet diety zamiast kolowrotka (`diet/page.tsx:1842-1864`)

Zamiast `if (loading) return <spinner>` — zawsze renderowac naglowek i zakladki, a w miejsce tresci wstawic szare bloki o **dokladnie tych samych wymiarach** co docelowa zawartosc (kolo 200x200 px, 5 wierszy rozbicia po 40 px, 3 paski makro). Wtedy przy pojawieniu sie danych nic nie skacze.

### G11. `next.config.ts`

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["date-fns", "recharts"],
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
};

export default nextConfig;
```

(React Compiler — czyli automatyczna memoizacja calej aplikacji — bylby najwiekszym pojedynczym zyskiem przy K7/K8, ale w Next 16 wymaga doinstalowania `babel-plugin-react-compiler` i osobnego testu. Traktowac jako oddzielne zadanie, nie doklejac do tego pakietu zmian.)

---

## Ryzyka

**Service worker (G5) — najwieksze ryzyko w calym pakiecie.** Zle napisany SW potrafi "zamrozic" starą wersję aplikacji na telefonie i uzytkownik nie zobaczy zadnej aktualizacji. Zasady: nigdy nie cache'owac `/api/auth/*` ani odpowiedzi POST, zawsze podnosic numer wersji cache przy kazdej zmianie pliku, przetestowac na telefonie w trybie samolotowym i po ponownym wlaczeniu sieci. Przed wdrozeniem komercyjnym dodac przycisk "Odswiez aplikacje", ktory robi `registration.update()` + `skipWaiting`.

**Cache danych (`stale-while-revalidate`)** oznacza, ze uzytkownik przez ulamek sekundy widzi stare liczby (np. wczorajsze kalorie), zanim wskocza nowe. Przy aplikacji zdrowotnej to trzeba przetestowac na realnym scenariuszu "zjadlem, zapisalem, wrocilem" — inaczej wyglada jak zgubiony wpis.

**`React.memo` z obiektami w propsach nie dziala i daje falszywe poczucie poprawy.** Dzis do kart trafiaja `Set` i obiekty (`togglingMilestones` w `goals/page.tsx:1067`, `scheduleForm` w `:1209`, `editDraft` w `:1083`). Jesli opakujemy `GoalCard` w `memo`, ale zostawimy te propsy, nic sie nie zmieni. Kolejnosc jest wazna: najpierw rozbic stan (P1.7), potem `memo` (P1.8). Odwrotnie to strata czasu.

**Wyciecie kalendarza z `/api/dashboard` (P0.3) zmienia ksztalt odpowiedzi API.** Pola `meetings` i `calendarError` sa czytane w `dashboard/page.tsx:839-848, 907-928` i grupowane razem z aktywnosciami. Trzeba przejsc cala sciezke: endpoint → typ `DashboardData` → grupowanie w porach dnia → `MeetingRow` → `toggleMeeting`. Latwo przeoczyc baner bledu polaczenia z Google.

**`AbortController` (G4) trzeba dodac razem z obsluga bledu.** Anulowane zapytanie rzuca `AbortError`; jesli trafi do `catch`, ktory ustawia toast bledu, uzytkownik zobaczy "Blad" przy kazdym przelaczeniu karty. Wzorzec poprawnej obslugi jest juz w pliku (`dashboard/page.tsx:604`).

**Usuniecie recharts to przepisanie 3 wykresow.** To nie jest zamiana importu — `EnergyChart`, `SleepChart` i `CompletionChart` maja osie, siatke i podpowiedzi, ktore trzeba odtworzyc. Bezpieczna kolejnosc: najpierw `next/dynamic` (zysk 107 KB natychmiast, zero ryzyka), przepisanie dopiero potem, jesli w ogole.

**Haptyka nie dziala na iPhonie.** `navigator.vibrate` jest ignorowane w Safari na iOS. Jesli wlasciciel testuje na Androidzie, a klient na iPhonie — klient zobaczy tylko animacje z G2. Dlatego animacja wcisniecia jest obowiazkowa, a wibracja to dodatek.

**Wibracja przy kazdym dotknieciu potrafi irytowac.** Wzorzec `tap` ma 8 ms (ledwo wyczuwalne). Nie stosowac wibracji przy przewijaniu, przy zwyklym rozwijaniu szczegolow ani seriami. Warto przewidziec wylacznik w ustawieniach.

**Zmiana `height: auto/0` na warunkowe montowanie paneli (P1.12)** przelaczy `WeightTracker` na ladowanie dopiero po wejsciu na panel — czyli pierwsze przesuniecie na "Statystyki" pokaze pusty wykres wagi na ~300 ms. Trzeba tam dolozyc szkielet, inaczej zamienimy jeden problem na drugi.

**Czego nie zmierzylem (NIEZWERYFIKOWANE):** nie uruchomilem aplikacji na zywo w przegladarce, wiec nie mam realnych liczb FPS, czasu do pierwszego wyswietlenia (LCP), ani nagranego profilu React Profiler. Wszystkie znaleziska o przerenderowaniach wynikaja z lektury kodu, a nie z pomiaru w dzialajacej aplikacji. Liczby o rozmiarze paczek sa zmierzone realnie (`npx next build`, 25.07.2026, ten folder). Zanim uznamy poprawki za skuteczne, trzeba zrobic pomiar przed/po: Lighthouse na telefonie z dlawieniem sieci "Slow 4G" oraz nagranie React Profiler przy wpisywaniu tekstu w polu "Wygeneruj z wkladem".

---

Sciezka dokumentu: `C:\Users\Paweł Pieloch\CLAUDE CODE\Aplikacja Papi 2.0\papicoach\docs\audit\04-wydajnosc.md`
