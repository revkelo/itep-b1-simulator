const STORAGE_KEY = "itep_v4_state";

const state = {
  loading: true,
  error: "",
  mode: "exam",
  test: null,
  builtInTest: null,
  usingImportedExam: false,
  importOpen: false,
  importStatus: "",
  importMsg: "",
  importPasteText: "",
  started: false,
  view: "instructions",
  sectionOrder: ["grammar", "listening", "reading", "writing", "speaking"],
  sectionIndex: 0,
  pendingSectionIndex: 0,
  sectionTransitionLabel: "",
  questionIndexes: { grammar: 0, listening: 0, reading: 0 },
  writingPartIndex: 0,
  writingPartRemaining: 0,
  writingPartTimerId: null,
  speakingPartIndex: 0,
  answers: {},
  writingTexts: {},
  listeningPlaybacks: {},
  listeningUnlocked: {},
  notes: { listening: {}, speaking: {} },
  speakingRecordings: {},
  speakingTranscript: "",
  speakingTranscripts: {},
  speakingEvaluation: {},
  /* Por que no hay transcripcion, cuando no la hay. El informe lo ensena. */
  speakingMotivos: {},
  /* null = todavia no se le ha preguntado a /api/estado */
  califica: null,
  speakingAudioUrls: {},
  deviceCheck: { pendingMode: null, micStatus: "idle", micUrl: null, audioStatus: "idle" },
  writingEvaluation: {},
  speakingStatus: "idle",
  speakingAutoStartedFor: "",
  finalizing: false,
  speakingPrepRemaining: 0,
  speakingPrepTimerId: null,
  speakingRemaining: 0,
  speakingTimerId: null,
  sectionRemaining: 0,
  timerId: null
};

const app = document.getElementById("app");

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    mode: state.mode,
    answers: state.answers,
    writingTexts: state.writingTexts,
    notes: state.notes,
    speakingRecordings: state.speakingRecordings,
    speakingTranscripts: state.speakingTranscripts,
    speakingEvaluation: state.speakingEvaluation,
    speakingMotivos: state.speakingMotivos,
    writingEvaluation: state.writingEvaluation,
    speakingPrepRemaining: state.speakingPrepRemaining,
    sectionIndex: state.sectionIndex
  }));
}

function loadState() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (p.mode === "study" || p.mode === "exam") state.mode = p.mode;
    if (p.answers) state.answers = p.answers;
    if (p.writingTexts) state.writingTexts = p.writingTexts;
    if (p.notes) state.notes = p.notes;
    if (p.speakingRecordings) state.speakingRecordings = p.speakingRecordings;
    if (p.speakingTranscripts) state.speakingTranscripts = p.speakingTranscripts;
    if (p.speakingEvaluation) state.speakingEvaluation = p.speakingEvaluation;
    if (p.speakingMotivos) state.speakingMotivos = p.speakingMotivos;
    if (p.writingEvaluation) state.writingEvaluation = p.writingEvaluation;
    if (typeof p.speakingPrepRemaining === "number") state.speakingPrepRemaining = p.speakingPrepRemaining;
    if (typeof p.sectionIndex === "number") state.sectionIndex = p.sectionIndex;
  } catch {}
}

