# STATUS — Przebudowa premium mobile (PAPI PLANER)

Cel: aplikacja ma wyglądać i działać jak produkt z App Store — premium design,
dopasowanie do telefonu, płynność, haptics + "mózg" (mapa zależności między sekcjami,
rosnąca baza wiedzy dla agentów). Przygotowanie do wejścia komercyjnego.

Data startu: 2026-06-08

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
| 5 | Akceptacja kierunku wizualnego przez właściciela | PENDING | czeka na /design-preview (bramka ludzka — nie moja) |
| 6 | Etap 2: safe area, klawiatura, przewijanie (WYSOKIE ryzyko) | PENDING | — |
| 7 | Etap 3: touch targety 44px + typografia na 14 stronach | PENDING | — |
| 8 | Etap 4: mózg cz.1 (kontekst, czat 1:1, waga) | PENDING | — |
| 9 | Etapy 5-8: płynność, nawigacja, dark mode, pamięć AI | PENDING | — |

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

## Zasady bezpieczeństwa tej przebudowy

1. Nie rozwalać działających sekcji — migracja strona po stronie, każda weryfikowana buildem.
2. Design system wprowadzany jako warstwa NAD istniejącym kodem (tokeny + primitywy),
   nie big-bang rewrite 21k linii naraz.
3. Każdy etap kończy się `npx next build` — bez zielonego builda nie idzie commit.
4. Zero zmian w logice biznesowej (API, generatory planów, mentorzy) w ramach tej przebudowy.

---

AUTO-RESUME: DONE
