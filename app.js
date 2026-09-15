// ---------- Basis ----------
const $ = (id) => document.getElementById(id);

let settings = Storage.getSettings();
let stats = Storage.getStats();
let activeList = Storage.getList(Storage.activeId());

const CORRECT_NEEDED = 2; // aantal keer foutloos uit het hoofd per ronde

// ---------- Tekstvergelijking ----------
const LIGATURES = { œ: "o", Œ: "o", æ: "a", Æ: "a" };

function foldChar(ch) {
  if (LIGATURES[ch]) return LIGATURES[ch];
  return ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Vergelijkt één letter; buiten de strenge modus telt é hetzelfde als e.
function eqChar(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (settings.strictAccents) return a.toLowerCase() === b.toLowerCase();
  return foldChar(a) === foldChar(b);
}

function normalize(s) {
  let t = String(s).trim().toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ");
  if (!settings.strictAccents) {
    t = t.replace(/œ/g, "oe").replace(/æ/g, "ae");
    t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  return t;
}

function isMatch(typed, target) {
  return normalize(typed) === normalize(target);
}

function isLetter(ch) {
  return /\p{L}/u.test(ch);
}

// Levenshtein-uitlijning: welke letters kloppen, welke zijn fout, welke ontbreken.
function alignWords(typed, target) {
  const a = Array.from(typed);
  const b = Array.from(target);
  const n = a.length;
  const m = b.length;
  const dp = [];
  for (let i = 0; i <= n; i++) {
    dp.push(new Int32Array(m + 1));
    dp[i][0] = i;
  }
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = eqChar(a[i - 1], b[j - 1]) ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const cost = eqChar(a[i - 1], b[j - 1]) ? 0 : 1;
      if (dp[i][j] === dp[i - 1][j - 1] + cost) {
        ops.push(cost === 0 ? { op: "match", ch: a[i - 1], expected: b[j - 1] } : { op: "sub", ch: a[i - 1], expected: b[j - 1] });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ op: "ins", ch: a[i - 1] });
      i--;
      continue;
    }
    ops.push({ op: "del", expected: b[j - 1] });
    j--;
  }
  return ops.reverse();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function span(text, cls) {
  const el = document.createElement("span");
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  $(id).classList.remove("hidden");
}

// Getypte tekst tonen; met target erbij kleurt elke letter groen of rood.
function renderTyped(el, typed, target) {
  el.innerHTML = "";
  const chars = Array.from(typed);
  const t = target == null ? null : Array.from(target);
  chars.forEach((ch, idx) => {
    let cls = "";
    if (t) cls = idx < t.length && eqChar(ch, t[idx]) ? "ok" : "err";
    el.appendChild(span(ch, cls));
  });
  el.appendChild(span("", "cursor"));
}

function shake(el) {
  el.classList.remove("shake");
  void el.offsetWidth; // herstart de animatie
  el.classList.add("shake");
  setTimeout(() => el.classList.remove("shake"), 350);
}

// ---------- Sessie ----------
let session = null;

function pickBatch(size) {
  const scored = shuffle(activeList.words).map((w) => {
    const s = stats[w[0]] || { correct: 0, wrong: 0 };
    return { w, score: s.correct - s.wrong * 2 };
  });
  scored.sort((a, b) => a.score - b.score);
  return shuffle(scored.slice(0, size).map((x) => x.w));
}

function startSession() {
  if (!activeList.words.length) {
    alert("Deze lijst is leeg. Voeg eerst woorden toe.");
    return;
  }
  session = {
    batch: pickBatch(Math.min(settings.batchSize, activeList.words.length)),
    learnIndex: 0,
    results: {},
  };
  session.batch.forEach(([fr]) => (session.results[fr] = { errors: 0, hints: 0, helped: false }));
  startLearn();
}

function bumpStat(fr, key) {
  const s = (stats[fr] = stats[fr] || { correct: 0, wrong: 0 });
  s[key]++;
  Storage.saveStats(stats);
}

// ================= LEERMODUS: letters achter bubbels =================
const learn = { chars: [], slots: [], pos: 0, done: false };

function startLearn() {
  showScreen("screen-learn");
  showLearnWord();
}

