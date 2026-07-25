# Audyt 02: Design premium (dyrektor artystyczny)

Aplikacja: PAPI PLANER (Next.js 16, PWA)
Zakres: hierarchia wizualna, system tokenów, kierunek marki, układ ekranów, mikro-detale
Tryb: READ-ONLY. Nie zmieniono żadnego pliku aplikacji.
Data: 2026-07-25

Wszystkie liczby poniżej pochodzą z realnego kodu (grep + odczyt plików), nie z oszacowania.

---

## Streszczenie

Aplikacja ma dobrą logikę i sensowne ekrany, ale wygląda jak panel administracyjny, a nie jak produkt z App Store: trzy na cztery rozmiary tekstu w całym kodzie są mniejsze niż 15 px (505 z 669 wystąpień), a typowy przycisk ma wysokość dotykową około 26 do 30 px przy normie Apple 44 px. Nie ma systemu: 10 zmiennych CSS, 15 różnych promieni zaokrągleń, 17 różnych cieni i 9 osobnych definicji "karty" skopiowanych do 9 plików, więc każdy ekran wygląda o pół tonu inaczej. Nie ma trybu ciemnego (zero wystąpień `prefers-color-scheme`), nie ma wibracji (zero wystąpień `vibrate`) i praktycznie nie ma stanu wciśnięcia przycisku (zero `:active`, tylko 2 pliki z `onMouseDown`), więc aplikacja "nie odpowiada" pod palcem i to jest główny powód wrażenia "to nie wygląda jak aplikacja". Marka też nie istnieje na ekranie: ikona jest cyberpunkowa (żółte okulary, neon magenta i cyan), a wnętrze jest domyślnym niebieskim Tailwind #1d4ed8, którego użyto 11 razy na sztywno. Rekomendacja: wprowadzić jedną warstwę tokenów nad istniejącym kodem (typografia, odstępy, kolory, cień, ruch), podnieść tekst i przyciski do norm mobilnych, dodać tryb ciemny w kierunku "Neon Noir" zgodnym z ikoną i dołożyć trzy mikro-rzeczy, które dają wrażenie drogiego produktu: reakcję na dotyk, wyraźną hierarchię jednej liczby na ekranie i spójne ikony zamiast emoji.

---

## Znaleziska krytyczne

### K1. Tekst jest systemowo za mały (75,5% rozmiarów poniżej 15 px)

Histogram wszystkich `fontSize` w `src` (669 wystąpień):

| Rozmiar | Wystąpień |
|---|---|
| 13 px | 144 |
| 14 px | 132 |
| 12 px | 119 |
| 11 px | 92 |
| 16 px | 57 |
| 15 px | 21 |
| 18 px | 20 |
| 10 px | 18 |
| 24 px | 16 |

Poniżej 15 px: 505 wystąpień (75,5%). Norma iOS dla tekstu treści to 17 px, minimum czytelne w ruchu to 15 px.

Dowody punktowe:
- `src/app/(app)/dashboard/page.tsx:2140` nazwa aktywności w planie dnia: 14 px. To jest główna treść ekranu głównego.
- `src/app/(app)/dashboard/page.tsx:1337` nazwa nawyku w widgecie: 13 px.
- `src/app/(app)/diet/page.tsx:311` wiersz rozbicia kalorii: 13 px.
- `src/app/(app)/diet/page.tsx:2003` "Cel dzienny": 11 px.
- `src/app/(app)/goals/page.tsx:1555` pigułki mentorów: 11 px, a wewnątrz emoji 13 px.
- `src/app/(app)/goals/page.tsx:2209` etykieta przycisku akcji: 11 px.
- `src/components/shell/BottomTabBar.tsx:188` etykiety zakładek: 10 px.

Skutek: użytkownik czyta z wysiłkiem, a mózg odbiera gęsty drobny tekst jako "narzędzie robocze", nie jako produkt konsumencki.

### K2. Cele dotykowe poniżej normy (44 px Apple / 48 dp Material)

Histogram paddingów przycisków: `"6px 12px"` 15x, `"2px 8px"` 15x, `"4px 10px"` 10x, `"8px 10px"` 12x. Przy `fontSize` 11 do 13 px daje to wysokość realną 26 do 32 px.

W całej aplikacji `minHeight: 44` występuje 3 razy i wyłącznie w jednym pliku: `src/app/(app)/dashboard/page.tsx:1005`, `:1045`, `:1074`.

Najgorsze przypadki:
- `src/app/(app)/goals/page.tsx:113-127` `iconBtnStyle` ma 28x28 px i obsługuje edycję oraz **usuwanie celu** (`:1609-1633`). Akcja destrukcyjna na przycisku 28 px to gwarantowany przypadkowy klik.
- `src/app/(app)/goals/page.tsx:2185-2213` przyciski "Zaplanuj" i feedback: `padding: "4px 10px"`, `fontSize: 11`, wysokość około 24 px.
- `src/app/(app)/dashboard/page.tsx:1302-1318` checkbox nawyku 20x20 px, klikalny jest tylko kwadracik, nie cały wiersz.
- `src/app/(app)/dashboard/page.tsx:2087-2104` checkbox aktywności 22x22 px, ten sam problem.
- `src/components/shell/UniversalInputBar.tsx:222` i `:258` przyciski mikrofonu i wysyłki 36x36 px.

Pozytywny wyjątek, który należy skopiować w resztę aplikacji: `src/app/(app)/goals/page.tsx:156-169` wiersz wyboru mentora ma `minHeight: 56` i całe pole jest klikalne. Tak ma wyglądać każdy element listy.

### K3. Brak systemu: 10 tokenów, 15 promieni, 17 cieni, 9 kopii "karty"

`src/app/globals.css:3-14` zawiera dokładnie 10 zmiennych (kolory + jeden cień). Nie ma skali typograficznej, odstępów, promieni, ruchu, warstw.

Efekty uboczne widoczne w kodzie:
- 9 osobnych definicji `const cardStyle` w: `dashboard/page.tsx:193`, `diet/page.tsx:90`, `discipline/[slug]/page.tsx:83`, `goals/page.tsx:106`, `habits/page.tsx:52`, `journal/page.tsx:43`, `components/briefing/BriefingCard.tsx:317`, `components/tracking/WeeklyCheckinForm.tsx:196`, `components/weight/WeightTracker.tsx:19`.
- 15 różnych wartości `borderRadius` (10, 8, 12, 9999, 16, 6, 7, 999, 3, 4, 2, 1, 14, 5, 20). Dwie z nich (`9999` i `999`) to ten sam zamiar zapisany dwoma sposobami.
- 17 różnych ciągów `boxShadow`, w tym `"0 1px 3px rgba(0,0,0,0.06)"` obok `var(--card-shadow)`, która ma tę samą wartość. To jest ta sama warstwa napisana dwa razy.
- Nagłówki stron nie są zgodne: `dashboard:862` 24 px/600, `diet:1880` 24 px/700, `admin:271` 28 px, `mentors:308` 28 px, `roundtable:294` 20 px. Pięć stron, trzy różne rangi tego samego elementu.
- 82 wystąpienia `#fff` wpisanego na sztywno i 11 wystąpień `#1d4ed8`, mimo że istnieje `var(--primary)`.

