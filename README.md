# Woordenschat Trainer 🫧

Een webapp om Franse woordenschat te leren door te typen. Geen build, geen
server, geen account: open `index.html` en je kunt oefenen. Alles blijft lokaal
in je browser.

## Hoe een ronde werkt

**1. Leren — letters achter bubbels**

Je ziet het Nederlandse woord en het Franse woord als een rij bubbels, één per
letter. Je typt de letters:

- juiste letter → de bubbel knapt en de letter komt tevoorschijn
- foute letter → de bubbel trilt rood en je blijft op dezelfde plek staan
- weet je het echt niet → **Enter** geeft één bubbel gratis weg (die letter
  kleurt oranje, zodat je achteraf ziet wat je nog niet kende)

**2. Drillen — uit het hoofd**

Nu zie je alleen het Nederlandse woord en typ je de Franse vertaling blind.
Elk woord moet 2× foutloos uit het hoofd voordat het uit de ronde verdwijnt.

Loopt het mis, dan is er één vaste route terug:

| situatie | wat er gebeurt |
| --- | --- |
| **je weet het niet** | 2× **Enter** op een leeg veld → het woord verschijnt klein onder het invulveld |
| **je antwoordt fout** | je ziet het juiste woord, met jouw antwoord eronder en de fouten in het rood |

Daarna in beide gevallen hetzelfde: **overtypen** (met het woord in beeld en
letter-voor-letter kleuring), en meteen erna **nog eens uit het hoofd**, nu
zonder hulp. De teller van dat woord gaat terug naar 0, dus het komt later in
de ronde gewoon terug.

## Screenshots van je woordenlijst importeren

Heb je een woordenlijst op je scherm of in een boek staan? Maak er screenshots
van en laat de app de woorden eruit halen — klikken, slepen of plakken met
Ctrl/⌘+V, meerdere tegelijk mag.

De herkenning gebeurt volledig in je browser (Tesseract draait lokaal mee in
`vendor/`, er gaat niets naar een server) en werkt met:

- twee kolommen naast elkaar, in beide volgordes (Frans links of rechts)
- `frans = nederlands`, met `:`, `-`, `|` of een tab als scheidingsteken
- genummerde lijsten en opsommingstekens
- screenshots in donkere modus (die worden automatisch omgekeerd)
- kleine screenshots (die worden opgeschaald voor betere herkenning)

Kolommen worden herkend aan de posities van de woorden op het beeld, niet aan
de tekstvolgorde — dat is nodig omdat OCR een tabel vaak kolom-voor-kolom
uitleest in plaats van rij-voor-rij.

Daarna krijg je alles ter controle te zien: een tabel die je kunt bijwerken,
een knop om de kolommen te wisselen, en twee uitklapbare blokken met de ruwe
OCR-tekst en de regels die niet als woordpaar herkend zijn — zodat je kunt
nakijken dat er niets verloren gaat. Geef de lijst een naam en hij wordt lokaal
bewaard.

## Verder

- Woorden per ronde instelbaar (5–15)
- De minst gekende woorden komen als eerste aan bod; voortgang per woord wordt
  bewaard
- Accentknoppen (é è ê ç œ …) en een keuze tussen streng of soepel op accenten
  — standaard soepel, dus `le velo` telt voor `le vélo`
- Eigen lijsten ook met de hand te typen of te plakken (`frans = nederlands`)
- Meerdere lijsten naast elkaar, met een startlijst van 60 veelgebruikte woorden

## Starten

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Openen via `file://` werkt niet voor de screenshot-import: de OCR-worker heeft
een echte server nodig. De rest van de app werkt wel gewoon.
