# Stuttgart VR

Multiplayer-VR-Spiel im Browser (Meta Quest 3 / 3S, auch am PC spielbar).

## Online (Render.com)
- Build Command: `npm install`
- Start Command: `node server.js`
- Render setzt `PORT` automatisch, HTTPS macht Render selbst.

## Lokal starten
```
node server.js
```
- PC: http://localhost:8080
- Quest im selben WLAN: https://<PC-IP>:8443

## Im Auto
- Linker Controller **X** = Fenster runter, **Y** = Fenster hoch (am PC: Taste X / Y). Bei geschlossenem Fenster hört man draußen niemanden.
- **Dashcam** an der Frontscheibe: roten Knopf mit dem Controller drücken (am PC: C) = Aufnahme an/aus. Beim Stoppen landet das Video in der Handy-Galerie.
- Nach einem harten Crash fliegt die Dashcam durchs Auto: greifen und an die Scheibe halten (am PC: C).
- Das Handy bleibt beim Aussteigen am Magneten.

## Jobs, Geld & mehr (Handy-Apps)
- **Jobs**: Taxifahrer, Lieferdienst, Polizist, Krimineller
- **Ausrauben**: Grip an einer Kasse (Supermarkt, Tankstelle) oder einem Geldautomaten halten (PC: E halten) → Fahndungssterne, Streifenwagen jagen dich. In Gebäuden versteckt sieht dich die Polizei nicht.
- **Hupe**: linken Stick drücken (PC: B) · **Sirene** als Polizist: Auto-Display (PC: N)
- **Radio** und **Tanken** (an der Zapfsäule, PC: T) am Auto-Display · **Tuning-Werkstatt** an der 2. Tankstelle: Lack, Felgen, Neon und **Motor** (Stufe 1, Stufe 2, Turbo – schneller und mehr Sound)
- **Chat**, **Immobilien** (Haus kaufen = eigener Startpunkt), **Tiere** (Hund Bello)
- **Neue Autos**: Porsche 911, Jeep Grand Wagoneer, **Tesla Roadster** (200.000 € – am Auto-Display „Raumflug“: R-Trigger Schub, L-Trigger Bremse, linker Stick hoch/runter; PC: R/V) sowie **Polizei**, **Feuerwehr** (Wasserwerfer löscht Brände) und **Krankenwagen** mit Blaulicht + Sirene
- **Hunger + Durst**: zwei Balken auf dem Handy. Im Supermarkt / an der Tankstelle Essen und Getränke vom Tisch greifen, aufs Kassenband legen, Handy rausholen und ans **NFC-Feld** halten (Liquid-Glass-Fenster mit Kontostand → Haken). Essen an den Mund = essen, Flasche kippen = trinken (PC: Q = aufheben, Maustaste halten = essen/trinken)
- **Türen + Kofferraum**: alle Autos haben greifbare Türgriffe (Jeep: 4 echte Türen, Porsche: 2, Roadster: beide Türen). Kofferraum am Griff hochziehen oder am Auto-Display „Kofferraum“ (PC: K) – Jetta/Polizei: Deckel, Jeep: Scheibe fährt runter, Klappe klappt runter
- **Kofferraum als Stauraum**: Kofferraum öffnen, Essen/Getränke hineinlegen – sie fahren mit und bleiben gespeichert (auch nach dem Neuladen, je Auto) – andere Spieler sehen, was drin liegt
- **Fremder Kofferraum**: ist ein Auto entsperrt (Display: „Türen offen“), können auch andere den Kofferraum am Griff (PC: K) öffnen und schließen
- **Im Jeep-Kofferraum mitfahren**: zwei zusätzliche Plätze auf dem Ladeboden, Blick nach hinten raus – hinten am Jeep A drücken (PC: F), Aussteigen mit B (PC: F) hinter dem Auto
- **Displays**: jedes Auto hat ein Hauptdisplay und ein Mini-Display hinter dem Lenkrad (fehlen sie im Modell, werden sie sichtbar vor das Armaturenbrett gesetzt)
- **Einkaufswagen** im Supermarkt am Eingang: Griff greifen und schieben (PC: Q), Ware hineinlegen, Wagen neben die Kasse stellen – alles darin wird gescannt
- **Admin**: Konto eines Spielers (oder das eigene) auf 0 € setzen
- **Handy im Auto vergessen**: A drücken – es fliegt zu deiner Hand. Mitfahrer hören das Radio des Fahrers
- **Bank**: Kontostand, Geld an andere Spieler überweisen, letzte Buchungen
- **Einstellungen**: Klingelton wählen (antippen = Vorschau). Eigene Töne: mp3-Dateien in `assets/klingeltoene/` legen
- Keine Text-Einblendungen im Blickfeld – Geld, Hunger, Durst und Fahndungssterne stehen auf dem Handy.
- Tag und Nacht (ein Tag = 40 Minuten). Geld, Haus, Hund, Tuning, Tank und Galerie werden gespeichert.

## Admin
Wer sich **Gabriel** nennt, hat auf dem Handy die App **Admin Panel**: Tornado, Tsunami, NPC-Angriff, Gebäudebrand, Regen an/aus und „Alles stoppen“ – gilt für alle Spieler.
- **Geld verschenken**: beliebig viel an jeden Spieler (oder sich selbst)
- **Auto-Tempo**: Höchstgeschwindigkeit der Autos eines Spielers (oder die eigene) festlegen – 0, 50, 100, 200, 300, 500 oder 1000 km/h, „Normal“ = wieder wie das Motor-Tuning. Bleibt gespeichert, gilt auch im Roadster-Flug.
- **Server herunterfahren** (mit Sicherheitsabfrage): bei allen friert die Welt ein, die anderen Spieler sind auf einmal weg, dann verschwindet ganz schnell alles außer den Gebäuden. Danach wird es schwarz, die „Stuttgart VR“-Animation mit „Suche nach Verbindung …“ läuft 3 s, und „Service wurde geschlossen für Reparierung“ ploppt auf. Der Server bleibt zu, bis der Admin im Popup **A** (PC: Leertaste) drückt – dann laden alle automatisch neu.

## Ordner
- `assets/` – alle 3D-Modelle, Texturen, Himmel, Klingelton und Sprachansagen (alles lokal, kein Internet nötig)
- `tools/` – Skripte zum Neu-Herunterladen (`download-assets.js`), Packen (`pack-assets.js`) und für die Ansagen (`make-voice.ps1`)
