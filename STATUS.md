# STATUS — Przebudowa premium mobile (PAPI PLANER)

Cel: aplikacja ma wyglądać i działać jak produkt z App Store — premium design,
dopasowanie do telefonu, płynność, haptics + "mózg" (mapa zależności między sekcjami,
rosnąca baza wiedzy dla agentów). Przygotowanie do wejścia komercyjnego.

Data startu: 2026-06-08

---

# RUNDA 2026-07-26 (wieczór) — MOJA ENERGIA

Specyfikacja: [docs/ENERGIA-SPEC.md](docs/ENERGIA-SPEC.md). Cele potwierdzone przez Pawła
w drugim nagraniu: powietrze 15%, medytacja 2 h, kalorie jako liczony deficyt, woda z wagi
ciała, ruch 1,5 h ze wszystkich aktywności, sen 7,5 h, suplementy rozbite na pozycje.

| # | Etap | Stan | Dowód |
|---|------|------|-------|
| E.1 | Baza: `EnergyPillar`, `EnergyComponent`, `EnergyEntry`, status debaty | **DONE** | `prisma generate` OK |
| E.2 | Silnik energii: `src/lib/energy/*` (defaults, sources, score, constants) | **DONE (kod)** | tsc czysty |
| E.3 | API: `/api/energy`, `/trend`, `/config`, `/init` | **DONE (kod)** | tsc czysty |
| E.4 | Ekran `/energy`: Dziś / Trend / Ustawienia | **DONE (kod)** | do sprawdzenia w przeglądarce |
| E.5 | Debata liczy się w tle (`runner.ts` + `/status/[id]` + odpytywanie) | **DONE (kod)** | do sprawdzenia w przeglądarce |
| E.6 | Obszary życia: pełne CRUD + zakładanie z formularza mentora | **DONE (kod)** | tsc czysty |
| E.7 | Karty mentorów: emoji, jedna linia, obszary | **DONE (kod)** | do sprawdzenia w przeglądarce |
| E.8 | Nawigacja: Pulpit, Energia, Nawyki, Dieta, Więcej + pierścień na pulpicie | **DONE (kod)** | do sprawdzenia w przeglądarce |
| E.9 | Energia w kontekście AI + reguła w planerze dnia | **DONE** | agent uruchomił realny `buildUserContext` na żywej bazie, 741 ms, sekcja pomijana gdy brak tabel |
| E.10 | Jeden cel kaloryczny dla diety, energii, pulpitu i mentorów | **DONE** | Uruchomione realne moduły: 100 kg → BMR 1915, TDEE 2968, cel 2668 zgodny w diecie, energii, pulpicie i promptach. Wcześniej dieta pokazywała **2500 wzięte z sufitu** (stała awaryjna), a energia 2358 albo 2668 |
| E.11 | Weryfikacja w buildzie produkcyjnym | **DONE** | patrz niżej |

## Co sprawdzone w buildzie produkcyjnym (`next start`, realne zdarzenia dotyku)

| Sprawdzenie | Wynik |
|---|---|
| Ekran energii: pierścień, 7 filarów z wagami, najsłabszy filar | 48%, wszystkie filary, „Najsłabszy filar: 🌤️ Świeże powietrze 20%" |
| Pytanie „Jak się dziś czujesz?" | jest, 6/10, z wyjaśnieniem po co |
| Zakładka Ustawienia: wagi i licznik sumy | „Suma wag: 100% dnia" |
| Zapis pola wody: 2 dotknięcia plusa | **jeden** PATCH z `woda-ml: 1700` (odbicie zapytań działa) |
| Suplementy | 5 pozycji plus zdanie o lekarzu i dietetyku |
| Debata: start | „🔒 Debata liczy się w tle, możesz zamknąć aplikację", id w localStorage |
| Debata: **pełne przeładowanie strony** (symulacja wygaszenia telefonu) | wznowiona bez klikania startu: pytanie, awatary, „RUNDA 1 Z 2" |
| Debata: koniec pracy w tle | esencja i sekcja ODPOWIEDŹ pojawiły się same, odpytywanie ustało |
| Karta w tle | odpytywanie zwalnia do 10 s, po powrocie natychmiast |
| Pasek nawigacji | 5 komórek bez zmiany liczby, 69,6 px przy 360 px, `nowrap` + wielokropek |

