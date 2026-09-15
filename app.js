// ---------- Basis ----------
const $ = (id) => document.getElementById(id);

let settings = Storage.getSettings();
let stats = Storage.getStats();
let activeList = Storage.getList(Storage.activeId());

Sound.zetAan(settings.sound);

// Elk woord wordt één keer gevraagd. Wat je fout hebt of met hulp deed, gaat
// terug in de rij en komt later in de ronde opnieuw langs.
const CORRECT_NEEDED = 1;

// Een woord in een ronde is [frans, nederlands, richting]. Het Franse woord is
// altijd element 0 en dient als sleutel voor de voortgang, ongeacht de richting.
function keyOf(w) { return w[0]; }
function targetOf(w) { return w[2] === "fr-nl" ? w[1] : w[0]; } // wat je typt
function promptOf(w) { return w[2] === "fr-nl" ? w[0] : w[1]; } // wat je ziet
function typingFrench(w) { return w[2] !== "fr-nl"; }

function pickDirection() {
  if (settings.direction === "gemengd") return Math.random() < 0.5 ? "nl-fr" : "fr-nl";
  return settings.direction === "fr-nl" ? "fr-nl" : "nl-fr";
}

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

// Wat tussen haakjes staat ("le chien (m.)", "de auto (wagen)") is een
// verduidelijking. Je mag het meetypen, maar het hoeft niet.
function stripParens(s) {
  return String(s)
    .replace(/\s*[([{][^)\]}]*[)\]}]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// De vormen die als juist antwoord tellen: met en zonder de haakjes.
function acceptedForms(target) {
  const full = String(target);
  const bare = stripParens(full);
  return bare && bare !== full ? [full, bare] : [full];
}

function isMatch(typed, target) {
  const t = normalize(typed);
  return acceptedForms(target).some((form) => normalize(form) === t);
}

// Voor het nakijkscherm: vergelijk met de vorm die het dichtst bij het
// antwoord ligt, zodat niet-getypte haakjes niet als fouten oplichten.
function closestForm(attempt, target) {
  const forms = acceptedForms(target);
  if (forms.length === 1) return forms[0];
  const cost = (f) => alignWords(attempt, f).filter((o) => o.op !== "match").length;
  return cost(forms[1]) < cost(forms[0]) ? forms[1] : forms[0];
}