function showLearnWord() {
  const [fr, nl] = session.batch[session.learnIndex];
  $("learn-nl").textContent = nl;
  $("learn-progress").textContent = `Woord ${session.learnIndex + 1} van ${session.batch.length}`;
  $("learn-hint").textContent = "Typ de letters — weet je het niet? Druk op Enter voor één letter.";

  learn.chars = Array.from(fr);
  learn.pos = 0;
  learn.done = false;
  learn.slots = buildBubbles($("learn-bubbles"), learn.chars);

  skipAutoChars();
  markCurrent();

  const input = $("learn-input");
  input.value = "";
  input.focus();
}

function buildBubbles(container, chars) {
  container.innerHTML = "";
  const slots = [];
  chars.forEach((ch, idx) => {
    const slot = document.createElement("span");
    slot.className = "slot";
    slot.style.setProperty("--i", idx);
    slot.appendChild(span(ch === " " ? " " : ch, "letter"));
    if (isLetter(ch)) {
      slot.appendChild(span("", "bubble"));
    } else {
      slot.classList.add("auto", "popped");
      if (ch === " ") slot.classList.add("space");
    }
    container.appendChild(slot);
    slots.push(slot);
  });
  return slots;
}

function skipAutoChars() {
  while (learn.pos < learn.chars.length && !isLetter(learn.chars[learn.pos])) learn.pos++;
}

function markCurrent() {
  learn.slots.forEach((s) => s.classList.remove("current"));
  if (learn.pos < learn.slots.length) learn.slots[learn.pos].classList.add("current");
}

function popBubble(idx, hinted) {
  const slot = learn.slots[idx];
  if (!slot) return;
  slot.classList.add("popped");
  if (hinted) slot.classList.add("hinted");
}

function advanceLearn(hinted) {
  popBubble(learn.pos, hinted);
  learn.pos++;
  skipAutoChars();
  markCurrent();
  if (learn.pos >= learn.chars.length) finishLearnWord();
}

function finishLearnWord() {
  learn.done = true;
  learn.slots.forEach((s) => s.classList.remove("current"));
  $("learn-bubbles").classList.add("complete");
  $("learn-hint").textContent = "✓ juist!";
  setTimeout(() => {
    $("learn-bubbles").classList.remove("complete");
    session.learnIndex++;
    if (session.learnIndex < session.batch.length) showLearnWord();
    else startDrill();
  }, 650);
}

function onLearnKeystrokes() {
  const input = $("learn-input");
  const typed = input.value;
  input.value = "";
  if (learn.done) return;
  for (const ch of Array.from(typed)) {
    if (learn.done) break;
    if (!ch.trim() && ch !== " ") continue;
    if (eqChar(ch, learn.chars[learn.pos])) {
      advanceLearn(false);
    } else {
      const slot = learn.slots[learn.pos];
      if (slot) {
        slot.classList.add("wrong");
        setTimeout(() => slot.classList.remove("wrong"), 420);
      }
    }
  }
}

function onLearnEnter() {
  if (learn.done) return;
  const [fr] = session.batch[session.learnIndex];
  session.results[fr].hints++;
  advanceLearn(true);
}

// ================= DRILMODUS =================
const ANSWER = "answer";
const REVIEW = "review";
const COPY = "copy";
const RECALL = "recall";

function startDrill() {
  session.queue = shuffle(session.batch).map((w) => ({ w, left: CORRECT_NEEDED }));
  session.enterArmed = false;
  showScreen("screen-drill");
  nextDrillWord();
}

function currentDrill() {
  return session.queue[0];
}

function drillProgressText() {
  const total = session.batch.length * CORRECT_NEEDED;
  const left = session.queue.reduce((sum, it) => sum + it.left, 0);
  return `Nog ${left} van ${total} goede antwoorden`;
}

function nextDrillWord() {
  if (!session.queue.length) {
    finishSession();
    return;
  }
  $("drill-nl").textContent = currentDrill().w[1];
  $("drill-progress").textContent = drillProgressText();
  setDrillState(ANSWER);
}

