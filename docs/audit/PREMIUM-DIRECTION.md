# PREMIUM-DIRECTION — kierunek wizualny PAPI PLANER

Data: 2026-07-25
Status: **decyzja**, nie propozycja. Ten dokument jest specyfikacją dla pozostałych agentów.
Zakres: ten dokument NIE zmienia żadnego pliku aplikacji.

Podstawa: `docs/audit/02-design-premium.md`, `docs/audit/DESIGN-SPEC.md`, realny
`src/app/globals.css` (903 linie, odczytany w całości), `src/components/ui/tokens.ts`,
`src/app/(app)/dashboard/page.tsx` (2627 linii, odczytane fragmenty strukturalne),
ikona `public/icons/icon-512.png` (obejrzana).

Wszystkie kontrasty policzone skryptem Node (WCAG 2.1), nie oszacowane. Wynik: **71 par, 0 poniżej AA**.

---

## 0. Decyzja w pięciu zdaniach

Motyw domyślny to **ciemny**. Kolorem akcentu jest **cyan / turkus** wyprowadzony wprost z obwodów
na ikonie aplikacji, z żółcią (oprawki okularów) jako kolorem ostrzeżeń. **Magenta zostaje usunięta
z palety całkowicie** — również z zaparkowanego bloku "Neon Noir" w `globals.css:209-223` i `:293-299`.
Indygo `#4f46e5` znika z obu motywów. Zmiana koloru to jednak tylko warunek wstępny: efekt "widocznej
zmiany", o który prosi właściciel, dają sekcje 5-8 tego dokumentu — hierarchia jednego bohatera na
ekranie, kaskadowe wejścia list, animowany wskaźnik zakładek, naprawiona karuzela i gest przesunięcia
na zakładkach.

**Czego ten dokument NIE robi:** nie przepisuje aplikacji, nie rusza logiki, nie usuwa stylów inline.
Zmienia wartości w jednym bloku `globals.css` i dokłada warstwę reguł układu i ruchu nad istniejącym kodem.

---

## 1. Dlaczego cyan, a nie zieleń i nie fiolet

Właściciel dopuścił trzy kolory: zieleń, jasny niebieski/cyan, fiolet. Wybieram **cyan/turkus**.

**1. To jest kolor, który już jest w marce.** Na ikonie (`public/icons/icon-512.png`) neonowe
obwody drukowane, glitch i połowa refleksów w szkłach są cyanowe. Magenta jest tam obecna, ale
właściciel ją odrzucił, a żółć zajmują oprawki okularów — czyli jeden element, nie tło. Po odjęciu
magenty **cyan jest jedynym kolorem, który buduje strukturę tej ikony**. Marka nie musi być
wymyślana, wystarczy ją rozciągnąć na wnętrze aplikacji.

**2. Cyan wygrywa na ciemnym tle z dużym zapasem.** Na najciemniejszym tle `#0B0E13` odcień
`#41DFF5` daje **12,06:1**, a na najjaśniejszej powierzchni `#28313F` nadal **8,18:1** (AAA).
Fiolet tej jasności nie osiąga: żeby fiolet dał AAA na ciemnym, musi zblednąć do lawendy i
przestaje być fioletem — to dokładnie ten problem, który ma dzisiejsze indygo `#818cf8`
(5,01:1 na `--surface-3`, ledwo AA). Cyan świeci na czerni w sposób, w jaki fiolet nie potrafi.

**3. Zieleń jest już zajęta przez znaczenie.** W tej aplikacji zieleń to "zrobione": pasek postępu
`dashboard:910` jest zielony, odhaczenia są zielone, `--success` jest zielony. Gdyby zieleń została
kolorem marki, użytkownik straciłby jedyny sygnał, który dziś czyta bez zastanowienia. Sport i
dyscyplina potrzebują pary: **cyan = ja i moja akcja**, **zieleń = wynik**. Jeden kolor nie może
robić obu rzeczy.

**4. Kategoria.** Whoop, Oura, Garmin i Apple Fitness w trybie nocnym używają zimnego niebiesko-turkusowego
akcentu na czerni, bo to czyta się jak sprzęt pomiarowy, a nie jak notatnik. Fiolet czyta się jak
aplikacja do medytacji, zieleń jak aplikacja do finansów lub eko. Ta aplikacja jest o dyscyplinie
i pomiarze.

**Ryzyko i jak je trzymam w ryzach:** cyan łatwo przesadzić — masa neonu wygląda tanio. Dlatego
sekcja 3.5 ustala twardy limit: **maksymalnie dwa elementy akcentowe w polu widzenia**, gradient
tylko na głównym CTA i na pierścieniu bohatera, długi tekst nigdy w akcencie.

---

## 2. Skala akcentu (5 odcieni) i poświata

Skala jest niezależna od motywu — to surowa rampa marki. Motywy tylko wskazują, który odcień
gdzie działa.

| Token | HEX | Rola | Kontrast na `#141922` (karta) |
|---|---|---|---|
| `--accent-100` | `#CFF9FF` | tekst na wypełnieniu akcentem, ikona na aktywnym CTA | 15,65:1 |
| `--accent-200` | `#8EEEFF` | stan aktywny/hover tekstu akcentowego, etykieta aktywnej zakładki | 13,28:1 |
| `--accent-300` | `#41DFF5` | **domyślny akcent jako TEKST i IKONA na ciemnym** | 10,99:1 |
| `--accent-400` | `#12C2DE` | **domyślne WYPEŁNIENIE**: CTA, wskaźnik, pierścień, checkbox | 8,22:1 |
| `--accent-500` | `#0A93AC` | obramowania, ciemniejszy koniec gradientu, ślady na wykresie | 4,85:1 — **nigdy jako tekst** |

Poświata i gradienty:

```css
--glow-accent:      0 0 0 1px rgba(18, 194, 222, 0.22),
                    0 10px 34px -12px rgba(18, 194, 222, 0.45);
--glow-accent-soft: 0 0 24px -8px rgba(18, 194, 222, 0.28);
--glow-accent-cta:  0 6px 20px -8px rgba(18, 194, 222, 0.55);
--grad-accent:      linear-gradient(135deg, #2BE1F5 0%, #12C2DE 45%, #2C9BF0 100%);
--grad-ring-from:   #41DFF5;   /* stop 0% pierścienia SVG   */
--grad-ring-to:     #2C9BF0;   /* stop 100% pierścienia SVG */
--hero-wash:        radial-gradient(120% 80% at 85% -20%, rgba(18,194,222,0.14), transparent 70%);
```

Etykieta na wypełnieniu akcentem: `--accent-ink: #04161A` (prawie czarny z domieszką cyanu).
Kontrast na `#12C2DE` = **8,63:1**, na ciemniejszym końcu gradientu `#2C9BF0` = **6,22:1**.
Biały tekst na cyanie daje 2,14:1 — **białego tekstu na przycisku akcentowym nie wolno użyć**.

---

## 3. Kompletne tokeny motywu ciemnego

### 3.1 Jak to wdrożyć (jedno miejsce)