function esc(v) {
  return String(v || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function promiseWithTimeout(promise, ms, fallback = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);
}

async function init() {
  loadState();
  /*
   * Se pregunta una vez, al arrancar, si este despliegue puede calificar. Sin
   * esto la pantalla de speaking no puede avisar ANTES de grabar, y el
   * candidato se entera de que su respuesta no tiene nota en el informe final,
   * cuando ya gasto los dos minutos. No bloquea el arranque: si tarda o falla,
   * queda en false y el examen sigue.
   */
  consultarSiCalifica().then(() => { if (!state.loading) render(); });
  try {
    const dataUrl = `${import.meta.env.BASE_URL}data/exam-data.json`;
    const res = await fetch(dataUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.test = data.tests.find((t) => t.id === data.meta.defaultTestId) || data.tests[0];
    if (!state.test) throw new Error("No test found");
    /* Copia intacta: al importar un examen se usa como relleno de las secciones
       que vengan incompletas, y es a donde vuelve el boton de restablecer. */
    state.builtInTest = cloneJson(state.test);
    state.loading = false;
  } catch (e) {
    state.loading = false;
    state.error = e.message || "Load error";
  }
  render();
}

function sectionName() { return state.sectionOrder[state.sectionIndex]; }
function sectionData() { return state.test.sections[sectionName()]; }

function validateGeneratedTest(test) {
  if (!test?.sections) return false;
  const s = test.sections;
  return !!(
    Array.isArray(s.grammar?.questions) &&
    Array.isArray(s.listening?.items) &&
    Array.isArray(s.reading?.passages) &&
    Array.isArray(s.writing?.prompts) &&
    Array.isArray(s.speaking?.prompts)
  );
}

function extractLikelyJsonBlock(text) {
  const cleaned = String(text || "").trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return cleaned;
  return cleaned.slice(start, end + 1);
}

function sanitizeJsonString(raw) {
  let s = raw;
  s = s.replace(/[\u201C\u201D]/g, "\"").replace(/[\u2018\u2019]/g, "'");
  s = s.replace(/,\s*([}\]])/g, "$1");
  return s;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureQuestionShape(q, fallbackId, idx) {
  const options = toArray(q?.options).slice(0, 4);
  while (options.length < 4) options.push(`Option ${options.length + 1}`);
  return {
    id: q?.id || `${fallbackId}_${idx + 1}`,
    type: q?.type || "multiple_choice",
    difficulty: q?.difficulty || "B1",
    tags: toArray(q?.tags),
    prompt: q?.prompt || "Question prompt missing.",
    options,
    correctAnswer: Number.isInteger(q?.correctAnswer) ? Math.max(0, Math.min(3, q.correctAnswer)) : 0,
    explanation: q?.explanation || "Review this concept."
  };
}

function normalizeGeneratedTest(input) {
  const t = input || {};
  const sections = t.sections || {};

  const grammarQs = toArray(sections.grammar?.questions).map((q, i) => ensureQuestionShape(q, "g", i));

  const listeningItems = toArray(sections.listening?.items).map((it, i) => ({
    id: it?.id || `l${i + 1}`,
    audioMode: it?.audioMode || "tts",
    playLimit: Number.isFinite(it?.playLimit) ? Math.max(1, it.playLimit) : 1,
    voiceLang: it?.voiceLang || "en-US",
    speechRate: Number.isFinite(it?.speechRate) ? it.speechRate : 0.95,
    transcript: it?.transcript || "Listening transcript placeholder.",
    questions: toArray(it?.questions).map((q, qi) => ensureQuestionShape(q, `l${i + 1}q`, qi)),
    answerTimeLimit: Number.isFinite(it?.answerTimeLimit) ? Math.max(10, it.answerTimeLimit) : (i < 4 ? 20 : i === 4 ? 120 : 180)
  }));

  const readingPassages = toArray(sections.reading?.passages).map((p, i) => ({
    id: p?.id || `r${i + 1}`,
    title: p?.title || `Reading Passage ${i + 1}`,
    text: p?.text || "Reading text placeholder.",
    questions: toArray(p?.questions).map((q, qi) => ensureQuestionShape(q, `r${i + 1}q`, qi))
  }));

  const writingPrompts = toArray(sections.writing?.prompts).map((p, i) => ({
    id: p?.id || `w${i + 1}`,
    type: p?.type || (i === 0 ? "informal_note" : "opinion"),
    prompt: p?.prompt || "Writing prompt placeholder.",
    minWords: Number.isFinite(p?.minWords) ? p.minWords : (i === 0 ? 50 : 175),
    maxWords: Number.isFinite(p?.maxWords) ? p.maxWords : (i === 0 ? 75 : 250),
    recommendedTime: Number.isFinite(p?.recommendedTime) ? p.recommendedTime : (i === 0 ? 300 : 1200)
  }));

  const speakingPrompts = toArray(sections.speaking?.prompts).map((p, i) => ({
    id: p?.id || `s${i + 1}`,
    type: p?.type || (i === 0 ? "personal_response" : "opinion_from_audio"),
    prompt: p?.prompt || "Speaking prompt placeholder.",
    prepTime: Number.isFinite(p?.prepTime) ? p.prepTime : (i === 0 ? 30 : 45),
    speakTime: Number.isFinite(p?.speakTime) ? p.speakTime : (i === 0 ? 45 : 60)
  }));

  return {
    id: t.id || `generated_${Date.now()}`,
    title: t.title || "Generated iTEP Practice Exam",
    instructions: toArray(t.instructions).length ? t.instructions : [
      "Complete sections in order.",
      "Listening is forward-only.",
      "Use notes if needed.",
      "Follow iTEP timing."
    ],
    sections: {
      grammar: { timeLimit: Number.isFinite(sections.grammar?.timeLimit) ? sections.grammar.timeLimit : 600, weight: 0.2, questions: grammarQs },
      listening: { timeLimit: Number.isFinite(sections.listening?.timeLimit) ? sections.listening.timeLimit : 380, weight: 0.2, items: listeningItems },
      reading: { timeLimit: Number.isFinite(sections.reading?.timeLimit) ? sections.reading.timeLimit : 1200, weight: 0.2, passages: readingPassages },
      writing: { timeLimit: Number.isFinite(sections.writing?.timeLimit) ? sections.writing.timeLimit : 1500, weight: 0.2, prompts: writingPrompts },
      speaking: { timeLimit: Number.isFinite(sections.speaking?.timeLimit) ? sections.speaking.timeLimit : 180, weight: 0.2, prompts: speakingPrompts }
    }
  };
}

function enforceGeneratedExamContract(test) {
  const t = normalizeGeneratedTest(test);

  // Force iTEP-style blueprint as in data example.
  t.sections.grammar.timeLimit = 600;
  t.sections.listening.timeLimit = 380;
  t.sections.reading.timeLimit = 1200;
  t.sections.writing.timeLimit = 1500;
  t.sections.speaking.timeLimit = 240;
  t.sections.grammar.weight = 0.2;
  t.sections.listening.weight = 0.2;
  t.sections.reading.weight = 0.2;
  t.sections.writing.weight = 0.2;
  t.sections.speaking.weight = 0.2;

  t.sections.grammar.questions = toArray(t.sections.grammar.questions).slice(0, 25);
  while (t.sections.grammar.questions.length < 25) {
    t.sections.grammar.questions.push(ensureQuestionShape({}, "g", t.sections.grammar.questions.length));
  }
  t.sections.grammar.questions = t.sections.grammar.questions.map((q, i) => ({
    ...q,
    id: `g${i + 1}`,
    type: i < 13 ? "sentence_completion" : "error_detection"
  }));

  t.sections.listening.items = toArray(t.sections.listening.items).slice(0, 6);
  while (t.sections.listening.items.length < 6) {
    const i = t.sections.listening.items.length;
    t.sections.listening.items.push({
      id: `l${i + 1}`,
      audioMode: "tts",
      playLimit: 1,
      voiceLang: "en-US",
      speechRate: 0.95,
      transcript: "Listening transcript placeholder.",
      questions: [],
      answerTimeLimit: i < 4 ? 20 : i === 4 ? 120 : 180
    });
  }
  // Part 1: l1-l4 (1q each), Part 2: l5 (4q), Part 3: l6 (6q)
  const listeningQuestionCounts = [1, 1, 1, 1, 4, 6];
  const listeningQIdBase = [1, 2, 3, 4, 5, 9];
  t.sections.listening.items = t.sections.listening.items.map((it, i) => {
    const target = listeningQuestionCounts[i];
    const base = listeningQIdBase[i];
    let qs = toArray(it.questions).slice(0, target).map((q, qi) => ({
      ...ensureQuestionShape(q, `l${i + 1}q`, qi),
      id: `l${i + 1}q${i < 4 ? base : base + qi}`
    }));
    while (qs.length < target) {
      const qi = qs.length;
      qs.push({
        ...ensureQuestionShape({}, `l${i + 1}q`, qi),
        id: `l${i + 1}q${i < 4 ? base : base + qi}`
      });
    }
    return {
      ...it,
      id: `l${i + 1}`,
      audioMode: "tts",
      playLimit: 1,
      voiceLang: "en-US",
      speechRate: Number.isFinite(it.speechRate) ? it.speechRate : 0.95,
      answerTimeLimit: i < 4 ? 20 : i === 4 ? 120 : 180,
      questions: qs
    };
  });

  t.sections.reading.passages = toArray(t.sections.reading.passages).slice(0, 2);
  while (t.sections.reading.passages.length < 2) {
    const i = t.sections.reading.passages.length;
    t.sections.reading.passages.push({
      id: `r${i + 1}`,
      title: `Reading Passage ${i + 1}`,
      text: "Reading text placeholder.",
      questions: []
    });
  }
  const readingQuestionCounts = [4, 6];
  t.sections.reading.passages = t.sections.reading.passages.map((p, i) => {
    const target = readingQuestionCounts[i];
    let qs = toArray(p.questions).slice(0, target).map((q, qi) => ({
      ...ensureQuestionShape(q, `r${i + 1}q`, qi),
      id: `r${i + 1}q${i === 0 ? qi + 1 : qi + 5}`
    }));
    while (qs.length < target) {
      const qi = qs.length;
      qs.push({
        ...ensureQuestionShape({}, `r${i + 1}q`, qi),
        id: `r${i + 1}q${i === 0 ? qi + 1 : qi + 5}`
      });
    }
    return { ...p, id: `r${i + 1}`, questions: qs };
  });

  t.sections.writing.prompts = toArray(t.sections.writing.prompts).slice(0, 2);
  while (t.sections.writing.prompts.length < 2) {
    t.sections.writing.prompts.push({});
  }
  t.sections.writing.prompts = t.sections.writing.prompts.map((p, i) => ({
    ...p,
    id: `w${i + 1}`,
    type: i === 0 ? "informal_note" : "opinion_essay",
    minWords: i === 0 ? 50 : 175,
    maxWords: i === 0 ? 75 : 250,
    recommendedTime: i === 0 ? 300 : 1200
  }));

  t.sections.speaking.prompts = toArray(t.sections.speaking.prompts).slice(0, 2);
  while (t.sections.speaking.prompts.length < 2) {
    t.sections.speaking.prompts.push({});
  }
  t.sections.speaking.prompts = t.sections.speaking.prompts.map((p, i) => ({
    ...p,
    id: `s${i + 1}`,
    type: i === 0 ? "personal_response" : "integrated_opinion",
    prepTime: 45,
    speakTime: 60
  }));

  return t;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeWithFallbackSection(generatedTest, fallbackTest) {
  if (!fallbackTest?.sections) return generatedTest;
  const merged = cloneJson(generatedTest);
  const fallback = fallbackTest.sections;
  const sec = merged.sections || {};

  const hasGoodGrammar = Array.isArray(sec.grammar?.questions) && sec.grammar.questions.some((q) => (q?.prompt || "").trim().length > 12);
  if (!hasGoodGrammar) merged.sections.grammar = cloneJson(fallback.grammar);

  const hasGoodListening = Array.isArray(sec.listening?.items)
    && sec.listening.items.length === 6
    && sec.listening.items.slice(0, 4).every((i) => (i?.transcript || "").trim().length > 30)
    && (sec.listening.items[4]?.transcript || "").trim().length > 200
    && (sec.listening.items[5]?.transcript || "").trim().length > 300;
  if (!hasGoodListening) merged.sections.listening = cloneJson(fallback.listening);

  const hasGoodReading = Array.isArray(sec.reading?.passages)
    && sec.reading.passages.length === 2
    && (sec.reading.passages[0]?.text || "").trim().length > 800
    && (sec.reading.passages[1]?.text || "").trim().length > 1000;
  if (!hasGoodReading) merged.sections.reading = cloneJson(fallback.reading);

  const hasGoodWriting = Array.isArray(sec.writing?.prompts)
    && sec.writing.prompts.length === 2
    && sec.writing.prompts.every((p) => (p?.prompt || "").trim().length > 20);
  if (!hasGoodWriting) merged.sections.writing = cloneJson(fallback.writing);

  const hasGoodSpeaking = Array.isArray(sec.speaking?.prompts)
    && sec.speaking.prompts.length === 2
    && sec.speaking.prompts.every((p) => (p?.prompt || "").trim().length > 20);
  if (!hasGoodSpeaking) merged.sections.speaking = cloneJson(fallback.speaking);

  return merged;
}

/* El mismo esquema que antes le describiamos al modelo, ahora al reves: es la
   plantilla que se descarga para saber que forma tiene un examen valido. Un
   ejemplo concreto explica el formato mejor que cualquier especificacion, y de
   paso se puede abrir y editar sin escribir nada desde cero. */
const EXAM_TEMPLATE = {
  id: "string",
  title: "string",
  instructions: ["string"],
  sections: {
    grammar: { timeLimit: 600, weight: 0.2, questions: [
      { id: "g1", type: "sentence_completion", prompt: "She ___ to the store every day.", options: ["go", "goes", "going", "gone"], correctAnswer: 1, explanation: "Third person singular uses 'goes'.", difficulty: "A2", tags: ["verb_agreement"] },
      { id: "g14", type: "error_detection", prompt: "She don't likes coffee in the morning.", options: ["She", "don't likes", "coffee", "in the morning"], correctAnswer: 1, explanation: "'Don't likes' should be 'doesn't like'.", difficulty: "B1", tags: ["negation"] }
    ]},
    listening: { timeLimit: 380, weight: 0.2, items: [
      { id: "l1", audioMode: "tts", playLimit: 1, voiceLang: "en-US", speechRate: 0.95, transcript: "A: Are you coming to the party tonight? B: I'm not sure yet. I have a lot of work to finish.", questions: [{ id: "l1q1", prompt: "What is the woman unsure about?", options: ["Her work schedule", "Attending a party", "Finishing dinner", "Calling a friend"], correctAnswer: 1, explanation: "She says she is not sure about coming to the party.", difficulty: "A2", tags: ["detail"] }], answerTimeLimit: 20 },
      { id: "l2", audioMode: "tts", playLimit: 1, voiceLang: "en-US", speechRate: 0.95, transcript: "A: Did you remember to buy milk? B: Yes, I got two bottles from the store.", questions: [{ id: "l2q2", prompt: "How many bottles of milk did the man buy?", options: ["One", "Two", "Three", "None"], correctAnswer: 1, explanation: "He said he got two bottles.", difficulty: "A2", tags: ["detail"] }], answerTimeLimit: 20 },
      { id: "l3", audioMode: "tts", playLimit: 1, voiceLang: "en-US", speechRate: 0.95, transcript: "A: The train leaves at 8:15, not 8:30. B: Oh, I thought it was 8:30. Thanks for telling me.", questions: [{ id: "l3q3", prompt: "When does the train leave?", options: ["8:00", "8:15", "8:30", "8:45"], correctAnswer: 1, explanation: "The man corrects the time to 8:15.", difficulty: "A2", tags: ["detail"] }], answerTimeLimit: 20 },
      { id: "l4", audioMode: "tts", playLimit: 1, voiceLang: "en-US", speechRate: 0.95, transcript: "A: Is the library open on Sundays? B: Yes, but only until 5 PM.", questions: [{ id: "l4q4", prompt: "When does the library close on Sundays?", options: ["3 PM", "4 PM", "5 PM", "6 PM"], correctAnswer: 2, explanation: "The woman says the library is open until 5 PM on Sundays.", difficulty: "A2", tags: ["detail"] }], answerTimeLimit: 20 },
      { id: "l5", audioMode: "tts", playLimit: 1, voiceLang: "en-US", speechRate: 0.94, transcript: "Long multi-turn conversation (150-200 words) between two people discussing a topic with clear main idea, supporting details, and a conclusion. Include speaker labels: Man: ... Woman: ...", questions: [
        { id: "l5q5", prompt: "What is the main topic of the conversation?", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["main_idea"] },
        { id: "l5q6", prompt: "Detail question about the conversation.", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["detail"] },
        { id: "l5q7", prompt: "Inference question.", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["inference"] },
        { id: "l5q8", prompt: "Conclusion or opinion question.", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["opinion"] }
      ], answerTimeLimit: 120 },
      { id: "l6", audioMode: "tts", playLimit: 1, voiceLang: "en-US", speechRate: 0.93, transcript: "Academic lecture or detailed monologue (250-350 words) on an academic or informational topic. Include factual claims, explanations, and examples.", questions: [
        { id: "l6q9", prompt: "What is the lecture mainly about?", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["main_idea"] },
        { id: "l6q10", prompt: "Detail question 1.", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["detail"] },
        { id: "l6q11", prompt: "Detail question 2.", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["detail"] },
        { id: "l6q12", prompt: "Vocabulary or meaning question.", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["vocabulary"] },
        { id: "l6q13", prompt: "Inference question.", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["inference"] },
        { id: "l6q14", prompt: "Speaker purpose or tone question.", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["purpose"] }
      ], answerTimeLimit: 180 }
    ]},
    reading: { timeLimit: 1200, weight: 0.2, passages: [
      { id: "r1", title: "string", text: "Reading passage 1 - at least 250 words of connected prose on the chosen topic. Use natural paragraph structure.", questions: [
        { id: "r1q1", prompt: "string", options: ["A","B","C","D"], correctAnswer: 0, explanation: "string", difficulty: "A2", tags: ["main_idea"] },
        { id: "r1q2", prompt: "string", options: ["A","B","C","D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["detail"] },
        { id: "r1q3", prompt: "string", options: ["A","B","C","D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["vocabulary"] },
        { id: "r1q4", prompt: "string", options: ["A","B","C","D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["inference"] }
      ]},
      { id: "r2", title: "string", text: "Reading passage 2 - at least 350 words of connected prose on a different topic. Use natural paragraph structure.", questions: [
        { id: "r2q5", prompt: "string", options: ["A","B","C","D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["main_idea"] },
        { id: "r2q6", prompt: "string", options: ["A","B","C","D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["detail"] },
        { id: "r2q7", prompt: "string", options: ["A","B","C","D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["detail"] },
        { id: "r2q8", prompt: "string", options: ["A","B","C","D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["vocabulary"] },
        { id: "r2q9", prompt: "string", options: ["A","B","C","D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["inference"] },
        { id: "r2q10", prompt: "string", options: ["A","B","C","D"], correctAnswer: 0, explanation: "string", difficulty: "B1", tags: ["purpose"] }
      ]}
    ]},
    writing: { timeLimit: 1500, weight: 0.2, prompts: [
      { id: "w1", type: "informal_note", prompt: "Write a short informal note or message (50-75 words).", minWords: 50, maxWords: 75, recommendedTime: 300 },
      { id: "w2", type: "opinion_essay", prompt: "Write an opinion essay (175-250 words) giving your view with reasons and examples.", minWords: 175, maxWords: 250, recommendedTime: 1200 }
    ]},
    speaking: { timeLimit: 240, weight: 0.2, prompts: [
      { id: "s1", type: "personal_response", prompt: "Speak about a personal experience or opinion on a familiar topic.", prepTime: 45, speakTime: 60 },
      { id: "s2", type: "integrated_opinion", prompt: "Give your opinion on a broader social or abstract topic with reasons.", prepTime: 45, speakTime: 60 }
    ]}
  }
};

function downloadExamTemplate() {
  const blob = new Blob([JSON.stringify(EXAM_TEMPLATE, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "itep-exam-template.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Sin esto el blob se queda en memoria hasta que se cierre la pestana, y en
     un examen largo el usuario puede descargar la plantilla varias veces. */
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Un archivo exportado por examia trae el examen envuelto; uno escrito a mano
   suele venir pelado. Se aceptan las dos formas en vez de exigir una. */
function unwrapImportedExam(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.sections) return parsed;
  if (parsed.test?.sections) return parsed.test;
  if (Array.isArray(parsed.tests) && parsed.tests.length) {
    const preferred = parsed.tests.find((t) => t.id === parsed.meta?.defaultTestId);
    return preferred || parsed.tests[0];
  }
  return null;
}

function describeImportedExam(test) {
  const sec = test.sections || {};
  const g = (sec.grammar?.questions || []).length;
  const l = (sec.listening?.items || []).reduce((a, it) => a + (it.questions || []).length, 0);
  const r = (sec.reading?.passages || []).reduce((a, p) => a + (p.questions || []).length, 0);
  const w = (sec.writing?.prompts || []).length;
  const s = (sec.speaking?.prompts || []).length;
  return `${g} grammar, ${l} listening, ${r} reading, ${w} writing, ${s} speaking`;
}

function applyImportedExam(test, label) {
  state.test = test;
  state.usingImportedExam = true;
  state.answers = {};
  state.writingTexts = {};
  state.notes = { listening: {}, speaking: {} };
  state.speakingRecordings = {};
  state.speakingTranscripts = {};
  state.speakingEvaluation = {};
  state.writingEvaluation = {};
  state.questionIndexes = { grammar: 0, listening: 0, reading: 0 };
  state.writingPartIndex = 0;
  state.speakingPartIndex = 0;
  state.sectionIndex = 0;
  state.importStatus = "ok";
  state.importMsg = `Loaded "${test.title || label}" - ${describeImportedExam(test)}.`;
}

function importExamFromText(raw, label) {
  const text = String(raw || "").trim();
  if (!text) {
    state.importStatus = "error";
    state.importMsg = "Nothing to import: paste the JSON or choose a file.";
    return render();
  }

  let parsed;
  try {
    /* Se tolera lo que trae un copiar y pegar real: cercas de markdown, comillas
       tipograficas, una coma de mas al final. El error que se muestra es el de
       verdad, no el de la basura de alrededor. */
    parsed = JSON.parse(sanitizeJsonString(extractLikelyJsonBlock(text)));
  } catch (e) {
    state.importStatus = "error";
    state.importMsg = `That is not valid JSON: ${e.message || "parse error"}`;
    return render();
  }

  const candidate = unwrapImportedExam(parsed);
  if (!candidate) {
    state.importStatus = "error";
    state.importMsg = "Valid JSON, but no exam inside it. It needs a \"sections\" object - download the template to see the shape.";
    return render();
  }

  let test;
  try {
    test = mergeWithFallbackSection(enforceGeneratedExamContract(candidate), state.builtInTest || state.test);
  } catch (e) {
    state.importStatus = "error";
    state.importMsg = `Could not read that exam: ${e.message || "unknown error"}`;
    return render();
  }

  if (!validateGeneratedTest(test)) {
    state.importStatus = "error";
    state.importMsg = "The exam is missing sections. It needs grammar, listening, reading, writing and speaking.";
    return render();
  }

  applyImportedExam(test, label || "imported exam");
  state.importPasteText = "";
  render();
}

function importExamFromFile(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    state.importStatus = "error";
    state.importMsg = "That file is over 5 MB. An exam is text; something else is in there.";
    return render();
  }
  const reader = new FileReader();
  reader.onload = () => importExamFromText(reader.result, file.name);
  reader.onerror = () => {
    state.importStatus = "error";
    state.importMsg = "Could not read that file.";
    render();
  };
  reader.readAsText(file);
}

function resetToBuiltInExam() {
  if (!state.builtInTest) return;
  applyImportedExam(cloneJson(state.builtInTest), "built-in exam");
  state.usingImportedExam = false;
  state.importStatus = "ok";
  state.importMsg = "Back to the built-in exam.";
  render();
}

function startTimer(sec) {
  stopTimer();
  state.sectionRemaining = sec;
  state.timerId = setInterval(() => {
    state.sectionRemaining -= 1;
    const el = document.getElementById("timer");
    if (el) {
      if (state.mode === "study") {
        el.textContent = formatWritingTimer(state.sectionRemaining);
        if (state.sectionRemaining < 0) el.classList.add("danger");
        else el.classList.remove("danger");
      } else {
        el.textContent = formatTimer(state.sectionRemaining);
        if (state.sectionRemaining <= 60) el.classList.add("danger");
      }
    }
    const wpt = document.getElementById("writing-part-timer");
    if (wpt && sectionName() === "writing" && state.mode === "exam" && state.writingPartIndex === 1) {
      wpt.textContent = formatTimer(state.sectionRemaining);
      if (state.sectionRemaining <= 60) wpt.classList.add("danger");
    }
    if (state.sectionRemaining <= 0 && state.mode === "exam") nextSection();
  }, 1000);
}

function stopTimer() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = null;
}

function formatTimer(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function formatWritingTimer(sec) {
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const str = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return sec < 0 ? `-${str}` : str;
}

function startWritingPartTimer(sec, autoAdvance) {
  stopWritingPartTimer();
  state.writingPartRemaining = sec;
  state.writingPartTimerId = setInterval(() => {
    state.writingPartRemaining -= 1;
    const el = document.getElementById("writing-part-timer");
    if (el) {
      el.textContent = formatWritingTimer(state.writingPartRemaining);
      if (state.writingPartRemaining < 0) el.classList.add("danger");
      else el.classList.remove("danger");
    }
    if (autoAdvance && state.writingPartRemaining <= 0) {
      stopWritingPartTimer();
      state.writingPartIndex = 1;
      if (state.mode === "study") {
        startWritingPartTimer(sectionData().prompts[1].recommendedTime, false);
      }
      render();
    }
  }, 1000);
}

function stopWritingPartTimer() {
  if (state.writingPartTimerId) clearInterval(state.writingPartTimerId);
  state.writingPartTimerId = null;
}

function resetAttemptState() {
  state.answers = {};
  state.writingTexts = {};
  state.listeningPlaybacks = {};
  state.listeningUnlocked = {};
  state.notes = { listening: {}, speaking: {} };
  state.speakingRecordings = {};
  state.speakingTranscript = "";
  state.speakingTranscripts = {};
  state.speakingEvaluation = {};
  state.speakingMotivos = {};
  state.speakingAudioUrls = {};
  state.writingEvaluation = {};
  state.questionIndexes = { grammar: 0, listening: 0, reading: 0 };
  state.writingPartIndex = 0;
  state.writingPartRemaining = 0;
  state.speakingPartIndex = 0;
  state.speakingStatus = "idle";
  state.speakingAutoStartedFor = "";
  state.speakingPrepRemaining = 0;
  state.speakingRemaining = 0;
  state.finalizing = false;
  state.mode = "exam";
  localStorage.removeItem(STORAGE_KEY);
}

function startExam(mode = "exam") {
  resetAttemptState();
  state.mode = mode === "study" ? "study" : "exam";
  state.started = true;
  state.view = "section-break";
  state.pendingSectionIndex = 0;
  state.sectionTransitionLabel = "Start Grammar";
  stopTimer();
  saveState();
  document.documentElement.requestFullscreen?.().catch(() => {});
  render();
}

function startPendingSection() {
  state.sectionIndex = state.pendingSectionIndex;
  state.view = "exam";
  stopWritingPartTimer();
  startTimer(sectionData().timeLimit);
  if (sectionName() === "writing") {
    const p = sectionData().prompts[state.writingPartIndex];
    startWritingPartTimer(p.recommendedTime, state.mode === "exam" && state.writingPartIndex === 0);
  }
  saveState();
  render();
}

function nextSection() {
  if (state.sectionIndex >= state.sectionOrder.length - 1) {
    stopTimer();
    stopWritingPartTimer();
    state.view = "review";
    return render();
  }
  stopTimer();
  stopWritingPartTimer();
  state.pendingSectionIndex = state.sectionIndex + 1;
  const n = state.sectionOrder[state.pendingSectionIndex];
  state.sectionTransitionLabel = `Section completed. Start ${n[0].toUpperCase() + n.slice(1)}.`;
  state.view = "section-break";
  render();
}

function prevSection() {
  if (state.sectionIndex === 0) return;
  state.sectionIndex -= 1;
  stopWritingPartTimer();
  state.view = "exam";
  startTimer(sectionData().timeLimit);
  render();
}

function grammarQs() { return sectionData().questions; }
function listeningRows() { return sectionData().items.flatMap((it) => it.questions.map((q) => ({ item: it, question: q }))); }
function readingRows() { return sectionData().passages.flatMap((p) => p.questions.map((q) => ({ passage: p, question: q }))); }

function optionButton(qid, option, idx) {
  const sel = state.answers[qid] === idx;
  return `<button class="option ${sel ? "selected" : ""}" data-action="answer" data-qid="${qid}" data-idx="${idx}">${esc(option)}</button>`;
}

function renderStudyFeedback(q) {
  if (state.mode !== "study") return "";
  const selected = state.answers[q.id];
  if (!Number.isInteger(selected)) return "";
  const ok = selected === q.correctAnswer;
  const selectedLabel = q.options[selected] ?? `Option ${selected + 1}`;
  const correctLabel = q.options[q.correctAnswer] ?? `Option ${q.correctAnswer + 1}`;
  return `<div class="study-feedback ${ok ? "ok" : "bad"}">
    <p><strong>${ok ? "Correct" : "Incorrect"}.</strong> Your answer: ${esc(selectedLabel)}</p>
    <p><strong>Correct answer:</strong> ${esc(correctLabel)}</p>
    <p><strong>Why:</strong> ${esc(q.explanation || "Review this concept.")}</p>
  </div>`;
}

function renderGrammar() {
  const idx = state.questionIndexes.grammar;
  const q = grammarQs()[idx];
  return `<section class="content-grid"><article class="passage-card"><h3>Grammar - ${idx < 13 ? "Part 1 (Sentence Completion)" : "Part 2 (Error Detection)"}</h3><p class="prompt">${esc(q.prompt)}</p></article><aside class="question-card"><p><strong>Question ${idx + 1} of ${grammarQs().length}</strong></p><div class="options">${q.options.map((o, i) => optionButton(q.id, o, i)).join("")}</div>${renderStudyFeedback(q)}</aside></section>`;
}

function renderListening() {
  const rows = listeningRows();
  const idx = state.questionIndexes.listening;
  const row = rows[idx];
  if (!row) return `<section class="panel"><p>No listening questions available.</p></section>`;
  const used = state.listeningPlaybacks[row.item.id] || 0;
  const remain = Math.max(0, row.item.playLimit - used);
  const note = state.notes.listening[row.item.id] || "";
  const unlocked = !!state.listeningUnlocked[row.item.id];
  const listenPart = ["l1","l2","l3","l4"].includes(row.item.id) ? "Part 1 (Short Conversations)" : row.item.id === "l5" ? "Part 2 (Long Conversation)" : "Part 3 (Lecture)";
  const questionPanel = unlocked
    ? `<p><strong>Question ${idx + 1} of ${rows.length}</strong></p><p>${esc(row.question.prompt)}</p><div class="options">${row.question.options.map((o, i) => optionButton(row.question.id, o, i)).join("")}</div>${renderStudyFeedback(row.question)}`
    : `<p><strong>Question ${idx + 1} of ${rows.length}</strong></p><p class="muted">Play the audio first. Then the question will appear.</p>`;
  return `<section class="content-grid"><article class="passage-card"><h3>Listening - ${listenPart}</h3><p class="muted">No transcript shown during this section.</p><p class="tag">Playback left: ${remain}/${row.item.playLimit}</p><button class="btn primary" data-action="play-listening" ${remain === 0 ? "disabled" : ""}>Play Audio</button>${row.item.audioMode === "file" ? `<audio id="listening-audio" controls src="${esc(row.item.audio || "")}"></audio>` : ""}<label class="muted">Notes</label><textarea id="listening-notes" data-itemid="${row.item.id}" placeholder="Write notes here...">${esc(note)}</textarea></article><aside class="question-card">${questionPanel}</aside></section>`;
}

function renderReading() {
  const rows = readingRows();
  const idx = state.questionIndexes.reading;
  const row = rows[idx];
  if (!row) return `<section class="panel"><p>No reading questions available.</p></section>`;
  const readingPart = row.passage.id === "r1" ? "Part 1" : "Part 2";
  return `<section class="content-grid"><article class="passage-card"><h3>Reading - ${readingPart}: ${esc(row.passage.title)}</h3><div class="scroll-text"><p>${esc(row.passage.text)}</p></div></article><aside class="question-card"><p><strong>Question ${idx + 1} of ${rows.length}</strong></p><p>${esc(row.question.prompt)}</p><div class="options">${row.question.options.map((o, i) => optionButton(row.question.id, o, i)).join("")}</div>${renderStudyFeedback(row.question)}</aside></section>`;
}

function renderWriting() {
  const prompts = sectionData().prompts;
  const p = prompts[state.writingPartIndex];
  const value = state.writingTexts[p.id] || "";
  const words = (value.trim().match(/\S+/g) || []).length;
  const writingPart = state.writingPartIndex === 0 ? "Part 1 (Short Note)" : "Part 2 (Essay)";
  let timerHtml = "";
  if (state.mode === "exam" && state.writingPartIndex === 0) {
    const rem = state.writingPartRemaining;
    timerHtml = `<p class="muted">Part 1 Time: <strong id="writing-part-timer" class="${rem <= 60 ? "danger" : ""}">${formatTimer(Math.max(0, rem))}</strong></p>`;
  } else if (state.mode === "exam" && state.writingPartIndex === 1) {
    timerHtml = `<p class="muted">Section Time Left: <strong id="writing-part-timer" class="${state.sectionRemaining <= 60 ? "danger" : ""}">${formatTimer(state.sectionRemaining)}</strong></p>`;
  } else if (state.mode === "study") {
    const rem = state.writingPartRemaining;
    timerHtml = `<p class="muted">Suggested Time: <strong id="writing-part-timer" class="${rem < 0 ? "danger" : ""}">${formatWritingTimer(rem)}</strong></p>`;
  }
  return `<section class="panel"><h3>Writing - ${writingPart}</h3>${timerHtml}<p class="prompt">${esc(p.prompt)}</p><textarea id="writing-input" data-pid="${p.id}" spellcheck="true">${esc(value)}</textarea><p id="writing-counter" class="muted">Words: ${words} | min ${p.minWords}${p.maxWords ? ` | max ${p.maxWords}` : ""}</p></section>`;
}

async function startRecording() {
  const p = sectionData().prompts[state.speakingPartIndex];
  if (!p) return;
  if (state.speakingRecordings[p.id] || state.speakingStatus === "recording") return;
  if (state.speakingStatus === "preparing") return;

  state.speakingStatus = "preparing";
  state.speakingPrepRemaining = Number.isFinite(Number(p.prepTime)) && Number(p.prepTime) > 0 ? Number(p.prepTime) : 45;
  render();

  if (state.speakingPrepTimerId) clearInterval(state.speakingPrepTimerId);
  state.speakingPrepTimerId = setInterval(() => {
    state.speakingPrepRemaining -= 1;
    const prepEl = document.getElementById("speaking-prep-remaining");
    if (prepEl) prepEl.textContent = `${Math.max(state.speakingPrepRemaining, 0)}s prep`;
    if (state.speakingPrepRemaining <= 0) {
      clearInterval(state.speakingPrepTimerId);
      state.speakingPrepTimerId = null;
      startActualRecording(p).catch(() => {});
    }
  }, 1000);
}

async function startActualRecording(p) {
  if (state.speakingStatus === "recording") return;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    state.speakingStatus = "idle";
    state.speakingAutoStartedFor = "";
    state.speakingEvaluation[p.id] = JSON.stringify({ score: 0, cefr: "A1", feedback: "Microphone access denied. Please allow microphone permission and click Start Recording." });
    return render();
  }

  let rec;
  try {
    const preferredMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    rec = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
  } catch {
    rec = new MediaRecorder(stream);
  }
  const chunks = [];

  state.speakingStatus = "recording";
  state.speakingRemaining = p.speakTime;
  render();

  if (state.speakingTimerId) clearInterval(state.speakingTimerId);
  state.speakingTimerId = setInterval(() => {
    state.speakingRemaining -= 1;
    const el = document.getElementById("speaking-remaining");
    if (el) el.textContent = `${Math.max(state.speakingRemaining, 0)}s remaining`;
    if (state.speakingRemaining <= 0) {
      clearInterval(state.speakingTimerId);
      state.speakingTimerId = null;
    }
  }, 1000);

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    try {
      const sr = new SR();
      sr.lang = "en-US";
      sr.continuous = true;
      sr.interimResults = true;
      sr.onresult = (ev) => {
        const txt = Array.from(ev.results).map((r) => r[0].transcript).join(" ");
        state.speakingTranscript = txt;
        state.speakingTranscripts[p.id] = txt;
      };
      sr.start();
      setTimeout(() => sr.stop(), p.speakTime * 1000);
    } catch {}
  }

  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
    // Give SpeechRecognition time to fire its final onresult before reading the transcript
    await new Promise((r) => setTimeout(r, 600));
    const delNavegador = (state.speakingTranscripts[p.id] || state.speakingTranscript || "").trim();

    if (blob.size === 0 && !delNavegador) {
      state.speakingStatus = "idle";
      state.speakingMotivos[p.id] = "No audio came from the microphone. Check the permission and record again.";
      state.speakingEvaluation[p.id] = JSON.stringify({
        sinCalificar: true,
        motivo: state.speakingMotivos[p.id]
      });
      saveState();
      return render();
    }

    /*
     * Whisper manda sobre lo que oyó el navegador, no al revés.
     *
     * La Web Speech API es de Chrome, necesita hablar con un servicio de
     * Google y en Firefox y Safari no existe: montarla como fuente principal
     * dejaba a media internet sin transcripción y por tanto sin nota. Se
     * queda porque va escribiendo en vivo mientras se habla, que es útil de
     * ver, pero la que cuenta es la del servidor. Si el servidor no puede
     * -no hay llave, o falló-, se usa la del navegador antes que nada.
     */
    state.speakingStatus = "transcribing";
    render();
    const { texto, motivo } = await transcribirGrabacion(blob);
    let transcript = texto || delNavegador;
    state.speakingMotivos[p.id] = transcript ? "" : (motivo || "Nothing could be made out in the recording.");
    if (transcript) {
      state.speakingTranscripts[p.id] = transcript;
      state.speakingTranscript = transcript;
    }

    const url = URL.createObjectURL(blob);
    state.speakingAudioUrls[p.id] = url;
    const audio = document.getElementById("speaking-playback");
    if (audio) { audio.src = url; audio.style.display = "block"; }

    state.speakingRecordings[p.id] = true;
    state.answers[p.id] = "[RECORDED]";
    state.speakingStatus = "done";
    saveState();
    await promiseWithTimeout(evaluateSpeakingWithGroq(p), 15000, null);
    // auto-advance to next speaking part if available
    const prompts = sectionData().prompts;
    if (state.speakingPartIndex < prompts.length - 1) {
      state.speakingPartIndex += 1;
      state.speakingStatus = "idle";
      state.speakingTranscript = "";
    }
    render();
  };

  rec.start();
  setTimeout(() => rec.stop(), p.speakTime * 1000);
}

/*
 * La transcripción y la evaluación viven detrás de /api.
 *
* Antes se llamaba al servicio de Groq desde el propio navegador, con la
 * llave leida de una variable de entorno con prefijo de cliente. Vite mete en
 * el paquete que descarga el visitante todo lo que lleve ese prefijo, asi que
 * ponerla en Vercel para "encender" speaking habria publicado la llave en un
 * .js de un sitio abierto. Nunca se puso -por eso speaking no evaluaba nada- y
 * ahora ya no puede ponerse: la llave la lee `api/_nucleo.js` en el servidor.
 *
 * `test/calificacion.test.mjs` lo comprueba con un grep a secas sobre este
 * archivo, de ahi que aqui no se escriban ni el prefijo ni el dominio.
 */

/** Pregunta una vez si este despliegue puede calificar, y se lo guarda. */
async function consultarSiCalifica() {
  if (state.califica !== null) return state.califica;
  try {
    const res = await fetch("/api/estado");
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    state.califica = Boolean(d.califica);
  } catch {
    /* Sin /api -abriendo el dist a pelo, por ejemplo- no hay calificación. */
    state.califica = false;
  }
  return state.califica;
}

/**
 * Pasa la grabación a texto.
 *
 * Devuelve `{ texto, motivo }`. `motivo` solo viene cuando NO hay texto, y es
 * lo que el informe le enseña al candidato: quedarse callado y que el
 * micrófono no estuviera conectado no son la misma cosa, y antes las dos
 * terminaban igual, en nada.
 */
async function transcribirGrabacion(blob) {
  if (!blob || blob.size === 0) return { texto: "", motivo: "The recording came out empty." };
  try {
    const res = await fetch("/api/transcribir", {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/webm" },
      body: blob
    });
    const d = await res.json().catch(() => null);
    if (res.ok && d?.ok && d.texto) return { texto: d.texto, motivo: "" };
    if (d?.codigo === "sin_llave") {
      state.califica = false;
      return { texto: "", motivo: "" };
    }
    return { texto: "", motivo: d?.mensaje || `The transcription service returned ${res.status}.` };
  } catch (e) {
    return { texto: "", motivo: "Could not reach the transcription service." };
  }
}

/** Llama a la rúbrica del servidor y guarda el juicio, o el motivo de que no haya. */
async function evaluarRespuesta(tipo, destino, promptObj, texto, notas = "") {
  const guardarMotivo = (motivo) => {
    destino[promptObj.id] = JSON.stringify({ sinCalificar: true, motivo });
    saveState();
  };

  if (!(await consultarSiCalifica())) {
    return guardarMotivo("This deployment has no AI scoring configured.");
  }
  if (!texto.trim()) {
    return guardarMotivo("There was no answer to score.");
  }

  try {
    const res = await fetch("/api/evaluar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, consigna: promptObj.prompt, texto, notas })
    });
    const d = await res.json().catch(() => null);
    if (res.ok && d?.ok && d.juicio) {
      destino[promptObj.id] = JSON.stringify(d.juicio);
      saveState();
      return;
    }
    if (d?.codigo === "sin_llave") state.califica = false;
    guardarMotivo(d?.mensaje || `The scoring service returned ${res.status}.`);
  } catch {
    guardarMotivo("Could not reach the scoring service.");
  }
}

async function evaluateSpeakingWithGroq(promptObj) {
  const transcript = state.speakingTranscripts[promptObj.id] || "";
  const note = state.notes.speaking[promptObj.id] || "";
  if (!transcript) {
    /*
     * Sin transcripción no se evalúa, y se dice por qué. Antes se le mandaban
     * al modelo las notas de preparación como si fueran la respuesta: eso
     * calificaba un borrador escrito en una sección de hablar.
     */
    state.speakingEvaluation[promptObj.id] = JSON.stringify({
      sinCalificar: true,
      motivo: state.speakingMotivos[promptObj.id] || "No transcript was obtained from the recording."
    });
    saveState();
    return;
  }
  await evaluarRespuesta("speaking", state.speakingEvaluation, promptObj, transcript, note);
}

async function evaluateWritingWithGroq(promptObj, text) {
  await evaluarRespuesta("writing", state.writingEvaluation, promptObj, text || "");
}

function renderSpeaking() {
  const p = sectionData().prompts[state.speakingPartIndex];
  if (!p) return `<section class="panel"><p>No speaking prompts available.</p></section>`;
  const note = state.notes.speaking[p.id] || "";
  const already = !!state.speakingRecordings[p.id];
  const preparing = state.speakingStatus === "preparing";
  const recording = state.speakingStatus === "recording";
  const transcribing = state.speakingStatus === "transcribing";
  const busy = preparing || recording || transcribing;

  const estado = transcribing ? "Transcribing..."
    : preparing ? "Preparing..."
    : recording ? "Recording..."
    : already ? "Recorded" : "Ready";

  /*
   * Lo que se oyo, escrito. Es la pieza que faltaba: la nota sale de este
   * texto, asi que si el candidato no lo ve no tiene forma de saber si lo
   * calificaron mal o si el microfono entendio otra cosa.
   */
  const transcript = state.speakingTranscripts[p.id] || "";
  const motivo = state.speakingMotivos[p.id] || "";
  const bloqueTranscripcion = already
    ? (transcript
      ? `<div class="transcript"><h4>What we heard</h4><p>${esc(transcript)}</p></div>`
      : `<div class="study-feedback bad"><p><strong>No transcript.</strong> ${esc(motivo || "Nothing could be made out in the recording.")}</p></div>`)
    : "";

  const evalObj = safeParseJsonObject(state.speakingEvaluation[p.id] || "");
  const evalBlock = !evalObj ? ""
    : evalObj.sinCalificar
      ? `<div class="study-feedback"><p><strong>Not scored.</strong> ${esc(evalObj.motivo || "")}</p></div>`
      : `<div class="feedback-card">
        <h4>Speaking Feedback</h4>
        <div class="feedback-grid">${celdasNota(evalObj, ["score", "cefr", "fluency", "grammar", "vocabulary", "coherence"])}</div>
        ${evalObj.feedback ? `<p>${esc(evalObj.feedback)}</p>` : ""}
      </div>`;

  /*
   * Si este despliegue no califica, se dice ANTES de grabar. Enterarse en el
   * informe final, cuando ya se gastaron los dos minutos, no le sirve a nadie.
   */
  const avisoSinNota = state.califica === false
    ? `<div class="study-feedback"><p>This deployment records and transcribes your answer, but does not score it: no AI scoring is configured. Grammar, Listening and Reading are still scored normally.</p></div>`
    : "";

  const speakingPart = state.speakingPartIndex === 0 ? "Part 1 (Read + Speak)" : "Part 2 (Opinion Response)";
  return `<section class="panel"><h3>Speaking - ${speakingPart}</h3>
    <p class="prompt">${esc(p.prompt)}</p>
    <p class="muted">Prep ${p.prepTime}s | Speak ${p.speakTime}s | Microphone starts automatically</p>
    ${avisoSinNota}
    <div class="speak-meta"><span class="tag">${estado}</span><span id="speaking-prep-remaining" class="muted">${preparing ? `${state.speakingPrepRemaining}s prep` : ""}</span><span id="speaking-remaining" class="muted">${recording ? `${state.speakingRemaining}s remaining` : ""}</span></div>
    <button class="btn primary" data-action="start-recording" ${(busy || already) ? "disabled" : ""}>${already ? "Recorded" : busy ? estado : "Start Recording"}</button>
    <div class="wave ${busy ? "active" : ""}"></div>
    <label class="muted">Notes</label>
    <textarea id="speaking-notes" data-pid="${p.id}" placeholder="Write notes before speaking...">${esc(note)}</textarea>
    <audio id="speaking-playback" controls style="display:${already ? "block" : "none"}"></audio>
    ${bloqueTranscripcion}${evalBlock}</section>`;
}

/*
 * Las celdas de una nota. Solo se pinta la que existe: la version anterior
 * dibujaba siempre las siete y las que no venian salian con un guion, asi que
 * "no lo medimos" y "lo medimos y dio cero" se veian casi igual.
 *
 * Pronunciation ya no esta en la lista a proposito: se calificaba leyendo una
 * transcripcion, sin oir nada.
 */
function celdasNota(obj, claves) {
  const etiqueta = { score: "Score", cefr: "CEFR", fluency: "Fluency", grammar: "Grammar", vocabulary: "Vocabulary", coherence: "Coherence" };
  return claves.map((k) => {
    const v = obj[k];
    if (v === undefined || v === null || v === "") return "";
    return `<div><strong>${etiqueta[k] || k}</strong><span>${esc(String(v))}</span></div>`;
  }).join("");
}
function renderExamBody() {
  const s = sectionName();
  if (s === "grammar") return renderGrammar();
  if (s === "listening") return renderListening();
  if (s === "reading") return renderReading();
  if (s === "writing") return renderWriting();
  return renderSpeaking();
}

function scoreObjective(arr) {
  const ok = arr.filter((q) => state.answers[q.id] === q.correctAnswer).length;
  return arr.length ? Math.round((ok / arr.length) * 100) : 0;
}

function safeParseJsonObject(raw) {
  if (!raw || typeof raw !== "string") return null;
  const block = extractLikelyJsonBlock(raw);
  const cleaned = sanitizeJsonString(block);
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function computeReport() {
  const sec = state.test.sections;
  const gQs = sec.grammar.questions;
  const lRows = sec.listening.items.flatMap((i) => i.questions.map((q) => ({ item: i, q })));
  const rQs = sec.reading.passages.flatMap((p) => p.questions);

  const grammar = scoreObjective(gQs);
  const listening = scoreObjective(lRows.map((x) => x.q));
  const reading = scoreObjective(rQs);

  /*
   * Writing y Speaking se puntuan con la nota del modelo, y si no hay nota NO
   * se puntuan.
   *
   * Antes, cuando faltaba, caian a una "nota de avance": 72 sobre 100 por
   * haber grabado las dos consignas, 72 por llegar al minimo de palabras. Como
   * la llave de Groq no estaba puesta en ningun sitio, eso era lo que pasaba
   * SIEMPRE: sesenta segundos de silencio valian igual que una respuesta
   * perfecta, y esos puntos entraban enteros en la banda CEFR. El informe
   * promete una banda "based on how you actually answered" y estaba regalando
   * dos quintas partes de ella por apretar un boton.
   *
   * Ahora, sin nota, la seccion sale como no calificada y la banda se reparte
   * entre las que si se midieron. Es menos completo y es cierto, y el informe
   * dice cual falta y por que.
   */
  const notaMedia = (prompts, evaluaciones) => {
    const notas = prompts.map((p) => {
      const parsed = safeParseJsonObject(evaluaciones[p.id] || "");
      if (!parsed || parsed.sinCalificar) return null;
      const n = Number(parsed.score);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
    }).filter((x) => x !== null);
    if (!notas.length) return null;
    return Math.round(notas.reduce((acc, x) => acc + x, 0) / notas.length);
  };

  const writing = notaMedia(sec.writing.prompts, state.writingEvaluation);
  const speaking = notaMedia(sec.speaking.prompts, state.speakingEvaluation);

  /* El motivo de la primera consigna sin calificar vale para las dos: es el
     mismo despliegue y el mismo servicio los que faltan o fallan. */
  const primerMotivo = (prompts, evaluaciones) => {
    for (const p of prompts) {
      const parsed = safeParseJsonObject(evaluaciones[p.id] || "");
      if (parsed && parsed.sinCalificar && parsed.motivo) return parsed.motivo;
    }
    return "";
  };

  const medidas = [
    { id: "Grammar", nota: grammar, peso: sec.grammar.weight },
    { id: "Listening", nota: listening, peso: sec.listening.weight },
    { id: "Reading", nota: reading, peso: sec.reading.weight },
    { id: "Writing", nota: writing, peso: sec.writing.weight },
    { id: "Speaking", nota: speaking, peso: sec.speaking.weight }
  ];
  const calificadas = medidas.filter((m) => m.nota !== null);
  const pesoTotal = calificadas.reduce((acc, m) => acc + m.peso, 0) || 1;
  const overall = Math.round(calificadas.reduce((acc, m) => acc + m.nota * m.peso, 0) / pesoTotal);
  const cefr = overall < 25 ? "A1" : overall < 40 ? "A2" : overall < 55 ? "B1" : overall < 70 ? "B2" : overall < 85 ? "C1" : "C2";
  const sinCalificar = medidas.filter((m) => m.nota === null).map((m) => m.id);
  const motivoSinCalificar = primerMotivo(sec.speaking.prompts, state.speakingEvaluation)
    || primerMotivo(sec.writing.prompts, state.writingEvaluation);

  const grammarWrong = gQs.filter((q) => state.answers[q.id] !== q.correctAnswer).map((q) => ({ id: q.id, prompt: q.prompt, chosen: state.answers[q.id], correct: q.correctAnswer, why: q.explanation || "Review grammar structure." }));
  const readingWrong = rQs.filter((q) => state.answers[q.id] !== q.correctAnswer).map((q) => ({ id: q.id, prompt: q.prompt, chosen: state.answers[q.id], correct: q.correctAnswer, why: q.explanation || "Find supporting evidence in the passage." }));
  const listeningWrong = lRows.filter((x) => state.answers[x.q.id] !== x.q.correctAnswer).map((x) => ({ id: x.q.id, prompt: x.q.prompt, chosen: state.answers[x.q.id], correct: x.q.correctAnswer, why: x.q.explanation || "Listen for key words and details.", audioContext: x.item.transcript }));
  const grammarRight = gQs.filter((q) => state.answers[q.id] === q.correctAnswer).map((q) => ({ id: q.id, prompt: q.prompt }));
  const readingRight = rQs.filter((q) => state.answers[q.id] === q.correctAnswer).map((q) => ({ id: q.id, prompt: q.prompt }));
  const listeningRight = lRows.filter((x) => state.answers[x.q.id] === x.q.correctAnswer).map((x) => ({ id: x.q.id, prompt: x.q.prompt }));

  return { grammar, listening, reading, writing, speaking, overall, cefr, sinCalificar, motivoSinCalificar, grammarWrong, readingWrong, listeningWrong, grammarRight, readingRight, listeningRight };
}

function renderReview() {
  const rpt = computeReport();
  return `<main class="wrap"><section class="panel"><h2>Review & Submit</h2><div class="scores"><div>Grammar ${rpt.grammar}</div><div>Listening ${rpt.listening}</div><div>Reading ${rpt.reading}</div><div>Writing ${rpt.writing === null ? "not scored" : rpt.writing}</div><div>Speaking ${rpt.speaking === null ? "not scored" : rpt.speaking}</div></div><div class="actions"><button class="btn" data-action="back-exam" ${state.finalizing ? "disabled" : ""}>Back</button><button class="btn primary" data-action="finish-exam" ${state.finalizing ? "disabled" : ""}>${state.finalizing ? "Processing..." : "Finish"}</button></div></section></main>`;
}

function renderReport() {
  const rpt = computeReport();
  const sec = state.test.sections;
  const scoreToCefr = (x) => (x < 25 ? "A1" : x < 40 ? "A2" : x < 55 ? "B1" : x < 70 ? "B2" : x < 85 ? "C1" : "C2");
  const toItepLevel = (x) => (Math.max(0, Math.min(100, x)) / 20).toFixed(1);
  /*
   * Las cinco filas ya vienen sobre 100. Antes Writing y Speaking se
   * multiplicaban por 100/72 para deshacer la escala de la "nota de avance";
   * quitada esa, el reescalado solo inflaba la nota real un 39 por ciento.
   */
  const sectionRows = [
    ["Grammar", rpt.grammar],
    ["Listening", rpt.listening],
    ["Reading", rpt.reading],
    ["Writing", rpt.writing],
    ["Speaking", rpt.speaking]
  ];

  const blockWrong = (title, arr, withAudio = false) => `<h3>${title}</h3>${arr.length ? arr.map((x) => `<div class="transcript"><p><strong>${esc(x.id)}</strong>: ${esc(x.prompt)}</p><p><strong>Your answer:</strong> ${x.chosen ?? "No answer"} | <strong>Correct:</strong> ${x.correct}</p><p><strong>Why:</strong> ${esc(x.why)}</p>${withAudio ? `<p><strong>Audio text for review:</strong> ${esc(x.audioContext)}</p>` : ""}</div>`).join("") : "<p>No mistakes.</p>"}`;
  const blockRight = (title, arr) => `<h3>${title}</h3>${arr.length ? arr.map((x) => `<div class="transcript"><p><strong>${esc(x.id)}</strong>: ${esc(x.prompt)}</p></div>`).join("") : "<p>No correct answers recorded.</p>"}`;
  /*
   * Una tarjeta por consigna. Tres casos y no dos: calificada, no calificada
   * -con el motivo- y respuesta que ni siquiera se intento. Antes las dos
   * ultimas caian en la misma tarjeta con guiones en todas las casillas.
   *
   * Pronunciation ya no se pinta: se calificaba leyendo una transcripcion, sin
   * haber oido la grabacion, y salia impresa al lado de las que si se miden.
   */
  const renderFeedbackCards = (obj, title, prompts, audioUrls = {}) => {
    return prompts.map((p) => {
      const parsed = safeParseJsonObject(obj[p.id] || "");
      const audioUrl = audioUrls[p.id] || "";
      const audioHtml = audioUrl ? `<audio controls src="${audioUrl}" style="width:100%;margin-bottom:0.5rem"></audio>` : "";
      const transcript = title === "Speaking" ? (state.speakingTranscripts[p.id] || "") : (state.writingTexts[p.id] || "");
      const suyo = transcript
        ? `<p class="lo-dicho"><strong>${title === "Speaking" ? "What we heard" : "What you wrote"}:</strong> ${esc(transcript)}</p>`
        : "";

      if (!parsed) {
        return `<div class="study-feedback"><p><strong>${esc(p.id)}</strong> - no answer recorded for this task.</p></div>`;
      }
      if (parsed.sinCalificar) {
        return `<div class="study-feedback bad">${audioHtml}<p><strong>${esc(p.id)} - not scored.</strong> ${esc(parsed.motivo || "")}</p>${suyo}</div>`;
      }
      return `<div class="feedback-card">
        <h4>${esc(p.id)} - ${esc(title)} Feedback</h4>
        ${audioHtml}
        <div class="feedback-grid">${celdasNota(parsed, ["score", "cefr", "fluency", "grammar", "vocabulary", "coherence"])}</div>
        ${suyo}
        ${parsed.feedback ? `<p>${esc(parsed.feedback)}</p>` : ""}
        ${parsed.corrections ? `<p><strong>Corrections:</strong> ${esc(parsed.corrections)}</p>` : ""}
        ${parsed.improvedVersion ? `<p><strong>Improved version:</strong> ${esc(parsed.improvedVersion)}</p>` : ""}
      </div>`;
    }).join("");
  };

  return `<main class="wrap"><section class="panel"><h2>Final Report</h2>
  <div class="overall-assessment">
    <div class="oa-title">Overall Assessment</div>
    <div class="oa-pill"><span>CEFR LEVEL</span><strong>${rpt.cefr}</strong></div>
    <div class="oa-pill"><span>iTEP LEVEL</span><strong>${toItepLevel(rpt.overall)}</strong></div>
  </div>
  ${rpt.sinCalificar.length ? `<div class="study-feedback bad"><p><strong>This band covers ${5 - rpt.sinCalificar.length} of the 5 sections.</strong> ${rpt.sinCalificar.join(" and ")} ${rpt.sinCalificar.length > 1 ? "were" : "was"} not scored, so ${rpt.sinCalificar.length > 1 ? "they are" : "it is"} left out of the calculation instead of being counted as a pass. ${esc(rpt.motivoSinCalificar || "")}</p></div>` : ""}
  <h3 class="table-title">Assessment by Test Section</h3>
  <table class="assessment-table">
    <thead><tr><th>Test Section</th><th>CEFR Level</th><th>iTEP Level</th><th>Description</th></tr></thead>
    <tbody>
      ${sectionRows.map(([name, score]) => score === null
        ? `<tr><td>${name}</td><td colspan="3" class="sin-calificar">Not scored</td></tr>`
        : `<tr><td>${name}</td><td>${scoreToCefr(score)}</td><td>${toItepLevel(score)}</td><td>${score >= 70 ? "Advanced" : score >= 55 ? "Upper Intermediate" : score >= 40 ? "Intermediate" : score >= 25 ? "Elementary" : "Beginner"}</td></tr>`).join("")}
    </tbody>
  </table>
  ${blockWrong("Listening - Incorrect", rpt.listeningWrong, true)}${blockRight("Listening - Correct", rpt.listeningRight)}${blockWrong("Reading - Incorrect", rpt.readingWrong)}${blockRight("Reading - Correct", rpt.readingRight)}${blockWrong("Grammar - Incorrect", rpt.grammarWrong)}${blockRight("Grammar - Correct", rpt.grammarRight)}
  <h3>Writing AI Feedback</h3>${renderFeedbackCards(state.writingEvaluation, "Writing", sec.writing.prompts)}
  <h3>Speaking AI Feedback</h3>${renderFeedbackCards(state.speakingEvaluation, "Speaking", sec.speaking.prompts, state.speakingAudioUrls)}
  <button class="btn" data-action="restart">Restart Exam</button></section></main>`;
}

function renderDeviceCheck() {
  const { micStatus, micUrl, audioStatus, pendingMode } = state.deviceCheck;
  const micLabel = micStatus === "testing" ? "Recording… (3s)" : micStatus === "idle" ? "Test Microphone" : "Test Again";
  const audioLabel = audioStatus === "testing" ? "Playing…" : audioStatus === "idle" ? "Test Audio" : "Play Again";
  const micResult = micStatus === "ok" && micUrl
    ? `<p class="lnd-msg lnd-msg-ok">Microphone working - play back your recording below.</p><audio controls src="${micUrl}" style="width:100%;margin-top:0.5rem"></audio>`
    : micStatus === "error"
    ? `<p class="lnd-msg lnd-msg-error">Microphone not accessible. Allow microphone permission and try again.</p>`
    : "";
  const audioResult = audioStatus === "ok"
    ? `<p class="lnd-msg lnd-msg-ok">Audio is working correctly.</p>`
    : "";
  const modeLabel = pendingMode === "study" ? "Study Mode" : "Exam Mode";
  return `<main class="section-break-shell"><section class="panel section-break-card" style="max-width:520px">
    <h2>Device Check</h2>
    <p class="muted">Verify your microphone and speakers before starting the exam.</p>
    <div style="display:flex;flex-direction:column;gap:1.25rem;margin:1.5rem 0">
      <div class="transcript" style="padding:1rem">
        <h4 style="margin:0 0 0.4rem">Microphone Test</h4>
        <p class="muted" style="margin:0 0 0.75rem">Records 3 seconds and plays it back so you can confirm your mic is working.</p>
        <button class="btn primary" data-action="test-mic" ${micStatus === "testing" ? "disabled" : ""}>${micLabel}</button>
        ${micResult}
      </div>
      <div class="transcript" style="padding:1rem">
        <h4 style="margin:0 0 0.4rem">Audio / Listening Test</h4>
        <p class="muted" style="margin:0 0 0.75rem">Plays a short phrase - confirm you can hear it clearly.</p>
        <button class="btn primary" data-action="test-audio" ${audioStatus === "testing" ? "disabled" : ""}>${audioLabel}</button>
        ${audioResult}
      </div>
    </div>
    <button class="btn primary" data-action="device-check-continue" style="width:100%">Continue to ${esc(modeLabel)}</button>
  </section></main>`;
}

async function runMicTest() {
  state.deviceCheck.micStatus = "testing";
  render();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      state.deviceCheck.micUrl = URL.createObjectURL(blob);
      state.deviceCheck.micStatus = "ok";
      render();
    };
    rec.start();
    setTimeout(() => rec.stop(), 3000);
  } catch {
    state.deviceCheck.micStatus = "error";
    render();
  }
}

function runAudioTest() {
  state.deviceCheck.audioStatus = "testing";
  render();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance("This is your audio test. If you can hear this, your speakers are working correctly.");
  u.lang = "en-US";
  u.rate = 0.95;
  u.onend = () => { state.deviceCheck.audioStatus = "ok"; render(); };
  u.onerror = () => { state.deviceCheck.audioStatus = "ok"; render(); };
  if (!speechSynthesis.getVoices().length) {
    speechSynthesis.onvoiceschanged = () => { speechSynthesis.onvoiceschanged = null; speechSynthesis.speak(u); };
  } else {
    speechSynthesis.speak(u);
  }
}


/*
 * La portada.
 *
 * El reparto -las dos barras- se calcula del examen cargado, no esta escrito
 * a mano: si importas el tuyo con otros tiempos u otros pesos, el dibujo
 * cambia con el. Es lo que lo hace verdad y no adorno.
 */
const SECCIONES = [
  { id: "grammar", letra: "G", nombre: "Grammar" },
  { id: "listening", letra: "L", nombre: "Listening" },
  { id: "reading", letra: "R", nombre: "Reading" },
  { id: "writing", letra: "W", nombre: "Writing" },
  { id: "speaking", letra: "S", nombre: "Speaking" }
];

/*
 * Un dibujo por seccion, con lo que se hace en ella. El cuadro va relleno con
 * el tono que esa seccion ya tiene en las dos barras -de ahi el `var(--s..)`-
 * asi que la tarjeta y su tramo de barra se reconocen como la misma cosa sin
 * tener que leer la etiqueta.
 *
 * Son dibujos y no fotos a proposito: el examen entero esta hecho de campo
 * azul, tarjeta clara y trazo blanco, y una foto ahi dentro seria lo unico
 * de la pagina que no viene del examen.
 */
const DIBUJOS_SECCION = {
  // La marca de correccion: una linea de texto y el caret que inserta debajo
  grammar: `<path d="M11 15h18M11 21h12" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
            <path d="M17 30l3.5-5 3.5 5" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  // Los cascos: el arco por encima y las dos almohadillas
  listening: `<path d="M12 25v-2a8 8 0 0 1 16 0v2" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
              <rect x="9.5" y="24" width="5" height="8" rx="2.5" fill="#fff"/>
              <rect x="25.5" y="24" width="5" height="8" rx="2.5" fill="#fff"/>`,
  // El libro abierto, con el lomo en medio
  reading: `<path d="M20 13.5c-2.6-1.7-5.6-2.3-9-2v16c3.4-.3 6.4.3 9 2m0-16c2.6-1.7 5.6-2.3 9-2v16c-3.4-.3-6.4.3-9 2m0-16v16"
                  stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  // El lapiz, en diagonal como se sostiene
  writing: `<path d="M12 28l-1 4 4-1L29 17a2.4 2.4 0 0 0 0-3.4l-.6-.6a2.4 2.4 0 0 0-3.4 0z"
                  stroke="#fff" stroke-width="2.2" stroke-linejoin="round" fill="none"/>
            <path d="M23 15.5l4.5 4.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`,
  // El microfono y su pie
  speaking: `<rect x="16.5" y="9.5" width="7" height="13" rx="3.5" stroke="#fff" stroke-width="2.2" fill="none"/>
             <path d="M13 20a7 7 0 0 0 14 0M20 27v4M16.5 31h7" stroke="#fff" stroke-width="2.2" stroke-linecap="round" fill="none"/>`
};

/* La pagina esta en ingles, que es el idioma del examen */
const QUE_SE_HACE = {
  grammar: "Complete the sentence and spot the error, at speed.",
  listening: "Conversations and a lecture, each played once.",
  reading: "Two long passages with the questions underneath.",
  writing: "You type the whole answer while the clock runs.",
  speaking: "You record your answer after a few seconds to think."
};

/*
 * La ventana del titular: un recorte a escala de lo que hay al otro lado del
 * boton. Es el mismo campo azul, la misma tarjeta y las mismas pastillas que
 * se ven al pulsar Start, asi que la portada deja de prometer una cosa y
 * abrir otra. Va dibujado y no capturado para que no envejezca solo.
 */
function ventanaDelExamen() {
  return `<figure class="lp-ventana">
    <svg viewBox="0 0 420 268" role="img" aria-label="A preview of the exam screen: a question card with four answer pills and the section clock.">
      <defs>
        <linearGradient id="lpCampo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3b78b4"/>
          <stop offset="1" stop-color="#63a2d8"/>
        </linearGradient>
      </defs>
      <rect width="420" height="268" rx="14" fill="url(#lpCampo)"/>

      <!-- La cabecera del examen: el disco, la seccion y la pastilla del modo -->
      <circle cx="34" cy="30" r="13" fill="#2b6ca8" stroke="#8bb9e4" stroke-width="2"/>
      <rect x="56" y="22" width="86" height="9" rx="4.5" fill="#ffffff" opacity=".92"/>
      <rect x="56" y="36" width="54" height="6" rx="3" fill="#eaf4ff" opacity=".7"/>
      <rect x="336" y="21" width="60" height="20" rx="10" fill="#ffd60a"/>

      <!-- La barra de instrucciones, en el amarillo con el que habla el examen -->
      <rect x="112" y="56" width="196" height="7" rx="3.5" fill="#ffec3d" opacity=".95"/>

      <!-- El pasaje y la pregunta: las dos tarjetas claras -->
      <rect x="24" y="78" width="176" height="130" rx="16" fill="#eef5fb"/>
      <rect x="42" y="98" width="140" height="7" rx="3.5" fill="#9fbdd8"/>
      <rect x="42" y="113" width="126" height="7" rx="3.5" fill="#c2d6e8"/>
      <rect x="42" y="128" width="136" height="7" rx="3.5" fill="#c2d6e8"/>
      <rect x="42" y="143" width="102" height="7" rx="3.5" fill="#c2d6e8"/>
      <rect x="42" y="164" width="140" height="7" rx="3.5" fill="#c2d6e8"/>
      <rect x="42" y="179" width="118" height="7" rx="3.5" fill="#c2d6e8"/>

      <rect x="212" y="78" width="184" height="130" rx="16" fill="#eef5fb"/>
      <rect x="230" y="96" width="128" height="8" rx="4" fill="#7fa3c4"/>
      <rect x="230" y="118" width="148" height="20" rx="10" fill="#ffffff"/>
      <!-- La opcion marcada: el mismo aro que deja el examen al seleccionar -->
      <rect x="230" y="144" width="148" height="20" rx="10" fill="#ffffff" stroke="#ffd60a" stroke-width="3"/>
      <rect x="230" y="170" width="148" height="20" rx="10" fill="#ffffff"/>

      <!-- El pie: el reloj de la seccion y las dos pastillas de navegacion -->
      <rect x="24" y="224" width="52" height="14" rx="7" fill="#ffffff" opacity=".9"/>
      <rect x="24" y="244" width="34" height="6" rx="3" fill="#dbe9f9" opacity=".8"/>
      <rect x="288" y="224" width="48" height="20" rx="10" fill="#95c4ef"/>
      <rect x="344" y="224" width="52" height="20" rx="10" fill="#6ba8de"/>

      <!-- La barra de avance, abajo del todo, como en el examen -->
      <rect x="24" y="258" width="372" height="5" rx="2.5" fill="#6f9fcd"/>
      <rect x="24" y="258" width="128" height="5" rx="2.5" fill="#3a84c8"/>
    </svg>
    <figcaption>This is the screen behind the button</figcaption>
  </figure>`;
}

/*
 * La referencia de gramatica de la portada. Antes iba escrita a mano en la
 * plantilla, doce veces lo mismo; asi el texto se lee de un vistazo y el
 * marcado sale de una sola forma.
 */
const TIEMPOS_VERBALES = [
  {
    grupo: "Simple",
    casos: [
      ["Simple present", "I eat."],
      ["Simple past", "I ate yesterday."],
      ["Simple future", "I will eat tomorrow."]
    ]
  },
  {
    grupo: "Continuous",
    casos: [
      ["Present continuous", "I am eating right now."],
      ["Past continuous", "I was eating when the phone rang."],
      ["Future continuous", "I will be eating at 9 a.m. tomorrow."]
    ]
  },
  {
    grupo: "Perfect",
    casos: [
      ["Present perfect", "I have eaten eggs every day this week."],
      ["Past perfect", "I had eaten eggs every day until yesterday."],
      ["Future perfect", "By tomorrow, I will have eaten eggs every day."]
    ]
  },
  {
    grupo: "Perfect continuous",
    casos: [
      ["Present perfect continuous", "I have been eating for ten minutes."],
      ["Past perfect continuous", "I had been eating when the phone rang."],
      ["Future perfect continuous", "I will have finished eating by the time you arrive."]
    ]
  }
];

const PREGUNTAS_MUESTRA = [
  {
    enunciado: "Susan is not coming with us because she ______ that movie already.",
    opciones: ["will see", "was seeing", "will have seen", "has seen"],
    correcta: 3,
    porque: "Present perfect: the action is finished, and it is why she is not coming now."
  },
  {
    enunciado: "While on my way to the cafeteria, I noticed that I ______ my wallet.",
    opciones: ["forget", "sometimes forget", "am forgetting", "had forgotten"],
    correcta: 3,
    porque: "Past perfect: the forgetting happened before the noticing."
  },
  {
    enunciado: "If I ______ able to go to the play, she would not have had to drive her car.",
    opciones: ["was", "have been", "am going to be", "had been"],
    correcta: 3,
    porque: "Past perfect in a third conditional: both halves sit in the unreal past."
  }
];

function contarSeccion(sec, id) {
  if (id === "grammar") return (sec.grammar?.questions || []).length;
  if (id === "listening") return (sec.listening?.items || []).reduce((a, it) => a + (it.questions || []).length, 0);
  if (id === "reading") return (sec.reading?.passages || []).reduce((a, p) => a + (p.questions || []).length, 0);
  return (sec[id]?.prompts || []).length;
}

function repartoDelExamen(sec) {
  const filas = SECCIONES.map((s, i) => ({
    ...s,
    tono: i + 1,
    segundos: Number(sec[s.id]?.timeLimit) || 0,
    peso: Number(sec[s.id]?.weight) || 0,
    items: contarSeccion(sec, s.id)
  }));
  const totalSeg = filas.reduce((a, f) => a + f.segundos, 0) || 1;
  const totalPeso = filas.reduce((a, f) => a + f.peso, 0) || 1;
  return filas.map((f) => {
    const tiempo = (f.segundos / totalSeg) * 100;
    const puntaje = (f.peso / totalPeso) * 100;
    return { ...f, tiempo, puntaje, desfase: tiempo - puntaje, totalSeg };
  });
}

function renderPortada() {
  const sec = state.test.sections;
  const filas = repartoDelExamen(sec);
  const totalMin = Math.round(filas[0].totalSeg / 60);
  const importClass = state.importStatus === "error" ? "lnd-msg-error" : "lnd-msg-ok";

  // El que mas se pasa de lo que vale: de eso avisa la nota del final
  const peor = filas.reduce((a, b) => (b.desfase > a.desfase ? b : a), filas[0]);

  const tramo = (f, clave, ancho, i) =>
    `<button class="tramo" data-sec="${f.id}" type="button"` +
    ` style="flex: 0 0 ${ancho.toFixed(2)}%; animation-delay: ${i * 55}ms"` +
    ` aria-label="${esc(f.nombre)}: ${ancho.toFixed(0)} per cent of the ${clave}">${f.letra}</button>`;

  app.innerHTML = `<main class="lp">

  <header class="lp-top">
    <img class="lp-mark" src="${import.meta.env.BASE_URL}logo.svg" alt="" width="34" height="34">
    <span class="lp-word">
      <strong>iTEP Practice Simulator</strong>
      <span>International Test of English Proficiency</span>
    </span>
    <span class="lp-free">Free &middot; no account</span>
  </header>

  <section class="lp-hero">
    <div class="lp-hero-texto">
      <h1>The whole exam.<br><em>On the real clock.</em></h1>
      <p class="lp-lede">
        Five sections back to back, then a CEFR band from A1 to C2 based on how
        you actually answered. It runs in this tab. Nothing to install, nothing
        to sign up for.
      </p>
      <div class="lp-go">
        <button class="lp-btn lp-btn--fuerte" data-action="start-exam">Start exam mode</button>
        <button class="lp-btn" data-action="start-study">Start study mode</button>
      </div>
      <p class="lp-modes">
        <strong>Exam mode</strong> holds the official timing and says nothing until you
        submit. <strong>Study mode</strong> marks each answer as you go and lets the
        clock run past.
      </p>
    </div>
    ${ventanaDelExamen()}
  </section>

  <!--
    Las cinco secciones, cada una con su tono de la rampa: la misma identidad
    de color que llevan en las dos barras de abajo y en la tabla.
  -->
  <section class="secciones" aria-label="The five sections">
    ${filas.map((f) => `<article class="sec">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <rect width="40" height="40" rx="12" fill="var(--s${f.tono})"/>
        ${DIBUJOS_SECCION[f.id] || ""}
      </svg>
      <h3>${f.nombre}</h3>
      <p>${QUE_SE_HACE[f.id] || ""}</p>
      <span class="sec-reloj">${Math.round(f.segundos / 60)} min</span>
    </article>`).join("")}
  </section>

  <!--
    El reparto. Las dos barras dicen lo mismo de dos maneras y no coinciden,
    y ese desajuste es toda la pieza: el tiempo no se reparte como el puntaje.
  -->
  <section class="reparto" aria-labelledby="reparto-h">
    <h2 id="reparto-h">Where the hour goes, and what it buys</h2>
    <p class="reparto-lede">
      Every section is worth the same fifth of your band. They are nowhere near
      the same fraction of your ${totalMin} minutes.
    </p>

    <div class="fila">
      <span class="fila-clave">Time</span>
      <div class="barra barra--tiempo">${filas.map((f, i) => tramo(f, "clock", f.tiempo, i)).join("")}</div>
      <span class="fila-total">${totalMin} min</span>
    </div>

    <div class="fila">
      <span class="fila-clave">Score</span>
      <div class="barra barra--puntaje">${filas.map((f, i) => tramo(f, "score", f.puntaje, i)).join("")}</div>
      <span class="fila-total">100 %</span>
    </div>

    <table class="tabla">
      <thead>
        <tr>
          <th>Section</th>
          <th class="oculta-estrecho">Items</th>
          <th>Minutes</th>
          <th>Of the clock</th>
          <th>Over its share</th>
        </tr>
      </thead>
      <tbody>
        ${filas.map((f) => `<tr data-sec="${f.id}">
          <td><span class="cual"><span class="punto" style="background: var(--s${f.tono})"></span>${f.nombre}</span></td>
          <td class="n oculta-estrecho">${f.items}</td>
          <td class="n">${Math.round(f.segundos / 60)}</td>
          <td class="n">${f.tiempo.toFixed(0)} %</td>
          <td class="desfase" data-signo="${f.desfase > 1 ? "mas" : f.desfase < -1 ? "menos" : "igual"}"><span>${f.desfase > 0 ? "+" : ""}${f.desfase.toFixed(0)}</span></td>
        </tr>`).join("")}
      </tbody>
    </table>

    <p class="reparto-nota">
      <strong>${peor.nombre} is where the hour disappears.</strong> It takes
      ${peor.tiempo.toFixed(0)} per cent of the clock and buys the same
      ${peor.puntaje.toFixed(0)} per cent of the band as every other section:
      ${peor.desfase.toFixed(0)} points more clock than it is worth. Budget it
      before you sit down, not while the timer runs.
    </p>
  </section>

  <section class="hoja">
    <p class="hoja-eyebrow">Loaded exam</p>
    <div class="hoja-cabeza">
      <h2>${esc(state.test.title)}</h2>
      ${state.usingImportedExam ? `<span class="lnd-badge-imported">imported</span>` : ""}
    </div>
    <ul class="hoja-reglas">${state.test.instructions.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
  </section>

  <section class="hoja lnd-import">
    <button class="lnd-import-head" data-action="toggle-import" aria-expanded="${state.importOpen}">
      <span>
        <strong>Use your own exam</strong>
        <em>Load a question bank from a JSON file</em>
      </span>
      <span class="lnd-import-chev">${state.importOpen ? "&minus;" : "+"}</span>
    </button>

    ${state.importOpen ? `
    <div class="lnd-import-body">
      <p class="lnd-import-note">
        The exam above is the built-in one. To sit a different exam, load a JSON
        file with the same shape - download the template to see it, fill it with
        your own questions, and bring it back here.
      </p>

      <div class="lnd-import-actions">
        <button class="lp-btn lp-btn--fuerte" data-action="pick-exam-file">Choose JSON file</button>
        <button class="lp-btn" data-action="download-template">Download template</button>
        ${state.usingImportedExam ? `<button class="lp-btn" data-action="reset-exam">Back to built-in exam</button>` : ""}
      </div>
      <input type="file" id="examFile" accept="application/json,.json" hidden>

      <details class="lnd-paste" ${state.importPasteText || state.importStatus === "error" ? "open" : ""}>
        <summary>Or paste the JSON</summary>
        <textarea id="examPaste" rows="7" spellcheck="false" placeholder="Paste the exam JSON here">${esc(state.importPasteText)}</textarea>
        <button class="lp-btn" data-action="import-pasted">Load pasted exam</button>
      </details>

      ${state.importMsg ? `<p class="lnd-msg ${importClass}">${esc(state.importMsg)}</p>` : ""}

      <p class="lnd-import-cta">
        Need the questions written for you? That is what
        <a href="https://examia.kgstudio.top/" target="_blank" rel="noopener">examia</a>
        does: it generates a bank for any certification exam and exports it as
        JSON. Bring that file here.
      </p>
    </div>` : ""}
  </section>

  <details class="lp-ref">
    <summary>The twelve tenses, and the questions that test them</summary>
      <div class="ref-cuerpo">
        <p class="ref-intro">
          Grammar is the section you can prepare from a list. These twelve tenses
          are what its questions keep asking about.
        </p>
        <div class="ref-rejilla">
          ${TIEMPOS_VERBALES.map((g) => `<div class="ref-grupo">
            <h3>${g.grupo}</h3>
            <ul>${g.casos.map((c) => `<li><strong>${c[0]}</strong><span>${c[1]}</span></li>`).join("")}</ul>
          </div>`).join("")}
        </div>
        <h3 class="ref-muestra-titulo">How the exam asks it</h3>
        ${PREGUNTAS_MUESTRA.map((q, i) => `<div class="ref-muestra">
          <p class="ref-enunciado"><span class="ref-num">Q${i + 1}</span>${q.enunciado}</p>
          <ol class="ref-opciones">${q.opciones.map((o, j) => `<li${j === q.correcta ? ' class="es-la-buena"' : ""}>${"ABCD"[j]}) ${o}${j === q.correcta ? ' <span class="ref-marca">correct</span>' : ""}</li>`).join("")}</ol>
          <p class="ref-porque">${q.porque}</p>
        </div>`).join("")}
      </div>
  </details>

  <p class="lp-aviso">
    Independent practice tool, built by
    <a href="https://kgstudio.top/" target="_blank" rel="noopener">Kevin Gonzalez</a>.
    Not affiliated with or endorsed by iTEP International.
  </p>

</main>`;
}

function render() {
  /* La portada tiene su propio papel y su propia tipografia; el examen no,
     que mantiene su escala de kiosco. La marca va en el body porque el
     fondo cubre la ventana entera, no solo el contenedor. */
  document.body.classList.toggle("en-portada", !state.started && state.view === "instructions");
  if (state.loading) return (app.innerHTML = `<main class="wrap"><section class="panel">Loading...</section></main>`);
  if (state.error) return (app.innerHTML = `<main class="wrap"><section class="panel"><h2>Error</h2><p>${esc(state.error)}</p></section></main>`);

  if (!state.started && state.view === "instructions") {
    renderPortada();
    return;
  }

  if (state.view === "device-check") return (app.innerHTML = renderDeviceCheck());

  if (state.view === "section-break") {
    const n = state.sectionOrder[state.pendingSectionIndex];
    app.innerHTML = `<main class="section-break-shell"><section class="panel section-break-card"><h2>${esc(state.sectionTransitionLabel)}</h2><p class="muted">Timer paused. Continue to start ${esc(n)}.</p><button class="btn primary" data-action="start-pending-section">Continue</button></section></main>`;
    return;
  }

  if (state.view === "review") return (app.innerHTML = renderReview());
  if (state.view === "report") return (app.innerHTML = renderReport());

  const sn = sectionName();
  const progress = Math.round(((state.sectionIndex + 1) / state.sectionOrder.length) * 100);
  app.innerHTML = `<main class="itep-shell"><header class="itep-header"><div class="logo-pill">iTEP</div><div><h1>${sn[0].toUpperCase() + sn.slice(1)}</h1><p>Academic-Plus</p></div><button class="help-btn">${state.mode === "study" ? "Study Mode" : "Exam Mode"}</button></header><section class="instruction-bar">${state.mode === "study" ? "Study mode: answer and review feedback below each question." : "Follow iTEP rules for this section."}</section><div class="main-stage">${renderExamBody()}</div><footer class="itep-footer"><div class="status"><div><strong>${state.sectionIndex + 1}/${state.sectionOrder.length}</strong><span>Section</span></div><div><strong id="timer" class="${(state.mode === "exam" && state.sectionRemaining <= 60) || (state.mode === "study" && state.sectionRemaining < 0) ? "danger" : ""}">${state.mode === "study" ? formatWritingTimer(state.sectionRemaining) : formatTimer(state.sectionRemaining)}</strong><span>${state.mode === "study" ? "Suggested" : "Time Left"}</span></div></div><div class="nav"><button class="btn" data-action="prev-question" ${sn === "listening" || (sn === "writing" && state.mode === "exam") ? "disabled" : ""}>Back</button><button class="btn primary" data-action="next-question">Next</button></div><div class="nav"><button class="btn" data-action="prev-section" ${state.sectionIndex === 0 ? "disabled" : ""}>Prev Section</button><button class="btn primary" data-action="next-section">${state.sectionIndex === state.sectionOrder.length - 1 ? "Review" : "Next Section"}</button></div></footer><div class="progress"><span style="width:${progress}%"></span></div></main>`;
}

function navQuestion(dir) {
  const sn = sectionName();
  if (sn === "grammar") {
    const max = grammarQs().length - 1;
    state.questionIndexes.grammar = Math.max(0, Math.min(max, state.questionIndexes.grammar + dir));
  }
  if (sn === "listening") {
    if (dir < 0) return;
    const max = listeningRows().length - 1;
    state.questionIndexes.listening = Math.max(0, Math.min(max, state.questionIndexes.listening + 1));
  }
  if (sn === "reading") {
    const max = readingRows().length - 1;
    state.questionIndexes.reading = Math.max(0, Math.min(max, state.questionIndexes.reading + dir));
  }
  if (sn === "writing") {
    if (dir < 0 && state.mode === "exam") return;
    const max = sectionData().prompts.length - 1;
    const newIdx = Math.max(0, Math.min(max, state.writingPartIndex + dir));
    if (newIdx !== state.writingPartIndex) {
      state.writingPartIndex = newIdx;
      const pNew = sectionData().prompts[newIdx];
      if (state.mode === "exam" && newIdx === 0) {
        startWritingPartTimer(pNew.recommendedTime, true);
      } else if (state.mode === "study") {
        startWritingPartTimer(pNew.recommendedTime, false);
      } else {
        stopWritingPartTimer();
      }
    }
  }
  if (sn === "speaking") {
    if (dir < 0) return;
    const max = sectionData().prompts.length - 1;
    state.speakingPartIndex = Math.max(0, Math.min(max, state.speakingPartIndex + 1));
    state.speakingStatus = "idle";
  }
  render();
}

function getEnglishVoices() {
  return speechSynthesis.getVoices().filter((v) => (v.lang || "").toLowerCase().startsWith("en"));
}

function pickDialogueVoices() {
  const voices = getEnglishVoices();
  const maleHints = /david|guy|male|mark|tom|daniel|alex/i;
  const femaleHints = /female|zira|hazel|samantha|victoria|karen|susan|fiona|moira|tessa|linda|emma|amy/i;
  const male = voices.find((v) => maleHints.test(v.name || "")) || voices.find((v) => !femaleHints.test(v.name || "")) || voices[0] || null;
  const female = voices.find((v) => femaleHints.test(v.name || "")) || voices.find((v) => v !== male) || male;
  return { male, female };
}

function normalizeDialogueText(raw) {
  return String(raw || "")
    .replace(/^(short|long)\s+conversation\.?\s*/i, "")
    .replace(/^conversation\s+\w+\.?\s*/i, "")
    .replace(/^lecture\.?\s*/i, "")
    .trim();
}

function splitDialogueTurns(raw) {
  const cleaned = normalizeDialogueText(raw);
  const parts = cleaned.split(/(?=(?:Man|Woman|Student\s*[AB]|Speaker\s*\d+|Professor|Customer|Cashier|Receptionist|Advisor|Teaching\s*Assistant)\s*:)/gi).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return [{ text: cleaned, speaker: null }];
  return parts.map((part) => {
    const m = part.match(/^(Man|Woman|Student\s*[AB]|Speaker\s*\d+|Professor|Customer|Cashier|Receptionist|Advisor|Teaching\s*Assistant)\s*:\s*/i);
    return { text: part.replace(/^(Man|Woman|Student\s*[AB]|Speaker\s*\d+|Professor|Customer|Cashier|Receptionist|Advisor|Teaching\s*Assistant)\s*:\s*/i, "").trim(), speaker: m ? m[1] : null };
  }).filter((t) => t.text);
}

function speakTurns(turns, lang = "en-US", rate = 0.95) {
  if (!turns.length) return Promise.resolve();
  const { male, female } = pickDialogueVoices();
  const speakerVoiceMap = {};
  let altIdx = 0;
  return new Promise((resolve) => {
    let pending = turns.length;
    turns.forEach((turn) => {
      const { text, speaker } = typeof turn === "string" ? { text: turn, speaker: null } : turn;
      let voice;
      if (speaker && /woman/i.test(speaker)) {
        voice = female;
      } else if (speaker && /^man$/i.test(speaker)) {
        voice = male;
      } else if (speaker) {
        const key = speaker.toLowerCase().replace(/\s+/g, "");
        if (!(key in speakerVoiceMap)) {
          speakerVoiceMap[key] = altIdx % 2 === 0 ? male : female;
          altIdx++;
        }
        voice = speakerVoiceMap[key];
      } else {
        voice = male;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = rate;
      u.voice = voice;
      u.onend = () => { pending -= 1; if (pending <= 0) resolve(); };
      u.onerror = () => { pending -= 1; if (pending <= 0) resolve(); };
      speechSynthesis.speak(u);
    });
  });
}

function playListening(item) {
  const used = state.listeningPlaybacks[item.id] || 0;
  if (used >= item.playLimit) return;
  state.listeningPlaybacks[item.id] = used + 1;
  if ((item.audioMode || "tts") === "file") {
    const a = document.getElementById("listening-audio");
    if (a) {
      a.currentTime = 0;
      a.onended = () => {
        state.listeningUnlocked[item.id] = true;
        render();
      };
      a.play().catch(() => {});
    }
  } else {
    speechSynthesis.cancel();
    const turns = splitDialogueTurns(item.transcript);
    const run = () => {
      speakTurns(turns, item.voiceLang || "en-US", item.speechRate || 0.95).finally(() => {
        state.listeningUnlocked[item.id] = true;
        render();
      });
    };
    if (!speechSynthesis.getVoices().length) {
      speechSynthesis.onvoiceschanged = () => {
        speechSynthesis.onvoiceschanged = null;
        run();
      };
    } else {
      run();
    }
  }
  render();
}

function autoStartSpeakingIfNeeded() {
  if (state.view !== "exam" || sectionName() !== "speaking") return;
  const p = sectionData().prompts[state.speakingPartIndex];
  if (!p) return;
  if (state.speakingRecordings[p.id]) return;
  if (state.speakingStatus === "preparing" || state.speakingStatus === "recording") return;
  if (state.speakingAutoStartedFor === p.id) return;
  state.speakingAutoStartedFor = p.id;
  startRecording().catch(() => {});
}

/* El input de archivo se dispara con `change`, no con `click`, y el elemento se
   vuelve a crear en cada render. Por eso el listener va delegado en `app` y en
   fase de captura: `change` no burbujea en todos los navegadores. */
/*
 * Mirar una seccion. Apuntar a un tramo, a su pareja de la otra barra o a su
 * fila de la tabla enciende las tres a la vez: lo que se esta comparando es
 * el desajuste entre tiempo y puntaje, no una barra suelta.
 *
 * Va por atributo en el contenedor y no repintando: el render reconstruye el
 * innerHTML entero, y hacerlo en cada movimiento del raton seria absurdo.
 */
function mirarSeccion(id) {
  const reparto = document.querySelector(".reparto");
  if (!reparto) return;
  reparto.querySelectorAll("[data-mirado]").forEach((el) => el.removeAttribute("data-mirado"));
  if (!id) {
    reparto.removeAttribute("data-mira");
    return;
  }
  reparto.dataset.mira = id;
  reparto.querySelectorAll(`[data-sec="${id}"]`).forEach((el) => el.setAttribute("data-mirado", ""));
}

app.addEventListener("pointerover", (e) => {
  const con = e.target?.closest?.("[data-sec]");
  if (con) mirarSeccion(con.dataset.sec);
});

app.addEventListener("pointerleave", () => mirarSeccion(null), true);

/* Con teclado no hay puntero: el foco hace de mirada */
app.addEventListener("focusin", (e) => {
  const con = e.target?.closest?.("[data-sec]");
  mirarSeccion(con ? con.dataset.sec : null);
});

app.addEventListener("input", (e) => {
  if (e.target?.id === "examPaste") state.importPasteText = e.target.value;
});

app.addEventListener("change", (e) => {
  if (e.target?.id !== "examFile") return;
  const file = e.target.files?.[0];
  e.target.value = "";
  importExamFromFile(file);
}, true);

app.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "start-exam") { state.deviceCheck = { pendingMode: "exam", micStatus: "idle", micUrl: null, audioStatus: "idle" }; state.view = "device-check"; return render(); }
  if (action === "start-study") { state.deviceCheck = { pendingMode: "study", micStatus: "idle", micUrl: null, audioStatus: "idle" }; state.view = "device-check"; return render(); }
  if (action === "test-mic") return runMicTest();
  if (action === "test-audio") return runAudioTest();
  if (action === "device-check-continue") return startExam(state.deviceCheck.pendingMode);
  if (action === "toggle-import") { state.importOpen = !state.importOpen; return render(); }
  if (action === "pick-exam-file") { document.getElementById("examFile")?.click(); return; }
  if (action === "import-pasted") return importExamFromText(state.importPasteText, "pasted exam");
  if (action === "download-template") return downloadExamTemplate();
  if (action === "reset-exam") return resetToBuiltInExam();
  if (action === "start-pending-section") return startPendingSection();
  if (action === "next-section") return nextSection();
  if (action === "prev-section") return prevSection();
  if (action === "next-question") return navQuestion(1);
  if (action === "prev-question") return navQuestion(-1);
  if (action === "start-recording") return startRecording();
  if (action === "back-exam") { state.view = "exam"; if (state.mode === "exam") startTimer(sectionData().timeLimit); else stopTimer(); return render(); }
  if (action === "finish-exam") {
    if (state.finalizing) return;
    state.finalizing = true;
    render();
    const wPrompts = state.test.sections.writing.prompts || [];
    const sPrompts = state.test.sections.speaking.prompts || [];
    const jobs = [];
    for (const wp of wPrompts) {
      if (!state.writingEvaluation[wp.id]) {
        jobs.push(promiseWithTimeout(evaluateWritingWithGroq(wp, state.writingTexts[wp.id] || ""), 12000, null));
      }
    }
    for (const sp of sPrompts) {
      if (state.speakingRecordings[sp.id] && !state.speakingEvaluation[sp.id]) {
        jobs.push(promiseWithTimeout(evaluateSpeakingWithGroq(sp), 20000, null));
      }
    }
    await Promise.allSettled(jobs);
    state.finalizing = false;
    state.view = "report";
    return render();
  }
  if (action === "restart") { resetAttemptState(); location.reload(); return; }

  if (action === "play-listening") {
    const row = listeningRows()[state.questionIndexes.listening];
    if (!row) return;
    return playListening(row.item);
  }

  if (action === "answer") {
    if (sectionName() === "listening") {
      const row = listeningRows()[state.questionIndexes.listening];
      if (row && !state.listeningUnlocked[row.item.id]) return;
    }
    state.answers[btn.dataset.qid] = Number(btn.dataset.idx);
    saveState();
    return render();
  }
});

function handleTextInputs(e) {
  const t = e.target;
  if (t.id === "writing-input") {
    const pid = t.dataset.pid;
    state.writingTexts[pid] = t.value;
    state.answers[pid] = t.value;
    saveState();
    const p = sectionData().prompts.find((x) => x.id === pid);
    const words = (t.value.trim().match(/\S+/g) || []).length;
    const c = document.getElementById("writing-counter");
    if (c) c.textContent = `Words: ${words} | min ${p.minWords}${p.maxWords ? ` | max ${p.maxWords}` : ""}`;
  }

  if (t.id === "listening-notes") {
    state.notes.listening[t.dataset.itemid] = t.value;
    saveState();
  }

  if (t.id === "speaking-notes") {
    state.notes.speaking[t.dataset.pid] = t.value;
    saveState();
  }
}

app.addEventListener("input", handleTextInputs);
app.addEventListener("change", handleTextInputs);


window.addEventListener("beforeunload", (e) => {
  e.preventDefault();
  e.returnValue = "";
});

init();
setInterval(autoStartSpeakingIfNeeded, 400);
