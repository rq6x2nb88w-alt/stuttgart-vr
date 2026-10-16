// Lädt alle 3D-Modelle, Texturen und den Himmel, die das Spiel sonst aus dem Internet holt, in den Ordner assets/.
// Danach braucht das Spiel Poly Haven / three.js-Beispiele nicht mehr (Fallback aufs Internet bleibt im Code).
// Aufruf:  node tools/download-assets.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'assets');
const PH = 'https://api.polyhaven.com/files/';
const TJS = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/';
const DRACO = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/';

const MODELS = ['service_pistol', 'sledgehammer_01', 'vintage_lighter', 'wooden_crate_01', 'metal_jerrycan', 'painted_wooden_bench', 'metal_trash_can',
  'Barrel_01', 'old_tyre', 'utility_box_01', 'trashbag', 'modular_urban_apartments_facade'];
const TEXTURES = ['asphalt_02', 'concrete_pavers', 'aerial_grass_rock', 'clay_roof_tiles_02', 'sparse_grass'];
const HDRIS = [['kloofendal_48d_partly_cloudy_puresky', '2k']];
const THREE_MODELS = ['ferrari.glb', 'Soldier.glb', 'Michelle.glb'];
const DRACO_FILES = ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'];

let bytes = 0, files = 0;
async function get(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { bytes += fs.statSync(dest).size; files++; return; }
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url);
      const b = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, b);
      bytes += b.length; files++; return;
    } catch (e) { if (i === 2) throw e; await new Promise(r => setTimeout(r, 1500)); }
  }
}
const rel = p => path.relative(path.join(ROOT, '..'), p).split(path.sep).join('/');
(async () => {
  const index = { models: {}, tex: {}, hdri: {} };
  for (const id of MODELS) {
    const f = await (await fetch(PH + id)).json();
    const g = f.gltf['1k'].gltf, dir = path.join(ROOT, 'polyhaven', id), name = g.url.split('/').pop();
    await get(g.url, path.join(dir, name));
    for (const [k, v] of Object.entries(g.include || {})) await get(v.url, path.join(dir, k));   // .bin + Texturen mit gleichem relativen Pfad
    index.models[id] = rel(path.join(dir, name)); console.log('Modell', id);
  }
  for (const id of TEXTURES) {
    const f = await (await fetch(PH + id)).json(), dir = path.join(ROOT, 'polyhaven', id), t = {};
    for (const [k, out] of [['Diffuse', 'map'], ['nor_gl', 'normalMap']]) {
      const u = f[k]?.['1k']?.jpg?.url; if (!u) continue;
      const dest = path.join(dir, out + '.jpg'); await get(u, dest); t[out] = rel(dest);
    }
    index.tex[id] = t; console.log('Textur', id);
  }
  for (const [id, res] of HDRIS) {
    const f = await (await fetch(PH + id)).json(), dest = path.join(ROOT, 'polyhaven', id, id + '_' + res + '.hdr');
    await get(f.hdri[res].hdr.url, dest); index.hdri[id] = { [res]: rel(dest) }; console.log('Himmel', id);
  }
  for (const m of THREE_MODELS) { await get(TJS + m, path.join(ROOT, 'models', 'three', m)); console.log('three.js', m); }
  for (const d of DRACO_FILES) await get(DRACO + d, path.join(ROOT, 'libs', 'draco', d));
  fs.writeFileSync(path.join(ROOT, 'polyhaven', 'index.json'), JSON.stringify(index, null, 1));
  console.log(`Fertig: ${files} Dateien, ${(bytes / 1048576).toFixed(1)} MB`);
  require('./pack-assets.js');                                            // Modelle zu je einer .glb-Datei packen
})().catch(e => { console.error('Fehler:', e.message); process.exit(1); });