### K4. Brak trybu ciemnego, a kod ma już wbudowane blokady

Zero wystąpień `prefers-color-scheme` w `src` i `public`. Dodatkowo 7 miejsc ma białe tło wpisane na stałe i 16 miejsc ma ciemny tekst wpisany na stałe, co po włączeniu dark mode da biały prostokąt lub niewidoczny tekst:
- `src/app/(app)/tracking/page.tsx:243`, `:272`, `:292` (`background: "#fff"`) oraz `:91` (`color: "#0f172a"`).
- `src/components/tracking/CompletionChart.tsx:67`, `EnergyChart.tsx:67`, `SleepChart.tsx:70`.
- `src/components/tracking/WeeklyCheckinForm.tsx:197`.
- Dodatkowo `journal/page.tsx`, `page.tsx`, `InstallPrompt.tsx`, `MoodChart.tsx` mają zaszyte `#0f172a` lub `#64748b`.

Użytkownik korzysta z telefonu wieczorem, więc jasnoniebieski ekran 100% bieli to najbardziej odczuwalny brak.

### K5. Zero reakcji na dotyk (to jest główny powód wrażenia "to nie jest apka")

- Zero wystąpień `:active` w `src`.
- Tylko 2 pliki mają jakikolwiek `onMouseDown` lub `onTouchStart`: `dashboard/page.tsx` i `BottomTabBar.tsx:149-156` (i to tylko dla przycisku głosu, który jest wyłączony, bo `isVoice` nie jest ustawione w żadnej zakładce, patrz `BottomTabBar.tsx:15-24`).
- Zero wystąpień `vibrate` lub `haptic` w całym kodzie.

Natywna aplikacja odpowiada w 100 ms na każdy dotyk: przycisk się kurczy, checkbox pulsuje, telefon lekko wibruje. Tutaj nie dzieje się nic aż do odpowiedzi serwera. Przy 8 zakładkach i dziesiątkach checkboxów to jest różnica między "strona www" a "aplikacja".

Uwaga techniczna, którą trzeba znać przed obietnicą wibracji: `navigator.vibrate` działa na Androidzie w Chrome, natomiast Safari na iOS (także w trybie PWA) tego API nie udostępnia. Na iPhonie haptics w PWA praktycznie nie ma. Wniosek: wibracja może być dodatkiem na Androida, ale wrażenie "reakcji" musi być zbudowane wizualnie (skala + kolor + mikroanimacja), bo to działa wszędzie.

### K6. Hierarchia: oko nie wie, gdzie patrzeć

Trzy konkretne miejsca, gdzie wszystko ma ten sam ciężar:

1. **Dieta, sekcja "Dzisiaj"** (`src/app/(app)/diet/page.tsx:1937-1968`): pięć wierszy `BreakdownRow` jeden pod drugim, każdy z identycznym tłem, identyczną ramką i `fontSize: 13` (`:301-331`). BMR, aktywności, spalanie, zjedzone i "pozostało" wyglądają tak samo, choć tylko jedna z tych liczb jest decyzją użytkownika na dziś. Jedyne wyróżnienie to `bold` przy ostatnim wierszu, który daje 16 px zamiast 13 px (`:321-324`), czyli za mało, żeby wygrać z czterema sąsiadami. Nad tym stoi już duża liczba w pierścieniu (`:259` 36 px), więc ekran ma dwa konkurujące "bohaterów".

2. **Dashboard, panel "Statystyki"** (`dashboard/page.tsx:1480-1566`): w jednej karcie stoją obok siebie trzy `StatItem` po 18 px (`:2605`), procent 36 px (`:1503`), spalone kalorie 24 px (`:1513`), trzy wiersze BMR po 13 px (`:1532-1545`), `WeightTracker` i przycisk. Sześć poziomów ważności w jednym pudełku, bez odstępów grupujących. Efekt: nie widać, co jest wynikiem dnia.

3. **Dashboard, panel "Plan dnia"** (`dashboard/page.tsx:980-1248`): pierwsza rzecz na ekranie każdego dnia to karta "Wygeneruj plan dnia" z dwoma dużymi przyciskami, a dopiero pod nią realny plan (`:1250`). Narzędzie do tworzenia treści stoi przed treścią. Dodatkowo nagłówek karty ma 14 px (`:981`), a nagłówek "Plan dnia" niżej 16 px (`:1368`), więc mniej ważna karta wizualnie nie ustępuje ważniejszej.

4. **Cele** (`goals/page.tsx:1522-1603`): tytuł celu 15 px/600 (`:1525`), a pod nim pigułki mentorów 11 px, obszar życia 12 px, plakietka "Plan dostępny" 11 px na pełnym kolorze `--primary` (`:1586-1602`). Najbardziej krzykliwy element karty (kolorowa plakietka) to najmniej ważna informacja. Pierścień postępu ma 40 px z tekstem 11 px w środku (`:1483-1519`), czyli kluczowa metryka jest najmniejszym tekstem w kafelku.

### K7. Karuzela dashboardu zbudowana na hacku, który psuje animację

`dashboard/page.tsx:978`, `:1465`, `:1479` ustawiają `height: activePanel === N ? "auto" : 0`. Kontener przesuwa się `translateX` przez 300 ms (`:973-974`), ale panel docelowy ma w tym czasie wysokość 0 i dostaje "auto" natychmiast, bez przejścia. Efekt na telefonie: treść skacze, strona zmienia długość w trakcie przesunięcia, pasek przewijania szarpie. Żadna natywna karuzela tak się nie zachowuje.

### K8. Dolna nawigacja przewija się w poziomie (8 zakładek)

`BottomTabBar.tsx:15-24` definiuje 8 zakładek. Każda ma `minWidth: 64` (`:179`) plus `gap: 4` i `padding: "0 8px"` (`:110-114`). Minimalna szerokość paska to 8x64 + 7x4 + 16 = 556 px, przy szerokości shella 430 px (`(app)/layout.tsx:52`). Czyli zawsze co najmniej 2 zakładki są poza ekranem, a zakładka Admin jest ostatnia. Żadna aplikacja z App Store nie ma przewijanego taba na dole, bo użytkownik nie wie, że coś jest schowane. Do tego pasek ma 64 px wysokości z ikoną emoji 24 px i etykietą 10 px (`:185-193`).