// Posities die bij een toelichting tussen haakjes horen.
function parenMask(chars) {
  const mask = new Array(chars.length).fill(false);
  let depth = 0;
  chars.forEach((ch, i) => {
    if (ch === "(" || ch === "[" || ch === "{") { depth++; mask[i] = true; return; }
    if (ch === ")" || ch === "]" || ch === "}") { if (depth > 0) { mask[i] = true; depth--; } return; }
    if (depth > 0) mask[i] = true;
  });
  return mask;
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
// caret is de plek van de cursor in letters geteld; zonder waarde staat hij
// achteraan. Zo loopt het streepje mee als je midden in een woord iets aanpast.
function renderTyped(el, typed, target, caret) {
  el.innerHTML = "";
  const chars = Array.from(typed);
  const t = target == null ? null : Array.from(target);
  const pos = caret == null ? chars.length : Math.max(0, Math.min(caret, chars.length));
  chars.forEach((ch, idx) => {
    if (idx === pos) el.appendChild(span("", "cursor"));
    let cls = "";
    if (t) cls = idx < t.length && eqChar(ch, t[idx]) ? "ok" : "err";
    el.appendChild(span(ch, cls));
  });
  if (pos >= chars.length) el.appendChild(span("", "cursor"));
}

// selectionStart telt in UTF-16-eenheden; de weergave telt in letters.
function caretIndex(input) {
  const pos = input.selectionStart;
  if (pos == null) return null;
  return Array.from(String(input.value).slice(0, pos)).length;
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

// mode: "ronde" = een greep woorden, leren en dan oefenen
//       "leren"  = de hele lijst, alleen de bubbels
//       "oefenen"= de hele lijst, meteen uit het hoofd
function startSession(mode) {
  const kind = mode || "ronde";
  if (!activeList.words.length) {
    alert("Deze lijst is leeg. Voeg eerst woorden toe.");
    return;
  }

  const chosen =
    kind === "ronde"
      ? pickBatch(Math.min(settings.batchSize, activeList.words.length))
      : shuffle(activeList.words);
  const batch = chosen.map(([fr, nl]) => [fr, nl, pickDirection()]);

  session = {
    mode: kind,
    batch,
    learnIndex: 0,
    results: {},
  };
  session.batch.forEach((w) => (session.results[keyOf(w)] = { errors: 0, hints: 0, helped: false }));

  Storage.clearSession();
  if (kind === "oefenen") startDrill();
  else startLearn();
}

function lastMode() {
  return (session && session.mode) || "ronde";
}

// ---------- Onderbroken ronde bewaren ----------
// De rij verwijst naar plekken in batch, zodat er niets dubbel opgeslagen wordt.
function storeSession() {
  if (!session) return;
  const phase = !$("screen-drill").classList.contains("hidden") || session.queue ? "drill" : "learn";
  Storage.saveSession({
    v: 1,
    listId: activeList.id,
    listLength: activeList.words.length,
    mode: session.mode,
    phase: session.queue ? "drill" : "learn",
    learnIndex: session.learnIndex,
    batch: session.batch,
    queue: session.queue ? session.queue.map((it) => ({ i: session.batch.indexOf(it.w), left: it.left })) : null,
    results: session.results,
    savedAt: Date.now(),
  });
}

function savedSession() {
  const saved = Storage.getSession();
  if (!saved) return null;
  const list = Storage.allLists().find((l) => l.id === saved.listId);
  // Is de lijst weg of gewijzigd, dan klopt de bewaarde ronde niet meer.
  if (!list || list.words.length !== saved.listLength) return null;
  return saved;
}

function resumeProgress(saved) {
  if (saved.phase === "drill" && saved.queue) {
    return saved.batch.length ? (saved.batch.length - saved.queue.length) / saved.batch.length : 0;
  }
  return saved.batch.length ? saved.learnIndex / saved.batch.length : 0;
}

function resumeSession() {
  const saved = savedSession();
  if (!saved) { updateResumeCard(); return; }

  Storage.setActiveId(saved.listId);
  activeList = Storage.getList(saved.listId);

  session = {
    mode: saved.mode,
    batch: saved.batch,
    learnIndex: saved.learnIndex,
    results: saved.results,
  };

  if (saved.phase === "drill" && saved.queue) {
    session.queue = saved.queue
      .filter((q) => q.i >= 0 && q.i < session.batch.length)
      .map((q) => ({ w: session.batch[q.i], left: q.left }));
    session.enterArmed = false;
    showScreen("screen-drill");
    nextDrillWord();
  } else {
    startLearn();
  }
}

function forgetSession() {
  Storage.clearSession();
  updateResumeCard();
}

function updateResumeCard() {
  const saved = savedSession();
  const card = $("resume-card");
  card.classList.toggle("hidden", !saved);
  if (!saved) return;
  const list = Storage.allLists().find((l) => l.id === saved.listId);
  const bezig = saved.phase === "drill" ? "oefenen" : "leren";
  $("resume-note").textContent = `${list ? list.name : "Woordenlijst"} · ${bezig}`;
  setProgress($("resume-progress"), resumeProgress(saved));
}

function bumpStat(fr, key) {
  const s = (stats[fr] = stats[fr] || { correct: 0, wrong: 0 });
  s[key]++;
  Storage.saveStats(stats);
}

// ================= LEERMODUS: letters achter bubbels =================
const learn = { chars: [], auto: [], slots: [], pos: 0, done: false };

function startLearn() {
  showScreen("screen-learn");
  showLearnWord();
}

function showLearnWord() {
  const w = session.batch[session.learnIndex];
  const fr = targetOf(w);
  $("learn-nl").textContent = promptOf(w);
  setProgress($("learn-progress"), session.learnIndex / session.batch.length);
  $("learn-hint").textContent = "Typ de letters — weet je het niet? Druk op Enter voor één letter.";

  learn.chars = Array.from(fr);
  const inParens = parenMask(learn.chars);
  // Geen bubbel voor leestekens en voor alles wat tussen haakjes staat.
  learn.auto = learn.chars.map((ch, i) => !isLetter(ch) || inParens[i]);
  learn.pos = 0;
  learn.done = false;
  learn.slots = buildBubbles($("learn-bubbles"), learn.chars, learn.auto);
  storeSession();

  skipAutoChars();
  markCurrent();
  updateAccentBar();

  const input = $("learn-input");
  input.value = "";
  input.focus();
}

// Past de bubbelgrootte aan de woordlengte aan, zodat een lang woord op één
// rij blijft in plaats van af te breken.
const BUBBLE_GAP = 7;
function sizeBubbles(container, count) {
  const available = container.clientWidth || 340;
  const fitting = Math.floor((available - (count - 1) * BUBBLE_GAP) / Math.max(count, 1));
  const size = Math.max(26, Math.min(46, fitting));
  container.style.setProperty("--slot", size + "px");
}

function buildBubbles(container, chars, auto) {
  container.innerHTML = "";
  sizeBubbles(container, chars.length);
  const slots = [];
  chars.forEach((ch, idx) => {
    const slot = document.createElement("span");
    slot.className = "slot";
    slot.style.setProperty("--i", idx);
    slot.appendChild(span(ch === " " ? " " : ch, "letter"));
    if (!auto[idx]) {
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
  while (learn.pos < learn.chars.length && learn.auto[learn.pos]) learn.pos++;
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
  const toon = learn.chars.slice(0, learn.pos).filter((c, i) => !learn.auto[i]).length;
  if (hinted) Sound.hint(toon);
  else Sound.pop(toon);
  popBubble(learn.pos, hinted);
  learn.pos++;
  skipAutoChars();
  markCurrent();
  if (learn.pos >= learn.chars.length) finishLearnWord();
}

function finishLearnWord() {
  learn.done = true;
  Sound.juist();
  learn.slots.forEach((s) => s.classList.remove("current"));
  $("learn-bubbles").classList.add("complete");
  $("learn-hint").textContent = "Juist";
  setTimeout(() => {
    $("learn-bubbles").classList.remove("complete");
    learn.slots.forEach((slot) => {
      const letter = slot.querySelector(".letter");
      if (letter) letter.style.willChange = "";
    });
    session.learnIndex++;
    if (session.learnIndex < session.batch.length) showLearnWord();
    else if (session.mode === "leren") finishSession();
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
      Sound.mis();
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
  session.results[keyOf(session.batch[session.learnIndex])].hints++;
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

// Zet een balk op een deel tussen 0 en 1.
function setProgress(el, fraction) {
  const pct = Math.max(0, Math.min(1, fraction || 0)) * 100;
  el.querySelector(".progress-fill").style.width = pct + "%";
  el.setAttribute("aria-valuenow", Math.round(pct));
}

// Woorden die de rij uit zijn, gedeeld door het totaal.
function drillProgress() {
  const total = session.batch.length;
  return total ? (total - session.queue.length) / total : 0;
}

function nextDrillWord() {
  if (!session.queue.length) {
    finishSession();
    return;
  }
  $("drill-nl").textContent = promptOf(currentDrill().w);
  storeSession();
  setProgress($("drill-progress"), drillProgress());
  setDrillState(ANSWER);
}

function setDrillState(state, attempt) {
  session.state = state;
  session.enterArmed = false;
  const fr = targetOf(currentDrill().w);
  updateAccentBar();
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
    const taal = typingFrench(currentDrill().w) ? "Franse" : "Nederlandse";
    $("drill-hint").textContent = `Typ de ${taal} vertaling · weet je het niet? 2× Enter`;
  } else if (state === COPY) {
    stageEl.className = "stage-tag is-copy";
    stageEl.textContent = "overtypen";
    revealEl.textContent = fr;
    revealEl.classList.remove("hidden");
    renderTyped(typedEl, "", fr);
    $("drill-hint").textContent = "Typ het woord hieronder over";
  } else if (state === RECALL) {
    stageEl.className = "stage-tag is-recall";
    stageEl.textContent = "uit het hoofd";
    renderTyped(typedEl, "", null);
    $("drill-hint").textContent = "En nu nog eens, zonder te kijken";
  } else if (state === REVIEW) {
    stageEl.className = "stage-tag is-review";
    stageEl.textContent = "nakijken";
    $("drill-type-area").classList.add("hidden");
    reviewEl.classList.remove("hidden");
    const vorm = closestForm(attempt || "", fr);
    const ops = alignWords(attempt || "", vorm);
    renderDiff(ops);
    renderNotes(ops, attempt || "");
    $("drill-hint").textContent = "Enter om verder te gaan";
  }
  input.focus();
}

// Zet de verschillen om in gewone taal, zodat je niet alleen kleuren ziet
// maar ook leest wat er precies misging.
function describeOps(ops) {
  const zichtbaar = (t) => (t.trim() === "" ? "een spatie" : `"${t}"`);
  const notes = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].op === "match") { i++; continue; }
    let j = i;
    while (j < ops.length && ops[j].op === ops[i].op) j++;
    const groep = ops.slice(i, j);

    if (ops[i].op === "sub") {
      const jij = groep.map((o) => o.ch).join("");
      const juist = groep.map((o) => o.expected).join("");
      const zelfdeLetter = groep.every((o) => foldChar(o.ch) === foldChar(o.expected));
      notes.push(
        zelfdeLetter
          ? `het accent klopt niet: ${zichtbaar(juist)} in plaats van ${zichtbaar(jij)}`
          : `${zichtbaar(jij)} moet ${zichtbaar(juist)} zijn`
      );
    } else if (ops[i].op === "ins") {
      notes.push(`${zichtbaar(groep.map((o) => o.ch).join(""))} hoort er niet bij`);
    } else {
      notes.push(`${zichtbaar(groep.map((o) => o.expected).join(""))} ontbreekt`);
    }
    i = j;
  }
  return notes;
}

function renderNotes(ops, attempt) {
  const el = $("review-notes");
  el.innerHTML = "";
  const notes = attempt.trim() === "" ? ["je hebt niets getypt"] : describeOps(ops);
  notes.slice(0, 4).forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    el.appendChild(li);
  });
  if (notes.length > 4) {
    const li = document.createElement("li");
    li.textContent = `en nog ${notes.length - 4} verschil${notes.length - 4 === 1 ? "" : "len"}`;
    el.appendChild(li);
  }
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
  if (!session || !session.queue || !session.queue.length) return;
  const input = $("drill-input");
  const fr = targetOf(currentDrill().w);
  const value = input.value;
  if (value) session.enterArmed = false;
  // Alleen bij overtypen mag je meekijken of elke letter klopt.
  renderTyped($("drill-typed"), value, session.state === COPY ? fr : null, caretIndex(input));
}

function onDrillEnter() {
  const item = currentDrill();
  const fr = targetOf(item.w);
  const key = keyOf(item.w);
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
      bumpStat(key, "correct");
      item.left--;
      if (item.left <= 0) session.queue.shift();
      else session.queue.push(session.queue.shift());
    } else {
      // Uit het hoofd gelukt na hulp: telt niet als schone beurt, wel als vooruitgang.
      bumpStat(key, "correct");
      item.left = CORRECT_NEEDED;
      session.queue.push(session.queue.shift());
    }
    flashCorrect(fr);
    return;
  }

  // Fout antwoord
  Sound.fout();
  bumpStat(key, "wrong");
  session.results[key].errors++;
  session.results[key].helped = true;
  item.left = CORRECT_NEEDED;
  setDrillState(REVIEW, typed);
}

