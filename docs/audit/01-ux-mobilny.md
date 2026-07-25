# Audyt UX mobilnego — PAPI PLANER

**Data:** 2026-07-25
**Zakres:** touch targety, typografia, zasięg kciuka, gestykulacja, gęstość informacji
**Tryb:** read-only (nie zmieniono żadnego pliku aplikacji)
**Podstawa:** realny kod w `src/` — każda liczba niżej ma odnośnik `plik:linia`

---

## Streszczenie

Aplikacja działa i ma dobrą logikę, ale wygląda i reaguje jak strona internetowa, a nie jak aplikacja z App Store — i da się to pokazać liczbami, nie odczuciami. Zmierzyłem skryptem wszystkie 199 przycisków i pól w kodzie: **188 z nich (94%) jest niższych niż 44 piksele**, czyli poniżej minimum, jakie Apple i Google podają dla palca; 66 z nich ma poniżej 32 pikseli, a najmniejszy ma 14 pikseli. Tekst jest systemowo za mały: na 670 miejsc, gdzie ustawiono rozmiar czcionki, **65% to 13 pikseli lub mniej**, podczas gdy standardowy tekst w iPhonie ma 17 pikseli. Do tego dochodzą trzy rzeczy, które najbardziej psują wrażenie „to jest apka": nic nie reaguje na dotknięcie (zero animacji wciśnięcia, zero wibracji w całym kodzie), karuzela na Dashboardzie nie chodzi za palcem tylko przeskakuje po puszczeniu, a dolna nawigacja ma 7–8 zakładek wciśniętych w pasek, w którym mieści się 6 — reszta jest niewidoczna i nic tego nie sygnalizuje.

Najpoważniejszy pojedynczy błąd techniczny: aplikacja liczy „bezpieczne marginesy" ekranu (wcięcie na aparat, pasek dolny), ale **te obliczenia zawsze zwracają zero**, bo w `src/app/layout.tsx` brakuje jednej linijki (`viewportFit: "cover"`). Na iPhonie z wcięciem treść wejdzie pod pasek statusu. To trzeba naprawić przed jakąkolwiek sprzedażą.

Dobra wiadomość: 90% problemów to **jedna zmiana systemowa** — wprowadzenie skali rozmiarów i wysokości w `globals.css` i podmiana wartości w ~20 obiektach stylów, które są już scentralizowane w plikach (np. `btnPrimary`, `btnSecondary`, `inputStyle`, `iconBtnStyle`). Nie trzeba przepisywać 21 000 linii.

---

## Znaleziska krytyczne

### K1 (P0). Bezpieczne marginesy ekranu nie działają — cały kod `safe-area` zwraca zero

Aplikacja w 6 miejscach używa `env(safe-area-inset-*)`, żeby nie chować treści pod wcięciem aparatu i paskiem dolnym:

| Plik | Linia | Kod |
|---|---|---|
| `src/app/(app)/layout.tsx` | 60 | `paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px))"` |
| `src/components/shell/BottomTabBar.tsx` | 101 | `paddingBottom: "env(safe-area-inset-bottom, 0px)"` |
| `src/components/mentors/MentorChat.tsx` | 256 | `paddingTop: "calc(12px + env(safe-area-inset-top, 0px))"` |
| `src/components/mentors/MentorChat.tsx` | 618 | `paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))"` |
| `src/components/followup/FollowUpSheet.tsx` | 59 | `paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))"` |
| `src/components/pwa/InstallPrompt.tsx` | 56 | `bottom: "calc(80px + env(safe-area-inset-bottom, 0px) + 8px)"` |

Problem: `env(safe-area-inset-*)` zwraca prawdziwe wartości **tylko** gdy w meta viewport ustawione jest `viewport-fit=cover`. W `src/app/layout.tsx:17-23` viewport wygląda tak:

```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0f172a",
};
```

Brak `viewportFit: "cover"` (sprawdzone grepem: fraza `viewport-fit` / `viewportFit` nie występuje nigdzie w `src/` ani `public/`). Efekt: wszystkie 6 powyższych obliczeń to w praktyce `+0px`.

Do tego `src/app/layout.tsx:12` ustawia `statusBarStyle: "black-translucent"` i `src/app/layout.tsx:33` `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`. To znaczy: na iPhonie w trybie zainstalowanej apki **webview rozciąga się pod pasek statusu**. Połączenie „rozciągnij pod pasek" + „nie licz bezpiecznego marginesu" = nagłówek `Dzień dobry, {imię}` (`src/app/(app)/dashboard/page.tsx:862`) wejdzie pod zegarek i wcięcie aparatu. Żadna strona nie ma górnego `paddingTop` na safe-area — Dashboard startuje od `padding: "20px 16px 16px"` (`src/app/(app)/dashboard/page.tsx:859`).

**Dlaczego dziś nie boli:** apka jest testowana na Androidzie, gdzie w trybie standalone system rysuje pasek statusu nad webview. Na iOS to wybuchnie od razu.

---

### K2 (P0). 94% elementów dotykowych jest mniejszych niż 44 px

**Jak zmierzone:** skryptem Node przeszedłem wszystkie pliki `.tsx` w `src/`, wyciągnąłem każdy `<button>`, `<input>`, `<select>`, `<textarea>` razem z jego stylem (włącznie z rozwinięciem `...spread` i `style={nazwaStałej}`), i policzyłem wysokość jako `paddingGóra + paddingDół + fontSize × lineHeight + 2 × border`. Gdy było jawne `height`/`minHeight` — brałem je.

| Miara | Wynik |
|---|---|
| Zmierzonych elementów | **199** |
| Poniżej 44 px wysokości | **188 (94%)** |
| Poniżej 32 px | **66** |
| Poniżej 24 px | **21** |
| Spełnia ≥ 44 px | **11** |
| Ma jawną szerokość < 44 px | **12** |

Norma: Apple Human Interface Guidelines — minimum **44 × 44 pt**. Material Design 3 — minimum **48 × 48 dp** (ikony 24 dp + 12 dp marginesu z każdej strony).

**Rozkład po plikach (ile elementów < 44 px):**

```
 37  src/app/(app)/admin/page.tsx
 24  src/app/(app)/goals/page.tsx
 21  src/app/(app)/dashboard/page.tsx
 19  src/app/(app)/mentors/page.tsx
 17  src/app/(app)/diet/page.tsx
 13  src/app/(app)/discipline/[slug]/page.tsx
  8  src/app/(app)/habits/page.tsx
  6  src/app/(app)/journal/page.tsx
  5  src/components/briefing/BriefingCard.tsx
  4  src/components/files/FileList.tsx
  4  src/components/mentors/MentorChat.tsx
  4  src/components/shell/UniversalInputBar.tsx
  3  src/app/(app)/roundtable/page.tsx
  3  src/components/forms/MicDevicePicker.tsx
  3  src/components/forms/VoiceInput.tsx
  3  src/components/tracking/WeeklyCheckinForm.tsx
  2  src/app/(app)/error.tsx
  2  src/components/followup/FollowUpSheet.tsx
  2  src/components/forms/VoiceTextarea.tsx
  2  src/components/pwa/InstallPrompt.tsx
  2  src/components/weight/WeightTracker.tsx
  1  src/app/(app)/tracking/page.tsx
  1  src/components/files/FileUpload.tsx
  1  src/components/shell/BottomTabBar.tsx
  1  src/components/ui/BigTabs.tsx
```

**Najgorsze 20 (weryfikowane ręcznie przez odczyt kodu):**