`globals.css` ma już jedno źródło prawdy dla ciemnego: blok `--dark-*` w liniach **232-300**.
Oba bloki motywu (`:root[data-theme="dark"]` i `[data-theme="auto"]`) tylko mapują te nazwy na
prawdziwe tokeny. **Zmieniamy wyłącznie wartości w bloku `--dark-*` i dokładamy nowe tokeny.**
Nie ruszamy mapowań, nie ruszamy aliasów wstecznych (`--card`, `--muted`, `--foreground`,
`--card-shadow`) — one podążą same.

### 3.2 Cztery powierzchnie

Reguła z briefu: karta jest JAŚNIEJSZA od tła, różnica 4-6% jasności. Zmierzone (HSL L):

| Token | HEX | L | Δ | Do czego |
|---|---|---|---|---|
| `--dark-bg` | `#0B0E13` | 5,9% | — | tło ekranu, `body` |
| `--dark-bg-elevated` | `#10151C` | 8,6% | +2,7 | przyklejony nagłówek, dolna nawigacja (pod szkłem) |
| `--dark-surface` | `#141922` | 10,6% | +4,7 | **karta, arkusz dolny, wiersz listy** |
| `--dark-surface-2` | `#1D2430` | 15,1% | +4,5 | pole formularza, sekcja w karcie, nieaktywna zakładka |
| `--dark-surface-3` | `#28313F` | 20,2% | +5,1 | stan wciśnięcia, plakietka, kafelek w kafelku |

`--dark-overlay: rgba(4, 7, 11, 0.68)` — tło pod arkuszem dolnym i modalem.

### 3.3 Trzy poziomy tekstu

| Token | HEX | Rola | Najgorszy kontrast (na `#28313F`) |
|---|---|---|---|
| `--dark-text` | `#F2F6FA` | nagłówki, liczby-bohaterowie, nazwy zadań | **12,08:1** AAA |
| `--dark-text-2` | `#B6C2D0` | opisy, podpisy pod liczbą, treść drugiego planu | **7,25:1** AAA |
| `--dark-text-3` | `#96A1B0` | etykiety wersalikowe, godziny, jednostki, placeholdery | **5,01:1** AA |
| `--dark-text-4` | `#5C6675` | **TYLKO dekoracja** — separatory, wyłączona ikona, ślad wykresu | 3,03:1 — nigdy tekst |
| `--dark-text-inverse` | `#04161A` | tekst na wypełnieniu akcentem i na kolorach statusu | patrz 3.4 |

Reguła z briefu, egzekwowana: **nigdy trzy teksty tej samej wagi obok siebie.** Wiersz listy
ma dokładnie jeden `--text` (tytuł), jeden `--text-3` (godzina/podtytuł) i najwyżej jeden
`--text-2` (wartość po prawej).

### 3.4 Marka, statusy, obramowania, warstwy

```css
/* ---------- BRAND (accent scale, theme-independent) ---------- */
--accent-100: #CFF9FF;
--accent-200: #8EEEFF;
--accent-300: #41DFF5;
--accent-400: #12C2DE;
--accent-500: #0A93AC;
--accent-ink: #04161A;

/* ---------- DARK THEME VALUES ---------- */
--dark-bg:            #0B0E13;
--dark-bg-elevated:   #10151C;
--dark-surface:       #141922;
--dark-surface-2:     #1D2430;
--dark-surface-3:     #28313F;
--dark-overlay:       rgba(4, 7, 11, 0.68);

--dark-text:          #F2F6FA;
--dark-text-2:        #B6C2D0;
--dark-text-3:        #96A1B0;
--dark-text-4:        #5C6675;   /* DECORATIVE ONLY */
--dark-text-inverse:  #04161A;

--dark-border:        rgba(255, 255, 255, 0.07);
--dark-border-strong: rgba(255, 255, 255, 0.14);
--dark-border-accent: rgba(18, 194, 222, 0.32);

/* primary === accent in this product; both names stay so nothing breaks */
--dark-primary:            #12C2DE;   /* FILL: CTA, indicator, ring, checkbox */
--dark-primary-hover:      #2BE1F5;
--dark-primary-soft:       rgba(18, 194, 222, 0.14);
--dark-primary-text:       #04161A;   /* label ON the fill — 8.63:1 */
--dark-primary-on-surface: #41DFF5;   /* accent used as TEXT — 8.18:1 worst case */
--dark-primary-rgb:        18, 194, 222;
--dark-gradient-primary:   linear-gradient(135deg, #2BE1F5 0%, #12C2DE 45%, #2C9BF0 100%);

/* secondary data hue — charts, second series, "see all" links */
--dark-accent:            #6BA8FF;
--dark-accent-soft:       rgba(107, 168, 255, 0.14);
--dark-accent-on-surface: #6BA8FF;   /* 5.41:1 worst case */

/* yellow from the icon's glasses: emphasis, streaks, warnings */
--dark-highlight:            #FFC94A;
--dark-highlight-soft:       rgba(255, 201, 74, 0.14);
--dark-highlight-on-surface: #FFC94A;

--dark-success:            #3EE08F;
--dark-success-soft:       rgba(62, 224, 143, 0.14);
--dark-success-on-surface: #3EE08F;
--dark-success-rgb:        62, 224, 143;

--dark-warning:            #FFC94A;
--dark-warning-soft:       rgba(255, 201, 74, 0.14);
--dark-warning-on-surface: #FFC94A;

--dark-danger:            #FF6B78;
--dark-danger-soft:       rgba(255, 107, 120, 0.14);
--dark-danger-on-surface: #FF6B78;

--dark-focus-ring-color: #41DFF5;
--dark-focus-ring:       0 0 0 3px rgba(18, 194, 222, 0.45);

/* ---------- ELEVATION: lighter surface + hairline, shadow is COLOURED ---------- */
--dark-elev-0: none;
--dark-elev-1: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
--dark-elev-2: inset 0 0 0 1px rgba(255, 255, 255, 0.06),
               0 4px 16px -6px rgba(0, 0, 0, 0.60);
--dark-elev-3: inset 0 0 0 1px rgba(255, 255, 255, 0.07),
               0 14px 34px -12px rgba(0, 0, 0, 0.70),
               0 0 28px -18px rgba(18, 194, 222, 0.50);
--dark-elev-4: inset 0 0 0 1px rgba(255, 255, 255, 0.09),
               0 28px 64px -16px rgba(0, 0, 0, 0.80),
               0 0 40px -20px rgba(18, 194, 222, 0.45);
--dark-card-shadow:    var(--dark-elev-2);
--dark-card-shadow-lg: var(--dark-elev-3);

--dark-glow-primary:  0 0 0 1px rgba(18, 194, 222, 0.22),
                      0 10px 34px -12px rgba(18, 194, 222, 0.45);
--dark-glow-soft:     0 0 24px -8px rgba(18, 194, 222, 0.28);
--dark-glow-cta:      0 6px 20px -8px rgba(18, 194, 222, 0.55);
--dark-shadow-primary: var(--dark-glow-cta);
--dark-hero-wash:     radial-gradient(120% 80% at 85% -20%, rgba(18,194,222,0.14), transparent 70%);
```

