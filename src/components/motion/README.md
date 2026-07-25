# Warstwa ruchu (`@/components/motion`)

Cztery komponenty i jeden hook. Nie dotykają logiki biznesowej — przesuwają piksele
i mówią, który panel / zakładkę wybrał użytkownik. Wszystkie kolory i wymiary idą
przez `var(--token)` z `globals.css`.

```ts
import { SwipeDeck, SegmentedTabs, AnimatedNumber, Reveal } from "@/components/motion";
```

---

## 1. SwipeDeck — karuzela, która idzie za palcem

Zastępuje ręcznie pisaną karuzelę na dashboardzie. Naprawia dokładnie trzy rzeczy,
przez które „trzeba przesuwać trzy, cztery razy":

| Problem w starym kodzie | Co jest teraz |
| --- | --- |
| brak `touch-action` — przeglądarka nie wiedziała, czyj jest ruch poziomy | `touch-action: pan-y` na kontenerze: pion należy do strony, poziom do karuzeli |
| `transform` liczony wyłącznie ze stanu → panel przeskakiwał po puszczeniu | `style.transform` pisany bezpośrednio z `pointermove`, bez `setState`, bez re-renderu |
| nieaktywne panele miały `height: 0` → strona skakała | panele trzymają swoją wysokość; kontener animuje wysokość i w trakcie gestu tylko ROŚNIE, żeby nic nie ucięło |

Dodatkowo: szybki „flick" (>0,35 px/ms) przerzuca panel nawet przy krótkim ruchu,
opór gumowy (0,35×) na krańcach, strzałki na klawiaturze, `aria-roledescription="carousel"`,
`prefers-reduced-motion` = przejście natychmiastowe.

```tsx
const [panel, setPanel] = useState(0);
const PANELE = ["Plan dnia", "Briefing", "Statystyki"];

<SwipeDeck index={panel} onChange={setPanel} labels={PANELE} showDots>
  <PlanDniaPanel data={data} />
  <BriefingPanel data={data} />
  <StatystykiPanel data={data} />
</SwipeDeck>
```

Props: `index`, `onChange`, `labels?`, `showDots?`, `ariaLabel?`, `enabled?`
(wyłącza gest, np. gdy otwarty jest arkusz), `keyboard?`, `heightPadding?`.

Uwagi:
- to komponent **kontrolowany** — trzyma go stan ekranu, ten sam, którym karmisz zakładki;
- panel niebędący aktywnym dostaje `inert`, więc nie da się w niego wejść tabem;
- kontener ma `overflow: hidden` (jak stary kod), więc modal/dropdown renderowany
  **wewnątrz panelu** zostanie przycięty — takie rzeczy montuj poza karuzelą.

## 2. SegmentedTabs — zakładki, które da się przesuwać palcem

Nadbudowa na `BigTabs` (te same trzy propsy: `tabs` / `active` / `onChange`), więc
podmiana importu wystarczy.

- pigułka wskaźnika **jedzie** między segmentami (`transform` + `width` na GPU), zamiast
  przemalowywania tła każdego przycisku,
- przeciąganie palcem po pasku zmienia zakładkę, a wskaźnik podąża za palcem w trakcie ruchu,
- aktywny tekst pełny kontrast i grubość 700, nieaktywny wyciszony (`--text-3`),
- minimum 44 px wysokości, strzałki / Home / End na klawiaturze,
- powyżej 3 zakładek pasek przewija się poziomo i sam centruje aktywną (gest jest wtedy
  wyłączony, żeby nie walczyć z przewijaniem paska).

```tsx
<SegmentedTabs
  tabs={PANELE.map((label, i) => ({ key: String(i), label }))}
  active={String(panel)}
  onChange={(k) => setPanel(Number(k))}
/>
```

Props: `variant?: "pills" | "underline"`, `swipeable?`, `ariaLabel?`, `style?`.

Razem z karuzelą (dokładnie układ z dashboardu):

```tsx
const [panel, setPanel] = useState(0);
const PANELE = ["Plan dnia", "Briefing", "Statystyki"];

<>
  <SegmentedTabs
    tabs={PANELE.map((label, i) => ({ key: String(i), label }))}
    active={String(panel)}
    onChange={(k) => setPanel(Number(k))}
  />
  <SwipeDeck index={panel} onChange={setPanel} labels={PANELE} showDots style={{ marginTop: 12 }}>
    <PlanDniaPanel />
    <BriefingPanel />
    <StatystykiPanel />
  </SwipeDeck>
</>
```