| Wysokość | Plik:linia | Co to jest | Styl |
|---|---|---|---|
| **14 px** | `src/app/(app)/dashboard/page.tsx:1271` | „Zobacz wszystkie →" (przejście do Nawyków) | `padding: 0, fontSize: 12` |
| **18 px** | `src/components/shell/UniversalInputBar.tsx:185` | pole tekstowe „Co słychać?" — główne wejście do apki | brak `padding`/`height`, `fontSize: 15` |
| **18 px** | `src/components/shell/UniversalInputBar.tsx:153` | zamknięcie banera transkrypcji | `padding: 2, fontSize: 14` |
| **18×18** | `src/app/(app)/admin/page.tsx:1989` | checkbox „Pokaż spotkania w planie dnia" | `width: 18, height: 18` |
| **19 px** | `src/app/(app)/admin/page.tsx:314` | zamknięcie komunikatu błędu (`✕`) | brak paddingu |
| **20×20** | `src/app/(app)/goals/page.tsx:171` | checkbox wyboru mentora przy celu | `width: 20, height: 20` |
| **20 px** | `src/app/(app)/dashboard/page.tsx:2455` | „Zamknij" w formularzu posiłku | `padding: 2, fontSize: 16` |
| **20 px** | `src/components/forms/VoiceInput.tsx:230`, `VoiceTextarea.tsx:237` | zamknięcie banera transkrypcji | `padding: 2, fontSize: 16` |
| **21 px** | `src/app/(app)/admin/page.tsx:862`, `:879` | akcje na użytkowniku (admin) | `padding: "4px 10px", fontSize: 11` |
| **21 px** | `src/components/files/FileList.tsx:313` | akcja na pliku | `padding: "4px 10px", fontSize: 11` |
| **23 px** | `src/app/(app)/goals/page.tsx:2185` | **„📅 Zaplanuj"** przy zadaniu mentora | `padding: "4px 10px", fontSize: 11` |
| **23 px** | `src/app/(app)/goals/page.tsx:2201` | **„💬 Dodaj uwagę"** przy zadaniu mentora | `padding: "4px 10px", fontSize: 11` |
| **24 px** | `src/app/(app)/goals/page.tsx:1826` | „Anuluj" w pytaniach mentorów | `padding: "4px 10px", fontSize: 12` |
| **26 px** | `src/app/(app)/dashboard/page.tsx:930` | „Połącz ponownie" (naprawa Kalendarza Google) | `padding: "6px 12px", fontSize: 12` |
| **28×28** | `src/app/(app)/goals/page.tsx:1609`, `:1622` | **edycja i usunięcie celu** (`iconBtnStyle`, `goals:113-127`) | `width: 28, height: 28` |
| **29 px** | `src/app/(app)/mentors/page.tsx:828`, `:961`, `src/app/(app)/admin/page.tsx:349,570,1570,1581,1584` | wszystkie `btnSecondary` | `padding: "6px 12px", fontSize: 12`, `border: 1.5px` |
| **30 px** | `src/app/(app)/mentors/page.tsx:558` | **„💬 Pogadaj"** — główny przycisk karty mentora | `padding: "8px 12px", fontSize: 12` |
| **30 px** | `src/app/(app)/dashboard/page.tsx:1671` | zamknięcie modala historii briefingów (`×`) | `padding: 4, fontSize: 22` |
| **31 px** | `src/app/(app)/diet/page.tsx:2314` | usunięcie posiłku (🗑️) | `padding: 6, fontSize: 16` |
| **33 px** | `src/app/(app)/admin/page.tsx:51-56` (`pill`) | 7 zakładek panelu admina | `padding: "8px 18px", fontSize: 14` |

**Szczególnie groźne sąsiedztwo:** w `src/app/(app)/goals/page.tsx:2184` dwa przyciski o wysokości 23 px stoją jeden nad drugim z odstępem `gap: 4`. Środki tych przycisków dzieli **27 px**. Średnica opuszki palca to ~45–57 px. Przy każdym kliknięciu „Zaplanuj" jest realne ryzyko trafienia w „Dodaj uwagę".

**Wyjątki, które zmierzyłem ręcznie (skrypt je zaniżył):**
- `src/components/shell/BottomTabBar.tsx:166` — zakładka to kolumna: `padding 6+6` + ikona `fontSize 24, lineHeight 1` + `gap 2` + etykieta `fontSize 10` ≈ **50 px wysokości**. Wysokość OK, ale patrz K5 (szerokość / przycinanie).
- `src/app/(app)/diet/page.tsx:512` — komórka kalendarza ma `aspectRatio: "1 / 1"`, więc jej wysokość = szerokość. Przy `padding: "16px 12px"` strony (`diet:1878`), `padding: 16` karty (`diet:93`) i 6 przerw po 4 px: na ekranie 430 px → **≈ 50 px (OK)**, na ekranie 360 px → **≈ 40 px (za mało)**.

**11 elementów, które spełniają normę** (dla porządku): `dashboard:985, 1026, 1053` (44 px, `minHeight: 44`), `goals:156` (56 px), `roundtable:440` (47 px), `MentorCard.tsx:21` (53 px), `MentorChat.tsx:638` (44×44 — wyślij), `BottomTabBar.tsx:127` (56 px, ale to martwy kod — patrz K6), `admin:739`, `VoiceTextarea:261`, `WeeklyCheckinForm:150,162` (pola tekstowe).

---

### K3 (P0). Najczęstsza akcja w aplikacji — odhaczenie zadania — to `<div>` o boku 20–24 px

Wszystkie checkboxy w aplikacji to zwykłe `<div onClick>`, nie `<button>` ani `<input type="checkbox">`. To znaczy: brak obsługi klawiatury, brak roli dla czytnika ekranu, brak stanu „wciśnięty" i **bardzo mały cel dla palca**.

| Plik:linia | Co odhacza | Rozmiar celu | Wysokość całego wiersza |
|---|---|---|---|
| `src/app/(app)/dashboard/page.tsx:2087` | aktywność w Planie dnia (`ActivityRow`) | **22 × 22** | 38 px (`padding: "8px 4px"`, `:2077`) |
| `src/app/(app)/dashboard/page.tsx:1875` | spotkanie z kalendarza (`MeetingRow`) | **22 × 22** | 38 px |
| `src/app/(app)/dashboard/page.tsx:1302` | nawyk w mini-widgecie na Dashboardzie | **20 × 20** | 32 px (`padding: "6px 2px"`, `:1297`) |
| `src/app/(app)/habits/page.tsx:704` | nawyk na ekranie Nawyki (`HabitRow`) | **24 × 24** | ~50 px |
| `src/app/(app)/goals/page.tsx:2105` | zadanie z planu mentora | **22 × 22** | zmienna |
| `src/app/(app)/goals/page.tsx:1925` | kamień milowy celu | **20 × 20** | 30 px (przycisk `:1907`, `padding: "6px 0"`) |

22 px to **połowa** minimum Apple. Zaznaczanie zadań to czynność, którą użytkownik wykonuje kilkanaście razy dziennie — to jest rdzeń nawyku, na którym ma się „uzależnić". Dziś ta czynność jest najbardziej frustrującą interakcją w apce.

Dodatkowo w `src/app/(app)/goals/page.tsx:1635` sam `<svg width="16" height="16" onClick={onExpand}>` służy do rozwijania celu — **cel dotykowy 16 × 16 px**, najmniejszy w całej aplikacji.

Łącznie w kodzie jest **28 klikalnych elementów, które nie są przyciskami** (`<div>`, `<svg>` z `onClick`).

---

### K4 (P0). Tekst jest systemowo o 3–4 px za mały

Zliczone grepem po `src/`: **670 deklaracji `fontSize`**. Rozkład:

| px | ile razy | udział |
|---|---|---|
| 11 | 92 | 16% |
| 12 | 119 | 21% |
| 13 | 144 | 25% |
| 14 | 132 | 23% |
| 15 | 21 | 4% |
| 16 | 57 | 10% |
| 18+ | ~80 | 1% |
| 10 | 18 | 3% |

**65% całego tekstu to ≤ 13 px. 88% to ≤ 14 px.**

Punkt odniesienia:
- **iOS HIG (SF Pro, domyślny rozmiar Large):** Body = **17 pt**, Callout 16, Subhead 15, Footnote 13, Caption 1 = 12, Caption 2 = 11. Czyli to, czego apka używa jako tekstu głównego (13–14 px), w iOS jest rozmiarem *przypisu i podpisu pod zdjęciem*.
- **Material Design 3:** Body Large = 16, Body Medium = 14, Body Small = 12, Label Small = 11.

Drugi problem: **interlinia**. Na 670 deklaracji rozmiaru przypada tylko **80 deklaracji `lineHeight`** (12%). Reszta tekstu jedzie na domyślnej przeglądarkowej (~1,2), podczas gdy iOS dla Body 17 pt używa 22 pt, czyli **1,29**, a dla dłuższych bloków rekomenduje się 1,4–1,5. Efekt: tekst jest nie tylko mały, ale i „zbity".

Trzeci problem: liczby-metryki nie mają `font-variant-numeric: tabular-nums` — w całej apce ustawiono to **5 razy**. Przez to liczniki jak `{completedCount}/{totalActivities}` (`dashboard:901`) czy `{completionPct}%` (`dashboard:1504`, `fontSize: 36`) „skaczą" przy zmianie wartości. To drobiazg, ale to dokładnie ten drobiazg, po którym poznaje się natywną apkę.

---

### K5 (P0). Dolna nawigacja gubi 1–2 zakładki bez żadnego sygnału

`src/components/shell/BottomTabBar.tsx:15-24` definiuje **8 zakładek** (Dashboard, Cele, Nawyki, Dziennik, Dieta, Debata, Mentorzy, Admin). Dla zwykłego użytkownika Admin znika (`:36-38`), zostaje **7**.

Arytmetyka z kodu:
- kontener: `maxWidth: 430`, `padding: "0 8px"` (`:112, :114`) → dostępne **414 px** na ekranie 430 px, **344 px** na typowym Androidzie 360 px
- każda zakładka: `minWidth: 64`, `padding: "6px 12px"` (`:178-179`), etykieta `fontSize: 10` (`:188`)
- `gap: 4` (`:110`)

