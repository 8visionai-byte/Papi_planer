# ROADMAP: wdrożenie PAPI PLANER do wejścia komercyjnego

Data: 2026-07-25
Podstawa: `DESIGN-SPEC.md`, `BRAIN-SPEC.md`, audyty 01-05
Status: plan wdrożenia. Ten dokument NIE zmienia żadnego pliku aplikacji.

---

## Zasada nadrzędna

**Po każdym etapie aplikacja jest używalna i można ją pokazać.** Żaden etap nie zostawia
aplikacji w stanie "w połowie przepisana". Nie ma wielkiego przepisania: 21 000 linii stylów
inline zostaje na miejscu, a zmieniamy je warstwami.

Etapy P0 (1-4) to bilet wstępu: bez nich nie ma mowy o "premium".
Etapy P1 (5-7) budują wrażenie, że aplikacja jest droga.
Etap P2 (8) to dopieszczenie.

**Liczba pozycji P0: 21.**

---

## Przegląd

| Etap | Nazwa | Priorytet | Ryzyko regresji | Widoczne dla użytkownika |
|---|---|---|---|---|
| 1 | Fundament: tokeny, dotyk, haptyka | **P0** | NISKIE | Wszystko reaguje na palec i wibruje |
| 2 | Ekran telefonu: safe area, klawiatura, przewijanie | **P0** | **WYSOKIE** | Nic nie chowa się pod paskiem gestów, klawiatura nie zasłania pola |
| 3 | Palce i czytelność: cele dotykowe, tekst, mniej informacji | **P0** | ŚREDNIE | Da się trafić i da się przeczytać |
| 4 | Mózg część 1: kontekst, czat 1:1, waga | **P0** | ŚREDNIE | Mentor wie, kim jestem |
| 5 | Płynność i sieć: karuzela, prefetch, offline | P1 | ŚREDNIE | Aplikacja jest szybka i działa bez internetu |
| 6 | Nawigacja i tryb ciemny | P1 | ŚREDNIE | Widać wszystkie zakładki, wieczorem nie razi |
| 7 | Mózg część 2: pamięć długoterminowa | P1 | ŚREDNIE | Aplikacja uczy się użytkownika |
| 8 | Dopieszczenie | P2 | NISKIE | Gesty, onboarding, splash |

---

# ETAP 1 (P0). Fundament: tokeny, dotyk, haptyka

**Ryzyko regresji: NISKIE.** Nic nie zmienia układu ekranu.

To jest etap o najlepszym stosunku efektu do ryzyka w całym planie. Po nim aplikacja
**odczuwalnie** przestaje być stroną WWW, mimo że nie zmienia się ani jeden układ.

### Zadania

**P0-1. Tokeny CSS w `src/app/globals.css`**
Wkleić blok z `DESIGN-SPEC.md` sekcja 3 zamiast obecnych linii 3-21.
Zostawić `@keyframes spin`, `pulse`, `checkmark`, `fadeIn` (linie 27-63) bez zmian, są używane.
**Obowiązkowo razem z blokiem "ZGODNOŚĆ WSTECZNA"**: w kodzie jest ok. 20 wystąpień
`var(--card-shadow)` i dziesiątki `var(--card)`, `var(--muted)`, `var(--foreground)`.
Bez aliasów pierwszy commit rozbiera pół aplikacji.

**P0-2. Globalna reakcja na dotknięcie**
Ta sama wklejka, sekcja "REAKCJA NA DOTKNIĘCIE". Działa na wszystkie `<button>`
i `[role="button"]` w aplikacji **bez zmiany choćby jednego komponentu**, bo to selektor CSS.
Dziś w aplikacji jest **zero** wystąpień `:active`.
Wciśnięcie 60 ms, powrót 260 ms sprężyną.

**P0-3. Moduł haptyki `src/lib/haptics.ts` (nowy plik)**
Kod z audytu 05 sekcja 1: wzorce, przełącznik w `localStorage`, `MIN_GAP_MS` 40 ms
przeciw serii wibracji, sprawdzenie `document.hidden`.
Wpiąć w **17 miejsc** z tabeli wpięć (audyt 05 sekcja 2), najważniejsze:
`habits:141` i `dashboard:386` (odhaczenie), `BottomTabBar:168` i `BigTabs:31` (zakładki),
`MentorChat:171` (wysłanie), `dashboard:679/720` (sukces), `dashboard:682/724` (błąd).
**Zasada: wibrujemy w momencie dotknięcia, nie po odpowiedzi serwera.**

**P0-4. Trzy pierwsze prymitywy**
`src/components/ui/Pressable.tsx`, `Button.tsx`, `Card.tsx` wg API z `DESIGN-SPEC.md` sekcja 5.
Na tym etapie **nie podmieniamy jeszcze użyć**, tylko wystawiamy komponenty.

### Jak weryfikujemy

1. `npm run build` przechodzi.
2. Na telefonie: dotknąć dowolnego przycisku i zobaczyć, że się kurczy. Dziś nie kurczy się nic.
3. Na Androidzie: odhaczyć nawyk i poczuć wibrację. Na iPhonie wibracji nie będzie (patrz niżej).
4. Grep: `var(--card-shadow)` nadal działa, nic nie straciło koloru. Przejść wszystkie 14 stron.
5. Sprawdzić, że przełącznik "Wibracje" w Ustawieniach faktycznie je wyłącza.

### Uwaga o iPhone

`navigator.vibrate` **nie istnieje w Safari na iOS**, także w zainstalowanej PWA.
Na iPhone wrażenie "wciśnięcia" robi wyłącznie animacja z P0-2. Dlatego P0-2 i P0-3 idą razem
i dlatego haptyki nie wolno sprzedawać jako funkcji dla obu platform.

---

# ETAP 2 (P0). Ekran telefonu: safe area, klawiatura, przewijanie

**Ryzyko regresji: WYSOKIE.** To musi wejść jako **jeden commit** i być sprawdzone na
fizycznym telefonie, nie w symulatorze przeglądarki.

Dlaczego jeden commit: dziś w kodzie jest 6 miejsc, które liczą `env(safe-area-inset-*)`,
i wszystkie zwracają **0**, bo w `src/app/layout.tsx:17-23` brakuje `viewportFit: "cover"`
(sprawdzone: fraza nie występuje nigdzie w repo). Włączenie tej jednej linijki budzi
sześć uśpionych obliczeń naraz i **psuje siedem innych miejsc**, które mają sztywne
`bottom: 80` lub `bottom: 90`.

### Zadania

**P0-5. Viewport w `src/app/layout.tsx`**
```ts
viewportFit: "cover",                  // budzi env(safe-area-inset-*)
interactiveWidget: "resizes-content",  // klawiatura Androida nie zasłoni pola pisania
maximumScale: 5,                       // z 1
userScalable: true,                    // z false (WCAG 1.4.4)
themeColor: [ jasny #F6F6F8, ciemny #0A0A0F ]
```
Typy potwierdzone w `node_modules/next/dist/lib/metadata/types/extra-types.d.ts:52-53`.
**Warunek:** `userScalable: true` wchodzi tylko razem z P0-13 (pola tekstowe 17 px).
Jeśli pola zostaną 14 px, Safari zacznie przybliżać przy każdym kliknięciu w pole.
To znaczy: **etap 2 i zadanie P0-13 z etapu 3 muszą być w tym samym commicie**, albo
`userScalable` zostaje na `false` do etapu 3.

**P0-6. Górny margines bezpieczeństwa w `src/app/(app)/layout.tsx:58-62`**
`paddingTop: "var(--safe-t)"` plus lewy i prawy. Dziś `main` nie ma **żadnego** górnego
paddingu, a `statusBarStyle` to `"black-translucent"` (`layout.tsx:13` i meta w `:33`),
czyli webview rozciąga się pod pasek statusu. Bez tej linijki nagłówek "Dzień dobry"
(`dashboard:862`) wejdzie pod zegar iPhone'a.

**P0-7. Siedem sztywnych `bottom` na token**
`dashboard:1805`, `diet:2388`, `goals:1380`, `habits:645`, `journal:593`, `roundtable:596`,
`WeightTracker:322` z `bottom: 80` / `90` na `bottom: "var(--above-tabbar)"`.
Dziś pasek ma 64 px + 0 safe-area, więc 80 daje 16 px zapasu. Po włączeniu `cover`
pasek urośnie do ok. 98 px i te siedem elementów zniknie pod nim.

**P0-8. Przewijanie: `overscroll-behavior`**
`body { overscroll-behavior-y: none }` (już w bloku tokenów) plus klasa `.papi-scroll`
w **7 kontenerach**: `dashboard:1691`, `discipline/[slug]:939`, `journal:568`,
`roundtable:470`, `roundtable:850`, `MentorChat:363`, `MentorChat:444`.
Dziś `overscroll` ma **zero wystąpień** w całym `src/`.

**P0-9. Blokada przewijania tła pod modalami**
`src/hooks/useScrollLock.ts` (nowy, kod w audycie 05 sekcja 4) wpiąć w **11 modali**:
`dashboard:1625`, `:1804`, `goals:1307`, `:1378`, `habits:643`, `diet:2387`,
`journal:591`, `roundtable:595`, `admin:334`, `discipline/[slug]:920`, `FileList:124`,
`WeightTracker:321`. Jedyne poprawne dziś miejsce, `mentors:162-170`, podmienić na ten sam hook,
żeby nie było dwóch mechanizmów.

**P0-10. Naprawa wysokości**
`roundtable/page.tsx:280`: `height: "100dvh"` na `calc(100dvh - var(--tabbar-h) - var(--safe-b))`.
Dziś strona jest wyższa od ekranu o ok. 80 px i "dziwnie" się przewija.
`journal/page.tsx:567`: `100vh` na `100dvh`.

### Jak weryfikujemy

**Wymagany fizyczny telefon. Symulator przeglądarki nie odtwarza paska gestów.**

1. Android z paskiem gestów: dolny pasek zakładek nie leży pod paskiem systemowym, da się trafić w skrajną zakładkę.
2. iPhone z wcięciem (jeśli dostępny): nagłówek "Dzień dobry" nie wchodzi pod zegar.
3. Toast na Dashboardzie i przycisk na Diecie są widoczne, nie pod paskiem zakładek. Sprawdzić wszystkie 7 miejsc z P0-7.
4. Otworzyć czat z mentorem, kliknąć w pole: klawiatura **nie zasłania** pola pisania. To samo w `FollowUpSheet`, dodawaniu nawyku i dzienniku.
5. Otworzyć modal historii briefingów, przewinąć listę do końca: strona pod spodem **nie przewija się**.
6. Pociągnąć palcem w dół na górze Dashboardu: aplikacja **nie przeładowuje się**.
7. Otworzyć czat mentora i Debatę z otwartą klawiaturą: nic nie przeskakuje.

### Ryzyka tego etapu

- `interactiveWidget: "resizes-content"` zmienia wysokość widoku przy każdym otwarciu klawiatury. Przeskoczą elementy z `height: 100dvh` i `position: fixed; inset: 0` (`MentorChat:240`). Dlatego P0-10 jest w tym samym etapie.
- `useScrollLock` z `position: fixed` na `body` może mrugnąć w modalach z animacją wjazdu (`FollowUpSheet:38` ma `slideUp`). Jeśli wystąpi, włączać blokadę w `requestAnimationFrame`.