**NIEZWERYFIKOWANE:** liczby na realnych danych Pawła (baza produkcyjna nieosiągalna
z tej maszyny) oraz jakość odpowiedzi AI. Tabele `energy_*` powstaną przy restarcie
kontenera, więc do tego czasu sekcja energii w kontekście mentorów jest pomijana,
co agent potwierdził uruchomieniem `buildUserContext` na żywej bazie.

---

# RUNDA 2026-07-26 (dzień) — bug zamrażający + 7 obszarów

Zasada: etap dostaje **DONE** tylko z dowodem (uruchomione, zmierzone, pokazane).
Bez dowodu: **CLAIMED-UNVERIFIED**.

## P0 — bug, przez który aplikacja się zacinała

| # | Etap | Stan | Dowód |
|---|------|------|-------|
| 0.1 | Diagnoza: klik w mentora / „Dodaj nawyk" nic nie otwiera i blokuje przewijanie | **DONE** | Repro w przeglądarce: `[role=dialog]` nieobecny, a `body.style.position === "fixed"` |
| 0.2 | Przyczyna: `Sheet` trzymał montowanie w stanie ustawianym w trakcie renderu (`if (prevOpen !== open) setRender(true)`). React 19 gubił tę aktualizację, a blokada scrolla (zależna tylko od `open`) i tak się włączała | **DONE** | Ślad renderów tej samej instancji: `open=true render=true` → `open=true render=false`, bez żadnego wywołania `setRender(false)` |
| 0.3 | Naprawa: montowanie wyliczane (`open \|\| exiting`), blokada scrolla licznikowa na poziomie modułu | **DONE** | Po naprawie: `dialog:true`, treść widoczna, `transform: translateY(0px)`; dwa arkusze naraz → po zamknięciu obu `body.style.position` puste |
| 0.4 | Ten sam wzorzec w `discipline/[slug]/page.tsx` (2 miejsca) | **DONE** | Wzorzec usunięty w obu formularzach, tsc czysty |
| 0.5 | Audyt klikalności wszystkich ekranów | **DONE** | 350 elementów przejrzanych, 20 poprawek w 12 plikach: 10× toast łapiący dotyk (`pointerEvents`), 6× cel dotykowy < 44px, 3× brak blokady podwójnego kliku, 1× brak `ariaLabel` |

Największe znalezisko audytu: toasty potwierdzeń (`position: fixed`) nie miały
`pointerEvents: "none"`, więc przez 2,5 sekundy po zapisie leżały na przyciskach
pod spodem. W diecie toast przykrywał 42 z 56 px obu przycisków „+".

## P1 — obszary funkcjonalne

| # | Obszar | Stan | Dowód |
|---|--------|------|-------|
| 1 | Nawyki: pętla wyzwalacz → nawyk → nagroda, podmiana nawyku, „po co to robię" | **DONE** | Build produkcyjny w przeglądarce: linia pętli, badge „zastępuje", zachęta gdy brak danych, rozwijanie „po co", podpowiedź AI wypełnia 4 pola |
| 2 | Cele: zamknięcie celu (osiągnięty / porzucony) bez grzebania w JSON | **DONE (kod)** | tsc + build; zakładki Aktywne/Zamknięte, PATCH ze statusem, `achievedAt`, `outcome` |
| 3 | Mentorzy: psycholog nawyków, usunięcie content strategist, neurodydaktyk + języki i kursy | **DONE (kod)** | seed idempotentny, tsc + build |
| 4 | Okrągły stół: równolegle, esencja zamiast ścian tekstu, wybór pozycji do wdrożenia | **DONE** | Build produkcyjny w przeglądarce: ODPOWIEDŹ → ZGADZAJĄ SIĘ → SPORNE → DO WDROŻENIA z licznikiem „3 z 3", przycisk gaśnie przy zero zaznaczonych, pełny zapis w arkuszu pogrupowany po rundach bez opisu persony |
| 5 | Dieta: różnorodność, pomysły z internetu, oceny i ulubione, lista zakupów | **DONE (kod)** | 4 nowe endpointy w buildzie, tsc czysty |
| 6 | Wnioski: własny wniosek + propozycje zmian z akceptacją | **DONE (kod)** | `/api/proposals` + `/api/proposals/[id]` w buildzie, akceptacja w transakcji |
| 7 | Płynność i spójność wizualna | **DONE** | patrz 0.5 |
| 8 | Regresja: dwa endpointy same zamykały cel przy 100% postępu | **DONE** | `grep 'status: "completed"'` w `src/app/api` i `src/lib` → 0 wystąpień |