7 zakładek × 64 px + 6 × 4 px = **472 px minimum**. Etykieta „Dashboard" (9 znaków przy 10 px ≈ 45 px) + padding 24 px = 69 px, więc realnie **≈ 477 px**.

- Na ekranie 430 px: **63 px poza kadrem** (~1 zakładka).
- Na ekranie 360 px: **133 px poza kadrem** (~2 zakładki).

Pasek jest przewijalny (`overflowX: "auto"`, `:115`), ale scrollbar jest **jawnie ukryty** (`:117` `scrollbarWidth: "none"` i `:199-203` reguła `::-webkit-scrollbar { display: none }`). Nie ma cienia-gradientu na krawędzi, nie ma strzałki. **Użytkownik nie ma jak się dowiedzieć, że Mentorzy i Debata istnieją.**

Do tego: `src/components/shell/BottomTabBar.tsx:59-89` implementuje przeciąganie myszą — czyli jest tam kod pod desktop, a na telefonie problem zostaje.

To samo w panelu admina: `src/app/(app)/admin/page.tsx:258-266` — 7 zakładek typu `pill` (`padding: "8px 18px", fontSize: 14`) w kontenerze `overflowX: "auto"` (`:291`). Suma szerokości ≈ **685 px** przy dostępnych 398 px → **42% zakładek poza kadrem**.

---

### K6 (P1). Zero reakcji na dotknięcie w całej aplikacji

Grep po całym `src/`:
- `navigator.vibrate` / `vibrate(` — **0 wystąpień**. Zero haptyki, mimo że Android to obsługuje w PWA (`navigator.vibrate`), a iOS 18+ przez `<input switch>`.
- `:active` / stan wciśnięcia — **1 wystąpienie**, i to na ekranie logowania w klasie Tailwind (`src/app/(auth)/login/page.tsx:50` — `active:opacity-80`). W samej aplikacji: **0**.
- `onMouseDown` ze skalowaniem — 1 wystąpienie, `src/components/shell/BottomTabBar.tsx:149-156`, ale to **martwy kod**: efekt jest wewnątrz gałęzi `if (tab.isVoice)` (`:125`), a w tablicy `tabs` (`:15-24`) **żadna zakładka nie ma `isVoice: true`**. Ten kod nigdy się nie wykonuje.
- `touchAction` — **0 wystąpień**.
- Biblioteki animacji: brak (`package.json` — nie ma framer-motion, react-spring itd.), brak View Transitions (`0` wystąpień `ViewTransition` / `startViewTransition`).

Efekt praktyczny: **klikasz przycisk i nic się nie dzieje przez 200–800 ms**, dopóki nie wróci odpowiedź z serwera. Mózg odczytuje to jako „nie zadziałało" i użytkownik klika drugi raz. To jest pojedyncza najtańsza zmiana o największym efekcie na odczucie „premium".

Osobno: `* { -webkit-tap-highlight-color: transparent }` w `src/app/globals.css:23-25` **wyłącza** domyślne podświetlenie Androida — czyli usunięto jedyny natywny feedback, jaki był, i nie dano nic w zamian.

---

### K7 (P1). Karuzela Dashboardu nie chodzi za palcem i skacze wysokością

`src/app/(app)/dashboard/page.tsx:791-820` — obsługa swipe'a:

```
onTouchStart  → zapamiętaj punkt startu
onTouchMove   → policz dx, zablokuj kierunek (isHorizontalSwipe)
onTouchEnd    → jeśli |dx| > 50, przełącz panel
```

Co jest nie tak:
1. **Panel nie przesuwa się razem z palcem.** `transform: translateX(-${activePanel * 100}%)` (`:973`) zależy tylko od stanu, nie od `touchDeltaRef`. Użytkownik ciągnie palcem, ekran stoi, puszcza — i dopiero wtedy panel przeskakuje. Natywna karuzela iOS śledzi palec 1:1. To jest jedna z 2–3 rzeczy, po których od razu czuć „to nie jest apka".
2. **Brak `touch-action`.** Kierunek jest blokowany tylko w JS (`:801-807`), ale nigdzie nie ma `preventDefault()` ani `touchAction: "pan-y"`. Przy skosie palca przeglądarka **jednocześnie** przewinie stronę w pionie i naliczy swipe w poziomie.
3. **Skok wysokości.** Panele mają `height: activePanel === N ? "auto" : 0` (`:978, :1465, :1479`) przy `overflow: hidden` na rodzicu (`:966`). Wysokość zmienia się **natychmiast** przy zmianie stanu, a `translateX` jedzie 300 ms (`:974`). Czyli: kontener najpierw skacze do nowej wysokości, dopiero potem treść wjeżdża. Panele mają skrajnie różne wysokości (Plan dnia z 10 aktywnościami vs Statystyki), więc skok będzie duży i widoczny.
4. **Kropki pod karuzelą nie są klikalne.** `src/app/(app)/dashboard/page.tsx:1576-1585` to `<div>` bez `onClick` — czysta dekoracja. Użytkownik będzie w nie pukał.

---

### K8 (P0). Pola tekstowe mają 13–15 px, a zoom jest zablokowany na siłę

**Każde** pole tekstowe w aplikacji ma czcionkę mniejszą niż 16 px:

| Plik:linia | fontSize |
|---|---|
| `src/components/shell/UniversalInputBar.tsx:185` | 15 |
| `src/components/forms/VoiceInput.tsx:254` | 14 |
| `src/components/forms/VoiceTextarea.tsx:261` | 14 |
| `src/app/(app)/admin/page.tsx:68` (`inputStyle`), `:739` (textarea) | 14 |
| `src/app/(app)/diet/page.tsx:126` (`inputStyle`) | 14 |
| `src/app/(app)/mentors/page.tsx:46` (`inputStyle`) | 14 |
| `src/app/(app)/discipline/[slug]/page.tsx:102` (`inputStyle`) | 14 |
| `src/app/(app)/goals/page.tsx:991, 1714` | 14 |
| `src/app/(app)/goals/page.tsx:2300, 2328, 2356` (data / godzina / minuty) | 13 |
| `src/components/weight/WeightTracker.tsx:269` | 14 |
| `src/components/tracking/WeeklyCheckinForm.tsx:180, 216` | 14 |

Safari na iOS automatycznie **przybliża stronę**, gdy użytkownik kliknie w pole z czcionką < 16 px. Aplikacja zapobiega temu ustawiając `maximumScale: 1, userScalable: false` (`src/app/layout.tsx:20-21`) — czyli **zablokowaniem zoomu w całej aplikacji**.

To jest wymiana jednego problemu na gorszy:
- łamie WCAG 2.2, kryterium 1.4.4 (Resize Text) — użytkownik nie może powiększyć treści,
- przy tekście 11–13 px oznacza, że osoba ze słabszym wzrokiem **nie ma żadnej drogi wyjścia**,
- App Store i Google Play przy audytach dostępności to wyłapują.

Właściwa naprawa: podnieść pola do 17 px i **usunąć blokadę zoomu**. Wtedy Safari nie przybliża, bo nie ma po co.

---

### K9 (P1). Główne akcje dnia siedzą w górnej strefie ekranu

Policzone z kodu, stos pionowy Dashboardu od `src/app/(app)/dashboard/page.tsx:859`:

| Element | Plik:linia | Wysokość |
|---|---|---|
| padding góra strony | `:859` | 20 |
| `<h1>` „Dzień dobry" (`fontSize: 24`) | `:862` | ~29 |
| wiersz z datą (`marginTop: 4` + 14 px) | `:865-868` | ~21 |
| odstęp flex `gap: 12` | `:859` | 12 |
| pasek postępu | `:888-903` | ~14 |
| odstęp flex | | 12 |
| `BigTabs` (padding 12+12, fontSize 15) | `BigTabs.tsx:34,39` | 42 |
| `marginBottom: 16` + `gap: 12` | `BigTabs.tsx:24` | 28 |
| padding karty | `dashboard:196` | 16 |
| `<h3>` „Wygeneruj plan dnia" + margines | `:981` | 27 |
| **= górna krawędź przycisków generowania** | | **≈ 221 px** |