function setDrillState(state, attempt) {
  session.state = state;
  session.enterArmed = false;
  const [fr] = currentDrill().w;
  const input = $("drill-input");
  input.value = "";

  const typedEl = $("drill-typed");
  const revealEl = $("drill-reveal");
  const reviewEl = $("drill-review");
  const stageEl = $("drill-stage");

  $("drill-type-area").classList.remove("hidden");
  revealEl.classList.add("hidden");
  reviewEl.classList.add("hidden");

  if (state === ANSWER) {
    stageEl.className = "stage-tag hidden";
    renderTyped(typedEl, "", null);
    $("drill-hint").textContent = "Typ de Franse vertaling · weet je het niet? 2× Enter";
  } else if (state === COPY) {
    stageEl.className = "stage-tag copy";
    stageEl.textContent = "overtypen";
    revealEl.textContent = fr;
    revealEl.classList.remove("hidden");
    renderTyped(typedEl, "", fr);
    $("drill-hint").textContent = "Typ het woord hieronder over";
  } else if (state === RECALL) {
    stageEl.className = "stage-tag recall";
    stageEl.textContent = "uit het hoofd";
    renderTyped(typedEl, "", null);
    $("drill-hint").textContent = "En nu nog eens, zonder te kijken";
  } else if (state === REVIEW) {
    stageEl.className = "stage-tag review";
    stageEl.textContent = "nakijken";
    $("drill-type-area").classList.add("hidden");
    reviewEl.classList.remove("hidden");
    renderDiff(alignWords(attempt || "", fr));
    $("drill-hint").textContent = "Enter om verder te gaan";
  }
  input.focus();
}

function renderDiff(ops) {
  const targetEl = $("review-target");
  const attemptEl = $("review-attempt");
  targetEl.innerHTML = "";
  attemptEl.innerHTML = "";
  for (const op of ops) {
    if (op.op === "match") {
      targetEl.appendChild(span(op.expected, "d-ok"));
      attemptEl.appendChild(span(op.ch, "d-ok"));
    } else if (op.op === "sub") {
      targetEl.appendChild(span(op.expected, "d-missed"));
      attemptEl.appendChild(span(op.ch, "d-bad"));
    } else if (op.op === "ins") {
      targetEl.appendChild(span("", "d-gap"));
      attemptEl.appendChild(span(op.ch, "d-bad"));
    } else {
      targetEl.appendChild(span(op.expected, "d-missed"));
      attemptEl.appendChild(span("·", "d-bad"));
    }
  }
  if (!ops.length) attemptEl.appendChild(span("—", "d-bad"));
}

function onDrillInput() {
  const [fr] = currentDrill().w;
  const value = $("drill-input").value;
  if (value) session.enterArmed = false;
  // Alleen bij overtypen mag je meekijken of elke letter klopt.
  renderTyped($("drill-typed"), value, session.state === COPY ? fr : null);
}

function onDrillEnter() {
  const item = currentDrill();
  const [fr] = item.w;
  const typed = $("drill-input").value.trim();

  if (session.state === REVIEW) {
    setDrillState(COPY);
    return;
  }

  if (session.state === COPY) {
    if (!typed) return;
    if (isMatch(typed, fr)) setDrillState(RECALL);
    else setDrillState(REVIEW, typed);
    return;
  }

  // ANSWER en RECALL: leeg + 2× Enter = "ik weet het niet"
  if (!typed) {
    if (!session.enterArmed) {
      session.enterArmed = true;
      $("drill-hint").textContent = "Nog eens Enter en je krijgt het woord te zien";
      return;
    }
    giveUp(item);
    return;
  }

  if (isMatch(typed, fr)) {
    if (session.state === ANSWER) {
      bumpStat(fr, "correct");
      item.left--;
      if (item.left <= 0) session.queue.shift();
      else session.queue.push(session.queue.shift());
    } else {
      // Uit het hoofd gelukt na hulp: telt niet als schone beurt, wel als vooruitgang.
      bumpStat(fr, "correct");
      item.left = CORRECT_NEEDED;
      session.queue.push(session.queue.shift());
    }
    flashCorrect(fr);
    return;
  }

  // Fout antwoord
  bumpStat(fr, "wrong");
  session.results[fr].errors++;
  session.results[fr].helped = true;
  item.left = CORRECT_NEEDED;
  setDrillState(REVIEW, typed);
}

function giveUp(item) {
  const [fr] = item.w;
  bumpStat(fr, "wrong");
  session.results[fr].hints++;
  session.results[fr].helped = true;
  item.left = CORRECT_NEEDED;
  setDrillState(COPY);
}

