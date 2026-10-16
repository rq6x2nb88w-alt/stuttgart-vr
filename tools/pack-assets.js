// Packt die Dateien zusammen, damit das ganze Spiel unter GitHubs Grenze von 100 Dateien pro Upload bleibt:
//  - jedes Poly-Haven-Modell (.gltf + .bin + Texturen) -> eine einzige .glb-Datei
//  - alle Sprachansagen (assets/voice/*.wav) -> assets/voice/voice.bin + voice.json
// Aufruf (nach download-assets.js bzw. make-voice.ps1):  node tools/pack-assets.js
const fs = require('fs'), path = require('path');
const A = path.join(__dirname, '..', 'assets');

// ---------- glTF -> GLB (alles in einer Datei) ----------
function packGltf(file) {
  const dir = path.dirname(file), j = JSON.parse(fs.readFileSync(file, 'utf8')), parts = []; let off = 0;
  const add = buf => { const pad = (4 - off % 4) % 4; if (pad) { parts.push(Buffer.alloc(pad)); off += pad; } const at = off; parts.push(buf); off += buf.length; return at; };
  const bufAt = (j.buffers || []).map(b => add(fs.readFileSync(path.join(dir, decodeURIComponent(b.uri)))));
  for (const bv of j.bufferViews || []) { bv.byteOffset = (bv.byteOffset || 0) + bufAt[bv.buffer]; bv.buffer = 0; }
  for (const img of j.images || []) {
    if (!img.uri) continue;
    const data = fs.readFileSync(path.join(dir, decodeURIComponent(img.uri)));
    (j.bufferViews ||= []).push({ buffer: 0, byteOffset: add(data), byteLength: data.length });
    img.bufferView = j.bufferViews.length - 1; img.mimeType = /\.png$/i.test(img.uri) ? 'image/png' : 'image/jpeg'; delete img.uri;
  }
  let bin = Buffer.concat(parts); bin = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
  j.buffers = [{ byteLength: bin.length }];
  let json = Buffer.from(JSON.stringify(j), 'utf8'); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546C67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(28 + json.length + bin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  return Buffer.concat([h, jh, json, bh, bin]);
}
const ixFile = path.join(A, 'polyhaven', 'index.json');
if (fs.existsSync(ixFile)) {
  const ix = JSON.parse(fs.readFileSync(ixFile, 'utf8'));
  for (const [id, p] of Object.entries(ix.models || {})) {
    if (p.endsWith('.glb')) continue;
    const src = path.join(A, '..', p), out = path.join(A, 'polyhaven', id + '.glb');
    fs.writeFileSync(out, packGltf(src));
    fs.rmSync(path.dirname(src), { recursive: true, force: true });          // Einzeldateien werden nicht mehr gebraucht
    ix.models[id] = 'assets/polyhaven/' + id + '.glb';
    console.log('GLB', id, (fs.statSync(out).size / 1048576).toFixed(1) + ' MB');
  }
  fs.writeFileSync(ixFile, JSON.stringify(ix, null, 1));
}

// ---------- Sprachansagen: alle WAVs (16 Bit, mono) in eine Datei ----------
const vdir = path.join(A, 'voice'), wavs = fs.existsSync(vdir) ? fs.readdirSync(vdir).filter(f => f.endsWith('.wav')) : [];
if (wavs.length) {
  const clips = {}, parts = []; let off = 0, rate = 16000;
  for (const f of wavs) {
    const b = fs.readFileSync(path.join(vdir, f));
    rate = b.readUInt32LE(24);
    let p = 12; while (p < b.length - 8 && b.toString('ascii', p, p + 4) !== 'data') p += 8 + b.readUInt32LE(p + 4);
    const len = Math.min(b.readUInt32LE(p + 4), b.length - p - 8), pcm = b.subarray(p + 8, p + 8 + len);
    clips[f.replace('.wav', '')] = [off, pcm.length]; parts.push(pcm); off += pcm.length;
  }
  fs.writeFileSync(path.join(vdir, 'voice.bin'), Buffer.concat(parts));
  fs.writeFileSync(path.join(vdir, 'voice.json'), JSON.stringify({ sampleRate: rate, clips }));
  for (const f of wavs) fs.rmSync(path.join(vdir, f));
  console.log('Ansagen:', wavs.length, '-> voice.bin', (off / 1048576).toFixed(1) + ' MB');
}