function giveUp(item) {
  Sound.fout();
  const key = keyOf(item.w);
  bumpStat(key, "wrong");
  session.results[key].hints++;
  session.results[key].helped = true;
  item.left = CORRECT_NEEDED;
  setDrillState(COPY);
}

function flashCorrect(fr) {
  Sound.juist();
  const typedEl = $("drill-typed");
  typedEl.innerHTML = "";
  const ok = span("", "flash-ok");
  ok.appendChild(svgIcon("i-check", 20));
  ok.append(" " + fr);
  typedEl.appendChild(ok);
  $("drill-hint").textContent = "";
  $("drill-stage").className = "stage-tag hidden";
  $("drill-reveal").classList.add("hidden");
  setProgress($("drill-progress"), drillProgress());
  session.state = "pause";
  setTimeout(nextDrillWord, 550);
}

// De accentknoppen helpen alleen bij het typen van Frans; bij Frans -> Nederlands
// zijn ze overbodig. De instelling kan ze ook helemaal uitzetten.
function updateAccentBar() {
  const showLearn = settings.showAccents && session && session.batch.length
    ? typingFrench(session.batch[Math.min(session.learnIndex, session.batch.length - 1)])
    : settings.showAccents;
  const showDrill = settings.showAccents && session && session.queue && session.queue.length
    ? typingFrench(currentDrill().w)
    : settings.showAccents;
  document.querySelector('#screen-learn .accents').classList.toggle("hidden", !showLearn);
  document.querySelector('#screen-drill .accents').classList.toggle("hidden", !showDrill);
}

