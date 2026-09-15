# Woordenschat Trainer 🇫🇷

Een simpele webapp om Franse woordenschat te leren door te typen.

## Hoe het werkt

Elke ronde bestaat uit twee fases:

1. **Leren** — je ziet het Nederlandse én het Franse woord, en typt het Franse woord over. Zo leer je de woorden eerst rustig kennen (met letter-voor-letter feedback).
2. **Drillen** — je krijgt alleen het Nederlandse woord en typt de Franse vertaling uit het hoofd. Elk woord moet 2× goed. Bij een fout zie je het juiste antwoord, typ je het over, en komt het woord later in de ronde terug.

## Features

- Woorden per ronde instelbaar (5–15)
- Slimme selectie: minst gekende woorden komen eerst aan bod (voortgang in localStorage)
- Accentknoppen voor é è ê ç œ … (of typ gewoon zonder accenten met de soepele modus)
- Optioneel streng op accenten (é ≠ e)
- Eigen woordenlijst plakken via "Woordenlijst aanpassen" (formaat: `frans = nederlands`)

## Starten

Geen build nodig — open `index.html` in de browser, of serveer de map:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```