Trzy przyciski generowania planu (`:985` „⚡ Wygeneruj automatycznie", `:1026` „💬 Wygeneruj z wkładem", `:1053` „🔄 Przeplanuj resztę") zajmują pas **od ~221 px do ~317 px** od góry ekranu.

- Na typowym Androidzie 360 × 800 to **28–40% od góry**.
- Na iPhonie 430 × 932 to **24–34% od góry**.

Badania zasięgu kciuka (Steven Hoober, ok. 1300 obserwacji; mapa stref Scotta Hurffa) zgodnie wskazują: przy telefonie trzymanym jedną ręką wygodna strefa to mniej więcej **dolne 2/3 ekranu**, a górna 1/3 wymaga przełożenia telefonu w dłoni. Przy telefonach 6"+ granica przesuwa się jeszcze niżej. Czyli **najważniejsza codzienna akcja aplikacji leży na granicy strefy „trzeba przechwycić telefon"**.

Dodatkowo: pasek uniwersalnego wejścia („Co słychać? Powiedz mi jak minął dzień...") jest w `src/app/(app)/dashboard/page.tsx:1591-1593` — **na samym dole przewijanej treści, nie przyklejony**. Przy planie z 8 aktywnościami i 5 nawykami sama karuzela ma ok. 780 px, więc pasek wejścia ląduje **~980 px od góry**, czyli użytkownik musi przewinąć ponad ekran, żeby cokolwiek wpisać. To jest funkcja „najszybszego wejścia" schowana najgłębiej.

**Pozostałe ekrany — gdzie leży główna akcja:**

| Ekran | Główna akcja | Plik:linia | Pozycja |
|---|---|---|---|
| Cele | „+ Dodaj cel" | `goals:923` | zaraz pod nagłówkiem i tabami, ~200 px od góry |
| Cele | edycja/usunięcie celu (28×28) | `goals:1609, 1622` | prawy górny róg karty — najgorszy róg dla kciuka prawej ręki |
| Nawyki | „+ Dodaj nawyk" | `habits:313` | ~180 px od góry |
| Dieta | „+ Dodaj posiłek" | `diet:2016` | **poniżej całej karty „Dzisiaj"** (koło + 5 wierszy + 3 paski + ramka celu) → ~700 px od góry |
| Dieta | strzałki miesiąca ← → | `diet:442, 452` | góra karty kalendarza, wysokość 33 px |
| Mentorzy | „💬 Pogadaj" na karcie | `mentors:558` | rozproszone w siatce, 30 px wysokości |
| Debata | „Rozpocznij debatę" | `roundtable:440` | pod polem i listą mentorów — **jedyny ekran, gdzie CTA jest nisko i ma 47 px** |

Ekran Debaty jest wzorem do naśladowania dla reszty.

---

### K10 (P2). Brak pull-to-refresh i brak jakiegokolwiek odświeżania gestem

Grep: **zero** implementacji pull-to-refresh, zero `overscrollBehavior`. Jedyny `onTouchMove` w apce to karuzela (`dashboard:797`).

Każdy ekran pobiera dane sam po wejściu, ale użytkownik nie ma jak powiedzieć „odśwież":
- Dashboard — `fetchDashboard()` tylko przy montowaniu i po akcji
- Nawyki, Cele, Dieta, Mentorzy — tak samo

W apce, gdzie plan generuje AI w tle i dane mogą przyjść z opóźnieniem, brak odświeżenia gestem oznacza, że użytkownik zabija apkę i uruchamia od nowa. Standard iOS/Android to pociągnięcie w dół. Dodatkowo brak `overscrollBehavior: "contain"` na kontenerach przewijanych sprawia, że przewijanie modala pociąga tło.

---

### K11 (P1). Gęstość informacji — konkretne ekrany do odchudzenia

Właściciel mówi „za dużo informacji na początku". Poniżej co dokładnie widać na starcie, policzone z kodu.

#### Dashboard, panel „Plan dnia" — 6 bloków przed jakąkolwiek treścią

Kolejność od góry (`src/app/(app)/dashboard/page.tsx`):
1. `:862` nagłówek + data + plakietka typu dnia
2. `:888` pasek postępu + licznik `3/12`
3. `:907` (warunkowo) baner błędu Kalendarza Google z przyciskiem
4. `:949` trzy zakładki karuzeli
5. `:980` karta „Wygeneruj plan dnia" z 2–3 przyciskami
6. `:1252` mini-widget Nawyków — **5 nawyków** (`habits.slice(0, 5)`, `:1287`) + „+N więcej"
7. `:1367` dopiero teraz właściwy „Plan dnia"

Czyli **plan dnia — po co użytkownik wszedł — zaczyna się jako siódmy blok**, po ok. 500–600 px.

**Co ukryć:**
- Karta „Wygeneruj plan dnia" (`:980-1248`) — pokazywać **tylko gdy `totalActivities === 0`**. Gdy plan jest, przenieść do jednego przycisku „⋯" w nagłówku sekcji lub do przyklejonego paska na dole. Dziś zajmuje ~155 px na górze ekranu każdego dnia, także wtedy gdy plan już istnieje.
- Mini-widget Nawyków (`:1252`) — 5 pozycji to za dużo jako przystawka. Zwinąć do jednej linii: `✅ Nawyki 3/7` + pasek, rozwijane dotknięciem.
- Baner błędu Kalendarza (`:907`) — przenieść do dyskretnej ikonki przy dacie zamiast pełnego bloku z przyciskiem.

#### Dieta, karta „Dzisiaj" — 10 bloków w jednej karcie

`src/app/(app)/diet/page.tsx:1931-2012`:
1. koło postępu (`CircularProgress`, `:1934`)
2–6. **pięć** wierszy `BreakdownRow` (`:1938-1967`): BMR, Aktywności dziś, Spalanie do tej godziny, Zjedzone, Pozostało — każdy `fontSize: 13` w ramce (`diet:302-312`)
7–9. **trzy** paski makro (`:1972-1992`)
10. ramka „Cel dzienny" (`:1996-2011`, `fontSize: 11`)

Dopiero **pod tym** jest „+ Dodaj posiłek" (`:2016`) i lista posiłków.

**Co ukryć:** zostawić koło + jeden wiersz „Pozostało" (ten jedyny ma `fontSize: 16` i `fontWeight: 800`, `:323` — czyli już dziś jest oznaczony jako najważniejszy). Pozostałe 4 wiersze + makra + cel schować pod „Szczegóły bilansu ▾". Przycisk „+ Dodaj posiłek" przesunąć **nad** kartę albo do przyklejonego paska.

#### Cele → „Plany mentorów" — 2 mikro-przyciski przy każdym zadaniu

`src/app/(app)/goals/page.tsx:2184-2221` — każde zadanie planu ma obok siebie kolumnę z „📅 Zaplanuj" (23 px) i „💬 Dodaj uwagę" (23 px). Przy planie na 10 zadań to **20 mikro-przycisków** na jednym ekranie.

**Co zrobić:** zostawić w wierszu tylko checkbox i tekst; obie akcje przenieść pod przytrzymanie / rozwinięcie wiersza albo do dolnego arkusza (bottom sheet) po dotknięciu zadania.

#### Panel admina — 7 zakładek, 2267 linii

`src/app/(app)/admin/page.tsx:258-266`. To ekran narzędziowy, ale przy wejściu komercyjnym zakładka „Moje dane" i „Ustawienia" należą do zwykłego użytkownika, a reszta nie. Warto rozdzielić: „Profil / Ustawienia" jako normalny ekran, „Admin" jako osobne, ukryte wejście.

#### Ekran Mentorów — siatka, która się rozjeżdża

`src/app/(app)/mentors/page.tsx:341` używa `gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))"`. Przy `padding: "24px 16px"` (`:296`) i `gap: 12`:
- ekran 430 px → 398 dostępne → **2 kolumny** po 193 px
- ekran 360 px → 328 dostępne → 2 × 170 + 12 = 352 > 328 → **1 kolumna** na całą szerokość

Czyli ten sam ekran wygląda zupełnie inaczej na iPhonie i na zwykłym Androidzie. Trzeba ustawić stałe 2 kolumny (`repeat(2, 1fr)`) i zejść z `minmax`.

---

## Typografia — tabela „obecnie → propozycja"

Punkt odniesienia: **iOS HIG Dynamic Type (rozmiar Large)** i **Material 3 type scale**.

| Rola tekstu | Dziś w kodzie | Dowód | Propozycja | Interlinia | Uzasadnienie |
|---|---|---|---|---|---|
| Tytuł strony (`h1`) | **24** (28 w Admin/Mentorzy) | `dashboard:862`, `goals:882`, `habits:283`, `journal:362`, `diet:1880`, `admin:271`, `mentors:308` | **30** / waga 700 | 1.15 | iOS Title 1 = 28, Large Title = 34. 30 to środek; ujednolica 24 vs 28 |
| Nagłówek sekcji (`h2` w karcie) | **16** | `dashboard:1368, 1481`, `diet:1932, 2027` | **20** | 1.2 | iOS Title 3 = 20, Material Title Large = 22 |
| Podnagłówek karty (`h3`) | **14** | `dashboard:981, 1268` | **17** / waga 600 | 1.25 | iOS Headline = 17 semibold |
| **Tekst główny (body)** | **13–14** | `dashboard:2140` (nazwa aktywności 14), `habits:744`, `goals:1956` | **17** | 1.4 | **iOS Body = 17.** To jest ta jedna liczba, która najbardziej zmienia odczucie |
| Tekst drugorzędny | **12–13** | `dashboard:900, 1370`, `diet:1881` | **15** | 1.4 | iOS Subhead = 15 |
| Etykieta pola / label | **11–13** | `admin:83`, `mentors:54`, `diet:132`, `goals:950` | **13** / waga 600 | 1.3 | iOS Footnote = 13. Etykieta może być mniejsza, ale nie 11 |
| Podpis / caption | **10–11** | `BottomTabBar:188` (10), `diet:474` (10), `diet:2309` (11) | **12** minimum | 1.3 | iOS Caption 1 = 12; 10 px nie przechodzi żadnego audytu |
| Blok wielkiej liczby (metryka) | **36** / **24** | `dashboard:1503` (36%), `dashboard:1513` (24, kcal) | **40** + `tabular-nums` | 1.0 | Liczba ma być bohaterem ekranu; `tabular-nums` żeby nie skakała |
| Wartość w wierszu statystyki | **13–16** | `diet:323`, `tracking:253` | **17** + `tabular-nums` | 1.2 | spójne z body |
| Pole tekstowe (input) | **13–15** | patrz K8 — wszystkie | **17** | 1.3 | ≥16 wyłącza auto-zoom iOS; pozwala zdjąć `maximumScale: 1` |
| Etykieta zakładki dolnej | **10** | `BottomTabBar:188` | **11** | 1.0 | iOS tab bar = 10 pt SF, ale przy tylko 4–5 zakładkach; przy naszych da się 11 |
| Nagłówek bloku czasu (WERSALIKI) | **12** | `dashboard:1405` | **13** + `letterSpacing: 0.6` | 1.2 | wersaliki czytają się mniejsze niż są; +1 px kompensuje |

**Konsekwencja liczbowa:** dziś 65% tekstu to ≤13 px. Po zmianie żaden tekst w aplikacji nie schodzi poniżej 12 px, a tekst czytany (body) rośnie z 13–14 na 17, czyli **o 25%**.

**Uwaga o wysokości:** podniesienie body z 14 na 17 samo z siebie podnosi wysokość przycisków o ~4 px. Reszta (do 44/48 px) musi przyjść z paddingu — patrz „Gotowe do wdrożenia".

---

## Zasięg kciuka (thumb zone) — co przenieść na dół

Zasada: **główna akcja ekranu należy do dolnej 1/3**, tuż nad paskiem zakładek. Wszystko, co jest akcją „raz na ruski rok" (edytuj, usuń, ustawienia), może zostać na górze.

| Ekran | Co jest źle | Plik:linia | Co zrobić |
|---|---|---|---|
| **Dashboard** | 3 przyciski generowania planu na ~221–317 px od góry | `dashboard:985, 1026, 1053` | Gdy plan pusty → duży przycisk w przyklejonym pasku nad zakładkami. Gdy plan jest → schować do menu „⋯" przy nagłówku „Plan dnia" (`:1368`) |
| **Dashboard** | pasek „Co słychać?" na samym dole przewijanej treści (~980 px) | `dashboard:1591` | Przykleić: `position: sticky; bottom: calc(64px + safe-area)`. To jest najszybsze wejście danych — musi być zawsze pod ręką |
| **Dashboard** | kropki karuzeli niedotykalne | `dashboard:1576` | Zamienić na `<button>` 44×44 z małą kropką w środku |
| **Cele** | edycja/usunięcie celu 28×28 w prawym górnym rogu karty | `goals:1609, 1622` | Przenieść do dolnego arkusza po przytrzymaniu karty albo do swipe-to-reveal. Prawy górny róg to najgorsze miejsce dla kciuka prawej ręki |
| **Cele** | „Zaplanuj"/„Dodaj uwagę" 23 px przy każdym zadaniu | `goals:2185, 2201` | Dotknięcie zadania → dolny arkusz z akcjami po 48 px |
| **Cele** | „+ Dodaj cel" pod nagłówkiem | `goals:923` | Przenieść do przyklejonego przycisku na dole |
| **Dieta** | „+ Dodaj posiłek" pod całą kartą bilansu (~700 px) | `diet:2016` | Przykleić na dole ekranu. To jest akcja wykonywana 3–5× dziennie |
| **Dieta** | strzałki miesiąca ← → w górze karty, 33 px | `diet:442, 452` | Powiększyć do 44×44 **i** dodać swipe w lewo/prawo na siatce kalendarza |
| **Mentorzy** | „💬 Pogadaj" (30 px) rozsiane po siatce | `mentors:558` | Podnieść do 48 px; cała karta mentora ma otwierać czat, przycisk jest wtedy tylko wizualną afordancją |
| **Nawyki** | „+ Dodaj nawyk" pod nagłówkiem | `habits:313` | Przyklejony przycisk na dole |
| **Wszędzie** | zamykanie modali `×` w prawym górnym rogu | `dashboard:1671`, `mentors:1012`, `admin:758` | Dolne arkusze zamiast modali na środku; zamykanie przez pociągnięcie w dół + przycisk na dole |
| **Debata** | — | `roundtable:440` | **Wzorzec do skopiowania**: CTA na dole, 47 px, pełna szerokość |

---

## Gestykulacja — co powinno działać, a nie działa

| Gest | Stan | Dowód | Rekomendacja |
|---|---|---|---|
| Swipe karuzeli Dashboardu | **jest, ale nie śledzi palca** | `dashboard:791-820`, `:973` | Dodać `translateX(calc(-${panel*100}% + ${delta}px))` w czasie ruchu + `touchAction: "pan-y"` + sprężynę na końcu (`cubic-bezier(0.32,0.72,0,1)`) |
| Pull-to-refresh | **brak (0 wystąpień)** | grep całego `src/` | Dodać na Dashboard, Nawyki, Cele, Dieta, Mentorzy. To jedyny odruch, którym użytkownik mówi „sprawdź jeszcze raz" |
| Swipe między zakładkami Dieta / Cele / Dziennik | **brak** | `BigTabs.tsx` — tylko `onClick` | Skoro Dashboard ma swipe między panelami, to samo powinno działać w każdym `BigTabs` — inaczej użytkownik uczy się gestu i przestaje mu ufać |
| Swipe na wierszu → usuń / odłóż | **brak** | `dashboard:2069` (`ActivityRow`), `habits:692` (`HabitRow`) | Klasyczny wzorzec iOS. Rozwiązuje jednocześnie problem mikro-przycisków „usuń" (`diet:2314` — 31 px) |
| Swipe zmiany miesiąca w kalendarzu diety | **brak** | `diet:487-493` (siatka) | Naturalne oczekiwanie przy każdym kalendarzu |
| Pociągnięcie w dół, żeby zamknąć arkusz | **brak** | `FollowUpSheet.tsx:45`, `MentorChat.tsx:238` | `MentorChat` już wjeżdża animacją `slideUp` (`:246`) — brakuje tylko gestu wyjścia |
| Przytrzymanie (long-press) na akcje | **brak** | — | Alternatywa dla mikro-przycisków edycji/usunięcia |
| **Konflikt: poziomy vs pionowy scroll** | **realny** | `BottomTabBar:115`, `admin:291`, `tracking:235` + karuzela `dashboard:966` | Trzy miejsca z `overflowX: "auto"` bez `touchAction`, `overscrollBehavior` ani `scrollSnapType`. Przy skosie palca przewija się jedno i drugie |
| Docelowe przyciąganie (scroll-snap) | **brak (0 wystąpień)** | grep `scrollSnap` | Pasek zakładek i karuzela powinny mieć `scrollSnapType: "x mandatory"` |
| Haptyka | **brak (0 wystąpień)** | grep `navigator.vibrate` | Patrz K6 |

**Uwaga o kolejności:** karuzela śledząca palec i pull-to-refresh dają największy skok „to jest apka" na jednostkę pracy. Swipe-to-delete jest ładny, ale to trzecia kolejka.

---

## Rekomendacje

### P0 — blokujące „wejście komercyjne" (bez tego nie ma premium)

1. **Dodać `viewportFit: "cover"`** w `src/app/layout.tsx:17` i dopisać `paddingTop` z safe-area do kontenera `<main>` w `src/app/(app)/layout.tsx:58`. Bez tego treść wejdzie pod wcięcie iPhone'a. (K1)
2. **Wprowadzić skalę tokenów** w `src/app/globals.css` (dziś 10 zmiennych, zero typografii/odstępów/wysokości) i podmienić wartości w scentralizowanych obiektach stylów. Lista obiektów do podmiany jest niżej. (K2, K4)
3. **Podnieść wszystkie cele dotykowe do min. 44 px** (rekomenduję 48 px = Material, bo mieści się w obu normach). Priorytet: 21 elementów < 24 px i 66 elementów < 32 px. (K2)
4. **Zamienić checkboxy `<div>` na `<button>` z celem 44×44** — wizualny kwadrat zostaje 24 px, ale przycisk dostaje padding. Dotyczy 6 miejsc z K3.
5. **Naprawić dolną nawigację**: zmniejszyć do 5 zakładek + „Więcej", albo dodać wyraźny gradient-cień na krawędzi + `scrollSnapType`. Dziś 1–2 zakładki są niewidoczne. (K5)
6. **Podnieść pola tekstowe do 17 px i usunąć `maximumScale: 1, userScalable: false`.** (K8)

### P1 — ważne (to buduje „uzależnienie")

7. **Dodać reakcję na dotknięcie wszędzie**: `:active { transform: scale(0.97); opacity: 0.9 }` + `navigator.vibrate(10)` na potwierdzeniach. Jedna funkcja pomocnicza, ~20 linii. (K6)
8. **Karuzela ma śledzić palec** + `touchAction: "pan-y"` + zdjąć skok wysokości (zamiast `height: 0` użyć `visibility` + stała wysokość kontenera albo `grid` z nakładającymi się polami). (K7)
9. **Przenieść główne akcje na dół** — przyklejony pasek akcji nad zakładkami na Dashboardzie, Celach, Nawykach, Diecie. (K9)
10. **Przykleić pasek „Co słychać?"** — dziś jest ~980 px od góry. (K9)
11. **Progressive disclosure**: zwinąć kartę generowania planu (gdy plan istnieje), mini-widget nawyków (5 → 1 linia), 4 z 5 wierszy bilansu w Diecie. (K11)
12. **Naprawić siatkę mentorów** — `repeat(2, 1fr)` zamiast `minmax(170px, 1fr)`. (K11)

### P2 — dopieszczenie

13. Pull-to-refresh na 5 głównych ekranach. (K10)
14. Swipe między zakładkami w `BigTabs`.
15. `tabular-nums` na wszystkich metrykach (dziś 5 wystąpień na całą apkę).
16. Kropki karuzeli jako przyciski 44×44.
17. Swipe-to-delete na wierszach zamiast mikro-koszy.
18. Dolne arkusze (bottom sheet) zamiast modali na środku ekranu; zamykanie przez pociągnięcie w dół.
19. Tryb ciemny (dziś zero — `globals.css` ma tylko jasną paletę).
20. `overscrollBehavior: "contain"` na każdym przewijanym modalu/arkuszu.

---

## Gotowe do wdrożenia

### 1. Naprawa viewportu — `src/app/layout.tsx`

```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",   // <-- DODAJ: bez tego env(safe-area-*) zwraca 0
  themeColor: "#0f172a",
  // USUŃ maximumScale i userScalable — po podniesieniu inputów do 17px
  // Safari i tak nie będzie przybliżać, a zoom zostaje dostępny (WCAG 1.4.4)
};
```

I w `src/app/(app)/layout.tsx:58`:

```tsx
<main
  style={{
    paddingTop: "env(safe-area-inset-top, 0px)",   // <-- DODAJ
    paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px))",
  }}
>
```

### 2. Tokeny — dopisać do `src/app/globals.css` (dziś ma tylko 10 zmiennych)

```css
:root {
  /* --- istniejące kolory zostają bez zmian --- */

  /* Typografia — skala oparta na iOS HIG (rozmiar Large) */
  --fs-large-title: 30px;   /* h1 strony        (dziś 24/28) */
  --fs-title:       20px;   /* h2 sekcji        (dziś 16)    */
  --fs-headline:    17px;   /* h3 karty         (dziś 14)    */
  --fs-body:        17px;   /* tekst główny     (dziś 13-14) */
  --fs-subhead:     15px;   /* tekst drugorzędny(dziś 12-13) */
  --fs-footnote:    13px;   /* etykieta pola    (dziś 11-13) */
  --fs-caption:     12px;   /* podpis  MINIMUM  (dziś 10-11) */
  --fs-metric:      40px;   /* wielka liczba    (dziś 36)    */

  --lh-tight:  1.2;
  --lh-normal: 1.35;
  --lh-read:   1.45;

  /* Cele dotykowe — 48px = Material 3; mieści też 44pt Apple */
  --tap-min:    48px;
  --tap-compact:44px;   /* absolutne minimum, tylko gęste listy */
  --tap-icon:   44px;   /* kwadratowy przycisk ikonowy */

  /* Odstępy (skala 4px) */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px;
  --sp-4: 16px; --sp-5: 20px; --sp-6: 24px; --sp-8: 32px;

  /* Zaokrąglenia */
  --r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-xl: 20px; --r-full: 9999px;

  /* Ruch */
  --ease-ios:  cubic-bezier(0.32, 0.72, 0, 1);
  --ease-out:  cubic-bezier(0.25, 1, 0.5, 1);
  --dur-tap:   120ms;
  --dur-panel: 320ms;

  /* Bezpieczne marginesy */
  --safe-top:    env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --tabbar-h:    64px;
}

/* Reakcja na dotknięcie — DZIŚ NIE MA TEGO NIGDZIE W APCE */
button, [role="button"], a {
  transition: transform var(--dur-tap) var(--ease-out),
              opacity   var(--dur-tap) var(--ease-out);
}
button:active:not(:disabled),
[role="button"]:active { transform: scale(0.97); opacity: 0.88; }

/* Liczby nie skaczą */
.num { font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

### 3. Podmiana scentralizowanych stylów — dokładne pary „przed → po"

To jest cała robota P0 punkt 3. Każdy z tych obiektów jest używany wielokrotnie, więc jedna zmiana naprawia kilkanaście miejsc.

**`src/app/(app)/admin/page.tsx:112-121` — `btnSecondary` (29 px → 48 px), używany w `:349, :570, :1570, :1581, :1584`**
```ts
// PRZED: padding: "6px 12px", fontSize: 12  → 29px
// PO:
const btnSecondary: React.CSSProperties = {
  minHeight: "var(--tap-min)",          // 48
  padding: "0 18px",
  borderRadius: "var(--r-md)",
  border: "1.5px solid var(--border)",
  background: "var(--card)",
  color: "var(--foreground)",
  fontSize: "var(--fs-subhead)",        // 15 zamiast 12
  fontWeight: 600,
  cursor: "pointer",
};
```

**`src/app/(app)/admin/page.tsx:90-99` — `btnPrimary` (37 px → 48 px), używany w `:446, :1578`**
```ts
// PRZED: padding: "10px 20px", fontSize: 14  → 37px
// PO:
const btnPrimary: React.CSSProperties = {
  minHeight: "var(--tap-min)",
  padding: "0 24px",
  borderRadius: "var(--r-md)",
  border: "none",
  background: "var(--primary)",
  color: "#fff",
  fontSize: "var(--fs-headline)",       // 17 zamiast 14
  fontWeight: 600,
  cursor: "pointer",
};
```

**`src/app/(app)/admin/page.tsx:101-110` — `btnDanger` (26 px → 44 px)**
```ts
// PRZED: padding: "6px 12px", fontSize: 12  → 26px
// PO: minHeight: "var(--tap-compact)", padding: "0 16px", fontSize: "var(--fs-subhead)"
```

**`src/app/(app)/mentors/page.tsx:61-92` — `btnPrimary`/`btnDanger`/`btnSecondary`**
Identyczne wartości jak w admin (kopia 1:1). Ta sama podmiana. Warto przy okazji wyciągnąć te trzy obiekty do jednego pliku `src/components/ui/buttons.ts` — dziś są zduplikowane w 2 plikach.

**`src/app/(app)/admin/page.tsx:63-73` + `mentors:41-51` + `diet:119-129` + `discipline/[slug]:99-109` — `inputStyle` (39 px → 52 px)**
```ts
// PRZED: padding: "10px 14px", fontSize: 14  → ~39px, i auto-zoom na iOS
// PO:
const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 52,
  padding: "0 16px",
  borderRadius: "var(--r-md)",
  border: "1.5px solid var(--border)",
  fontSize: "var(--fs-body)",           // 17 — WYŁĄCZA auto-zoom iOS
  background: "var(--background)",
  color: "var(--foreground)",
  outline: "none",
  boxSizing: "border-box",
};
```

**`src/app/(app)/goals/page.tsx:113-127` — `iconBtnStyle` (28×28 → 44×44), używany w `:1609, :1622`**
```ts
// PRZED: width: 28, height: 28, fontSize: 13
// PO:
const iconBtnStyle: React.CSSProperties = {
  width: "var(--tap-icon)",             // 44
  height: "var(--tap-icon)",            // 44
  borderRadius: "var(--r-md)",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  fontSize: 18,                          // ikona rośnie z 13 na 18
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  flexShrink: 0,
};
```

**`src/app/(app)/discipline/[slug]/page.tsx:119-139`**
```ts
// buttonPrimaryStyle  PRZED: padding "10px 16px", fontSize 14 → 37px
// PO: minHeight: "var(--tap-min)", padding: "0 20px", fontSize: "var(--fs-headline)"
// buttonSecondaryStyle PRZED: padding "8px 14px", fontSize 13 → 34px
// PO: minHeight: "var(--tap-compact)", padding: "0 18px", fontSize: "var(--fs-subhead)"
```

**`src/app/(app)/admin/page.tsx:51-61` — `pill` (33 px → 44 px)**
```ts
// PRZED: padding: "8px 18px", fontSize: 14 → 33px
// PO: minHeight: "var(--tap-compact)", padding: "0 20px", fontSize: "var(--fs-subhead)"
```

**`src/app/(app)/diet/page.tsx:97-117` — `buttonPrimary` / `buttonGhost` (37 px → 48 px)**
```ts
// PRZED: padding: "10px 14px", fontSize: 14
// PO: minHeight: "var(--tap-min)", padding: "0 20px", fontSize: "var(--fs-headline)"
```

**`src/components/ui/BigTabs.tsx:32-44` (42 px → 48 px)**
```ts
// PRZED: padding: "12px 14px", fontSize: 15 → 42px
// PO: minHeight: "var(--tap-min)", padding: "0 14px", fontSize: "var(--fs-headline)"
```

**`src/app/(app)/goals/page.tsx:2185-2220` — dwa mikro-przyciski 23 px**
Najlepiej usunąć je z wiersza i przenieść do dolnego arkusza. Jeśli mają zostać w wierszu — minimum:
```ts
// PRZED: padding: "4px 10px", fontSize: 11, gap: 4  → 23px, odstęp środków 27px
// PO:    minHeight: "var(--tap-compact)", padding: "0 14px",
//        fontSize: "var(--fs-footnote)", a kontener (:2184) gap: 8
```

### 4. Checkbox jako prawdziwy przycisk — wzorzec dla 6 miejsc z K3

```tsx
// PRZED (src/app/(app)/dashboard/page.tsx:2087) — <div onClick>, cel 22x22px
// PO — wizualnie tak samo, cel 44x44px, plus dostępność i haptyka:
<button
  type="button"
  role="checkbox"
  aria-checked={activity.completed}
  aria-label={`Odhacz: ${activity.name}`}
  disabled={toggling}
  onClick={(e) => { e.stopPropagation(); if (!toggling) { tap(); onToggle(); } }}
  style={{
    width: 44, height: 44,          // <-- cel dotykowy
    margin: -10,                    // <-- kompensacja, żeby układ się nie rozjechał
    padding: 0, border: "none", background: "none",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, cursor: toggling ? "not-allowed" : "pointer",
  }}
>
  <span style={{
    width: 26, height: 26,          // <-- kwadrat WIDOCZNY (dziś 22)
    borderRadius: 8,
    border: activity.completed ? "none" : "2px solid var(--border)",
    background: activity.completed ? "var(--success)" : "transparent",
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)",
  }}>
    {activity.completed && (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 12 10 18 20 6" />
      </svg>
    )}
  </span>
