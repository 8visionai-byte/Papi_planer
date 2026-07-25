# Audyt 05: Native feel (wrażenie aplikacji natywnej)

Projekt: PAPI PLANER (Next.js 16.2.6, React 19.2.4, App Router, PWA)
Data: 2026-07-25
Zakres: haptics, dźwięki, safe area, scroll, przejścia między ekranami, offline, pierwsze uruchomienie
Tryb: READ-ONLY. Nie zmieniono żadnego pliku aplikacji. Zapisano wyłącznie ten dokument.

---

## Streszczenie

Aplikacja jest technicznie PWA (manifest, service worker, instaluje się na Androidzie), ale w warstwie odczuć jest nadal stroną WWW: nic nie wibruje, ekrany zmieniają się bez animacji, a bez internetu użytkownik dostaje komunikat błędu przeglądarki zamiast ekranu aplikacji. Największy pojedynczy błąd: w kodzie jest sześć miejsc, które próbują uwzględniać notch i pasek gestów telefonu, ale wszystkie one zwracają zero, bo w ustawieniach widoku brakuje jednej linijki (`viewportFit: "cover"`) w pliku `src/app/layout.tsx`. Drugi w kolejności: service worker w `public/sw.js` ma trzy linijki i tylko przepuszcza ruch do sieci, więc nie daje żadnego offline, a mimo to jest rejestrowany dwa razy. Trzeci: gdy na Androidzie wyskakuje klawiatura, pole do pisania w czacie z mentorem chowa się pod nią, bo brakuje ustawienia `interactiveWidget: "resizes-content"`. Dobra wiadomość jest taka, że to nie jest przepisywanie aplikacji: cała lista P0 z tego dokumentu to jeden nowy plik z wibracjami, jeden przepisany service worker, jeden nowy ekran offline i około dziesięciu punktowych poprawek w istniejących plikach, wszystko z gotowym kodem w sekcji "Gotowe do wdrożenia".

---

## Znaleziska krytyczne

### K1 (KRYTYCZNE). Cała obsługa notcha i paska gestów jest martwa

W kodzie jest 6 miejsc z `env(safe-area-inset-*)`:

| Plik | Linia | Co robi |
|---|---|---|
| `src/app/(app)/layout.tsx` | 60 | `paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px))"` |
| `src/components/shell/BottomTabBar.tsx` | 101 | `paddingBottom: "env(safe-area-inset-bottom, 0px)"` |
| `src/components/mentors/MentorChat.tsx` | 256 | `paddingTop: "calc(12px + env(safe-area-inset-top, 0px))"` |
| `src/components/mentors/MentorChat.tsx` | 618 | `paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))"` |
| `src/components/followup/FollowUpSheet.tsx` | 59 | `paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))"` |
| `src/components/pwa/InstallPrompt.tsx` | 56 | `bottom: "calc(80px + env(safe-area-inset-bottom, 0px) + 8px)"` |

Wszystkie zwracają **0 px**, bo przeglądarka udostępnia zmienne `env(safe-area-inset-*)` dopiero, gdy widok jest zadeklarowany jako `viewport-fit=cover`. W `src/app/layout.tsx:17-23` eksport `viewport` zawiera tylko `width`, `initialScale`, `maximumScale`, `userScalable`, `themeColor`. Sprawdzone: `grep -rn "viewport-fit|viewportFit"` po całym repo (bez `node_modules`) nie zwraca **żadnego** trafienia.

Skutki dziś: na telefonach z paskiem gestów (większość Androidów od 2019 i wszystkie iPhone od X) dolny pasek zakładek kończy się dokładnie na krawędzi ekranu, a systemowy pasek gestów leży na przyciskach zakładek. Użytkownik celuje w "Dieta", a wychodzi z aplikacji.

Dodatkowo `src/app/layout.tsx:14` ustawia `statusBarStyle: "black-translucent"` (iOS), co oznacza "treść wchodzi pod pasek statusu". W `src/app/(app)/layout.tsx:58-62` element `main` **nie ma żadnego `paddingTop`**. Po włączeniu `viewport-fit: cover` nagłówki stron wejdą pod zegar i baterię, jeśli nie doda się jednocześnie górnego marginesu bezpieczeństwa (patrz kod w sekcji "Gotowe do wdrożenia").

### K2 (KRYTYCZNE). Service worker to atrapa. Zero offline, a rejestrowany dwa razy

`public/sw.js` w całości ma 13 linii i wygląda tak:

```js
self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request));   // public/sw.js:10-12
});
```

To jest przepuszczalnik. Nic nie cachuje, nie ma ekranu offline, nie ma precache powłoki. Bez internetu każde otwarcie aplikacji z ikony kończy się standardowym komunikatem przeglądarki "Brak połączenia z internetem" (dinozaur), mimo że aplikacja jest zainstalowana i wygląda jak natywna. To najmocniejszy sygnał "to jest strona, nie aplikacja", jaki użytkownik może dostać.

Do tego service worker jest rejestrowany **dwa razy, z dwóch różnych komponentów**:
- `src/components/pwa/ServiceWorkerRegister.tsx:16` (wołany w `src/app/layout.tsx:38`, działa w każdym środowisku)
- `src/components/pwa/ServiceWorkerRegistrar.tsx:8` (wołany w `src/app/(app)/layout.tsx:68`, tylko `NODE_ENV === "production"`)

Dwie rejestracje tego samego `/sw.js` nie tworzą dwóch workerów, ale to martwy kod, który przy każdej przyszłej zmianie strategii cache będzie mylił. Jeden z nich do usunięcia.

Osobno: `package.json:27` deklaruje zależność `"next-pwa": "^5.6.0"`, a `next.config.ts` (7 linii, pusty obiekt konfiguracji) nigdzie jej nie używa. `next-pwa` 5.x nie jest zgodny z Next 16. To martwa zależność do usunięcia.

### K3 (KRYTYCZNE). Klawiatura Androida zasłania pole pisania

`src/components/mentors/MentorChat.tsx:238-248` to pełnoekranowy panel `position: "fixed", inset: 0` z układem kolumnowym, gdzie pole tekstowe siedzi na dole (`:613-624`). Ustawienia widoku w `src/app/layout.tsx:17-23` nie zawierają `interactiveWidget`. Domyślna wartość w Chrome na Androida to `resizes-visual`, czyli: klawiatura wjeżdża, ale wysokość układu strony się **nie zmienia**. Element przyklejony do dołu `inset: 0` zostaje pod klawiaturą.

To samo dotyczy: `src/components/followup/FollowUpSheet.tsx:30-40` (arkusz z polem i `autoFocus` w `:121`), `src/components/shell/UniversalInputBar.tsx` i formularzy w modalach.

Weryfikacja typów: `node_modules/next/dist/lib/metadata/types/extra-types.d.ts:52-53` potwierdza, że ta wersja Next przyjmuje zarówno `viewportFit?: 'auto' | 'cover' | 'contain'`, jak i `interactiveWidget?: 'resizes-visual' | 'resizes-content' | 'overlays-content'`. Poprawka to dwie linijki.

### K4 (KRYTYCZNE). Zero haptics w całej aplikacji

