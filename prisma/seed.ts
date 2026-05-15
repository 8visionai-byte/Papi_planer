// prisma/seed.ts
import "dotenv/config";
import { PrismaClient, UserRole } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Whitelist admin email
  await prisma.allowedEmail.upsert({
    where: { email: "8visionai@gmail.com" },
    update: {},
    create: { email: "8visionai@gmail.com", role: UserRole.ADMIN },
  });

  // Create or find Paweł's user
  const user = await prisma.user.upsert({
    where: { email: "8visionai@gmail.com" },
    update: {},
    create: {
      email: "8visionai@gmail.com",
      name: "Paweł Pieloch",
      role: UserRole.ADMIN,
    },
  });

  // Profile — all personal data from brief
  await prisma.userProfile.upsert({
    where: { userId: user.id },
    update: { data: profileData },
    create: { userId: user.id, data: profileData },
  });

  // Life Areas
  const areas = await seedLifeAreas(user.id);

  // Mentors
  await seedMentors(user.id, areas);

  // Schedule (full week)
  await seedSchedule(user.id, areas);

  console.log("Seed complete.");
}

const profileData = {
  nickname: "Papi",
  age: 38,
  heightCm: 176,
  startWeightKg: 105,
  targetWeightKg: 95,
  bmi: 33.9,
  location: "Pisz, Polska",
  partner: "Martyna",
  children: [
    { name: "Nikoś", age: 2 },
    { name: "noworodek", age: "2 tygodnie" },
  ],
  pet: { name: "Stefan", breed: "buldog francuski", age: 11 },
  company: "SimpleFast.ai",
  cofounder: "Marcin",
  industry: "AI automation, chatboty, voiceboty, automatyzacja procesów dla MŚP",
  tools: ["Make.com", "OpenAI API", "Claude", "Gemini", "SendPulse", "AssemblyAI", "Perplexity", "Google AI Studio", "Claude Code", "GitHub"],
  otherCompany: "PaPi-Bud",
  education: "MSc Inżynieria Budowlana + kurs cybersecurity HackerU",
  sportsHistory: {
    karate: { belt: "yellow", targetBelt: "green", examWeek: 4, frequency: "2x/tyg Wt/Czw 19-21", years: 5, note: "nieregularne" },
    swimming: { level: "klubowy", lastActive: "12-14 lat temu", records: { freestyle50m: "32s", freestyle100m: "1:04", butterfly50m: "35s", butterfly25m: "13s" } },
    gym: { level: "zaawansowany", lastActive: "5+ lat", records: { squat: "165kg", benchPress: "142.5kg", deadlift: "205kgx2" }, note: "na cyklu Test 400mg/tyg" },
    calisthenics: { level: "zero", note: "od podstaw" },
  },
  noSteroids: "3+ lat",
  trainingBreak: "5 lat",
  equipment: {
    office: ["worek treningowy (opony)", "hantle 5 kg", "skakanka", "drążek wolnostojący"],
    basement: ["hantle regulowane 5-25 kg (2 pary)", "sztanga ~75 kg", "kettlebell (waga nieznana)", "skakanka"],
    missing: ["ławka do wyciskania", "dip station"],
  },
  health: {
    injuries: "brak",
    allergies: "brak",
    caffeineFree: true,
    caffeineFreeMonths: 3,
    nightHungerAttacks: true,
    sleepAvgHours: 7,
    vipassana: { priority: "nieneg", targetMinutes: 20, sessionsPerDay: 2 },
  },
  supplements: ["kreatyna 5g/dzień", "whey 30g post-trening"],
  currentDiet: {
    breakfast: { description: "4 jajka na boczku, chleb, warzywa, INKA", kcal: 700 },
    lunch: { description: "Zupa + mięso + ziemniaki + warzywa", kcal: 800 },
    dinner: { description: "Kiełbasa z barana, musztarda, chleb", kcal: 500 },
    nightSnack: { description: "Kompulsywne napady głodu", kcal: "400-700" },
    totalKcal: "2400-2700+",
    proteinG: 100,
  },
  macroTargets: { calories: 2400, proteinG: 180, carbsG: 220, fatG: 88 },
  goals: {
    tenWeeks: {
      weight: "95-96 kg",
      visual: "zarys kratki na brzuchu",
      karateExam: "zielona belka w tyg. 4",
      hackerU: "Linux egzamin w tyg. 7-8",
      aiCourses: "powrót na żywo, nadrobienie 40%",
      socialMedia: "3 posty/tyg + 1-2 rolki/tyg od tyg. 4",
      vipassana: "2x/dzień stabilny nawyk od tyg. 2",
      energy: "8+/10 od tyg. 6",
    },
    longTerm: ["OSCP prep", "pełna kratka", "certyfikat cybersecurity", "YouTube SimpleFast.ai", "pull-up x10"],
  },
  phases: [
    { phase: 1, weeks: "1-4", name: "Fundament + Egzamin", priority: "Egzamin karate, dieta, nawyki, Linux start" },
    { phase: 2, weeks: "5-7", name: "Przyspieszenie", priority: "Intensywność rośnie, delfin, drążek, kursy" },
    { phase: 3, weeks: "8-10", name: "Finisz", priority: "Systemy na autopilocie, pełna prędkość nauki" },
  ],
  currentPhase: 1,
  currentWeek: 0,
  milestones: [
    { weeks: "1-2", weight: "103-104 kg", milestone: "Nawyki startują. Pierwszy kurs na żywo." },
    { weeks: "3-4", weight: "101-102 kg", milestone: "EGZAMIN KARATE — zielona belka" },
    { weeks: "5-6", weight: "99-100 kg", milestone: "Delfin na basenie. Drążek aktywny." },
    { weeks: "7-8", weight: "97-98 kg", milestone: "Pull-up negatywne x5. Linux exam zdany." },
    { weeks: "9-10", weight: "95-96 kg", milestone: "Kratka widoczna. Python Security start." },
  ],
  protocols: {
    noSleep: {
      name: "Noworodek nie spał (<5h)",
      cancel: ["trening w pracy", "kurs AI", "nauka cybersec"],
      do: ["vipassana 10 min", "śniadanie protein", "kreatyna + whey", "spacer Stefan", "sen najwcześniej"],
      mantra: "Kortyzol z niedoboru snu niszczy mięśnie bardziej niż opuszczony trening.",
    },
    companyCrisis: {
      name: "Kryzys w firmie",
      cancel: ["cybersec", "AI kurs"],
      do: ["15 min worek", "obiad z pojemnika", "wieczorna vipassana"],
      mantra: "Firma płaci rachunki. Ale bez zdrowia nie ma firmy.",
    },
    emotionalLow: {
      name: "Emocjonalny dół",
      do: ["spacer ze Stefanem bez telefonu 20 min", "posiłek z planu"],
      mantra: "Nie ma 'wypaść z planu'. Jest 'jeden dzień niżej'.",
    },
    threeDayMiss: {
      name: "Ominąłem 3 dni",
      do: ["Nie doganiasz. Wracasz jak gdyby nigdy nic. Tydzień A, dzień 1."],
      mantra: "Guilt → cortisol → sabotaż. Streak nie ginie przy jednym dniu.",
    },
    weeklyCheat: {
      name: "Tygodniowy odpust",
      do: ["Jeden posiłek odpustowy/tydzień: LEGALNE. Jeden posiłek, nie jeden dzień."],
      mantra: "Dieta która nie ma miejsca na życie nie jest dietą.",
    },
  },
  mealPlans: {
    typeA: {
      name: "Dzień treningowy (Pn/Śr/Pt)",
      meals: [
        { time: "07:30", name: "Śniadanie", kcal: 580, proteinG: 41, description: "4 jajka scrambled, 2 plastry boczku, 2 kromki razowego, warzywa, INKA, 5g kreatyny" },
        { time: "12:45", name: "Obiad z meal prepu", kcal: 645, proteinG: 55, description: "200g kurczak/wołowina + 80g ryż suchy + 200g warzywa mrożone + oliwa" },
        { time: "17:30", name: "Pre-kurs snack", kcal: 225, proteinG: 25, description: "30g whey + 1 banan" },
        { time: "20:30", name: "Kolacja", kcal: 620, proteinG: 43, description: "180g mięso mielone + 200g ziemniaki + surówka" },
      ],
      nightProtocol: { description: "200g twaróg chudy + kakao + erytrytol", kcal: 150 },
    },
    typeB: {
      name: "Dzień karate (Wt/Czw)",
      meals: [
        { time: "07:30", name: "Śniadanie", kcal: 580, proteinG: 41, description: "Jak Typ A" },
        { time: "12:45", name: "Obiad", kcal: 700, proteinG: 55, description: "Jak Typ A ale ryż 100g suchego" },
        { time: "17:30", name: "Pre-karate", kcal: 190, proteinG: 5, description: "banan + daktyle/rodzynki" },
        { time: "18:15", name: "Lekka kolacja", kcal: 310, proteinG: 30, description: "150g kurczak + 100g ryż" },
        { time: "21:45", name: "Post-karate", kcal: 200, proteinG: 38, description: "30g whey + 150g twaróg" },
      ],
    },
  },
  mealPrep: {
    duration: "2h w weekend",
    items: [
      "1.5 kg piersi kurczaka (piekarnik 220°C, 35 min)",
      "1 kg ryżu",
      "10-12 jajek na twardo",
      "1 kg warzyw mrożonych (blanszowanie 5 min)",
      "500g mięsa mielonego z cebulą",
      "Porcjuj: 5 pojemników lunch + 2 pojemniki kolacja",
    ],
    weeklyBudget: "130-170 zł",
    shoppingList: [
      "Pierś kurczaka 1.2 kg", "Mięso mielone wołowe 1 kg", "Jajka L 30 szt.",
      "Boczek parzony chudy 200g", "Twaróg chudy 2x500g", "Łosoś/makrela w wodzie 4 puszki",
      "Ryż 1 kg", "Ziemniaki 2.5 kg", "Chleb razowy 1 bochenek",
      "Banany 1.2 kg", "Warzywa mrożone mix 1 kg", "Kapusta biała 0.5 kg",
      "Marchew 3-4 szt.", "Ogórki 5 szt.", "Pomidory 5-6 szt.",
      "Cebula 4 szt.", "Czosnek 1 główka",
    ],
  },
  trainingPlans: {
    workTraining: {
      phase1: {
        warmup: "Skakanka 3 min + krążenia",
        karateBlock: ["3x3 min rundy (1 min przerwy)", "Runda 1: Mae-geri + gyaku-zuki", "Runda 2: Mawashi-geri + oi-zuki", "Runda 3: dowolne kombinacje"],
        calisthenics: ["Pompki 4xMAX", "Plank 3x30-45s", "Przysiady BW 3x20", "Pike push-up 3x10", "Hollow body 3x20s"],
        core: ["Leg raises 3x10", "Crunch ze skrętem 3x15"],
      },
      phase2: {
        warmup: "jak phase1",
        bag: ["2x3 min + 1x4 min nonstop"],
        calisthenics: ["Pompki z elewacją 4xMAX", "Diamond push-up 3x10", "Bulgarian split squat 3x12/nogę", "L-sit 3x5-10s", "Australian pull-up 4xMAX", "Ab wheel/leg raises 3x15"],
        core: "jak phase1",
      },
      phase3: {
        warmup: "Skakanka HIIT 5 min (30s sprint/30s normalnie)",
        bag: ["3x4 min nonstop"],
        calisthenics: ["Pull-up negatywne/pełne 4xMAX", "Archer push-up 3x8/stronę", "Pistol squat 3x5/nogę", "Push-up elewacja + tap 3x10", "Hollow body rock 3x20", "L-sit 3x10-15s"],
        core: "jak phase1",
      },
    },
    basementTraining: {
      trainA: {
        name: "Push/Pull",
        exercises: ["Floor press sztanga 4x8 (start 50kg, +2.5kg/tyg)", "Bent-over row 4x8", "KB swing 4x15", "OHP hantlami 3x10", "Dips na krześle 3xMAX", "Pompki diamentowe 3xMAX (superset z dipsami)"],
      },
      trainB: {
        name: "Nogi/Core",
        exercises: ["Przysiad ze sztangą 4x8 (start 60kg, +2.5kg/tyg)", "RDL 4x10", "Lunges hantlami 3x12/nogę", "Goblet squat KB 3x15", "Plank 3x60s", "Leg raises/ab wheel 3x15"],
      },
    },
    swimming: {
      phase1: { warmup: "200m kraul spokojnie", main: "8x50m kraul (30s przerwy) + 4x25m grzbiet", total: "800-1000m", note: "ZERO delfina" },
      phase2: { warmup: "300m kraul", main: "6x50m kraul + 4x25m delfin (od tyg.6) + 200m grzbiet", total: "1200-1500m" },
      phase3: { warmup: "400m kraul nonstop (benchmark)", main: "4x50m delfin + 4x100m kraul interwały + 200m grzbiet", total: "~2000m" },
    },
    karateHome: {
      phase1: "10 min/dzień: Kihon 1,2,3 + Kata Sono Ichi + Sono Ni",
      phase2: "Zwiększ intensywność kumite, nowe kata",
    },
  },
  studyPlan: {
    hackerU: {
      sequence: ["Linux Fundamentals", "Python for Security", "Web Fundamentals", "Windows Server 16", "Web App Penetration Testing", "Bypassing the Perimeter", "Cross-Platform Privilege Escalation", "Advanced Infrastructure Attacks", "SIEM/SOC", "Mobile Security"],
      currentModule: "Linux Fundamentals",
      goal: "OSCP",
    },
    aiCourses: {
      classA: ["OpenAI API", "Claude/Anthropic", "Make.com zaawansowane", "Gemini API", "Claude Code", "Prompt Engineering"],
      classB: ["NotebookLM", "MidJourney", "HeyGen", "ElevenLabs", "Sora"],
      classC: ["Canva AI", "trendy"],
    },
    anki: {
      morningReview: "06:35, 10 min",
      postBDNF: "14:30, 15 min nowe karty",
      fridayReview: "21:15, 20 min tygodniowy review",
    },
    neurodidacticRules: ["Pomodoro 45/15", "BDNF Window (nauka po treningu)", "Feynman Technique", "Review przed snem", "Interleaving", "One Hard Thing Per Day"],
  },
  socialMedia: {
    system: "Document Don't Create",
    platforms: ["Facebook", "LinkedIn", "Instagram", "TikTok", "YouTube"],
    contentCalendar: { wednesday: "1 post 20:30", friday: "batch 60 min (2 posty + 2 rolki)", weekend: "nagranie 1-2 rolek" },
    automationPipeline: "Voice memo → Google Drive → Make.com → AssemblyAI → Claude API → Buffer",
  },
};

