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
- **Bank**: Kontostand, Geld an andere Spieler überweisen, letzte Buchungen
- **Einstellungen**: Klingelton wählen (antippen = Vorschau). Eigene Töne: mp3-Dateien in `assets/klingeltoene/` legen
- Tag und Nacht (ein Tag = 40 Minuten). Geld, Haus, Hund, Tuning, Tank und Galerie werden gespeichert.

## Admin
Wer sich **Gabriel** nennt, hat auf dem Handy die App **Admin Panel**: Tornado, Tsunami, NPC-Angriff, Gebäudebrand, Regen an/aus und „Alles stoppen“ – gilt für alle Spieler.
- **Geld verschenken**: beliebig viel an jeden Spieler (oder sich selbst)
- **Server herunterfahren** (mit Sicherheitsabfrage): bei allen wird es 5 Sekunden schwarz, dann kommt „Service wurde geschlossen für Reparierung“. Der Server bleibt zu, bis der Admin im Popup **A** (PC: Leertaste) drückt – dann laden alle automatisch neu.

## Ordner
- `assets/` – alle 3D-Modelle, Texturen, Himmel, Klingelton und Sprachansagen (alles lokal, kein Internet nötig)
- `tools/` – Skripte zum Neu-Herunterladen (`download-assets.js`), Packen (`pack-assets.js`) und für die Ansagen (`make-voice.ps1`)
