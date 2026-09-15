# Woordenschat Trainer

Een webapp om Franse woordenschat te leren door te typen. Geen build, geen
server, geen account: open `index.html` en je kunt oefenen. Alles blijft lokaal
in je browser.

## Drie manieren om te oefenen

- **Start ronde** — een greep uit de lijst (5 tot 15 woorden), eerst leren en
  daarna oefenen. De minst gekende woorden komen als eerste aan bod.
- **Lijst leren** — de hele lijst in één keer door de bubbelmodus, zonder
  overhoring achteraf. Bedoeld om nieuwe woorden een eerste keer door te nemen.
- **Lijst oefenen** — de hele lijst meteen uit het hoofd, zonder leerfase.

Welke kolom het Frans is, zoekt de app zelf uit — op accenten, lidwoorden en
typische uitgangen. Typ je een lijst met het Nederlands vooraan, dan meldt de
teller dat en worden de kolommen bij het opslaan omgedraaid.

## Verder waar je gebleven was

Sluit je het tabblad midden in een ronde, dan staat er bij je volgende bezoek
een kaart bovenaan het startscherm met de lijst, of je aan het leren of oefenen
was, en een balk met hoe ver je was. Eén tik en je gaat verder met precies de
woorden die nog openstonden. Pas je de lijst intussen aan, dan vervalt de
bewaarde ronde; je kunt hem ook zelf weggooien met het prullenbakje.

## Geluid

De klanken worden ter plekke opgewekt met de Web Audio API, niet uit bestanden
geladen: dat scheelt megabytes, werkt offline en laat de toonhoogte meelopen met
wat er gebeurt. De geluidscontext wordt pas bij je eerste aanraking aangemaakt,
want een context die daarvoor al bestaat blijft in veel browsers stil hangen. Elke bubbel die knapt klinkt een stapje hoger, dus een woord
uittypen levert een klein loopje op. Een weggegeven letter klinkt doffer, een
foute letter kort en laag, een goed woord als een opgaande drieklank en een fout
woord als twee dalende tonen. Uit te zetten in de instellingen.

## Tijdens het oefenen

Linksboven staat een terugknop naar het startscherm (Escape doet hetzelfde),
rechtsboven een tandwiel met instellingen die meteen ingaan:

- **Richting** — Nederlands → Frans, Frans → Nederlands, of door elkaar. Een
  wijziging geldt direct voor de rest van de ronde.
- **Streng op accenten** en **Accentknoppen tonen**. De accentknoppen verdwijnen
  vanzelf wanneer je Nederlands typt, want daar heb je ze niet voor nodig.
- **Volledig scherm**, **Deze ronde opnieuw** en **Stoppen en terug naar start**.

De voortgang per woord blijft altijd aan het Franse woord hangen, in welke
richting je ook oefent.

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
Elk woord wordt één keer gevraagd. Heb je het goed, dan is het klaar; had je
het fout of gebruikte je hulp, dan gaat het terug in de rij en komt het later
in de ronde opnieuw langs.

Loopt het mis, dan is er één vaste route terug:

| situatie | wat er gebeurt |
| --- | --- |
| **je weet het niet** | 2× **Enter** op een leeg veld → het woord verschijnt klein onder het invulveld |
| **je antwoordt fout** | je ziet het juiste woord, met jouw antwoord eronder, de fouten in het rood en eronder in gewone taal wat er misging (`"a" moet "e" zijn`, `"n" ontbreekt`, `het accent klopt niet`) |

Daarna in beide gevallen hetzelfde: **overtypen** (met het woord in beeld en
letter-voor-letter kleuring), en meteen erna **nog eens uit het hoofd**, nu
zonder hulp. Daarmee is het woord nog niet af: het gaat achteraan in de rij en
komt later in de ronde nog een keer terug.

## Screenshots van je woordenlijst importeren

Heb je een woordenlijst op je scherm of in een boek staan? Maak er screenshots
van en laat de app de woorden eruit halen — klikken, slepen of plakken met
Ctrl/⌘+V, meerdere tegelijk mag.

De herkenning gebeurt volledig in je browser met Tesseract, een open source
OCR-engine die lokaal meedraait in `vendor/`; er gaat niets naar een server.
Werkt met:

- twee kolommen naast elkaar, in beide volgordes (Frans links of rechts)
- voorbeeldzinnen en opmerkingen tussen de rijen, die apart worden gezet
- `frans = nederlands`, met `:`, `-`, `|` of een tab als scheidingsteken
- genummerde lijsten en opsommingstekens
- screenshots in donkere modus (die worden automatisch omgekeerd)
- kleine screenshots (die worden opgeschaald voor betere herkenning)
- foto's van een boekpagina: scheefstand wordt rechtgezet, en bij ongelijk licht
  (schaduw over de bladzijde) gaat de app over op een plaatselijke drempel in
  plaats van één vaste, want anders verdwijnt de tekst in de donkere hoek