**Zasada cienia z briefu, egzekwowana:** w ciemnym motywie warstwę buduje jaśniejsza powierzchnia
plus włos ramki. Czarny cień pojawia się dopiero od `--elev-2` i zawsze razem z domieszką cyanu
(`--elev-3` i wyżej). Szarego cienia bez koloru nie ma w tym motywie ani razu.

Tło `body` w motywie ciemnym (zastępuje indygowy wash z `globals.css:516-519`):

```css
background:
  radial-gradient(1100px 520px at 50% -240px, rgba(18, 194, 222, 0.10), transparent 70%),
  radial-gradient(900px 420px at 108% 12%, rgba(44, 155, 240, 0.07), transparent 65%),
  var(--background);
```

### 3.5 Reguły użycia koloru (bez nich robi się choinka)

1. **Maksymalnie dwa elementy akcentowe w polu widzenia.** Zwykle: aktywna zakładka + główne CTA.
   Jeżeli na ekranie jest pierścień bohatera w gradiencie, to on jest jednym z tych dwóch.
2. **Gradient tylko w dwóch miejscach:** główne CTA ekranu i pierścień/pasek bohatera. Nigdzie indziej.
3. **Status nie dostaje pełnego koloru.** Plakietka to `*-soft` jako tło + `*-on-surface` jako tekst
   + `1px` obramowanie w tym samym kolorze z alfą 0,30. Pełne wypełnienie rezerwujemy dla akcji.
4. **Długi tekst zawsze `--text`.** Akcentem świecimy pojedyncze słowa, liczby i ikony.
5. **Żółć = jedna rzeczy na ekran** (seria dni, ostrzeżenie). Cyan i żółć nigdy w tej samej karcie.
6. **Szkło (`backdrop-filter`) tylko dwa miejsca:** dolna nawigacja i przyklejony nagłówek.
   W ciemnym motywie `.glass` musi dostać ciemną wersję: `background: rgba(16, 21, 28, 0.72)`
   — dziś `globals.css:863-867` ma na sztywno `rgba(255,255,255,0.82)`, co w ciemnym motywie
   da biały pasek. **To jest blokada, patrz 4.2.**
7. **Emoji zostają wyłącznie jako awatary mentorów i znaczniki kategorii/nastroju.** Ikony
   interfejsu to SVG: `stroke-width: 1.75`, `stroke-linecap: round`, `stroke-linejoin: round`,
   rysunek 24 px, `currentColor`.

---

## 4. Kontrast — wszystkie pary (WCAG 2.1, policzone w Node)

Metoda: luminancja względna WCAG 2.1, skrypt uruchomiony lokalnie.
Próg: **AA = 4,5:1** dla tekstu, AAA = 7:1. Każdy token tekstowy sprawdzony na **wszystkich
czterech** powierzchniach, nie tylko na tej "typowej".

### 4.1 Motyw ciemny (domyślny)

| Kolor | HEX | na `#0B0E13` bg | na `#141922` karta | na `#1D2430` pole | na `#28313F` wciśnięte | Werdykt (najgorszy) |
|---|---|---|---|---|---|---|
| text | `#F2F6FA` | 17,80 | 16,22 | 14,35 | 12,08 | **AAA** |
| text-2 | `#B6C2D0` | 10,69 | 9,75 | 8,62 | 7,25 | **AAA** |
| text-3 | `#96A1B0` | 7,38 | 6,73 | 5,95 | 5,01 | **AA** |
| text-4 (dekoracja) | `#5C6675` | — | 3,03 | — | — | **NIE tekst** |
| accent-300 (akcent jako tekst) | `#41DFF5` | 12,06 | 10,99 | 9,72 | 8,18 | **AAA** |
| accent-200 (akcent aktywny) | `#8EEEFF` | 14,56 | 13,28 | 11,75 | 9,88 | **AAA** |
| accent-100 | `#CFF9FF` | 17,16 | 15,65 | 13,84 | 11,64 | **AAA** |
| accent-500 | `#0A93AC` | 5,32 | 4,85 | 4,29 | 3,61 | **tylko fill/ramka** |
| success | `#3EE08F` | 11,29 | 10,29 | 9,10 | 7,66 | **AAA** |
| warning / highlight | `#FFC94A` | 12,61 | 11,50 | 10,17 | 8,56 | **AAA** |
| danger | `#FF6B78` | 7,02 | 6,40 | 5,66 | 4,76 | **AA** |
| accent wtórny (dane) | `#6BA8FF` | 7,98 | 7,27 | 6,44 | 5,41 | **AA** |

Etykiety na wypełnieniach (tekst `--accent-ink #04161A`):

| Tło (wypełnienie) | HEX | Kontrast etykiety | Werdykt |
|---|---|---|---|
| CTA akcentowe | `#12C2DE` | **8,63:1** | AAA |
| gradient — początek | `#2BE1F5` | 11,62:1 | AAA |
| gradient — koniec | `#2C9BF0` | **6,22:1** | AA |
| wypełnienie success | `#3EE08F` | 10,81:1 | AAA |
| wypełnienie warning | `#FFC94A` | 12,08:1 | AAA |
| wypełnienie danger | `#FF6B78` | 6,72:1 | AA |

Wartości odrzucone w trakcie liczenia (zostawiam jako ślad, żeby nikt ich nie przywrócił):
`#7C8899` jako text-3 → 3,65:1 na `--surface-3`, **poniżej AA**;
`#FF5F6D` jako danger → 4,44:1 na `--surface-3`, **poniżej AA**;
biały tekst na `#12C2DE` → 2,14:1, **poniżej AA**.

### 4.2 Motyw jasny (bliźniak, zostaje sprawny)

Ta sama struktura tokenów, inne wartości. Indygo znika też tutaj.

| Kolor | HEX | na `#F4F6F9` bg | na `#FFFFFF` karta | na `#EDF1F6` pole | na `#E4E9F0` wciśnięte | Werdykt |
|---|---|---|---|---|---|---|
| text | `#0C1219` | 17,38 | 18,81 | 16,59 | 15,42 | **AAA** |
| text-2 | `#48545F` | 7,16 | 7,75 | 6,83 | 6,35 | **AA** |
| text-3 | `#59646F` | 5,58 | 6,04 | 5,32 | 4,95 | **AA** |
| akcent jako tekst | `#0B6A82` | 5,71 | 6,18 | 5,45 | 5,07 | **AA** |
| success jako tekst | `#04684C` | 6,28 | 6,80 | 5,99 | 5,57 | **AA** |
| warning jako tekst | `#8A5A0B` | 5,47 | 5,92 | 5,22 | 4,85 | **AA** |
| danger jako tekst | `#BC1A34` | 5,82 | 6,30 | 5,55 | 5,16 | **AA** |
| biały na wypełnieniu akcentu `#087C92` | — | — | **4,87:1** | — | — | **AA** |