function flashCorrect(fr) {
  const typedEl = $("drill-typed");
  typedEl.innerHTML = "";
  typedEl.appendChild(span("✓ " + fr, "flash-ok"));
  $("drill-hint").textContent = "";
  $("drill-stage").className = "stage-tag hidden";
  $("drill-reveal").classList.add("hidden");
  $("drill-progress").textContent = drillProgressText();
  session.state = "pause";
  setTimeout(nextDrillWord, 550);
}

// ---------- Resultaat ----------
function finishSession() {
  showScreen("screen-done");
  const totalErrors = Object.values(session.results).reduce((s, r) => s + r.errors, 0);
  const helped = Object.values(session.results).filter((r) => r.helped).length;
  $("done-stats").textContent =
    totalErrors === 0 && helped === 0
      ? "Foutloos! Alle woorden in één keer uit het hoofd."
      : `${totalErrors} fout${totalErrors === 1 ? "" : "en"}, ${helped} woord${helped === 1 ? "" : "en"} met hulp.`;

  const list = $("done-words");
  list.innerHTML = "";
  session.batch.forEach(([fr, nl]) => {
    const r = session.results[fr];
    const li = document.createElement("li");
    li.append(span(`${fr} — ${nl}`, ""));
    const clean = r.errors === 0 && !r.helped;
    li.append(span(clean ? "✓ foutloos" : `${r.errors}× fout`, clean ? "score-good" : "score-bad"));
    list.appendChild(li);
  });
  updateSummary();
}

function updateSummary() {
  const known = activeList.words.filter(([fr]) => (stats[fr] || {}).correct >= CORRECT_NEEDED).length;
  $("progress-summary").textContent = `${known} van ${activeList.words.length} woorden al eens goed gedrild.`;
}

// ---------- Startscherm ----------
function renderListSelect() {
  const sel = $("list-select");
  sel.innerHTML = "";
  Storage.allLists().forEach((l) => {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = `${l.name} (${l.words.length})`;
    sel.appendChild(opt);
  });
  sel.value = activeList.id || Storage.DEFAULT_ID;
  $("btn-delete-list").classList.toggle("hidden", sel.value === Storage.DEFAULT_ID);
}

function goHome() {
  activeList = Storage.getList(Storage.activeId());
  renderListSelect();
  $("batch-size").value = String(settings.batchSize);
  $("strict-accents").checked = settings.strictAccents;
  showScreen("screen-start");
  updateSummary();
}

// ---------- Woordenlijst bewerken ----------
function openWordEditor() {
  $("list-name-input").value = activeList.id === Storage.DEFAULT_ID ? "" : activeList.name;
  $("list-name-input").placeholder = activeList.id === Storage.DEFAULT_ID ? "Naam voor je eigen kopie" : "Naam van de lijst";
  $("words-input").value = activeList.words.map(([fr, nl]) => `${fr} = ${nl}`).join("\n");
  $("btn-save-words").classList.toggle("hidden", activeList.id === Storage.DEFAULT_ID);
  showScreen("screen-words");
}

function parseEditorText() {
  const parsed = [];
  for (const line of $("words-input").value.split("\n")) {
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const fr = line.slice(0, idx).trim();
    const nl = line.slice(idx + 1).trim();
    if (fr && nl) parsed.push([fr, nl]);
  }
  return parsed;
}

function saveWordList(asNew) {
  const words = parseEditorText();
  if (!words.length) {
    alert("Geen geldige regels gevonden. Gebruik het formaat: frans = nederlands");
    return;
  }
  const name = $("list-name-input").value.trim() || "Mijn lijst";
  Storage.saveList({ id: asNew ? null : activeList.id, name, words });
  goHome();
}

// ================= SCREENSHOTS IMPORTEREN =================
const importState = { files: [], pairs: [], raw: "", unparsed: [] };

function openImport() {
  importState.files = [];
  importState.pairs = [];
  importState.raw = "";
  importState.unparsed = [];
  $("thumbs").innerHTML = "";
  $("import-result").classList.add("hidden");
  $("ocr-progress").classList.add("hidden");
  $("import-name").value = "";
  $("btn-run-ocr").disabled = true;
  $("file-input").value = "";
  showScreen("screen-import");
}