// ---------- Resultaat ----------
function finishSession() {
  Storage.clearSession();
  Sound.klaar();
  showScreen("screen-done");
  const totalErrors = Object.values(session.results).reduce((s, r) => s + r.errors, 0);
  const helped = Object.values(session.results).filter((r) => r.helped).length;
  const hints = Object.values(session.results).reduce((s, r) => s + r.hints, 0);

  if (session.mode === "leren") {
    $("done-stats").textContent =
      hints === 0
        ? `${session.batch.length} woorden doorlopen zonder één letter cadeau.`
        : `${session.batch.length} woorden doorlopen, ${hints} letter${hints === 1 ? "" : "s"} weggegeven.`;
  } else {
    $("done-stats").textContent =
      totalErrors === 0 && helped === 0
        ? "Foutloos, alles in één keer uit het hoofd."
        : `${totalErrors} fout${totalErrors === 1 ? "" : "en"}, ${helped} woord${helped === 1 ? "" : "en"} met hulp.`;
  }

  const list = $("done-words");
  list.innerHTML = "";
  session.batch.forEach(([fr, nl]) => {
    const r = session.results[fr];
    const li = document.createElement("li");
    li.append(span(`${fr} — ${nl}`, ""));

    if (session.mode === "leren") {
      li.append(r.hints === 0 ? goodMark("zelf getypt") : span(`${r.hints} letter${r.hints === 1 ? "" : "s"} hulp`, "score-bad"));
    } else {
      const clean = r.errors === 0 && !r.helped;
      li.append(clean ? goodMark("foutloos") : span(`${r.errors}× fout`, "score-bad"));
    }
    list.appendChild(li);
  });
  updateSummary();
}