Gradient CTA w motywie jasnym: `linear-gradient(135deg, #087C92 0%, #0B6A82 100%)` — biały tekst
trzyma minimum **4,87:1** na całej długości.

**Podsumowanie: 71 policzonych par, 0 poniżej AA.**

### 4.3 Włączenie ciemnego jako domyślnego — i co to blokuje

Zmiana jest jednoliniowa, bez JS i bez migotania:

```tsx
// src/app/layout.tsx — dziś linia 26: <html lang="pl">
<html lang="pl" data-theme="dark">
```
plus `themeColor: "#0B0E13"` (dziś `#0f1023`, `layout.tsx:22`) i `background_color` w `manifest.json`.

**Blokady, które muszą wejść w TYM SAMYM commicie, inaczej ekran się rozjedzie:**

| # | Co | Gdzie | Skutek bez naprawy |
|---|---|---|---|
| B1 | `.glass` ma na sztywno `rgba(255,255,255,0.82)` | `globals.css:863-867` | biały pasek nawigacji na czarnym ekranie |
| B2 | `input::placeholder` ma na sztywno `#9aa3b5` | `globals.css:546` | placeholder ciemniejszy niż tekst pola |
| B3 | scrollbar `rgba(17,19,39,0.16)` | `globals.css:559-564` | niewidoczny pasek przewijania |
| B4 | 8 × białe tło inline | `tracking/page.tsx`, `CompletionChart`, `EnergyChart`, `SleepChart`, `MoodChart`, `WeeklyCheckinForm` | białe prostokąty na wykresach |
| B5 | 16 × zaszyty ciemny kolor tekstu | te same pliki + `src/app/page.tsx` | ciemny tekst na ciemnym tle |
| B6 | `BigTabs.tsx:33-34` — `rgba(17,19,39,0.05)` jako tło paska | `src/components/ui/BigTabs.tsx` | pasek zakładek znika w tle |

`src/app/privacy-policy/page.tsx` i `src/app/terms/page.tsx` są poza powłoką aplikacji — mogą
zostać jasne, ale wtedy świadomie, z komentarzem w kodzie.

---

## 5. Reguły ekranu

To są instrukcje wykonawcze. Wszystkie wartości leżą na siatce 4 px. Kolory wyłącznie przez
`var(--token)`. Wysokość dotykowa nigdy poniżej `var(--touch-min)` = 44 px.

### 5.1 Nagłówek strony

```
padding:      24px var(--gutter) 12px   (gutter = 20px)
nadtytuł:     12px / 700 / uppercase / letter-spacing .08em / color: var(--text-3)
              margin-bottom: 6px
H1:           28px / 800 / line-height 1.15 / letter-spacing -0.02em / color: var(--text)
podtytuł:     15px / 400 / color: var(--text-2) / margin-top: 4px
```

- Pod nagłówkiem **nie ma linii**. Separuje odstęp 24 px do pierwszej karty.
- Plakietki obok nagłówka (np. typ dnia) nie stoją na gradiencie: tło `var(--surface-2)`,
  tekst `var(--text-2)`, `12px/700`, `padding: 5px 10px`, `border-radius: var(--r-full)`,
  `border: 1px solid var(--border)`.
- Wariant przyklejony (po przewinięciu > 56 px): pasek 48 px, tytuł 17px/700 wyśrodkowany,
  `background: var(--bg-elevated)`, `backdrop-filter: blur(18px) saturate(180%)`,
  `border-bottom: 1px solid var(--border)`, pojawia się `opacity` 160 ms `linear`.
- Prawy slot nagłówka (awatar, ikona) zawsze 44 × 44 px.

### 5.2 Karta metryki

Trzy wagi, świadomie różne — to jest narzędzie do budowania hierarchii.

**A. Karta-bohater (jedna na ekran)**
```
background:    var(--surface)
background-image: var(--hero-wash)          /* cyan wash w prawym górnym rogu */
border-radius: var(--r-xl)   = 28px
padding:       24px 20px
border:        1px solid var(--border)
box-shadow:    var(--elev-3)                /* zawiera domieszkę cyanu */
liczba:        44px / 800 / letter-spacing -0.03em / tabular-nums / color: var(--text)
jednostka:     20px / 700 / color: var(--text-3) / margin-left: 4px / align-self: baseline
podpis:        15px / 400 / color: var(--text-2) / margin-top: 8px
```

**B. Kafelek metryki (2-3 w rzędzie)**
```
background:    var(--surface)
border-radius: var(--r-lg)   = 20px
padding:       16px
min-height:    92px
border:        1px solid var(--border)
box-shadow:    var(--elev-1)
etykieta:      12px / 700 / uppercase / ls .06em / color: var(--text-3)
liczba:        24px / 700 / tabular-nums / color: var(--text) / margin-top: 10px
jednostka:     13px / 600 / color: var(--text-3) / margin-left: 3px
trend:         13px / 600 / color: var(--success-on-surface) lub var(--danger-on-surface)
gap w rzędzie: 12px
```

**C. Sekcja w karcie (inset)**
```
background: var(--surface-2); border-radius: var(--r-md) = 14px; padding: 12px 14px;
box-shadow: none; border: none;
```

Reguły twarde:
- **Liczba jest bohaterem**: zawsze `font-variant-numeric: tabular-nums`, jednostka mniejsza
  i w `--text-3`. Nigdy "2570 kcal" jednym rozmiarem.
- Kolor liczby jest neutralny (`--text`). Kolor semantyczny dostaje **tylko** liczba, która
  przekroczyła próg (bilans ujemny, brak snu).
- Wartość pusta to `—` w `--text-3`, nigdy `--` ani `0`.

### 5.3 Wiersz listy

```
min-height:    56px
padding:       8px 12px
border-radius: var(--r-md) = 14px
background:    transparent
gap między wierszami: 4px          /* separacja odstępem, ZERO linii */
:active        background: var(--surface-2)   (90 ms linear)

slot wiodący:  44 × 44 px (rysunek ikony/checkboxa 24-26 px, wycentrowany)
kolumna czasu: szerokość stała 48px, 13px / 600 / tabular-nums / color: var(--text-3)
tytuł:         17px / 600 / color: var(--text) / line-height 1.30
podtytuł:      13px / 500 / color: var(--text-3) / margin-top: 2px
slot końcowy:  15px / 600 / tabular-nums / color: var(--text-2)
               albo szewron 20px, stroke 1.75, color: var(--text-3)
```

- **Cały wiersz jest klikalny.** Element w slocie wiodącym z własną akcją robi `e.stopPropagation()`.
- Stan odhaczony: tytuł → `--text-3` + `text-decoration: line-through`, cały wiersz `opacity: .72`,
  przejście 220 ms `--ease-out`. Wiersz **nie znika** i **nie zmienia wysokości**.
- Nagłówek sekcji listy (RANO / POPOŁUDNIE / WIECZÓR): `12px/700 uppercase ls .08em`,
  `color: var(--text-3)`, `padding: 20px 12px 8px`, `position: sticky`, `top: 48px`,
  tło `var(--bg)` z `backdrop-filter: blur(12px)`.