</button>
```

Miejsca do podmiany tym wzorcem: `dashboard:2087`, `dashboard:1875`, `dashboard:1302`, `habits:704`, `goals:2105`, `goals:1925`.

### 5. Haptyka — nowy plik `src/lib/haptics.ts` (dziś nie istnieje)

```ts
// Wibracja działa w PWA na Androidzie (Chrome). Na iOS Safari nie ma API —
// tam premium feeling robi animacja :active + sprężysta krzywa.
type Kind = "tap" | "success" | "warning" | "error";
const PATTERNS: Record<Kind, number | number[]> = {
  tap: 10,
  success: [12, 40, 18],
  warning: [20, 60, 20],
  error: [30, 50, 30, 50, 30],
};
export function haptic(kind: Kind = "tap") {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try { navigator.vibrate(PATTERNS[kind]); } catch { /* ignoruj */ }
}
export const tap = () => haptic("tap");
```

Gdzie wywoływać: odhaczenie zadania/nawyku (`success`), wysłanie wiadomości do mentora (`tap`), wygenerowanie planu (`success` po odpowiedzi), błąd zapisu (`error`), zmiana panelu karuzeli (`tap`).

### 6. Karuzela śledząca palec — `src/app/(app)/dashboard/page.tsx:791-820, 962-976`

```tsx
// Dodaj stan przesunięcia w trakcie ruchu:
const [dragX, setDragX] = useState(0);