---

# ETAP 3 (P0). Palce i czytelność

**Ryzyko regresji: ŚREDNIE.** Zmienia wysokość każdego ekranu.

Twarda zależność: **podniesienie rozmiarów i ukrycie nadmiaru informacji muszą iść razem.**
Jeśli podniesiemy wszystko bez progressive disclosure, karta "Dzisiaj" w Diecie urośnie
o ok. 150 px i zarzut "za dużo informacji na początku" się pogłębi.

Wdrażać **ekran po ekranie**, w kolejności: Dashboard, Dieta, Cele, Nawyki, reszta.
Po każdym ekranie zrzut ekranu przy szerokości 360 px i 430 px.

### Zadania

**P0-11. Piętnaście scentralizowanych obiektów stylów na prymitywy**
To naprawia ok. 60% wszystkich przypadków jedną robotą. Pełna tabela w `DESIGN-SPEC.md`
sekcja 6.1. Najważniejsze:
- `btnSecondary` (`admin:112`, `mentors:83`): 29 px na 48 px, użyty w 7 miejscach
- `inputStyle` (5 kopii): 39 px na 52 px, `fontSize` 14 na 17
- `cardStyle` (**9 kopii**): jedna `<Card>`
- `iconBtnStyle` (`goals:113-127`): 28×28 na 44×44, obsługuje **usunięcie celu**
- `pill` (`admin:51-61`): 33 px na 44 px
- `BigTabs` (`BigTabs.tsx:32-44`): 42 px na 48 px

**P0-12. Checkboxy jako prawdziwe przyciski, cel 44 px**
Sześć miejsc: `dashboard:2087` (22×22), `dashboard:1875` (22×22), `dashboard:1302` (20×20),
`habits:704` (24×24), `goals:2105` (22×22), `goals:1925` (20×20).
Kwadrat widoczny zostaje 24-26 px, cel dotykowy 44 px przez `margin: -10`.
Zamiana `<div onClick>` na `<button role="checkbox" aria-checked>`.
**Uwaga:** zachować `e.stopPropagation()`, bo `dashboard:2071` ma `onClick={onExpand}`
na całym wierszu i bez tego odhaczenie zadania jednocześnie rozwinie szczegóły.

**P0-13. Pola tekstowe do 17 px**
Wszystkie pola w aplikacji mają dziś mniej niż 16 px, przez co Safari na iOS przybliża stronę.
Lista w audycie 01 K8. Po podniesieniu można bezpiecznie zdjąć blokadę zoomu z P0-5.

**P0-14. Typografia ekran po ekranie**
Mapowanie w `DESIGN-SPEC.md` sekcja 6.2. Skrótowo: 10 px i 11 px znikają,
12 px zostaje tylko na wersalikowe etykiety, treść idzie na 17 px, `h2` na 22 px,
`h1` na 28 px wszędzie (dziś trzy różne wartości na pięciu stronach).
**Nie robić globalnego "znajdź i zamień".** 144 wystąpienia `fontSize: 13` oznaczają
raz treść, raz podpis.

**P0-15. Progressive disclosure na trzech ekranach**
- **Dashboard:** karta "Wygeneruj plan dnia" (`dashboard:980-1248`, ok. 155 px na górze ekranu **codziennie**) pokazywana tylko gdy `totalActivities === 0`. Mini-widget Nawyków (`:1252`, dziś 5 pozycji) zwinąć do jednej linii `Nawyki 3/7` z rozwijaniem. Baner błędu Kalendarza (`:907`) na dyskretną ikonkę przy dacie.
  Efekt: plan dnia przestaje być **siódmym blokiem** na ekranie.
- **Dieta:** z 10 bloków karty "Dzisiaj" (`diet:1931-2012`) zostaje pierścień + wiersz "Pozostało". Cztery pozostałe wiersze `BreakdownRow`, trzy paski makro i ramka celu chowają się pod "Szczegóły bilansu".
- **Cele:** dwa mikro-przyciski przy każdym zadaniu (`goals:2185`, `:2201`, po 23 px, przy planie na 10 zadań to 20 mikro-przycisków na ekranie) znikają z wiersza. Dotknięcie zadania otwiera `<Sheet>` z akcjami po 48 px.

**P0-16. Siatka mentorów na stałe 2 kolumny**
`mentors/page.tsx:341`: `repeat(auto-fill, minmax(170px, 1fr))` na `repeat(2, 1fr)`.
Dziś na ekranie 430 px są 2 kolumny, a na 360 px **jedna**, czyli ten sam ekran wygląda
zupełnie inaczej na iPhonie i na typowym Androidzie.

**P0-17. Błędy zapisu przestają być ciche**
`habits:150` i `:159` oraz `dashboard:403` i `:446` cofają optymistyczną zmianę
**bez żadnego komunikatu**. Bez zasięgu wygląda to tak: klikam, zaznacza się, samo się odznacza.
Dopisać `showToast` (funkcja już istnieje, `habits:131-134`) plus `haptic("error")`.

### Jak weryfikujemy

1. Zrzut ekranu każdego z 14 ekranów przy 360 px i przy 430 px, przed i po.
2. Sprawdzić, czy nic się nie urywa: `dashboard:1343`, `:2143`, `habits:751`, `diet:2304`, `mentors:189-190`, `goals:1531` mają `whiteSpace: nowrap` + `ellipsis`, więc przy +25% wysokości tekstu zaczną ucinać wcześniej.
3. Kciukiem, w ruchu, odhaczyć 10 zadań pod rząd: żadnego chybienia.
4. Odhaczyć zadanie: wiersz **nie rozwija się** przy okazji.
5. iPhone: kliknąć w każde pole tekstowe. Strona **nie przybliża się**. Potem szczypnąć palcami: zoom działa (WCAG).
6. Włączyć tryb samolotowy i odhaczyć nawyk: pojawia się komunikat o braku połączenia.
7. Pierwszy i ostatni wiersz każdej listy: ujemny margines przy checkboxach nie przycina krawędzi w kontenerach z `overflow: hidden` (karuzela `dashboard:966`).

---

# ETAP 4 (P0). Mózg część 1

**Ryzyko regresji: ŚREDNIE.** Zmienia zachowanie wszystkich agentów AI.

Pełna specyfikacja w `BRAIN-SPEC.md`. Tu tylko kolejność i weryfikacja.

### Zadania

**P0-18. Moduł kontekstu `src/lib/ai/user-context.ts` (nowy)**
Jedna funkcja `buildUserContext(userId, { scope, lifeAreaId, maxChars })`.
8 sekcji, twardy budżet 6000 znaków (ok. 1700 tokenów).
**W pierwszej wersji owinąć zapytanie o `userInsight` w `try/catch` zwracający `[]`**,
bo tabela jeszcze nie istnieje (powstaje w etapie 7). Bez tego cała warstwa AI padnie.

**P0-19. Czat 1:1 dostaje kontekst**
Dwa pliki, po ok. 8 linii:
`src/app/api/mentor-chat/conversations/[id]/messages/route.ts` (dziś `system: conv.mentor.systemPrompt`
i nic więcej, sprawdzone osobiście w kodzie) oraz `src/app/api/mentor-chat/conversations/route.ts`
(pierwsza wiadomość rozmowy).
To jest **pojedyncza zmiana o największym efekcie odczuwalnym w całym planie mózgu.**

**P0-20. Waga zasila kalorie**
`getCurrentWeightKg(userId)`: najnowszy `WeightEntry` z 14 dni, fallback do profilu, fallback 80.
Trzy podmiany: `dashboard/route.ts:144`, `meals/route.ts:20`, `activities/toggle/route.ts:75`.

**P0-21. Zapis odpowiedzi po treningu**
Dziś `dashboard:1603-1609` wysyła tekst użytkownika do `/api/chat` i **ignoruje odpowiedź**,
a `/api/chat/route.ts` nic nie zapisuje. Odpowiedź użytkownika ma trafić do
`MentorConversation` jako wiadomość **oraz** do `TrainingLog.notes` lub `Activity.notes`.

### Jak weryfikujemy

1. Otworzyć czat z mentorem i zapytać: "ile ważę i jaki mam cel?". Mentor **musi** podać liczbę z profilu. Dziś odpowie ogólnikiem.
2. Zapytać: "co robiłem w tym tygodniu?". Mentor podaje realne dane z ostatnich 7 dni.
3. Wpisać nową wagę o 3 kg niższą, odświeżyć Dashboard: BMR i bilans kaloryczny **zmieniły się**.
4. Odhaczyć trening, odpowiedzieć na pytanie mentora, wejść w historię rozmowy z tym mentorem: **odpowiedź tam jest**.
5. Zmierzyć: dodać log `ctx.approxTokens` i sprawdzić, czy mieści się w 1700. Osobno zmierzyć `messages.count_tokens` na realnym profilu.
6. Sprawdzić czas odpowiedzi czatu przed i po. Jeśli wzrósł o więcej niż 500 ms, dodać cache 60 s per `(userId, scope)`.
7. Nowy użytkownik z pustą bazą: mentor **zadaje pytania**, nie zmyśla faktów.

### Ryzyka tego etapu

- Zmiana źródła wagi zmieni **historyczne** liczby w kalendarzu diety (BMR liczony jest w locie, nie zapisany). Użytkownik może zgłosić to jako błąd. Waga użyta jest już zapisywana w `Activity.metrics.weightUsed` (`activities/toggle/route.ts:84`), więc docelowo historyczne dni liczyć z niej.
- Kontekst zmieni ton odpowiedzi mentorów. Wdrożyć najpierw na **jednym** mentorze i pokazać jedną rozmowę do akceptacji.
- Okrągły Stół: kontekst poszedłby (2N+1) razy. Dlatego `scope: "debate"` ma `maxChars: 3000` i kontekst przekazywany raz, w bloku pytania bazowego (`roundtable/engine.ts:189-195`).

---

# ETAP 5 (P1). Płynność i sieć

**Ryzyko regresji: ŚREDNIE.** Service worker to największe pojedyncze ryzyko w całym planie.

### Zadania

**P1-1. Karuzela idzie za palcem**
Dziś `dashboard:791-820` liczy przesunięcie do `touchDeltaRef`, ale ta wartość **nigdy nie
trafia do stylu**: `transform` zależy wyłącznie od `activePanel` (`:973`). Czyli: ciągniesz
palcem, nic się nie rusza, puszczasz, panel przeskakuje.
**Sterować `transform` bezpośrednio przez `ref.current.style.transform` w `onTouchMove`,
NIE przez `useState`.** `setDragX` przy 60 zdarzeniach na sekundę przerysowałby cały Dashboard
(2609 linii, zero `React.memo` w aplikacji), czyli dałby efekt odwrotny do zamierzonego.
Plus `touchAction: "pan-y"` na kontenerze i opór 0,35 na krawędziach.