- Grupy przedziela 24 px, nie linia.

### 5.4 Formularz

```
etykieta:      13px / 600 / color: var(--text-2) / margin-bottom: 6px
pole:          min-height 52px; font-size 17px (twardo — poniżej 16px iOS przybliża stronę)
               padding: 0 16px; border-radius: var(--r-md);
               background: var(--surface-2); border: 1.5px solid var(--border);
               color: var(--text)
placeholder:   color: var(--text-3)          /* 5,95:1 na polu — AA */
:focus         border-color: var(--accent-400);
               box-shadow: 0 0 0 3px rgba(18,194,222,0.28);
               przejście 140 ms var(--ease-out)
błąd:          border-color: var(--danger); komunikat 13px/500 var(--danger-on-surface), 6px pod polem
textarea:      min-height 96px; padding 14px 16px; line-height 1.45
odstęp pól:    16px w grupie, 24px między grupami
```

- Główna akcja formularza siedzi w **przyklejonym pasku** na dole:
  `position: sticky; bottom: var(--above-tabbar);` tło
  `linear-gradient(to top, var(--bg) 62%, transparent)`, `padding: 12px var(--gutter)`.
- Przycisk główny: pełna szerokość, 56 px, `var(--grad-accent)`, tekst `var(--accent-ink)`
  17px/700, `box-shadow: var(--glow-accent-cta)`.
- Przycisk drugorzędny nigdy nie stoi obok głównego w tym samym kolorze — jest `ghost`
  (przezroczysty, tekst `--accent-300`).
- Akcja destrukcyjna **nie stoi obok głównej**. Idzie do arkusza dolnego z potwierdzeniem.

### 5.5 Pusty stan

```
wyrównanie:  do środka, padding 40px 24px
ikona:       koło 56px, background: var(--surface-2), wewnątrz SVG 26px stroke 1.75
             color: var(--accent-300); box-shadow: var(--glow-accent-soft)
tytuł:       17px / 700 / color: var(--text) / margin-top: 16px
opis:        15px / 400 / color: var(--text-2) / max-width: 280px / line-height 1.45 / margin-top: 6px
akcja:       jeden przycisk 48px, wariant primary, margin-top: 20px
wejście:     fade-scale 260 ms var(--ease-out)
```
Zasada: **ikona + jedno zdanie + jedna akcja.** Pusty stan bez akcji jest błędem.

### 5.6 Arkusz dolny

```
tło pod:      var(--overlay) + backdrop-filter: blur(2px); pojawia się 200 ms linear
panel:        background: var(--surface); border-radius: var(--r-xl) var(--r-xl) 0 0;
              border-top: 1px solid var(--border-strong);
              box-shadow: var(--elev-4)
uchwyt:       36 × 4 px, border-radius 2px, background: rgba(255,255,255,0.18),
              margin: 8px auto 4px
tytuł:        22px / 700 / ls -0.015em / padding: 8px 20px 12px
treść:        padding: 0 20px; klasa .papi-scroll; overscroll-behavior: contain
stopka:       position: sticky; bottom: 0;
              padding: 12px 20px calc(12px + var(--safe-b));
              background: linear-gradient(to top, var(--surface) 70%, transparent)
wejście:      transform: translateY(100%) -> 0, 320 ms cubic-bezier(0.32, 0.72, 0, 1)
wyjście:      240 ms cubic-bezier(0.4, 0, 1, 1)
zamknięcie:   pociągnięcie w dół > 96 px albo prędkość > 0.5 px/ms
```
Arkusz zastępuje modal wyśrodkowany z krzyżykiem w prawym górnym rogu — na telefonie 6"
ten róg jest poza zasięgiem kciuka.

### 5.7 Przycisk

| Wariant | Tło | Tekst | Ramka | Cień |
|---|---|---|---|---|
| primary | `var(--grad-accent)` | `var(--accent-ink)` | brak | `var(--glow-accent-cta)` |
| secondary | `var(--surface-2)` | `var(--text)` | `1px var(--border)` | brak |
| ghost | przezroczyste | `var(--accent-300)` | brak | brak |
| danger | `var(--danger-soft)` | `var(--danger-on-surface)` | `1px rgba(255,107,120,0.35)` | brak |

Rozmiary: `sm` 44 px / 15px-600, `md` 48 px / 15px-700, `lg` 56 px / 17px-700.
Promień `var(--r-md)` = 14 px. `disabled`: `opacity .45`, bez cienia, bez haptyki.
Stan `loading`: spinner w środku, **szerokość przycisku się nie zmienia**.

### 5.8 Zakładki (segmented)

```
kontener:  height 48px; padding 4px; border-radius 16px;
           background: var(--surface-2); border: 1px solid var(--border);
           position: relative
wskaźnik:  element absolutny pod etykietami; height 40px; border-radius 12px;
           background: var(--surface); box-shadow: var(--glow-accent-soft),
           inset 0 0 0 1px var(--dark-border-accent);
           przesuwa się transform: translateX(), 280 ms cubic-bezier(0.32, 0.72, 0, 1)
etykieta:  15px / 600; nieaktywna color: var(--text-3); aktywna color: var(--accent-200), waga 700
           przejście koloru 140 ms linear
```
Wskaźnik jest osobnym elementem i **jedzie**, nie przeskakuje. To jest jedna z trzech rzeczy,
które właściciel zobaczy od razu.

---

## 6. Animacje — dokładne czasy i krzywe

Krzywe (nazwy już istnieją w `globals.css:106-109`):

