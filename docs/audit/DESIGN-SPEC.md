# DESIGN-SPEC: system designu PAPI PLANER

Data: 2026-07-25
Podstawa: audyty 01-05 w `docs/audit/` + weryfikacja w realnym kodzie
Status: specyfikacja do wdrożenia. Ten dokument NIE zmienia żadnego pliku aplikacji.

Wszystko poniżej jest decyzją, nie propozycją. Gdzie audyty się nie zgadzały, rozstrzygnąłem
i zapisałem uzasadnienie w sekcji 1.

---

## 0. Punkt wyjścia (fakty, sprawdzone w kodzie)

| Co | Stan dziś | Dowód |
|---|---|---|
| Tokeny CSS | 10 zmiennych, same kolory | `src/app/globals.css:3-14` (odczytane, 64 linie całości) |
| Skala typografii | brak | tamże |
| Skala odstępów / promieni / cieni | brak; w kodzie 15 różnych `borderRadius`, 17 różnych `boxShadow` | audyt 02 K3 |
| Tryb ciemny | brak, zero `prefers-color-scheme` | audyt 02 K4 |
| Definicja karty | 9 osobnych kopii `const cardStyle` | grep potwierdzony: `dashboard:193`, `diet:90`, `goals:106`, `habits:52`, `journal:43`, `discipline/[slug]:83`, `BriefingCard:317`, `WeeklyCheckinForm:196`, `WeightTracker:19` |
| Reakcja na dotknięcie | brak (`:active` = 0 wystąpień) | audyty 01 K6, 02 K5, 04 K6 |
| Haptyka | brak (`navigator.vibrate` = 0) | j.w. |
| Cele dotykowe | 188 z 199 elementów poniżej 44 px | audyt 01 K2 |
| Rozmiar tekstu | 65% deklaracji ≤ 13 px | audyt 01 K4 |
| Safe area | 6 miejsc liczy, wszystkie zwracają 0 (brak `viewportFit`) | `src/app/layout.tsx:17-23` (odczytane) |
| Ikona marki | cyberpunk: szara twarz, żółte oprawki, magenta + cyan glitch | `public/icons/icon-192.png` (obejrzana) |
| Kolor w aplikacji | `--primary: #1d4ed8` (domyślny niebieski Tailwind) | `src/app/globals.css:8` |

---

## 1. Rozstrzygnięcia konfliktów między audytami

To jest najważniejsza sekcja tego dokumentu. Audyty w kilku miejscach mówiły co innego.

| # | Konflikt | Audyt A | Audyt B | **Decyzja** | Uzasadnienie |
|---|---|---|---|---|---|
| 1 | Rozmiar `h1` | 01: 30 px | 02: 28 px | **28 px** | 30 to arytmetyczny środek między 24 a 28 z kodu, nic za nim nie stoi. 28 to iOS Title 1, realna norma. |
| 2 | Minimalny cel dotykowy | 01: 48 px domyślnie (Material), 44 minimum | 02: 44 minimum, 48 kontrolka, 56 wiersz/CTA | **Trzy poziomy: 44 podłoga, 48 domyślny przycisk, 56 CTA i wiersz listy** | 48 wszędzie wypycha treść poniżej ekranu (ryzyko R2 audytu 01). Trzy poziomy dają kontrolę. 44 jest twardą podłogą, poniżej nie schodzimy nigdy. |
| 3 | Skala promieni | 01: 8/12/16/20 | 02: 6/10/14/20/28 | **02** | Bardziej zróżnicowana, karta 20 px czyta się drożej niż 16. Zgodna z językiem iOS 17+. |
| 4 | Czas wciśnięcia | 01: 120 ms | 02: 140 ms | 04: 60 ms w dół, 260 ms powrót | **04** | Wciśnięcie musi być natychmiastowe (60 ms), powrót sprężysty (260 ms). Symetryczne 120/140 ms czyta się jako opóźnienie, czyli dokładnie ten problem, który naprawiamy. |
| 5 | Krzywa panelu | 01: `cubic-bezier(0.32,0.72,0,1)` | 02: `cubic-bezier(0.16,1,0.30,1)` | **Obie, do różnych zastosowań** | `0.32,0.72,0,1` to realna krzywa arkuszy iOS: panele, arkusze, karuzela. `0.16,1,0.30,1` do wejść treści. |
| 6 | Blokada zoomu | 01, 02: usunąć `maximumScale:1` | 05: zostawić | **Usunąć** | Po podniesieniu pól do 17 px Safari i tak nie przybliża. Blokada łamie WCAG 1.4.4 i jest wyłapywana przy audytach sklepów. Warunek twardy: ta zmiana wchodzi w JEDNYM commicie z podniesieniem pól, inaczej regres (ryzyko R3 audytu 01). |
| 7 | Karuzela Dashboardu | 02: zamienić na pionowe sekcje | 01, 04, 05: naprawić (śledzenie palca) | **Naprawić, nie usuwać** | Trzy powody: (a) właściciel używa jej codziennie, zmiana nawigacji to decyzja produktowa, nie designerska (sam audyt 02 to przyznaje w ryzyku 9); (b) usunięcie karuzeli robi z Dashboardu bardzo długą stronę, co pogłębia zarzut "za dużo informacji"; (c) naprawa kosztuje mniej. Osobno: progressive disclosure WEWNĄTRZ panelu "Plan dnia". |
| 8 | Śledzenie palca: `useState` czy `ref` | 04 G9: `setDragX` przez `useState` | 01 R7: bezpośrednio `ref.current.style.transform` | **`ref`** | `setDragX` przy 60 zdarzeniach na sekundę przerysowuje cały Dashboard (2609 linii, brak `React.memo` w całej aplikacji). Efekt byłby odwrotny do zamierzonego. |
| 9 | Tryb ciemny | 02: P0 | 01: P2 (punkt 19) | **Tokeny obu trybów: P0. Włączenie ciemnego: P1, po sprzątaniu kolorów** | Napisanie obu palet od razu kosztuje zero dodatkowego czasu. Ale włączenie przełącznika przed usunięciem 7 zaszytych `#fff` i 16 zaszytych ciemnych tekstów pokaże białe prostokąty na wykresach `/tracking` i biały tekst na białym tle w `WeeklyCheckinForm`. Kolejność jest obowiązkowa. |
| 10 | Service worker: strategia danych | 04 G5: `stale-while-revalidate` dla całego `/api` | 05: network-first + lista dozwolonych ścieżek + ekran offline + `PAPI_CLEAR_DATA` | **05** | SWR pokazuje wczorajsze kalorie zanim wskoczą nowe. W aplikacji zdrowotnej to czyta się jako zgubiony wpis. Do tego lista dozwolonych ścieżek chroni `/api/admin/*` przed wylądowaniem w cache na cudzym telefonie. |
| 11 | Prefetch zakładek | 05: od razu przy montowaniu | 04 G3: `setTimeout` 1200 ms | **1200 ms + prefetch na `onPointerDown`** | Prefetch 7 tras natychmiast konkuruje o pasmo z pierwszym ekranem. |
| 12 | Emoji jako ikony | 02: zamienić na wektory (P1) | pozostałe: nie podnoszą | **P1 tylko nawigacja dolna, P2 przyciski akcji** | Zamiana wszystkich emoji to duża robota. Nawigacja jest widoczna zawsze i to tam emoji najbardziej psuje wrażenie (plus znikają hacki `filter: brightness(0) invert(1)` z `UniversalInputBar:275` i `BottomTabBar:158`). Emoji zostają tam, gdzie są treścią wybraną przez człowieka: awatary mentorów, nastrój, pory dnia. |
| 13 | Liczba zakładek | 01, 02: 5 + "Więcej" | 05: nie podnosi | **5 + "Więcej", ale za zgodą właściciela** | Arytmetyka jest bezsporna: 7 widocznych zakładek × 64 px + 6 × 4 px = 472 px w kontenerze 414 px (`BottomTabBar.tsx:111-114,179` odczytane). Ale to zmiana nawigacji, nie stylu: Dziennik, Debata i Mentorzy znikną z pierwszego planu. Punkt decyzyjny, nie techniczny. |