**P1-2. Koniec skoku wysokości karuzeli**
Dziś panele mają `height: activePanel === N ? "auto" : 0` (`:978`, `:1465`, `:1479`) przy
`overflow: hidden` na rodzicu. Wysokość zmienia się natychmiast, a `translateX` jedzie 300 ms.
Rozwiązanie: wszystkie panele w jednej komórce CSS Grid (`gridArea: "1 / 1"`), przełączanie
`opacity` + `pointerEvents` + `visibility`.

**P1-3. Prefetch nawigacji**
`BottomTabBar.tsx:168` używa `router.push` na zwykłym `<button>`, więc Next nie pobiera kodu
strony z wyprzedzeniem. Każde tapnięcie zakładki to: pobranie 50-100 KB, montowanie, dopiero
potem zapytanie o dane. Dodać `router.prefetch` dla widocznych zakładek po 1200 ms
plus prefetch na `onPointerDown`.

**P1-4. Google Kalendarz poza ścieżką krytyczną**
`src/app/api/dashboard/route.ts:97-181` robi 4 równoległe zapytania do bazy, a potem
**sekwencyjnie** dzwoni do Google (`:161`) i dopiero wtedy zwraca całość (`:183`).
Jeśli Google odpowiada 800 ms, plan dnia, nawyki i statystyki czekają te 800 ms, mimo że
są gotowe. Wydzielić `/api/dashboard/calendar` pobierane równolegle z klienta.
**Uwaga:** zmienia kształt odpowiedzi API. Pola `meetings` i `calendarError` są czytane
w `dashboard:839-848` i `:907-928`, więc trzeba przejść całą ścieżkę do `MeetingRow` i `toggleMeeting`.

**P1-5. Koniec podwójnych zapytań i wyścigów**
`dashboard:367-380` i `diet:1598-1613` mają ten sam handler pod `visibilitychange` **i** pod `focus`,
więc przy powrocie do aplikacji każde zapytanie leci dwa razy. Do tego brak `AbortController`
sprawia, że stara odpowiedź nadpisuje optymistyczny stan i ptaszek sam się odznacza.
Jeden handler z blokadą 5 s + `AbortController`.
Plus `<SessionProvider refetchOnWindowFocus={false}>` w `src/app/layout.tsx:39`.
**Uwaga:** `AbortError` musi być ignorowany w `catch`, inaczej użytkownik zobaczy "Błąd"
przy każdym przełączeniu karty. Poprawny wzorzec jest już w pliku (`dashboard:604`).

**P1-6. Service worker, który naprawdę działa**
Dziś `public/sw.js` ma 13 linii i cała obsługa `fetch` to `e.respondWith(fetch(e.request))`,
czyli przekaźnik 1:1 (odczytane). Bez internetu użytkownik dostaje dinozaura przeglądarki,
mimo że aplikacja jest zainstalowana. To najmocniejszy sygnał "to jest strona, nie aplikacja".
Wdrożyć wersję z audytu 05 sekcja 5: statyki cache-first, nawigacje network-first z ekranem
`/offline`, dane network-first z kopią awaryjną i **listą dozwolonych ścieżek** (bez `/api/admin/*`,
bez `/api/auth/*`), plus obsługa komunikatu `PAPI_CLEAR_DATA` przy wylogowaniu.
Dodać `src/app/offline/page.tsx` **poza** grupą `(app)`, żeby nie wymagał sesji.
Usunąć jeden z **dwóch** rejestratorów: `ServiceWorkerRegistrar.tsx` (`(app)/layout.tsx:6, 68`),
zostawić `ServiceWorkerRegister.tsx` (`layout.tsx:38`).
Usunąć z `package.json` martwą zależność `next-pwa` (`next.config.ts` jest pusty, potwierdzone).

**P1-7. Szkielety zamiast pustych ekranów**
`diet:1842-1864` blokuje całą stronę spinnerem. To samo `discipline/[slug]:192`
i powłoka `(app)/layout.tsx:21-43`. Zawsze renderować nagłówek i zakładki, w miejsce treści
szare bloki o **dokładnie tych samych wymiarach**, żeby nic nie skakało.
Usunąć `Math.random()` z `dashboard:182`: dziś szerokości pasków szkieletu losują się przy
każdym przerysowaniu, więc szkielet miga.

**P1-8. Optymistyczny zapis w Diecie**
`diet:1711-1746` i `:1765-1784` czekają na `POST /api/meals`, potem robią `fetchToday()`
i dopiero wtedy lista się zmienia. Dwa przeloty do serwera, zanim cokolwiek drgnie.
Wzorzec optymistyczny działa już na Dashboardzie (`:386-394`) i w Celach (`:316-325`).

**P1-9. Animacje na GPU**
Zamienić `width` na `scaleX` (`dashboard:896`, `habits:301`, `diet:382`, `MoodChart:95`,
`BriefingCard:305`, `FileUpload:199`), `max-height` na `opacity` + `translateY`
(`dashboard:1829-1832`), usunąć `transition: all` z 11 miejsc.
Checkboxy: zawsze `border: 2px solid` ze zmianą koloru, nigdy `border: none` przy zaznaczeniu,
bo dziś ptaszek przesuwa sąsiadów o 2 px (`dashboard:1317`, `:1902`, `:2103`).

**P1-10. Rozbicie stanu formularzy i memoizacja (w tej kolejności)**
Dziś każda litera w polu przerysowuje całą stronę: `planContext` na poziomie `DashboardPage`
(2609 linii), `editDraft` i `feedbackDraft` na poziomie `GoalsPage` (2405 linii),
7 stanów formularza posiłku w `DietPage`.
Wyciągnąć formularze do własnych komponentów z własnym stanem, oddających tekst dopiero
przy zatwierdzeniu. **Dopiero potem** `React.memo` + `useCallback` + `useMemo`
(dziś `React.memo` ma **zero** wystąpień, `useMemo` sześć).
**Odwrotna kolejność to strata czasu:** do kart trafiają dziś `Set` i obiekty
(`goals:1067`, `:1083`, `:1209`), które i tak zabiją memoizację.

**P1-11. Zdjęcie wagi z paczki**
- `recharts`: **380 KB surowo, 107 KB gzip**, tylko na `/tracking` (`EnergyChart:11`, `SleepChart:12`, `CompletionChart:11`). Aplikacja ma już własne wykresy w ręcznym SVG (`diet:783`, `diet:1119`, `MoodChart`). Krok 1: `next/dynamic` (zysk natychmiast, zero ryzyka). Krok 2, opcjonalny: przepisać w SVG.
- `date-fns` + polska lokalizacja: **47 KB surowo, 13 KB gzip** na `/dashboard`, użyte do **jednej** linijki (`dashboard:823`). Dieta robi to samo bez biblioteki: `toLocaleDateString("pl-PL", ...)` (`diet:154`).
- `next/dynamic` ma dziś **zero** wystąpień w całej aplikacji. Kandydaci: wykresy `/tracking`, `BalanceBarsChart` i `BurnEatLineChart` (są w zakładce "Kalendarz", a ładują się z kodem zakładki "Dzisiaj"), modal historii briefingów, `FollowUpSheet`, `MicDevicePicker`.

**P1-12. Panele karuzeli montowane leniwie**
Dziś wszystkie trzy panele są zawsze zamontowane, więc `WeightTracker` strzela
`fetch("/api/weight")` przy każdym wejściu na Dashboard, nawet jeśli użytkownik nigdy
nie przesunie na trzeci panel. Renderować panel po pierwszym wejściu, potem trzymać w pamięci.
**Dołożyć szkielet**, inaczej pierwsze przesunięcie pokaże pusty wykres na ok. 300 ms.

### Jak weryfikujemy

1. Lighthouse na telefonie z dławieniem "Slow 4G", przed i po. Zapisać liczby.
2. React Profiler przy wpisywaniu tekstu w "Wygeneruj z wkładem": liczba przerysowań przed i po.
3. Przesunąć karuzelę palcem: panel **jedzie za palcem**, wysokość nie skacze.
4. Tryb samolotowy, uruchomić aplikację z ikony: pojawia się **ekran offline aplikacji**, nie dinozaur.
5. Zapisać posiłek: pojawia się na liście **natychmiast**.
6. `npx next build`: rozmiar `/tracking` spadł z 311 KB gzip, `/dashboard` z 224 KB gzip.
7. Wrócić do aplikacji z tła i w ciągu 200 ms odkliknąć aktywność: ptaszek **nie odznacza się** sam.

### Ryzyka tego etapu

- **Service worker to największe ryzyko w całym planie.** Źle napisany potrafi zamrozić starą wersję aplikacji na telefonie i użytkownik nie zobaczy żadnej aktualizacji. Zasady: nigdy nie cache'ować `/api/auth/*` ani odpowiedzi POST, **podnosić numer wersji cache przy każdej zmianie pliku**, testować w trybie samolotowym i po powrocie sieci. Przed wejściem komercyjnym dodać przycisk "Odśwież aplikację" wołający `registration.update()` + `skipWaiting`.
- Cache danych to dane osobowe na dysku. Jeśli z telefonu korzysta więcej niż jedna osoba, bez `PAPI_CLEAR_DATA` przy wylogowaniu drugi użytkownik zobaczy cudze dane offline.

---

# ETAP 6 (P1). Nawigacja i tryb ciemny

**Ryzyko regresji: ŚREDNIE.** Zmiana nawigacji to decyzja produktowa, nie techniczna.

### Zadania

**P1-13. Dolna nawigacja: 5 zakładek zamiast 8**
Arytmetyka z odczytanego kodu: `BottomTabBar.tsx` definiuje 8 zakładek (`:15-24`),
dla zwykłego użytkownika 7. Każda ma `minWidth: 64` (`:179`), `gap: 4` (`:110`),
kontener `maxWidth: 430` z `padding: "0 8px"` (`:112-114`).
7 × 64 + 6 × 4 = **472 px** przy dostępnych 414 px, a na ekranie 360 px przy 344 px.
Pasek jest przewijalny, ale scrollbar jest **jawnie ukryty** (`:117` i reguła w `:199-203`),
nie ma gradientu ani strzałki. **Użytkownik nie ma jak się dowiedzieć, że Mentorzy i Debata istnieją.**
Docelowo: `Dziś | Plan | Nawyki | Dieta | Więcej`, gdzie "Więcej" to ekran lub arkusz
z Dziennikiem, Debatą, Mentorami, Trackingiem i Adminem.
5 × 64 + 4 × 4 = 336 px, mieści się nawet na 360 px.
**To wymaga zgody właściciela** (ryzyko R8 z DESIGN-SPEC): trzy funkcje znikają z pierwszego planu.
Linki bezpośrednie (`dashboard:1272`, `:931`, `:1550`) muszą dalej działać.
Wariant awaryjny, jeśli 8 zakładek ma zostać: `scrollSnapType: "x mandatory"` na kontenerze
plus gradient-cień na prawej krawędzi.

**P1-14. Ikony wektorowe zamiast emoji w nawigacji**
`BottomTabBar.tsx:16-23`. Komplet konturowy 24 px, linia 1,75 px, końce zaokrąglone.
Styl jest już ustalony w kodzie: ptaszek (`dashboard:2107-2119`), strzałka (`UniversalInputBar:233-246`).
Po zamianie znikają hacki `filter: brightness(0) invert(1)` (`UniversalInputBar:275`, `BottomTabBar:158`),
które są obejściem problemu, którego nie ma się z wektorami.
**Emoji zostają** tam, gdzie są treścią wybraną przez człowieka: awatary mentorów,
nastrój (`dashboard:127-133`), pory dnia (`habits:379`).