// Vinkje als icoon in plaats van een emoji.
function goodMark(text) {
  const el = span("", "score-good");
  el.appendChild(svgIcon("i-check", 13));
  el.append(text);
  return el;
}

function svgIcon(name, size) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#" + name);
  svg.appendChild(use);
  return svg;
}

function updateSummary() {
  const total = activeList.words.length;
  const known = activeList.words.filter(([fr]) => (stats[fr] || {}).correct >= CORRECT_NEEDED).length;
  setProgress($("progress-summary"), total ? known / total : 0);
  const note = `${total} woord${total === 1 ? "" : "en"}`;
  $("learn-all-note").textContent = note;
  $("drill-all-note").textContent = note;
}

// ---------- Welke kolom is het Frans? ----------
// Dezelfde scores als bij het inlezen van screenshots, zodat een zelfgetypte
// lijst met het Nederlands vooraan toch goed komt te staan.
function frenchIsFirst(words) {
  let asIs = 0;
  let swapped = 0;
  for (const [a, b] of words) {
    asIs += OCR.frenchScore(a) + OCR.dutchScore(b);
    swapped += OCR.frenchScore(b) + OCR.dutchScore(a);
  }
  return swapped <= asIs;
}

function orientWords(words) {
  return frenchIsFirst(words) ? words : words.map(([a, b]) => [b, a]);
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
  $("direction").value = settings.direction;
  $("sound-on").checked = settings.sound;
  showScreen("screen-start");
  updateSummary();
  updateResumeCard();
}