---

## 2. Kierunek wizualny: JEDNA rekomendacja

### "Neon Noir": ciemna baza, neon wyłącznie jako sygnał

Wybieram kierunek wyprowadzony wprost z ikony aplikacji. Obejrzałem `public/icons/icon-192.png`:
portret w skali szarości, żółte oprawki okularów, w szkłach i w glitchu magenta oraz cyan.
To jest jedyny element tego produktu, który dziś wygląda drogo. Wnętrze aplikacji to domyślny
niebieski Tailwind `#1d4ed8` (`globals.css:8`), czyli kolor, którego użytkownik nie skojarzy z niczym.

**Dlaczego ten, a nie inny:**

1. Ikona już istnieje i jest mocna. Marka ma jedno miejsce, w którym jest, i trzeba je rozciągnąć na resztę, a nie budować drugą tożsamość obok.
2. Ciemne tło z jednym neonowym akcentem to język, który użytkownik zna z Whoop, Strava, Oura, Apple Fitness. W kategorii "osobista transformacja" czyta się jako sprzęt sportowy, nie jak arkusz kalkulacyjny.
3. Aplikacja jest używana wieczorem. Ciemny tryb to realna wygoda, nie moda.
4. Odrzucam wariant "poprawiony slate z indygo", bo to jest dokładnie wygląd domyślnego szablonu, czyli to, na co właściciel narzeka.

**Kolejność wdrożenia jest odwrotna do intuicji:** ship najpierw TRYB JASNY w nowej palecie
(magenta zamiast niebieskiego), ciemny włączamy w etapie 4, po usunięciu zaszytych kolorów.
Powód w rozstrzygnięciu 9 wyżej.

### Paleta z policzonym kontrastem

Kontrast policzony skryptem Node (WCAG 2.1, wzór na luminancję względną), nie oszacowany.

**Tryb jasny**

| Rola | HEX | Kontrast | Werdykt |
|---|---|---|---|
| Tło | `#F6F6F8` | - | - |
| Powierzchnia (karta) | `#FFFFFF` | - | - |
| Tekst główny | `#101018` na `#F6F6F8` | **17,54:1** | AAA |
| Tekst 2 | `#4A4A58` na `#FFFFFF` | **8,71:1** | AAA |
| Tekst 3 (podpisy) | `#71717F` na `#FFFFFF` | **4,80:1** | AA |
| Primary (magenta) | `#C4006E` na `#FFFFFF` | **5,88:1** | AA |
| Biały tekst na primary | `#FFFFFF` na `#C4006E` | **5,88:1** | AA |
| Accent (cyan) | `#0E7490` na `#FFFFFF` | **5,36:1** | AA |
| Highlight (żółć) | `#B45309` na `#FFFFFF` | **5,02:1** | AA |
| Sukces | `#047857` na `#FFFFFF` | **5,48:1** | AA |
| Błąd | `#C81E3A` na `#FFFFFF` | **5,67:1** | AA |

> Uwaga: audyt 02 proponował sukces `#0E9F6E`. Policzyłem: **3,39:1 na białym, czyli poniżej AA
> dla tekstu**. Podmieniam na `#047857`. To jedyna zmiana wartości względem palety z audytu 02.

**Tryb ciemny**

| Rola | HEX | Kontrast | Werdykt |
|---|---|---|---|
| Tło | `#0A0A0F` | - | - |
| Powierzchnia | `#15151C` | - | - |
| Tekst główny | `#F4F4F7` na `#0A0A0F` | **17,99:1** | AAA |
| Tekst 2 | `#B4B4C2` na `#15151C` | **8,87:1** | AAA |
| Tekst 3 | `#82828F` na `#15151C` | **4,79:1** | AA |
| Primary (magenta) | `#FF2D95` na `#15151C` | **5,24:1** | AA |
| Tekst na primary | `#12000A` na `#FF2D95` | **5,88:1** | AA |
| Accent (cyan) | `#22D3EE` na `#15151C` | **10,05:1** | AAA |
| Highlight | `#FFC800` na `#15151C` | **11,69:1** | AAA |
| Sukces | `#2EE6A8` na `#15151C` | **11,25:1** | AAA |
| Błąd | `#FF4D5E` na `#15151C` | **5,60:1** | AA |

### Reguły użycia koloru (bez nich to się zamieni w choinkę)

1. **Magenta = akcja i tożsamość.** Maksymalnie **jeden** element magenta w polu widzenia. Aktywna zakładka ALBO główne CTA ALBO pierścień dnia. Nigdy trzy naraz.
2. **Cyan = dane i linki.** Wykresy, paski postępu, "zobacz wszystkie".
3. **Żółć = ostrzeżenie i podkreślenie.** Jedna rzecz na ekran.
4. **Neon nigdy pod dłuższy tekst.** Treść zawsze `--text`.
5. **Status nie dostaje pełnego koloru.** Plakietka "Plan dostępny" (`goals:1586-1602`) ma tło `--primary-soft` i tekst `--primary`, nie pełną magentę. Pełny kolor rezerwujemy dla akcji.
6. **Jeden dozwolony gradient w całej aplikacji:** `linear-gradient(160deg, #FF2D95 0%, #7B2BFF 100%)`, wyłącznie na pierścieniu hero i na przycisku instalacji. Zero gradientów tęczowych.
7. **Szkło (blur) tylko w dwóch miejscach:** dolna nawigacja i przyklejony pasek akcji. Nigdzie indziej, żeby nie zrobić aplikacji z 2013 roku.

---

## 3. Blok tokenów: gotowy do wklejenia w `src/app/globals.css`

Zastępuje obecny blok `:root` (linie 3-14) i `body` (16-21). Reszta pliku (`@keyframes spin`,
`pulse`, `checkmark`, `fadeIn`, linie 27-63) zostaje bez zmian, bo jest używana w kodzie.