`grep -rn "vibrate|haptic"` po `src/`: **brak trafień**. Ani jednej wibracji. Tymczasem aplikacja jest zbudowana wokół odhaczania rzeczy (nawyki, aktywności, posiłki), czyli dokładnie wokół czynności, która w natywnych aplikacjach zawsze daje krótkie "puknięcie" w palec. To jest najtańszy w kodzie i najmocniej odczuwalny element "premium".

Miejsca, które proszą się o wibrację, i których dziś nie mają (dokładne linie w sekcji "Gotowe do wdrożenia", tabela wpięć):
- odhaczenie nawyku: `src/app/(app)/habits/page.tsx:136` (`toggleHabit`), sam checkbox `:705-708`
- odhaczenie aktywności: `src/app/(app)/dashboard/page.tsx:382` (`toggleActivity`), checkbox `:2087-2091`
- przełączenie zakładki w dolnym pasku: `src/components/shell/BottomTabBar.tsx:168`
- przełączenie zakładki treści: `src/components/ui/BigTabs.tsx:31`
- swipe karuzeli na dashboardzie: `src/app/(app)/dashboard/page.tsx:810-820`
- wysłanie wiadomości do mentora: `src/components/mentors/MentorChat.tsx:158` i `:639`
- sukces generowania planu: `src/app/(app)/dashboard/page.tsx:679`, `:716-720`
- błąd generowania: `src/app/(app)/dashboard/page.tsx:682`, `:724`
- start i stop nagrywania głosu: `src/components/shell/UniversalInputBar.tsx:100-106`
- wciśnięcie kafla mentora: `src/components/mentors/MentorCard.tsx:38` i `src/app/(app)/mentors/page.tsx:461` (już mają animację `scale(0.97)`, brakuje tylko dotyku)
- long-press: **nie istnieje nigdzie w aplikacji**, `grep` po `onContextMenu|longPress` daje zero trafień

### K5 (KRYTYCZNE). Nawigacja jest natychmiastowa i "webowa", bez prefetchu i bez przejść

`src/components/shell/BottomTabBar.tsx:168` przełącza ekrany przez `router.push(tab.path)` na zwykłym `<button>`. To znaczy dwie rzeczy:

1. **Brak prefetchu.** `<Link>` w Next automatycznie pobiera trasę, gdy pojawi się w polu widzenia. `router.push` nie pobiera nic z wyprzedzeniem, więc dopiero po kliknięciu leci żądanie po dane trasy. W całej aplikacji `<Link>` występuje tylko 3 razy (`src/app/(app)/mentors/page.tsx:581`, `:1221`, `src/app/(app)/not-found.tsx:39`), a `router.push` w 5 miejscach. Efekt: kliknięcie zakładki daje zauważalną pauzę, po której ekran po prostu podmienia się w jednej klatce.
2. **Brak jakiejkolwiek animacji przejścia.** Nowy ekran pojawia się skokiem. W aplikacji natywnej wejście głębiej to przesuw w lewo, powrót to przesuw w prawo, a przełączanie zakładek to przenikanie. Tu nie ma nic.

Sytuację pogarsza to, że wszystkie strony są klientowe (`"use client"` w 10 na 10 sprawdzonych plikach stron) i pobierają dane w `useEffect`, więc po przejściu pokazuje się pusty ekran lub szkielet, a dopiero potem treść. Bez animacji wygląda to jak przeładowanie strony.

`next.config.ts` nie ma włączonego `experimental.viewTransition`. Dokumentacja dostarczona z tą wersją Next (`node_modules/next/dist/docs/01-app/02-guides/view-transitions.md` oraz `.../05-config/01-next-config-js/viewTransition.md`) opisuje gotowy mechanizm, w tym `router.push(href, { transitionTypes: [...] })` (potwierdzone w `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md:44`). Czyli nie trzeba pisać własnego systemu animacji.

### K6 (KRYTYCZNE). Modale nie blokują przewijania tła, a strona ma pull-to-refresh

`grep -rn "overscroll|overscrollBehavior"` po `src/`: **brak trafień**. Nigdzie w aplikacji nie ma `overscroll-behavior`.

Konsekwencje:
1. **Pull-to-refresh jest aktywne.** W zainstalowanej PWA pociągnięcie palcem w dół na górze ekranu przeładowuje aplikację. Wszystkie stany lokalne (otwarty panel, wpisany tekst, aktywna karuzela) znikają. Żadna natywna aplikacja tak się nie zachowuje, chyba że sama tego chce.
2. **Przewijanie "przecieka" z modali na stronę pod spodem.** Blokada przewijania tła jest zaimplementowana **tylko w jednym miejscu w całej aplikacji**: `src/app/(app)/mentors/page.tsx:162-170`. Pozostałe 11 nakładek `position: "fixed"` jej nie ma, w tym: `src/app/(app)/dashboard/page.tsx:1625` (historia briefingów, ze scrollowaną listą w `:1691`) i `:1804`, `src/app/(app)/goals/page.tsx:1307`, `:1378`, `src/app/(app)/habits/page.tsx:643`, `src/app/(app)/diet/page.tsx:2387`, `src/app/(app)/journal/page.tsx:591`, `src/app/(app)/roundtable/page.tsx:595`, `src/app/(app)/admin/page.tsx:334`, `src/app/(app)/discipline/[slug]/page.tsx:920`, `src/components/files/FileList.tsx:124`, `src/components/weight/WeightTracker.tsx:321`.
3. **Momentum scroll (płynne "dojeżdżanie" po puszczeniu palca) ustawiono tylko dwa razy**: `src/components/shell/BottomTabBar.tsx:118` i `src/app/(app)/tracking/page.tsx:236`. Na Androidzie to i tak działa domyślnie, ale 6 wewnętrznych kontenerów `overflowY: "auto"` (`dashboard:1691`, `discipline:939`, `journal:568`, `roundtable:470`, `roundtable:850`, `MentorChat:363`, `MentorChat:444`) nie ma ani `overscroll-behavior: contain`, ani ukrytego paska przewijania, więc dojechanie do końca listy w modalu przewija ekran pod spodem.

### K7 (WAŻNE). Siedem elementów przyklejonych na sztywno do `bottom: 80/90` rozjedzie się po naprawie K1

| Plik | Linia | Wartość |
|---|---|---|
| `src/app/(app)/dashboard/page.tsx` | 1805 | `bottom: 80` |
| `src/app/(app)/diet/page.tsx` | 2388 | `bottom: 90` |
| `src/app/(app)/goals/page.tsx` | 1380 | `bottom: 80` |
| `src/app/(app)/habits/page.tsx` | 645 | `bottom: 80` |
| `src/app/(app)/journal/page.tsx` | 593 | `bottom: 80` |
| `src/app/(app)/roundtable/page.tsx` | 596 | `bottom: 80` |
| `src/components/weight/WeightTracker.tsx` | 322 | `bottom: 80` |

Dziś pasek zakładek ma 64 px (`BottomTabBar.tsx:112`, `height: 64`) plus 0 px safe-area, więc `bottom: 80` daje 16 px zapasu. Po włączeniu `viewport-fit: cover` na telefonie z paskiem gestów pasek zakładek urośnie do 64 + około 34 px = 98 px, a te elementy zostaną **pod nim**. Toasty i przyciski akcji znikną. To trzeba poprawić w tej samej zmianie co K1, inaczej naprawa jednej rzeczy zepsuje siedem innych.

