// Geluiden worden ter plekke opgewekt met de Web Audio API in plaats van uit
// bestanden geladen. Dat scheelt megabytes, werkt offline, en laat de toonhoogte
// meelopen met wat er gebeurt — elke bubbel klinkt een stapje hoger.
const Sound = (() => {
  let ctx = null;
  let master = null;
  let aan = true;

  function ensure() {
    if (!aan) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      } catch (e) {
        return null;
      }
    }
    // Browsers starten pas na een aanraking of toetsaanslag.
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  // Eén toon met een zachte in- en uitloop, eventueel glijdend van toonhoogte.
  function tone({ freq, to, type = "sine", dur = 0.16, gain = 0.2, delay = 0, curve = "exp" }) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) {
      if (curve === "exp") osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
      else osc.frequency.linearRampToValueAtTime(to, t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Korte ruispuls: geeft de "tik" van een knappende bubbel.
  function noise({ dur = 0.05, gain = 0.12, freq = 1600, q = 1.2, delay = 0 }) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const frames = Math.max(1, Math.floor(c.sampleRate * dur));
    const buffer = c.createBuffer(1, frames, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // Toonladder in C majeur; de index bepaalt hoe hoog een bubbel klinkt.
  const LADDER = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77, 1046.5];

  return {
    zetAan(waarde) {
      aan = !!waarde;
      if (aan) ensure();
    },
    staatAan() { return aan; },

    // Wordt na de eerste aanraking aangeroepen, zodat het geluid klaarstaat.
    ontgrendel() { ensure(); },

    // Bubbel knapt: een tik plus een toon die per letter een stapje hoger ligt.
    pop(index) {
      const n = LADDER[Math.min(index || 0, LADDER.length - 1)];
      noise({ dur: 0.045, gain: 0.1, freq: 1400 + (index || 0) * 90, q: 1.1 });
      tone({ freq: n * 1.35, to: n, type: "sine", dur: 0.13, gain: 0.16 });
    },

    // Weggegeven letter: doffer, zodat je hoort dat je hulp kreeg.
    hint(index) {
      const n = LADDER[Math.min(index || 0, LADDER.length - 1)];
      tone({ freq: n * 0.75, to: n * 0.6, type: "triangle", dur: 0.16, gain: 0.1 });
    },

    // Foute letter: kort en laag, niet schril.
    mis() {
      tone({ freq: 190, to: 130, type: "triangle", dur: 0.14, gain: 0.16 });
    },

    // Woord juist: opgaand drieklankje.
    juist() {
      tone({ freq: 659.25, type: "sine", dur: 0.12, gain: 0.16 });
      tone({ freq: 830.61, type: "sine", dur: 0.12, gain: 0.15, delay: 0.09 });
      tone({ freq: 987.77, type: "sine", dur: 0.22, gain: 0.15, delay: 0.18 });
    },

    // Woord fout: twee dalende tonen.
    fout() {
      tone({ freq: 392, to: 370, type: "triangle", dur: 0.16, gain: 0.16 });
      tone({ freq: 311.13, to: 294, type: "triangle", dur: 0.28, gain: 0.15, delay: 0.13 });
    },

    // Ronde klaar: vier tonen omhoog.
    klaar() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone({ freq: f, type: "sine", dur: i === 3 ? 0.42 : 0.16, gain: 0.16, delay: i * 0.1 })
      );
    },
  };
})();