```css
@import "tailwindcss";

/* ============================================================
   PAPI PLANER: system tokenów
   Kierunek: Neon Noir. Tryb jasny i ciemny to bliźniaki:
   te same nazwy tokenów, inne wartości.
   ============================================================ */

:root {
  color-scheme: light dark;

  /* ---------- TYPOGRAFIA ----------
     Skala z iOS HIG (rozmiar Large). Kolumny: rozmiar / waga / interlinia / światło */
  --font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI",
             Roboto, system-ui, sans-serif;

  --fs-display:  44px; --fw-display:  800; --lh-display:  1.02; --ls-display:  -0.03em;
  --fs-metric:   32px; --fw-metric:   700; --lh-metric:   1.05; --ls-metric:   -0.02em;
  --fs-title1:   28px; --fw-title1:   700; --lh-title1:   1.15; --ls-title1:   -0.02em;
  --fs-title2:   22px; --fw-title2:   700; --lh-title2:   1.20; --ls-title2:   -0.015em;
  --fs-title3:   17px; --fw-title3:   600; --lh-title3:   1.30; --ls-title3:   -0.01em;
  --fs-body:     17px; --fw-body:     400; --lh-body:     1.45; --ls-body:      0;
  --fs-callout:  15px; --fw-callout:  400; --lh-callout:  1.40; --ls-callout:   0;
  --fs-footnote: 13px; --fw-footnote: 500; --lh-footnote: 1.35; --ls-footnote:  0;
  --fs-label:    12px; --fw-label:    700; --lh-label:    1.20; --ls-label:     0.06em;
  /* PODŁOGA: 12px. Poniżej nie schodzimy nigdzie, nigdy. */

  /* ---------- ODSTĘPY (siatka 4 px) ---------- */
  --sp-1: 4px;   --sp-2: 8px;   --sp-3: 12px;  --sp-4: 16px;
  --sp-5: 20px;  --sp-6: 24px;  --sp-8: 32px;  --sp-10: 40px;
  --sp-12: 48px; --sp-16: 64px;

  --gutter: 20px;        /* margines boczny każdego ekranu */
  --stack-tight: 8px;    /* odstęp w grupie */
  --stack: 12px;         /* odstęp między kartami */
  --stack-loose: 24px;   /* odstęp między sekcjami */

  /* ---------- PROMIENIE ---------- */
  --r-xs: 6px;     /* znaczniki, kropki */
  --r-sm: 10px;    /* pola, małe przyciski, skeletony */
  --r-md: 14px;    /* przyciski, wiersze list */
  --r-lg: 20px;    /* karty */
  --r-xl: 28px;    /* hero, arkusze dolne */
  --r-full: 999px;

  /* ---------- ROZMIARY KONTROLEK ---------- */
  --tap-min: 44px;   /* TWARDA PODŁOGA. Nic klikalnego poniżej. */
  --ctrl-sm: 36px;   /* tylko ikona WEWNĄTRZ większego celu dotykowego */
  --ctrl-md: 48px;   /* domyślny przycisk */
  --ctrl-lg: 56px;   /* główne CTA i wiersz listy */
  --hairline: 1px;

  /* ---------- RUCH ---------- */
  --dur-press-in:  60ms;   /* wciśnięcie: natychmiast */
  --dur-press-out: 260ms;  /* powrót: sprężyna */
  --dur-instant:   90ms;   /* zmiana koloru */
  --dur-fast:     140ms;   /* hover, drobne stany */
  --dur-base:     220ms;   /* rozwijanie, checkbox */
  --dur-slow:     320ms;   /* arkusz, panel karuzeli */
  --dur-celebrate:520ms;   /* wypełnienie postępu, sukces */

  --ease-out:      cubic-bezier(0.16, 1, 0.30, 1);   /* wejście treści */
  --ease-ios:      cubic-bezier(0.32, 0.72, 0, 1);   /* panele, arkusze, karuzela */
  --ease-spring:   cubic-bezier(0.34, 1.56, 0.64, 1);/* checkbox, plakietka, powrót po wciśnięciu */
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);       /* domyślna */

  /* ---------- EKRAN: bezpieczne obszary ---------- */
  --safe-t: env(safe-area-inset-top, 0px);
  --safe-b: env(safe-area-inset-bottom, 0px);
  --safe-l: env(safe-area-inset-left, 0px);
  --safe-r: env(safe-area-inset-right, 0px);
  --tabbar-h: 64px;
  /* JEDYNA wartość, której wolno używać elementom przyklejonym nad paskiem zakładek.
     Zastępuje 7 sztywnych bottom: 80 / bottom: 90 w kodzie. */
  --above-tabbar: calc(var(--tabbar-h) + var(--safe-b) + 12px);

  /* ---------- KOLORY: TRYB JASNY ---------- */
  --bg:            #F6F6F8;
  --bg-elevated:   #FFFFFF;
  --surface:       #FFFFFF;
  --surface-2:     #F1F1F5;
  --surface-3:     #E7E7EE;
  --overlay:       rgba(12, 12, 18, 0.45);

  --text:          #101018;
  --text-2:        #4A4A58;
  --text-3:        #71717F;
  --text-inverse:  #FFFFFF;

  --border:        #E3E3EA;
  --border-strong: #C9C9D4;

  --primary:       #C4006E;
  --primary-hover: #A80060;
  --primary-soft:  rgba(196, 0, 110, 0.10);
  --primary-text:  #FFFFFF;

  --accent:        #0E7490;
  --accent-soft:   rgba(14, 116, 144, 0.10);

  --highlight:     #B45309;
  --highlight-soft:rgba(180, 83, 9, 0.12);

  --success:       #047857;
  --success-soft:  rgba(4, 120, 87, 0.12);
  --warning:       #B45309;
  --warning-soft:  rgba(180, 83, 9, 0.12);
  --danger:        #C81E3A;
  --danger-soft:   rgba(200, 30, 58, 0.10);

  --focus-ring:    0 0 0 3px rgba(196, 0, 110, 0.35);

  /* ---------- WARSTWY ---------- */
  --elev-0: none;
  --elev-1: 0 1px 2px rgba(16,16,24,0.06), 0 1px 1px rgba(16,16,24,0.04);
  --elev-2: 0 2px 6px rgba(16,16,24,0.07), 0 1px 2px rgba(16,16,24,0.05);
  --elev-3: 0 10px 24px rgba(16,16,24,0.10), 0 2px 6px rgba(16,16,24,0.06);
  --elev-4: 0 24px 60px rgba(16,16,24,0.18), 0 6px 16px rgba(16,16,24,0.08);
  --glow-primary: 0 6px 24px rgba(196, 0, 110, 0.28);
}

/* ============ TRYB CIEMNY ============
   UWAGA: nie włączać, dopóki nie zostaną usunięte zaszyte kolory
   (7 x background:"#fff", 16 x ciemny color). Lista w ROADMAP, etap 4. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0A0A0F;  --bg-elevated: #121218;  --surface: #15151C;
    --surface-2: #1D1D26;  --surface-3: #262631;  --overlay: rgba(0,0,0,0.62);
    --text: #F4F4F7;  --text-2: #B4B4C2;  --text-3: #82828F;  --text-inverse: #0A0A0F;
    --border: rgba(255,255,255,0.09);  --border-strong: rgba(255,255,255,0.18);
    --primary: #FF2D95;  --primary-hover: #FF57A9;
    --primary-soft: rgba(255,45,149,0.14);  --primary-text: #12000A;
    --accent: #22D3EE;  --accent-soft: rgba(34,211,238,0.14);
    --highlight: #FFC800;  --highlight-soft: rgba(255,200,0,0.14);
    --success: #2EE6A8;  --success-soft: rgba(46,230,168,0.14);
    --warning: #FFC800;  --warning-soft: rgba(255,200,0,0.14);
    --danger: #FF4D5E;  --danger-soft: rgba(255,77,94,0.14);
    --focus-ring: 0 0 0 3px rgba(255,45,149,0.45);
    /* w ciemnym warstwę buduje jaśniejsza powierzchnia i włos ramki, nie cień */
    --elev-1: inset 0 0 0 1px rgba(255,255,255,0.05);
    --elev-2: inset 0 0 0 1px rgba(255,255,255,0.07), 0 2px 8px rgba(0,0,0,0.45);
    --elev-3: inset 0 0 0 1px rgba(255,255,255,0.08), 0 12px 28px rgba(0,0,0,0.55);
    --elev-4: inset 0 0 0 1px rgba(255,255,255,0.10), 0 28px 64px rgba(0,0,0,0.65);
    --glow-primary: 0 8px 32px rgba(255,45,149,0.35);
  }
}

/* ręczny przełącznik: <html data-theme="dark"> ustawiany z Admin > Ustawienia */
:root[data-theme="dark"] {
  --bg: #0A0A0F;  --bg-elevated: #121218;  --surface: #15151C;
  --surface-2: #1D1D26;  --surface-3: #262631;  --overlay: rgba(0,0,0,0.62);
  --text: #F4F4F7;  --text-2: #B4B4C2;  --text-3: #82828F;  --text-inverse: #0A0A0F;
  --border: rgba(255,255,255,0.09);  --border-strong: rgba(255,255,255,0.18);
  --primary: #FF2D95;  --primary-hover: #FF57A9;
  --primary-soft: rgba(255,45,149,0.14);  --primary-text: #12000A;
  --accent: #22D3EE;  --accent-soft: rgba(34,211,238,0.14);
  --highlight: #FFC800;  --highlight-soft: rgba(255,200,0,0.14);
  --success: #2EE6A8;  --success-soft: rgba(46,230,168,0.14);
  --warning: #FFC800;  --warning-soft: rgba(255,200,0,0.14);
  --danger: #FF4D5E;  --danger-soft: rgba(255,77,94,0.14);
  --focus-ring: 0 0 0 3px rgba(255,45,149,0.45);
  --elev-1: inset 0 0 0 1px rgba(255,255,255,0.05);
  --elev-2: inset 0 0 0 1px rgba(255,255,255,0.07), 0 2px 8px rgba(0,0,0,0.45);
  --elev-3: inset 0 0 0 1px rgba(255,255,255,0.08), 0 12px 28px rgba(0,0,0,0.55);
  --elev-4: inset 0 0 0 1px rgba(255,255,255,0.10), 0 28px 64px rgba(0,0,0,0.65);
  --glow-primary: 0 8px 32px rgba(255,45,149,0.35);
}

/* ============ ZGODNOŚĆ WSTECZNA (OBOWIĄZKOWA) ============
   W kodzie jest ok. 20 wystąpień var(--card-shadow) i dziesiątki
   var(--card), var(--muted), var(--foreground), var(--background).
   Bez tych aliasów pierwszy commit z tokenami rozbiera pół aplikacji. */
:root {
  --background:  var(--bg);
  --card:        var(--surface);
  --foreground:  var(--text);
  --muted:       var(--text-3);
  --card-shadow: var(--elev-1);
}

/* ============ BAZA ============ */
html {
  -webkit-text-size-adjust: 100%;
}

body {
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  overscroll-behavior-y: none;  /* zabija pull-to-refresh przeglądarki w PWA */
  overflow-x: hidden;
}

* { -webkit-tap-highlight-color: transparent; }

/* ============ REAKCJA NA DOTKNIĘCIE ============
   To jest pojedyncza zmiana o największym efekcie na odczucie "to jest apka".
   Działa globalnie, bez ruszania ani jednego komponentu. */
button, [role="button"], .papi-tap {
  touch-action: manipulation;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  transition: transform var(--dur-press-out) var(--ease-spring),
              background-color var(--dur-instant) linear;
}
button:active:not(:disabled),
[role="button"]:active,
.papi-tap:active {
  transform: scale(0.97);
  transition: transform var(--dur-press-in) var(--ease-standard);
}
/* duże karty kurczą się mniej, inaczej wygląda to tanio */
.press-lg:active { transform: scale(0.985); }

/* ============ TYPOGRAFIA: klasy ról ============
   Dzięki nim migracja jest mechaniczna: fontSize: 13 -> className="t-footnote".
   Nie wymyślamy wartości przy każdym wierszu. */
.t-display  { font: var(--fw-display)  var(--fs-display)/var(--lh-display)   var(--font-ui);
              letter-spacing: var(--ls-display);  font-variant-numeric: tabular-nums; }
.t-metric   { font: var(--fw-metric)   var(--fs-metric)/var(--lh-metric)     var(--font-ui);
              letter-spacing: var(--ls-metric);   font-variant-numeric: tabular-nums; }
.t-title1   { font: var(--fw-title1)   var(--fs-title1)/var(--lh-title1)     var(--font-ui);
              letter-spacing: var(--ls-title1); }
.t-title2   { font: var(--fw-title2)   var(--fs-title2)/var(--lh-title2)     var(--font-ui);
              letter-spacing: var(--ls-title2); }
.t-title3   { font: var(--fw-title3)   var(--fs-title3)/var(--lh-title3)     var(--font-ui);
              letter-spacing: var(--ls-title3); }
.t-body     { font: var(--fw-body)     var(--fs-body)/var(--lh-body)         var(--font-ui); }
.t-body-b   { font: 600                var(--fs-body)/var(--lh-body)         var(--font-ui); }
.t-callout  { font: var(--fw-callout)  var(--fs-callout)/var(--lh-callout)   var(--font-ui);
              color: var(--text-2); }
.t-footnote { font: var(--fw-footnote) var(--fs-footnote)/var(--lh-footnote) var(--font-ui);
              color: var(--text-3); }
.t-label    { font: var(--fw-label)    var(--fs-label)/var(--lh-label)       var(--font-ui);
              letter-spacing: var(--ls-label); text-transform: uppercase; color: var(--text-3); }

/* liczby nie skaczą przy zmianie wartości (dziś tabular-nums jest 5 razy w całej apce) */
.num, [data-num] { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }

/* ============ PRZEWIJANIE ============ */
.papi-scroll {
  overflow-y: auto;
  overscroll-behavior: contain;  /* scroll nie przecieka na stronę pod spodem */
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.papi-scroll::-webkit-scrollbar { display: none; }

/* ============ FOCUS (klawiatura, dostępność) ============ */
:where(button, a, input, textarea, select, [tabindex]):focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--r-sm);
}

/* ============ SKELETON z połyskiem ============
   Zastępuje 35 wystąpień pulsującego szarego prostokąta. */
@keyframes shimmer { to { background-position-x: -200%; } }
.skeleton {
  border-radius: var(--r-sm);
  background: linear-gradient(90deg,
    var(--surface-2) 0%, var(--surface-3) 40%, var(--surface-2) 80%);
  background-size: 200% 100%;
  animation: shimmer 1.4s var(--ease-standard) infinite;
}

/* ============ WEJŚCIE TREŚCI ============
   Zastępuje @keyframes expandIn na max-height (dashboard:1829-1832),
   które animuje układ strony w każdej klatce i urywa się przy treści > 200px. */
@keyframes revealIn {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.reveal { animation: revealIn var(--dur-base) var(--ease-out); }

/* ============ SZANUJ USTAWIENIA UŻYTKOWNIKA ============ */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## 4. Reguły twarde

Te reguły są sprawdzalne. Jeśli któraś jest złamana, zmiana nie przechodzi.

### 4.1 Cel dotykowy

| Reguła | Wartość | Wyjątek |
|---|---|---|
| Minimalna wysokość i szerokość czegokolwiek klikalnego | **44 × 44 px** | brak |
| Domyślny przycisk | 48 px wysokości | brak |
| Główne CTA ekranu i wiersz listy | 56 px | brak |
| Ikona wewnątrz celu | 24 px rysunku, ale cel 44 px | technika: `width:44;height:44;margin:-10` wokół `<span>` 24 px |
| Minimalny odstęp między sąsiednimi celami | **8 px** | dziś `goals:2184` ma `gap: 4` przy celach 23 px, czyli środki dzieli 27 px przy opuszce palca 45-57 px |
| Każdy element klikalny to `<button>` lub `<a>` | zawsze | dziś w kodzie jest **28 klikalnych `<div>` i `<svg>`** |

### 4.2 Tekst

| Reguła | Wartość |
|---|---|
| Podłoga rozmiaru w całej aplikacji | **12 px** (`--fs-label`), i tylko dla wersalikowych etykiet |
| Tekst czytany (nazwa aktywności, nazwa nawyku, treść) | **17 px** (`--fs-body`) |
| Pole tekstowe (`input`, `textarea`, `select`) | **17 px, bez wyjątków.** Poniżej 16 px Safari na iOS przybliża stronę |
| Interlinia dla bloków tekstu | min. 1,35; dla body 1,45 |
| Każda metryka i licznik | `font-variant-numeric: tabular-nums` |
| 10 px i 11 px | **usunięte z kodu całkowicie** |

### 4.3 Siatka odstępów

- Wszystko jest wielokrotnością **4 px**. Wartości spoza skali (`padding: 7`, `gap: 5`, `marginTop: 3`) są błędem.
- Margines boczny ekranu: **20 px** (`--gutter`). Dziś jest 16 px na Dashboardzie i 12 px w Diecie.
- Odstęp wewnątrz grupy: 8 px. Między kartami: 12 px. Między sekcjami: 24 px.
- Padding karty: 16 px (zwykła), 24/20 px (hero).

### 4.4 Ruch

| Sytuacja | Właściwość | Czas | Krzywa |
|---|---|---|---|
| Wciśnięcie | `transform: scale` | 60 ms | `--ease-standard` |
| Powrót po wciśnięciu | `transform: scale` | 260 ms | `--ease-spring` |
| Zmiana koloru / stanu | `background-color`, `color` | 90 ms | `linear` |
| Checkbox, plakietka | `transform: scale` | 220 ms | `--ease-spring` |
| Rozwinięcie szczegółów | `opacity` + `translateY(-6px)` | 220 ms | `--ease-out` |
| Panel karuzeli, arkusz dolny | `transform: translateX/Y` | 320 ms | `--ease-ios` |
| Wypełnienie postępu / pierścienia | `transform: scaleX`, `stroke-dashoffset` | 520 ms | `--ease-out` |

**Wolno animować wyłącznie `transform` i `opacity`** (plus `stroke-dashoffset` na SVG).

**Nie wolno animować nigdy:** `height`, `max-height`, `width`, `top`, `left`, `box-shadow`,
`filter` na dużych obszarach, ani skrótu `transition: all`.

Miejsca w kodzie łamiące tę regułę dziś (do naprawy, dowody z audytu 04):
`dashboard:1829-1832` (`max-height`), `dashboard:896` (`width` paska postępu),
`dashboard:1579-1583` (`width` kropek), `dashboard:1317/1902/2103` (`transition: all` + zmiana
`border-width`, przez co ptaszek przesuwa sąsiadów o 2 px), `diet:382`, `habits:301`,
`MoodChart:95`, `BriefingCard:305`, `FileUpload:199`, plus 11 miejsc z `transition: all`.

### 4.5 Hierarchia: jedna liczba na ekran

Każdy ekran ma **dokładnie jednego bohatera**: jedną liczbę w rozmiarze `--fs-display` (44 px)
albo `--fs-metric` (32 px). Wszystko inne schodzi minimum dwa poziomy niżej.

| Ekran | Bohater | Co schodzi niżej |
|---|---|---|
| Dashboard | procent dnia w pierścieniu, `t-display` | pasek 6 px znika, statystyki idą do bento 2×2 po `t-metric` |
| Dieta | kalorie w pierścieniu, `t-display` (dziś 36 px, `diet:259`) | 5 wierszy `BreakdownRow` po 13 px chowa się pod "Szczegóły bilansu" |
| Cele (karta) | procent celu, `t-metric` obok tytułu | dziś procent jest **najmniejszym tekstem w karcie**: 11 px w pierścieniu 40 px (`goals:1483-1519`) |
| Nawyki | seria dni, `t-metric` | lista `.row` |
| Dziennik | liczba wpisów w tygodniu, `t-metric` | lista |

---

## 5. Prymitywy do zbudowania

Katalog: `src/components/ui/`. Każdy prymityw to komponent kliencki ze stylami inline
sięgającymi po `var(--...)`, żeby nie przepisywać 21 000 linii naraz.

Kolejność budowy = kolejność w tabeli. Pierwsze pięć odblokowuje 80% migracji.

| # | Plik | Co daje |
|---|---|---|
| 1 | `Pressable.tsx` | fundament dotyku: skala, haptyka, `touch-action` |
| 2 | `Button.tsx` | zastępuje 8 zduplikowanych obiektów stylów przycisków |
| 3 | `Card.tsx` | zastępuje 9 kopii `cardStyle` |
| 4 | `ListRow.tsx` | zastępuje wiersze list na 5 ekranach |
| 5 | `Checkbox.tsx` | najczęstsza akcja w aplikacji, dziś 20-24 px `<div>` |
| 6 | `Input.tsx` / `Textarea.tsx` | zastępuje 4 kopie `inputStyle`, wyłącza auto-zoom iOS |
| 7 | `Sheet.tsx` | zastępuje 11 modali `position: fixed` bez blokady scrolla |
| 8 | `Tabs.tsx` | zastępuje `BigTabs` i `pill` z admina |
| 9 | `Stat.tsx` | hierarchia metryk |
| 10 | `ProgressBar.tsx` / `Ring.tsx` | animacja na `transform`, nie na `width` |
| 11 | `IconButton.tsx` | zastępuje `iconBtnStyle` 28×28 |
| 12 | `Skeleton.tsx` | zastępuje 35 pulsujących prostokątów |
| 13 | `EmptyState.tsx` | 36 komunikatów "Brak ..." bez akcji |
| 14 | `StickyActionBar.tsx` | przeniesienie głównych akcji w zasięg kciuka |
| 15 | `Segmented.tsx` | wybór 2-3 opcji (typ posiłku, filtr) |

Plus dwa moduły poza `ui/`:
- `src/lib/haptics.ts` (nowy)
- `src/hooks/useScrollLock.ts` (nowy)
- `src/hooks/usePullToRefresh.ts` (nowy, etap 6)

### 5.1 Pressable

```ts
interface PressableProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;        // 500 ms, z haptyką "longPress"
  disabled?: boolean;
  /** "sm" = scale 0.97 (przyciski), "lg" = 0.985 (karty) */
  press?: "sm" | "lg" | "none";
  haptic?: HapticKind | false;     // domyślnie "press"
  as?: "button" | "div";           // domyślnie "button"
  ariaLabel?: string;
  style?: React.CSSProperties;
}
```
Zasada: **wibruje i kurczy się w momencie dotknięcia, nie po odpowiedzi serwera.**

### 5.2 Button

```ts
interface ButtonProps {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";  // domyślnie "primary"
  size?: "sm" | "md" | "lg";                                // 44 / 48 / 56
  fullWidth?: boolean;
  loading?: boolean;        // spinner w środku, szerokość się NIE zmienia
  disabled?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  onPress: () => void;
  haptic?: HapticKind | false;   // domyślnie "press", przy sukcesie wołamy osobno
  type?: "button" | "submit";
}
```

| Wariant | Tło | Tekst | Ramka | Cień |
|---|---|---|---|---|
| primary | `--primary` | `--primary-text` | brak | `--glow-primary` |
| secondary | `--surface-2` | `--text` | `1px --border` | brak |
| ghost | przezroczyste | `--primary` | brak | brak |
| danger | `--danger-soft` | `--danger` | `1px --danger` | brak |

Rozmiary: `sm` = 44 px / `--fs-footnote`; `md` = 48 px / `--fs-callout`; `lg` = 56 px / `--fs-body`.
`disabled`: `opacity: 0.45`, `cursor: not-allowed`, bez cienia, bez haptyki.

**Danger nigdy nie stoi obok primary.** Akcja destrukcyjna idzie do arkusza dolnego z potwierdzeniem.

### 5.3 Card

```ts
interface CardProps {
  children: React.ReactNode;
  variant?: "plain" | "hero" | "inset";   // domyślnie "plain"
  padding?: "none" | "sm" | "md" | "lg";  // 0 / 12 / 16 / 24
  onPress?: () => void;                   // gdy podane: Card staje się Pressable press="lg"
  style?: React.CSSProperties;
}
```
- `plain`: `--surface`, `--r-lg` (20), padding 16, `--elev-1`, włos `--border`
- `hero`: `--r-xl` (28), padding 24/20, `--elev-2`
- `inset`: `--surface-2`, `--r-md`, bez cienia (sekcja wewnątrz karty)

### 5.4 ListRow

```ts
interface ListRowProps {
  leading?: React.ReactNode;     // checkbox, godzina, awatar
  title: string;                 // t-body 17px
  subtitle?: string;             // t-footnote 13px
  trailing?: React.ReactNode;    // wartość, strzałka, plakietka
  onPress?: () => void;
  onLongPress?: () => void;
  swipeActions?: { label: string; tone: "danger" | "neutral"; onAction: () => void }[];
  minHeight?: number;            // domyślnie 56
  danger?: boolean;
}
```
Cały wiersz jest klikalny. `leading` z własnym `onPress` musi robić `e.stopPropagation()`,
inaczej odhaczenie zadania jednocześnie rozwinie szczegóły (to realne ryzyko: `dashboard:2071`
ma `onClick={onExpand}` na całym wierszu).

### 5.5 Checkbox

```ts
interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;               // dla czytnika ekranu, wymagany gdy brak widocznego tekstu
  disabled?: boolean;
  size?: 24 | 26;               // rozmiar RYSUNKU; cel dotykowy zawsze 44
  tone?: "success" | "primary"; // kolor wypełnienia
}
```
Renderuje `<button role="checkbox" aria-checked>` 44×44 z `margin: -10`, w środku `<span>`
o boku 24-26 px, `--r-sm`, ramka **zawsze `2px solid`** ze zmianą koloru (nie `border: none`
przy zaznaczeniu, bo to przesuwa sąsiadów o 2 px). Animacja `--ease-spring` 220 ms.
Haptyka: `toggleOn` przy zaznaczeniu, `toggleOff` przy odznaczeniu, wołana **przed** zapytaniem sieciowym.

### 5.6 Input i Textarea

```ts
interface InputProps {
  label?: string;               // t-footnote nad polem
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;               // ramka --danger, komunikat pod polem
  type?: "text" | "number" | "date" | "time" | "email" | "password";
  inputMode?: "text" | "numeric" | "decimal";
  disabled?: boolean;
  /** WAŻNE: stan trzymany WEWNĄTRZ, na zewnątrz oddawany onCommit (blur/Enter),
      żeby każda litera nie przerysowywała strony na 2400 linii. */
  uncontrolled?: boolean;
  onCommit?: (v: string) => void;
}
```
Twarde: `minHeight: 52`, `fontSize: var(--fs-body)` (17), `--r-md`, `1.5px solid --border`,
focus = `--focus-ring`. Textarea: `minHeight: 96`, `lineHeight: 1.45`.

### 5.7 Sheet (arkusz dolny)

```ts
interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** "auto" = wysokość treści, "half" = 50dvh, "full" = 92dvh */
  size?: "auto" | "half" | "full";
  dismissOnDrag?: boolean;      // domyślnie true: pociągnięcie w dół zamyka
  footer?: React.ReactNode;     // przyklejony, z --safe-b
  children: React.ReactNode;
}
```
Zawiera: `useScrollLock(open)`, `overscroll-behavior: contain` na treści, `--r-xl` na górnych
rogach, uchwyt 36×4 px na górze, tło `--overlay`, wjazd `translateY` 320 ms `--ease-ios`,
`paddingBottom: var(--safe-b)`.

**Sheet zastępuje wszystkie modale na środku ekranu.** Modal ze zamknięciem `×` w prawym górnym
rogu jest wzorcem webowym: na telefonie 6" prawy górny róg jest poza zasięgiem kciuka.

### 5.8 Tabs

```ts
interface TabsProps {
  items: { key: string; label: string; badge?: number }[];
  active: string;
  onChange: (key: string) => void;
  variant?: "big" | "pill";     // "big" = BigTabs, "pill" = paski jak w Admin
  swipeable?: boolean;          // sprzęga zakładki z gestem przesunięcia treści
  scrollable?: boolean;         // gdy > 4 pozycji: scroll-snap + gradient na krawędzi
}
```
Minimalna wysokość 48 px. Gdy `scrollable`, obowiązkowo `scrollSnapType: "x mandatory"`
oraz gradient-cień na prawej krawędzi jako sygnał "jest więcej".
Dziś w Adminie 7 zakładek `pill` sumuje się do ok. 685 px w kontenerze 398 px, czyli
42% jest niewidoczne bez żadnego sygnału (`admin/page.tsx:258-266, 291`).

### 5.9 Stat

```ts
interface StatProps {
  value: string | number;
  unit?: string;
  label: string;
  size?: "hero" | "md" | "sm";     // t-display / t-metric / t-title3
  tone?: "neutral" | "primary" | "success" | "warning" | "danger";
  icon?: React.ReactNode;
  trend?: { value: number; direction: "up" | "down"; good: boolean };
}
```
Zawsze `tabular-nums`. Jeden `size="hero"` na ekran, ani jednego więcej.

### 5.10 ProgressBar i Ring

```ts
interface ProgressBarProps { value: number; max?: number; tone?: Tone; height?: 6|8|10; label?: string; }
interface RingProps { value: number; max?: number; size?: number; stroke?: number; tone?: Tone; children?: React.ReactNode; }
```
`ProgressBar` animuje **`transform: scaleX` z `transformOrigin: left`**, nigdy `width`.
`Ring` animuje `stroke-dashoffset`, czas `--dur-celebrate`.

### 5.11 Pozostałe

```ts
interface IconButtonProps { icon: React.ReactNode; ariaLabel: string; onPress: () => void;
  variant?: "ghost"|"surface"|"danger"; size?: 44|48; badge?: boolean; }