Osobno błąd wysokości: `src/app/(app)/roundtable/page.tsx:280` ustawia `height: "100dvh"` na treści strony, która i tak siedzi w `main` z `paddingBottom: calc(80px + safe-area)` (`layout.tsx:60`). Razem daje to dokument wyższy niż ekran o około 80 px, czyli stronę, która "dziwnie" się przewija, mimo że nie ma czego przewijać. Powinno być `height: calc(100dvh - 80px - env(safe-area-inset-bottom, 0px))` albo po prostu `minHeight` bez `100dvh`.

Podobnie `src/app/(app)/journal/page.tsx:567` używa `maxHeight: "calc(100vh - 280px)"`. Na telefonie `100vh` to wysokość ekranu **z ukrytym** paskiem adresu, czyli więcej niż widać. Powinno być `100dvh` (reszta aplikacji już używa `dvh`).

### K8 (WAŻNE). Błędy zapisu są ciche. Bez internetu użytkownik myśli, że zapisał

`src/app/(app)/habits/page.tsx:136-167`: odhaczenie nawyku najpierw zmienia stan na ekranie (`:141`), a przy błędzie sieci cofa go (`:150` i `:159`) **bez żadnego komunikatu**. Dokładnie ten sam wzorzec w `src/app/(app)/dashboard/page.tsx:382-462` (rollback w `:403` i `:446`, brak komunikatu).

Zachowanie z perspektywy użytkownika bez zasięgu: klika checkbox, checkbox się zaznacza, po chwili sam się odznacza. Wygląda jak zepsuta aplikacja. Funkcja `showToast` już istnieje (`habits/page.tsx:131-134`), więc to jedna linijka na ścieżkę błędu.

Nie ma też **żadnej** detekcji braku sieci: `grep -rn "navigator.onLine"` po `src/` zwraca zero trafień (jedyne trafienie na "offline" to `access_type: "offline"` w konfiguracji Google OAuth, `src/lib/auth/config.ts:19`).

### K9 (WAŻNE). Pierwsze uruchomienie: biały błysk, brak splash na iOS, brak onboardingu

- `public/manifest.json:8` ma `"background_color": "#ffffff"`, a `:9` `"theme_color": "#0f172a"` i tło aplikacji to `#f8fafc` (`src/app/globals.css:4`). Ekran startowy Androida będzie **biały**, pasek statusu ciemny, a po chwili tło jasnoszare. Trzy różne kolory w dwie sekundy.
- Brak jakichkolwiek `apple-touch-startup-image` w `src/app/layout.tsx:28-36`. Na iOS zainstalowana aplikacja pokazuje białą pustą stronę przez cały czas startu.
- `manifest.json` nie ma `id`, `display_override`, `shortcuts` ani `screenshots`. `shortcuts` to menu po przytrzymaniu ikony na Androidzie (bardzo "natywny" detal, koszt: 10 linii JSON). `screenshots` zmieniają okno instalacji na Androidzie z małego paska na pełną kartę produktu.
- `manifest.json:5` ustawia `start_url: "/dashboard"`, a `/dashboard` siedzi pod bramką klienta: `src/app/(app)/layout.tsx:21-43` renderuje sam kręcący się spinner, dopóki `useSession()` nie odpowie (`src/hooks/useAuth.ts:19`). Czyli sekwencja startu z ikony to: splash → biała strona → spinner → pusty ekran ze szkieletami → treść. Cztery różne widoki zanim użytkownik cokolwiek zobaczy.
- Brak onboardingu i brak stanu "pierwsze wejście". Puste stany istnieją, ale są bierne: `src/app/(app)/habits/page.tsx:436-446` mówi "Brak nawyków. Dodaj swój pierwszy nawyk i zacznij budować rytuały" i nie ma przycisku, który by to zrobił. `src/app/(app)/dashboard/page.tsx:1376` to samo: "Brak zaplanowanych aktywnosci na dzis" bez akcji.

### K10 (WAŻNE). Cele dotykowe checkboxów to 22 i 24 px, i nie są przyciskami

- `src/app/(app)/habits/page.tsx:705-722`: checkbox nawyku to `<div onClick>` o wymiarach 24 x 24 px.
- `src/app/(app)/dashboard/page.tsx:2087-2104`: checkbox aktywności to `<div onClick>` o wymiarach 22 x 22 px.

Apple HIG wymaga 44 x 44 px, Material Design 48 dp. To jest 2 razy za mało na najczęściej klikany element w całej aplikacji. Dodatkowo `<div>` zamiast `<button>` oznacza brak obsługi klawiatury i brak roli dla czytnika ekranu. Przyciski wysyłania w `src/components/shell/UniversalInputBar.tsx:222` i `:258` mają 36 x 36 px (też za mało), a przycisk wysyłania w czacie z mentorem `src/components/mentors/MentorChat.tsx:641-643` ma poprawne 44 x 44 px, czyli wzorzec w projekcie już istnieje.

Uwaga: to znalezisko pokrywa się z audytem designu i dostępności. Tu wymieniam je dlatego, że trafienie w 22 px kciukiem w ruchu to najczęstsza przyczyna odczucia "aplikacja mnie nie słucha", którego żadna wibracja nie naprawi.

---

## Rekomendacje

### P0 (blokujące "premium", robić w tej kolejności, jako jedna zmiana)

1. **Włączyć `viewportFit: "cover"` i `interactiveWidget: "resizes-content"`** w `src/app/layout.tsx`, **jednocześnie** z poprawką powłoki (`main` dostaje górny safe-area) i **jednocześnie** z zamianą 7 sztywnych `bottom: 80/90` na token CSS. Osobno nie wolno, bo pierwsza zmiana psuje siedem innych miejsc (K1 + K7).
2. **Przepisać `public/sw.js`** na strategię trójdzielną (statyki z cache, nawigacje z siecią i ekranem offline, dane GET z siecią i kopią awaryjną), dodać stronę `/offline`, usunąć jeden z dwóch rejestratorów, wyrzucić `next-pwa` z `package.json` (K2).
3. **Dodać moduł haptics** (`src/lib/haptics.ts`) i wpiąć go w 11 miejsc z tabeli wpięć. To jeden nowy plik i jedna linijka na miejsce wpięcia (K4).
4. **Zablokować pull-to-refresh i przeciekanie scrolla**: `overscroll-behavior-y: none` na `body`, klasa `.papi-scroll` z `overscroll-behavior: contain` dla 7 wewnętrznych kontenerów, hook `useScrollLock` dla 11 modali (K6).
5. **Włączyć przejścia między ekranami** przez `experimental.viewTransition` plus prefetch zakładek w `BottomTabBar`. Bez prefetchu animacja tylko uwydatni czekanie (K5).

### P1 (ważne)

6. **Pokazywać błędy zapisu.** Każde miejsce z cichym rollbackiem dostaje toast i wibrację błędu (K8).
7. **Baner braku sieci** w powłoce aplikacji, oparty o `navigator.onLine` plus zdarzenia `online`/`offline`, z informacją "Dane z HH:MM, brak połączenia" gdy service worker odda kopię awaryjną (K8, K2).
8. **Manifest i splash**: `background_color` na `#0f172a`, dodać `id`, `display_override`, `shortcuts` (Nawyki, Dziennik, Debata), `screenshots`, wygenerować splashe iOS (K9).
9. **Powiększyć cele dotykowe** checkboxów do minimum 44 px (można zostawić kwadrat 24 px wizualnie i dodać niewidoczne pole dotyku, kod niżej) i zamienić `div` na `button` (K10).
10. **Naprawić wysokości**: `roundtable/page.tsx:280` i `journal/page.tsx:567` (K7).

