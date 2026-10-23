// Schreibt worker/cars.json: Liste der Autos in assets/models/autos + eigene Klingeltöne in assets/klingeltoene (läuft automatisch vor jedem Hochladen)
const fs = require('fs'), path = require('path');
const ls = (dir, re) => { try { return fs.readdirSync(path.join(__dirname, '..', 'assets', ...dir)).filter(f => re.test(f)); } catch (e) { return []; } };
const cars = ls(['models', 'autos'], /\.(glb|gltf)$/i), rings = ls(['klingeltoene'], /\.(mp3|ogg|wav|m4a)$/i);
fs.writeFileSync(path.join(__dirname, 'cars.json'), JSON.stringify({ cars, rings }));
console.log('Autos:', cars.join(', ') || '(keine)', '| Klingeltöne:', rings.join(', ') || '(keine eigenen)');
