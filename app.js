// ---------- Opslag ----------
const LS_WORDS = "wst_words";
const LS_STATS = "wst_stats";

function loadWords() {
  try {
    const raw = localStorage.getItem(LS_WORDS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (e) { /* val terug op standaardlijst */ }
  return DEFAULT_WORDS;
}

function loadStats() {
  try { return JSON.parse(localStorage.getItem(LS_STATS)) || {}; }
  catch (e) { return {}; }
}

function saveStats(stats) {
  try { localStorage.setItem(LS_STATS, JSON.stringify(stats)); } catch (e) { /* privémodus */ }
}

let words = loadWords();
let stats = loadStats();

// ---------- Hulpjes ----------
const $ = (id) => document.getElementById(id);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalize(s, strictAccents) {
  let t = s.trim().toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ");
  if (!strictAccents) {
    t = t.replace(/œ/g, "oe").replace(/æ/g, "ae");
    t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  return t;
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  $(id).classList.remove("hidden");
}

// Getypte tekst renderen, in leermodus met kleur per letter t.o.v. het doelwoord
function renderTyped(el, typed, target) {
  el.innerHTML = "";
  for (let i = 0; i < typed.length; i++) {
    const span = document.createElement("span");
    span.textContent = typed[i];
    if (target !== null) {
      span.className = i < target.length && typed[i] === target[i] ? "ok" : "err";
    }
    el.appendChild(span);
  }
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  el.appendChild(cursor);
}

// ---------- Sessiestatus ----------
let session = null; // { batch, learnIndex, drillQueue, correctNeeded, results, strictAccents }
const CORRECT_NEEDED = 2; // aantal keer foutloos typen in drilmodus

function pickBatch(size) {
  // Minst gekende woorden eerst (minste keren goed), daarbinnen willekeurig
  const scored = shuffle(words).map((w) => {
    const s = stats[w[0]] || { correct: 0, wrong: 0 };
    return { w, score: s.correct - s.wrong };
  });
  scored.sort((a, b) => a.score - b.score);
  return shuffle(scored.slice(0, size).map((x) => x.w));
}

function startSession() {
  const size = parseInt($("batch-size").value, 10);
  session = {
    batch: pickBatch(Math.min(size, words.length)),
    learnIndex: 0,
    drillQueue: [],
    results: {}, // fr -> { attempts, errors }
    strictAccents: $("strict-accents").checked,
  };
  session.batch.forEach(([fr]) => (session.results[fr] = { attempts: 0, errors: 0 }));
  startLearn();
}

// ---------- Leermodus ----------
function startLearn() {
  showScreen("screen-learn");
  showLearnWord();
}

function showLearnWord() {
  const [fr, nl] = session.batch[session.learnIndex];
  $("learn-nl").textContent = nl;
  $("learn-fr").textContent = fr;
  $("learn-progress").textContent = `Woord ${session.learnIndex + 1} van ${session.batch.length}`;
  const input = $("learn-input");
  input.value = "";
  renderTyped($("learn-typed"), "", fr);
  input.focus();
}

function onLearnInput() {
  const [fr] = session.batch[session.learnIndex];
  renderTyped($("learn-typed"), $("learn-input").value, fr);
}

function onLearnEnter() {
  const [fr] = session.batch[session.learnIndex];
  const typed = $("learn-input").value;
  const ok = typed === fr || normalize(typed, session.strictAccents) === normalize(fr, session.strictAccents);
  if (!ok) {
    $("learn-typed").classList.add("shake");
    setTimeout(() => $("learn-typed").classList.remove("shake"), 300);
    return;
  }
  session.learnIndex++;
  if (session.learnIndex < session.batch.length) {
    showLearnWord();
  } else {
    startDrill();
  }
}

// ---------- Drilmodus ----------
function startDrill() {
  // Elk woord moet CORRECT_NEEDED keer goed; volgorde geschud
  session.drillQueue = shuffle(session.batch).map((w) => ({ w, left: CORRECT_NEEDED }));
  session.retyping = false; // na een fout eerst het juiste woord overtypen
  showScreen("screen-drill");
  showDrillWord();
}

function currentDrill() {
  return session.drillQueue[0];
}

function drillProgressText() {
  const total = session.batch.length * CORRECT_NEEDED;
  const left = session.drillQueue.reduce((sum, item) => sum + item.left, 0);
  return `Nog ${left} van ${total} goede antwoorden`;
}

function showDrillWord() {
  const { w } = currentDrill();
  const [, nl] = w;
  $("drill-nl").textContent = nl;
  $("drill-progress").textContent = drillProgressText();
  $("drill-feedback").classList.add("hidden");
  $("drill-feedback").classList.remove("good");
  $("drill-hint").textContent = "Typ de Franse vertaling en druk op Enter";
  session.retyping = false;
  const input = $("drill-input");
  input.value = "";
  renderTyped($("drill-typed"), "", null);
  input.focus();
}

function onDrillInput() {
  const { w } = currentDrill();
  // Tijdens overtypen na een fout: kleur per letter, anders neutraal (niets verklappen)
  renderTyped($("drill-typed"), $("drill-input").value, session.retyping ? w[0] : null);
}

function onDrillEnter() {
  const item = currentDrill();
  const [fr] = item.w;
  const typed = $("drill-input").value;
  if (!typed.trim()) return;

  if (session.retyping) {
    // Correctieronde: het juiste woord moet worden overgetypt
    const ok = typed === fr || normalize(typed, session.strictAccents) === normalize(fr, session.strictAccents);
    if (!ok) {
      $("drill-typed").classList.add("shake");
      setTimeout(() => $("drill-typed").classList.remove("shake"), 300);
      return;
    }
    // Woord achteraan opnieuw in de rij
    session.drillQueue.push(session.drillQueue.shift());
    showDrillWord();
    return;
  }

  const result = session.results[fr];
  result.attempts++;
  const stat = (stats[fr] = stats[fr] || { correct: 0, wrong: 0 });

  const ok = normalize(typed, session.strictAccents) === normalize(fr, session.strictAccents);
  if (ok) {
    stat.correct++;
    item.left--;
    const fb = $("drill-feedback");
    fb.textContent = `✓ ${fr}`;
    fb.classList.remove("hidden");
    fb.classList.add("good");
    if (item.left === 0) {
      session.drillQueue.shift();
    } else {
      session.drillQueue.push(session.drillQueue.shift());
    }
    saveStats(stats);
    if (session.drillQueue.length === 0) {
      setTimeout(finishSession, 500);
    } else {
      setTimeout(showDrillWord, 500);
    }
  } else {
    stat.wrong++;
    result.errors++;
    item.left = CORRECT_NEEDED; // fout: teller voor dit woord opnieuw
    saveStats(stats);
    const fb = $("drill-feedback");
    fb.textContent = fr;
    fb.classList.remove("hidden", "good");
    $("drill-hint").textContent = "Fout — typ het juiste woord over en druk op Enter";
    session.retyping = true;
    const input = $("drill-input");
    input.value = "";
    renderTyped($("drill-typed"), "", fr);
    input.focus();
  }
}

// ---------- Resultaat ----------
function finishSession() {
  showScreen("screen-done");
  const totalErrors = Object.values(session.results).reduce((s, r) => s + r.errors, 0);
  $("done-stats").textContent =
    totalErrors === 0
      ? "Foutloos! Alle woorden in één keer goed gedrild."
      : `Klaar, met ${totalErrors} fout${totalErrors === 1 ? "" : "en"} onderweg.`;

  const list = $("done-words");
  list.innerHTML = "";
  session.batch.forEach(([fr, nl]) => {
    const r = session.results[fr];
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${fr} — ${nl}`;
    const score = document.createElement("span");
    score.textContent = r.errors === 0 ? "✓ foutloos" : `${r.errors}× fout`;
    score.className = r.errors === 0 ? "score-good" : "score-bad";
    li.append(label, score);
    list.appendChild(li);
  });
  updateSummary();
}

function updateSummary() {
  const known = words.filter(([fr]) => (stats[fr] || {}).correct >= CORRECT_NEEDED).length;
  $("progress-summary").textContent = `${known} van ${words.length} woorden al eens goed gedrild.`;
}

// ---------- Woordenlijst bewerken ----------
function openWordEditor() {
  $("words-input").value = words.map(([fr, nl]) => `${fr} = ${nl}`).join("\n");
  showScreen("screen-words");
}

function saveWordList() {
  const lines = $("words-input").value.split("\n");
  const parsed = [];
  for (const line of lines) {
    const m = line.split("=");
    if (m.length >= 2) {
      const fr = m[0].trim();
      const nl = m.slice(1).join("=").trim();
      if (fr && nl) parsed.push([fr, nl]);
    }
  }
  if (!parsed.length) {
    alert("Geen geldige regels gevonden. Gebruik het formaat: frans = nederlands");
    return;
  }
  words = parsed;
  try { localStorage.setItem(LS_WORDS, JSON.stringify(words)); } catch (e) { /* privémodus */ }
  goHome();
}

function goHome() {
  showScreen("screen-start");
  updateSummary();
}

// ---------- Accentknoppen ----------
const ACCENT_CHARS = ["é", "è", "ê", "ë", "à", "â", "ç", "î", "ï", "ô", "û", "ù", "œ", "'"];

function buildAccentBars() {
  document.querySelectorAll(".accents").forEach((bar) => {
    const targetId = bar.dataset.target;
    ACCENT_CHARS.forEach((ch) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = ch;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault(); // focus op het invoerveld houden
        const input = $(targetId);
        input.value += ch;
        input.dispatchEvent(new Event("input"));
        input.focus();
      });
      bar.appendChild(btn);
    });
  });
}

// ---------- Events ----------
$("btn-start").addEventListener("click", startSession);
$("btn-edit-words").addEventListener("click", openWordEditor);
$("btn-save-words").addEventListener("click", saveWordList);
$("btn-cancel-words").addEventListener("click", goHome);
$("btn-reset-words").addEventListener("click", () => {
  words = DEFAULT_WORDS;
  localStorage.removeItem(LS_WORDS);
  openWordEditor();
});
$("btn-again").addEventListener("click", startSession);
$("btn-home").addEventListener("click", goHome);

$("learn-input").addEventListener("input", onLearnInput);
$("learn-input").addEventListener("keydown", (e) => { if (e.key === "Enter") onLearnEnter(); });
$("drill-input").addEventListener("input", onDrillInput);
$("drill-input").addEventListener("keydown", (e) => { if (e.key === "Enter") onDrillEnter(); });

// Klik op de kaart → focus terug naar het (onzichtbare) invoerveld
$("screen-learn").addEventListener("click", () => $("learn-input").focus());
$("screen-drill").addEventListener("click", () => $("drill-input").focus());

buildAccentBars();
goHome();
