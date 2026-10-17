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

## Ordner
- `assets/` – alle 3D-Modelle, Texturen, Himmel, Klingelton und Sprachansagen (alles lokal, kein Internet nötig)
- `tools/` – Skripte zum Neu-Herunterladen (`download-assets.js`), Packen (`pack-assets.js`) und für die Ansagen (`make-voice.ps1`)
