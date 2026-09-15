// Screenshots van woordenlijsten inlezen: OCR (Tesseract, lokaal meegeleverd)
// en het herkennen van frans/nederlands-paren.
//
// Belangrijk: Tesseract levert een lijst in twee kolommen vaak als twee losse
// tekstblokken op (eerst alle Franse woorden, dan alle Nederlandse). Daarom
// werken we niet met de platte tekst maar met de posities van elk woord: op die
// manier herkennen we welke woorden op dezelfde regel staan en waar de
// kolomscheiding zit.
const OCR = (() => {
  // Absoluut maken: de worker draait vanuit een blob-URL, waar relatieve paden niet kloppen.
  const VENDOR = new URL("vendor/tesseract/", document.baseURI).href;
  let tesseractLoaded = null;

  // ---------- Library lazy laden ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Kon " + src + " niet laden"));
      document.head.appendChild(s);
    });
  }

  function ensureTesseract() {
    if (!tesseractLoaded) {
      tesseractLoaded = loadScript(VENDOR + "tesseract.min.js").then(() => {
        if (typeof Tesseract === "undefined") throw new Error("Tesseract niet beschikbaar");
        return Tesseract;
      });
    }
    return tesseractLoaded;
  }

  // ---------- Beeld voorbereiden ----------
  const MIN_BREEDTE = 1000;  // hieronder opschalen
  const DOEL_BREEDTE = 1400; // waar naartoe opgeschaald wordt
  const MAX_ZIJDE = 2400;    // grote fotos verkleinen: sneller en scheelt geheugen

  function laadAfbeelding(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        const naam = file.name || "dit bestand";
        const heic = /\.(heic|heif)$/i.test(naam);
        reject(new Error(
          heic
            ? `${naam} is een HEIC-bestand; browsers kunnen dat niet openen. Bewaar of deel het als JPEG of PNG.`
            : `${naam} kon de browser niet openen als afbeelding.`
        ));
      };
      img.src = url;
    });
  }

  // Verschil tussen de lichtste en donkerste beeldhoek. Bij een foto van een
  // boekpagina is dat groot; bij een screenshot vrijwel nul.
  function lichtSpreiding(grijs, w, h, blokken) {
    const bw = Math.max(1, Math.floor(w / blokken));
    const bh = Math.max(1, Math.floor(h / blokken));
    let laagste = Infinity;
    let hoogste = -Infinity;
    for (let by = 0; by + bh <= h; by += bh) {
      for (let bx = 0; bx + bw <= w; bx += bw) {
        let som = 0;
        let n = 0;
        for (let y = by; y < by + bh; y += 2) {
          for (let x = bx; x < bx + bw; x += 2) {
            som += grijs[y * w + x];
            n++;
          }
        }
        if (!n) continue;
        const gem = som / n;
        if (gem < laagste) laagste = gem;
        if (gem > hoogste) hoogste = gem;
      }
    }
    return hoogste > laagste ? hoogste - laagste : 0;
  }

  // Plaatselijke drempel via een somtabel: bij een foto van een boekpagina is de
  // ene hoek lichter dan de andere, en dan faalt één vaste drempel.
  function plaatselijkeDrempel(grijs, w, h) {
    const som = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let rij = 0;
      for (let x = 0; x < w; x++) {
        rij += grijs[y * w + x];
        som[(y + 1) * (w + 1) + (x + 1)] = som[y * (w + 1) + (x + 1)] + rij;
      }
    }
    const r = Math.max(8, Math.round(Math.min(w, h) * 0.06)); // venster rond elke pixel
    const uit = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r);
        const x1 = Math.min(w - 1, x + r);
        const oppervlak = (y1 - y0 + 1) * (x1 - x0 + 1);
        const totaal =
          som[(y1 + 1) * (w + 1) + (x1 + 1)] - som[y0 * (w + 1) + (x1 + 1)] -
          som[(y1 + 1) * (w + 1) + x0] + som[y0 * (w + 1) + x0];
        const gemiddelde = totaal / oppervlak;
        // Iets onder het plaatselijke gemiddelde telt als inkt.
        uit[y * w + x] = grijs[y * w + x] < gemiddelde - 8 ? 0 : 255;
      }
    }
    return uit;
  }

  // Zet een bestand om naar een canvas dat OCR goed kan lezen.
  async function fileToCanvas(file, draaiing) {
    const img = await laadAfbeelding(file);

    let bw = img.naturalWidth;
    let bh = img.naturalHeight;
    let schaal = 1;
    if (bw < MIN_BREEDTE) schaal = Math.min(3, DOEL_BREEDTE / Math.max(bw, 1));
    const langsteZijde = Math.max(bw, bh) * schaal;
    if (langsteZijde > MAX_ZIJDE) schaal *= MAX_ZIJDE / langsteZijde;

    const w = Math.round(bw * schaal);
    const h = Math.round(bh * schaal);
    const kwart = ((draaiing || 0) % 360 + 360) % 360;
    const gedraaid = kwart === 90 || kwart === 270;

    const canvas = document.createElement("canvas");
    canvas.width = gedraaid ? h : w;
    canvas.height = gedraaid ? w : h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((kwart * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();

    const cw = canvas.width;
    const ch = canvas.height;
    try {
      const data = ctx.getImageData(0, 0, cw, ch);
      const px = data.data;

      // Grijswaarden, en meteen kijken of het beeld donker is (donkere modus).
      const grijs = new Uint8ClampedArray(cw * ch);
      let totaal = 0;
      for (let i = 0, j = 0; i < px.length; i += 4, j++) {
        const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        grijs[j] = g;
        totaal += g;
      }
      const gemiddeld = totaal / (cw * ch);
      if (gemiddeld < 110) for (let j = 0; j < grijs.length; j++) grijs[j] = 255 - grijs[j];

      // Ongelijk licht? Dan een plaatselijke drempel, anders gewoon contrast.
      const spreiding = lichtSpreiding(grijs, cw, ch, 8);
      const resultaat = spreiding > 55 ? plaatselijkeDrempel(grijs, cw, ch) : null;
      for (let j = 0; j < grijs.length; j++) {
        const v = resultaat ? resultaat[j] : Math.max(0, Math.min(255, (grijs[j] - 128) * 1.35 + 128));
        const i = j * 4;
        px[i] = px[i + 1] = px[i + 2] = v;
        px[i + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
    } catch (e) {
      // Lukt niet bij sommige kleurprofielen; dan het onbewerkte beeld gebruiken.
    }
    return canvas;
  }

  // ---------- OCR draaien ----------
  function extractWords(data) {
    const words = [];
    for (const block of data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          for (const w of line.words || []) {
            const text = (w.text || "").trim();
            const b = w.bbox;
            if (!text || !b) continue;
            words.push({ text, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, conf: w.confidence == null ? 100 : w.confidence });
          }
        }
      }
    }
    return words;
  }

  async function recognizeFiles(files, onProgress, rotaties) {
    const T = await ensureTesseract();
    onProgress(0.02, "Taalbestanden laden (eenmalig)…");

    const worker = await T.createWorker(["fra", "nld"], 1, {
      workerPath: VENDOR + "worker.min.js",
      corePath: VENDOR,
      langPath: VENDOR + "lang",
      gzip: true,
      logger: (m) => {
        if (m.status === "recognizing text") return;
        if (m.status && m.progress != null) onProgress(0.02 + m.progress * 0.15, "Taalbestanden laden (eenmalig)…");
      },
    });

    try {
      const pages = [];
      const texts = [];
      for (let i = 0; i < files.length; i++) {
        const deel = (stap) => 0.2 + ((i + stap) / files.length) * 0.75;
        onProgress(deel(0), `Screenshot ${i + 1} van ${files.length} klaarmaken…`);
        const canvas = await fileToCanvas(files[i], rotaties ? rotaties[i] : 0);
        onProgress(deel(0.35), `Screenshot ${i + 1} van ${files.length} lezen…`);
        // rotateAuto zet een scheef gefotografeerde pagina recht.
        const { data } = await worker.recognize(canvas, { rotateAuto: true });
        texts.push(data.text || "");
        pages.push({ words: extractWords(data), width: canvas.width });
      }
      onProgress(1, "Klaar");
      return { text: texts.join("\n"), pages };
    } finally {
      await worker.terminate();
    }
  }

  // ---------- Woorden groeperen tot regels ----------
  function median(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  function groupIntoLines(words) {
    if (!words.length) return [];
    const tolerance = Math.max(4, median(words.map((w) => w.y1 - w.y0)) * 0.6);
    const byY = words.slice().sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);

    const lines = [];
    let current = null;
    for (const w of byY) {
      const center = (w.y0 + w.y1) / 2;
      if (current && Math.abs(center - current.center) <= tolerance) {
        current.words.push(w);
        current.center = current.words.reduce((s, x) => s + (x.y0 + x.y1) / 2, 0) / current.words.length;
      } else {
        current = { center, words: [w] };
        lines.push(current);
      }
    }
    lines.forEach((l) => l.words.sort((a, b) => a.x0 - b.x0));
    return lines;
  }

  // De kolomscheiding is de x waar op veel regels een opvallend groot gat zit.
  //
  // De drempel wordt afgeleid van de lettergrootte, niet van de gemiddelde
  // gatbreedte: bij een lijst met één woord per cel ("manger — eten") zijn de
  // helft van alle gaten juist kolomgaten, waardoor een gemiddelde de drempel
  // onbruikbaar hoog legt. Een spatie is altijd een fractie van de regelhoogte;
  // een kolomscheiding is minstens zo breed als een regel hoog is.
  function columnThreshold(pageWidth, wordHeight) {
    return Math.max(wordHeight * 1.2, pageWidth * 0.025, 10);
  }

  function detectColumnSplit(lines, pageWidth, wordHeight) {
    const threshold = columnThreshold(pageWidth, wordHeight);

    const mids = [];
    let multiWordLines = 0;
    for (const line of lines) {
      if (line.words.length < 2) continue;
      multiWordLines++;
      let widest = 0;
      let mid = null;
      for (let i = 0; i < line.words.length - 1; i++) {
        const gap = line.words[i + 1].x0 - line.words[i].x1;
        if (gap > widest) {
          widest = gap;
          mid = (line.words[i].x1 + line.words[i + 1].x0) / 2;
        }
      }
      if (widest >= threshold && mid != null) mids.push(mid);
    }

    // Alleen vertrouwen als het op de meeste regels terugkomt...
    if (mids.length < 2 || mids.length < multiWordLines * 0.5) return null;

    // ...en als die scheidingen ook rond dezelfde x liggen.
    const centre = median(mids);
    const tolerance = pageWidth * 0.12;
    const agreeing = mids.filter((m) => Math.abs(m - centre) <= tolerance);
    if (agreeing.length < mids.length * 0.7) return null;
    return median(agreeing);
  }

  // Splitst een regel op de kolomgrens, maar alleen als er op die plek ook
  // echt een gat zit. Een zin die over beide kolommen doorloopt heeft dat niet
  // en wordt dus niet in tweeën geknipt.
  function splitAtColumn(line, colX, threshold) {
    const words = line.words;
    let best = null;
    for (let i = 0; i < words.length - 1; i++) {
      const gap = words[i + 1].x0 - words[i].x1;
      if (gap < threshold) continue;
      if (words[i].x1 > colX || words[i + 1].x0 < colX) continue; // gat ligt niet op de grens
      const distance = Math.abs((words[i].x1 + words[i + 1].x0) / 2 - colX);
      if (!best || distance < best.distance) best = { i, distance };
    }
    if (!best) return null;
    const links = words.slice(0, best.i + 1);
    const rechts = words.slice(best.i + 1);
    return [joinWords(links), joinWords(rechts), Math.min(laagsteZekerheid(links), laagsteZekerheid(rechts))];
  }

  // Laagste zekerheid van een groepje woorden; onder de 70 is het twijfelachtig.
  function laagsteZekerheid(words) {
    return words.reduce((laag, w) => Math.min(laag, w.conf == null ? 100 : w.conf), 100);
  }

  function joinWords(words) {
    let out = "";
    words.forEach((w, i) => {
      if (i > 0) {
        const prev = words[i - 1].text;
        const tight = /['’]$/.test(prev) || /^['’]/.test(w.text);
        if (!tight) out += " ";
      }
      out += w.text;
    });
    return out;
  }

  // ---------- Tekst omzetten naar woordparen ----------
  const SEPARATORS = [
    /\s*=\s*/,
    /\s*[:：]\s*/,
    /\s*\|\s*/,
    /\t+/,
    /\s+[–—]\s+/,
    /\s+-\s+/,
    /\s{2,}/,
  ];

  const EXPLICIT_SEP = /\s=\s|\s:\s|=|\||\t|\s[–—-]\s/;

  const HEADER_WORDS = new Set([
    "frans", "francais", "français", "nederlands", "engels",
    "vertaling", "vertalingen", "woord", "woorden", "woordenschat", "betekenis",
  ]);

  const HEADER_RE = /^(unit[ée]?\s*\d*|les\s*\d+|hoofdstuk.*|blz\.?\s*\d+|pagina\s*\d+|thema\s*\d*)$/i;

  function isHeaderSide(s) {
    const tokens = s.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
    return tokens.length > 0 && tokens.every((t) => HEADER_WORDS.has(t));
  }

  // Woordenlijsten bevatten vaak ook losse zinnen: een voorbeeldzin bij een
  // woord, of een opmerking van de leerkracht tussen de rijen door. Die horen
  // niet in de oefening thuis.
  function looksLikeSentence(s) {
    const t = String(s).trim();
    if (!t) return false;
    const words = t.split(/\s+/).filter(Boolean).length;
    if (t.length > 45) return true;
    if (words >= 6) return true;
    if (words >= 4 && /[.!?]$/.test(t)) return true;
    if (words >= 4 && t.includes(",")) return true;
    return false;
  }

  function cleanLine(line) {
    return line
      .replace(/\u2019/g, "'")
      .replace(/[“”„]/g, '"')
      .replace(/^\s*(\d{1,3}\s*[.)\]]|[-•*·▪●o])\s+/, "") // opsommingstekens en nummering
      .trim();
  }

  function splitLine(line) {
    for (const sep of SEPARATORS) {
      const parts = line.split(sep);
      if (parts.length >= 2) {
        const left = parts[0].trim();
        const right = parts.slice(1).join(" ").trim();
        if (left && right) return [left, right];
      }
    }
    return null;
  }

  function acceptPair(pair, out, rawLine, zekerheid) {
    if (!pair) {
      if (rawLine) out.unparsed.push(rawLine);
      return;
    }
    const conf = pair[2] != null ? pair[2] : zekerheid;
    const [a, b] = [cleanLine(pair[0]), cleanLine(pair[1])];
    if (!a || !b) {
      if (rawLine) out.unparsed.push(rawLine);
      return;
    }
    if (isHeaderSide(a) || isHeaderSide(b)) return; // koptekst, geen woordpaar
    if (HEADER_RE.test(a) && !b) return;
    // Voorbeeldzinnen en opmerkingen apart houden: ze verdwijnen niet, maar
    // komen ook niet zomaar in de oefening terecht.
    if (looksLikeSentence(a) || looksLikeSentence(b)) {
      out.sentences.push([a, b]);
      return;
    }
    // Derde element markeert een regel die de OCR onzeker las.
    out.pairs.push(conf != null && conf < 70 ? [a, b, true] : [a, b]);
  }

  // Parsen op basis van woordposities (twee kolommen).
  function parsePage(page, out) {
    const lines = groupIntoLines(page.words);
    if (!lines.length) return false;
    const pageWidth = page.width || 1000;
    const wordHeight = median(page.words.map((w) => w.y1 - w.y0)) || 12;
    const colX = detectColumnSplit(lines, pageWidth, wordHeight);
    const threshold = columnThreshold(pageWidth, wordHeight);

    for (const line of lines) {
      const text = cleanLine(joinWords(line.words));
      if (!text || text.length < 3) continue;
      if (HEADER_RE.test(text)) continue;

      // Staat er een expliciet scheidingsteken, dan wint dat van de kolompositie.
      const zekerheid = laagsteZekerheid(line.words);
      if (EXPLICIT_SEP.test(text)) {
        acceptPair(splitLine(text), out, text, zekerheid);
        continue;
      }

      if (colX != null) {
        const parts = splitAtColumn(line, colX, threshold);
        if (parts) {
          acceptPair(parts, out, text, zekerheid);
          continue;
        }
        // Geen gat op de kolomgrens: dit is een regel over de volle breedte,
        // dus een zin of een opmerking, geen woordpaar.
        if (looksLikeSentence(text)) {
          out.sentences.push([text, ""]);
          continue;
        }
      }

      acceptPair(splitLine(text), out, text, zekerheid);
    }
    return true;
  }

  function frenchScore(s) {
    let score = 0;
    if (/[àâäçéèêëîïôöùûüÿœæ]/i.test(s)) score += 4;
    if (/\b(le|la|les|un|une|des|du|au|aux)\b/i.test(s)) score += 2;
    if (/\bl'|\bd'|\bj'|\bs'|\bn'|\bc'/i.test(s)) score += 2;
    if (/(eau|eux|oir|ment|tion|ais|ait|ez)\b/i.test(s)) score += 1;
    return score;
  }

  function dutchScore(s) {
    let score = 0;
    if (/\b(het|een|de)\b/i.test(s)) score += 2;
    if (/\b(zich|zijn|hebben|worden|niet)\b/i.test(s)) score += 2;
    if (/(ij|sch|aa|ee|oo|uu|ken\b|en\b)/i.test(s)) score += 1;
    if (/[àâçéèêëîïôùûœæ]/i.test(s)) score -= 2;
    return score;
  }

  // Staat Frans links, of zijn de kolommen omgedraaid?
  function orientPairs(pairs) {
    let asIs = 0;
    let swapped = 0;
    for (const [a, b] of pairs) {
      asIs += frenchScore(a) + dutchScore(b);
      swapped += frenchScore(b) + dutchScore(a);
    }
    return swapped > asIs ? pairs.map((p) => (p[2] ? [p[1], p[0], p[2]] : [p[1], p[0]])) : pairs;
  }

  // Alleen platte tekst (geen posities beschikbaar).
  function parsePairs(text) {
    const out = { pairs: [], unparsed: [], sentences: [] };
    for (const rawLine of String(text).split(/\r?\n/)) {
      const line = cleanLine(rawLine);
      if (!line || line.length < 3) continue;
      if (HEADER_RE.test(line)) continue;
      acceptPair(splitLine(line), out, line);
    }
    out.pairs = orientPairs(out.pairs);
    return out;
  }

  // Volledig OCR-resultaat (met posities) omzetten naar woordparen.
  function parseDocument(result) {
    const out = { pairs: [], unparsed: [], sentences: [] };
    let any = false;
    for (const page of result.pages || []) {
      if (parsePage(page, out)) any = true;
    }
    if (!any) return parsePairs(result.text || "");
    out.pairs = orientPairs(out.pairs);
    return out;
  }

  return { recognizeFiles, parseDocument, parsePairs, groupIntoLines, detectColumnSplit, looksLikeSentence, frenchScore, dutchScore };
})();
