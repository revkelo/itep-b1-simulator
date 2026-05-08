const STORAGE_KEY = "itep_v4_state";

const state = {
  loading: true,
  error: "",
  generatingExam: false,
  generationMsg: "",
  test: null,
  started: false,
  view: "instructions",
  sectionOrder: ["grammar", "listening", "reading", "writing", "speaking"],
  sectionIndex: 0,
  pendingSectionIndex: 0,
  sectionTransitionLabel: "",
  questionIndexes: { grammar: 0, listening: 0, reading: 0 },
  writingPartIndex: 0,
  speakingPartIndex: 0,
  answers: {},
  writingTexts: {},
  listeningPlaybacks: {},
  notes: { listening: {}, speaking: {} },
  speakingRecordings: {},
  speakingTranscript: "",
  speakingTranscripts: {},
  speakingEvaluation: {},
  writingEvaluation: {},
  speakingStatus: "idle",
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
    answers: state.answers,
    writingTexts: state.writingTexts,
    notes: state.notes,
    speakingRecordings: state.speakingRecordings,
    speakingTranscripts: state.speakingTranscripts,
    speakingEvaluation: state.speakingEvaluation,
    writingEvaluation: state.writingEvaluation,
    speakingPrepRemaining: state.speakingPrepRemaining,
    sectionIndex: state.sectionIndex
  }));
}

function loadState() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (p.answers) state.answers = p.answers;
    if (p.writingTexts) state.writingTexts = p.writingTexts;
    if (p.notes) state.notes = p.notes;
    if (p.speakingRecordings) state.speakingRecordings = p.speakingRecordings;
    if (p.speakingTranscripts) state.speakingTranscripts = p.speakingTranscripts;
    if (p.speakingEvaluation) state.speakingEvaluation = p.speakingEvaluation;
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
  try {
    const res = await fetch("/data/exam-data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.test = data.tests.find((t) => t.id === data.meta.defaultTestId) || data.tests[0];
    if (!state.test) throw new Error("No test found");
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

async function requestGroqJsonRepair(key, brokenJsonText) {
  const repairPrompt = [
    "Fix this malformed JSON and return ONLY valid JSON.",
    "Do not add explanations or markdown.",
    brokenJsonText
  ].join("\n");
  const repairRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: repairPrompt }]
    })
  });
  if (!repairRes.ok) throw new Error(`GROQ repair ${repairRes.status}`);
  const repairData = await repairRes.json();
  return repairData.choices?.[0]?.message?.content || "";
}