### K9. Emoji zamiast ikon, z widocznym hackiem w kodzie

Emoji są używane jako ikony systemowe w nawigacji (`BottomTabBar.tsx:16-23`), w przyciskach akcji (`dashboard:1023` "⚡ Wygeneruj automatycznie", `:2225` "🧠 Generuj plan z mentorem", `diet:2088` "🤖 Oszacuj z AI") i w nagłówkach sekcji (`diet:1880` "🍽️ Dieta").

Dowód, że to nie działa: w dwóch miejscach kod próbuje przemalować emoji na biało filtrem: `src/components/shell/UniversalInputBar.tsx:275` i `src/components/shell/BottomTabBar.tsx:158` używają `filter: "brightness(0) invert(1)"`. To jest obejście problemu, którego nie ma się z ikonami wektorowymi. Emoji dodatkowo renderują się inaczej na iOS, Androidzie i Windows, więc aplikacja wygląda inaczej u każdego użytkownika i nie da się jej zbrandować.

### K10. Ekran nie jest przygotowany na wszystkie telefony

- `src/app/layout.tsx:17-23`: viewport nie ma `viewportFit: "cover"`, a `src/app/layout.tsx:33` ustawia `apple-mobile-web-app-status-bar-style: black-translucent`. Bez `viewport-fit=cover` wartości `env(safe-area-inset-*)` na iOS zwracają 0, więc `paddingBottom: calc(80px + env(safe-area-inset-bottom, 0px))` w `(app)/layout.tsx:60` i `paddingBottom: env(safe-area-inset-bottom)` w `BottomTabBar.tsx:101` nic nie dają: pasek zakładek na iPhonie ląduje pod paskiem gestu.
- `src/app/layout.tsx:19-21` blokuje powiększanie (`maximumScale: 1`, `userScalable: false`). Przy tekście 11 do 13 px to znaczy, że użytkownik nie ma żadnego wyjścia.
- Brak górnego marginesu bezpieczeństwa: `(app)/layout.tsx:58-62` nie stosuje `env(safe-area-inset-top)`, a nagłówek strony startuje od `padding: "20px 16px 16px"` (`dashboard:859`). Jedyny plik, który to robi poprawnie, to `components/mentors/MentorChat.tsx:256`.
- Brak własnego kroju pisma: `globals.css:17` używa stosu systemowego, brak `next/font` w całym projekcie. To akurat jest obronna decyzja (natywny feel, zero transferu), ale wtedy trzeba dopracować odstępy i wagi, bo krój sam nie zbuduje charakteru.

### K11. Marka nie istnieje wewnątrz aplikacji

Ikona (`public/icons/icon-192.png`, sprawdzona wizualnie) to cyberpunkowy portret: żółte oprawki okularów, szkła w magencie i cyanie, glitchowe piksele w neonach, portret w skali szarości. Wnętrze aplikacji to domyślne niebieskie `#1d4ed8` (`globals.css:8`, plus 11 wpisów na sztywno) i szarości Tailwind Slate. Między ekranem instalacji a pierwszym ekranem aplikacji następuje zerwanie tożsamości. `manifest.json` ma `background_color: "#ffffff"` i `theme_color: "#0f172a"`, czyli splash też jest neutralny.

---

## Rekomendacje

### P0 (bez tego nie ma mowy o "premium", to jest bilet wstępu)

1. **Jeden plik tokenów zamiast 10 zmiennych.** Wprowadzić pełny zestaw (typografia, odstępy, promienie, warstwy, kolory, ruch) do `globals.css` jako warstwę nad kodem. Kod dalej używa `style={{}}`, ale sięga po `var(--...)`. Zero big-bangu.
2. **Podnieść tekst treści do 17 px i etykiety do 13 px.** Reguła twarda: 11 px i 10 px znikają całkowicie, 12 px zostaje tylko dla wersalikowych etykiet sekcji. Konkretna kolejność zamian w sekcji "Gotowe do wdrożenia".
3. **Każdy element klikalny minimum 44x44 px.** Cały wiersz listy klikalny, nie sam checkbox. Przycisk usuwania celu (`goals:1622-1633`) do 44 px i przeniesiony do menu, nie obok edycji.
4. **Stan wciśnięcia na wszystkim, co się klika.** `transform: scale(0.97)` + zmiana tła w 120 ms. To jest najtańsza zmiana o największym efekcie odczuwalnym.
5. **Tryb ciemny.** Najpierw usunąć 7 zaszytych `#fff` i 16 zaszytych ciemnych kolorów tekstu, potem włączyć mapę dark. Bez tego przełącznik pokaże biały prostokąt na wykresach trackingu.
6. **Naprawić karuzelę dashboardu** (K7) albo zamienić ją na układ bez karuzeli (patrz sekcja Karty i układ).

### P1 (to buduje wrażenie drogiego produktu)

7. **Kierunek wizualny "Neon Noir"** zgodny z ikoną, z pełną paletą i trybem jasnym jako bliźniakiem.
8. **Ikony wektorowe zamiast emoji** w nawigacji, przyciskach i nagłówkach. Emoji zostają wyłącznie tam, gdzie są treścią wybraną przez użytkownika: awatary mentorów (`goals:1560`, `MentorCard.tsx`), nastrój (`dashboard:127-133`), kropki nastroju w dzienniku.
9. **Hero metryka na każdym ekranie.** Jedna liczba dominuje, reszta schodzi o dwa poziomy niżej. Szczegóły per ekran niżej.
10. **Dolna nawigacja do 5 zakładek**, reszta pod "Więcej". Bez przewijania w poziomie.
11. **Bezpieczne obszary ekranu**: `viewportFit: "cover"` + `env(safe-area-inset-top/bottom)` w shellu.
12. **System ruchu**: 5 czasów, 4 krzywe, lista tego, co wolno animować (transform i opacity) i czego nie wolno (height, width, box-shadow, top).

### P2 (dopieszczenie, po wdrożeniu P0 i P1)

13. Skeletony z połyskiem zamiast pulsujących szarych prostokątów (`dashboard:162-187` i 8 innych miejsc, łącznie 35 wystąpień skeletonów lub `pulse 1.5s`).
14. Puste stany z akcją, nie tylko z tekstem. W kodzie jest 36 wystąpień komunikatu zaczynającego się od "Brak ", z czego większość to sam tekst.
15. Wibracja na Androidzie przy: zaznaczeniu zadania, ukończeniu dnia w 100%, błędzie. Na iOS świadomie pomijamy i nie obiecujemy.
16. Delikatny gradient i szkło (glass) wyłącznie w dwóch miejscach: hero karta dnia i dolna nawigacja. Nigdzie indziej, żeby nie zrobić "aplikacji z 2013".
17. Dźwięk sukcesu przy zamknięciu dnia (opcjonalny, domyślnie wyłączony).
18. Splash i `manifest.json` w kolorach marki zamiast bieli.