const onTouchMove = useCallback((e: React.TouchEvent) => {
  const dx = e.touches[0].clientX - touchStartRef.current.x;
  const dy = e.touches[0].clientY - touchStartRef.current.y;
  if (isHorizontalSwipe.current === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
    isHorizontalSwipe.current = Math.abs(dx) > Math.abs(dy);
  }
  if (isHorizontalSwipe.current) {
    touchDeltaRef.current = dx;
    setDragX(dx);                       // <-- NOWE: panel jedzie za palcem
  }
}, []);

const onTouchEnd = useCallback(() => {
  if (isHorizontalSwipe.current && Math.abs(touchDeltaRef.current) > 50) {
    setActivePanel((p) => {
      if (touchDeltaRef.current < 0 && p < 2) { tap(); return p + 1; }
      if (touchDeltaRef.current > 0 && p > 0) { tap(); return p - 1; }
      return p;
    });
  }
  setDragX(0);                          // <-- sprężyna wraca
  touchDeltaRef.current = 0;
  isHorizontalSwipe.current = null;
}, []);
```

Kontener (`:962`) dostaje `touchAction: "pan-y"`, a przesuwany pas (`:968`):

```tsx
style={{
  display: "flex",
  transform: `translateX(calc(-${activePanel * 100}% + ${dragX}px))`,
  transition: dragX !== 0 ? "none" : "transform 320ms cubic-bezier(0.32,0.72,0,1)",
}}
```

Skok wysokości (`:978, :1465, :1479`) — zamiast `height: activePanel === N ? "auto" : 0` użyć `alignItems: "flex-start"` na pasie i na nieaktywnych panelach `maxHeight: 0; overflow: hidden` **z tą samą krzywą i czasem** co `translateX`, albo (lepiej) trzymać wszystkie panele w jednej komórce CSS Grid (`gridArea: "1 / 1"`) i przełączać `opacity` + `pointerEvents`.

### 7. Przyklejony pasek akcji — wzorzec dla Dashboardu, Celów, Nawyków, Diety

```tsx
<div
  style={{
    position: "sticky",
    bottom: "calc(var(--tabbar-h) + var(--safe-bottom) + 8px)",
    zIndex: 40,
    display: "flex",
    gap: "var(--sp-2)",
    padding: "var(--sp-2) 0",
    // delikatne rozmycie, żeby treść pod spodem nie przeszkadzała
    background: "linear-gradient(to top, var(--background) 60%, transparent)",
  }}