Ten sam stan karmi jedno i drugie: przesunięcie karuzeli przesuwa pigułkę zakładek
i odwrotnie.

## 3. AnimatedNumber — liczba, która dobiega do wartości

```tsx
<AnimatedNumber value={2570} unit="kcal" style={TYPO.metric} />
<AnimatedNumber value={completionPct} suffix="%" duration={800} />
<AnimatedNumber value={waga} decimals={1} unit="kg" />
```

`requestAnimationFrame`, ~600 ms, ease-out, `tabular-nums` (cyfry nie skaczą).
Zero re-renderów Reacta w trakcie liczenia. `unit` renderuje się mniejszą, wyciszoną
czcionką obok liczby (duże „2570" + małe „kcal"). Domyślne formatowanie jest
deterministyczne (`toFixed`), więc HTML z serwera zgadza się z klientem — własny
`format` też musi być bez `toLocaleString`.

## 4. Reveal — wejście kaskadowe

```tsx
{activities.map((a, i) => (
  <Reveal key={a.id} index={i}>
    <ActivityCard activity={a} />
  </Reveal>
))}
```

`IntersectionObserver` + `opacity`/`translateY(8px)`. `index` × `stagger` (domyślnie 40 ms)
buduje kaskadę. Animowane są wyłącznie `transform` i `opacity`, więc nie ma szansy na
zacinanie. Props: `index`, `stagger`, `delay`, `y`, `duration`, `repeat`, `as`.

## 5. useSwipeable — sam gest

Gdy ekran ma własny układ i potrzebuje tylko gestu:

```ts
const { handlers } = useSwipeable({
  count: 3,
  index,
  onIndexChange: setIndex,
  getWidth: () => ref.current?.clientWidth ?? 0,
  onDrag: (offset) => { track.current.style.transform = `translate3d(${offset}px,0,0)`; },
});
<div {...handlers} style={{ touchAction: "pan-y", overflow: "hidden" }} />
```

Progi: oś rozpoznawana po 9 px z histerezą 1,2× (pion oddaje gest stronie i już go nie
odbiera), zmiana panelu przy 25% szerokości **lub** 0,35 px/ms, opór 0,35× na krańcach,
`haptic.selection()` przy zmianie. `handlers` zawiera też `onClickCapture`, który połyka
kliknięcie po przeciągnięciu — swipe zaczęty na przycisku nie odpala tego przycisku,
a zwykłe dotknięcie działa normalnie.

---

## Co zostało sprawdzone w przeglądarce

Prawdziwe komponenty zbundlowane esbuildem i odpalone na `375 px`, gest symulowany
zdarzeniami `PointerEvent`:

| Test | Wynik |
| --- | --- |
| przeciąganie 90 px | `translate3d` idzie za palcem: −15, −30, −45, −60, −75 px |
| puszczenie | dojście do −343 px (szerokość panelu) z przejściem 380 ms |
| krótki szybki flick (34 px / 42 ms) | zmienia panel, mimo że to dużo mniej niż 25% szerokości |
| gest pionowy na karuzeli | `transform` bez zmian — scroll strony nietknięty |
| kraniec (ostatni panel) | 200 px palca = 56 px ruchu (opór 0,35×), po puszczeniu wraca |
| wysokość | 332 → 552 px przy zmianie panelu; nieaktywne panele mają 552/212 px, nie 0 |
| zakładki | pigułka jedzie za palcem (4 → 13 → 23 → 33 px) i ląduje na sąsiedniej zakładce |
| klawiatura | ArrowRight → „Briefing", End → „Statystyki", kropka → „Plan dnia" |
| dotknięcie przycisku w panelu | działa (1 klik) |
| swipe zaczęty na przycisku | panel zmieniony, kliknięcie połknięte (nadal 1 klik) |
| rozmiary dotyku | zakładki 110×44, kropki 44×32 |

Niesprawdzone w tym przebiegu: animacje liczników i `Reveal` w ruchu — karta
automatu jest w tle (`document.hidden`), więc `requestAnimationFrame`
i `IntersectionObserver` są zamrożone przez przeglądarkę. Dlatego `AnimatedNumber`
w takiej karcie od razu maluje wartość docelową, zamiast zostać na zerze.