function addFiles(fileList) {
  const images = Array.from(fileList).filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif|heic)$/i.test(f.name));
  const skipped = Array.from(fileList).length - images.length;
  importState.files = importState.files.concat(images);
  renderThumbs();
  $("btn-run-ocr").disabled = importState.files.length === 0;
  if (skipped > 0) alert(`${skipped} bestand(en) overgeslagen: dat zijn geen afbeeldingen.`);
}

function renderThumbs() {
  const box = $("thumbs");
  box.innerHTML = "";
  importState.files.forEach((file, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "thumb";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);
    const del = document.createElement("button");
    del.className = "thumb-del";
    del.textContent = "×";
    del.title = "Verwijderen";
    del.addEventListener("click", () => {
      importState.files.splice(idx, 1);
      renderThumbs();
      $("btn-run-ocr").disabled = importState.files.length === 0;
    });
    wrap.append(img, del);
    box.appendChild(wrap);
  });
}

async function runOcr() {
  $("btn-run-ocr").disabled = true;
  $("ocr-progress").classList.remove("hidden");
  $("import-result").classList.add("hidden");
  const setProgress = (p, msg) => {
    $("ocr-bar").style.width = Math.round(p * 100) + "%";
    $("ocr-status").textContent = msg;
  };
  setProgress(0.01, "Starten…");

  try {
    const result = await OCR.recognizeFiles(importState.files, setProgress);
    importState.raw = result.text;
    const { pairs, unparsed } = OCR.parseDocument(result);
    importState.pairs = pairs;
    importState.unparsed = unparsed;
    renderImportResult();
    $("ocr-progress").classList.add("hidden");
  } catch (err) {
    $("ocr-status").textContent = "Herkennen mislukt: " + err.message;
    console.error(err);
  } finally {
    $("btn-run-ocr").disabled = importState.files.length === 0;
  }
}

function renderImportResult() {
  $("import-result").classList.remove("hidden");
  $("import-count").textContent = `${importState.pairs.length} woordparen gevonden in ${importState.files.length} screenshot${importState.files.length === 1 ? "" : "s"}`;
  $("raw-text").textContent = importState.raw || "(geen tekst gevonden)";

  const unparsedBox = $("unparsed-details");
  unparsedBox.classList.toggle("hidden", importState.unparsed.length === 0);
  $("unparsed-count").textContent = String(importState.unparsed.length);
  $("unparsed-text").textContent = importState.unparsed.join("\n");

  renderPairsTable();
}

function renderPairsTable() {
  const box = $("pairs-table");
  box.innerHTML = "";
  const head = document.createElement("div");
  head.className = "pair-row head";
  head.append(span("Frans", ""), span("Nederlands", ""), span("", ""));
  box.appendChild(head);

  importState.pairs.forEach((pair, idx) => {
    const row = document.createElement("div");
    row.className = "pair-row";

    const fr = document.createElement("input");
    fr.type = "text";
    fr.value = pair[0];
    fr.addEventListener("input", () => (importState.pairs[idx][0] = fr.value));

    const nl = document.createElement("input");
    nl.type = "text";
    nl.value = pair[1];
    nl.addEventListener("input", () => (importState.pairs[idx][1] = nl.value));

    const del = document.createElement("button");
    del.className = "ghost small";
    del.textContent = "×";
    del.addEventListener("click", () => {
      importState.pairs.splice(idx, 1);
      renderPairsTable();
      $("import-count").textContent = `${importState.pairs.length} woordparen`;
    });

    row.append(fr, nl, del);
    box.appendChild(row);
  });
}