**P1-15. Przejścia między ekranami**
`experimental.viewTransition: true` w `next.config.ts` (dziś plik jest pusty, potwierdzone) plus
`router.push(path, { transitionTypes: ["nav-forward" | "nav-back"] })` w `BottomTabBar`.
Dolny pasek nie ma się ruszać: `viewTransitionName: "papi-tabbar"` na `<nav>`.
**Bez prefetchu z P1-3 animacja tylko uwydatni czekanie**, więc P1-3 musi być wcześniej.
Nazwa importu (`ViewTransition` czy `unstable_ViewTransition` z `react`) do potwierdzenia
przy pierwszym buildzie.

**P1-16. Sprzątanie zaszytych kolorów (WARUNEK trybu ciemnego)**
7 miejsc z `background: "#fff"`: `tracking:243`, `:272`, `:292`, `CompletionChart:67`,
`EnergyChart:67`, `SleepChart:70`, `WeeklyCheckinForm:197`.
16 miejsc z zaszytym ciemnym tekstem (`#0f172a`, `#64748b`), m.in. `tracking:91`,
`journal`, `InstallPrompt`, `MoodChart`.
Plus 82 wystąpienia `#fff` i 11 wystąpień `#1d4ed8` mimo istniejącego `var(--primary)`.
**Bez tego przełącznik trybu ciemnego pokaże białe prostokąty na wykresach Trackingu
i biały tekst na białym tle w `WeeklyCheckinForm`.**

**P1-17. Włączenie trybu ciemnego**
Tokeny są już w `globals.css` od etapu 1. Tu dochodzi tylko przełącznik w Admin > Ustawienia
ustawiający `<html data-theme="dark">` plus zapamiętanie wyboru.
Trzy stany: automatyczny (systemowy), jasny, ciemny.

**P1-18. Główne akcje w zasięgu kciuka**
Przyklejony `<StickyActionBar>` nad paskiem zakładek na Dashboardzie, Celach, Nawykach, Diecie.
Dowody, że dziś jest źle:
- Dashboard: trzy przyciski generowania planu leżą **221-317 px od góry**, czyli 28-40% ekranu od góry na Androidzie 360×800
- Dashboard: pasek "Co słychać?" (`:1591`) jest **na samym dole przewijanej treści**, ok. 980 px od góry, czyli najszybsze wejście danych jest schowane najgłębiej
- Dieta: "+ Dodaj posiłek" (`:2016`) leży **poniżej całej karty bilansu**, ok. 700 px od góry, a to akcja wykonywana 3-5 razy dziennie
Wzorzec do skopiowania jest już w aplikacji: Debata (`roundtable:440`) ma CTA na dole,
pełną szerokość, 47 px.

**P1-19. Kropki karuzeli jako przyciski**
`dashboard:1576-1585` to `<div>` bez `onClick`, czysta dekoracja. Użytkownik będzie w nie pukał.
Zamienić na `<button>` 44×44 z małą kropką w środku, animowaną `scaleX` zamiast `width`.

### Jak weryfikujemy

1. Wszystkie zakładki widoczne bez przewijania na ekranie 360 px.
2. Przejście między zakładkami: treść przesuwa się, pasek zakładek **stoi**.
3. Przełączyć na tryb ciemny i przejść **wszystkie 14 ekranów**: żadnego białego prostokąta, żadnego niewidocznego tekstu. Szczególnie: `/tracking`, `WeeklyCheckinForm`, wykresy.
4. Wejść w Dziennik, Debatę i Mentorów z ekranu "Więcej" oraz z linków bezpośrednich na Dashboardzie.
5. Główna akcja każdego ekranu jest w dolnej trzeciej części, osiągalna kciukiem bez przekładania telefonu.

---

# ETAP 7 (P1). Mózg część 2: pamięć długoterminowa

**Ryzyko regresji: ŚREDNIE.** Wymaga migracji Prisma na produkcji.

**Kolejność jest obowiązkowa: najpierw migracja, potem deploy kodu.**

### Zadania

**P1-20. Dwie nowe tabele**
`UserInsight` i `PlanOutcome` wg `BRAIN-SPEC.md` sekcja 4.2, plus relacje w modelu `User`.
`prisma migrate` na produkcji **przed** wdrożeniem kodu.
Po migracji zdjąć `try/catch` z zapytania o `userInsight` z etapu 4.

**P1-21. Plan dnia widzi wczoraj**
`plan-generator.ts:84-142` nie ładuje dziś briefingów, nawyków, treningów ani poprzednich dni.
Funkcja `loadRecentBriefings` **już istnieje** i jest używana w `activity-planner.ts:40-48`.
Po podpięciu modułu kontekstu mentor planujący dzień wie, że wczoraj było 2/10 i że
od tygodnia pomijana jest poranna medytacja.

**P1-22. Pętla uczenia się**
- Codziennie po `briefing/finalize` (`route.ts:92`): osobne pole w JSON odpowiedzi z 1-2 zdaniami trwałego wniosku, zapis do `UserInsight`
- Przy każdym `activities/toggle` i `mentor-plans/toggle-task`: licznik do `PlanOutcome`
- Przy `mentor-plans/task-feedback` (`route.ts:57`): feedback przepisany na `UserInsight`, żeby widzieli go **wszyscy** mentorzy, nie tylko autor planu
- Nowy cron niedzielny: z 7 briefingów i `PlanOutcome` zbuduj 3 wnioski tygodniowe, stare z tego samego obszaru oznacz `active: false`
- Reguła z odrzuceń: 3 pominięcia typu w 2 tygodnie = wniosek "pomija w 80%, proponować krótsze formy albo inną porę"

**P1-23. Naprawa jakości danych**
- `input/process/route.ts:60-65` tworzy `type: "manual"`, `completed: true`. `"manual"` nie ma MET-a w `calorie-calculator.ts:7-46`, a ukończona przy tworzeniu aktywność nie przechodzi przez `toggle`, więc aktywności zgłoszone głosem dodają **0 kcal**. Mapować nazwę na `VALID_ACTIVITY_TYPES` i liczyć kalorie od razu.
- `mentor-plans/schedule-task/route.ts:84-87` twardo ustawia `type: "training"`, więc "Przeczytaj rozdział o negocjacjach" dolicza ok. 400 kcal za godzinę "treningu". Wyprowadzić typ z `LifeArea.category`.

**P1-24. Stabilne ID zamiast dopasowania po tekście**
`activities/toggle/route.ts:288` porównuje `notes.includes("Z planu mentora")`, `:313` porównuje
`ts[i].title === activity.name`, a `:327` synchronizuje tylko gdy `matches.length === 1`.
Zmiana nazwy aktywności przez użytkownika albo dwa zadania o tym samym tytule = postęp celu
przestaje się aktualizować **bez żadnego komunikatu**.
Dodać `Activity.sourcePlanId` i `Activity.sourceTaskIndex`.

**P1-25. Treningi, rekordy, nawyki i dziennik w kontekście**
Sekcje 5, 6 i 7 modułu. Dziennik **tylko za zgodą**: flaga `shareJournalWithMentors`
w profilu, domyślnie wyłączona, plus dopasowanie po `LifeArea`, plus zawsze `redactedText`.

### Jak weryfikujemy

1. Odhaczyć 5 zadań i pominąć 5: sprawdzić w bazie, że `PlanOutcome` ma poprawne liczniki i `skippedByType`.
2. Po niedzielnym cronie: w `UserInsight` są 3 nowe wnioski z `periodLabel` bieżącego tygodnia, a stare z tego samego obszaru mają `active: false`.
3. Zapytać mentora "co u mnie nie działa?": odpowiada zdaniem z `UserInsight`, nie ogólnikiem.
4. Wygenerować plan dnia po dniu, w którym zrobiono 2/10: plan jest **lżejszy**.
5. Zgłosić aktywność głosem: bilans kaloryczny **zmienia się** (dziś dodaje 0 kcal).
6. Zaplanować zadanie "Przeczytaj rozdział" z planu mentora: **nie dolicza** kalorii treningowych.
7. Zmienić nazwę aktywności powstałej z planu mentora, odhaczyć ją: postęp celu **nadal się aktualizuje**.

---

# ETAP 8 (P2). Dopieszczenie

**Ryzyko regresji: NISKIE.** Wszystko jest addytywne.

### Zadania

**P2-1. Pull-to-refresh** na Dashboardzie, Nawykach, Celach, Diecie, Mentorach.
Hook `usePullToRefresh` z audytu 01 sekcja 9. Dziś **zero** implementacji: użytkownik nie ma
jak powiedzieć "sprawdź jeszcze raz" i zabija aplikację. Uwaga: wymaga zdjęcia
`overscroll-behavior-y: none` z `body` **tylko** na kontenerze, który obsługuje gest.

**P2-2. Swipe między zakładkami** w każdym `<Tabs swipeable>`. Skoro Dashboard ma swipe
między panelami, to samo powinno działać w Diecie, Celach i Dzienniku, inaczej użytkownik
uczy się gestu i przestaje mu ufać.

**P2-3. Swipe na wierszu: usuń i odłóż.** Rozwiązuje jednocześnie problem mikro-koszy
(`diet:2314`, 31 px). Klasyczny wzorzec iOS.

**P2-4. Swipe zmiany miesiąca** w kalendarzu diety (`diet:487-493`) plus powiększenie
strzałek `diet:442` i `:452` z 33 px do 44 px.

**P2-5. Arkusze zamiast systemowego `confirm()`.** 9 wystąpień: `dashboard:740`,
`habits:244`, `journal:312`, `goals:1250` i pozostałe. Okno systemowe wygląda jak strona WWW.

**P2-6. Long-press na wierszu** nawyku i aktywności otwierający edycję, z wibracją po 500 ms.
Hook `useLongPress` z audytu 05. Dziś long-press **nie istnieje nigdzie** w aplikacji.

**P2-7. Manifest, splash i skróty.** `background_color` z `#ffffff` na kolor motywu
(dziś splash Androida jest biały, pasek statusu ciemny `#0f172a`, a tło aplikacji jasnoszare:
trzy różne kolory w dwie sekundy). Dodać `id`, `display_override`, `shortcuts`
(Nawyki, Dziennik, Debata), `screenshots`. Wygenerować splashe iOS
(`npx pwa-asset-generator`, bez Pythona, zgodnie z regułą projektu).
Podmienić spinner z `(app)/layout.tsx:21-43` na ekran w kolorze `background_color` z logo,
żeby przejście splash na aplikację było bezszwowe. Dziś sekwencja startu to cztery różne widoki.

**P2-8. Onboarding.** Karta "Zacznij tutaj" z trzema krokami (dodaj nawyk, wygeneruj plan,
poznaj mentorów), znikająca po wykonaniu. Plus akcje w 36 pustych stanach: dziś
`habits:436-446` mówi "Dodaj swój pierwszy nawyk", ale **nie ma przycisku, który by to zrobił**.