### P2 (dopieszczenie)

11. Long-press na wierszu nawyku i aktywności otwierający edycję, z wibracją po 500 ms (dziś edycja jest pod zwykłym kliknięciem w tekst, `habits/page.tsx:739`).
12. Karuzela na dashboardzie ma podążać za palcem w trakcie przeciągania, nie tylko przeskakiwać po puszczeniu (`dashboard/page.tsx:797-808` liczy przesunięcie, ale nigdzie go nie używa wizualnie).
13. Ekran pierwszego uruchomienia: karta "Zacznij tutaj" z 3 krokami (dodaj nawyk, wygeneruj plan dnia, poznaj mentorów), znikająca po wykonaniu.
14. Dźwięki: jeden opcjonalny, domyślnie **wyłączony**. Argumentacja w sekcji niżej.
15. `prefers-reduced-motion`: dziś zero obsługi, a aplikacja ma 8 animacji. Jedna reguła CSS.

---

## Gotowe do wdrożenia

### 1. Moduł haptics (nowy plik)

Plik: `src/lib/haptics.ts`

```ts
"use client";

/**
 * Haptics dla PAPI PLANER.
 * Android/Chrome: Vibration API (navigator.vibrate).
 * iOS Safari: nie wspiera Vibration API - wszystkie wywolania sa ciche (no-op).
 * Nigdy nie rzuca wyjatkiem, bezpieczne przy renderowaniu na serwerze.
 */

const PATTERNS = {
  /** lekkie puknięcie: nacisniecie kafla, przewiniecie karuzeli */
  tap: 8,
  /** wybor: zmiana zakladki, zmiana panelu */
  select: 12,
  /** wcisniecie przycisku z animacja scale */
  press: 14,
  /** odhaczenie (zaznaczam) */
  toggleOn: 18,
  /** odznaczenie (cofam) - celowo slabsze, zeby czuc roznice */
  toggleOff: 8,
  /** przytrzymanie zadzialalo */
  longPress: 26,
  /** wyslanie wiadomosci */
  send: 12,
  /** operacja sie udala (plan wygenerowany, zapisano) */
  success: [14, 40, 22],
  /** duzy sukces (caly dzien odhaczony, seria 7 dni) */
  celebrate: [12, 28, 12, 28, 44],
  /** ostrzezenie */
  warning: [18, 55, 18],
  /** blad */
  error: [34, 55, 34],
} as const;

export type HapticKind = keyof typeof PATTERNS;

const SETTING_KEY = "papi.haptics";
const MIN_GAP_MS = 40; // anty-seria: nie buczymy przy szybkim klikaniu listy

let lastAt = 0;
let cachedEnabled: boolean | null = null;

function supported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  );
}

export function hapticsSupported(): boolean {
  return supported();
}

export function isHapticsEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  if (typeof window === "undefined") return false;
  try {
    cachedEnabled = window.localStorage.getItem(SETTING_KEY) !== "0";
  } catch {
    cachedEnabled = true;
  }
  return cachedEnabled;
}

export function setHapticsEnabled(on: boolean): void {
  cachedEnabled = on;
  try {
    window.localStorage.setItem(SETTING_KEY, on ? "1" : "0");
  } catch {
    /* tryb prywatny - trudno */
  }
  if (on) haptic("success"); // od razu pokazujemy uzytkownikowi, ze dziala
}

/** Jedyna funkcja, ktorej uzywamy w komponentach. */
export function haptic(kind: HapticKind = "tap"): boolean {
  if (!supported()) return false;
  if (!isHapticsEnabled()) return false;
  if (typeof document !== "undefined" && document.hidden) return false;

  const now = Date.now();
  if (now - lastAt < MIN_GAP_MS) return false;
  lastAt = now;

  try {
    return navigator.vibrate(PATTERNS[kind] as number | number[]);
  } catch {
    return false;
  }
}

/** Przerwij trwajaca wibracje (np. przy zamknieciu ekranu). */
export function stopHaptic(): void {
  if (!supported()) return;
  try {
    navigator.vibrate(0);
  } catch {
    /* ignorujemy */
  }
}

/** Gotowe propsy do wpiecia w dowolny klikalny element. */
export const pressProps = {
  onPointerDown: () => {
    haptic("press");
  },
};
```

Plik: `src/hooks/useLongPress.ts` (nowy, dla P2 punkt 11)

```ts
"use client";

import { useCallback, useRef } from "react";
import { haptic } from "@/lib/haptics";

export function useLongPress(onLongPress: () => void, ms = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const start = useCallback(() => {
    fired.current = false;
    clear();
    timer.current = setTimeout(() => {
      fired.current = true;
      haptic("longPress");
      onLongPress();
    }, ms);
  }, [clear, ms, onLongPress]);

  return {
    /** rozlej na element: <div {...lp.handlers} style={{ touchAction: "manipulation" }} /> */
    handlers: {
      onPointerDown: start,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
    /** w onClick: if (lp.consumed()) return;  - zeby long-press nie odpalil zwyklego kliku */
    consumed: () => fired.current,
  };
}
```

### 2. Tabela wpięć haptics (dokładne miejsca)

| # | Plik | Linia | Zdarzenie | Wzorzec | Uwaga |
|---|---|---|---|---|---|
| 1 | `src/app/(app)/habits/page.tsx` | 141 (zaraz po optymistycznym `setTodayCompletions`) | odhaczenie nawyku | `haptic(prevCompleted ? "toggleOff" : "toggleOn")` | wibracja **przed** siecią, nie po |
| 2 | `src/app/(app)/habits/page.tsx` | 150 i 159 (rollback) | błąd zapisu nawyku | `haptic("error")` + `showToast("Brak polaczenia, nie zapisano")` | dziś cisza, patrz K8 |
| 3 | `src/app/(app)/dashboard/page.tsx` | 386 (przed `setData`) | odhaczenie aktywności | `haptic(wasCompleted ? "toggleOff" : "toggleOn")` | |
| 4 | `src/app/(app)/dashboard/page.tsx` | 403 i 446 (rollback) | błąd zapisu aktywności | `haptic("error")` + toast | |
| 5 | `src/app/(app)/dashboard/page.tsx` | 812 (w `setActivePanel` gdy panel faktycznie się zmienia) | swipe karuzeli | `haptic("select")` | tylko gdy indeks się zmienił, inaczej buczy przy odbiciu |
| 6 | `src/app/(app)/dashboard/page.tsx` | 679 i 720 | plan wygenerowany | `haptic("success")` | |
| 7 | `src/app/(app)/dashboard/page.tsx` | 682 i 724 | błąd generowania | `haptic("error")` | |
| 8 | `src/components/shell/BottomTabBar.tsx` | 168 | przełączenie zakładki | `haptic("select")` przed `router.push` | tylko gdy `!pathname.startsWith(tab.path)` |
| 9 | `src/components/ui/BigTabs.tsx` | 31 | przełączenie zakładki treści | `haptic("select")` | tylko gdy `tab.key !== active` |
| 10 | `src/components/mentors/MentorChat.tsx` | 171 (po optymistycznym `setMessages`) | wysłanie wiadomości | `haptic("send")` | |
| 11 | `src/components/mentors/MentorChat.tsx` | 209 (po dojściu odpowiedzi) | mentor odpowiedział | `haptic("tap")` | delikatnie, to nie sukces tylko sygnał |
| 12 | `src/components/mentors/MentorChat.tsx` | 214 (`catch`) | błąd wysyłania | `haptic("error")` | error już jest pokazywany w `:598` |
| 13 | `src/components/shell/UniversalInputBar.tsx` | 101 / 104 | start / stop nagrywania | `haptic("toggleOn")` / `haptic("toggleOff")` | |
| 14 | `src/components/mentors/MentorCard.tsx` | 38 (`onPointerDown`) | wciśnięcie kafla | dopisać `haptic("press")` obok `scale(0.97)` | animacja już jest |
| 15 | `src/app/(app)/mentors/page.tsx` | 461 (`onPointerDown`) | wciśnięcie kafla mentora | `haptic("press")` | |
| 16 | `src/components/followup/FollowUpSheet.tsx` | 30 (montowanie) / 27 (`onSubmit`) | arkusz wjechał / wysłano | `haptic("warning")` przy pojawieniu, `haptic("send")` przy wysyłce | pojawienie się arkusza to przerwanie użytkownika, dlatego mocniejszy wzorzec |
| 17 | `src/app/(app)/habits/page.tsx` | 739 (wiersz nawyku) | long-press | `useLongPress` z `haptic("longPress")` | nowa funkcja, P2 |

