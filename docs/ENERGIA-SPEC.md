# MOJA ENERGIA — specyfikacja

Źródło: dwa nagrania Pawła z 2026-07-26 (drugie doprecyzowuje cele).
To jest kontrakt, nie propozycja.

**Potwierdzone i doprecyzowane w drugim nagraniu:** świeże powietrze 15%, medytacja 2 godziny,
kalorie jako liczony deficyt zamiast stałej liczby, woda liczona z wagi ciała z dodatkiem na
trening i upał, ruch 1,5 godziny sumowany ze wszystkich aktywności, sen 7,5 godziny,
suplementacja rozbita na konkretne pozycje.
Cytat kierunkowy: *„To ma być PAPI PLANER, aplikacja do zwiększania swojej energii
głównie... to jest najważniejsze w tej aplikacji w sumie, ten poziom energetyczny,
żeby później wyłapywać zależności pomiędzy tymi wszystkimi rzeczami."*

---

## 1. Siedem filarów i ich waga

Energia dnia to jedna liczba 0-100%. Składa się z siedmiu filarów o stałych wagach
(suma 100). Wagi są edytowalne przez użytkownika, poniżej wartości startowe.

| Filar | Klucz | Emoji | Waga |
|---|---|---|---|
| Umysł | `umysl` | 🧠 | **20%** |
| Odżywianie | `odzywianie` | 🍽️ | **15%** |
| Nawodnienie | `nawodnienie` | 💧 | **15%** |
| Ruch | `ruch` | 🏃 | **15%** |
| Sen | `sen` | 😴 | **15%** |
| Świeże powietrze | `swieze-powietrze` | 🌤️ | **15%** |
| Suplementacja | `suplementacja` | 💊 | **5%** |