interface SkeletonProps { width?: number|string; height?: number; radius?: number; count?: number; }
// szerokości MUSZĄ być stałe. Dziś dashboard:182 losuje je Math.random() przy każdym
// przerysowaniu, więc szkielet miga.

interface EmptyStateProps { icon?: React.ReactNode; title: string; body?: string;
  action?: { label: string; onPress: () => void }; }
// Każdy pusty stan MA mieć akcję. Dziś 36 komunikatów "Brak ..." to sam tekst.

interface StickyActionBarProps { children: React.ReactNode; blur?: boolean; }
// position: sticky; bottom: var(--above-tabbar); gradient do przezroczystości u góry.
```

---

## 6. Mapowanie: stary inline style na nowy prymityw

Kolejność podmian. Każdy wiersz to jedno miejsce w kodzie, które naprawia wiele wystąpień naraz.

### 6.1 Scentralizowane obiekty stylów (największy zysk na jednostkę pracy)

| Obiekt | Plik:linia | Stan dziś | Nowy prymityw | Ile miejsc naprawia |
|---|---|---|---|---|
| `btnPrimary` | `admin:90`, `mentors:61` | `padding "10px 20px"`, `fontSize 14` = 37 px | `<Button variant="primary" size="md">` | 2 kopie 1:1, użycia m.in. `admin:446, 1578` |
| `btnSecondary` | `admin:112`, `mentors:83` | `padding "6px 12px"`, `fontSize 12`, `border 1.5px` = **29 px** | `<Button variant="secondary" size="md">` | użycia: `admin:349, 570, 1570, 1581, 1584`, `mentors:828, 961` |
| `btnDanger` | `admin:101`, `mentors:72` | 26 px | `<Button variant="danger" size="sm">` + potwierdzenie w `Sheet` | |
| `inputStyle` | `admin:63`, `mentors:41`, `diet:119`, `discipline/[slug]:99`, `WeeklyCheckinForm:211` | `fontSize 14` = auto-zoom na iOS, wysokość 39 px | `<Input>` (52 px, 17 px) | **5 kopii** |
| `cardStyle` | `dashboard:193`, `diet:90`, `goals:106`, `habits:52`, `journal:43`, `discipline/[slug]:83`, `BriefingCard:317`, `WeeklyCheckinForm:196`, `WeightTracker:19` | 9 różnych definicji tej samej rzeczy | `<Card variant="plain">` | **9 kopii** |
| `iconBtnStyle` | `goals:113-127` | **28×28**, obsługuje edycję i USUNIĘCIE celu (`goals:1609, 1622`) | `<IconButton size={44}>` w `Sheet` z akcjami | 2 użycia, oba destrukcyjne |
| `pill(active)` | `admin:51-61` | `padding "8px 18px"`, `fontSize 14` = 33 px | `<Tabs variant="pill" scrollable>` | 7 zakładek admina |
| `pillStyle` | `tracking:220` | | `<Tabs variant="pill">` | |
| `buttonPrimary` / `buttonGhost` | `diet:97`, `diet:108` | 37 px | `<Button>` | |
| `buttonPrimaryStyle` / `buttonSecondaryStyle` | `discipline/[slug]:119`, `:130` | 37 px / 34 px | `<Button>` | |
| `BigTabs` | `components/ui/BigTabs.tsx:32-44` | `padding "12px 14px"`, `fontSize 15` = 42 px | `<Tabs variant="big" swipeable>` | używany na Dashboardzie, Diecie, Celach |

**Rekomendacja przy okazji:** `btnPrimary`, `btnSecondary`, `btnDanger` i `inputStyle` są dziś
skopiowane 1:1 między `admin/page.tsx` i `mentors/page.tsx`. Nie kopiuj ich po raz trzeci,
tylko od razu wystaw prymityw.

### 6.2 Wzorce rozproszone po kodzie

| Wzorzec dziś | Przykłady (plik:linia) | Nowy prymityw | Uwaga migracyjna |
|---|---|---|---|
| `<div onClick>` jako checkbox, bok 20-24 px | `dashboard:2087` (22), `dashboard:1875` (22), `dashboard:1302` (20), `habits:704` (24), `goals:2105` (22), `goals:1925` (20) | `<Checkbox>` | zachować `e.stopPropagation()`, inaczej odhaczenie rozwinie wiersz |
| `<svg width=16 onClick>` do rozwijania celu | `goals:1635` | `<IconButton size={44}>` | najmniejszy cel w aplikacji |
| Wiersz listy: `<div>` z `padding "8px 4px"` | `dashboard:2077` (38 px), `dashboard:1297` (32 px), `habits` | `<ListRow minHeight={56}>` | |
| Modal `position: fixed` + `×` w prawym górnym rogu | `dashboard:1625`, `:1804`, `goals:1307`, `:1378`, `habits:643`, `diet:2387`, `journal:591`, `roundtable:595`, `admin:334`, `discipline/[slug]:920`, `FileList:124`, `WeightTracker:321` | `<Sheet>` | **11 z 12 nie ma blokady scrolla tła.** Jedyne poprawne dziś: `mentors:162-170` |
| `bottom: 80` / `bottom: 90` sztywno | `dashboard:1805`, `diet:2388`, `goals:1380`, `habits:645`, `journal:593`, `roundtable:596`, `WeightTracker:322` | `bottom: var(--above-tabbar)` | **7 miejsc, obowiązkowo w tym samym commicie co `viewportFit: cover`**, inaczej schowają się pod paskiem |
| Pasek postępu z `transition: width` | `dashboard:896`, `habits:301`, `diet:382`, `MoodChart:95`, `BriefingCard:305`, `FileUpload:199` | `<ProgressBar>` | animacja idzie na `scaleX` |
| `overflowY: "auto"` bez `overscroll-behavior` | `dashboard:1691`, `discipline/[slug]:939`, `journal:568`, `roundtable:470`, `:850`, `MentorChat:363`, `:444` | `className="papi-scroll"` | jedna klasa, 7 miejsc |
| Pulsujący szary prostokąt | `dashboard:162-187` + 8 innych, łącznie 35 wystąpień | `<Skeleton>` | usunąć `Math.random()` z `dashboard:182` |
| Komunikat "Brak ..." bez akcji | 36 wystąpień, m.in. `habits:436-446`, `dashboard:1376` | `<EmptyState action={...}>` | |
| `confirm()` systemowy | 9 wystąpień: `dashboard:740`, `habits:244`, `journal:312`, `goals:1250` i inne | `<Sheet>` z potwierdzeniem | okno systemowe wygląda jak strona WWW |
| Emoji jako ikona systemowa | `BottomTabBar:16-23` (8 zakładek), `dashboard:1023, 1048, 1077, 2225`, `diet:1880, 2088, 2099` | komplet SVG 24 px, linia 1,75 px, końce zaokrąglone | wzorzec już w kodzie: ptaszek `dashboard:2107-2119`, strzałka `UniversalInputBar:233-246`. Znikają hacki `filter: brightness(0) invert(1)` (`UniversalInputBar:275`, `BottomTabBar:158`) |
| `fontSize: 10` | `BottomTabBar:188`, `diet:474` | usunąć, minimum 12 px | |
| `fontSize: 11` (92 wystąpienia) | `goals:1555`, `:2209`, `diet:2003` | `t-footnote` 13 px | |
| `fontSize: 13/14` jako treść (276 wystąpień) | `dashboard:2140`, `dashboard:1337`, `diet:311`, `habits:744` | `t-body` 17 px | **największa praca całej migracji**, patrz ryzyko R1 |
| `fontSize: 16` jako `h2`/`h3` (26 wystąpień) | `dashboard:1368`, `diet:1932` | `t-title2` 22 px | |
| `fontSize: 24` i `28` jako `h1` (5 stron, 3 różne wartości) | `dashboard:862`, `diet:1880`, `admin:271`, `mentors:308`, `roundtable:294` | `t-title1` 28 px wszędzie | ujednolica rangę |

### 6.3 Zmiany w powłoce (jeden commit, nie da się rozbić)

```ts
// src/app/layout.tsx  (dziś linie 17-23)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",                  // DODAĆ: bez tego env(safe-area-*) = 0 w 6 miejscach
  interactiveWidget: "resizes-content",  // DODAĆ: klawiatura Androida nie zasłoni pola pisania
  maximumScale: 5,                       // ZMIENIĆ z 1  (WCAG 1.4.4)
  userScalable: true,                    // ZMIENIĆ z false
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F6F8" },
    { media: "(prefers-color-scheme: dark)",  color: "#0A0A0F" },
  ],
};
```

```tsx
// src/app/(app)/layout.tsx  (dziś linie 58-62)
<main
  style={{
    paddingTop:   "var(--safe-t)",   // DODAĆ: statusBarStyle to "black-translucent",
    paddingLeft:  "var(--safe-l)",   //        więc bez tego nagłówek wejdzie pod zegar
    paddingRight: "var(--safe-r)",
    paddingBottom: "calc(var(--tabbar-h) + var(--safe-b) + 16px)",
  }}