| Nazwa | Wartość | Do czego |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.25, 1, 0.5, 1)` | wejście treści, wypełnienia |
| `--ease-ios` | `cubic-bezier(0.32, 0.72, 0, 1)` | panele, arkusze, karuzela, wskaźnik zakładek |
| `--ease-spring` | `cubic-bezier(0.34, 1.4, 0.64, 1)` | powrót po wciśnięciu, odhaczenie |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | wciśnięcie, ruchy techniczne |

| Zdarzenie | Właściwość | Czas | Krzywa | Szczegóły |
|---|---|---|---|---|
| **Wejście ekranu** | `opacity` 0→1, `translateY(8px)`→0 | 340 ms | `--ease-out` | jedna animacja na kontener strony, nie na każdy element |
| **Kaskada listy** | `opacity` 0→1, `translateY(10px)`→0 | 320 ms każdy | `--ease-out` | `animation-delay: calc(var(--i) * 40ms)`, **maks. 8 pozycji** (potem 0 ms), `animation-fill-mode: both` |
| **Wciśnięcie** | `transform: scale(.97)` | 60 ms | `--ease-standard` | karty `.press-lg` → `.985` |
| **Powrót po wciśnięciu** | `transform: scale(1)` | 260 ms | `--ease-spring` | już działa globalnie (`globals.css:585-621`) |
| **Odhaczenie — pudełko** | `scale` 1 → .86 → 1.06 → 1 | 280 ms | `--ease-spring` | ramka **zawsze 2px**, zmienia się tylko kolor (inaczej sąsiedzi przeskoczą o 2 px) |
| **Odhaczenie — ptaszek** | `stroke-dashoffset` len→0 | 200 ms | `--ease-out` | `animation-delay: 60ms`, `stroke-linecap: round` |
| **Odhaczenie — wiersz** | `opacity` 1→.72, `color` | 220 ms | `--ease-out` | haptyka `haptic.success()` **przed** zapytaniem do API |
| **Przełączenie zakładki — wskaźnik** | `transform: translateX` | 280 ms | `--ease-ios` | |
| **Przełączenie zakładki — etykieta** | `color`, `font-weight` | 140 ms | `linear` | |
| **Przełączenie zakładki — treść** | `translateX` + `opacity` | 320 ms | `--ease-ios` | wychodzący panel `opacity` 1→0 w 120 ms |
| **Otwarcie arkusza** | `translateY(100%)`→0 | 320 ms | `--ease-ios` | tło `opacity` 200 ms `linear` |
| **Zamknięcie arkusza** | `translateY`→100% | 240 ms | `cubic-bezier(0.4, 0, 1, 1)` | |
| **Zmiana liczby** | licznik `rAF` | 600 ms | `--ease-out` | krok co klatkę, `tabular-nums`, **bez** zmiany szerokości; wartości < 10 zmieniają się natychmiast |
| **Wypełnienie pierścienia** | `stroke-dashoffset` | 900 ms | `--ease-out` | `animation-delay: 120ms`, tylko przy pierwszym wejściu na ekran |
| **Wypełnienie paska** | `transform: scaleX`, `transform-origin: left` | 720 ms | `--ease-out` | **nigdy `width`** |
| **Pojawienie plakietki** | `scale(.92)`→1 + `opacity` | 220 ms | `--ease-spring` | |
| **Rozwinięcie szczegółów** | `opacity` + `translateY(-6px)` | 220 ms | `--ease-out` | klasa `.reveal`, **nigdy `max-height`** |
| **Skeleton** | `background-position` | 1400 ms w pętli | `linear` | szerokości **stałe**, nigdy `Math.random()` |

Wolno animować: `transform`, `opacity`, `stroke-dashoffset`, `background-color`, `color`,
`border-color`. Nie wolno: `height`, `max-height`, `width`, `top/left`, `box-shadow`, `filter`
na dużych obszarach, `transition: all`.

**Jedyny udokumentowany wyjątek:** wysokość kontenera karuzeli (sekcja 8.2). Jeden element,
jedno przejście 320 ms na gest. Wpisany świadomie, bo alternatywy są gorsze.

Wszystko powyżej jest wyłączane przez istniejący blok `prefers-reduced-motion`
(`globals.css:885-904`) — nie dopisujemy do niego nic nowego, ale każda nowa animacja musi być
zdefiniowana jako `animation` albo `transition`, żeby ten blok ją złapał. Animacja pisana z JS
w `requestAnimationFrame` (licznik liczby) musi sama sprawdzić
`window.matchMedia("(prefers-reduced-motion: reduce)").matches` i ustawić wartość końcową od razu.

---

## 7. Redesign dashboardu

### 7.1 Co jest dziś i dlaczego nie działa

Kolejność na ekranie (`dashboard/page.tsx:872-1583`):
nagłówek 26 px → pasek postępu 8 px → `BigTabs` (3 zakładki) → karuzela z trzema panelami
→ pasek wprowadzania.

Cztery problemy, każdy sprawdzony w kodzie:

1. **Nie ma bohatera.** Najważniejsza liczba dnia (procent ukończenia) jest schowana w trzecim
   panelu karuzeli (`:1519`, 36 px), czyli za dwoma przesunięciami palca. Na pierwszym ekranie
   reprezentuje ją pasek 8 px i podpis "5/8" w 12 px (`:916`).
2. **Narzędzie stoi przed treścią.** Pierwsza karta panelu "Plan dnia" to "Wygeneruj plan dnia"
   z dwoma przyciskami (`:996-1039`). Użytkownik, który ma już plan, widzi ją codziennie bez potrzeby.
3. **Panel "Statystyki" ma sześć poziomów ważności w jednym pudełku** (`:1496-1582`): trzy
   `StatItem`, liczba 36 px, liczba 24 px, trzy wiersze po 13 px, `WeightTracker` i przycisk.
   Oko nie ma się gdzie zaczepić.
4. **Karuzela zjada dwie trzecie ekranu i bywa niesterowna** — diagnoza i naprawa w sekcji 8.

### 7.2 Nowy układ (kolejność od góry)

```
┌──────────────────────────────────────────────┐
│ 1. NAGŁÓWEK                                  │  ~96 px
│    PIĄTEK, 25 LIPCA          [typ dnia]      │  12px/700 uppercase, text-3
│    Dzień dobry, Paweł                        │  28px/800, text
├──────────────────────────────────────────────┤
│ 2. BOHATER — PIERŚCIEŃ DNIA   (card-hero)    │  ~280 px
│                                              │
│              ╭─────────╮                     │  pierścień 172px, stroke 12
│              │   62 %  │                     │  liczba 44px/800 + "%" 20px/700 text-3
│              ╰─────────╯                     │  gradient --grad-ring-from -> to
│           5 z 8 zadań zrobione               │  15px/400, text-2
│  ──────────────────────────────────────      │  1px var(--border), margin 16px 0 12px
│  ● TERAZ  Trening siłowy · 17:30        ›    │  wiersz 44px: kropka cyan 8px,
│                                              │  etykieta 12px/700 text-3, tytuł 17px/600
├──────────────────────────────────────────────┤
│ 3. TRZY KAFELKI                              │  92 px
│  ┌────────┐ ┌────────┐ ┌────────┐            │  gap 12px
│  │ENERGIA │ │  SEN   │ │SPALONE │            │  etykieta 12px/700 uppercase text-3
│  │  7/10  │ │  6,5 h │ │ 1240   │            │  liczba 24px/700 tabular
│  └────────┘ └────────┘ └────────┘            │  jednostka 13px/600 text-3
├──────────────────────────────────────────────┤
│ 4. ZAKŁADKI (przesuwalne palcem)             │  48 px
│  [ Plan dnia ][ Briefing ][ Statystyki ]     │  wskaźnik jedzie 280 ms
├──────────────────────────────────────────────┤
│ 5. TREŚĆ ZAKŁADKI                            │  zmienna
│    RANO                                      │  sticky, 12px/700 uppercase text-3
│    07:00  ● Poranna rutyna              ✓    │  wiersz 56px
│    08:30  ○ Przegląd celów                   │
│    POPOŁUDNIE                                │
│    ...                                       │
├──────────────────────────────────────────────┤
│ 6. AKCJA POMOCNICZA (ghost, na dole listy)   │  48 px
│    Przegeneruj plan dnia                     │
└──────────────────────────────────────────────┘
   pasek wprowadzania (bez zmian funkcjonalnych)