// ---------- Woordenlijst bewerken ----------
function openNewListEditor() {
  $("list-name-input").value = "";
  $("list-name-input").placeholder = "Naam van je nieuwe lijst";
  $("words-input").value = "";
  $("btn-save-words").classList.add("hidden"); // een nieuwe lijst wordt altijd nieuw opgeslagen
  updateEditorCount();
  showScreen("screen-words");
  $("words-input").focus();
}

function openWordEditor() {
  $("list-name-input").value = activeList.id === Storage.DEFAULT_ID ? "" : activeList.name;
  $("list-name-input").placeholder = activeList.id === Storage.DEFAULT_ID ? "Naam voor je eigen kopie" : "Naam van de lijst";
  $("words-input").value = activeList.words.map(([fr, nl]) => `${fr} = ${nl}`).join("\n");
  $("btn-save-words").classList.toggle("hidden", activeList.id === Storage.DEFAULT_ID);
  updateEditorCount();
  showScreen("screen-words");
}

// Laat meteen zien hoeveel woordparen er herkend worden terwijl je typt.
function updateEditorCount() {
  const { pairs, bad } = parseEditorText();
  const el = $("editor-count");
  if (!pairs.length && !bad.length) {
    el.textContent = "";
    return;
  }
  let text = `${pairs.length} woordpaar${pairs.length === 1 ? "" : "en"} herkend`;
  if (pairs.length >= 2) text += frenchIsFirst(pairs) ? " · Frans staat links" : " · Frans staat rechts, wordt bij het opslaan omgedraaid";
  if (bad.length) text += ` · ${bad.length} regel${bad.length === 1 ? "" : "s"} zonder "=": ${bad.slice(0, 3).map((l) => `"${l}"`).join(", ")}`;
  el.textContent = text;
  el.classList.toggle("warn", bad.length > 0);
}

// "frans = nederlands" is de bedoelde vorm; een tab of puntkomma nemen we ook
// aan, zodat geplakte tekst uit een spreadsheet meteen werkt.
function parseEditorText() {
  const pairs = [];
  const bad = [];
  for (const raw of $("words-input").value.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let fr = "";
    let nl = "";
    const idx = line.indexOf("=");
    if (idx >= 0) {
      fr = line.slice(0, idx).trim();
      nl = line.slice(idx + 1).trim();
    } else {
      const parts = line.split(/\t+|\s*;\s*/);
      if (parts.length >= 2) {
        fr = parts[0].trim();
        nl = parts.slice(1).join(" ").trim();
      }
    }
    if (fr && nl) pairs.push([fr, nl]);
    else bad.push(line);
  }
  return { pairs, bad };
}

function saveWordList(asNew) {
  const { pairs: words, bad } = parseEditorText();
  if (!words.length) {
    alert("Geen geldige regels gevonden. Zet een = tussen het Franse en het Nederlandse woord, bijvoorbeeld:\n\nle chien = de hond");
    return;
  }
  if (bad.length && !confirm(`${bad.length} regel(s) hebben geen "=" en worden overgeslagen:\n\n${bad.slice(0, 5).join("\n")}\n\nToch opslaan met ${words.length} woordpaar(en)?`)) {
    return;
  }
  const name = $("list-name-input").value.trim() || "Mijn lijst";
  Storage.saveList({ id: asNew ? null : activeList.id, name, words: orientWords(words) });
  goHome();
}

// ================= SCREENSHOTS IMPORTEREN =================
const importState = { files: [], rotations: [], pairs: [], raw: "", unparsed: [], sentences: [] };