---

## Gotowe do wdrożenia

### 1. Pełny system tokenów (wklej do `src/app/globals.css` zamiast bloku `:root`)

```css
@import "tailwindcss";

:root {
  color-scheme: light dark;

  /* ============ TYPOGRAFIA ============ */
  --font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI",
             Roboto, system-ui, sans-serif;
  --font-num: var(--font-ui);          /* liczby: ten sam krój + tabular-nums */

  /* rola: rozmiar / waga / interlinia / światło międzyliterowe */
  --fs-display: 44px;  --fw-display: 800; --lh-display: 1.02; --ls-display: -0.03em;
  --fs-metric:  32px;  --fw-metric:  700; --lh-metric:  1.05; --ls-metric:  -0.02em;
  --fs-title1:  28px;  --fw-title1:  700; --lh-title1:  1.15; --ls-title1:  -0.02em;
  --fs-title2:  22px;  --fw-title2:  700; --lh-title2:  1.20; --ls-title2:  -0.015em;
  --fs-title3:  17px;  --fw-title3:  600; --lh-title3:  1.30; --ls-title3:  -0.01em;
  --fs-body:    17px;  --fw-body:    400; --lh-body:    1.45; --ls-body:    0;
  --fs-callout: 15px;  --fw-callout: 400; --lh-callout: 1.40; --ls-callout: 0;
  --fs-footnote:13px;  --fw-footnote:500; --lh-footnote:1.35; --ls-footnote: 0;
  --fs-label:   12px;  --fw-label:   700; --lh-label:   1.20; --ls-label:   0.06em;

  /* ============ ODSTĘPY (siatka 4 pt) ============ */
  --sp-0: 0px;   --sp-1: 4px;   --sp-2: 8px;   --sp-3: 12px;
  --sp-4: 16px;  --sp-5: 20px;  --sp-6: 24px;  --sp-8: 32px;
  --sp-10: 40px; --sp-12: 48px; --sp-16: 64px;

  --gutter: 20px;              /* margines boczny ekranu */
  --stack-tight: 8px;          /* odstęp w grupie */
  --stack: 12px;               /* odstęp między kartami */
  --stack-loose: 24px;         /* odstęp między sekcjami */

  /* ============ PROMIENIE ============ */
  --r-xs: 6px;    /* znaczniki, kropki */
  --r-sm: 10px;   /* pola, małe przyciski */
  --r-md: 14px;   /* przyciski, wiersze list */
  --r-lg: 20px;   /* karty */
  --r-xl: 28px;   /* hero, arkusze dolne */
  --r-full: 999px;

  /* ============ ROZMIARY KONTROLEK ============ */
  --tap-min: 44px;      /* absolutne minimum dotyku */
  --ctrl-sm: 36px;      /* tylko ikony wewnątrz większego celu */
  --ctrl-md: 48px;      /* domyślny przycisk */
  --ctrl-lg: 56px;      /* główne CTA, wiersz listy */
  --hairline: 1px;

  /* ============ RUCH ============ */
  --dur-instant: 90ms;   /* zmiana koloru */
  --dur-fast: 140ms;     /* wciśnięcie, hover */
  --dur-base: 220ms;     /* rozwijanie karty */
  --dur-slow: 320ms;     /* arkusz, zmiana panelu */
  --dur-celebrate: 520ms;/* wypełnienie postępu, sukces */

  --ease-out: cubic-bezier(0.16, 1, 0.30, 1);        /* wejście, iOS-owe */
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);     /* przejścia dwustronne */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);  /* checkbox, plakietki */
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);       /* domyślna */

  /* ============ KOLORY: TRYB JASNY ============ */
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

  --primary:       #C4006E;   /* magenta marki, przyciemniona pod biały tekst */
  --primary-hover: #A80060;
  --primary-soft:  rgba(196, 0, 110, 0.10);
  --primary-text:  #FFFFFF;

  --accent:        #0E7490;   /* cyan marki w wersji czytelnej na bieli */
  --accent-soft:   rgba(14, 116, 144, 0.10);

  --highlight:     #B45309;   /* żółć marki, czytelna na bieli */
  --highlight-soft:rgba(255, 200, 0, 0.16);

  --success:       #0E9F6E;
  --success-soft:  rgba(14, 159, 110, 0.12);
  --warning:       #B45309;
  --warning-soft:  rgba(180, 83, 9, 0.12);
  --danger:        #C81E3A;
  --danger-soft:   rgba(200, 30, 58, 0.10);

  --focus-ring:    0 0 0 3px rgba(196, 0, 110, 0.35);

  /* ============ WARSTWY (elevation 0-4) ============ */
  --elev-0: none;
  --elev-1: 0 1px 2px rgba(16, 16, 24, 0.06),
            0 1px 1px rgba(16, 16, 24, 0.04);
  --elev-2: 0 2px 6px rgba(16, 16, 24, 0.07),
            0 1px 2px rgba(16, 16, 24, 0.05);
  --elev-3: 0 10px 24px rgba(16, 16, 24, 0.10),
            0 2px 6px rgba(16, 16, 24, 0.06);
  --elev-4: 0 24px 60px rgba(16, 16, 24, 0.18),
            0 6px 16px rgba(16, 16, 24, 0.08);
  --glow-primary: 0 6px 24px rgba(196, 0, 110, 0.28);
}

/* ============ KOLORY: TRYB CIEMNY ============ */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg:            #0A0A0F;
    --bg-elevated:   #121218;
    --surface:       #15151C;
    --surface-2:     #1D1D26;
    --surface-3:     #262631;
    --overlay:       rgba(0, 0, 0, 0.62);

    --text:          #F4F4F7;
    --text-2:        #B4B4C2;
    --text-3:        #82828F;
    --text-inverse:  #0A0A0F;

    --border:        rgba(255, 255, 255, 0.09);
    --border-strong: rgba(255, 255, 255, 0.18);

    --primary:       #FF2D95;
    --primary-hover: #FF57A9;
    --primary-soft:  rgba(255, 45, 149, 0.14);
    --primary-text:  #12000A;

    --accent:        #22D3EE;
    --accent-soft:   rgba(34, 211, 238, 0.14);

    --highlight:     #FFC800;
    --highlight-soft:rgba(255, 200, 0, 0.14);

    --success:       #2EE6A8;
    --success-soft:  rgba(46, 230, 168, 0.14);
    --warning:       #FFC800;
    --warning-soft:  rgba(255, 200, 0, 0.14);
    --danger:        #FF4D5E;
    --danger-soft:   rgba(255, 77, 94, 0.14);

    --focus-ring:    0 0 0 3px rgba(255, 45, 149, 0.45);

    /* w ciemnym cień nie buduje warstwy, robi to jaśniejsza powierzchnia + hairline */
    --elev-0: none;
    --elev-1: inset 0 0 0 1px rgba(255,255,255,0.05);
    --elev-2: inset 0 0 0 1px rgba(255,255,255,0.07),
              0 2px 8px rgba(0,0,0,0.45);
    --elev-3: inset 0 0 0 1px rgba(255,255,255,0.08),
              0 12px 28px rgba(0,0,0,0.55);
    --elev-4: inset 0 0 0 1px rgba(255,255,255,0.10),
              0 28px 64px rgba(0,0,0,0.65);
    --glow-primary: 0 8px 32px rgba(255, 45, 149, 0.35);
  }
}

/* ręczny przełącznik w Admin > Ustawienia: <html data-theme="dark"> */
:root[data-theme="dark"] {
  --bg: #0A0A0F; --bg-elevated: #121218; --surface: #15151C;
  --surface-2: #1D1D26; --surface-3: #262631; --overlay: rgba(0,0,0,0.62);
  --text: #F4F4F7; --text-2: #B4B4C2; --text-3: #82828F; --text-inverse: #0A0A0F;
  --border: rgba(255,255,255,0.09); --border-strong: rgba(255,255,255,0.18);
  --primary: #FF2D95; --primary-hover: #FF57A9;
  --primary-soft: rgba(255,45,149,0.14); --primary-text: #12000A;
  --accent: #22D3EE; --accent-soft: rgba(34,211,238,0.14);
  --highlight: #FFC800; --highlight-soft: rgba(255,200,0,0.14);
  --success: #2EE6A8; --success-soft: rgba(46,230,168,0.14);
  --warning: #FFC800; --warning-soft: rgba(255,200,0,0.14);
  --danger: #FF4D5E; --danger-soft: rgba(255,77,94,0.14);
  --focus-ring: 0 0 0 3px rgba(255,45,149,0.45);
  --elev-1: inset 0 0 0 1px rgba(255,255,255,0.05);
  --elev-2: inset 0 0 0 1px rgba(255,255,255,0.07), 0 2px 8px rgba(0,0,0,0.45);
  --elev-3: inset 0 0 0 1px rgba(255,255,255,0.08), 0 12px 28px rgba(0,0,0,0.55);
  --elev-4: inset 0 0 0 1px rgba(255,255,255,0.10), 0 28px 64px rgba(0,0,0,0.65);
  --glow-primary: 0 8px 32px rgba(255,45,149,0.35);
}

/* ============ ZGODNOŚĆ WSTECZNA ============ */
/* stary kod używa --background, --card, --foreground, --muted, --card-shadow.
   Zostawiamy je jako aliasy, żeby nic nie pękło w trakcie migracji. */
:root {
  --background: var(--bg);
  --card: var(--surface);
  --foreground: var(--text);
  --muted: var(--text-3);
  --card-shadow: var(--elev-1);
}

body {
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

* { -webkit-tap-highlight-color: transparent; }

/* liczby zawsze tabelaryczne: nie skaczą przy odliczaniu */
.num, [data-num] { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
```