Zasada nadrzędna: **wibrujemy w momencie dotknięcia, nie po odpowiedzi serwera.** Wibracja ma potwierdzić, że urządzenie przyjęło dotyk. Sukces i błąd to osobne, późniejsze sygnały.

Ograniczenia, których nie da się obejść (podaję uczciwie):
- Chrome na Androidzie wymaga, żeby użytkownik wcześniej dotknął strony, zanim `navigator.vibrate` zadziała. W praktyce nie jest to problem, bo pierwsza wibracja i tak następuje po dotknięciu.
- iOS Safari **nie ma** Vibration API. W zainstalowanej PWA na iPhone haptics nie zadziała. Krąży hack z ukrytym `<input type="checkbox" switch>` (iOS 17.4+), który przy programowym kliknięciu wywołuje systemowy haptik przełącznika. **HIPOTEZA, niesprawdzona na żadnym urządzeniu w tym projekcie.** Nie wpinałbym tego do czasu, aż będzie realny użytkownik iPhone.
- Wibracja jest wyciszona, gdy telefon jest w trybie "Nie przeszkadzać" z wyłączonymi wibracjami. To zachowanie systemu, nie do nadpisania i tak ma być.

### 3. Ustawienia widoku i powłoka (K1, K3, K7)

Plik: `src/app/layout.tsx`, zamiana bloku `viewport` z linii 17-23:

```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",              // <- odblokowuje env(safe-area-inset-*)
  interactiveWidget: "resizes-content", // <- klawiatura skraca uklad, pola nie chowaja sie pod nia
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};
```

Plik: `src/app/globals.css`, dopisać do `:root` (po linii 13):

```css
  /* wysokosc dolnego paska + margines bezpieczenstwa systemu */
  --tabbar-h: 64px;
  --safe-b: env(safe-area-inset-bottom, 0px);
  --safe-t: env(safe-area-inset-top, 0px);
  /* jedyna wartosc, ktorej maja uzywac wszystkie elementy przyklejone nad paskiem */
  --above-tabbar: calc(var(--tabbar-h) + var(--safe-b) + 12px);
```

Plik: `src/app/(app)/layout.tsx`, zamiana `main` z linii 58-64:

```tsx
      <main
        style={{
          paddingTop: "var(--safe-t)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
          paddingBottom: "calc(var(--tabbar-h) + var(--safe-b) + 16px)",
        }}
      >
        {children}
      </main>
```

Zamiana w 7 plikach z tabeli K7: `bottom: 80` oraz `bottom: 90` na `bottom: "var(--above-tabbar)"`.

Poprawka `src/app/(app)/roundtable/page.tsx:280`:

```tsx
        height: "calc(100dvh - var(--tabbar-h) - var(--safe-b))",
```

Poprawka `src/app/(app)/journal/page.tsx:567`: `maxHeight: "calc(100vh - 280px)"` na `maxHeight: "calc(100dvh - 280px)"`.

### 4. Scroll (K6)

Plik: `src/app/globals.css`, dopisać na końcu:

```css
html {
  -webkit-text-size-adjust: 100%;
}

body {
  /* wylacza pull-to-refresh i "gumke" calej strony w zainstalowanej PWA */
  overscroll-behavior-y: none;
  overflow-x: hidden;
}

/* klasa dla KAZDEGO wewnetrznego kontenera z overflowY: auto */
.papi-scroll {
  overflow-y: auto;
  overscroll-behavior: contain;   /* scroll nie przecieka na strone pod spodem */
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.papi-scroll::-webkit-scrollbar {
  display: none;
}

/* klikalne elementy: bez opoznienia 300ms, bez zaznaczania tekstu, bez menu iOS */
button,
[role="button"],
.papi-tap {
  touch-action: manipulation;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Do dopisania `className="papi-scroll"` w 7 miejscach: `dashboard:1691`, `discipline/[slug]:939`, `journal:568`, `roundtable:470`, `roundtable:850`, `MentorChat:363`, `MentorChat:444`.

Plik: `src/hooks/useScrollLock.ts` (nowy, do wpięcia w 11 modali z K6)

```ts
"use client";

import { useEffect } from "react";

/**
 * Blokuje przewijanie strony pod modalem BEZ przeskoku na gore.
 * Wzorzec "position: fixed + zapamietany scrollY" - jedyny, ktory dziala
 * poprawnie na iOS Safari; samo overflow: hidden tam nie wystarcza.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const y = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      overflow: body.style.overflow,
    };

    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.overflow = "hidden";

    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, y);
    };
  }, [active]);
}
```

Użycie w komponencie z modalem, jedna linijka: `useScrollLock(historyOpen)`.

Uwaga: `src/app/(app)/mentors/page.tsx:162-170` ma dziś wersję z samym `overflow: hidden`. Do podmiany na ten hook, żeby nie było dwóch mechanizmów.

### 5. Service worker (K2)

Plik: `public/sw.js`, całość do podmiany:

```js
/* PAPI PLANER service worker - v2 */
const VERSION = 'v2';
const SHELL_CACHE = `papi-shell-${VERSION}`;
const STATIC_CACHE = `papi-static-${VERSION}`;
const DATA_CACHE = `papi-data-${VERSION}`;
const OFFLINE_URL = '/offline';

/* Tylko dane, ktore maja sens po odcieciu sieci. Nic z autoryzacja, nic z admina. */
const DATA_ALLOW = [
  '/api/dashboard',
  '/api/habits',
  '/api/mentors',
  '/api/goals',
  '/api/meals',
  '/api/mentor-plans',
];

const PRECACHE = [
  OFFLINE_URL,
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* Pozwala aplikacji wyczyscic dane po wylogowaniu:
   navigator.serviceWorker.controller?.postMessage({ type: 'PAPI_CLEAR_DATA' }) */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PAPI_CLEAR_DATA') {
    event.waitUntil(caches.delete(DATA_CACHE));
  }
});