function saveImportedList() {
  const words = importState.pairs
    .map(([fr, nl]) => [String(fr).trim(), String(nl).trim()])
    .filter(([fr, nl]) => fr && nl);
  if (!words.length) {
    alert("Er staan geen woordparen in de tabel.");
    return;
  }
  const name = $("import-name").value.trim();
  if (!name) {
    alert("Geef de lijst eerst een naam.");
    $("import-name").focus();
    return;
  }
  Storage.saveList({ id: null, name, words });
  goHome();
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
$("btn-again").addEventListener("click", startSession);
$("btn-home").addEventListener("click", goHome);

$("list-select").addEventListener("change", (e) => {
  Storage.setActiveId(e.target.value);
  activeList = Storage.getList(e.target.value);
  $("btn-delete-list").classList.toggle("hidden", e.target.value === Storage.DEFAULT_ID);
  updateSummary();
});

$("btn-delete-list").addEventListener("click", () => {
  if (activeList.id === Storage.DEFAULT_ID) return;
  if (!confirm(`"${activeList.name}" verwijderen?`)) return;
  Storage.deleteList(activeList.id);
  goHome();
});

$("batch-size").addEventListener("change", (e) => {
  settings.batchSize = parseInt(e.target.value, 10);
  Storage.saveSettings(settings);
});

$("strict-accents").addEventListener("change", (e) => {
  settings.strictAccents = e.target.checked;
  Storage.saveSettings(settings);
});

$("btn-edit-words").addEventListener("click", openWordEditor);
$("btn-save-words").addEventListener("click", () => saveWordList(false));
$("btn-save-as-new").addEventListener("click", () => saveWordList(true));
$("btn-cancel-words").addEventListener("click", goHome);

$("btn-import").addEventListener("click", openImport);
$("btn-cancel-import").addEventListener("click", goHome);
$("btn-run-ocr").addEventListener("click", runOcr);
$("btn-save-import").addEventListener("click", saveImportedList);
$("btn-add-row").addEventListener("click", () => {
  importState.pairs.push(["", ""]);
  renderPairsTable();
});
$("btn-swap-cols").addEventListener("click", () => {
  importState.pairs = importState.pairs.map(([a, b]) => [b, a]);
  renderPairsTable();
});

$("dropzone").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", (e) => addFiles(e.target.files));
$("dropzone").addEventListener("dragover", (e) => {
  e.preventDefault();
  $("dropzone").classList.add("over");
});
$("dropzone").addEventListener("dragleave", () => $("dropzone").classList.remove("over"));
$("dropzone").addEventListener("drop", (e) => {
  e.preventDefault();
  $("dropzone").classList.remove("over");
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});
document.addEventListener("paste", (e) => {
  if ($("screen-import").classList.contains("hidden")) return;
  const files = Array.from(e.clipboardData.files || []);
  if (files.length) addFiles(files);
});

$("learn-input").addEventListener("input", onLearnKeystrokes);
$("drill-input").addEventListener("input", onDrillInput);

// Toetsen worden op documentniveau afgehandeld: zo werkt Enter ook wanneer het
// invoerveld even niet in beeld is (nakijkscherm) of de focus is weggeraakt.
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const onLearn = !$("screen-learn").classList.contains("hidden");
  const onDrill = !$("screen-drill").classList.contains("hidden");
  if (!onLearn && !onDrill) return;

  if (e.key === "Enter") {
    e.preventDefault();
    if (onLearn) onLearnEnter();
    else if (session && session.state !== "pause") onDrillEnter();
    return;
  }

  // Focus terughalen zodat een aanslag nooit verloren gaat.
  if (e.key.length === 1) {
    const input = $(onLearn ? "learn-input" : "drill-input");
    if (document.activeElement !== input) input.focus();
  }
});

$("screen-learn").addEventListener("click", () => $("learn-input").focus());
$("screen-drill").addEventListener("click", () => $("drill-input").focus());

// ---------- Volledig scherm ----------
// iPhone-Safari kent de Fullscreen API niet voor gewone elementen; daar is de
// app-installatie ("Zet op beginscherm") de weg naar een schermvullende app.
(function setupFullscreen() {
  const btn = $("btn-fullscreen");
  const root = document.documentElement;
  const supported = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  const standalone =
    matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  if (!supported || standalone) return; // knop blijft verborgen
  btn.classList.remove("hidden");

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function sync() {
    const on = isFullscreen();
    btn.textContent = on ? "⛶" : "⛶";
    btn.title = on ? "Volledig scherm verlaten" : "Volledig scherm";
    btn.setAttribute("aria-label", btn.title);
    btn.classList.toggle("active", on);
  }

  btn.addEventListener("click", () => {
    if (isFullscreen()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    }
  });

  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync);
  sync();
})();

buildAccentBars();
goHome();