>
  <button style={{ ...btnPrimary, flex: 1, minHeight: "var(--tap-min)" }}>
    ⚡ Wygeneruj plan dnia
  </button>
</div>
```

### 8. Dolna nawigacja — 5 zakładek zamiast 8

```ts
// src/components/shell/BottomTabBar.tsx:15-24
// PRZED: 8 zakładek → suma ~477px w kontenerze 414px (1-2 poza kadrem)
// PO: 5 głównych + „Więcej" otwierające arkusz z resztą
const tabs: Tab[] = [
  { label: "Dziś",     icon: "🏠", path: "/dashboard" },
  { label: "Plan",     icon: "🎯", path: "/goals"     },
  { label: "Nawyki",   icon: "✅", path: "/habits"    },
  { label: "Dieta",    icon: "🍽️", path: "/diet"      },
  { label: "Więcej",   icon: "⋯",  path: "__more"     },  // arkusz: Dziennik, Debata, Mentorzy, Admin
];
// 5 × 64 + 4 × 4 = 336px — mieści się nawet na ekranie 360px
```

Jeśli 8 zakładek ma zostać — minimum: dodać `scrollSnapType: "x mandatory"` na kontenerze (`:107`), `scrollSnapAlign: "center"` na przycisku (`:170`) i gradient-cień na prawej krawędzi jako sygnał „jest więcej".

### 9. Pull-to-refresh — nowy hook `src/hooks/usePullToRefresh.ts`

```ts
"use client";
import { useEffect, useRef, useState } from "react";