### 2. Klasy ról typograficznych (dopisz pod tokenami)

Dzięki temu migracja jest mechaniczna: `fontSize: 13` zamieniasz na `className="t-footnote"`, bez wymyślania wartości.

```css
.t-display  { font: var(--fw-display) var(--fs-display)/var(--lh-display) var(--font-ui);
              letter-spacing: var(--ls-display); font-variant-numeric: tabular-nums; }
.t-metric   { font: var(--fw-metric)  var(--fs-metric)/var(--lh-metric)   var(--font-ui);
              letter-spacing: var(--ls-metric);  font-variant-numeric: tabular-nums; }
.t-title1   { font: var(--fw-title1)  var(--fs-title1)/var(--lh-title1)   var(--font-ui);
              letter-spacing: var(--ls-title1); }
.t-title2   { font: var(--fw-title2)  var(--fs-title2)/var(--lh-title2)   var(--font-ui);
              letter-spacing: var(--ls-title2); }
.t-title3   { font: var(--fw-title3)  var(--fs-title3)/var(--lh-title3)   var(--font-ui);
              letter-spacing: var(--ls-title3); }
.t-body     { font: var(--fw-body)    var(--fs-body)/var(--lh-body)       var(--font-ui); }
.t-body-b   { font: 600               var(--fs-body)/var(--lh-body)       var(--font-ui); }
.t-callout  { font: var(--fw-callout) var(--fs-callout)/var(--lh-callout) var(--font-ui);
              color: var(--text-2); }
.t-footnote { font: var(--fw-footnote)var(--fs-footnote)/var(--lh-footnote) var(--font-ui);
              color: var(--text-3); }
.t-label    { font: var(--fw-label)   var(--fs-label)/var(--lh-label)     var(--font-ui);
              letter-spacing: var(--ls-label); text-transform: uppercase; color: var(--text-3); }
```

### 3. Prymitywy: karta, przycisk, wiersz listy, stan wciśnięcia

```css
/* KARTA: jedna definicja zamiast 9 kopii cardStyle */
.card {
  background: var(--surface);
  border-radius: var(--r-lg);
  padding: var(--sp-4);
  box-shadow: var(--elev-1);
  border: var(--hairline) solid var(--border);
}
.card-hero {
  background: var(--surface);
  border-radius: var(--r-xl);
  padding: var(--sp-6) var(--sp-5);
  box-shadow: var(--elev-2);
  border: var(--hairline) solid var(--border);
}

/* STAN WCIŚNIĘCIA: to jest ta zmiana, która sprawia, że "wygląda jak apka" */
.press {
  transition: transform var(--dur-fast) var(--ease-out),
              background-color var(--dur-instant) linear,
              box-shadow var(--dur-fast) var(--ease-out);
  will-change: transform;
}
.press:active { transform: scale(0.97); }
.press-lg:active { transform: scale(0.985); }   /* dla dużych kart, mniejszy skok */

/* PRZYCISKI */
.btn {
  min-height: var(--ctrl-md);
  padding: 0 var(--sp-5);
  border-radius: var(--r-md);
  border: none;
  font: 600 var(--fs-callout)/1 var(--font-ui);
  display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-2);
  cursor: pointer;
}
.btn-primary   { background: var(--primary); color: var(--primary-text);
                 box-shadow: var(--glow-primary); }
.btn-primary:active { background: var(--primary-hover); }
.btn-secondary { background: var(--surface-2); color: var(--text);
                 border: var(--hairline) solid var(--border); }
.btn-ghost     { background: transparent; color: var(--primary); }
.btn-lg        { min-height: var(--ctrl-lg); font-size: var(--fs-body); width: 100%; }
.btn:disabled  { opacity: 0.45; cursor: not-allowed; box-shadow: none; }

/* WIERSZ LISTY: cały klikalny, nie sam checkbox */
.row {
  display: flex; align-items: center; gap: var(--sp-3);
  min-height: var(--ctrl-lg);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  background: transparent;
}
.row:active { background: var(--surface-2); }

/* FOCUS dla klawiatury i dostępności */
:where(button, a, input, textarea, select, [tabindex]):focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--r-sm);
}

/* SZANUJ USTAWIENIA UŻYTKOWNIKA */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* SKELETON z połyskiem zamiast pulsującego szarego prostokąta */
@keyframes shimmer { to { background-position-x: -200%; } }
.skeleton {
  border-radius: var(--r-sm);
  background: linear-gradient(90deg,
    var(--surface-2) 0%, var(--surface-3) 40%, var(--surface-2) 80%);
  background-size: 200% 100%;
  animation: shimmer 1.4s var(--ease-in-out) infinite;
}
```