**P2-9. Baner braku sieci.** `navigator.onLine` ma dziś **zero** wystąpień w `src/`.
Komponent `OfflineBanner` w powłoce, plus informacja "Dane z HH:MM" gdy service worker
odda kopię awaryjną (nagłówek `X-Papi-Stale`).

**P2-10. Dźwięk: jeden, domyślnie wyłączony.**
Rekomendacja: **nie robić dźwięków interfejsu.** Powody: aplikacja już gra briefing głosowy
(`BriefingCard:254`, `:261`), przeglądarka nie zna przełącznika ciszy telefonu (aplikacja,
która piknie na spotkaniu, jest odinstalowywana tego samego dnia), a `<audio>` przerywa
muzykę i podcasty. Jedyny wyjątek: krótki dźwięk po zamknięciu całego dnia, przez Web Audio API,
głośność maks. 0,12, poniżej 400 ms, **domyślnie wyłączony**.

**P2-11. Mózg P2:** konsensus Okrągłego Stołu do kontekstu plus przycisk "zastosuj w planie"
(dziś `applied` i `planChanges` **nigdy nie są ustawiane**, a UI pokazuje "Nie wdrożone",
`roundtable:1085`); analizy plików (`UserFile.analysis`) do kontekstu; checkin tygodniowy;
UI do edycji `Schedule` (dziś jedyne źródło to `prisma/seed.ts:403-471`); prompt caching.

**P2-12. Porządki.** `tabular-nums` na wszystkich metrykach (dziś 5 wystąpień na całą aplikację).
Przenieść `@keyframes` z 15 plików wstrzykujących własny `<style>` do `globals.css`
(`vt-spin` jest zdefiniowany w 4 miejscach). `optimizePackageImports` i `removeConsole`
w `next.config.ts`. Rozdzielić Admin: "Profil / Ustawienia" jako normalny ekran użytkownika,
reszta jako ukryte wejście administratora.

### Jak weryfikujemy

1. Pociągnąć w dół na każdym z 5 ekranów: dane się odświeżają, wskaźnik jest widoczny.
2. Przesunąć palcem między zakładkami Diety: działa tak samo jak na Dashboardzie.
3. Zainstalować aplikację od zera na czystym telefonie: splash, kolor, onboarding, brak białego błysku.
4. Przytrzymać ikonę aplikacji na Androidzie: pojawiają się skróty.
5. Tryb samolotowy: baner braku sieci jest widoczny, dane pokazują godzinę pobrania.

---

## Podsumowanie zależności (czego nie wolno przestawić)

| Zależność | Dlaczego |
|---|---|
| P0-5 (`userScalable: true`) **po lub razem z** P0-13 (pola 17 px) | Inaczej Safari przybliża przy każdym kliknięciu w pole. Regres, nie poprawa |
| P0-5 (`viewportFit`) **razem z** P0-6, P0-7, P0-10 | Jedna zmiana budzi 6 uśpionych obliczeń i psuje 7 innych miejsc |
| P0-11..P0-14 (podniesienie rozmiarów) **razem z** P0-15 (mniej informacji) | Inaczej ekran Diety rośnie o ok. 150 px i zarzut "za dużo informacji" się pogłębia |
| P1-16 (sprzątanie kolorów) **przed** P1-17 (tryb ciemny) | Inaczej Tracking pokaże białe prostokąty, a `WeeklyCheckinForm` biały tekst na białym |
| P1-10 rozbicie stanu **przed** memoizacją | Do kart trafiają `Set` i obiekty, które i tak zabiją `React.memo` |
| P1-3 (prefetch) **przed** P1-15 (przejścia) | Animacja bez prefetchu tylko uwydatnia czekanie |
| P1-20 (migracja Prisma) **przed** deployem kodu etapu 7 | `buildUserContext` woła `prisma.userInsight`, bez tabeli cała warstwa AI pada |
| P0-2 (animacja wciśnięcia) **razem z** P0-3 (haptyka) | Na iPhonie haptyki nie ma, wrażenie robi wyłącznie animacja |

---

## Punkty decyzyjne dla właściciela (do potwierdzenia przed startem)

1. **Kierunek wizualny "Neon Noir"**: magenta `#C4006E` zamiast niebieskiego `#1d4ed8` jako kolor główny, wyprowadzony z ikony aplikacji. To zmienia wygląd każdego przycisku w aplikacji.
2. **Redukcja zakładek z 8 do 5** (etap 6, P1-13): Dziennik, Debata i Mentorzy trafiają pod "Więcej".
3. **Karuzela zostaje** (naprawiona, nie usunięta). Audyt designu proponował zamianę na pionowe sekcje. Rozstrzygnąłem na "zostaje", uzasadnienie w `DESIGN-SPEC.md` sekcja 1, punkt 7.
4. **Dziennik w kontekście mentorów** (etap 7, P1-25): domyślnie **wyłączony**. Włączyć czy zostawić wyłączony?
5. **Dźwięki: rekomenduję NIE** (etap 8, P2-10). Wibracje tak, dźwięki nie.

---

## Czego nie zweryfikowałem

- Żaden etap nie był wdrożony ani przetestowany. To plan, nie sprawozdanie.
- Odwołania plik:linia pochodzą z audytów 01-05. Osobiście potwierdziłem w kodzie: `globals.css` (10 zmiennych), `src/app/layout.tsx` (brak `viewportFit`, blokada zoomu), `(app)/layout.tsx` (brak `paddingTop`), `BottomTabBar.tsx` (8 zakładek, `minWidth: 64`, `router.push`, ukryty scrollbar, martwy kod `isVoice`), `public/sw.js` (13 linii, przekaźnik), `public/manifest.json` (`background_color: #ffffff`, brak `shortcuts`), `package.json` (`next-pwa`, `recharts`, `date-fns`), `next.config.ts` (pusty), lista 29 modeli Prisma, brak kontekstu w trasie czatu mentora, ikona aplikacji.
- Liczby o rozmiarze paczek (`/tracking` 311 KB gzip, `/dashboard` 224 KB gzip) pochodzą z realnego `npx next build` wykonanego przez audyt 04 dnia 25.07.2026.

**NIEZWERYFIKOWANE:** żadne zachowanie na fizycznym telefonie. Etap 2 wymaga testu na
realnym Androidzie z paskiem gestów i na iPhonie z wcięciem, zanim zostanie uznany za zrobiony.

---

Ścieżka dokumentu: `C:\Users\Paweł Pieloch\CLAUDE CODE\Aplikacja Papi 2.0\papicoach\docs\audit\ROADMAP.md`

---

# Krytyka i poprawki

Data: 2026-07-25
Autor: przegląd adwersaryjny (read-only, żaden plik aplikacji nie został zmieniony).
Metoda: przeczytałem trzy dokumenty i sprawdziłem je w realnym kodzie. Każdy zarzut ma
ścieżkę i numer linii albo policzoną liczbę. Tam, gdzie spec ma rację, piszę to wprost
(sekcja K7), żeby nikt nie „poprawiał” rzeczy, które są dobrze.

## K0. Odpowiedź na pięć pytań, w jednym zdaniu każde

1. **Czy da się wdrożyć na tym kodzie?** Tak. Żaden krok nie wymaga przepisania aplikacji.
   Ale dwa kroki są opisane jako „mechaniczne”, a nie są (K5.5), i jeden etap jest opisany
   jako bezpieczny, a nie jest (K1.1).
2. **Czy coś zepsuje działające funkcje?** Tak, sześć konkretnych miejsc: K1.1, K1.2, K5.1,
   K5.2, K5.3, K5.4. Formularze głosowe są bezpieczne (K5.6).
3. **Czego brakuje?** 320 px, systemowe powiększenie czcionki, miejsce na zapis nowych
   ustawień, wolne łącze w etapach 1-4, oraz trzy błędy kontrastu w samej palecie (K2, K3).
4. **Czy kolejność jest bezpieczna?** Nie w trzech miejscach: K4.1 (kolor), K4.2 (etap 2 nie
   jest samodzielny), K4.4 (indeksy bazy za późno).
5. **Czy mózg rozsadzi budżet?** Nie, ale liczby w BRAIN-SPEC są niepełne: brak tokenów
   wyjścia, zły wzór dla Okrągłego Stołu i za optymistyczny wniosek o prompt cachingu (K6).

**Werdykt: wymaga poprawek przed startem.** Poprawki są małe (kilka godzin roboty na samych
dokumentach), ale bez nich etap 1 nie spełni własnej obietnicy „nic się nie rusza”.

---

## K1. Twarde błędy: rzeczy, które spec obiecuje, a kod na to nie pozwala

### K1.1 Etap 1 NIE jest „niskiego ryzyka” i NIE jest bezobjawowy

ROADMAP pisze: *„Ryzyko regresji: NISKIE. Nic nie zmienia układu ekranu.”* To nieprawda.

Nowy blok `body` z DESIGN-SPEC sekcja 3 ustawia:

```css
body {
  font-size: var(--fs-body);    /* 17px */
  line-height: var(--lh-body);  /* 1.45 */
}
```

Dziś `src/app/globals.css:16-21` nie ustawia **ani** `font-size`, **ani** `line-height`.
Czyli przeglądarka używa 16 px i `line-height: normal` (ok. 1,15-1,2 dla czcionki systemowej).

Obie wartości dziedziczą się do **każdego** elementu, który nie ma własnego `fontSize`
albo `lineHeight` w stylu inline. Efekt pierwszego commita: cały tekst bez jawnego rozmiaru
rośnie o ok. 6%, a każdy blok tekstu rośnie w pionie o ok. 20% przez interlinię. To jest
dokładnie ten globalny ruch układu, przed którym etap 1 miał chronić.

**Poprawka:** w etapie 1 wkleić tokeny, ale w `body` zostawić `font-size: 16px` i
`line-height: 1.5` (albo nie ustawiać ich wcale). `--fs-body: 17px` i `--lh-body` wchodzą
do `body` dopiero w etapie 3, razem z przejściem ekran po ekranie.

### K1.2 „Działa bez ruszania ani jednego komponentu” — nieprawda w 3 plikach

Reguła `button:active { transform: scale(0.97) }` to styl z arkusza. **Styl inline zawsze
wygrywa z arkuszem.** W kodzie są trzy miejsca, które ustawiają `transform` inline z JavaScriptu:

- `src/components/mentors/MentorCard.tsx:39, 42, 45` — `style.transform = "scale(0.97)"` / `"scale(1)"`
- `src/app/(app)/mentors/page.tsx:462, 465, 468` — to samo, skopiowane
- `src/components/shell/BottomTabBar.tsx:150, 154` — przycisk głosowy (dziś martwy, `isVoice` nigdy nie jest ustawione)

Po pierwszym dotknięciu tych elementów w atrybucie `style` zostaje `transform: scale(1)`,
który **na stałe** wyłącza nową animację CSS dla tego elementu. Karty mentorów będą jedynymi
w aplikacji, które nie reagują — czyli dokładnie odwrotnie niż zamierzone.