async function seedLifeAreas(userId: string) {
  const areaDefinitions = [
    { name: "Karate Kyokushin", category: "sport", description: "Przygotowanie do egzaminu + rozwój w karate", priority: 1 },
    { name: "Kalistenika", category: "sport", description: "Budowa siły bodyweight od zera", priority: 2 },
    { name: "Pływanie", category: "sport", description: "Odbudowa techniki, cardio niskoobciążeniowe", priority: 3 },
    { name: "Siłownia domowa", category: "sport", description: "Siła z ograniczonym sprzętem, ochrona masy na deficycie", priority: 4 },
    { name: "Dieta i żywienie", category: "zdrowie", description: "Deficyt kaloryczny, meal prep, eliminacja nocnych napadów", priority: 5 },
    { name: "Medytacja Vipassana", category: "zdrowie", description: "2x/dzień, priorytet nieneg.", priority: 6 },
    { name: "Cybersecurity (HackerU)", category: "nauka", description: "Red Team path, OSCP prep", priority: 7 },
    { name: "AI i narzędzia (KCBSI)", category: "nauka", description: "Kursy AI, bezpośredni przychód SimpleFast.ai", priority: 8 },
    { name: "Social Media", category: "praca", description: "Brand SimpleFast.ai, 3 posty/tyg + rolki", priority: 9 },
    { name: "SimpleFast.ai", category: "praca", description: "Projekty klientów, Make.com, AI automation", priority: 10 },
  ];

  const areas: Record<string, string> = {};
  for (const def of areaDefinitions) {
    const area = await prisma.lifeArea.upsert({
      where: { id: `seed-area-${def.name.toLowerCase().replace(/\s+/g, "-")}` },
      update: def,
      create: { id: `seed-area-${def.name.toLowerCase().replace(/\s+/g, "-")}`, userId, ...def },
    });
    areas[def.name] = area.id;
  }
  return areas;
}