Waga świeżego powietrza: **potwierdzona przez Pawła 2026-07-26** („powietrze to 15 procent").

**Energia dnia = suma po filarach: (wypełnienie filaru w %) × (waga filaru / 100).**

## 2. Składowe filarów

Każdy filar ma własne składowe. Wypełnienie filaru to średnia ważona jego składowych.
Wagi składowych wewnątrz filaru sumują się do 100.

Typy składowej:
- **`up`** — więcej znaczy lepiej, aż do celu. `wynik = min(wartość / cel, 1)`
- **`window`** — trafić w punkt. `wynik = max(0, 1 − |wartość − cel| / tolerancja)`
- **`bool`** — zrobione albo nie. `wynik = 0 lub 1`

Kolumna „skąd" mówi, czy wartość jest liczona z aplikacji (`auto`), czy wpisuje ją użytkownik.

### 🧠 Umysł (20%)

| Składowa | Klucz | Typ | Cel | Waga | Skąd |
|---|---|---|---|---|---|
| Vipassana | `vipassana-min` | up | **120 min** | 40 | auto: aktywności medytacyjne |
| Nauka | `nauka-min` | up | 45 min | 40 | auto: aktywności typu nauka |
| Skupienie w ciągu dnia | `skupienie` | up | 8 (skala 1-10) | 20 | ręcznie |

Nauka obejmuje cyberbezpieczeństwo, narzędzia AI i języki.
Cel medytacji to **dwie godziny: godzina rano i godzina wieczorem** (potwierdzone
2026-07-26). Jest edytowalny, więc obniżenie go w słabszym tygodniu to jeden ruch suwakiem.

### 🍽️ Odżywianie (15%)

| Składowa | Klucz | Typ | Cel | Tolerancja | Waga | Skąd |
|---|---|---|---|---|---|---|
| Kalorie | `kcal` | window | **TDEE minus deficyt** (liczone) | 300 kcal | 50 | auto: posiłki dnia |
| Białko | `bialko-g` | up | 2 g na kg masy ciała | — | 30 | auto: posiłki dnia |
| Posiłki z planu | `posilki-wg-planu` | bool | — | — | 20 | ręcznie |

Typ `window` realizuje wprost: *„im dalej od tego punktu, tym mniej procent... jeżeli za
dużo jem, to automatycznie zero"*. Przy tolerancji 300 kcal przekroczenie o 300 daje 0.
Okno działa w obie strony celowo: zjedzenie 1200 kcal też nie jest sukcesem.

### Cel kaloryczny liczy się, a nie stoi w profilu

Paweł, 2026-07-26: *„jeżeli celem jest schudnięcie, to nie mogę cały czas dobijać do zera
kalorycznego, muszę być na deficycie. Nie może to być minus tysiąc, nie może być minus
pięćset, może to ma być minus trzysta albo minus dwieście pięćdziesiąt. To musi wyliczyć
specjalista od odżywiania."*

Łańcuch, cały z istniejących modułów:

```
waga (żywa, średnia 7 dni)  →  BMR (Mifflin-St Jeor)  →  TDEE (× współczynnik aktywności)
                                                       →  cel = TDEE − deficyt
```

- waga: `getCurrentBodyMetrics` (`src/lib/ai/body-metrics.ts`), nie zamrożona liczba z profilu
- BMR i TDEE: `calculateBMR` i `calculateTDEE` (`src/lib/ai/bmr-calculator.ts`)
- **deficyt domyślny: 300 kcal dziennie**, edytowalny w ustawieniach energii w zakresie 0-700.
  Powyżej 500 pokazujemy ostrzeżenie, że to już nie jest tempo, które da się utrzymać.
  300 kcal to około 0,3 kg tygodniowo, czyli dokładnie widełki, które podał.
- pole `target` składowej `kcal` przechowuje **wartość deficytu**, a nie cel kaloryczny.
  Cel jest przeliczany każdego dnia z aktualnej wagi. Inaczej schudnięcie 5 kg zostawiłoby
  stary, za wysoki cel na zawsze.
- gdy nie da się policzyć TDEE (brak wagi, brak profilu): składowa pokazuje „brak danych"
  i nie psuje wyniku filaru, a nie udaje celu z sufitu.

Białko: 2 g na kilogram masy ciała, z żywej wagi. Ta liczba padła w debacie mentorów jako
zgodne stanowisko i jest standardem przy redukcji z treningiem siłowym.

### 💧 Nawodnienie (15%)

| Składowa | Klucz | Typ | Cel | Waga | Skąd |
|---|---|---|---|---|---|
| Woda | `woda-ml` | up | **liczony z wagi ciała** | 50 | ręcznie |
| Woda z solą | `woda-z-sola` | bool | — | 25 | ręcznie |
| Małe łyki, ze szkła | `woda-nawyk` | bool | — | 25 | ręcznie |

### Cel wody jest ruchomy

Paweł, 2026-07-26: *„dwa i pół litra, a może trzy, a może cztery litry, jak jest dzień
treningowy i gorąco."*

```
baza      = 30 ml × waga ciała (żywa), zaokrąglone do 100 ml, nie mniej niż 2000 ml
+ 500 ml    gdy w danym dniu jest ukończona aktywność ruchowa
+ 500 ml    gdy użytkownik zaznaczył „dziś gorąco"
```

Przy 100 kg daje to 3,0 l na spokojny dzień i **4,0 l w gorący dzień treningowy**, czyli
dokładnie widełki, które podał. Pole `target` przechowuje mnożnik `30`, a nie litry, żeby cel
schodził razem z wagą.

Dochodzi jedna składowa `bool` bez wagi w wyniku, wyłącznie jako przełącznik warunków:
`upal` („dziś gorąco"). Nie liczy się do procentu, tylko podnosi cel wody.
W interfejsie stoi obok pola wody, nie jako osobne zadanie do odhaczenia.

### 🏃 Ruch (15%)

| Składowa | Klucz | Typ | Cel | Waga | Skąd |
|---|---|---|---|---|---|
| Minuty ruchu | `ruch-min` | up | 90 min | 100 | auto: ukończone aktywności ruchowe |

*„Półtorej godziny dziennie powinienem się ruszać i to jest mus."*

Liczy się **suma wszystkiego**, nie tylko treningi: *„jeżeli tu piętnaście minut, tu
dwadzieścia, tu coś tam, tu jakiś spacer pół godziny, to wszystko zliczone jako aktywność."*
Czytnik ma sumować każdą ukończoną aktywność ruchową z jej `durationMin`, także krótkie wpisy
i spacery. Nie odrzucaj niczego progiem minimalnego czasu.

### 😴 Sen (15%)

| Składowa | Klucz | Typ | Cel | Tolerancja | Waga | Skąd |
|---|---|---|---|---|---|---|
| Długość snu | `sen-h` | window | 7,5 h | 1,5 h | 40 | auto: wpis dnia |
| Sen głęboki | `sen-gleboki-min` | up | 90 min | — | 20 | ręcznie (z zegarka) |
| Poszedłem spać o czasie | `sen-pora` | bool | — | 15 | ręcznie |
| Elektronika wyłączona | `sen-elektronika` | bool | — | 15 | ręcznie |
| Przewietrzony pokój | `sen-pokoj` | bool | — | 10 | ręcznie |

### 🌤️ Świeże powietrze (15%)

| Składowa | Klucz | Typ | Cel | Waga | Skąd |
|---|---|---|---|---|---|
| Czas na dworze | `dwor-min` | up | 120 min | 40 | ręcznie |
| Ekspozycja na słońce | `slonce-min` | up | 120 min | 40 | ręcznie |
| Ćwiczenia oddechowe | `oddech-min` | up | 10 min | 20 | ręcznie |

### 💊 Suplementacja (5%)

Paweł, 2026-07-26: *„może jeszcze rozbicie na jakie witaminy, jakie minerały, które będą
podnosiły moją energię."* Zamiast trzech ogólników lista konkretów, każda pozycja edytowalna
i możliwa do wyłączenia.

| Składowa | Klucz | Typ | Waga | Kiedy |
|---|---|---|---|---|
| Kreatyna 5 g | `supl-kreatyna` | bool | 20 | codziennie, pora bez znaczenia |
| Witamina D3 z K2 | `supl-d3k2` | bool | 20 | rano, do posiłku z tłuszczem |
| Magnez | `supl-magnez` | bool | 20 | wieczorem, wspiera sen |
| Omega 3 | `supl-omega3` | bool | 20 | do posiłku |
| Kompleks witamin B | `supl-b` | bool | 20 | rano |

Każda pozycja ma podpowiedź z porą przyjmowania, bo połowa efektu siedzi w tym, kiedy się
je bierze (magnez wieczorem pod sen, D3 z tłuszczem, B rano bo potrafi rozbudzić).

**To jest punkt wyjścia, nie zalecenie lekarskie.** Skład i dawki potwierdza lekarz albo
dietetyk, najlepiej po badaniach krwi. Aplikacja pilnuje regularności, nie diagnozuje.
Ten sam tekst, jednym zdaniem, ma stać na ekranie pod listą suplementów.

## 3. Model danych

Trzy tabele, już w schemacie:

- **`EnergyPillar`** — filar: klucz, nazwa, emoji, waga, kolejność, opcjonalny obszar życia
- **`EnergyComponent`** — składowa: klucz, etykieta, typ, źródło, cel, tolerancja, waga, podpowiedź
- **`EnergyEntry`** — jeden dzień: `values` (JSON: klucz składowej → liczba, `bool` jako 0/1),
  `score` (JSON: `{ total, pillars: { klucz: procent } }`), `feltEnergy` (1-10), `note`

Wartości składowych `auto` NIE trafiają do `values`. Są czytane z aplikacji przy liczeniu,
żeby jedna prawda nie mieszkała w dwóch miejscach.

`score` jest przeliczany i zapisywany przy każdym zapisie dnia. Powód: ekran trendu ma
być jednym zapytaniem, a nie trzydziestoma przeliczeniami.

## 4. Kontrakt API

Wszystkie wymagają sesji, 401 bez niej. Wszystkie liczą się dla dnia w strefie
`Europe/Warsaw` (kontener chodzi na UTC, patrz `polishDayBounds`).

### `GET /api/energy?date=YYYY-MM-DD`
Domyślnie dzisiaj. Zwraca:
```
{
  date, total, feltEnergy, note,
  pillars: [{
    key, name, emoji, weight, percent,
    components: [{ key, label, kind, source, target, tolerance, unit, weight, hint,
                   value, percent, auto }]
  }]
}
```
`value` dla składowych `auto` to policzona liczba, dla ręcznych to wpis z `values`.

### `PATCH /api/energy`
Body: `{ date?, values?: { [klucz]: number }, feltEnergy?, note? }`
Zapisuje częściowo (merge, nie nadpisanie całego obiektu), przelicza `score`, zwraca to
samo co GET. Nieznane klucze składowych są odrzucane.

### `GET /api/energy/trend?days=30`
```
{ days: [{ date, total, feltEnergy, pillars: { klucz: procent } }],
  averages: { total, pillars: { klucz: procent } },
  weakest: { key, name, percent },
  insights: [ { text, kind } ] }
```
`insights` to wyliczone zależności, bez AI. Reguła: dla każdego filaru porównaj jego
średnią w dniach o niskiej energii odczuwanej (`feltEnergy <= 5`) ze średnią w dniach
wysokich (`feltEnergy >= 8`). Różnica powyżej 20 punktów procentowych daje zdanie w stylu:
*„W dni, gdy czułeś się słabo, sen wypełniałeś średnio w 42%, a w dobre dni w 81%."*
Minimum 5 dni z oceną, inaczej pusta lista i komunikat, że dane jeszcze rosną.

### `GET /api/energy/config` i `PATCH /api/energy/config`
Odczyt i edycja filarów i składowych: wagi, cele, tolerancje, aktywność, kolejność.
Walidacja: wagi aktywnych filarów muszą sumować się do 100, wagi składowych w filarze
też do 100. Przy niezgodności zwróć 400 z czytelnym komunikatem po polsku.

### `POST /api/energy/init`
Zakłada siedem filarów i ich składowe, jeśli użytkownik ich nie ma. Idempotentne.
Wywoływane leniwie przez `GET /api/energy`, gdy nie ma jeszcze żadnego filaru.

## 5. Ekran „Moja energia" (`/energy`)

Trzy zakładki: **Dziś**, **Trend**, **Ustawienia**.

### Dziś
1. Wielki pierścień z procentem energii dnia na górze, liczba animowana.
2. Pod nim siedem pasków filarów: emoji, nazwa, procent, waga. Tap rozwija składowe.
3. Składowa `auto` pokazuje policzoną wartość i skąd pochodzi (np. „z posiłków").
   Ręczna to pole: liczba z krokiem (woda: +250 ml) albo przełącznik dla `bool`.
   Każde dotknięcie zapisuje od razu (PATCH), z haptyką i optymistycznym stanem.
4. Na dole jedno pytanie: „Jak się dziś czujesz?" — suwak 1-10 (`feltEnergy`).
   To jest jedyna droga do wykrywania zależności, więc pytanie ma być widoczne.

### Trend
Wykres 30 dni: energia policzona i energia odczuwana jako dwie linie. Pod spodem
średnie po filarach (poziome paski, najsłabszy pierwszy) i lista `insights`.

### Ustawienia
Edycja wag filarów (suwaki, licznik sumy musi pokazywać 100 i blokować zapis poza tym),
celów i tolerancji składowych, włączanie i wyłączanie składowych.

## 6. Nawigacja

Dolny pasek: **Pulpit, Energia, Nawyki, Dieta, Więcej**. „Cele" przechodzi do „Więcej".
Na pulpicie u góry mały pierścień energii z dzisiejszym procentem, prowadzący do `/energy`.

## 7. Mentorzy widzą energię

`user-context.ts` dostaje nową sekcję `energia` (scope `chat`, `day-plan`, `briefing`):
```
## Energia dnia
Dzis: 68% (odczuwana 6/10). Najslabszy filar: nawodnienie 30%.
Srednia z 7 dni: 71%. Filary ponizej 60%: nawodnienie 41%, swieze powietrze 55%.
```
Dzięki temu dietetyk sam widzi, że nawodnienie leży, a planer dnia może dorzucić spacer,
gdy świeże powietrze jest na zero. To realizuje *„generalnie każdy trener powinien w tym
obszarze działać"*.

Do generatora planu dnia dochodzi reguła: jeśli któryś filar jest dziś poniżej 50%,
zaproponuj jedną konkretną czynność, która go podnosi, i powiedz wprost dlaczego.

## 8. Czego świadomie NIE robimy w tej rundzie

- Przypisywania trenerów do filarów. Paweł: *„trenerów na razie zostawiamy tak, jak jest."*
- Integracji z zegarkiem. Sen głęboki wpisuje się ręcznie.
- Powiadomień push przypominających o wodzie.