### 4. Zasady ruchu (co animować, czego nie)

| Sytuacja | Właściwość | Czas | Krzywa |
|---|---|---|---|
| Wciśnięcie przycisku / karty | `transform: scale` | `--dur-fast` 140 ms | `--ease-out` |
| Zmiana koloru, stan aktywny | `background-color`, `color` | `--dur-instant` 90 ms | `linear` |
| Checkbox, plakietka pojawia się | `transform: scale` | `--dur-base` 220 ms | `--ease-spring` |
| Rozwinięcie szczegółów | `opacity` + `transform: translateY(-4px)` | `--dur-base` | `--ease-out` |
| Przejście panelu / arkusz dolny | `transform: translateX/Y` | `--dur-slow` 320 ms | `--ease-out` |
| Wypełnienie postępu, pierścień | `stroke-dashoffset`, `width` | `--dur-celebrate` 520 ms | `--ease-out` |
| Ekran wchodzi | `opacity` 0 do 1 + `translateY(8px)` | `--dur-base` | `--ease-out` |

Czego nie animować nigdy: `height`, `max-height`, `width`, `top/left`, `box-shadow`, `filter` na dużych obszarach. To są właściwości, które zmuszają przeglądarkę do przeliczania układu w każdej klatce i to jest dokładnie ta "szarpanina", którą widać dziś przy karuzeli (`dashboard:978`) i przy `animation: expandIn` z `max-height` (`dashboard:1830-1832`).

Zamiast `expandIn` na `max-height`:

```css
@keyframes revealIn {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.reveal { animation: revealIn var(--dur-base) var(--ease-out); }
```

### 5. Haptics (Android) plus wizualny odpowiednik dla iOS

Plik do utworzenia: `src/lib/haptics.ts`

```ts
type Pattern = "tap" | "success" | "warn" | "error" | "select";

const PATTERNS: Record<Pattern, number | number[]> = {
  select: 8,
  tap: 12,
  success: [14, 40, 22],
  warn: [18, 60, 18],
  error: [30, 50, 30, 50, 30],
};

let enabled = true;
export function setHapticsEnabled(v: boolean) { enabled = v; }

/** Wibracja: działa na Androidzie (Chrome). iOS Safari/PWA nie wspiera vibrate. */
export function haptic(p: Pattern = "tap") {
  if (!enabled) return;
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try { navigator.vibrate(PATTERNS[p]); } catch { /* cicho */ }
}
```

Użycie: `haptic("select")` przy zaznaczeniu checkboxa, `haptic("success")` przy 100% dnia, `haptic("error")` przy nieudanym zapisie. Na iPhonie funkcja po prostu nic nie zrobi, dlatego stan wciśnięcia (`.press`) i animacja `--ease-spring` na checkboxie są obowiązkowe: one działają na każdym telefonie.

### 6. Kierunki wizualne (do wyboru, z rekomendacją)

#### Kierunek A: "Neon Noir" (REKOMENDOWANY)

Ciemna baza, neon tylko jako sygnał. Wprost z ikony.

| Rola | HEX ciemny | HEX jasny |
|---|---|---|
| Tło | `#0A0A0F` | `#F6F6F8` |
| Powierzchnia | `#15151C` | `#FFFFFF` |
| Powierzchnia 2 | `#1D1D26` | `#F1F1F5` |
| Tekst | `#F4F4F7` | `#101018` |
| Tekst 2 | `#B4B4C2` | `#4A4A58` |
| Primary (magenta) | `#FF2D95` | `#C4006E` |
| Accent (cyan) | `#22D3EE` | `#0E7490` |
| Highlight (żółty) | `#FFC800` | `#B45309` |
| Sukces | `#2EE6A8` | `#0E9F6E` |
| Błąd | `#FF4D5E` | `#C81E3A` |

Zasady użycia, bez których to się zamieni w choinkę:
- Magenta wyłącznie dla akcji głównej i tożsamości (aktywna zakładka, główne CTA, pierścień dnia). Maksymalnie jeden element magenta na ekran w polu widzenia.
- Cyan wyłącznie dla danych i linków (wykresy, postęp, "zobacz wszystkie").
- Żółty wyłącznie dla ostrzeżeń i podkreśleń tekstu (jedna rzecz na ekran).
- Neon nigdy pod długi tekst. Treść zawsze `--text`.
- Zero gradientów tęczowych. Jedyny dozwolony gradient: `linear-gradient(160deg, #FF2D95 0%, #7B2BFF 100%)` na hero pierścieniu i na przycisku instalacji.

Dlaczego to rekomenduję: ikona jest już zrobiona i jest mocna, a to jedyna rzecz w tym produkcie, która dziś wygląda drogo. Ciemne tło z neonowym akcentem to język, który użytkownik zna z Whoop, Strava Night, Oura i Apple Fitness, a w kategorii "osobista transformacja" czyta się jako sprzęt sportowy, nie jak arkusz kalkulacyjny. Do tego właściciel używa telefonu wieczorem: ciemny motyw to realna wygoda, nie moda. Ryzyko jest znane i sterowalne: neon psuje czytelność, dlatego powyżej stoją twarde limity użycia.

#### Kierunek B: "Studio Light"

Jasny, ciepły, papierowy. Baza `#FAFAF7`, tekst `#16161A`, jeden akcent atramentowy `#1B1B1F` i jeden sygnałowy magenta `#C4006E`. Dane w skali szarości plus jeden kolor. Bliżej Things 3 i Bear. Bardzo elegancki, bardzo bezpieczny, ale nie ma nic wspólnego z ikoną i wieczorem świeci w oczy.

#### Kierunek C: "Ink and Signal"