**Poprawka:** dopisać do P0-2 zadanie „usunąć trzy ręczne obsługi `style.transform`
(MentorCard, mentors/page, BottomTabBar)”. To 9 linii do skasowania w etapie 1.

### K1.3 `buildUserContext` już istnieje w kodzie

BRAIN-SPEC sekcja 2 opisuje `src/lib/ai/user-context.ts` jako **nowy** plik z **nową**
funkcją `buildUserContext(userId, options)`.

W kodzie jest już:

```
src/lib/roundtable/engine.ts:54   async function buildUserContext(userId: string): Promise<string>
src/lib/roundtable/engine.ts:187  const userContext = await buildUserContext(userId);
```

Ta sama nazwa, inna sygnatura (1 argument zamiast 2), inny typ zwracany (`string` zamiast
obiektu `UserContextResult`). BRAIN-SPEC sekcja 5 mówi, żeby po wpięciu usunąć stare budowanie
kontekstu „z `src/lib/ai/mentor.ts:47-100` i pozostałych czterech miejsc” — i **nie wymienia**
`engine.ts:54`. Czyli po wdrożeniu zostaną dwie funkcje o tej samej nazwie robiące co innego.

**Poprawka:** dopisać `roundtable/engine.ts:54` do listy do usunięcia w BRAIN-SPEC sekcja 5
i wpisać wprost, że nazwa się dubluje.

### K1.4 „Każde zapytanie po indeksie z schema.prisma” — nieprawda

BRAIN-SPEC 2.3 pisze, że 10 zapytań kontekstu idzie *„każde po indeksie z `schema.prisma`”*.
W schemacie jest **10 wpisów `@@index`** i pokrywają one tylko: `TrainingLog`, `PersonalRecord`,
`MentorConversation`, `MentorChatMessage`, `MentorPlan`, `WeightEntry`, `Habit`,
`HabitCompletion`, `JournalEntry`, `MeetingCompletion`.

Bez indeksu są między innymi modele, które kontekst czyta:

| Model | Linia w schemacie | Czyta go sekcja kontekstu |
|---|---|---|
| `Goal` | `prisma/schema.prisma:358` (tylko `@@map`) | 4 — Cele i otwarte zadania |
| `Meal` | `:244` (tylko `@@map`) | 3 — Stan na teraz |
| `Activity` | `:226` (tylko `@@map`) | 3 i 8 |
| `UserFile` | `:314` | P2, analizy plików |
| `WeeklyCheckin` | `:260` | P2, checkin |
| `RoundTableSession` | `:280` | P2, konsensus |

`DailyLog` (`:205`) i `Briefing` (`:296`) są w porządku, bo mają `@@unique([userId, date])`,
co zakłada indeks. Ale PostgreSQL **nie** zakłada automatycznie indeksu na kolumnie klucza
obcego, więc `Activity.dailyLogId` i `Meal.dailyLogId` będą skanowane w całości.

Do tego BRAIN-SPEC 2.3 **odrzuca cache** („Bez cache w pamięci”). Czyli po etapie 4 każde
z 17 miejsc wywołania AI robi 10 zapytań, część po niezaindeksowanych kolumnach.

**Poprawka:** migracja Prisma dokładająca `@@index` na `Goal(userId)`, `Meal(dailyLogId)`,
`Activity(dailyLogId, completed)` musi wejść **razem z etapem 4**, a nie w etapie 7.
Poprawić też zdanie w BRAIN-SPEC 2.3, bo obecnie usypia czujność.

---

## K2. Błędy w palecie: policzone, trzy kolory nie przechodzą AA

Kontrast policzyłem tym samym wzorem WCAG 2.1 co DESIGN-SPEC. Spec liczył **tylko na białym
`#FFFFFF`**, a aplikacja ma cztery różne powierzchnie.

**Tryb jasny**

| Para | Kontrast | Werdykt |
|---|---|---|
| `--text-3 #71717F` na `--surface #FFFFFF` | 4,80 | AA (to policzył spec) |
| `--text-3 #71717F` na `--bg #F6F6F8` | **4,45** | **FAIL** |
| `--text-3 #71717F` na `--surface-2 #F1F1F5` | **4,26** | **FAIL** |
| `--text-3 #71717F` na `--surface-3 #E7E7EE` | **3,90** | **FAIL** |

To nie jest przypadek brzegowy. Klasa `.t-footnote` z DESIGN-SPEC sekcja 3 ma **wpisany na
sztywno** `color: var(--text-3)`. Czyli każdy podpis, który nie leży na białej karcie
(a tło strony to `#F6F6F8`), łamie AA od pierwszego dnia.

**Tryb ciemny**

| Para | Kontrast | Werdykt |
|---|---|---|
| `--text-3 #82828F` na `--bg #0A0A0F` | 5,21 | AA |
| `--text-3 #82828F` na `--surface-2 #1D1D26` | **4,41** | **FAIL** |
| `--text-3 #82828F` na `--surface-3 #262631` | **3,95** | **FAIL** |
| `--primary #FF2D95` na `--surface #15151C` | 5,24 | AA (to policzył spec) |
| `--primary #FF2D95` na `--surface-3 #262631` | **4,32** | **FAIL** |

Ostatni wiersz jest najgorszy, bo `--surface-3` to zgodnie z DESIGN-SPEC 5.3 tło wariantu
`inset` i tło pigułek, czyli dokładnie tam, gdzie reguła 5 z sekcji 2 każe stawiać plakietki
w kolorze `--primary`.

**Poprawka (konkretne wartości):**
- jasny `--text-3`: z `#71717F` na ok. `#63636F`
- ciemny `--text-3`: z `#82828F` na ok. `#9494A2`
- ciemny `--primary` używany jako **tekst** na `--surface-2/3`: użyć `--primary-hover #FF57A9`
  (6,22 na `#15151C`) albo dodać osobny token `--primary-on-surface`

I dopisać do DESIGN-SPEC regułę: **każdy kolor tekstu liczymy na wszystkich czterech
powierzchniach, nie tylko na białej.**

---

## K3. Czego w ogóle brakuje

### K3.1 Ekran 320 px nie występuje ani razu

W trzech dokumentach nie ma słowa „320”. Testy są tylko na 360 i 430. Tymczasem:

- **Pasek zakładek po redukcji do 5** (P1-13): `5 × 64 + 4 × 4 = 336 px`. Przy ekranie 320 px
  i `padding: "0 8px"` dostępne jest **304 px**. Czyli nawet po naprawie pasek dalej się przewija.
  Arytmetyka w ROADMAP („mieści się nawet na 360 px”) jest prawdziwa, ale zatrzymuje się o jeden
  krok za wcześnie.
- **Siatka mentorów na sztywno 2 kolumny** (P0-16, `mentors/page.tsx:341`): przy 320 px i
  `--gutter: 20px` z każdej strony kafel ma ok. 134 px. A `mentors/page.tsx:189-190` mają
  `whiteSpace: nowrap` + `textOverflow: ellipsis`, i tekst idzie z 13 px na 17 px. Nazwy
  mentorów obetną się do kilku znaków. To jest ten sam mechanizm co ryzyko R1 w DESIGN-SPEC,
  ale P0-16 nie jest na liście R1.

**Poprawka:** dopisać 320 px do listy szerokości testowych w etapie 3 i etapie 6.
Dla zakładki użyć `minWidth: 60` zamiast 64 (`5 × 60 + 16 = 316`, mieści się).

### K3.2 Systemowe powiększenie czcionki nie zadziała

Wszystkie 9 rozmiarów typografii i wszystkie rozmiary kontrolek są w `px`. Do tego
DESIGN-SPEC dokłada `html { -webkit-text-size-adjust: 100% }`.

Skutek: użytkownik, który w ustawieniach telefonu ustawił „duża czcionka”, nie zobaczy
żadnej różnicy w aplikacji. Spec twierdzi, że naprawia WCAG 1.4.4 przez odblokowanie zoomu
szczypaniem — to jest połowa wymagania, i to gorsza połowa (zoom rozjeżdża układ, skalowanie
czcionki nie).

**Poprawka:** zapisać `--fs-*` w `rem` (17 px = 1.0625rem, 13 px = 0.8125rem itd.),
zostawić kontrolki w `px`, i **nie** ustawiać `-webkit-text-size-adjust`. Jeśli decyzja
jest świadoma („skalowanie systemowe rozwaliłoby układ, godzimy się na to”), to trzeba to
napisać w sekcji „Czego NIE robić”, a nie przemilczeć.

### K3.3 Pierścień focusu będzie przycinany

`:focus-visible { box-shadow: var(--focus-ring) }`. `box-shadow` rysuje się **poza** elementem
i jest przycinany przez każdego rodzica z `overflow: hidden` — czyli m.in. przez karuzelę
(`dashboard:966`) i przez panele karuzeli (`dashboard:978`, `:1465`, `:1479`).

**Poprawka:** dodać `outline: 2px solid var(--primary); outline-offset: 2px` obok cienia.
`outline` nie jest przycinany.

### K3.4 Nie ma gdzie zapisać nowych ustawień

Trzy zadania wymagają zapisania preferencji użytkownika:
- P0-3: przełącznik „Wibracje” (ROADMAP każe go sprawdzić w weryfikacji etapu 1, ale **żadne
  zadanie go nie tworzy**)
- P1-17: wybór trybu ciemnego (automat / jasny / ciemny)
- P1-25: `shareJournalWithMentors`

A `src/app/api/admin/profile-settings/route.ts:6` ma twardą listę dozwolonych kluczy:

```ts
const BOOL_KEYS = ["showCalendarInPlan"] as const;
```

Każde z tych trzech ustawień wymaga dopisania klucza do tej tablicy plus UI w Adminie.
W ROADMAP nie ma tego ani razu.

**Poprawka:** dodać do etapu 1 zadanie „P0-3b: przełącznik Wibracje w Admin > Ustawienia
+ rozszerzenie `BOOL_KEYS`”, a do etapu 6 i 7 analogiczne pozycje.

### K3.5 Wolne łącze jest adresowane dopiero w etapie 5

Etapy 1-4 nic nie robią ze stanem ładowania. Do etapu 5 użytkownik na słabym zasięgu widzi:
spinner blokujący całą stronę w Diecie (`diet:1842-1864`), spinner blokujący całą powłokę
(`(app)/layout.tsx:21-43`), brak `AbortController` i brak jakiegokolwiek timeoutu.
A etap 4 (mózg) **wydłuża** czas odpowiedzi AI, bo dokłada 10 zapytań i 1700 tokenów.

**Poprawka:** przenieść P1-7 (szkielety zamiast pustych ekranów) i P1-5 (AbortController,
jeden handler) z etapu 5 do etapu 3. Obie zmiany są tanie i nie zależą od service workera.

### K3.6 `manifest.json` nie jest spójny z nową paletą

`public/manifest.json` ma `"theme_color": "#0f172a"` (granat). ROADMAP P2-7 zmienia tylko
`background_color`. Po zmianie palety w etapie 1 i `themeColor` w `layout.tsx` w etapie 2,
manifest i meta będą mówić co innego — na Androidzie pasek tytułu zainstalowanej aplikacji
zostanie granatowy przy tle `#F6F6F8`.