## Baza danych (schema + `prisma generate` zrobione lokalnie)

`Habit`: cue, routine, reward, why, identity, kind, replaces · `Goal`: achievedAt,
outcome · nowy `MealIdea` · nowy `ChangeProposal` · `UserInsight.origin`.
`prisma db push` na VPS wykonuje się przy starcie kontenera.

## Weryfikacja końcowa (2026-07-26)

- `npx prisma generate` OK
- `npx tsc --noEmit --incremental false` → **0 błędów**
- `npx next build` po czystym `.next` → **zielony**, wszystkie nowe trasy zarejestrowane
  (`/api/habits/suggest`, `/api/meal-ideas`, `/api/meal-ideas/[id]`, `/api/meal-ideas/suggest`,
  `/api/proposals`, `/api/proposals/[id]`)
- Ekrany Nawyki i Okrągły Stół sprawdzone w **buildzie produkcyjnym** (`next start`),
  na zaślepionych danych, przez wysyłkę realnych zdarzeń dotyku

**NIEZWERYFIKOWANE:** działanie na realnych danych Pawła (baza produkcyjna nieosiągalna
z tej maszyny) oraz jakość odpowiedzi AI: podpowiedzi pętli nawyku, esencji debaty,
pomysłów na posiłki z wyszukiwaniem w sieci i propozycji zmian w pamięci. Prompty są
napisane i sparsowane defensywnie, ale ich wynik ocenia się dopiero na żywym koncie.

---

## Stan wyjściowy (zmierzony, nie zgadywany)

| Metryka | Wartość | Ocena |
|---|---|---|
| Strony | 14 | — |
| Komponenty | 23 | — |
| Linie kodu UI | ~21 000 | wszystko inline styles |
| Zmienne CSS (tokeny) | 10 | za mało (brak skali typo/spacing/motion) |
| Dominujący fontSize | 11-13px (355 wystąpień) | ZA MAŁY na telefon (norma: 15-17px body) |
| Typowy padding przycisku | 6px 12px / 4px 10px | touch target ~26-30px, norma Apple 44px |
| Dark mode | brak | — |
| Haptics / dźwięki | brak | — |
| Motion system | 4 keyframes | brak systemu |

---

## Etapy

| # | Etap | Stan | Dowód |
|---|---|---|---|
| 1 | Recon kodu (metryki wyjściowe) | DONE | tabela wyżej, zmierzona przez grep/wc |
| 2 | Audyt wieloagentowy (5 audytorów) | DONE | 5 dokumentów w docs/audit/, 39 znalezisk krytycznych |
| 3 | Synteza + krytyka adwersaryjna | DONE | DESIGN-SPEC.md, BRAIN-SPEC.md, ROADMAP.md (+ sekcja Krytyka) |
| 4 | Etap 1: tokeny + haptyka + prymitywy + próbka | DONE | `next build` OK + `tsc --noEmit` czysty — patrz „Weryfikacja Etapu 1" niżej |
| 4b | Scalenie z równoległym redesignem z produkcji (indigo) | DONE | commit 7cfbdbc wypchnięty; pomiar na żywej apce: --primary #4f46e5, --touch-min 44px, reguła :active w CSSOM |
| 5 | Akceptacja kierunku wizualnego przez właściciela | PENDING | czeka na /design-preview (bramka ludzka — nie moja) |
| 6 | Etap 2: safe area, klawiatura, przewijanie (WYSOKIE ryzyko) | PENDING | — |
| 7 | Etap 3: touch targety 44px + typografia na 14 stronach | DONE | grep: `fontSize: 10\|11` = 1 wystąpienie w całym `src` (etykiety próbek koloru w /design-preview) |
| 8 | Etap 4: mózg cz.1 (kontekst, czat 1:1, waga) | DONE | `user-context.ts` wpięty w 8 miejsc (grep niżej), BMR z `WeightEntry` przez `body-metrics.ts` |
| 9 | Etap 7: pamięć długoterminowa (`UserInsight` + /insights + cron) | DONE (kod) / PENDING (baza) | trasy w buildzie: `/insights`, `/api/insights`, `/api/cron/weekly-insights`; migracja bazy NIEZROBIONA |
| 10 | Weryfikacja całości po 5 agentach (build + audyt kodu + smoke test tras) | DONE | sekcja „Weryfikacja końcowa" niżej |
| 11 | Etapy 5-6, 8: płynność, nawigacja, dark mode na wszystkich ekranach | PENDING | — |