function isStatic(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/')
  );
}

function isCacheableData(url) {
  return DATA_ALLOW.some((p) => url.pathname === p || url.pathname.startsWith(p + '/'));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  /* Nigdy nie dotykamy zapisow ani obcych domen. */
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  /* Sesja i logowanie zawsze prosto do sieci. */
  if (url.pathname.startsWith('/api/auth')) return;

  /* 1. Pliki z builda - maja hash w nazwie, wiec cache first, na zawsze. */
  if (isStatic(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  /* 2. Wejscie na ekran - siec, a jak jej nie ma to nasz ekran offline. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(OFFLINE_URL, { ignoreSearch: true })
      )
    );
    return;
  }

  /* 3. Dane - siec first, kopia awaryjna z ostatniego udanego pobrania. */
  if (url.pathname.startsWith('/api/')) {
    if (!isCacheableData(url)) return; // reszta API bez cache, prosto do sieci
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) {
            const headers = new Headers(cached.headers);
            headers.set('X-Papi-Stale', '1'); // aplikacja moze pokazac "dane offline"
            return new Response(cached.body, { status: 200, headers });
          }
          return new Response(
            JSON.stringify({ error: 'offline', offline: true }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  /* 4. Reszta (m.in. pobrania RSC z ?_rsc=) - domyslne zachowanie przegladarki. */
});
```

Plik: `src/app/offline/page.tsx` (nowy, celowo **poza** grupą `(app)`, żeby nie wymagał sesji)

```tsx
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "32px 24px",
        textAlign: "center",
      }}
    >
      <span style={{ fontSize: 48 }}>📡</span>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
        Jesteś offline
      </h1>
      <p style={{ fontSize: 15, color: "var(--muted)", margin: 0, maxWidth: 300, lineHeight: 1.5 }}>
        Papi potrzebuje internetu, żeby pobrać dzisiejszy plan. Wszystko, co
        odhaczysz teraz, zapisze się, gdy wróci połączenie.
      </p>
      <a
        href="/dashboard"
        style={{
          marginTop: 8,
          padding: "14px 28px",
          borderRadius: 9999,
          background: "var(--primary)",
          color: "#fff",
          textDecoration: "none",
          fontSize: 15,
          fontWeight: 600,
        }}
      >
        Spróbuj ponownie
      </a>
    </div>
  );
}
```

Do usunięcia: `src/components/pwa/ServiceWorkerRegistrar.tsx` wraz z jego użyciem w `src/app/(app)/layout.tsx:6` i `:68` (zostaje `ServiceWorkerRegister` z `src/app/layout.tsx:38`, bo działa też w trybie deweloperskim, co ułatwia testy). Do usunięcia z `package.json:27`: `"next-pwa": "^5.6.0"`.

Uwaga o prywatności: cache danych zostaje na urządzeniu po wylogowaniu. Dlatego w `sw.js` jest obsługa komunikatu `PAPI_CLEAR_DATA` i lista dozwolonych ścieżek (bez `/api/admin/*`). Trzeba wywołać ten komunikat przy wylogowaniu, inaczej dane jednego użytkownika zostaną w pamięci przeglądarki po zalogowaniu drugiego.

### 6. Baner braku sieci (K8)

Plik: `src/components/shell/OfflineBanner.tsx` (nowy, do wstawienia w `src/app/(app)/layout.tsx` obok `<InstallPrompt />`)

```tsx
"use client";

import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: "var(--safe-t)",
        left: 0,
        right: 0,
        zIndex: 900,
        margin: "8px auto",
        maxWidth: 398,
        padding: "10px 14px",
        borderRadius: 12,
        background: "var(--warning)",
        color: "#1a1200",
        fontSize: 14,
        fontWeight: 600,
        textAlign: "center",
        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
      }}
    >
      Brak połączenia. Zmiany nie zapisują się na serwerze.
    </div>
  );
}
```

### 7. Przejścia między ekranami (K5)

Krok 1, `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    viewTransition: true,
  },
};

export default nextConfig;
```

Krok 2, `src/app/(app)/layout.tsx`, opakowanie treści (import `ViewTransition` pochodzi z `react`, nie z Next):

```tsx
import { unstable_ViewTransition as ViewTransition } from "react";
// ...
      <main style={{ /* jak w punkcie 3 */ }}>
        <ViewTransition
          enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
          exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
          default="none"
        >
          {children}
        </ViewTransition>
      </main>
```

Nazwa importu do sprawdzenia przy wdrożeniu: dokumentacja dostarczona z tą wersją Next (`node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`) pokazuje `import { ViewTransition } from 'react'`, ale w niektórych wydaniach React 19 eksport nazywa się `unstable_ViewTransition`. To jedna linijka do zweryfikowania przy pierwszym buildzie.

Krok 3, `src/components/shell/BottomTabBar.tsx`, kierunek przejścia plus prefetch. Zamiana `onClick` z linii 168:

```tsx
              onClick={() => {
                if (pathname.startsWith(tab.path)) return;
                haptic("select");
                const from = visibleTabs.findIndex((t) => pathname.startsWith(t.path));
                const to = visibleTabs.findIndex((t) => t.path === tab.path);
                router.push(tab.path, {
                  transitionTypes: [to > from ? "nav-forward" : "nav-back"],
                });
              }}
```

oraz nowy efekt (kasuje pauzę po kliknięciu zakładki):

```tsx
  // Pobierz z gory wszystkie zakladki, zeby przejscie bylo natychmiastowe
  useEffect(() => {
    visibleTabs.forEach((t) => router.prefetch(t.path));
  }, [router, visibleTabs]);
```

Krok 4, `src/app/globals.css`, animacje:

```css
::view-transition-old(.nav-forward) {
  --slide: -56px;
  animation: 140ms ease-in both papi-fade reverse, 320ms cubic-bezier(0.32, 0.72, 0, 1) both papi-slide reverse;
}
::view-transition-new(.nav-forward) {
  --slide: 56px;
  animation: 200ms ease-out 140ms both papi-fade, 320ms cubic-bezier(0.32, 0.72, 0, 1) both papi-slide;
}
::view-transition-old(.nav-back) {
  --slide: 56px;
  animation: 140ms ease-in both papi-fade reverse, 320ms cubic-bezier(0.32, 0.72, 0, 1) both papi-slide reverse;
}
::view-transition-new(.nav-back) {
  --slide: -56px;
  animation: 200ms ease-out 140ms both papi-fade, 320ms cubic-bezier(0.32, 0.72, 0, 1) both papi-slide;
}

@keyframes papi-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes papi-slide {
  from { translate: var(--slide); }
  to { translate: 0; }
}

/* dolny pasek nie ma sie ruszac w trakcie przejscia */
::view-transition-group(papi-tabbar) { animation: none; z-index: 100; }
::view-transition-old(papi-tabbar) { display: none; }
::view-transition-new(papi-tabbar) { animation: none; }