Neutralny slate w obu trybach (to, co jest dziś, tylko poprawione), jeden akcent indygo `#4F46E5`. Najtańszy do wdrożenia, bo część kolorów już siedzi w kodzie. Wada: to jest wygląd domyślnego szablonu, czyli dokładnie to, na co właściciel narzeka.

**Werdykt: A**, z trybem jasnym jako pełnoprawnym bliźniakiem (te same tokeny, inne wartości). B trzymamy jako plan awaryjny, gdyby testy czytelności na słońcu wypadły źle. C odrzucam, bo nie rozwiązuje problemu "generyczne".

### 7. Karty i układ: co konkretnie zmienić na ekranach

#### Dashboard (`src/app/(app)/dashboard/page.tsx`)

Dziś: nagłówek, cienki pasek postępu 6 px (`:889`), trzy zakładki `BigTabs`, karuzela z trzema panelami, kropki, pole wprowadzania. Wszystko na jednym poziomie ważności.

Proponuję:
1. **Hero dnia** zamiast paska 6 px: karta `.card-hero` z pierścieniem 180 px i liczbą `t-display` w środku ("62%"), pod nią jedna linia `t-callout` ("5 z 8 zadań, zostały 3"). To jest jedyna rzecz, którą widać z odległości ręki.
2. **Bento 2x2 pod hero**: Energia, Nastrój, Sen, Spalone. Każdy kafelek: ikona 20 px w rogu, liczba `t-metric`, etykieta `t-label`. To zastępuje rozjechaną sekcję Statystyki (`:1480-1547`), w której dziś sześć poziomów tekstu walczy o uwagę.
3. **Plan dnia jako lista z sekcjami**, nie karta w karcie. Nagłówki "RANO / POPOŁUDNIE / WIECZÓR" jako `t-label` przyklejone do góry przy przewijaniu (`position: sticky`). Wiersz: `.row` min. 56 px, checkbox 24 px z polem dotyku 44 px, nazwa `t-body` 17 px, godzina `t-footnote` po lewej w kolumnie stałej szerokości 48 px.
4. **"Wygeneruj plan dnia" schodzi na dół** albo do przycisku pływającego, gdy plan jest pusty. Dziś to pierwsza rzecz na ekranie (`:980`), a użytkownik z gotowym planem widzi ją codziennie bez potrzeby.
5. **Karuzelę zamieniam na sekcje na jednej stronie** (przewijanie w pionie), a Briefing zostaje kartą z przyciskiem "Odsłuchaj". Powód: karuzela ukrywa dwie trzecie zawartości i wymusza hack z `height: 0` (K7). Jeżeli karuzela ma zostać, panele muszą mieć stałą wysokość kontenera i `visibility: hidden` zamiast `height: 0`.

#### Dieta (`src/app/(app)/diet/page.tsx`)

Dziś: pierścień 200 px (dobry pomysł), pod nim pięć identycznych wierszy (`:1938-1967`), trzy paski makro, ramka z celem dziennym 11 px.

Proponuję:
1. Pierścień zostaje jako hero, ale liczba w środku idzie na `--fs-display` 44 px (dziś 36 px, `:259`) i staje się jedyną dużą liczbą na ekranie.
2. Pod pierścieniem trzy kafelki w rzędzie: Zjedzone, Spalone, Bilans. Liczba `t-metric` 32 px, etykieta `t-label`. Bilans dostaje kolor semantyczny.
3. Pozostałe wiersze (BMR, aktywności, spalanie do godziny) chowam pod rozwijane "Szczegóły spalania". To jest wiedza kontrolna, nie codzienna decyzja.
4. Paski makro: podnieść etykiety z 12 px na 13 px, wysokość paska z 8 px na 10 px, dodać wartość docelową jako cienką kreskę na pasku.
5. "Cel dzienny 11 px" (`:2003`) idzie do stopki karty jako `t-footnote` 13 px.

#### Cele (`src/app/(app)/goals/page.tsx`)

1. Tytuł celu z 15 px na 17 px `t-title3` (`:1525`).
2. Pierścień 40 px z tekstem 11 px w środku (`:1483-1519`) zamieniam na: pierścień 52 px bez tekstu w środku plus procent jako `t-metric` obok tytułu. Dziś najważniejsza liczba jest najmniejszym tekstem w karcie.
3. Plakietka "Plan dostępny" (`:1586-1602`) przestaje być pełnokolorowa: `--primary-soft` jako tło, `--primary` jako tekst. Kolor pełny zostaje zarezerwowany dla akcji, nie dla statusu.
4. Ikony edycji i usuwania (28 px, `:113-127`) idą do jednego przycisku "..." 44x44 px, który otwiera arkusz dolny z opcjami. Usuwanie z potwierdzeniem, jak dziś (`confirmDeleteGoal`), ale bez ryzyka trafienia palcem w kosz.
5. Przyciski zadań "Zaplanuj" i feedback (`:2185-2213`, 11 px, 24 px wysokości) do `.btn` 36 px minimum, z polem dotyku 44 px.

#### Nawyki, Dziennik, Tracking

Ten sam schemat: hero z jedną liczbą (seria dni / wpisy w tygodniu / średnia energia), potem lista `.row` 56 px, potem akcje. Przycisk "+ Dodaj" z kreskowanej ramki (`habits:313-331`, `goals:923-942`) zamieniam na pełny `.btn-primary` przyklejony do dołu ekranu nad nawigacją: dodawanie to główna akcja tych ekranów, a dziś wygląda jak element wyłączony.

### 8. Ikony: co zrobić z emoji

- **Zostawić emoji** tam, gdzie to treść wybrana przez człowieka: awatary mentorów (`goals:1560`, `MentorCard.tsx`), nastrój (`dashboard:127-133`), ikonki pory dnia w nawykach (`habits:379`).
- **Zamienić na wektory** wszędzie tam, gdzie emoji udaje ikonę systemową: 8 zakładek nawigacji (`BottomTabBar.tsx:16-23`), przyciski akcji (`dashboard:1023`, `:1048`, `:1077`, `:2225`, `diet:2088`, `:2099`), nagłówki sekcji (`diet:1880`, `dashboard:1269`, `:1659`).
- Zestaw: jeden komplet konturowy 24 px, grubość linii 1,75 px, zaokrąglone końce. W kodzie już są takie SVG (ptaszek `dashboard:2107-2119`, strzałka `UniversalInputBar:233-246`), więc styl jest ustalony, wystarczy go dokończyć.
- Po tej zamianie znikają hacki `filter: brightness(0) invert(1)` (`UniversalInputBar.tsx:275`, `BottomTabBar.tsx:158`).

### 9. Nawigacja dolna: konkret

```
Dziś (8 zakładek, pasek szerszy niż ekran):
Dashboard | Cele | Nawyki | Dziennik | Dieta | Debata | Mentorzy | Admin

Proponuję (5 zakładek, bez przewijania):
Dziś | Plan | Dieta | Mentorzy | Więcej
                                  └─ Nawyki, Dziennik, Debata, Tracking, Admin
```