## Wyniki audytu (dowody w docs/audit/)

| Znalezisko | Skala | Dowód |
|---|---|---|
| Przyciski poniżej 44px | 188 z 199 (94%), najmniejszy 14px | dashboard:1271 |
| Tekst poniżej 15px | 505 z 669 wystąpień (75%) | 14 stron |
| Brak reakcji na dotyk | 0 wystąpień `:active`, 0 `vibrate` | cały src |
| Safe area nie działa | 6 miejsc liczy, wszystkie zwracają 0 | brak viewportFit:cover |
| Zakładki nie mieszczą się | 8 zakładek = 556px w 430px | BottomTabBar:15-24 |
| Czat mentora bez kontekstu | 0 danych o użytkowniku | mentor-chat/messages:54-59 |
| Waga nie wpływa na BMR | liczy z zamrożonego profilu | dashboard/route:144 |
| Dziennik AI = sierota | żaden agent nie czyta | tylko journal/route.ts |
| Odpowiedź po treningu | wysyłana do Claude i wyrzucana | dashboard:1603-1609 |
| Kontekst AI budowany 5x | 5 różnych kształtów | mentor.ts, briefing, engine, plan-generator, cron |

Legenda: DONE = zweryfikowane dowodem · CLAIMED-UNVERIFIED = zrobione bez dowodu · PENDING = nieruszone

---

## Weryfikacja Etapu 1 (wznowienie 2026-07-25)

Co dostarczono w Etapie 1 (zakres: tokeny + haptyka + prymitywy + próbka):