- foto's op hun kant: met de draaiknop op de miniatuur zet je ze recht
- grote foto's, die eerst verkleind worden zodat het lezen snel blijft

Kolommen worden herkend aan de posities van de woorden op het beeld, niet aan
de tekstvolgorde — dat is nodig omdat OCR een tabel vaak kolom-voor-kolom
uitleest in plaats van rij-voor-rij.

Zinnen worden er op twee manieren uitgehouden. Een regel wordt alleen in tweeën
geknipt als er op de kolomgrens ook echt een gat zit; een zin die over de volle
breedte doorloopt heeft dat niet en wordt dus niet als woordpaar gelezen. En wat
er qua vorm uitziet als een zin — te lang, te veel woorden, of eindigend op een
punt — komt in een apart blokje "Overgeslagen zinnen" te staan. Daar kun je ze
alsnog toevoegen als de app zich vergist.

Regels die de OCR onzeker las worden oranje gemarkeerd in de tabel, met erboven
hoeveel er nagekeken moeten worden — zo weet je waar je moet kijken zonder alles
te hoeven vergelijken.

Daarna krijg je alles ter controle te zien: een tabel die je kunt bijwerken,
een knop om de kolommen te wisselen, en twee uitklapbare blokken met de ruwe
OCR-tekst en de regels die niet als woordpaar herkend zijn — zodat je kunt
nakijken dat er niets verloren gaat. Geef de lijst een naam en hij wordt lokaal
bewaard.

## Verder

- Voortgang wordt met balken getoond, niet met cijfers: één in de kopbalk voor
  de huidige ronde en één op het startscherm voor de hele lijst
- Woorden per ronde instelbaar (5–15)
- De minst gekende woorden komen als eerste aan bod; voortgang per woord wordt
  bewaard
- Accentknoppen (é è ê ç œ …) en een keuze tussen streng of soepel op accenten
  — standaard soepel, dus `le velo` telt voor `le vélo`
- Wat tussen haakjes staat is een toelichting en hoef je niet mee te typen:
  bij `le chien (m.)` telt `le chien` gewoon als juist. In de bubbelmodus staat
  dat deel meteen in beeld, zonder bubbels.
- Eigen lijsten zelf typen via **Zelf een lijst typen**: één paar per regel met
  een `=` ertussen (`le chien = de hond`). Terwijl je typt zie je hoeveel paren
  er herkend worden en welke regels nog geen `=` hebben. Een tab of puntkomma
  wordt ook aangenomen, zodat geplakte tekst uit een spreadsheet meteen werkt.
- Meerdere lijsten naast elkaar, met een startlijst van 60 veelgebruikte woorden

## Vormgeving

De app volgt de vormgeving van iOS: zwevende panelen met matglas, gegroepeerde
rijen zoals in de instellingen, de systeemkleuren van Apple en een donker thema
dat automatisch meegaat met je toestel. Iconen zijn getekende SVG's, geen
emoji's. Op de laptop ziet het er hetzelfde uit als op de telefoon; het
instellingenmenu schuift op een telefoon van onderen in en staat op een breed
scherm als venster in het midden.

## Op de telefoon

De app is gebouwd om schermvullend te werken: de kaart met de oefening staat in
het midden, de accentknoppen blijven onderaan binnen duimbereik, ook wanneer het
schermtoetsenbord openschuift. Notches en de streep onderaan worden ontzien.

Je kunt hem als app installeren:

- **Android (Chrome):** menu → *App installeren* / *Toevoegen aan startscherm*
- **iPhone (Safari):** deelknop → *Zet op beginscherm*

Daarna start hij zonder adresbalk op en werkt hij offline — ook het herkennen van
screenshots, zodra je dat één keer gebruikt hebt (dan staan de taalbestanden in
de cache). Op de computer en op Android zit er rechtsboven een knop voor
volledig scherm; iPhone-Safari kent die functie niet, daar is de installatie de
weg naar een schermvullende app.

## Deployen

De app staat op GitHub Pages. Om vanaf `main` te publiceren is er één
instelling nodig in de repo: **Settings → Pages → Source** op
**GitHub Actions** zetten. Daarna publiceert `.github/workflows/pages.yml`
elke push naar `main`, met vooraf een controle dat alle bestanden aanwezig
zijn en de scripts parsen.

Staat die instelling nog op *Deploy from a branch*, dan slaat de workflow het
publiceren over met een uitleg in de logs, en blijft Pages publiceren vanaf de
branch die daar ingesteld staat. (Even goed alternatief: laat de bron op
*Deploy from a branch* staan en kies daar `main`.)

## Lokaal draaien

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Openen via `file://` werkt niet voor de screenshot-import en de offline-modus:
de OCR-worker en de service worker hebben een echte server nodig. De rest van de
app werkt wel gewoon.