Parametry paska: wysokość 56 px plus `env(safe-area-inset-bottom)`, ikona 26 px, etykieta `t-label` 12 px (dziś 10 px), aktywna zakładka: ikona wypełniona plus kolor `--primary`, nieaktywna: kontur plus `--text-3`. Wskaźnik aktywnej: kropka 4 px pod ikoną albo podświetlona pigułka `--primary-soft`, animowana `transform` przez 220 ms.

### 10. Bezpieczne obszary ekranu (2 zmiany, 3 linie)

W `src/app/layout.tsx:17-23`:

```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",        // DODAĆ: bez tego env(safe-area-*) zwraca 0
  maximumScale: 5,             // ZMIENIĆ z 1
  userScalable: true,          // ZMIENIĆ z false
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F6F8" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0F" },
  ],
};
```

W `src/app/(app)/layout.tsx:58-62`:

```tsx
<main
  style={{
    paddingTop: "env(safe-area-inset-top, 0px)",
    paddingBottom: "calc(72px + env(safe-area-inset-bottom, 0px))",
  }}
>
```

### 11. Kolejność zamian tekstu (mechaniczna, do zrobienia plik po pliku)

| Było | Ma być | Gdzie to boli najbardziej |
|---|---|---|
| 10 px | usunąć | `BottomTabBar.tsx:188` |
| 11 px | 13 px (`t-footnote`) | `goals:1555`, `:2209`, `diet:2003` |
| 12 px | 13 px, a dla etykiet sekcji 12 px `t-label` z wersalikami | `diet:328`, `dashboard:1370` |
| 13 px (treść) | 17 px (`t-body`) | `dashboard:1337`, `diet:311` |
| 14 px (treść) | 17 px (`t-body`) | `dashboard:2140`, `diet:103` |
| 14 px (nagłówek karty) | 17 px (`t-title3`) | `dashboard:981`, `:1268` |
| 16 px (h2/h3, 26 wystąpień) | 22 px (`t-title2`) | `dashboard:1368`, `diet:1932` |
| 24 px / 28 px (h1, 3 różne) | 28 px (`t-title1`) wszędzie | `dashboard:862`, `diet:1880`, `admin:271` |

---

## Ryzyka

1. **Podniesienie tekstu z 13 px na 17 px zmienia wysokość każdego ekranu.** Wszystko, co ma stałą wysokość lub `whiteSpace: "nowrap"` z `textOverflow: ellipsis`, zacznie ucinać wcześniej (np. `dashboard:1341-1343`, `goals:1531`). Trzeba przejść listy i pozwolić na dwie linie tam, gdzie nazwy są długie. To jest największa praca w całej migracji, nie sam CSS.
2. **Tryb ciemny odsłoni 7 zaszytych `#fff` i 16 zaszytych ciemnych tekstów** (K4). Jeżeli włączymy dark przed ich usunięciem, ekran Tracking pokaże białe prostokąty, a `WeeklyCheckinForm` będzie miał biały tekst na białym tle. Kolejność jest obowiązkowa: najpierw sprzątanie kolorów, potem przełącznik.
3. **Aliasy zgodności wstecznej są konieczne.** W kodzie jest 20 wystąpień `var(--card-shadow)`, dziesiątki `var(--card)`, `var(--muted)`, `var(--foreground)`. Jeżeli nowe tokeny zastąpią stare bez aliasów, część aplikacji straci kolory w jednym commicie. Blok "ZGODNOŚĆ WSTECZNA" w sekcji 1 musi wejść razem z resztą.
4. **`--muted: var(--text-3)` zmienia znaczenie.** Dziś `--muted` (#94a3b8) jest używany i jako kolor tekstu pomocniczego, i jako kolor tła (`UniversalInputBar:225` `background: busy ? "var(--muted)"`). Po zmianie odcienia trzeba sprawdzić te miejsca, bo tło zrobi się jaśniejsze lub ciemniejsze niż dziś.
5. **Zmiana `userScalable` na `true` może rozjechać układy** na stronach, które zakładają brak powiększania (modale `position: fixed`). Trzeba to sprawdzić na realnym telefonie, nie w symulatorze.
6. **Redukcja zakładek z 8 do 5** to zmiana nawigacji, nie stylu. Ścieżki `/habits`, `/journal`, `/roundtable`, `/tracking`, `/admin` muszą dalej działać z linków bezpośrednich (są używane m.in. w `dashboard:1272`, `:931`, `:1550`), więc "Więcej" musi być ekranem, a nie tylko rozwijanym menu.
7. **Neon łatwo przesadzić.** Jeżeli magenta trafi na więcej niż jeden element w polu widzenia, efekt będzie tani zamiast drogi. To ryzyko dotyczy wykonawcy, nie technologii: limity użycia z sekcji 6 muszą być w specyfikacji, inaczej wróci "choinka".
8. **Wibracje nie zadziałają na iPhonie** (brak `navigator.vibrate` w Safari i w PWA na iOS). Jeżeli haptics zostanie sprzedany jako funkcja produktu, na iOS trzeba to zastąpić animacją i dźwiękiem, inaczej użytkownik iPhone'a uzna, że coś jest zepsute.
9. **Karuzela**: zamiana na przewijanie pionowe zmienia nawyk osoby, która używa aplikacji codziennie. Warto pokazać jeden ekran do akceptacji przed przebudową wszystkich trzech paneli.
10. **Migracja 21 000 linii stylów inline nie może iść naraz.** Bezpieczna kolejność: tokeny i aliasy, potem `.press` i cele dotykowe (największy efekt, najmniejsze ryzyko), potem typografia strona po stronie, na końcu tryb ciemny i kierunek kolorystyczny. Każdy krok kończy się buildem i sprawdzeniem na telefonie.

---

## Czego NIE sprawdziłem

- Nie uruchomiłem aplikacji ani nie zrobiłem zrzutów ekranu: ocena hierarchii pochodzi z kodu i z wyliczonych rozmiarów, nie z renderu na urządzeniu. Kontrast kolorów w tabelach palet policzyłem z wartości HEX, ale nie zweryfikowałem narzędziem na żywym ekranie.
- Nie sprawdziłem ekranów: Admin (2267 linii), Mentorzy (1301), Debata (1138), Dyscyplina (974), Dziennik (619). Znaleziska K1 do K5 opierają się na pomiarach z całego katalogu `src`, więc dotyczą także tych plików, ale konkretne propozycje układu (sekcja "Karty i układ") napisałem tylko dla ekranów, które przeczytałem w całości: Dashboard, Dieta, Cele, Nawyki, shell i nawigacja.