@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(*),
  ::view-transition-new(*),
  ::view-transition-group(*) {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
}
```

Krok 5, `src/components/shell/BottomTabBar.tsx:93-102`, dopisać do stylu `nav`: `viewTransitionName: "papi-tabbar"`. Bez tego cały pasek zakładek będzie się przesuwał razem z treścią, co wygląda źle.

### 8. Manifest, splash, skróty (K9)

Plik: `public/manifest.json`, wersja docelowa:

```json
{
  "id": "/dashboard",
  "name": "PAPI PLANER",
  "short_name": "Papi",
  "description": "Osobisty system zarządzania transformacją",
  "start_url": "/dashboard",
  "scope": "/",
  "display": "standalone",
  "display_override": ["standalone", "minimal-ui"],
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "orientation": "portrait",
  "lang": "pl",
  "dir": "ltr",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "Nawyki", "short_name": "Nawyki", "url": "/habits", "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192" }] },
    { "name": "Dziennik", "short_name": "Dziennik", "url": "/journal", "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192" }] },
    { "name": "Okrągły Stół", "short_name": "Debata", "url": "/roundtable", "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192" }] }
  ]
}
```

`background_color: "#0f172a"` musi być zgodny z `themeColor` i z kolorem ekranu ładowania, inaczej wraca biały błysk. Jeśli aplikacja ma zostać jasna, zmieniamy oba na `#f8fafc`. Ważne, żeby były takie same.

Splashe iOS (Windows, Node, zgodnie z regułą "skrypty w Node"):

```
npx pwa-asset-generator public/icon-source.png public/icons/splash --background "#0f172a" --splash-only --type png --padding "20%"
```

Narzędzie wypisze gotowe znaczniki `<link rel="apple-touch-startup-image" ...>`, które wkleja się do `<head>` w `src/app/layout.tsx:28-36`.

Skrócenie startu: żeby zabić biały ekran przed spinnerem, warto podmienić spinner z `src/app/(app)/layout.tsx:21-43` na ekran w kolorze `background_color` z logo (ta sama grafika co splash). Wtedy przejście splash → aplikacja jest bezszwowe.

### 9. Powiększenie celu dotykowego bez zmiany wyglądu (K10)

Wzorzec do zastosowania w `habits/page.tsx:705` i `dashboard/page.tsx:2087`: kwadrat zostaje 24 px, ale klikalne pole ma 44 px.

```tsx
<button
  type="button"
  aria-pressed={completed}
  aria-label={completed ? "Odznacz" : "Odhacz"}
  onClick={(e) => {
    e.stopPropagation();
    if (toggling) return;
    haptic(completed ? "toggleOff" : "toggleOn");
    onToggle();
  }}
  style={{
    // pole dotyku 44x44, kwadrat rysowany w srodku
    width: 44,
    height: 44,
    margin: -10,          // zeby uklad wygladal tak samo jak dzis
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "none",
    padding: 0,
    flexShrink: 0,
    cursor: toggling ? "not-allowed" : "pointer",
    touchAction: "manipulation",
  }}
>
  <span
    style={{
      width: 24,
      height: 24,
      borderRadius: 7,
      border: completed ? "none" : "2px solid var(--border)",
      background: completed ? "var(--success)" : "transparent",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)",
    }}
  >
    {/* dotychczasowy svg z ptaszkiem */}
  </span>
</button>
```

### 10. Dźwięki: moja szczera rekomendacja to NIE

Odpowiedź krótka: nie warto, poza jednym wyjątkiem, domyślnie wyłączonym.

Powody, konkretnie dla tej aplikacji:
1. **Aplikacja już gra dźwięk i to jest jej wartość.** `src/components/briefing/BriefingCard.tsx:254` i `:261` odtwarzają briefing głosowy przez `<audio>` (TTS z ElevenLabs, `src/lib/tts/elevenlabs.ts`). Dokładanie efektów interfejsu obok mówionego briefingu to hałas na hałasie.
2. **Przeglądarka nie zna trybu cichego telefonu.** Przełącznik ciszy na telefonie nie wycisza dźwięku ze strony. Aplikacja, która piknie na spotkaniu, bo użytkownik odhaczył nawyk, jest odinstalowywana tego samego dnia. Haptics tego problemu nie ma, bo system sam zarządza wibracją.
3. **Dźwięk z `<audio>` przerywa muzykę.** Użytkownik ćwiczy przy podkaście, odhacza aktywność, podcast się zatrzymuje. To ryzyko realne dla `HTMLAudioElement`. Da się je obejść przez Web Audio API z krótkimi buforami, ale to dodatkowa złożoność dla efektu, który i tak jest w najlepszym razie neutralny.
4. **Wartość dodana jest bliska zeru.** Wibracja przekazuje tę samą informację (potwierdzenie dotyku) prywatnie, natychmiast i bez ryzyka. Dźwięk powtarza to samo publicznie.

Jedyny wyjątek, który dałbym: **jeden krótki dźwięk sukcesu po zamknięciu całego dnia** (wszystkie aktywności odhaczone), jako nagroda. Zasady:
- domyślnie **wyłączony**, włączany w Admin → Ustawienia,
- Web Audio API, nie `<audio>` (nie przerywa muzyki),
- głośność maksimum 0.12, długość poniżej 400 ms,
- nigdy przy błędzie i nigdy przy zwykłym kliknięciu.

Gotowy moduł, gdyby właściciel chciał to mieć (plik `src/lib/sound.ts`):

```ts
"use client";

/** Jeden dzwiek sukcesu, Web Audio API. Domyslnie WYLACZONY. */
const KEY = "papi.sound";
let ctx: AudioContext | null = null;

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1"; // domyslnie off
  } catch {
    return false;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
  if (on) playSuccess();
}

export function playSuccess() {
  if (!isSoundEnabled()) return;
  if (typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = ctx ?? new AudioCtx();
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    // dwa krotkie tony: C6 -> G6, bardzo cicho
    [1046.5, 1568.0].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.09);
      gain.gain.linearRampToValueAtTime(0.12, now + i * 0.09 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.18);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.2);
    });
  } catch {
    /* brak dzwieku to nie blad */
  }
}
```

### 11. Przełączniki w ustawieniach

Do dodania w `src/app/(app)/admin/page.tsx`, zakładka Ustawienia (dziś sekcja istnieje, `router.push("/admin?tab=settings")` w `dashboard/page.tsx:931`):
- "Wibracje przy dotknięciu" (domyślnie **włączone**), podpięte pod `setHapticsEnabled` z `src/lib/haptics.ts`
- "Dźwięk po zamknięciu dnia" (domyślnie **wyłączone**), podpięte pod `setSoundEnabled`

Obydwa przełączniki muszą przy włączeniu od razu dać próbkę (wibrację lub dźwięk), inaczej użytkownik nie wie, co włączył.

---

## Ryzyka