function openImport() {
  importState.files = [];
  importState.rotations = [];
  importState.pairs = [];
  importState.raw = "";
  importState.unparsed = [];
  importState.sentences = [];
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
  importState.rotations = importState.rotations.concat(images.map(() => 0));
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
    const hoek = importState.rotations[idx] || 0;
    if (hoek) img.style.transform = `rotate(${hoek}deg)`;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "thumb-btn thumb-del";
    del.title = "Verwijderen";
    del.setAttribute("aria-label", "Screenshot verwijderen");
    del.appendChild(svgIcon("i-trash", 14));
    del.addEventListener("click", () => {
      importState.files.splice(idx, 1);
      importState.rotations.splice(idx, 1);
      renderThumbs();
      $("btn-run-ocr").disabled = importState.files.length === 0;
    });

    // Staat een foto op zijn kant, dan kun je hem hier rechtzetten.
    const draai = document.createElement("button");
    draai.type = "button";
    draai.className = "thumb-btn thumb-rot";
    draai.title = "Een kwartslag draaien";
    draai.setAttribute("aria-label", "Een kwartslag draaien");
    draai.appendChild(svgIcon("i-rotate", 14));
    draai.addEventListener("click", () => {
      importState.rotations[idx] = ((importState.rotations[idx] || 0) + 90) % 360;
      renderThumbs();
    });

    wrap.append(img, draai, del);
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
    const result = await OCR.recognizeFiles(importState.files, setProgress, importState.rotations);
    importState.raw = result.text;
    const { pairs, unparsed, sentences } = OCR.parseDocument(result);
    importState.pairs = pairs;
    importState.unparsed = unparsed;
    importState.sentences = sentences || [];
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
  const onzeker = importState.pairs.filter((p) => p[2]).length;
  $("import-count").textContent =
    `${importState.pairs.length} woordparen gevonden in ${importState.files.length} screenshot${importState.files.length === 1 ? "" : "s"}` +
    (onzeker ? ` · ${onzeker} onzeker gelezen, even nakijken` : "");
  $("raw-text").textContent = importState.raw || "(geen tekst gevonden)";

  const sentenceBox = $("sentence-details");
  sentenceBox.classList.toggle("hidden", importState.sentences.length === 0);
  $("sentence-count").textContent = String(importState.sentences.length);
  const sentenceList = $("sentence-list");
  sentenceList.innerHTML = "";
  importState.sentences.forEach(([a, b]) => {
    const row = document.createElement("div");
    row.className = "pair-row sentence-row";
    row.append(span(a, ""), span(b || "", "muted"));
    sentenceList.appendChild(row);
  });

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

    // Derde element staat op waar de OCR onzeker was; dat markeren we.
    if (pair[2]) row.classList.add("onzeker");

    const fr = document.createElement("input");
    fr.type = "text";
    fr.value = pair[0];
    if (pair[2]) fr.title = "Onzeker gelezen, even nakijken";
    fr.addEventListener("input", () => (importState.pairs[idx][0] = fr.value));

    const nl = document.createElement("input");
    nl.type = "text";
    nl.value = pair[1];
    if (pair[2]) nl.title = "Onzeker gelezen, even nakijken";
    nl.addEventListener("input", () => (importState.pairs[idx][1] = nl.value));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "icon-btn danger";
    del.title = "Rij verwijderen";
    del.appendChild(svgIcon("i-trash", 16));
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

// ---------- Instellingenmenu tijdens het oefenen ----------
function openSheet() {
  $("sheet-direction").value = settings.direction;
  $("sheet-strict").checked = settings.strictAccents;
  $("sheet-accentbar").checked = settings.showAccents;
  $("sheet-sound").checked = settings.sound;
  $("sheet-backdrop").classList.remove("hidden");
  $("sheet-close").focus();
}

function closeSheet() {
  $("sheet-backdrop").classList.add("hidden");
  const input = !$("screen-learn").classList.contains("hidden") ? $("learn-input")
    : !$("screen-drill").classList.contains("hidden") ? $("drill-input")
    : null;
  if (input) input.focus();
}

// Een gewijzigde richting geldt meteen voor de rest van de ronde.
function applyDirectionToSession() {
  if (!session) return;
  session.batch.forEach((w) => { w[2] = pickDirection(); });
  if (!$("screen-learn").classList.contains("hidden")) {
    showLearnWord();
  } else if (!$("screen-drill").classList.contains("hidden") && session.queue && session.queue.length) {
    nextDrillWord();
  }
}

function backToStart() {
  closeSheet();
  session = null;
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
$("btn-start").addEventListener("click", () => startSession("ronde"));
$("btn-learn-all").addEventListener("click", () => startSession("leren"));
$("btn-drill-all").addEventListener("click", () => startSession("oefenen"));
$("btn-again").addEventListener("click", () => startSession(lastMode()));
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

document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", backToStart));
document.querySelectorAll("[data-settings]").forEach((b) => b.addEventListener("click", openSheet));

$("sheet-close").addEventListener("click", closeSheet);
$("sheet-backdrop").addEventListener("click", (e) => { if (e.target === $("sheet-backdrop")) closeSheet(); });
$("sheet-home").addEventListener("click", backToStart);
$("sheet-restart").addEventListener("click", () => { closeSheet(); startSession(lastMode()); });

$("sheet-direction").addEventListener("change", (e) => {
  settings.direction = e.target.value;
  Storage.saveSettings(settings);
  $("direction").value = settings.direction;
  $("sound-on").checked = settings.sound;
  applyDirectionToSession();
});
$("sheet-strict").addEventListener("change", (e) => {
  settings.strictAccents = e.target.checked;
  Storage.saveSettings(settings);
  $("strict-accents").checked = e.target.checked;
});
function setSound(on) {
  settings.sound = on;
  Storage.saveSettings(settings);
  Sound.zetAan(on);
  $("sound-on").checked = on;
  $("sheet-sound").checked = on;
  if (on) Sound.pop(2); // even laten horen
}
$("sound-on").addEventListener("change", (e) => setSound(e.target.checked));
$("sheet-sound").addEventListener("change", (e) => setSound(e.target.checked));

$("sheet-accentbar").addEventListener("change", (e) => {
  settings.showAccents = e.target.checked;
  Storage.saveSettings(settings);
  updateAccentBar();
});

$("direction").addEventListener("change", (e) => {
  settings.direction = e.target.value;
  Storage.saveSettings(settings);
});

$("btn-resume").addEventListener("click", resumeSession);
$("btn-discard-resume").addEventListener("click", forgetSession);

$("btn-edit-words").addEventListener("click", openWordEditor);
$("btn-new-list").addEventListener("click", openNewListEditor);
$("words-input").addEventListener("input", updateEditorCount);
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
$("btn-add-sentences").addEventListener("click", () => {
  const bruikbaar = importState.sentences.filter(([a, b]) => a && b);
  if (!bruikbaar.length) {
    alert("Deze zinnen staan zonder vertaling in het screenshot, dus er valt geen woordpaar van te maken.");
    return;
  }
  importState.pairs = importState.pairs.concat(bruikbaar);
  importState.sentences = [];
  renderImportResult();
});
$("btn-swap-cols").addEventListener("click", () => {
  importState.pairs = importState.pairs.map((p) => (p[2] ? [p[1], p[0], p[2]] : [p[1], p[0]]));
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
["keyup", "click", "select", "focus"].forEach((ev) => $("drill-input").addEventListener(ev, onDrillInput));
document.addEventListener("selectionchange", () => {
  if (document.activeElement === $("drill-input")) onDrillInput();
});

// Toetsen worden op documentniveau afgehandeld: zo werkt Enter ook wanneer het
// invoerveld even niet in beeld is (nakijkscherm) of de focus is weggeraakt.
document.addEventListener("keydown", (e) => {
  if (!$("sheet-backdrop").classList.contains("hidden")) {
    if (e.key === "Escape") { e.preventDefault(); closeSheet(); }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Escape") {
    const bezig = !$("screen-learn").classList.contains("hidden") || !$("screen-drill").classList.contains("hidden");
    if (bezig) { e.preventDefault(); backToStart(); return; }
  }
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

  const sheetBtn = $("sheet-fullscreen");
  if (!supported || standalone) return; // rijen blijven verborgen
  btn.classList.remove("hidden");
  sheetBtn.classList.remove("hidden");

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function sync() {
    const on = isFullscreen();
    const label = on ? "Volledig scherm verlaten" : "Volledig scherm";
    btn.title = label;
    btn.querySelector(".row-label").textContent = label;
    sheetBtn.querySelector(".row-label").textContent = label;
  }

  function toggle() {
    if (isFullscreen()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    }
  }
  btn.addEventListener("click", toggle);
  sheetBtn.addEventListener("click", toggle);

  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync);
  sync();
})();

addEventListener("resize", () => {
  if (learn.chars.length && !$("screen-learn").classList.contains("hidden")) {
    sizeBubbles($("learn-bubbles"), learn.chars.length);
  }
});

buildAccentBars();
goHome();