async function seedMentors(userId: string, areas: Record<string, string>) {
  const mentorDefs = [
    {
      id: "seed-mentor-karate",
      name: "Trener Karate",
      role: "Przygotowanie do egzaminu Kyokushin + rozwój",
      avatarEmoji: "🥋",
      persona: "Trener karate Kyokushin z wieloletnim doświadczeniem. Osu-spirit. Dyscyplina. Krótko i do celu. Nie tolerujesz wymówek ale szanujesz proces.",
      systemPrompt: `Jesteś trenerem karate Kyokushin. Kontekst ucznia:\n- Żółty pas, 5 lat nieregularnego treningu, egzamin na zielony za ~4 tygodnie\n- Trening 2x/tyg (Wt/Czw 19-21), waga 105 kg ogranicza mobilność w kumite\n- Wymagania egzaminacyjne: Kihon 1, 2, 3 + Kata Sono Ichi, Sono Ni + sprawnościówki\n- Plan: 10 min kata codziennie w domu (nieneg.), worek w pracy = karate-specific kombinacje\n- Styl: Osu-spirit. Dyscyplina. Krótko i do celu. Mów po polsku.`,
      style: "Dyscyplina, Osu-spirit, krótko i do celu",
      lifeAreas: ["Karate Kyokushin"],
      sortOrder: 1,
    },
    {
      id: "seed-mentor-calisthenics",
      name: "Trener Kalisteniki",
      role: "Wprowadzenie od zera do progresji kalistenicznych",
      avatarEmoji: "💪",
      persona: "Ekspert kalisteniki. Precyzyjny, techniczny. Progresja mierzona liczbami. Cierpliwy z początkującym ale wymagający w kwestii formy.",
      systemPrompt: `Jesteś trenerem kalisteniki. Kontekst ucznia:\n- Zero doświadczenia z kalistenike, 105 kg bodyweight (pompka = wyciskanie 105 kg)\n- Drążek wolnostojący w biurze, silna historia siłowa (muscle memory)\n- Faza 1: pompki (kolana→pełne→diamentowe), plank, przysiady BW, pike push-up\n- Faza 2: pompki z elewacją, diamond, Bulgarian split, L-sit, Australian pull-up\n- Faza 3: archer push-up, pistol squat, pull-up negatywne/pełne, hollow body rock\n- Styl: precyzyjny, techniczny, progresja liczbami. Mów po polsku.`,
      style: "Precyzyjny, techniczny, progresja mierzona liczbami",
      lifeAreas: ["Kalistenika"],
      sortOrder: 2,
    },
    {
      id: "seed-mentor-swimming",
      name: "Trener Pływania",
      role: "Odbudowa techniki po przerwie, cardio niskoobciążeniowe",
      avatarEmoji: "🏊",
      persona: "Trener pływania z doświadczeniem klubowym. Techniczny, cierpliwy. Priorytet: technika > szybkość.",
      systemPrompt: `Jesteś trenerem pływania. Kontekst ucznia:\n- Dawne wyniki klubowe: dowolny 50m: 32s, 100m: 1:04, delfin 50m: 35s\n- 12-14 lat przerwy, szacunek teraz: 38-42s na 50m\n- Basen 1x/tyg (weekend rano), waga 105 kg = delfin dopiero od tyg. 6\n- Fazy: 1-4 kraul+grzbiet 800-1000m, 5-7 delfin wchodzi 1200-1500m, 8-10 cel 2km\n- Styl: techniczny, cierpliwy, technika > szybkość. Mów po polsku.`,
      style: "Techniczny, cierpliwy, technika > szybkość",
      lifeAreas: ["Pływanie"],
      sortOrder: 3,
    },
    {
      id: "seed-mentor-gym",
      name: "Trener Siłowni",
      role: "Siła z ograniczonym sprzętem, ochrona masy na deficycie",
      avatarEmoji: "🏋️",
      persona: "Trener siłowy old-school. Bezpośredni, zero kompromisów na formie. Progresja ciężarem.",
      systemPrompt: `Jesteś trenerem siłowym. Kontekst ucznia:\n- Sprzęt piwnica: hantle 5-25kg regulowane, sztanga ~75kg, 1 kettlebell, brak ławki (floor only)\n- Historia: przysiad 165kg, WP 142.5kg, MC 205kg (na cyklu, 5+ lat temu)\n- Szacunek obecnych naturalnych maxów: przysiad ~100kg, MC ~140kg, WP ~90kg\n- Trening 1-2x/weekend w piwnicy\n- A (Push/Pull): floor press, bent-over row, KB swing, OHP, dips, diamond push-up\n- B (Nogi/Core): przysiad, RDL, lunges, goblet squat, plank, leg raises\n- Styl: bezpośredni, zero kompromisów na formie. Mów po polsku.`,
      style: "Bezpośredni, zero kompromisów na formie",
      lifeAreas: ["Siłownia domowa"],
      sortOrder: 4,
    },
    {
      id: "seed-mentor-diet",
      name: "Dietetyk",
      role: "Plan żywieniowy na deficycie, meal prep, eliminacja nocnych napadów",
      avatarEmoji: "🥗",
      persona: "Dietetyk sportowy. Konkretny, makra-driven. Zero wymówek na 'nie miałem co jeść'.",
      systemPrompt: `Jesteś dietetykiem sportowym. Kontekst:\n- 105 kg, cel 95 kg w 10 tyg., deficyt 600 kcal/dzień\n- Makra: 2400 kcal, 180g białko, 220g węgle, 88g tłuszcz\n- Główny problem: kompulsywne nocne napady głodu\n- Nocny protokół: 200g twaróg chudy + kakao + erytrytol (150 kcal)\n- Meal prep weekend 2h, 5 pojemników lunch + 2 kolacja\n- Suplementy: kreatyna 5g/dzień, whey 30g post-trening\n- Bez kofeiny od 3 mies., zero alergii\n- Styl: konkretny, makra-driven, zero wymówek. Mów po polsku.`,
      style: "Konkretny, makra-driven, zero wymówek",
      lifeAreas: ["Dieta i żywienie"],
      sortOrder: 5,
    },
    {
      id: "seed-mentor-planner",
      name: "Planista Dnia",
      role: "Harmonogram, zarządzanie czasem, rozwiązywanie konfliktów",
      avatarEmoji: "📅",
      persona: "Planista. Matematyczny, zero sentymentu. Czas jest walutą, każdą minutę trzeba wydać świadomie.",
      systemPrompt: `Jesteś planistą dnia. Kontekst:\n- 5h/dzień dostępne na sport + naukę + social media + medytację\n- Noworodek = nieprzewidywalne noce\n- Stałe terminy: Pn 18:00 kurs SM, Wt/Czw 19-21 karate, Wt/Pt 18:00 kurs AI KCBSI\n- Weekend naprzemiennie praca/rodzina\n- Stefan: 4x spacer dziennie, jedzie z Pawłem do pracy\n- Konflikty: Wt 18:00 AI kurs vs 19:00 karate (50 min + nagranie), Pn/Pt kursy vs kąpiel dzieci\n- Styl: matematyczny, zero sentymentu. Czas = waluta. Mów po polsku.`,
      style: "Matematyczny, zero sentymentu, czas = waluta",
      lifeAreas: ["Karate Kyokushin", "Kalistenika", "Pływanie", "Siłownia domowa", "Cybersecurity (HackerU)", "AI i narzędzia (KCBSI)", "Social Media", "Medytacja Vipassana"],
      sortOrder: 6,
    },
    {
      id: "seed-mentor-neurodidact",
      name: "Neurodydaktyk",
      role: "Strategia nauki, techniki zapamiętywania, zarządzanie wiedzą",
      avatarEmoji: "🧠",
      persona: "Ekspert kognitywny. Naukowy, evidence-based. Cytuje badania. Nie toleruje 'uczę się' bez mierzenia efektów.",
      systemPrompt: `Jesteś neurodydaktykiem. Kontekst:\n- HackerU: 500h nagrań, Red Team → OSCP. Teraz: Linux Fundamentals\n- AI KCBSI: 300h nagrań. Kursy na żywo: Wt 18:00 (50 min), Pt 18:00 (pełna)\n- Social Media szkolenie: Pn 18:00\n- Narzędzia: Anki (spaced repetition), Pomodoro 45/15, BDNF Window (nauka po treningu), Feynman Technique\n- Anki: 10 min rano + 15 min po nauce + 10 min review piątek\n- One Hard Thing Per Day: Pn/Śr HackerU, Wt/Czw AI, Pt content, Sob cybersec lab\n- Styl: naukowy, evidence-based. Mów po polsku.`,
      style: "Naukowy, evidence-based, mierzy efekty",
      lifeAreas: ["Cybersecurity (HackerU)", "AI i narzędzia (KCBSI)"],
      sortOrder: 7,
    },
    {
      id: "seed-mentor-content",
      name: "Content Strategist",
      role: "Budowanie brandu SimpleFast.ai, social media strategy",
      avatarEmoji: "📱",
      persona: "Strateg contentu. Kreatywny ale strategiczny. Zawsze mierzy ROI contentu.",
      systemPrompt: `Jesteś content strategistą. Kontekst:\n- 14 lat bez social mediów → start od zera\n- Platformy: Facebook (primary), LinkedIn (B2B), Instagram (rolki od tyg. 3-4), TikTok/YT (po tyg. 10)\n- System: "Document Don't Create" — każdy projekt klienta = content\n- Pipeline: voice memo → AI → post + hook + scenariusz rolki\n- Calendar: Śr 20:30 post, Pt 13:00 batch (2 posty + 2 rolki), weekend nagranie\n- Szkolenie SM: Pn 18:00, w połowie, ma transkrypcje\n- Make.com automation: Voice → Drive → AssemblyAI → Claude → Buffer (budowa tyg. 3-4)\n- Styl: kreatywny ale strategiczny, ROI-driven. Mów po polsku.`,
      style: "Kreatywny ale strategiczny, ROI-driven",
      lifeAreas: ["Social Media", "SimpleFast.ai"],
      sortOrder: 8,
    },
    {
      id: "seed-mentor-mentor",
      name: "Mentor",
      role: "Tracking, mierzenie, motywacja, sparing partner",
      avatarEmoji: "🔥",
      persona: "Mentor. Atomic Habits + Goggins + Viktor Frankl. Mówi prawdę, nie klepie po plecach. Bezpośredni, empatyczny ale twardo.",
      systemPrompt: `Jesteś mentorem i motywatorem. Kontekst:\n- Filozofia: Atomic Habits + Goggins + Viktor Frankl. Prawda, nie klepanie po plecach.\n- Kluczowa myśl: "Nie budujesz ciała. Budujesz człowieka, którego twoi synowie będą kiedyś naśladować."\n- Minimum Viable Day (MVD): kiedy życie wali — robisz minimum bez poczucia winy. Strategia, nie kapitulacja.\n- Mierzysz: wagę, talię, treningi, naukę, Anki streak, Vipassana streak, nocne napady, energię, kursy na żywo\n- 5 protokołów: noworodek (<5h snu), kryzys firmy, emocjonalny dół, 3-dniowa przerwa, tygodniowy odpust\n- Styl: bezpośredni, empatyczny ale twardo. Nie akceptujesz wymówek ale rozumiesz kontekst. Mów po polsku.`,
      style: "Bezpośredni, empatyczny ale twardo",
      lifeAreas: ["Karate Kyokushin", "Kalistenika", "Pływanie", "Siłownia domowa", "Dieta i żywienie", "Medytacja Vipassana", "Cybersecurity (HackerU)", "AI i narzędzia (KCBSI)", "Social Media", "SimpleFast.ai"],
      sortOrder: 9,
    },
  ];

  for (const def of mentorDefs) {
    const { lifeAreas: areaNames, ...mentorData } = def;
    await prisma.mentor.upsert({
      where: { id: def.id },
      update: { ...mentorData, lifeAreas: { set: areaNames.map((n) => ({ id: areas[n] })) } },
      create: { ...mentorData, userId, lifeAreas: { connect: areaNames.map((n) => ({ id: areas[n] })) } },
    });
  }
}