```

### 7.3 Co dokładnie się zmienia

**1. Bohater wchodzi na górę, karuzela przestaje go chować.**
Pierścień dnia i trzy kafelki są **zawsze widoczne**, niezależnie od aktywnej zakładki.
Zakładki przełączają tylko szczegóły. Dzięki temu procent dnia przestaje być schowany w panelu 3
(`:1519`) i staje się pierwszą rzeczą, którą widać z odległości ręki.

Karta bohatera: `var(--surface)` + `var(--hero-wash)`, `--r-xl`, padding 24/20, `--elev-3`.
Pierścień: SVG 172 px, `stroke-width: 12`, ścieżka tła `rgba(255,255,255,0.06)`, ścieżka postępu
`linearGradient` od `--grad-ring-from` do `--grad-ring-to`, `stroke-linecap: round`,
wypełnienie animowane `stroke-dashoffset` 900 ms `--ease-out`. Liczba w środku liczona
animowanym licznikiem 600 ms. Pod pierścieniem jedno zdanie w `--text-2`.

**2. Pasek postępu 8 px (`:902-920`) znika.** Zastępuje go pierścień. Dwa wskaźniki tego samego
zjawiska na jednym ekranie to definicja braku hierarchii.

**3. Wiersz "TERAZ" pod pierścieniem** — najbliższa nieskończona aktywność. Kropka
`--accent-400` 8 px z `--glow-accent-soft`, etykieta "TERAZ" 12px/700 uppercase `--text-3`,
tytuł 17px/600, godzina `--text-3`, szewron po prawej. Kliknięcie przewija do wiersza na liście.
Gdy nic nie zostało: "Dzień zamknięty" + ikona.

**4. Trzy kafelki zamiast panelu Statystyki.** Energia, Sen, Spalone — te trzy, bo są liczbami
dnia. Nastrój przenosi się do pierścienia jako mała emoji-plakietka w prawym górnym rogu karty
bohatera (emoji jest tu treścią, nie ikoną systemową, więc zostaje).
Kafelek jest klikalny (44 px minimum) i otwiera arkusz dolny z pełnym rozbiciem.

**5. Panel "Statystyki" po odchudzeniu** zawiera tylko to, czego nie ma wyżej:
bento 2 × 2 (BMR / TDEE / Spalone dziś / Bilans), pod spodem `WeightTracker` jako osobna karta,
na końcu wiersz-link "Zobacz pełny tracking" w wariancie `ghost`, 48 px.
Trzy wiersze BMR po 13 px (`:1548-1561`) przestają być listą tekstową i stają się kafelkami.

**6. "Wygeneruj plan dnia" schodzi na dół.**
- Plan istnieje → jeden przycisk `ghost` 48 px "Przegeneruj plan dnia" na końcu listy.
- Planu nie ma → `EmptyState` na środku panelu: ikona kalendarza w kole 56 px, tytuł
  "Nie masz jeszcze planu na dziś", zdanie w `--text-2`, jeden przycisk primary
  "Wygeneruj automatycznie" i pod nim jeden `ghost` "Zaplanuj z mentorem".
Dwa duże przyciski na gradiencie na samej górze ekranu (`:1001-1039`) znikają.

**7. Rytm ekranu.** Odstęp między sekcjami 24 px, między kartami 12 px, margines boczny 20 px
(dziś 16 px, `:873`). Sekcja 2 i 3 to jedna grupa (odstęp 12 px), do zakładek 24 px.

**8. Kaskada przy wejściu.** Karta bohatera, trzy kafelki i pierwszych 8 wierszy listy wchodzą
kaskadowo: `translateY(10px)` + `opacity`, 320 ms, opóźnienie `index * 40 ms`. Ekran się składa,
nie wyskakuje gotowy. To druga rzecz, którą właściciel zobaczy od razu.

**9. Kolor na dashboardzie — audyt limitu.** Elementy akcentowe: pierścień (gradient) i wskaźnik
aktywnej zakładki. To są te dwa dozwolone. Zieleń pojawia się wyłącznie na odhaczonych wierszach,
żółć wyłącznie przy serii dni. Kalorie przestają być czerwone na czerwonym tle
(`:1528-1531`) — czerwień zostaje dla błędów.

---

## 8. Karuzela i zakładki przesuwane palcem

To jest skarga numer jeden właściciela ("muszę trzy, cztery razy przerzucać albo w ogóle nie działa").
Diagnoza z kodu, nie z domysłu.

### 8.1 Dlaczego dziś nie działa

`dashboard/page.tsx:805-834` i `:978-995`:

1. **Brak `onTouchCancel`.** Na iOS, gdy przeglądarka przejmie gest na przewijanie strony,
   `touchend` **nie przychodzi** — przychodzi `touchcancel`. Dziś nikt go nie obsługuje, więc
   `isHorizontalSwipe.current` i `touchDeltaRef.current` zostają z poprzedniego gestu i psują
   następny. **To jest przyczyna "czasem w ogóle nie działa".**
2. **Brak `touch-action: pan-y`** na kontenerze (`:982`). Przeglądarka może zacząć własne
   przewijanie w poziomie/pionie zanim kod zdąży rozpoznać oś.
3. **Palec niczego nie ciągnie.** `touchDeltaRef` jest tylko zapisywany (`:820`), nigdy nie trafia
   do `transform`. Panel stoi nieruchomo aż do puszczenia palca, więc użytkownik nie ma
   informacji zwrotnej i nie wie, czy gest "złapał".
4. **Próg 50 px bez prędkości** (`:825`). Szybkie, krótkie machnięcie kciukiem (typowe: 30-40 px)
   jest ignorowane. Stąd "muszę przerzucać trzy razy".
5. **`height: activePanel === N ? "auto" : 0`** (`:994`, `:1481`, `:1495`). Panel docelowy ma
   wysokość 0 przez cały czas przesuwania i dostaje "auto" natychmiast — treść skacze, strona
   zmienia długość w trakcie ruchu.
6. **React montuje `touchmove` jako pasywny**, więc `preventDefault()` z handlera Reacta nie działa.
   Potrzebny natywny listener z `{ passive: false }`.

### 8.2 Specyfikacja naprawy

Nowy hook `src/hooks/useSwipeDeck.ts`, używany i przez karuzelę, i przez zakładki:

```ts
interface SwipeDeckOptions {
  count: number;
  index: number;
  onIndexChange: (next: number) => void;
  /** minimum fraction of container width to commit a swipe */
  distanceRatio?: number;   // default 0.20
  /** px per ms; a fast flick commits even below distanceRatio */
  velocity?: number;        // default 0.35
}
```

Wymagania implementacyjne (wszystkie obowiązkowe):

1. Kontener: `touch-action: pan-y`. Gest w pionie zostaje przy stronie, w poziomie przy talii.
2. Listenery `touchmove` montowane przez `useEffect` + `addEventListener(..., { passive: false })`.
   Po zablokowaniu osi na poziomą wołamy `e.preventDefault()`.
3. Blokada osi: pierwsze przesunięcie > 8 px decyduje. `Math.abs(dx) > Math.abs(dy) * 1.2`
   — wymóg przewagi 1,2× eliminuje przypadkowe przełączenia przy przewijaniu w pionie.
4. **Palec ciągnie treść**: `ref.current.style.transform = translate3d(...)` bezpośrednio,
   **nigdy przez `setState`** (dashboard ma 2627 linii i zero `React.memo` — 60 setState na
   sekundę przerysuje wszystko).
5. Opór na krawędziach: przy skrajnym panelu przesunięcie mnożone przez 0,35 (gumka).
6. Zatwierdzenie: `Math.abs(dx) > 0.20 * szerokość` **albo** `prędkość > 0.35 px/ms`.
   Prędkość liczona z ostatnich 100 ms, nie z całego gestu.
7. `onTouchCancel` **i** `onTouchEnd` czyszczą stan i uruchamiają dojazd (`--ease-ios`, 320 ms).
8. Wysokość kontenera: mierzona `ResizeObserver` na aktywnym panelu, ustawiana na kontenerze
   i animowana `height 320ms var(--ease-ios)`. Panele nieaktywne zostają w DOM z
   `visibility: hidden; pointer-events: none`, **bez `height: 0`**.
   To jedyny dozwolony wyjątek od zakazu animowania wysokości: jeden element, jedno przejście
   na gest. Bez niego przy zmianie panelu strona skacze.
9. Haptyka `haptic.selection()` w momencie zatwierdzenia gestu, nie po dojeździe animacji.
10. Dostępność: `role="tabpanel"`, `aria-hidden` na nieaktywnych, obsługa strzałek lewo/prawo
    gdy zakładka ma focus.

### 8.3 Zakładki przesuwane palcem — wszędzie

Właściciel prosi wprost: "chcę przesuwać palcem także zakładki (Cele/Plany, Dzisiaj/Kalendarz)".
`BigTabs` (`src/components/ui/BigTabs.tsx`) dostaje:

```ts
interface BigTabsProps<T extends string = string> {
  tabs: ReadonlyArray<BigTab<T>>;
  active: T;
  onChange: (key: T) => void;
  /** when true, the content deck below is driven by the same gesture */
  swipeable?: boolean;
  style?: React.CSSProperties;
}
```

Zakładki i treść korzystają z **jednej** instancji `useSwipeDeck` (indeks jest wspólny), więc
przesunięcie treści przesuwa też wskaźnik zakładki — proporcjonalnie, w trakcie gestu, nie po nim.
Miejsca do podpięcia: dashboard (Plan/Briefing/Statystyki), Cele (Cele/Plany), Dieta,
Tracking, panele `pill` w Adminie.

Sam pasek `BigTabs` do przebudowy zgodnie z 5.8: wskaźnik jako osobny element z `translateX`
zamiast dzisiejszej zmiany `background` i `boxShadow` na przycisku (`BigTabs.tsx:56-67`),
plus tła z tokenów zamiast `rgba(17,19,39,0.05)` (`:33-34`).

---

## 9. Czego nie robić

1. **Nie przemalowywać samych kolorów i nie ogłaszać gotowego.** Właściciel powiedział wprost,
   że zmiana kolorów to nie jest design. Sekcje 5-8 są obowiązkowe.
2. **Nie włączać ciemnego motywu przed naprawą blokad B1-B6** (sekcja 4.3). Najpierw `.glass`,
   placeholder, scrollbar, `BigTabs` i wykresy trackingu, potem `data-theme="dark"`.
3. **Nie zostawiać magenty nigdzie**, także w zaparkowanym bloku "Neon Noir"
   (`globals.css:209-223`, `:293-299`) i w `--brand-gradient` w `tokens.ts:68`.
   Zaparkowana paleta jest myląca — wykasować albo przepiąć na cyan.
4. **Nie używać białego tekstu na akcencie** (2,14:1). Etykieta na cyanie to `--accent-ink`.
5. **Nie używać `--accent-500` jako koloru tekstu** (3,61:1 na `--surface-3`). To jest kolor
   ramek i wypełnień.
6. **Nie robić więcej niż dwóch elementów akcentowych w polu widzenia.**
7. **Nie animować wysokości** poza jednym wyjątkiem z 8.2 punkt 8.
8. **Nie przenosić stanu gestu do `useState`.** Bezpośrednio `ref.current.style.transform`.
9. **Nie usuwać aliasów wstecznych** (`--card`, `--muted`, `--foreground`, `--card-shadow`,
   `--primary-light`) — grep w `src/` pokazuje 287 użyć samego `--muted`.
10. **Nie zamieniać emoji na SVG tam, gdzie emoji jest treścią**: awatary mentorów, nastrój,
    pory dnia. Zamieniamy tylko tam, gdzie emoji udaje ikonę systemową.

---

## 10. Kolejność wdrożenia dla pozostałych agentów

| Etap | Co | Efekt widoczny dla właściciela |
|---|---|---|
| 1 | Blokady B1-B6 (sekcja 4.3) | żaden — przygotowanie |
| 2 | Nowe wartości `--dark-*` + skala akcentu + `data-theme="dark"` | aplikacja jest ciemna i cyanowa |
| 3 | `useSwipeDeck` + naprawa karuzeli + `BigTabs` przesuwalne | karuzela reaguje na palec za pierwszym razem |
| 4 | Redesign dashboardu (sekcja 7) | ekran główny ma bohatera i rytm |
| 5 | Kaskady wejścia, licznik liczb, animacja pierścienia (sekcja 6) | ekran się składa, liczby dojeżdżają |
| 6 | Reguły ekranu (5.1-5.8) na pozostałych ekranach | spójność całości |

---

## 11. Czego nie zweryfikowałem

- Nie uruchamiałem aplikacji ani nie robiłem zrzutów na urządzeniu. Kontrasty policzyłem
  skryptem Node z wartości HEX (WCAG 2.1) — to jest twarda arytmetyka. Wrażenie
  "premium" i czytelność cyanu na realnym ekranie OLED w słońcu wymagają obejrzenia na telefonie.
- Nie sprawdzałem, jak `data-theme="dark"` zachowa się przy `statusBarStyle: "black-translucent"`
  na fizycznym iPhonie — logicznie powinno być lepiej niż dziś, ale to wymaga potwierdzenia.
- Nie mierzyłem kosztu animowania wysokości kontenera karuzeli (8.2 punkt 8) na realnym telefonie.
  Jeżeli okaże się szarpane, planem B jest stała wysokość kontenera równa najwyższemu panelowi
  z własnym przewijaniem wewnątrz.
- Liczby wystąpień w kodzie (8 × białe tło, 16 × zaszyty ciemny tekst, 9 plików) pochodzą
  z grepa uruchomionego 2026-07-25 na aktualnym drzewie.

**NIEZWERYFIKOWANE:** wygląd całości na urządzeniu — ten dokument jest specyfikacją, nie wdrożeniem.
Żaden plik aplikacji nie został zmieniony.

---

Ścieżka dokumentu:
`C:\Users\Paweł Pieloch\CLAUDE CODE\Aplikacja Papi 2.0\papicoach\docs\audit\PREMIUM-DIRECTION.md`
