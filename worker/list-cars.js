// Schreibt worker/cars.json: Liste der Autos in assets/models/autos (läuft automatisch vor jedem Hochladen)
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'assets', 'models', 'autos');
let cars = []; try { cars = fs.readdirSync(dir).filter(f => /\.(glb|gltf)$/i.test(f)); } catch (e) { }
fs.writeFileSync(path.join(__dirname, 'cars.json'), JSON.stringify(cars));
console.log('Autos:', cars.join(', ') || '(keine)');