**Poprawka:** `theme_color` w manifeście zmienić w **etapie 2**, w tym samym commicie co
`themeColor` w `layout.tsx`.

---

## K4. Kolejność etapów: trzy miejsca do przestawienia

### K4.1 Aplikacja będzie dwukolorowa przez pięć etapów (najpoważniejsze)

Etap 1 zmienia `--primary` z `#1d4ed8` na `#C4006E`. Sprzątanie zaszytych kolorów (P1-16)
jest w **etapie 6**. Policzone w kodzie:

- **11 wystąpień `#1d4ed8`** wpisanych na sztywno
- **83 wystąpienia `#fff` / `#ffffff`** wpisanych na sztywno
- plus cień `boxShadow: "0 4px 12px rgba(29, 78, 216, 0.35)"` w `BottomTabBar.tsx:145`
  (to jest ten sam niebieski w zapisie rgb, więc grep po `#1d4ed8` go nie znajdzie)

Czyli od etapu 1 do etapu 6 aplikacja ma magenta obok granatowego niebieskiego, w losowych
miejscach. To łamie zasadę nadrzędną z góry tego dokumentu: *„Po każdym etapie aplikacja jest
używalna i można ją pokazać.”* Pokazać się jej nie da.

**Poprawka:** przenieść P1-16 z etapu 6 do **etapu 1**, jako P0-1b. To robota mechaniczna
(94 wystąpienia, zamiana na `var(--primary)` / `var(--surface)`), zero ryzyka logicznego,
i odblokowuje tryb ciemny wcześniej.

### K4.2 Etap 2 nie jest samodzielnym etapem

ROADMAP sam pisze w P0-5: *„etap 2 i zadanie P0-13 z etapu 3 muszą być w tym samym commicie,
albo `userScalable` zostaje na `false` do etapu 3.”*

Czyli etap 2 albo nie dowozi tego, co obiecuje (zoom, WCAG 1.4.4), albo wciąga do siebie
zadanie z etapu 3. Tak opisany podział nie ma sensu.

**Poprawka:** przenieść P0-13 (pola tekstowe na 17 px — to 5 kopii `inputStyle`:
`admin:63`, `mentors:41`, `diet:119`, `discipline/[slug]:99`, `WeeklyCheckinForm:211`)
do etapu 2. Reszta typografii zostaje w etapie 3. Etap 2 staje się samodzielny.

### K4.3 Lista testowa etapu 2 jest niepełna o 10 miejsc

P0-10 wymienia `roundtable:280` i `MentorChat:240` jako elementy zagrożone przez
`interactiveWidget: "resizes-content"`. W kodzie jest **12 nakładek** `position: fixed; inset: 0`:

```
admin/page.tsx:335               dashboard/page.tsx:1626      diet/page.tsx:250
discipline/[slug]/page.tsx:921   goals/page.tsx:1308          goals/page.tsx:1509
mentors/page.tsx:647             mentors/page.tsx:988         components/files/FileList.tsx:125
components/followup/FollowUpSheet.tsx:46
components/mentors/MentorChat.tsx:229    components/mentors/MentorChat.tsx:241
```

Zwróć uwagę: `MentorChat` ma **dwie** takie nakładki, `:229` i `:241`, a nie jedną w `:240`.

Wysokości: `roundtable:280` ma `height: "100dvh"`, ale `journal:567` ma
`maxHeight: "calc(100vh - 280px)"` — to nie jest samo `100vh`, więc podmiana z P0-10 musi
być na `calc(100dvh - 280px)`, nie na `100dvh`.

**Poprawka:** wstawić pełną listę 12 nakładek do kroku weryfikacji etapu 2 i poprawić
opis `journal:567`.

### K4.4 Migracja indeksów bazy jest za późno

Patrz K1.4. Etap 4 dokłada 10 zapytań na każde wywołanie AI, część po niezaindeksowanych
kolumnach, bez cache. Migracja indeksów jest de facto warunkiem etapu 4, a nie elementem etapu 7.

### K4.5 Etap 4 zmienia dane widoczne wstecz, a tabela tego nie mówi

BRAIN-SPEC R4 wie, że zmiana źródła wagi przeliczy historyczne dni w kalendarzu diety
(BMR liczony w locie, nie zapisany). W tabeli „Przegląd” na górze ROADMAP etap 4 ma w kolumnie
„Widoczne dla użytkownika” tylko *„Mentor wie, kim jestem”*. Właściciel zobaczy też, że liczby
z zeszłego miesiąca się zmieniły — i zgłosi to jako błąd.

**Poprawka:** dopisać do tabeli i do kroków weryfikacji etapu 4: „historyczne bilanse
kaloryczne zmienią wartość — zdecydować przed wdrożeniem, czy liczyć dni wsteczne
z `Activity.metrics.weightUsed` (`activities/toggle/route.ts:84`), czy zaakceptować zmianę”.

---

## K5. Co konkretnie może się zepsuć

### K5.1 `useScrollLock` zgubi pozycję przewijania

ROADMAP wspomina tylko o możliwym mrugnięciu animacji. Realny problem jest inny: technika
`position: fixed` na `body` przewija stronę na samą górę przy otwarciu i **nie wraca** przy
zamknięciu, jeśli hook nie zapamięta `window.scrollY` i nie przywróci go w sprzątaniu.
Przy 12 modalach użytkownik po każdym zamknięciu wyląduje na górze listy.

**Poprawka:** wpisać do P0-9 wymóg: hook zapisuje `scrollY` przed blokadą i robi
`window.scrollTo(0, scrollY)` po jej zdjęciu.

### K5.2 Pull-to-refresh będzie zablokowany globalnie, nie lokalnie

Etap 1 dokłada `body { overscroll-behavior-y: none }`. Etap 8 (P2-1) chce pull-to-refresh na
pięciu ekranach i pisze: *„wymaga zdjęcia `overscroll-behavior-y: none` z `body` tylko na
kontenerze”*. Tak się nie da — reguła jest na `body`, więc trzeba ją **przenieść** z `body`
na konkretne kontenery, a nie „zdjąć na kontenerze”.

**Poprawka:** przeformułować P2-1: „przenieść `overscroll-behavior-y: none` z `body` na
`.papi-scroll` i na powłokę, zostawić `body` bez tej reguły”.

### K5.3 `StickyActionBar` nie zadziała tak, jak jest opisany

DESIGN-SPEC 5.11: `position: sticky; bottom: var(--above-tabbar)`. Dwa problemy:

1. `position: sticky` **nie działa** wewnątrz rodzica z `overflow: hidden`. Kontener karuzeli
   Dashboardu jest dokładnie taki (`dashboard:966` — `style={{ overflow: "hidden", ... }}`).
   Czyli na Dashboardzie, gdzie P1-18 najbardziej go potrzebuje, pasek nie przyklei się w ogóle.
2. `sticky` trzyma się dołu tylko dopóki trwa blok rodzica. Gdy treść się skończy, pasek
   odklei się i pojedzie razem z treścią. To nie jest „akcja zawsze pod kciukiem”.

**Poprawka:** `StickyActionBar` ma być `position: fixed; bottom: var(--above-tabbar)`,
renderowany w powłoce `(app)/layout.tsx` (przez portal albo kontekst), a nie `sticky`
w środku treści ekranu.

### K5.4 Zmiana `--muted` zmienia tło, nie tylko kolor tekstu

DESIGN-SPEC R5 to zauważa i ma rację. Potwierdzam w kodzie:
`src/components/shell/UniversalInputBar.tsx:225` — `background: busy ? "var(--muted)" : "var(--primary)"`.

Dziś `--muted` to `#94a3b8` (jasny szaroniebieski). Po aliasie `--muted: var(--text-3)`
robi się `#71717F` (ciemny szary). Przycisk „wysyłanie w toku” zmieni się z jasnego na ciemny.
Wygląd się zmieni, i to w etapie 1, który miał nic nie zmieniać.

**Poprawka:** przejść wszystkie użycia `var(--muted)` w etapie 1 i te, które są tłem,
podmienić ręcznie na `var(--surface-3)`. To jest kilka miejsc, nie „kiedyś”.

### K5.5 Migracja typografii przez klasy NIE jest mechaniczna

DESIGN-SPEC pisze: *„Dzięki nim migracja jest mechaniczna: `fontSize: 13` -> `className="t-footnote"`.”*
To nie zadziała, bo:

1. Klasa `.t-footnote` ustawia `font` w arkuszu, a `style={{ fontSize: 13 }}` zostaje w tym
   samym elemencie i **wygrywa**. Dodanie klasy bez skasowania inline'u jest cichym brakiem
   efektu — nic się nie zmieni, a commit będzie wyglądał na zrobiony.
2. Trzeba skasować **cztery** właściwości naraz: `fontSize`, `fontWeight`, `lineHeight`,
   `letterSpacing`. Zostawienie którejkolwiek daje mieszankę.
3. `.t-callout`, `.t-footnote` i `.t-label` wymuszają jeszcze `color`. Ten kolor przegra
   z każdym inline `color`, którego w kodzie jest bardzo dużo. Efekt: część podpisów w nowym
   kolorze, część w starym — czyli dokładnie ta niespójność, którą naprawiamy.

**Poprawka:** zapisać w DESIGN-SPEC 6.2 regułę: „jedna zmiana = dodanie klasy **plus**
usunięcie `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing` i (dla `t-callout`,
`t-footnote`, `t-label`) `color` z obiektu inline. Kontrola po ekranie: grep ma pokazać
zero `fontSize` w plikach już zmigrowanych.” Skreślić słowo „mechaniczna”.

### K5.6 Formularze głosowe są bezpieczne — sprawdzone

Sprawdziłem, bo `user-select: none` i `touch-action: manipulation` potrafią zepsuć nagrywanie
typu „przytrzymaj i mów”. Nie ma tu takiego wzorca:

- `src/hooks/useVoiceRecorder.ts` to `MediaRecorder` (nagranie do pliku i wysyłka), nie Web Speech API
- `src/components/shell/UniversalInputBar.tsx:250` to `onClick={toggleRecording}` — przełącznik,
  nie przytrzymanie

Czyli globalne reguły dotyku niczego tu nie psują. Jedyne ryzyko dla głosu to
`interactiveWidget: "resizes-content"` z etapu 2, bo pasek wejścia jest przyklejony na dole.
To już jest w kroku weryfikacji, dobrze.

### K5.7 Drobiazg, ale liczba ma być prawdziwa

ROADMAP P1-9 mówi „usunąć `transition: all` z 11 miejsc”. W `src/` jest **19** wystąpień
`transition: "all`. Ta liczba służy do sprawdzenia pełnego pokrycia, więc powinna się zgadzać.

---

## K6. Budżet mózgu: liczby są za optymistyczne, ale nie katastrofalnie

### K6.1 Co jest policzone dobrze

Sprawdziłem ceny i progi w oficjalnej dokumentacji. **BRAIN-SPEC ma rację w dwóch miejscach,
w których łatwo się pomylić:**

- `claude-sonnet-4-6` = **3 USD / 1M tokenów wejścia**. 1700 tokenów = 0,0051 USD.
  Przy 50 wywołaniach = 0,255 USD dziennie. Arytmetyka się zgadza.