>
```

Typy potwierdzone w `node_modules/next/dist/lib/metadata/types/extra-types.d.ts:52-53`
(`viewportFit` i `interactiveWidget` są w tej wersji Next dostępne).

---

## 7. Czego NIE robić

1. **Nie robić globalnego "znajdź i zamień" na `fontSize: 13`.** Ta sama liczba oznacza raz treść, raz podpis. 144 wystąpienia, każde do oceny.
2. **Nie włączać `viewportFit: "cover"` osobno.** To odblokowuje 6 uśpionych obliczeń naraz i psuje 7 elementów z `bottom: 80/90`.
3. **Nie usuwać `maximumScale: 1` przed podniesieniem pól do 17 px.** Regres, nie poprawa.
4. **Nie włączać trybu ciemnego przed sprzątnięciem zaszytych kolorów.** Wykresy `/tracking` pokażą białe prostokąty.
5. **Nie dodawać `React.memo` przed rozbiciem stanu formularzy.** Do kart trafiają dziś `Set` i obiekty (`goals:1067`, `:1083`, `:1209`), które i tak zabiją memoizację. Kolejność odwrotna to strata czasu.
6. **Nie obiecywać haptyki jako funkcji dla iPhone'a.** `navigator.vibrate` nie istnieje w Safari na iOS, także w PWA. Na iOS wrażenie robi wyłącznie animacja wciśnięcia.
7. **Nie usuwać aliasów zgodności wstecznej** (`--card`, `--muted`, `--foreground`, `--card-shadow`) do czasu, aż grep pokaże zero użyć.

---

## 8. Ryzyka wdrożenia

| # | Ryzyko | Skutek | Ograniczenie |
|---|---|---|---|
| R1 | Podniesienie treści z 13-14 px na 17 px to +25% wysokości tekstu | Wszędzie, gdzie jest `whiteSpace: nowrap` + `textOverflow: ellipsis`, tekst zacznie się urywać wcześniej: `dashboard:1343`, `:2143`, `habits:751`, `diet:2304`, `mentors:189-190`, `goals:1531` | Ekran po ekranie, po każdym zrzut ekranu przy szerokości 360 px i 430 px. Tam gdzie nazwy bywają długie, pozwolić na dwie linie |
| R2 | Podniesienie kontrolek do 48-56 px wypycha treść poniżej ekranu | Karta "Dzisiaj" w Diecie (10 bloków) urośnie o ok. 150 px, czyli zarzut "za dużo informacji" się pogłębi | **Progressive disclosure musi iść RAZEM z podniesieniem rozmiarów, nie po nim** |
| R3 | `viewportFit: cover` włącza 6 uśpionych obliczeń naraz | Na iPhone 14+ dojdzie kilkadziesiąt px paddingu w `layout:60`, `BottomTabBar:101`, `MentorChat:256, 618`, `FollowUpSheet:59`, `InstallPrompt:56` | Jeden commit z 7 podmianami `bottom` + test na fizycznym telefonie, nie w symulatorze |
| R4 | `interactiveWidget: "resizes-content"` zmienia wysokość widoku przy każdej klawiaturze | Przeskoczą elementy z `height: 100dvh` (`roundtable:280`) i `position: fixed; inset: 0` (`MentorChat:240`) | Test z otwartą klawiaturą: czat mentora, arkusz follow-up, dodawanie nawyku, dziennik |
| R5 | Zmiana `--muted` na `--text-3` zmienia znaczenie tokena | `--muted` jest dziś używany i jako kolor tekstu, i jako **tło** (`UniversalInputBar:225`: `background: busy ? "var(--muted)"`) | Przejść wszystkie użycia `--muted` jako tła osobno |
| R6 | Zamiana checkboxów `<div>` na `<button>` | Bez `stopPropagation` odhaczenie zadania jednocześnie rozwinie szczegóły (`dashboard:2071` ma `onClick={onExpand}` na wierszu) | Test: odhaczyć zadanie i sprawdzić, czy wiersz się nie rozwinął |
| R7 | Ujemny margines `-10` przy powiększonych checkboxach | W kontenerach z `overflow: hidden` (karuzela `dashboard:966`) może przyciąć krawędź | Sprawdzić pierwszy i ostatni wiersz każdej listy |
| R8 | Redukcja zakładek z 8 na 5 | Dziennik, Debata, Mentorzy znikają z pierwszego planu. Linki bezpośrednie (`dashboard:1272`, `:931`, `:1550`) muszą dalej działać | "Więcej" musi być ekranem lub arkuszem, nie samym menu. **Decyzja właściciela przed wdrożeniem** |
| R9 | Magenta łatwo przesadzić | Więcej niż jeden element magenta w polu widzenia i efekt jest tani, nie drogi | Limity z sekcji 2 są częścią specyfikacji, nie sugestią |
| R10 | Migracja 21 000 linii inline nie może iść naraz | Tokeny same z siebie nic nie zmienią | Kolejność: (1) 15 obiektów scentralizowanych naprawia ok. 60% przypadków, (2) reszta ekran po ekranie |

---

## 9. Czego nie zweryfikowałem

- Nie uruchamiałem aplikacji ani nie robiłem zrzutów ekranu na urządzeniu. Wnioski o hierarchii i wysokościach pochodzą z odczytu kodu i arytmetyki, nie z renderu.
- Kontrast policzyłem skryptem z wartości HEX (WCAG 2.1). Nie sprawdzałem czytelności na realnym ekranie w słońcu. Jeśli magenta na białym okaże się męcząca na słońcu, planem awaryjnym jest jasna baza `#FAFAF7` z tym samym magenta jako jedynym sygnałem.
- Nie skompilowałem żadnego z prymitywów: to specyfikacja API, nie działający kod.

**NIEZWERYFIKOWANE:** zachowanie `viewportFit: "cover"` i `interactiveWidget: "resizes-content"`
na fizycznym iPhonie i Androidzie. To wynika logicznie z kodu i z reguł przeglądarek, ale wymaga
potwierdzenia na telefonie przed wdrożeniem komercyjnym.

---

Ścieżka dokumentu: `C:\Users\Paweł Pieloch\CLAUDE CODE\Aplikacja Papi 2.0\papicoach\docs\audit\DESIGN-SPEC.md`
