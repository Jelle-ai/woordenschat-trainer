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
  // Screenshots zijn vaak klein; opschalen en contrast verhogen scheelt veel leesfouten.
  function fileToCanvas(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = img.naturalWidth < 1000 ? Math.min(3, 1400 / Math.max(img.naturalWidth, 1)) : 1;
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);

        try {
          const data = ctx.getImageData(0, 0, w, h);
          const px = data.data;

          // Donkere modus: OCR verwacht donkere tekst op een lichte achtergrond.
          let sum = 0;
          const step = Math.max(4, Math.floor(px.length / 4 / 20000) * 4);
          let samples = 0;
          for (let i = 0; i < px.length; i += step) {
            sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            samples++;
          }
          const invert = samples > 0 && sum / samples < 110;

          for (let i = 0; i < px.length; i += 4) {
            let g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            if (invert) g = 255 - g;
            const c = Math.max(0, Math.min(255, (g - 128) * 1.35 + 128));
            px[i] = px[i + 1] = px[i + 2] = c;
          }
          ctx.putImageData(data, 0, 0);
        } catch (e) {
          // Lukt niet bij sommige kleurprofielen; dan het onbewerkte beeld gebruiken.
        }
        resolve(canvas);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Dit bestand kon de browser niet openen als afbeelding: " + file.name));
      };
      img.src = url;
    });
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
            words.push({ text, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 });
          }
        }
      }
    }
    return words;
  }

  async function recognizeFiles(files, onProgress) {
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
        onProgress(0.2 + (i / files.length) * 0.75, `Screenshot ${i + 1} van ${files.length} lezen…`);
        const canvas = await fileToCanvas(files[i]);
        const { data } = await worker.recognize(canvas);
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
  function detectColumnSplit(lines, pageWidth, wordHeight) {
    const threshold = Math.max(wordHeight * 1.2, pageWidth * 0.025, 10);

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

  function acceptPair(pair, pairs, unparsed, rawLine) {
    if (!pair) {
      if (rawLine) unparsed.push(rawLine);
      return;
    }
    const [a, b] = [cleanLine(pair[0]), cleanLine(pair[1])];
    if (!a || !b || a.length > 60 || b.length > 60) {
      if (rawLine) unparsed.push(rawLine);
      return;
    }
    if (isHeaderSide(a) || isHeaderSide(b)) return; // koptekst, geen woordpaar
    if (HEADER_RE.test(a) && !b) return;
    pairs.push([a, b]);
  }

  // Parsen op basis van woordposities (twee kolommen).
  function parsePage(page, pairs, unparsed) {
    const lines = groupIntoLines(page.words);
    if (!lines.length) return false;
    const wordHeight = median(page.words.map((w) => w.y1 - w.y0)) || 12;
    const colX = detectColumnSplit(lines, page.width || 1000, wordHeight);

    for (const line of lines) {
      const text = cleanLine(joinWords(line.words));
      if (!text || text.length < 3) continue;
      if (HEADER_RE.test(text)) continue;

      // Staat er een expliciet scheidingsteken, dan wint dat van de kolompositie.
      if (EXPLICIT_SEP.test(text)) {
        acceptPair(splitLine(text), pairs, unparsed, text);
        continue;
      }

      if (colX != null) {
        const left = line.words.filter((w) => (w.x0 + w.x1) / 2 < colX);
        const right = line.words.filter((w) => (w.x0 + w.x1) / 2 >= colX);
        if (left.length && right.length) {
          acceptPair([joinWords(left), joinWords(right)], pairs, unparsed, text);
          continue;
        }
      }

      acceptPair(splitLine(text), pairs, unparsed, text);
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
    return swapped > asIs ? pairs.map(([a, b]) => [b, a]) : pairs;
  }

  // Alleen platte tekst (geen posities beschikbaar).
  function parsePairs(text) {
    const pairs = [];
    const unparsed = [];
    for (const rawLine of String(text).split(/\r?\n/)) {
      const line = cleanLine(rawLine);
      if (!line || line.length < 3) continue;
      if (HEADER_RE.test(line)) continue;
      acceptPair(splitLine(line), pairs, unparsed, line);
    }
    return { pairs: orientPairs(pairs), unparsed };
  }

  // Volledig OCR-resultaat (met posities) omzetten naar woordparen.
  function parseDocument(result) {
    const pairs = [];
    const unparsed = [];
    let any = false;
    for (const page of result.pages || []) {
      if (parsePage(page, pairs, unparsed)) any = true;
    }
    if (!any) return parsePairs(result.text || "");
    return { pairs: orientPairs(pairs), unparsed };
  }

  return { recognizeFiles, parseDocument, parsePairs, groupIntoLines, detectColumnSplit, frenchScore, dutchScore };
})();