export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef(0);
  const active = useRef(false);

  useEffect(() => {
    const THRESHOLD = 70;
    const onStart = (e: TouchEvent) => {
      if (window.scrollY > 0 || busy) return;
      active.current = true;
      startY.current = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (!active.current) return;
      const d = e.touches[0].clientY - startY.current;
      if (d > 0) setPull(Math.min(d * 0.5, 100));   // opór, jak w iOS
    };
    const onEnd = async () => {
      if (!active.current) return;
      active.current = false;
      if (pull > THRESHOLD) {
        setBusy(true);
        try { await onRefresh(); } finally { setBusy(false); }
      }
      setPull(0);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove",  onMove,  { passive: true });
    window.addEventListener("touchend",   onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove",  onMove);
      window.removeEventListener("touchend",   onEnd);
    };
  }, [pull, busy, onRefresh]);

  return { pull, busy };
}
```

Wpiąć w `dashboard` (`fetchDashboard`), `habits`, `goals` (`fetchData`), `diet`, `mentors`.

### 10. Progressive disclosure — konkretne warunki

```tsx
// src/app/(app)/dashboard/page.tsx:980 — karta generowania planu
// PRZED: zawsze widoczna, ~155px na górze ekranu
// PO: pełna karta tylko gdy nie ma planu; inaczej menu przy nagłówku
{totalActivities === 0 ? (
  <div style={{ ...cardStyle, marginBottom: 12 }}>{/* ...istniejąca zawartość... */}</div>
) : null}

// src/app/(app)/dashboard/page.tsx:1252 — mini-widget nawyków
// PRZED: habits.slice(0, 5) → 5 wierszy
// PO: jedna linia + rozwijanie
{habits.length > 0 && (
  <button onClick={() => setHabitsOpen(v => !v)}
          style={{ minHeight: "var(--tap-min)", width: "100%", /* ... */ }}>
    ✅ Nawyki {doneCount}/{habits.length}
    <span style={{ transform: habitsOpen ? "rotate(180deg)" : "none" }}>⌄</span>
  </button>
)}
{habitsOpen && /* lista */}

// src/app/(app)/diet/page.tsx:1937-1993 — bilans
// PRZED: 5 wierszy BreakdownRow + 3 paski makro zawsze widoczne
// PO: zostaje koło + wiersz „Pozostało"; reszta pod przełącznikiem
<BreakdownRow icon="💰" label="Pozostało" value={...} bold />
<button onClick={() => setDetailsOpen(v => !v)} style={{ minHeight: 44, /* ... */ }}>
  {detailsOpen ? "Ukryj szczegóły bilansu" : "Szczegóły bilansu"} ⌄
</button>
{detailsOpen && <>{/* BMR, Aktywności, Spalanie, Zjedzone, 3 × MacroBar, Cel dzienny */}</>}
```

---

## Ryzyka

**R1 — Podniesienie czcionek zmieni układ każdego ekranu.** Body z 13–14 na 17 px to +25% wysokości tekstu. Wszystkie miejsca z `whiteSpace: "nowrap"` + `textOverflow: "ellipsis"` zaczną ucinać wcześniej: `dashboard:1343` (nazwa nawyku), `dashboard:2143` (nazwa aktywności), `habits:751`, `diet:2304` (nazwa posiłku), `mentors:189-190`. **Jak ograniczyć:** wdrażać ekran po ekranie, zaczynając od Dashboardu; po każdym ekranie zrobić screenshot na 360 px i 430 px szerokości.

**R2 — Podniesienie przycisków do 48 px wypcha treść poniżej ekranu.** Na ekranie Diety karta „Dzisiaj" ma dziś ~10 bloków; po podniesieniu wszystkiego urośnie o ~150 px. **Dlatego progressive disclosure (P1 punkt 11) musi iść RAZEM z podniesieniem rozmiarów**, nie po nim. Inaczej odczucie „za dużo informacji" się pogorszy.

**R3 — Usunięcie `maximumScale: 1` bez podniesienia inputów = regres.** Jeśli ktoś usunie blokadę zoomu, a zostawi pola 14 px, Safari zacznie przybliżać przy każdym kliknięciu w pole i użytkownik zostanie z przesuniętym ekranem. **Te dwie zmiany muszą być w jednym commicie.**

**R4 — `viewportFit: "cover"` włączy 6 uśpionych obliczeń naraz.** Do tej pory wszystkie `env(safe-area-*)` zwracały 0. Po włączeniu nagle dojdzie kilkadziesiąt pikseli paddingu w `layout.tsx:60`, `BottomTabBar:101`, `MentorChat:256, 618`, `FollowUpSheet:59`, `InstallPrompt:56`. Na telefonach bez wcięcia nic się nie zmieni, na iPhonie 14+ zmieni się dużo. **Sprawdzić: czy dolny pasek zakładek nie robi się za wysoki i czy `InstallPrompt` nie wyjeżdża poza ekran.**

**R5 — Zmiana checkboxów `<div>` na `<button>` może zepsuć klikanie wiersza.** W `dashboard:2071` cały wiersz ma `onClick={onExpand}`, a checkbox w środku robi `e.stopPropagation()`. Przy `<button>` zagnieżdżonym w klikalnym `<div>` trzeba zachować `stopPropagation`, inaczej odhaczenie zadania **równocześnie rozwinie szczegóły**. To samo w `habits:704` i `goals:2105`.

**R6 — Ujemny margines (`margin: -10`) przy powiększonych checkboxach.** To standardowa sztuczka, żeby cel urósł bez rozjeżdżania układu, ale w kontenerach z `overflow: hidden` (np. karuzela `dashboard:966`) może przyciąć krawędź. **Sprawdzić pierwszy i ostatni wiersz każdej listy.**

**R7 — Karuzela śledząca palec wywoła przerysowania.** `setDragX` na każdym `touchmove` to ~60 renderów na sekundę **całego Dashboardu** (2609 linii, w tym `ActivityRow`, `MeetingRow`, `BriefingCard`, `WeightTracker`). Bez `React.memo` na tych komponentach może to ściąć płynność zamiast ją poprawić — czyli efekt odwrotny do zamierzonego. **Rekomendacja: zamiast `useState` sterować `transform` bezpośrednio przez `ref.current.style.transform` w `onTouchMove`** (pomija cykl Reacta), a `setState` wywołać dopiero w `onTouchEnd`.

**R8 — Redukcja zakładek z 8 na 5 ukryje funkcje przed obecnym użytkownikiem.** Właściciel zna aplikację i wie, gdzie co jest. Po zmianie Dziennik, Debata i Mentorzy trafią pod „Więcej". **Uzgodnić kolejność przed wdrożeniem** — to decyzja produktowa, nie techniczna.

**R9 — Haptyka nie zadziała na iOS.** `navigator.vibrate` nie jest wspierane w Safari. Jeśli obietnica brzmi „wibracje", na iPhonie jej nie będzie. Tam premium feeling musi zrobić animacja `:active` + sprężysta krzywa + dźwięk (jeśli w ogóle). **Nie obiecywać haptyki jako funkcji cross-platform.**

**R10 — 21 000 linii stylów inline oznacza brak jednego miejsca do zmiany.** Tokeny w `globals.css` nic nie zmienią same z siebie — trzeba je podstawić w każdym `style={{...}}`. Realistyczny plan: (1) podmienić ~20 scentralizowanych obiektów stylów wymienionych wyżej (to naprawia ~60% przypadków), (2) resztę przejść ekran po ekranie. **Nie da się tego zrobić jednym „znajdź i zamień"** — te same liczby (`fontSize: 13`) występują i w przyciskach, i w podpisach, gdzie znaczą co innego.

---

## Metodyka i ograniczenia

**Co zmierzyłem automatycznie:** skrypt Node przeszedł wszystkie 43 pliki `.tsx` w `src/`, wyciągnął 199 elementów `<button>` / `<input>` / `<select>` / `<textarea>` ze stylem inline (z rozwinięciem `...spread` i `style={stała}` w obrębie pliku) i policzył wysokość jako `padding + fontSize × lineHeight + 2 × border` (albo jawne `height` / `minHeight`). Rozkłady `fontSize`, `padding` i `lineHeight` policzone grepem po `src/`.

**Znane ograniczenia pomiaru:**
- Skrypt zaniża wysokość przycisków ułożonych w kolumnę (ikona nad etykietą) — jedyny taki przypadek to `BottomTabBar:166`, zmierzony ręcznie na ~50 px.
- Komórki z `aspectRatio` (`diet:512`) zmierzone ręcznie z arytmetyki kontenerów.
- 28 klikalnych `<div>` / `<svg>` nie wchodzi do puli 199 — opisane osobno w K3.
- Pozycje pionowe (K9) policzone z kodu, nie zmierzone w przeglądarce — to szacunek z dokładnością ±20 px.

**NIEZWERYFIKOWANE:** nie uruchamiałem aplikacji ani nie robiłem screenshotów na urządzeniu — audyt jest oparty wyłącznie na odczycie kodu. Wnioski o skoku wysokości karuzeli (K7 pkt 3) i o zachowaniu safe-area na iOS (K1) wynikają logicznie z kodu, ale wymagają potwierdzenia na fizycznym iPhonie przed wdrożeniem.