| Element | Plik(i) | Stan |
|---|---|---|
| P0-1 Tokeny CSS (kolory light+dark, typografia, spacing, motion, brand „Neon Noir" zaparkowany) | `src/app/globals.css` (+669 linii) + most `src/components/ui/tokens.ts` | DONE |
| P0-2 Globalna reakcja na dotknięcie (`:active` scale 0.97, wariant `.press-lg`, respekt reduce-motion, tap-highlight off) | `src/app/globals.css:478,514-530,697-703` | DONE |
| P0-3 Moduł haptyki (Vibration API, iOS no-op, rate-limit, on/off w localStorage) + wpięcie w 8 plików | `src/lib/haptics.ts`, most `src/components/ui/haptics-bridge.ts`, dashboard/goals/habits/mentors/admin + MentorChat/MentorCard/BottomTabBar/VoiceInput/VoiceTextarea | DONE |
| P0-4 Prymitywy (10 szt., cel „trzy pierwsze" przekroczony) | `Button, Card, ListRow, Sheet, Stat, Field, Skeleton, EmptyState, Pressable, BigTabs` + barrel `index.ts` | DONE |
| Próbka (UI lab z każdym prymitywem, poza aplikacją, nie wchodzi do bundla) | `_ui_lab_entry.tsx` | DONE |

Dowody (uruchomione lokalnie, Windows, przez `node` bo `npm/npx` zablokowane uprawnieniami):
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → **exit 0, zero błędów** (cały projekt type-check czysty).
- `node node_modules/next/dist/bin/next build` → **exit 0**, `✓ Compiled successfully in 6.1s`, `✓ Generating static pages (70/70)`, wszystkie trasy (/dashboard, /goals, /habits, /mentors, /diet…) zbudowane.
- Cross-check eksport/import: każdy symbol importowany z `@/components/ui`, `@/components/ui/tokens`, `@/lib/haptics` istnieje w eksportach (barrel + haptics zgodne).
- Kolor brand: `--primary` celowo zostaje niebieski `#1D4ED8` w Etapie 1 (komentarz `globals.css:130`), róż `#C4006E` zaparkowany jako `--brand-*` do przełączenia po akceptacji właściciela (Etap 5). To decyzja projektowa, nie brak.

Znane, POZA ZAKRESEM Etapu 1:
- 1 ostrzeżenie Turbopack (NFT trace) w `src/app/api/files/[id]/route.ts` z `next.config.ts` — wcześniejsze, nie dotyczy tokenów/haptyki/prymitywów, build i tak przechodzi.

**NIEZWERYFIKOWANE (świadomie, nie moja bramka):** wygląd „premium" na fizycznym telefonie i haptyka na realnym Androidzie/iPhonie. To Etap 5 — akceptacja kierunku wizualnego przez właściciela przez `/design-preview`. Build zielony NIE jest dowodem zmiany widocznej dla użytkownika (reguła 1) — dlatego Etap 5 zostaje PENDING i wymaga człowieka. Próbka `_ui_lab_entry.tsx` nie jest wpięta w żadną trasę; podpięcie podglądu należy do Etapu 5.

Nie ruszałem logiki biznesowej, nie zmieniałem koloru brand, nie pushowałem do `main` — zgodnie z zakresem wznowienia.

---

## Etap 7 — pamięć długoterminowa (`UserInsight`)

Wiedza o użytkowniku ma rosnąć razem z używaniem aplikacji. Surowe dane w kontekście AI
mają stały rozmiar, rośnie tylko warstwa wniosków.

| Element | Plik | Stan |
|---|---|---|
| Model `UserInsight` + relacja `User.insights` | `prisma/schema.prisma` | zrobione, `prisma generate` OK |
| Generator wniosków (tygodniówka, wzorce, preferencje) | `src/lib/ai/insight-generator.ts` | zrobione |
| Cron niedzielny | `src/app/api/cron/weekly-insights/route.ts` | zrobione |
| Wnioski dla agentów (`getActiveInsights`) | `src/lib/ai/insights-context.ts` | zrobione, czeka na wpięcie w `user-context.ts` przez inny wątek |
| Ekran „Wnioski" + API | `src/app/(app)/insights/page.tsx`, `src/app/api/insights/route.ts` | zrobione |
| Wejście w arkuszu „Więcej" | `src/components/shell/BottomTabBar.tsx` | zrobione (pozycja „Wnioski") |

### Migracja bazy — KOLEJNOŚĆ JEST OBOWIĄZKOWA

Najpierw migracja na produkcji, dopiero potem deploy kodu (BRAIN-SPEC ryzyko R1).

**UWAGA — poprawka po weryfikacji:** ten projekt NIE MA katalogu `prisma/migrations`
(sprawdzone: `ls prisma/` → tylko `schema.prisma` i `seed.ts`). `prisma migrate deploy`
nie zadziała. Obowiązuje polecenie z `package.json`:

```
npx prisma db push      # produkcja i lokalnie
npx prisma generate     # po każdej zmianie schematu
```

Schemat zmienił się w TRZECH miejscach, nie tylko `UserInsight`:

| Zmiana w `prisma/schema.prisma` | Co się stanie bez `db push` |
|---|---|
| `model UserInsight` (nowa tabela) | ekran „Wnioski" pusty, cron nic nie zapisze (odczyty mają `try/catch`, nie wywala) |
| `Activity.sourcePlanId`, `Activity.sourceTaskIndex` | **TWARDY BŁĄD**: każdy `SELECT` aktywności pyta o brakujące kolumny → odhaczanie zadań i dashboard przestają działać |
| `@@index([dailyLogId])`, `@@index([sourcePlanId, sourceTaskIndex])` | tylko wolniejsze zapytania |

Czyli: `db push` PRZED deployem kodu jest obowiązkowy, inaczej wywala się dashboard.

Odczyty wniosków (`insights-context.ts`, `GET /api/insights`) mają `try/catch`, więc brak
tabeli nie wywala warstwy AI ani ekranu, ale zapisów z crona bez migracji nie będzie.

### Jak wołać cron (niedziela wieczorem)

Endpoint: `POST /api/cron/weekly-insights`, autoryzacja `Authorization: Bearer $CRON_SECRET`
(ten sam sekret co `/api/cron/daily-plan`). `maxDuration = 300`.

Harmonogram: **niedziela 21:00** — dzień się już praktycznie skończył, a tydzień ISO
(poniedziałek–niedziela) zamyka się o północy, więc podsumowywany jest tydzień poprzedni.

crontab (VPS):
```
0 21 * * 0 curl -s -X POST https://app.papishop.pl/api/cron/weekly-insights -H "Authorization: Bearer $CRON_SECRET"
```

Vercel Cron (`vercel.json`, czas UTC — 20:00 UTC = 21:00 w Polsce zimą, 22:00 latem):
```json
{ "crons": [{ "path": "/api/cron/weekly-insights", "schedule": "0 20 * * 0" }] }
```

Powtórka nieudanego przebiegu dla konkretnego tygodnia:
```
curl -X POST .../api/cron/weekly-insights -H "Authorization: Bearer $CRON_SECRET" \
     -H "Content-Type: application/json" -d '{"isoWeek":"2026-W30"}'
```

Co robi jeden przebieg dla każdego użytkownika:
1. podsumowanie minionego tygodnia ISO (`kind="weekly_summary"`, `period="YYYY-Www"`, upsert),
2. odświeżenie wzorców z 28 dni (`kind="pattern"`) — stare tego samego rodzaju dostają `active=false`,
3. odświeżenie preferencji z 60 dni (`kind="preference"`) — tak samo,
4. dezaktywacja wszystkiego starszego niż 90 dni.

Wnioski nigdy nie są kasowane, tylko dezaktywowane — także przyciskiem „To nieprawda"
na ekranie Wnioski. To jest pętla korekty: użytkownik poprawia wiedzę aplikacji o sobie.

---

## Weryfikacja końcowa (2026-07-26) — po pracy 5 agentów

Rola: sprawdzić i naprawić, nie chwalić. Zakres: build, mózg, budżet tokenów, wizual,
regresje funkcjonalne, smoke test tras.

### 1. Kompilacja — ZIELONA

| Komenda | Wynik | Dowód |
|---|---|---|
| `npx prisma generate` | OK | `Generated Prisma Client (7.8.0) to .\src\generated\prisma in 373ms` |
| `npx tsc --noEmit` | exit 0, ZERO błędów | uruchomione dwa razy: przed i po moich poprawkach |
| `npx next build` | exit 0 | `✓ Compiled successfully in 7.5s`, `✓ Generating static pages (76/76)` |

W buildzie są nowe trasy: `○ /insights`, `ƒ /api/insights`, `ƒ /api/cron/weekly-insights`,
`ƒ /api/roundtable/apply`, `ƒ /api/activities/follow-up`.

Jedno ostrzeżenie Turbopack (NFT trace, `next.config.ts` ← `api/files/[id]/route.ts`) —
wcześniejsze, nie z tej przebudowy, build i tak przechodzi.

### 2. Mózg — sprawdzone czytaniem kodu

| Wymaganie | Stan | Dowód (plik:linia) |
|---|---|---|
| `src/lib/ai/user-context.ts` istnieje | TAK, 977 linii | — |
| czat mentora — wiadomości | wpięte | `mentor-chat/conversations/[id]/messages/route.ts:6,58` |
| czat mentora — nowa rozmowa | wpięte | `mentor-chat/conversations/route.ts:6,97` |
| generator planu dnia | wpięte | `plan-generator.ts:4,92` |
| generator planu mentora | wpięte 2x | `mentor-plan-generator.ts:336,442` |
| planer aktywności | wpięte | `activity-planner.ts:36` |
| briefing | wpięte | `briefing/generator.ts:28` |
| debata (Okrągły Stół) | wpięte | `roundtable/engine.ts:296` |
| `mentor.ts` | wpięte | `mentor.ts:44` |
| cron plan dnia (9. miejsce, bonus) | wpięte | `cron/daily-plan/route.ts:46` |
| stara lokalna `buildUserContext` w engine.ts | USUNIĘTA | `grep "function buildUserContext"` → 1 trafienie, `user-context.ts:298` |
| waga z `WeightEntry` wpływa na BMR | TAK | `body-metrics.ts:155-198` (7-dniowa średnia → `calculateBMR`), konsumenci: `dashboard/route.ts:125`, `meals/route.ts:75`, `activities/toggle/route.ts:73`, `input/process/route.ts:74`, `admin/my-data/route.ts:306` |
| odpowiedź po treningu ZAPISYWANA | TAK | `activities/follow-up/route.ts:222-236` (MentorConversation + 2 MentorChatMessage), `:253` TrainingLog, `:318` zwraca `reply` do UI, `FollowUpSheet.tsx:206-221` pokazuje ją na ekranie |
| aktywności z wpisu głosowego mają typ i kalorie | TAK | `input/process/route.ts:78-95` (`detectActivityType` + `estimateCalories`, nie „manual"/0 kcal) |
| `UserInsight` w schemacie | TAK | `prisma/schema.prisma:507` + relacja `User.insights:46` |
| cron `weekly-insights` z `CRON_SECRET` | TAK | `cron/weekly-insights/route.ts:47-51` (identyczny wzorzec co `daily-plan`) |
| `/insights` — strona, API, nawigacja | TAK | `src/app/(app)/insights/page.tsx`, `src/app/api/insights/route.ts` (GET/PATCH/POST), `BottomTabBar.tsx:154` (pozycja „Wnioski") |

Nic z tej listy nie brakuje.

### 3. Budżet tokenów kontekstu — MIEŚCI SIĘ

Policzone z twardych limitów w kodzie (`SECTION_BUDGET` `user-context.ts:142-154`,
`SCOPE_MAX_CHARS` `:285-292`, obcięcie `:906`):

| Scope | Suma sekcji bez limitu | Limit `maxChars` | Realnie | Tokeny (4 zn./tok) | Tokeny (PL 3,5 zn./tok) |
|---|---|---|---|---|---|
| chat | 6 923 zn. | 6 000 | 6 000 zn. | **1 500** | 1 714 |
| day-plan | 6 508 zn. | 6 000 | 6 000 zn. | **1 500** | 1 714 |
| briefing | 6 508 zn. | 6 000 | 6 000 zn. | **1 500** | 1 714 |
| goal-plan | 5 845 zn. | 5 000 | 5 000 zn. | 1 250 | 1 429 |
| activity-plan | 4 486 zn. | 3 500 | 3 500 zn. | 875 | 1 000 |
| debate | 5 003 zn. | 3 000 | 3 000 zn. | 750 | 857 |

Najgorszy przypadek to **~1 500 tokenów** (przy 4 znakach na token), próg zadania to 2 500.
Skracanie NIE jest potrzebne. Debata (najdroższa: 2N+2 wywołań) ma najciaśniejszy limit —
3 000 znaków, czyli ~750 tokenów na wywołanie. To jest dobrze zaprojektowane.

### 4. Wizual — czysto

| Sprawdzenie | Wynik |
|---|---|
| zaszyte kolory `#4f46e5`, `#7c3aed`, `#6366f1`, `#818cf8`, `#1d4ed8`, `#0f172a`, `#0f1023`, `rgba(79,70,229`, `rgba(17,19,39` poza tokenami | **0 realnych użyć**. 4 trafienia to: 2x fallback w `tokens.ts` (plik tokenów, dozwolone) i 2x tekst komentarza w `InstallPrompt.tsx:64`, `BigTabs.tsx:7` |
| `fontSize: 10` / `fontSize: 11` | **1 wystąpienie**: `design-preview/page.tsx:421` — etykieta pod próbką koloru w labie designu (10 próbek w rzędzie). Zostawione świadomie, to nie treść aplikacji |
| kolor motywu spójny | TAK: `public/manifest.json` `theme_color`/`background_color` = `#0B0E13`, `layout.tsx:38` `themeColor: "#0B0E13"`, `globals.css:155` `--dark-bg: #0B0E13` |
| `data-theme="dark"` serwowane z serwera | TAK, `layout.tsx:46` + potwierdzone w HTML (niżej) |

### 5. Regresje funkcjonalne — sprawdzone czytaniem handlerów

Sprawdzone: dashboard (`toggleActivity` → `/api/activities/toggle`, 3 przyciski planu →
`/api/activities/generate-plan`, `/api/plan/generate`, `/api/plan/replan`, briefing,
kalendarz, nawyki — wszystkie 15 wołanych endpointów istnieje jako plik `route.ts`),
cele (plik nietknięty przez agentów), dieta, mentorzy (czat 1:1 działa — do
`anthropic.messages.create` idzie `system` z `withUserContext`, historia rozmów bez zmian),
debata + nowy przycisk wdrożenia, nawyki, dziennik, dyscyplina, tracking, admin,
formularze głosowe.

Znalezione i NAPRAWIONE:

| # | Problem | Plik | Poprawka |
|---|---|---|---|
| 1 | BOM (`EF BB BF`) wstawiony przed `"use client"` — dyrektywa klienta poprzedzona niewidzialnym bajtem, ryzyko przy zmianie bundlera | `src/components/forms/MicDevicePicker.tsx:1` | BOM usunięty (`node`, plik zapisany bez BOM) |
| 2 | Błąd ortograficzny w przycisku: „Wdroż" zamiast „Wdróż" (od „wdrożyć") — 2 miejsca | `src/app/(app)/roundtable/page.tsx:596,1140` | poprawione na „Wdróż ustalenia" |
| 3 | STATUS.md kazał uruchomić `prisma migrate deploy`, a projekt nie ma katalogu `prisma/migrations` — komenda by nie zadziałała, a bez migracji wywala się dashboard | `STATUS.md` | sekcja „Migracja bazy" przepisana na `prisma db push` + tabela skutków braku migracji |

Sprawdzone i BEZ regresji (typowe pułapki, które warto było wykluczyć):
- `BigTabs` przerobiony na alias `SegmentedTabs` — **zero miejsc wywołania** w aplikacji
  (`grep "<BigTabs"` → pusto), wszystkie ekrany używają `SegmentedTabs` bezpośrednio.
  Przełączanie zakładek na diecie/celach/mentorach/dzienniku/trackingu nietknięte.
- `calorie-calculator.ts`: kolejność `typeMets ?? nameMets` zachowana — rozpoznawanie
  z nazwy działa tylko wtedy, gdy typ jest nieznany. Wartości MET się nie zmieniły
  (spacer 3,5 · siłownia 8 · nauka 1,5 — tak jak przed zmianą).
- `meals/route.ts` i `dashboard/route.ts`: pola odpowiedzi tylko DODANE (`weight`,
  `targetCalories`), żadne stare pole nie zniknęło — istniejący front działa dalej.
- `briefing/generator.ts`: semantyka daty (`new Date(y,m,d)` = lokalna północ) taka sama
  jak przed przepisaniem, więc `userId_date` trafia w ten sam wiersz `DailyLog`.
- `roundtable/apply`: sprawdza właściciela sesji, filtruje `lifeAreaId` do obszarów
  użytkownika, blokuje podwójne wdrożenie (`applied`).

### 6. Smoke test tras — zrobiony, ale NIE na porcie 3100

Port 3100 się nie udał i to jest fakt, nie wymówka: Next 16 pozwala na JEDEN serwer dev
na katalog, a w tym katalogu działa już czyjś serwer na porcie 3000
(`⨯ Another next dev server is already running. PID: 11936`). Nie zabijałem cudzego
procesu. Test wykonany na działającej instancji `http://localhost:3000` — ten sam kod,
ten sam katalog roboczy.

| Trasa | HTTP | Uwaga |
|---|---|---|
| `/login` | **200** | `<title>PAPI PLANER</title>` |
| `/design-preview` | **200** | — |
| `/`, `/terms`, `/privacy-policy` | 200 | — |
| `/insights`, `/roundtable`, `/dashboard`, `/diet`, `/goals`, `/mentors`, `/habits`, `/journal`, `/tracking`, `/admin` | 307 | przekierowanie na logowanie (brak sesji w curlu) — trasa się kompiluje, zero 500 |

`data-theme="dark"` w serwerowym HTML: potwierdzone dla `/login` i `/design-preview`
(`curl ... | grep -o 'data-theme="[a-z]*"'` → `data-theme="dark"` w obu).

Serwera nie zatrzymywałem, bo go nie uruchomiłem — należy do innej sesji.

### 7. Co zostało (nie moja bramka)

1. **`npx prisma db push` na produkcji PRZED deployem kodu.** Bez tego dashboard się
   wywali (kolumny `source_plan_id`, `source_task_index`). To jest blokada wdrożenia.
2. Wpisanie crona niedzielnego (`0 21 * * 0` → `/api/cron/weekly-insights`) i zmiennej
   `CRON_SECRET` — po stronie VPS/Vercel, nie w repo.
3. Akceptacja kierunku wizualnego przez właściciela na `/design-preview` (Etap 5).
4. Test na fizycznym telefonie: haptyka, safe area, klawiatura (Etap 2/6 — PENDING).

**NIEZWERYFIKOWANE:** jakość odpowiedzi mentorów z nowym kontekstem i sensowność
propozycji z „Wdróż ustalenia" — to wymaga realnych wywołań modelu na koncie z danymi
i oceny człowieka. Zielony build i przechodzący typecheck NIE są dowodem, że mentor
odpowiada lepiej.

Nic nie commitowałem — zmiany zostają w drzewie roboczym.

---

## Zasady bezpieczeństwa tej przebudowy

1. Nie rozwalać działających sekcji — migracja strona po stronie, każda weryfikowana buildem.
2. Design system wprowadzany jako warstwa NAD istniejącym kodem (tokeny + primitywy),
   nie big-bang rewrite 21k linii naraz.
3. Każdy etap kończy się `npx next build` — bez zielonego builda nie idzie commit.
4. Zero zmian w logice biznesowej (API, generatory planów, mentorzy) w ramach tej przebudowy.

---

AUTO-RESUME: DONE