async function parseGroqGeneratedExam(key, content) {
  const firstTry = sanitizeJsonString(extractLikelyJsonBlock(content));
  try {
    return JSON.parse(firstTry);
  } catch {}

  const repaired = await requestGroqJsonRepair(key, firstTry);
  const secondTry = sanitizeJsonString(extractLikelyJsonBlock(repaired));
  return JSON.parse(secondTry);
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
    questions: toArray(it?.questions).map((q, qi) => ensureQuestionShape(q, `l${i + 1}q`, qi))
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
    title: t.title || "Generated iTEP B1 Exam",
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

async function generateNewExamWithGroq() {
  const key = import.meta.env.VITE_GROQ_API_KEY || "";
  if (!key) {
    state.generationMsg = "Add GROQ API key first.";
    render();
    return;
  }

  state.generatingExam = true;
  state.generationMsg = "Generating new iTEP-style exam...";
  render();

  const schemaHint = {
    id: "string",
    title: "string",
    instructions: ["string"],
    sections: {
      grammar: { timeLimit: 600, weight: 0.2, questions: [{ id: "g1", prompt: "string", options: ["A", "B", "C", "D"], correctAnswer: 0, explanation: "string", difficulty: "A2|B1", tags: ["tag"] }] },
      listening: { timeLimit: 380, weight: 0.2, items: [{ id: "l1", audioMode: "tts", playLimit: 1, voiceLang: "en-US", speechRate: 0.95, transcript: "long script", questions: [{ id: "l1q1", prompt: "string", options: ["A","B","C","D"], correctAnswer: 0, explanation: "string", difficulty: "A2|B1", tags: ["tag"] }] }] },
      reading: { timeLimit: 1200, weight: 0.2, passages: [{ id: "r1", title: "string", text: "long text", questions: [{ id: "r1q1", prompt: "string", options: ["A","B","C","D"], correctAnswer: 0, explanation: "string", difficulty: "A2|B1", tags: ["tag"] }] }] },
      writing: { timeLimit: 1500, weight: 0.2, prompts: [{ id: "w1", prompt: "string", minWords: 50, maxWords: 75 }, { id: "w2", prompt: "string", minWords: 175, maxWords: 250 }] },
      speaking: { timeLimit: 180, weight: 0.2, prompts: [{ id: "s1", prompt: "string", prepTime: 30, speakTime: 45 }, { id: "s2", prompt: "string", prepTime: 45, speakTime: 60 }] }
    }
  };

  const prompt = [
    "Create ONE brand-new iTEP-style B1 English exam in strict JSON only (no markdown).",
    "Do NOT use student performance data.",
    "Follow iTEP-like structure and timing:",
    "- Grammar 25 questions (13 completion + 12 error detection), 10 minutes.",
    "- Listening with short conversations + one long conversation + one lecture. Provide rich transcripts for TTS. Total answer timing 380 seconds.",
    "- Reading with 2 passages and 10 questions total.",
    "- Writing with 2 tasks (50-75 words and 175-250 words), total 25 minutes.",
    "- Speaking with 2 tasks (30/45 and 45/60 prep/speak).",
    "Each objective question must have 4 options, correctAnswer index, and explanation.",
    "Return JSON object with key: test.",
    `Schema hint: ${JSON.stringify(schemaHint)}`
  ].join("\n");

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.6,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!res.ok) throw new Error(`GROQ ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = await parseGroqGeneratedExam(key, content);
    const rawTest = parsed.test || parsed;
    const test = normalizeGeneratedTest(rawTest);
    if (!validateGeneratedTest(test)) throw new Error("Generated JSON does not match required structure");

    state.test = test;
    state.answers = {};
    state.writingTexts = {};
    state.notes = { listening: {}, speaking: {} };
    state.speakingRecordings = {};
    state.speakingEvaluation = {};
    state.writingEvaluation = {};
    state.questionIndexes = { grammar: 0, listening: 0, reading: 0 };
    state.writingPartIndex = 0;
    state.speakingPartIndex = 0;
    state.sectionIndex = 0;
    state.generationMsg = "New exam generated.";
  } catch (e) {
    state.generationMsg = `Generation failed: ${e.message || "unknown error"}`;
  } finally {
    state.generatingExam = false;
    render();
  }
}

function startTimer(sec) {
  stopTimer();
  state.sectionRemaining = sec;
  state.timerId = setInterval(() => {
    state.sectionRemaining -= 1;
    const el = document.getElementById("timer");
    if (el) el.textContent = formatTimer(state.sectionRemaining);
    if (state.sectionRemaining <= 0) nextSection();
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

function resetAttemptState() {
  state.answers = {};
  state.writingTexts = {};
  state.listeningPlaybacks = {};
  state.notes = { listening: {}, speaking: {} };
  state.speakingRecordings = {};
  state.speakingTranscript = "";
  state.speakingTranscripts = {};
  state.speakingEvaluation = {};
  state.writingEvaluation = {};
  state.questionIndexes = { grammar: 0, listening: 0, reading: 0 };
  state.writingPartIndex = 0;
  state.speakingPartIndex = 0;
  state.speakingStatus = "idle";
  state.speakingPrepRemaining = 0;
  state.speakingRemaining = 0;
  state.finalizing = false;
  localStorage.removeItem(STORAGE_KEY);
}

function startExam() {
  resetAttemptState();
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
  startTimer(sectionData().timeLimit);
  saveState();
  render();
}

function nextSection() {
  if (state.sectionIndex >= state.sectionOrder.length - 1) {
    stopTimer();
    state.view = "review";
    return render();
  }
  stopTimer();
  state.pendingSectionIndex = state.sectionIndex + 1;
  const n = state.sectionOrder[state.pendingSectionIndex];
  state.sectionTransitionLabel = `Section completed. Start ${n[0].toUpperCase() + n.slice(1)}.`;
  state.view = "section-break";
  render();
}

function prevSection() {
  if (state.sectionIndex === 0) return;
  state.sectionIndex -= 1;
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

function renderGrammar() {
  const idx = state.questionIndexes.grammar;
  const q = grammarQs()[idx];
  return `<section class="content-grid"><article class="passage-card"><h3>Grammar - ${idx < 13 ? "Part 1 (Sentence Completion)" : "Part 2 (Error Detection)"}</h3><p class="prompt">${esc(q.prompt)}</p></article><aside class="question-card"><p><strong>Question ${idx + 1} of ${grammarQs().length}</strong></p><div class="options">${q.options.map((o, i) => optionButton(q.id, o, i)).join("")}</div></aside></section>`;
}

function renderListening() {
  const rows = listeningRows();
  const idx = state.questionIndexes.listening;
  const row = rows[idx];
  const used = state.listeningPlaybacks[row.item.id] || 0;
  const remain = Math.max(0, row.item.playLimit - used);
  const note = state.notes.listening[row.item.id] || "";
  const listenPart = row.item.id === "l1" || row.item.id === "l2" ? "Part 1 (Short Conversations)" : row.item.id === "l3" ? "Part 2 (Long Conversation)" : "Part 3 (Lecture)";
  return `<section class="content-grid"><article class="passage-card"><h3>Listening - ${listenPart}</h3><p class="muted">No transcript shown during this section.</p><p class="tag">Playback left: ${remain}/${row.item.playLimit}</p><button class="btn primary" data-action="play-listening" ${remain === 0 ? "disabled" : ""}>Play Audio</button>${row.item.audioMode === "file" ? `<audio id="listening-audio" controls src="${esc(row.item.audio || "")}"></audio>` : ""}<label class="muted">Notes</label><textarea id="listening-notes" data-itemid="${row.item.id}" placeholder="Write notes here...">${esc(note)}</textarea></article><aside class="question-card"><p><strong>Question ${idx + 1} of ${rows.length}</strong></p><p>${esc(row.question.prompt)}</p><div class="options">${row.question.options.map((o, i) => optionButton(row.question.id, o, i)).join("")}</div></aside></section>`;
}

function renderReading() {
  const rows = readingRows();
  const idx = state.questionIndexes.reading;
  const row = rows[idx];
  const readingPart = row.passage.id === "r1" ? "Part 1" : "Part 2";
  return `<section class="content-grid"><article class="passage-card"><h3>Reading - ${readingPart}: ${esc(row.passage.title)}</h3><div class="scroll-text"><p>${esc(row.passage.text)}</p></div></article><aside class="question-card"><p><strong>Question ${idx + 1} of ${rows.length}</strong></p><p>${esc(row.question.prompt)}</p><div class="options">${row.question.options.map((o, i) => optionButton(row.question.id, o, i)).join("")}</div></aside></section>`;
}

function renderWriting() {
  const prompts = sectionData().prompts;
  const p = prompts[state.writingPartIndex];
  const value = state.writingTexts[p.id] || "";
  const words = (value.trim().match(/\S+/g) || []).length;
  const writingPart = state.writingPartIndex === 0 ? "Part 1 (Short Note)" : "Part 2 (Essay)";
  return `<section class="panel"><h3>Writing - ${writingPart}</h3><p class="prompt">${esc(p.prompt)}</p><textarea id="writing-input" data-pid="${p.id}" spellcheck="true">${esc(value)}</textarea><p id="writing-counter" class="muted">Words: ${words} | min ${p.minWords}${p.maxWords ? ` | max ${p.maxWords}` : ""}</p></section>`;
}

async function startRecording() {
  const p = sectionData().prompts[state.speakingPartIndex];
  if (state.speakingRecordings[p.id] || state.speakingStatus === "recording") return;
  if (state.speakingStatus === "preparing") return;

  state.speakingStatus = "preparing";
  state.speakingPrepRemaining = p.prepTime || 0;
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

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const preferredMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
  const rec = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
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
  }

  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
    const transcript = (state.speakingTranscripts[p.id] || state.speakingTranscript || "").trim();
    const note = (state.notes.speaking[p.id] || "").trim();

    if (blob.size === 0 && !transcript && !note) {
      state.speakingStatus = "idle";
      state.speakingEvaluation[p.id] = JSON.stringify({
        score: 0,
        cefr: "A1",
        feedback: "No speaking response detected. Please record again and allow microphone access."
      });
      saveState();
      return render();
    }

    const url = URL.createObjectURL(blob);
    const audio = document.getElementById("speaking-playback");
    if (audio) { audio.src = url; audio.style.display = "block"; }

    state.speakingRecordings[p.id] = true;
    state.answers[p.id] = "[RECORDED]";
    state.speakingStatus = "done";
    saveState();
    await promiseWithTimeout(evaluateSpeakingWithGroq(p), 12000, null);
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

async function evaluateSpeakingWithGroq(promptObj) {
  const key = import.meta.env.VITE_GROQ_API_KEY || "";
  if (!key) return;
  try {
    const note = state.notes.speaking[promptObj.id] || "";
    const transcript = state.speakingTranscripts[promptObj.id] || state.speakingTranscript || "";
    if (!transcript && !note) {
      state.speakingEvaluation[promptObj.id] = JSON.stringify({
        score: 0,
        cefr: "A1",
        feedback: "No usable speaking response detected for this task."
      });
      saveState();
      return;
    }

    const body = {
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: `Evaluate iTEP B1 speaking response. Return JSON with keys score, cefr, fluency, pronunciation, grammar, vocabulary, coherence, feedback. Prompt: ${promptObj.prompt}\nTranscript: ${transcript}\nNotes: ${note}` }]
    };
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body)
    });
    if (!res.ok) return;
    const data = await res.json();
    state.speakingEvaluation[promptObj.id] = data.choices?.[0]?.message?.content || "";
    saveState();
  } catch {}
}

async function evaluateWritingWithGroq(promptObj, text) {
  const key = import.meta.env.VITE_GROQ_API_KEY || "";
  if (!key) return;
  try {
    if (!text?.trim()) {
      state.writingEvaluation[promptObj.id] = JSON.stringify({
        score: 0,
        cefr: "A1",
        feedback: "No writing response submitted for this task."
      });
      saveState();
      return;
    }

    const body = {
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: `Evaluate iTEP B1 writing response. Return JSON with keys score, cefr, grammar, coherence, vocabulary, fluency, corrections, feedback, improvedVersion. Prompt: ${promptObj.prompt}\nResponse: ${text}` }]
    };
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body)
    });
    if (!res.ok) return;
    const data = await res.json();
    state.writingEvaluation[promptObj.id] = data.choices?.[0]?.message?.content || "";
    saveState();
  } catch {}
}

function renderSpeaking() {
  const p = sectionData().prompts[state.speakingPartIndex];
  const note = state.notes.speaking[p.id] || "";
  const already = !!state.speakingRecordings[p.id];
  const preparing = state.speakingStatus === "preparing";
  const recording = state.speakingStatus === "recording";
  const evalRaw = state.speakingEvaluation[p.id] || "";
  const evalObj = safeParseJsonObject(evalRaw);
  const evalBlock = evalObj
    ? `<div class="feedback-card">
        <h4>Speaking Feedback</h4>
        <div class="feedback-grid">
          <div><strong>Score</strong><span>${Number.isFinite(Number(evalObj.score)) ? Number(evalObj.score) : "-"}</span></div>
          <div><strong>CEFR</strong><span>${esc(evalObj.cefr || "-")}</span></div>
          <div><strong>Fluency</strong><span>${Number.isFinite(Number(evalObj.fluency)) ? Number(evalObj.fluency) : "-"}</span></div>
          <div><strong>Pronunciation</strong><span>${Number.isFinite(Number(evalObj.pronunciation)) ? Number(evalObj.pronunciation) : "-"}</span></div>
          <div><strong>Grammar</strong><span>${Number.isFinite(Number(evalObj.grammar)) ? Number(evalObj.grammar) : "-"}</span></div>
          <div><strong>Vocabulary</strong><span>${Number.isFinite(Number(evalObj.vocabulary)) ? Number(evalObj.vocabulary) : "-"}</span></div>
          <div><strong>Coherence</strong><span>${Number.isFinite(Number(evalObj.coherence)) ? Number(evalObj.coherence) : "-"}</span></div>
        </div>
        <p>${esc(evalObj.feedback || "No detailed feedback.")}</p>
      </div>`
    : (evalRaw ? `<div class="transcript"><h4>Speaking Feedback</h4><p>${esc(evalRaw)}</p></div>` : "");
  const speakingPart = state.speakingPartIndex === 0 ? "Part 1 (Read + Speak)" : "Part 2 (Opinion Response)";
  return `<section class="panel"><h3>Speaking - ${speakingPart}</h3><p class="prompt">${esc(p.prompt)}</p><p class="muted">Prep ${p.prepTime}s | Speak ${p.speakTime}s | One recording only</p><div class="speak-meta"><span class="tag">${preparing ? "Preparing..." : recording ? "Recording..." : already ? "Recorded" : "Ready"}</span><span id="speaking-prep-remaining" class="muted">${preparing ? `${state.speakingPrepRemaining}s prep` : ""}</span><span id="speaking-remaining" class="muted">${recording ? `${state.speakingRemaining}s remaining` : ""}</span></div><button class="btn primary" data-action="start-recording" ${(recording || preparing || already) ? "disabled" : ""}>${already ? "Recorded" : preparing ? "Preparing..." : recording ? "Recording..." : "Start Recording"}</button><div class="wave ${(recording || preparing) ? "active" : ""}"></div><label class="muted">Notes</label><textarea id="speaking-notes" data-pid="${p.id}" placeholder="Write notes before speaking...">${esc(note)}</textarea><audio id="speaking-playback" controls style="display:${already ? "block" : "none"}"></audio>${evalBlock}</section>`;
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

  const writingProgress = sec.writing.prompts.map((p) => {
    const words = ((state.writingTexts[p.id] || "").trim().match(/\S+/g) || []).length;
    if (!p.minWords || p.minWords <= 0) return words > 0 ? 1 : 0;
    return Math.min(words / p.minWords, 1);
  });
  const writingProgressScore = Math.round((writingProgress.reduce((acc, x) => acc + x, 0) / Math.max(writingProgress.length, 1)) * 72);
  const writingAiScores = sec.writing.prompts.map((p) => {
    const parsed = safeParseJsonObject(state.writingEvaluation[p.id] || "");
    const aiScore = Number(parsed?.score);
    return Number.isFinite(aiScore) ? Math.max(0, Math.min(100, aiScore)) : null;
  }).filter((x) => x !== null);
  const writing = writingAiScores.length
    ? Math.round((writingAiScores.reduce((acc, x) => acc + x, 0) / writingAiScores.length) * 0.72)
    : writingProgressScore;

  const speakingAnswered = sec.speaking.prompts.filter((p) => state.speakingRecordings[p.id]).length;
  const speakingProgressScore = Math.round((speakingAnswered / Math.max(sec.speaking.prompts.length, 1)) * 72);
  const speakingAiScores = sec.speaking.prompts.map((p) => {
    const parsed = safeParseJsonObject(state.speakingEvaluation[p.id] || "");
    const aiScore = Number(parsed?.score);
    return Number.isFinite(aiScore) ? Math.max(0, Math.min(100, aiScore)) : null;
  }).filter((x) => x !== null);
  const speaking = speakingAiScores.length
    ? Math.round((speakingAiScores.reduce((acc, x) => acc + x, 0) / speakingAiScores.length) * 0.72)
    : speakingProgressScore;

  const overall = Math.round(grammar * sec.grammar.weight + listening * sec.listening.weight + reading * sec.reading.weight + writing * sec.writing.weight + speaking * sec.speaking.weight);
  const cefr = overall < 25 ? "A1" : overall < 40 ? "A2" : overall < 55 ? "B1" : overall < 70 ? "B2" : overall < 85 ? "C1" : "C2";

  const grammarWrong = gQs.filter((q) => state.answers[q.id] !== q.correctAnswer).map((q) => ({ id: q.id, prompt: q.prompt, chosen: state.answers[q.id], correct: q.correctAnswer, why: q.explanation || "Review grammar structure." }));
  const readingWrong = rQs.filter((q) => state.answers[q.id] !== q.correctAnswer).map((q) => ({ id: q.id, prompt: q.prompt, chosen: state.answers[q.id], correct: q.correctAnswer, why: q.explanation || "Find supporting evidence in the passage." }));
  const listeningWrong = lRows.filter((x) => state.answers[x.q.id] !== x.q.correctAnswer).map((x) => ({ id: x.q.id, prompt: x.q.prompt, chosen: state.answers[x.q.id], correct: x.q.correctAnswer, why: x.q.explanation || "Listen for key words and details.", audioContext: x.item.transcript }));
  const grammarRight = gQs.filter((q) => state.answers[q.id] === q.correctAnswer).map((q) => ({ id: q.id, prompt: q.prompt }));
  const readingRight = rQs.filter((q) => state.answers[q.id] === q.correctAnswer).map((q) => ({ id: q.id, prompt: q.prompt }));
  const listeningRight = lRows.filter((x) => state.answers[x.q.id] === x.q.correctAnswer).map((x) => ({ id: x.q.id, prompt: x.q.prompt }));

  return { grammar, listening, reading, writing, speaking, overall, cefr, grammarWrong, readingWrong, listeningWrong, grammarRight, readingRight, listeningRight };
}

function renderReview() {
  const rpt = computeReport();
  return `<main class="wrap"><section class="panel"><h2>Review & Submit</h2><div class="scores"><div>Grammar ${rpt.grammar}</div><div>Listening ${rpt.listening}</div><div>Reading ${rpt.reading}</div><div>Writing ${rpt.writing}</div><div>Speaking ${rpt.speaking}</div></div><div class="actions"><button class="btn" data-action="back-exam" ${state.finalizing ? "disabled" : ""}>Back</button><button class="btn primary" data-action="finish-exam" ${state.finalizing ? "disabled" : ""}>${state.finalizing ? "Processing..." : "Finish"}</button></div></section></main>`;
}

function renderReport() {
  const rpt = computeReport();
  const scoreToCefr = (x) => (x < 25 ? "A1" : x < 40 ? "A2" : x < 55 ? "B1" : x < 70 ? "B2" : x < 85 ? "C1" : "C2");
  const toItepLevel = (x) => (Math.max(0, Math.min(100, x)) / 20).toFixed(1);
  const sectionRows = [
    ["Grammar", rpt.grammar],
    ["Listening", rpt.listening],
    ["Reading", rpt.reading],
    ["Writing", Math.round((rpt.writing / 72) * 100)],
    ["Speaking", Math.round((rpt.speaking / 72) * 100)]
  ];

  const blockWrong = (title, arr, withAudio = false) => `<h3>${title}</h3>${arr.length ? arr.map((x) => `<div class="transcript"><p><strong>${esc(x.id)}</strong>: ${esc(x.prompt)}</p><p><strong>Your answer:</strong> ${x.chosen ?? "No answer"} | <strong>Correct:</strong> ${x.correct}</p><p><strong>Why:</strong> ${esc(x.why)}</p>${withAudio ? `<p><strong>Audio text for review:</strong> ${esc(x.audioContext)}</p>` : ""}</div>`).join("") : "<p>No mistakes.</p>"}`;
  const blockRight = (title, arr) => `<h3>${title}</h3>${arr.length ? arr.map((x) => `<div class="transcript"><p><strong>${esc(x.id)}</strong>: ${esc(x.prompt)}</p></div>`).join("") : "<p>No correct answers recorded.</p>"}`;
  const renderFeedbackCards = (obj, title) => {
    const entries = Object.entries(obj);
    if (!entries.length) return `<p>No ${esc(title)} feedback available.</p>`;
    return entries.map(([id, txt]) => {
      const parsed = safeParseJsonObject(txt);
      if (!parsed) return `<div class="transcript"><p><strong>${esc(id)}:</strong></p><p>${esc(txt)}</p></div>`;
      return `<div class="feedback-card">
        <h4>${esc(id)} - ${esc(title)} Feedback</h4>
        <div class="feedback-grid">
          <div><strong>Score</strong><span>${Number.isFinite(Number(parsed.score)) ? Number(parsed.score) : "-"}</span></div>
          <div><strong>CEFR</strong><span>${esc(parsed.cefr || "-")}</span></div>
          ${parsed.fluency !== undefined ? `<div><strong>Fluency</strong><span>${esc(parsed.fluency)}</span></div>` : ""}
          ${parsed.pronunciation !== undefined ? `<div><strong>Pronunciation</strong><span>${esc(parsed.pronunciation)}</span></div>` : ""}
          ${parsed.grammar !== undefined ? `<div><strong>Grammar</strong><span>${esc(parsed.grammar)}</span></div>` : ""}
          ${parsed.vocabulary !== undefined ? `<div><strong>Vocabulary</strong><span>${esc(parsed.vocabulary)}</span></div>` : ""}
          ${parsed.coherence !== undefined ? `<div><strong>Coherence</strong><span>${esc(parsed.coherence)}</span></div>` : ""}
        </div>
        ${parsed.feedback ? `<p>${esc(parsed.feedback)}</p>` : ""}
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
  <h3 class="table-title">Assessment by Test Section</h3>
  <table class="assessment-table">
    <thead><tr><th>Test Section</th><th>CEFR Level</th><th>iTEP Level</th><th>Description</th></tr></thead>
    <tbody>
      ${sectionRows.map(([name, score]) => `<tr><td>${name}</td><td>${scoreToCefr(score)}</td><td>${toItepLevel(score)}</td><td>${score >= 70 ? "Advanced" : score >= 55 ? "Upper Intermediate" : score >= 40 ? "Intermediate" : score >= 25 ? "Elementary" : "Beginner"}</td></tr>`).join("")}
    </tbody>
  </table>
  ${blockWrong("Listening - Incorrect", rpt.listeningWrong, true)}${blockRight("Listening - Correct", rpt.listeningRight)}${blockWrong("Reading - Incorrect", rpt.readingWrong)}${blockRight("Reading - Correct", rpt.readingRight)}${blockWrong("Grammar - Incorrect", rpt.grammarWrong)}${blockRight("Grammar - Correct", rpt.grammarRight)}
  <h3>Writing AI Feedback</h3>${renderFeedbackCards(state.writingEvaluation, "Writing")}
  <h3>Speaking AI Feedback</h3>${renderFeedbackCards(state.speakingEvaluation, "Speaking")}
  <button class="btn" data-action="restart">Restart Exam</button></section></main>`;
}

function render() {
  if (state.loading) return (app.innerHTML = `<main class="wrap"><section class="panel">Loading...</section></main>`);
  if (state.error) return (app.innerHTML = `<main class="wrap"><section class="panel"><h2>Error</h2><p>${esc(state.error)}</p></section></main>`);

  if (!state.started && state.view === "instructions") {
    app.innerHTML = `<main class="wrap"><section class="panel"><h1>${esc(state.test.title)}</h1><ul>${state.test.instructions.map((i) => `<li>${esc(i)}</li>`).join("")}</ul><div class="actions"><button class="btn" data-action="generate-exam" ${state.generatingExam ? "disabled" : ""}>${state.generatingExam ? "Generating..." : "Generate New iTEP Exam"}</button><button class="btn primary" data-action="start-exam">Start Full Exam</button></div>${state.generationMsg ? `<p class="muted">${esc(state.generationMsg)}</p>` : ""}</section></main>`;
    return;
  }

  if (state.view === "section-break") {
    const n = state.sectionOrder[state.pendingSectionIndex];
    app.innerHTML = `<main class="wrap"><section class="panel"><h2>${esc(state.sectionTransitionLabel)}</h2><p class="muted">Timer paused. Continue to start ${esc(n)}.</p><button class="btn primary" data-action="start-pending-section">Continue</button></section></main>`;
    return;
  }

  if (state.view === "review") return (app.innerHTML = renderReview());
  if (state.view === "report") return (app.innerHTML = renderReport());

  const sn = sectionName();
  const progress = Math.round(((state.sectionIndex + 1) / state.sectionOrder.length) * 100);
  app.innerHTML = `<main class="itep-shell"><header class="itep-header"><div class="logo-pill">iTEP</div><div><h1>${sn[0].toUpperCase() + sn.slice(1)}</h1><p>Academic-Plus</p></div><button class="help-btn">Help</button></header><section class="instruction-bar">Follow iTEP rules for this section.</section><div class="main-stage">${renderExamBody()}</div><footer class="itep-footer"><div class="status"><div><strong>${state.sectionIndex + 1}/${state.sectionOrder.length}</strong><span>Section</span></div><div><strong id="timer" class="${state.sectionRemaining <= 60 ? "danger" : ""}">${formatTimer(state.sectionRemaining)}</strong><span>Time Left</span></div></div><div class="nav"><button class="btn" data-action="prev-question" ${sn === "listening" ? "disabled" : ""}>Back</button><button class="btn primary" data-action="next-question">Next</button></div><div class="nav"><button class="btn" data-action="prev-section" ${state.sectionIndex === 0 ? "disabled" : ""}>Prev Section</button><button class="btn primary" data-action="next-section">${state.sectionIndex === state.sectionOrder.length - 1 ? "Review" : "Next Section"}</button></div></footer><div class="progress"><span style="width:${progress}%"></span></div></main>`;
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
    if (dir < 0) return;
    const max = sectionData().prompts.length - 1;
    state.writingPartIndex = Math.max(0, Math.min(max, state.writingPartIndex + 1));
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

function pickMaleVoices() {
  const voices = getEnglishVoices();
  const maleHints = /david|guy|male|mark|tom|daniel|alex/i;
  const male = voices.filter((v) => maleHints.test(v.name || ""));
  if (male.length >= 2) return male.slice(0, 2);
  if (male.length === 1 && voices.length > 1) {
    const alt = voices.find((v) => v.name !== male[0].name) || male[0];
    return [male[0], alt];
  }
  if (voices.length >= 2) return voices.slice(0, 2);
  return voices.length ? [voices[0], voices[0]] : [null, null];
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
  const parts = cleaned.split(/(?=(?:Man|Woman|Student\s*[AB]|Speaker\s*\d+|Professor)\s*:)/gi).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return [cleaned];
  return parts.map((part) => part.replace(/^(Man|Woman|Student\s*[AB]|Speaker\s*\d+|Professor)\s*:\s*/i, "").trim()).filter(Boolean);
}

function speakTurns(turns, lang = "en-US", rate = 0.95) {
  if (!turns.length) return;
  const [voiceA, voiceB] = pickMaleVoices();
  turns.forEach((text, idx) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = rate;
    u.voice = idx % 2 === 0 ? voiceA : voiceB;
    speechSynthesis.speak(u);
  });
}

function playListening(item) {
  const used = state.listeningPlaybacks[item.id] || 0;
  if (used >= item.playLimit) return;
  state.listeningPlaybacks[item.id] = used + 1;
  if ((item.audioMode || "tts") === "file") {
    const a = document.getElementById("listening-audio");
    if (a) { a.currentTime = 0; a.play().catch(() => {}); }
  } else {
    speechSynthesis.cancel();
    const turns = splitDialogueTurns(item.transcript);
    const run = () => speakTurns(turns, item.voiceLang || "en-US", item.speechRate || 0.95);
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

app.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "start-exam") return startExam();
  if (action === "generate-exam") return generateNewExamWithGroq();
  if (action === "start-pending-section") return startPendingSection();
  if (action === "next-section") return nextSection();
  if (action === "prev-section") return prevSection();
  if (action === "next-question") return navQuestion(1);
  if (action === "prev-question") return navQuestion(-1);
  if (action === "start-recording") return startRecording();
  if (action === "back-exam") { state.view = "exam"; startTimer(sectionData().timeLimit); return render(); }
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
        jobs.push(promiseWithTimeout(evaluateSpeakingWithGroq(sp), 12000, null));
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
    return playListening(row.item);
  }

  if (action === "answer") {
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

window.addEventListener("keydown", (e) => {
  if (state.view !== "exam") return;
  if (e.key === "ArrowRight") navQuestion(1);
  if (e.key === "ArrowLeft") navQuestion(-1);
});

window.addEventListener("beforeunload", (e) => {
  e.preventDefault();
  e.returnValue = "";
});

init();