1. **`viewportFit: "cover"` bez pozostałych poprawek psuje siedem ekranów.** Toasty i przyciski akcji z `bottom: 80/90` (tabela K7) schowają się pod paskiem zakładek na telefonach z paskiem gestów. Punkty 3 z sekcji "Gotowe do wdrożenia" (widok + powłoka + siedem podmian) muszą wejść jednym commitem i zostać sprawdzone na realnym telefonie, nie w symulatorze przeglądarki.
2. **`viewportFit: "cover"` plus `black-translucent` na iOS wpycha treść pod zegar.** Dopóki `main` nie dostanie `paddingTop: var(--safe-t)`, nagłówki stron będą pod paskiem statusu. To ta sama zmiana, ale łatwo o niej zapomnieć, bo na Androidzie problem nie występuje.
3. **`interactiveWidget: "resizes-content"` zmienia wysokość widoku przy każdym otwarciu klawiatury.** Elementy z `height: 100dvh` (`roundtable/page.tsx:280`) i `position: fixed; inset: 0` (`MentorChat.tsx:240`) przeskoczą. Trzeba przetestować z otwartą klawiaturą: czat mentora, arkusz follow-up, formularz dodawania nawyku, dziennik.
4. **`overscroll-behavior-y: none` na `body` odbiera pull-to-refresh.** To jest cel, ale jeśli ktoś w zespole używał pociągnięcia w dół do odświeżenia danych, straci ten nawyk. Warto dołożyć widoczny przycisk odświeżania albo własny gest pull-to-refresh, bo dane i tak odświeżają się przy powrocie do karty (`habits/page.tsx:127`).
5. **`useScrollLock` z `position: fixed` na `body` może migotać w modalach z animacją wjazdu.** Zamiana stylu `body` w tej samej klatce co animacja `slideUp` (`FollowUpSheet.tsx:38`) potrafi dać jedno mrugnięcie. Jeśli wystąpi, blokadę należy włączać w `requestAnimationFrame`.
6. **Nowy service worker musi zastąpić stary u każdego, kto ma aplikację zainstalowaną.** `skipWaiting` plus `clients.claim` są w kodzie, ale użytkownik z aktywnym starym workerem dostanie nową wersję dopiero po pełnym zamknięciu i ponownym otwarciu aplikacji. Nazwy cache mają w sobie `v2`, więc przy każdej zmianie strategii trzeba podbić `VERSION`, inaczej ludzie zostaną na starych plikach. To najczęstsza przyczyna "u mnie nie widać zmian".
7. **Cache danych to dane osobowe na dysku.** Cache `papi-data-v2` przechowuje odpowiedzi API zalogowanego użytkownika. Jeśli z jednego telefonu korzysta więcej niż jedna osoba, po wylogowaniu trzeba wysłać komunikat `PAPI_CLEAR_DATA`. Bez tego drugi użytkownik może zobaczyć cudze dane offline. Lista dozwolonych ścieżek celowo nie zawiera `/api/admin/*`.
8. **View Transitions to funkcja oznaczona jako eksperymentalna w Next.** Włączenie `experimental.viewTransition` w `next.config.ts` może zmienić się przy aktualizacji Next. W przeglądarkach bez wsparcia aplikacja działa normalnie, po prostu bez animacji. Nazwa importu (`ViewTransition` kontra `unstable_ViewTransition`) do potwierdzenia przy pierwszym buildzie.
9. **Prefetch wszystkich zakładek kosztuje transfer.** `router.prefetch` dla 7 lub 8 tras przy montowaniu paska pobierze dane każdej z nich. Na dobrym łączu to zysk, na słabym mobilnym to opóźnienie pierwszego ekranu. Jeśli byłoby to odczuwalne, prefetch należy odpalać po pierwszym renderze z opóźnieniem (`setTimeout` około 1500 ms) albo tylko dla sąsiadów aktualnej zakładki.
10. **Wibracje mogą irytować, jeśli będzie ich za dużo.** Bezpieczna zasada: wibruje potwierdzenie dotyku i wynik operacji, nigdy zmiana stanu, której użytkownik nie wywołał (odświeżenie danych w tle, przyjście odpowiedzi, gdy ekran jest wyłączony). Bezpiecznik `MIN_GAP_MS` w module i sprawdzenie `document.hidden` to obsługują, ale każde nowe wpięcie trzeba świadomie zakwalifikować.
11. **Nie zweryfikowano na urządzeniu.** Ten audyt powstał wyłącznie z lektury kodu. Wszystkie wnioski o zachowaniu na telefonie (pasek gestów pod zakładkami, klawiatura zasłaniająca pole, dinozaur offline) wynikają z reguł działania przeglądarek i konkretnych linii kodu wskazanych wyżej. NIEZWERYFIKOWANE na fizycznym Androidzie: to wymaga uruchomienia zainstalowanej aplikacji na telefonie właściciela i porównania przed/po.

---

## Załącznik: co sprawdzono

| Plik | Co sprawdzono |
|---|---|
| `src/app/layout.tsx` | eksport `viewport` (17-23), metadane PWA, `<head>` (28-36), rejestracja SW (38) |
| `src/app/(app)/layout.tsx` | bramka autoryzacji (11-47), `main` i safe area (58-64), montowane komponenty PWA (66-68) |
| `src/app/globals.css` | całość, 64 linie, 10 zmiennych, 4 klatki kluczowe |
| `src/components/shell/BottomTabBar.tsx` | całość, 206 linii: `position: fixed`, safe area (101), scroll poziomy (104-121), `router.push` (168) |
| `src/components/shell/UniversalInputBar.tsx` | całość, 385 linii: nagrywanie (100-106), przyciski 36 px (222, 258) |
| `src/components/mentors/MentorChat.tsx` | pełnoekranowy modal (223-260), pole wejścia i klawiatura (613-660), wysyłanie (158-221) |
| `src/components/followup/FollowUpSheet.tsx` | całość, 152 linie |
| `src/components/pwa/*` | `InstallPrompt.tsx` (128 linii), oba rejestratory SW |
| `public/sw.js` | całość, 13 linii |
| `public/manifest.json` | całość, 17 linii |
| `src/app/(app)/dashboard/page.tsx` | karuzela (790-820, 949-1000), `toggleActivity` (382-462), generowanie planu (655-731), modale (1618-1700, 1804), `ActivityRow` (2043-2130) |
| `src/app/(app)/habits/page.tsx` | `toggleHabit` (136-167), toasty (131-134), stan pusty (436-446), `HabitRow` (677-790) |
| `src/app/(app)/roundtable/page.tsx` | wysokość `100dvh` (280), przycisk `bottom: 80` (596) |
| `src/app/(app)/journal/page.tsx` | `100vh` w `maxHeight` (567) |
| `src/app/(app)/mentors/page.tsx` | blokada scrolla (162-170), obsługa Escape (173-190), kafle (455-480) |
| `src/app/(app)/error.tsx`, `loading.tsx`, `not-found.tsx` | całość |
| `src/hooks/useAuth.ts`, `useStreamingChat.ts` | całość |
| `src/components/ui/BigTabs.tsx` | całość, 52 linie |
| `package.json`, `next.config.ts` | zależności i konfiguracja |
| `node_modules/next/dist/lib/metadata/types/extra-types.d.ts` | potwierdzenie `viewportFit` (52) i `interactiveWidget` (53) |
| `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md` | wzorce przejść dla tej wersji Next |
| `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md` | potwierdzenie `router.push(href, { transitionTypes })` (44) |

Polecenia weryfikacyjne użyte w audycie (do powtórzenia):

```
grep -rn "viewport-fit|viewportFit" src/          -> 0 trafien
grep -rn "vibrate|haptic" src/                    -> 0 trafien
grep -rn "overscroll|overscrollBehavior" src/     -> 0 trafien
grep -rn "navigator.onLine" src/                  -> 0 trafien
grep -rn "env\(safe-area" src/                    -> 6 trafien
grep -rn "position: \"fixed\"" src/               -> 21 trafien
grep -rn "bottom: [0-9]" src/                     -> 7 sztywnych offsetow nad paskiem
grep -rn "document.body.style" src/               -> 1 trafienie (mentors:164)
```