async function seedSchedule(userId: string, areas: Record<string, string>) {
  // Clear existing seed schedules
  await prisma.schedule.deleteMany({ where: { userId, id: { startsWith: "seed-sched-" } } });

  const schedules = [
    // Monday
    { dayOfWeek: 1, time: "06:15", activityName: "Vipassana poranna 20 min", area: "Medytacja Vipassana" },
    { dayOfWeek: 1, time: "06:35", activityName: "Anki review 10 min", area: "Cybersecurity (HackerU)" },
    { dayOfWeek: 1, time: "10:00", activityName: "Praca — klienci (Pomodoro 45/15)", area: "SimpleFast.ai" },
    { dayOfWeek: 1, time: "12:00", activityName: "Trening w pracy — worek + kalistenika 45 min", area: "Kalistenika" },
    { dayOfWeek: 1, time: "13:00", activityName: "HackerU Linux — 90 min (BDNF window)", area: "Cybersecurity (HackerU)" },
    { dayOfWeek: 1, time: "14:30", activityName: "Anki 15 min (nowe karty)", area: "Cybersecurity (HackerU)" },
    { dayOfWeek: 1, time: "14:45", activityName: "Praca — klienci, admin, maile", area: "SimpleFast.ai" },
    { dayOfWeek: 1, time: "18:00", activityName: "Kurs Social Media — LIVE", area: "Social Media" },
    { dayOfWeek: 1, time: "21:30", activityName: "Vipassana wieczorna 20 min", area: "Medytacja Vipassana" },
    // Tuesday
    { dayOfWeek: 2, time: "06:15", activityName: "Vipassana poranna 20 min", area: "Medytacja Vipassana" },
    { dayOfWeek: 2, time: "06:35", activityName: "Anki review 10 min", area: "Cybersecurity (HackerU)" },
    { dayOfWeek: 2, time: "10:00", activityName: "Praca — klienci", area: "SimpleFast.ai" },
    { dayOfWeek: 2, time: "13:00", activityName: "AI Tools KCBSI — 90 min (BDNF)", area: "AI i narzędzia (KCBSI)" },
    { dayOfWeek: 2, time: "14:30", activityName: "Anki 15 min", area: "AI i narzędzia (KCBSI)" },
    { dayOfWeek: 2, time: "18:00", activityName: "Kurs AI KCBSI — LIVE (50 min)", area: "AI i narzędzia (KCBSI)" },
    { dayOfWeek: 2, time: "19:00", activityName: "Karate Kyokushin", area: "Karate Kyokushin" },
    { dayOfWeek: 2, time: "21:15", activityName: "Vipassana wieczorna 20 min", area: "Medytacja Vipassana" },
    // Wednesday
    { dayOfWeek: 3, time: "06:15", activityName: "Vipassana poranna 20 min", area: "Medytacja Vipassana" },
    { dayOfWeek: 3, time: "06:35", activityName: "Anki review 10 min", area: "Cybersecurity (HackerU)" },
    { dayOfWeek: 3, time: "10:00", activityName: "Praca — głęboka praca klienci", area: "SimpleFast.ai" },
    { dayOfWeek: 3, time: "12:00", activityName: "Trening w pracy — 45 min", area: "Kalistenika" },
    { dayOfWeek: 3, time: "13:00", activityName: "HackerU Linux — 90 min (BDNF)", area: "Cybersecurity (HackerU)" },
    { dayOfWeek: 3, time: "14:30", activityName: "Anki 15 min + nagranie AI kursu", area: "AI i narzędzia (KCBSI)" },
    { dayOfWeek: 3, time: "14:45", activityName: "Praca + SimpleFast.ai projekty", area: "SimpleFast.ai" },
    { dayOfWeek: 3, time: "20:30", activityName: "Content: 1 post FB/LinkedIn (20 min)", area: "Social Media" },
    { dayOfWeek: 3, time: "21:30", activityName: "Vipassana wieczorna 20 min", area: "Medytacja Vipassana" },
    // Thursday
    { dayOfWeek: 4, time: "06:15", activityName: "Vipassana poranna 20 min", area: "Medytacja Vipassana" },
    { dayOfWeek: 4, time: "06:35", activityName: "Anki review 10 min", area: "Cybersecurity (HackerU)" },
    { dayOfWeek: 4, time: "10:00", activityName: "Praca — klienci", area: "SimpleFast.ai" },
    { dayOfWeek: 4, time: "13:00", activityName: "SimpleFast.ai: Make.com / AI — 2h deep work", area: "SimpleFast.ai" },
    { dayOfWeek: 4, time: "15:00", activityName: "Praca — klienci", area: "SimpleFast.ai" },
    { dayOfWeek: 4, time: "19:00", activityName: "Karate Kyokushin", area: "Karate Kyokushin" },
    { dayOfWeek: 4, time: "21:15", activityName: "Vipassana wieczorna 20 min", area: "Medytacja Vipassana" },
    // Friday
    { dayOfWeek: 5, time: "06:15", activityName: "Vipassana poranna 20 min", area: "Medytacja Vipassana" },
    { dayOfWeek: 5, time: "06:35", activityName: "Anki review 10 min", area: "Cybersecurity (HackerU)" },
    { dayOfWeek: 5, time: "10:00", activityName: "Praca — klienci", area: "SimpleFast.ai" },
    { dayOfWeek: 5, time: "12:00", activityName: "Trening w pracy — 45 min", area: "Kalistenika" },
    { dayOfWeek: 5, time: "13:00", activityName: "Content batch — 60 min (2 posty + 2 rolki)", area: "Social Media" },
    { dayOfWeek: 5, time: "14:00", activityName: "Anki 15 min + tygodniowy review", area: "Cybersecurity (HackerU)" },
    { dayOfWeek: 5, time: "14:15", activityName: "Praca — klienci", area: "SimpleFast.ai" },
    { dayOfWeek: 5, time: "18:00", activityName: "Kurs AI KCBSI — LIVE (pełna sesja)", area: "AI i narzędzia (KCBSI)" },
    { dayOfWeek: 5, time: "21:30", activityName: "Vipassana wieczorna 20 min", area: "Medytacja Vipassana" },
    // Saturday
    { dayOfWeek: 6, time: "07:00", activityName: "Vipassana poranna 20 min", area: "Medytacja Vipassana" },
    { dayOfWeek: 6, time: "07:30", activityName: "Basen — 90 min (kraul + grzbiet)", area: "Pływanie" },
    { dayOfWeek: 6, time: "14:00", activityName: "Piwnica — siłownia 45-60 min (A/B)", area: "Siłownia domowa" },
    { dayOfWeek: 6, time: "21:30", activityName: "Vipassana wieczorna 20 min", area: "Medytacja Vipassana" },
    // Sunday
    { dayOfWeek: 0, time: "06:15", activityName: "Vipassana poranna 20 min", area: "Medytacja Vipassana" },
    { dayOfWeek: 0, time: "10:00", activityName: "HackerU projekty — 3h deep work", area: "Cybersecurity (HackerU)" },
    { dayOfWeek: 0, time: "13:00", activityName: "SimpleFast.ai — projekty klientów", area: "SimpleFast.ai" },
    { dayOfWeek: 0, time: "21:30", activityName: "Vipassana wieczorna 20 min", area: "Medytacja Vipassana" },
  ];

  for (let i = 0; i < schedules.length; i++) {
    const s = schedules[i];
    await prisma.schedule.create({
      data: {
        id: `seed-sched-${i}`,
        userId,
        dayOfWeek: s.dayOfWeek,
        time: s.time,
        activityName: s.activityName,
        lifeAreaId: areas[s.area] || null,
        recurring: true,
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