- Ryzyko R7 (progi prompt cachingu) jest **poprawne**: minimalny cache'owalny prefiks to
  1024 tokeny dla `claude-sonnet-4-6` oraz 4096 dla `claude-opus-4-6` i `claude-haiku-4-5`.

### K6.2 Ale wniosek z R7 jest ostrzejszy, niż spec pisze

Skoro blok kontekstu ma ok. 1700 tokenów, a `src/lib/ai/claude.ts:19` ustawia
`ROUNDTABLE: "claude-opus-4-6"`, a `:20` `FAST: "claude-haiku-4-5-20251001"`, to:

**Prompt caching (P2-11) nigdy nie zadziała na Okrągłym Stole ani na modelu FAST**,
bo 1700 < 4096. Zadziała wyłącznie na `claude-sonnet-4-6` (czat, briefing, plany).
Warto to napisać wprost, bo inaczej P2-11 będzie wyglądał na oszczędność wszędzie.

### K6.3 Wzór dla Okrągłego Stołu jest zły

BRAIN-SPEC R3 mówi „(2N+1) razy”. W kodzie `src/lib/roundtable/engine.ts`:
- runda 1: N wywołań (`:182`, model mentora, domyślnie sonnet)
- runda 2: N wywołań sekwencyjnie (`:264`)
- synteza: **dwa** wywołania Opus, `:353` i `:367`

Czyli **2N + 2**, a dwa ostatnie po cenie Opus (5 USD/1M wejścia, 25 USD/1M wyjścia),
a nie sonnet. Przy N=5 i `maxChars: 3000` to nadal grosze, ale wzór powinien być poprawny.

Dobra wiadomość: kontekst w Okrągłym Stole **już dziś** jest budowany raz
(`engine.ts:187`) i wklejany do `baseQuestionBlock` (`:189-195`). Czyli optymalizacja
z BRAIN-SPEC już istnieje — trzeba tylko nie zepsuć jej przy podmianie.

### K6.4 W budżecie brakuje tokenów wyjścia

`src/lib/ai/claude.ts:31-32`:
```ts
CHAT_MAX_TOKENS: 2048,
BRIEFING_MAX_TOKENS: 4096,
```

Sonnet kosztuje **15 USD / 1M tokenów wyjścia**. Jeden pełny briefing (4096 tokenów wyjścia)
to do **0,061 USD** — dwanaście razy więcej niż cały blok kontekstu 1700 tokenów.

Zdanie „ok. 0,25 USD dziennie na użytkownika” jest prawdziwe **jako koszt dodany przez mózg**,
ale czyta się jak całkowity rachunek. Nie jest. Trzeba to dopisać jednym zdaniem, żeby nikt
nie zaplanował ceny abonamentu na tej liczbie.

### K6.5 Nowe stałe wywołania, których nie ma w żadnym budżecie

Etap 7 dokłada wywołania modelu, nie tylko tokeny do istniejących:
- codzienne wyciągnięcie wniosku po `briefing/finalize` (P1-22)
- cotygodniowy cron niedzielny (3 wnioski z 7 briefingów + `PlanOutcome`)

To są dodatkowe wywołania na użytkownika na dobę i na tydzień. Przy jednym użytkowniku
to nieistotne, ale ROADMAP mówi „wejście komercyjne”, więc trzeba to policzyć per użytkownik.

### K6.6 Weryfikacja kosztu mierzy nie to, co trzeba

ROADMAP etap 4, krok 6: *„Sprawdzić czas odpowiedzi czatu przed i po. Jeśli wzrósł o więcej
niż 500 ms, dodać cache 60 s.”* Czat to najlżejszy przypadek. Zmierzyć trzeba też:
generowanie planu dnia (`plan-generator.ts`) i cron (`cron/daily-plan/route.ts`), bo one
robią więcej zapytań i idą bez użytkownika patrzącego na ekran, więc nikt nie zauważy regresu.

---

## K7. Co jest zrobione dobrze i czego NIE należy „poprawiać”

Sprawdziłem w kodzie i potwierdzam. Jeśli ktoś będzie to kwestionował, ma tu dowody:

| Twierdzenie ze specu | Status | Dowód |
|---|---|---|
| `globals.css` ma 10 zmiennych, same kolory | prawda | `src/app/globals.css:3-14` |
| Brak `viewportFit`, blokada zoomu | prawda | `src/app/layout.tsx:17-23` (`maximumScale: 1`, `userScalable: false`) |
| `viewportFit` i `interactiveWidget` istnieją w typach tej wersji Next | prawda | `node_modules/next/dist/lib/metadata/types/extra-types.d.ts`, typ `ViewportLayout` |
| `main` nie ma górnego paddingu | prawda | `src/app/(app)/layout.tsx:58-62` |
| 8 zakładek, `minWidth: 64`, `gap: 4`, `padding "0 8px"`, `maxWidth 430`, wysokość 64 | prawda | `BottomTabBar.tsx:15-24, 110-114, 179` |
| Scrollbar paska jawnie ukryty, brak sygnału „jest więcej” | prawda | `BottomTabBar.tsx:117` + `:199-203` |
| `sw.js` to 13 linii przekaźnika | prawda | `public/sw.js` — `e.respondWith(fetch(e.request))` |
| `next-pwa` to martwa zależność | prawda | `package.json` ma `next-pwa`, `next.config.ts` jest pusty |
| Czat 1:1 nie dostaje żadnego kontekstu | prawda | `api/mentor-chat/conversations/[id]/messages/route.ts:57` — `system: conv.mentor.systemPrompt` |
| 29 modeli w Prisma | prawda | `grep -c "^model " prisma/schema.prisma` = 29 |
| Karuzela: `touchDeltaRef` nie trafia do stylu | prawda | `dashboard:791-820` liczy, `:973` używa tylko `activePanel` |
| `React.memo` = 0 wystąpień | prawda | grep po `src/` |
| `navigator.onLine` = 0 wystąpień | prawda | grep po `src/` |
| `--muted` używany jako tło | prawda | `UniversalInputBar.tsx:225` |
| `showCalendarInPlan` jako wzorzec flagi | prawda | `api/admin/profile-settings/route.ts:6` |
| Progi prompt cachingu (1024 / 4096) | prawda | dokumentacja Anthropic |
| Cena `claude-sonnet-4-6` = 3 USD/1M wejścia | prawda | dokumentacja Anthropic |
| Decyzja „karuzela zostaje, naprawiamy” | dobra | naprawa jest tańsza i to zmiana produktowa, nie designerska |
| Decyzja „`ref`, nie `useState`” przy śledzeniu palca | dobra | Dashboard ma 2609 linii i zero `React.memo` |
| Kolejność: sprzątanie kolorów przed trybem ciemnym | dobra | choć obie rzeczy powinny być wcześniej, patrz K4.1 |

---

## K8. Lista poprawek do wpisania, po kolei

Kolejność = od najtańszej do najdroższej, wszystkie przed startem etapu 1.

1. **DESIGN-SPEC sekcja 3:** poprawić trzy kolory (`--text-3` jasny i ciemny, ciemny primary
   na `--surface-3`) i dopisać regułę liczenia kontrastu na wszystkich czterech powierzchniach. (K2)
2. **DESIGN-SPEC sekcja 3:** w etapie 1 `body` bez `font-size` i `line-height`; wchodzą w etapie 3. (K1.1)
3. **DESIGN-SPEC 5.11:** `StickyActionBar` na `position: fixed` w powłoce, nie `sticky` w treści. (K5.3)
4. **DESIGN-SPEC 6.2:** skreślić „mechaniczna”, wpisać regułę „klasa + usunięcie 4-5 właściwości inline”. (K5.5)
5. **DESIGN-SPEC sekcja 3:** dodać `outline` obok `box-shadow` w `:focus-visible`. (K3.3)
6. **ROADMAP etap 1:** dopisać P0-1b (sprzątanie 11x `#1d4ed8` + 83x `#fff` + cień w `BottomTabBar:145`,
   przeniesione z P1-16), P0-2b (usunąć 3 ręczne `style.transform`), P0-3b (przełącznik Wibracje
   + `BOOL_KEYS`), plus podmiana `var(--muted)` używanego jako tło. (K4.1, K1.2, K3.4, K5.4)
7. **ROADMAP etap 2:** wciągnąć P0-13 (5 kopii `inputStyle` na 17 px), dopisać `theme_color`
   w manifeście, wstawić pełną listę 12 nakładek `inset: 0`, poprawić opis `journal:567`. (K4.2, K3.6, K4.3)
8. **ROADMAP etap 3:** dodać 320 px do szerokości testowych; przenieść tu P1-5 i P1-7 z etapu 5. (K3.1, K3.5)
9. **ROADMAP etap 4:** dopisać migrację indeksów (`Goal`, `Meal`, `Activity`) jako warunek;
   dopisać do tabeli, że historyczne bilanse się zmienią. (K1.4, K4.5)
10. **ROADMAP P0-9 i P2-1:** wymóg zapamiętania `scrollY`; przeniesienie `overscroll-behavior`
    z `body` na kontenery. (K5.1, K5.2)
11. **BRAIN-SPEC 2.3:** skreślić „każde po indeksie”, wpisać, których indeksów brakuje. (K1.4)
12. **BRAIN-SPEC sekcja 5:** dopisać `roundtable/engine.ts:54` do listy do usunięcia i ostrzeżenie
    o kolizji nazwy. (K1.3)
13. **BRAIN-SPEC 2.2 i R3:** poprawić wzór Okrągłego Stołu na 2N+2, dopisać zdanie o tokenach
    wyjścia i o tym, że caching nie zadziała na Opus ani Haiku. (K6.2, K6.3, K6.4)
14. **Decyzja właściciela, dodatkowa do listy z góry dokumentu:** czy godzimy się, że systemowe
    powiększenie czcionki nie działa (px zamiast rem), czy przechodzimy na `rem`. (K3.2)

---

## Czego nie zweryfikowałem w tej krytyce

- Nie uruchamiałem aplikacji, nie robiłem zrzutów, nie odpytywałem bazy. Wszystko powyżej
  pochodzi z odczytu kodu, `grep` i policzenia kontrastu skryptem Node.
- Kontrasty policzyłem wzorem WCAG 2.1 z wartości HEX. Nie sprawdzałem ich na ekranie.
- Nie sprawdzałem, czy `@@index` faktycznie brakuje w bazie produkcyjnej — sprawdzałem
  `prisma/schema.prisma`. Jeśli ktoś dodał indeksy ręcznie w SQL, K1.4 może być nieaktualne.

**NIEZWERYFIKOWANE:** zachowanie `-webkit-text-size-adjust: 100%` wobec suwaka rozmiaru tekstu
w Chrome na Androidzie (K3.2) oraz to, czy `position: sticky` faktycznie umiera w karuzeli
(K5.3). Oba wynikają z reguł przeglądarki, ale oba wymagają telefonu i pięciu minut testu.

Ścieżka dokumentu: `C:\Users\Paweł Pieloch\CLAUDE CODE\Aplikacja Papi 2.0\papicoach\docs\audit\ROADMAP.md`

