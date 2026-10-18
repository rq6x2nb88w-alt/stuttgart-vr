import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import * as AS from './assets.js';

// ===================================================================
// Grundsetup
// ===================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping ?? THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // weiche PCF-Schatten, deutlich günstiger als PCFSoft (Quest)
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
renderer.xr.setFramebufferScaleFactor(.9);   // Quest 3/3S: etwas weniger Pixel = flüssiger
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc4d3e2, 200, 1100);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1200);
camera.rotation.order = 'YXZ';
camera.position.set(0, 1.7, 0);
const dolly = new THREE.Group();
dolly.add(camera);
scene.add(dolly);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const lerpAngle = (a, b, t) => a + wrapA(b - a) * t;
const ease = k => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const v1 = V(), v2 = V(), v3 = V();
let time = 0;
// Gleiche Welt auf allen Geräten: beim Aufbau läuft der Zufall mit festem Startwert
const realRandom = Math.random;
const seeded = s => () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
Math.random = seeded(20261014);

// Himmel + Umgebungslicht
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(215));
function makeSky(s) {
  const sky = new Sky(); sky.scale.setScalar(s);
  const u = sky.material.uniforms;
  u.turbidity.value = 5; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(sunDir);
  return sky;
}
const sky = makeSky(560); scene.add(sky);
{
  const pm = new THREE.PMREMGenerator(renderer);
  const es = new THREE.Scene(); es.add(makeSky(50));
  scene.environment = pm.fromScene(es).texture;
}
const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x4d5a3c, 0.9); scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xfff0d6, 2.6);
sunLight.position.copy(sunDir).multiplyScalar(100);
scene.add(sunLight, sunLight.target);
// Sonnenschatten folgen dem Spieler (scharf in der Nähe)
const SH = 55;
sunLight.castShadow = true;
Object.assign(sunLight.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 420 });
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.05;
const shade = (o, cast = true, recv = true) => { o.traverse(m => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = recv; } }); return o; };
const boomLight = new THREE.PointLight(0xffa040, 0, 60, 1.5); scene.add(boomLight);
const muzzleLight = new THREE.PointLight(0xffd080, 0, 8, 2); scene.add(muzzleLight);

// ===================================================================
// Texturen (prozedural = Platzhalter, bis die Fototexturen geladen sind)
// ===================================================================
function C(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
const ANISO = renderer.capabilities.getMaxAnisotropy();
function T(c, rep = true) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO; return t;
}
function grain(g, w, h, n, a) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = (Math.random() < .5 ? 'rgba(0,0,0,' : 'rgba(255,255,255,') + (Math.random() * a) + ')';
    const s = 1 + Math.random() * 2; g.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}
const texCache = {};
function facadeTex(style, wall) {
  const key = style + wall; if (texCache[key]) return texCache[key];
  const [c, g] = C(256, 256);
  g.fillStyle = wall; g.fillRect(0, 0, 256, 256); grain(g, 256, 256, 3000, .07);
  const glass = () => pick(['#2b3945', '#34444f', '#26313a', '#3d4d58']);
  for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
    const x = tx * 64, y = ty * 64, lit = Math.random() < .14;
    if (style === 'shop') {
      g.fillStyle = '#2f3438'; g.fillRect(x, y + 2, 64, 54);
      g.fillStyle = Math.random() < .5 ? '#e8dcbc' : '#5a7486'; g.fillRect(x + 3, y + 5, 58, 48);
    } else {
      g.fillStyle = '#ece8e0'; g.fillRect(x + 14, y + 10, 36, 42);
      g.fillStyle = lit ? '#e6c98c' : glass(); g.fillRect(x + 17, y + 13, 30, 36);
      g.fillStyle = '#ece8e0'; g.fillRect(x + 31, y + 13, 2, 36);
    }
  }
  return texCache[key] = T(c);
}
const grassTex = (() => { const [c, g] = C(256, 256); g.fillStyle = '#4f6b34'; g.fillRect(0, 0, 256, 256); grain(g, 256, 256, 9000, .18); return T(c); })();
const asphaltCanvas = (w, h) => { const [c, g] = C(w, h); g.fillStyle = '#3b3c3e'; g.fillRect(0, 0, w, h); grain(g, w, h, w * h / 6, .12); return [c, g]; };
// Straßentextur: 16m breit x 32m lang
function drawRoad(g, w, h, asphaltImg) {
  if (asphaltImg) { for (let x = 0; x < w; x += w / 4) for (let y = 0; y < h; y += w / 4) g.drawImage(asphaltImg, x, y, w / 4, w / 4); }
  else { g.fillStyle = '#3b3c3e'; g.fillRect(0, 0, w, h); grain(g, w, h, w * h / 6, .12); }
  const m = w / 16;
  g.fillStyle = 'rgba(235,235,230,.92)';
  g.fillRect(.9 * m, 0, .15 * m, h); g.fillRect(15 * m - .05 * m, 0, .15 * m, h);
  for (let y = 0; y < h; y += 16 * m) g.fillRect(8 * m - .06 * m, y, .12 * m, 6 * m);
}
const roadTex = (() => { const [c, g] = C(512, 1024); drawRoad(g, 512, 1024); return T(c); })();
const plainAsphalt = (() => T(asphaltCanvas(256, 256)[0]))();
const zebraTex = (() => { const [c, g] = C(256, 64); g.clearRect(0, 0, 256, 64); g.fillStyle = '#eeeeee'; for (let i = 0; i < 8; i++) g.fillRect(i * 32 + 6, 0, 18, 64); return T(c); })();
const walkTex = (() => { const [c, g] = C(256, 256); g.fillStyle = '#a7a39b'; g.fillRect(0, 0, 256, 256); grain(g, 256, 256, 6000, .1); g.strokeStyle = 'rgba(60,60,60,.35)'; g.lineWidth = 2; for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); } return T(c); })();
function drawHighway(g, w, h, img) {
  if (img) { const t = w / 7.5; for (let x = 0; x < w; x += t) for (let y = 0; y < h; y += t) g.drawImage(img, x, y, t, t); }
  else { g.fillStyle = '#3b3c3e'; g.fillRect(0, 0, w, h); grain(g, w, h, w * h / 6, .12); }
  const s = w / 30; g.fillStyle = 'rgba(235,235,230,.92)';
  const solid = m => g.fillRect(m * s - 3, 0, 6, h), dash = m => g.fillRect(m * s - 2, 0, 4, h * .37);
  solid(2.5); dash(6.25); dash(10); solid(13.75); solid(16.25); dash(20); dash(23.75); solid(27.5);
}
const hwTex = (() => { const [c, g] = C(512, 256); drawHighway(g, 512, 256); return T(c); })();
function textTex(lines, w, h, bg, fg, font = 'bold 64px system-ui') {
  const [c, g] = C(w, h); g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, w / 2, h * (i + 1) / (lines.length + 1)));
  return T(c, false);
}
function sign(lines, w, h, x, y, z, ry, bg = '#ffffff', fg = '#111', font, pw = 512, ph = 128) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: textTex(lines, pw, ph, bg, fg, font), toneMapped: false }));
  m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); return m;
}

// ===================================================================
// Welt-Daten
// ===================================================================
const N = 7, P = 86, ROAD = 16, BLOCK = 70, HALF = N * P / 2, LANE = 3.5;
const R = [...Array(N + 1)].map((_, i) => -HALF + i * P);
const bc = i => R[i] + P / 2;
const HZ = HALF + 70;
const colliders = [], flammables = [], shootables = [], props = [], blocks = [], facadeSpecs = [], shopSpots = [], enterSpecs = [];
const pumps = [], houses = [], homes = [], pizzerias = [], robSpots = [];   // Zapfsäulen, Häuser, Häuser zum Kaufen, Pizzerien, Raub-Ziele
const tuningPad = { x: 0, z: 0 };
const culls = []; // Objekte, die erst in der Nähe sichtbar werden (Leistung auf der Quest)
const cull = (o, r) => { culls.push({ o, r, p: o.getWorldPosition ? o.getWorldPosition(new THREE.Vector3()) : o.position.clone() }); return o; };
const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .8, ...o });
const BOX = new THREE.BoxGeometry(1, 1, 1);
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
function box(w, h, d, mat, x, y, z, parent = scene) { const m = new THREE.Mesh(BOX, mat); m.scale.set(w, h, d); m.position.set(x, y, z); parent.add(m); return m; }
function addFlammable(o) { Object.assign(o, { burning: false, heat: 0, burnT: 0, done: false, spreadT: 0 }); o.orig = (o.mats || []).map(m => m.color.clone()); flammables.push(o); return o; }
const fBox = f => f.getBox ? f.getBox() : f.box;

// Material-Sammlung, damit die Fototexturen später eingesetzt werden können
const MAT = {
  grass: M(0xffffff, { map: grassTex, roughness: 1 }),
  park: M(0xffffff, { map: grassTex, roughness: 1 }),
  road: M(0xffffff, { map: roadTex, roughness: .95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  inter: M(0xffffff, { map: plainAsphalt, roughness: .95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  lot: M(0xffffff, { map: plainAsphalt, roughness: .9, polygonOffset: true, polygonOffsetFactor: -1 }),
  walk: M(0xffffff, { map: walkTex, roughness: .95 }),
  hw: M(0xffffff, { map: hwTex, roughness: .95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
};

// ===================================================================
// Gelände: Stuttgarter Kessel – Stadt im Tal, Berge ringsum, Bergstraße zum Fernsehturm
// ===================================================================
const TS = 4400, TN = 220, TC = TS / TN;          // 4,4 km Welt, 20-m-Raster
const HZ0 = N * P / 2 + 70;                        // A8 (wie unten)
const HX = 430;                                    // A81 (Nord-Süd)
const TVT = { x: 250, z: -1230 };                  // Fernsehturm
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash2 = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
const fbm = (x, z) => vnoise(x, z) * .55 + vnoise(x * 2.1, z * 2.1) * .28 + vnoise(x * 4.3, z * 4.3) * .12 + vnoise(x * 9, z * 9) * .05;
// Bergstraße (Serpentinen) von der Stadt hoch zum Fernsehturm
const MROAD = [[43, -309], [43, -390], [95, -470], [25, -560], [-70, -640], [-10, -735], [150, -790], [175, -880], [60, -950], [20, -1040], [120, -1110], [215, -1170], [250, -1200]];
const MROAD_TOP = 150;
const mroadPts = (() => {
  const out = []; let s = 0;
  for (let i = 0; i < MROAD.length - 1; i++) {
    const [ax, az] = MROAD[i], [bx, bz] = MROAD[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 4);
    for (let k = 0; k < n; k++) out.push({ x: ax + (bx - ax) * k / n, z: az + (bz - az) * k / n, s: s + L * k / n });
    s += L;
  }
  out.push({ x: MROAD.at(-1)[0], z: MROAD.at(-1)[1], s });
  // Ecken abrunden (Serpentinen)
  for (let it = 0; it < 6; it++) for (let i = 1; i < out.length - 1; i++) { out[i].x = (out[i - 1].x + out[i].x * 2 + out[i + 1].x) / 4; out[i].z = (out[i - 1].z + out[i].z * 2 + out[i + 1].z) / 4; }
  const total = s; out.forEach(p => { const t = p.s / total; p.h = MROAD_TOP * (t < .06 ? 0 : smooth(0, 1, (t - .06) / .94) * .35 + (t - .06) / .94 * .65); });
  return out;
})();
function baseH(x, z) {
  const dc = Math.max(Math.abs(x), Math.abs(z)) - 330;
  const m = smooth(0, 480, dc);
  const b8 = smooth(45, 150, Math.abs(z - HZ0)), b81 = z < HZ0 + 40 ? smooth(45, 150, Math.abs(x - HX)) : 1;
  const tv = Math.hypot(x - TVT.x, z - TVT.z);
  return m * Math.min(b8, b81) * ((fbm(x / 520 + 7, z / 520 + 3) * .9 + .1) * 125 + MROAD_TOP * .95 * Math.exp(-tv * tv / (2 * 330 * 330)));
}
const TH = new Float32Array((TN + 1) * (TN + 1));
for (let j = 0; j <= TN; j++) for (let i = 0; i <= TN; i++) {
  const x = -TS / 2 + i * TC, z = -TS / 2 + j * TC;
  let h = baseH(x, z);
  // Straße ins Gelände einschneiden / aufschütten
  let best = 1e9, rh = 0;
  if (x > -200 && x < 400 && z < -280 && z > -1300) for (const p of mroadPts) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) { best = d; rh = p.h; } }
  const w = smooth(10, 42, Math.sqrt(best));
  h = rh * (1 - w) + h * w;
  // Plateau am Fernsehturm
  const tv = Math.hypot(x - TVT.x, z - TVT.z); if (tv < 60) h = h * smooth(30, 60, tv) + MROAD_TOP * (1 - smooth(30, 60, tv));
  TH[j * (TN + 1) + i] = h;
}
function groundAt(x, z) {
  const fx = (x + TS / 2) / TC, fz = (z + TS / 2) / TC;
  if (fx < 0 || fz < 0 || fx >= TN || fz >= TN) return 0;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, W = TN + 1;
  // gleiche Dreiecksaufteilung wie das Gelände-Mesh
  const h00 = TH[j * W + i], h10 = TH[j * W + i + 1], h01 = TH[(j + 1) * W + i], h11 = TH[(j + 1) * W + i + 1];
  return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}
const terrainMesh = (() => {
  const g = new THREE.BufferGeometry(), W = TN + 1, pos = new Float32Array(W * W * 3), uv = new Float32Array(W * W * 2), idx = [];
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i; pos[k * 3] = -TS / 2 + i * TC; pos[k * 3 + 1] = TH[k]; pos[k * 3 + 2] = -TS / 2 + j * TC; uv[k * 2] = i * TC / 18; uv[k * 2 + 1] = j * TC / 18;
  }
  for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) { const a = j * W + i, b = a + 1, c = a + W, d = c + 1; idx.push(a, c, b, b, c, d); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  // Farbe: Wiese, Wald, Fels an steilen Hängen
  const nrm = g.attributes.normal, col = new Float32Array(W * W * 3);
  for (let k = 0; k < W * W; k++) {
    const steep = smooth(.93, .75, nrm.getY(k)), h = TH[k], forest = smooth(10, 40, h) * (1 - steep) * (.6 + .4 * hash2(k, 7));
    let r = .78 - forest * .38, gg = .95 - forest * .3, b = .6 - forest * .3;
    r = r * (1 - steep) + .62 * steep; gg = gg * (1 - steep) + .6 * steep; b = b * (1 - steep) + .56 * steep;
    col[k * 3] = r; col[k * 3 + 1] = gg; col[k * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  MAT.grass.vertexColors = true;
  // Leistung: in 5×5 Kacheln aufteilen (gleiche Eckpunkte) -> nur sichtbare Kacheln werden gezeichnet
  const grp = new THREE.Group(), K = 5, CS = TN / K;
  for (let tj = 0; tj < K; tj++) for (let ti = 0; ti < K; ti++) {
    const t = new THREE.BufferGeometry(), ix = [], bb = new THREE.Box3();
    for (const n of ['position', 'uv', 'normal', 'color']) t.setAttribute(n, g.attributes[n]);
    for (let j = tj * CS; j < (tj + 1) * CS; j++) for (let i = ti * CS; i < (ti + 1) * CS; i++) { const a = j * W + i, b = a + 1, c = a + W, d = c + 1; ix.push(a, c, b, b, c, d); }
    for (const k of [tj * CS * W + ti * CS, tj * CS * W + (ti + 1) * CS, (tj + 1) * CS * W + ti * CS, (tj + 1) * CS * W + (ti + 1) * CS]) bb.expandByPoint(V(pos[k * 3], 0, pos[k * 3 + 2]));
    let hMin = 1e9, hMax = -1e9; for (let j = tj * CS; j <= (tj + 1) * CS; j++) for (let i = ti * CS; i <= (ti + 1) * CS; i++) { const h = TH[j * W + i]; hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); }
    bb.min.y = hMin; bb.max.y = hMax; t.setIndex(ix); t.boundingBox = bb; t.boundingSphere = bb.getBoundingSphere(new THREE.Sphere());
    const m = new THREE.Mesh(t, MAT.grass); m.receiveShadow = true; grp.add(m);
  }
  scene.add(grp);
  return grp;
})();

// Gebäude (Box = Dach/Kollision/Treffer; Fassade kommt aus dem 3D-Baukasten)
function building(x, z, w, d, h, style, wall, opt = {}) {
  const kit = !opt.noKit && style !== 'shop';
  let F = 0;
  if (kit) { F = Math.max(1, Math.round(h / 3)); h = opt.house ? F * 3 : F * 3 + .75; }
  const base = facadeTex(style, wall);
  const mk = len => {
    const t = base.clone(); t.needsUpdate = true;
    t.repeat.set(Math.max(1, Math.round(len / 3)) / 4, Math.max(1, Math.round(h / 3.2)) / 4);
    return new THREE.MeshStandardMaterial({ map: t, roughness: .9 });
  };
  const mx = mk(d), mz = mk(w), roof = M(opt.roof || 0x6f7174, { roughness: .95 });
  const m = new THREE.Mesh(BOX, [mx, mx, roof, roof, mz, mz]);
  m.scale.set(w, h, d); m.position.set(x, h / 2, z); scene.add(m);
  const ent = { kind: 'building', mesh: m }; m.userData.ent = ent; shootables.push(m);
  // begehbar (Schule, Supermarkt, Tankstellen-Shop): statt eines Klotzes Wände mit Tür – Innenraum kommt in buildInteriors()
  if (opt.enter) enterSpecs.push({ ent, x, z, w, d, h, kind: opt.enter, front: opt.front || [0, 1], kit, mx, mz, roof, wall, home: opt.home });
  else colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  ent.fl = addFlammable({ kind: 'building', box: new THREE.Box3(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, h, z + d / 2)), mats: [mx, mz, roof], duration: rand(120, 200) });
  if (h > 20) for (let i = 0; i < 2; i++) box(rand(2, 4), 1.6, rand(2, 3), M(0x8a8d90), x + rand(-w / 3, w / 3), h + 0.8, z + rand(-d / 3, d / 3));
  if (kit) facadeSpecs.push({ ent, x, z, w, d, h, F, house: !!opt.house, shops: !!opt.shops, tint: new THREE.Color(opt.tint || wall), front: opt.front || [0, 1], door: !!opt.enter });
  return ent;
}
const ROOF_GEO = new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4);
const houseRoofs = [];
const roofTileMat = M(0xffffff, { vertexColors: true, roughness: .85 });
const HOME_PICK = [4, 17, 33, 52];                                     // diese Häuser kann man kaufen (begehbar)
const HOME_PRICE = [6000, 9000, 12000, 15000];
function house(x, z, w, d, wall, front) {
  const hi = homes.length, forSale = HOME_PICK.includes(houses.length);
  const e = building(x, z, w, d, 6, 'apt', wall, { house: true, front, enter: forSale ? 'home' : undefined, home: forSale ? hi : undefined });
  houses.push({ x, z, w, d, front });
  if (forSale) homes.push({ x, z, w, d, front, price: HOME_PRICE[hi], i: hi });
  const rm = M(pick([0x9a4a32, 0x7c3b2a, 0x5a5a5e, 0xa85a3a]), { roughness: .85 });
  const r = new THREE.Mesh(ROOF_GEO, rm);
  r.scale.set((w / 2 + .5) * Math.SQRT2, 3.2, (d / 2 + .5) * Math.SQRT2); r.position.set(x, 7.6, z); scene.add(r);
  r.userData.ent = e; shootables.push(r); e.fl.mats.push(rm); e.fl.orig.push(rm.color.clone()); e.fl.box.max.y = 9.2;
  houseRoofs.push(r);
}

// Instanzierte Bäume / Laternen
const treeM = [], lampM = [], lampFx = {};
const farTrees = { zones: [], mesh: null, mats: null };
const ZERO_M4 = new THREE.Matrix4().makeScale(0, 0, 0);
// Baum-Karten nur dort zeigen, wo keine echten Bäume stehen (Zonen näher als 230 m haben echte Bäume)
function updFarTrees() {
  const f = farTrees; if (!f.mesh) return; let dirty = false;
  for (const z of f.zones) {
    const near = z.p.distanceToSquared(headWorld) < 230 * 230; if (near === z.near) continue;
    z.near = near; dirty = true;
    for (let i = 0; i < z.n; i++) f.mesh.setMatrixAt(z.start + i, near ? ZERO_M4 : f.mats[z.start + i]);
  }
  if (dirty) f.mesh.instanceMatrix.needsUpdate = true;
}
function tree(x, z, s = rand(.8, 1.3), y = 0) { treeM.push([x, z, s, y]); }

// Requisiten (zerstörbar) – Platzhalter, werden durch 3D-Modelle ersetzt
const crateTex = (() => { const [c, g] = C(128, 128); g.fillStyle = '#9c7444'; g.fillRect(0, 0, 128, 128); grain(g, 128, 128, 2000, .2); g.strokeStyle = '#6b4a26'; g.lineWidth = 8; g.strokeRect(4, 4, 120, 120); return T(c); })();
const PROP_DEF = {
  crate: { size: [.82, .35, .41], color: 0x9c7444, model: 'wooden_crate_01' },
  can: { size: [.35, .45, .17], color: 0xc0161b, model: 'metal_jerrycan', explosive: true },
  bench: { size: [1.16, .89, .5], color: 0x7a5a3a, model: 'painted_wooden_bench' },
  bin: { size: [1.85, .9, .56], color: 0x2f5a3a, model: 'metal_trash_can' },
  barrel: { size: [.56, .88, .56], color: 0xa02020, model: 'Barrel_01', explosive: true },
  tyre: { size: [.6, .17, .6], color: 0x151515, model: 'old_tyre' },
  ubox: { size: [.52, 1.12, .43], color: 0x8f9488, model: 'utility_box_01' },
  bag: { size: [.53, .57, .46], color: 0x111111, model: 'trashbag' },
};
function prop(type, x, y, z, ry = 0) {
  const D = PROP_DEF[type];
  const mesh = box(D.size[0], D.size[1], D.size[2], M(D.color, type === 'crate' ? { map: crateTex } : {}), x, y + D.size[1] / 2, z);
  mesh.rotation.y = ry;
  const p = { kind: 'prop', type, mesh, model: null, broken: false, color: D.color, explosive: !!D.explosive, x, y, z, ry };
  mesh.userData.ent = p; shootables.push(mesh); props.push(p);
  p.fl = addFlammable({ kind: 'prop', box: new THREE.Box3().setFromObject(mesh), mats: [mesh.material], duration: 25, explodeAfter: p.explosive ? 2.5 : 0, owner: p });
  return p;
}

// ===================================================================
// Straßen
// ===================================================================
const ROAD_L = N * P + ROAD;
{
  roadTex.repeat.set(1, ROAD_L / 32);
  const rgeo = new THREE.PlaneGeometry(ROAD, ROAD_L).rotateX(-Math.PI / 2);
  for (let i = 0; i <= N; i++) {
    const a = new THREE.Mesh(rgeo, MAT.road); a.position.set(R[i], .02, 0); scene.add(a);
    const b = new THREE.Mesh(rgeo, MAT.road); b.rotation.y = Math.PI / 2; b.position.set(0, .02, R[i]); scene.add(b);
  }
  const ig = [], zg = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    ig.push(new THREE.PlaneGeometry(ROAD, ROAD).rotateX(-Math.PI / 2).translate(R[i], 0, R[j]));
    for (const s of [-1, 1]) {
      zg.push(new THREE.PlaneGeometry(ROAD - 2, 3).rotateX(-Math.PI / 2).translate(R[i], 0, R[j] + s * (ROAD / 2 + 1.8)));
      zg.push(new THREE.PlaneGeometry(ROAD - 2, 3).rotateX(-Math.PI / 2).rotateY(Math.PI / 2).translate(R[i] + s * (ROAD / 2 + 1.8), 0, R[j]));
    }
  }
  const im = new THREE.Mesh(mergeGeometries(ig), MAT.inter); im.position.y = .03; scene.add(im);
  const zm = new THREE.Mesh(mergeGeometries(zg), M(0xffffff, { map: zebraTex, transparent: true, roughness: .9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
  zm.position.y = .04; scene.add(zm);

  for (let i = 0; i <= N; i++) for (let k = 0; k < N; k++) for (let t = 12; t < P - 12; t += 26) {
    const a = R[k] + t;
    for (const s of [-1, 1]) {
      lampM.push([R[i] + s * (ROAD / 2 + .9), a, s > 0 ? Math.PI : 0]);
      lampM.push([a, R[i] + s * (ROAD / 2 + .9), s > 0 ? Math.PI / 2 : -Math.PI / 2]);
      tree(R[i] + s * (ROAD / 2 + 2.3), a + 13, rand(.7, 1));
      tree(a + 13, R[i] + s * (ROAD / 2 + 2.3), rand(.7, 1));
    }
  }
  const vn = ['Rotebühlstraße', 'Pforzheimer Straße', 'Hauptstätter Str.', 'Königstraße', 'Theodor-Heuss-Str.', 'Neckarstraße', 'Heilbronner Str.', 'Pragstraße'];
  const hn = ['Böblinger Straße', 'Schwabstraße', 'Marienstraße', 'Tübinger Straße', 'Olgastraße', 'Charlottenstraße', 'Wilhelmstraße', 'Cannstatter Str.'];
  const poleG = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    if ((i + j) % 2 && i !== 1) continue;
    const x = R[i] + ROAD / 2 + 2, z = R[j] + ROAD / 2 + 2;
    poleG.push(new THREE.CylinderGeometry(.05, .05, 3.2, 6).translate(x, 1.6, z));
    cull(sign([vn[i]], 1.6, .32, x - .06, 2.9, z, -Math.PI / 2, '#f4f4f4', '#111', 'bold 52px system-ui'), 70);
    cull(sign([hn[j]], 1.6, .32, x, 2.5, z - .06, Math.PI, '#f4f4f4', '#111', 'bold 52px system-ui'), 70);
  }
  scene.add(new THREE.Mesh(mergeGeometries(poleG), M(0x777b80, { metalness: .6 })));
}

// ===================================================================
// Ampeln (echte Schaltung: NPC-Autos halten bei Rot)
// ===================================================================
const TL_OFF = [...Array(N + 1)].map(() => [...Array(N + 1)].map(() => rand(0, 30)));
function signal(i, j, axis) {
  const t = (time + TL_OFF[i][j]) % 30;
  if (axis === 'x') return t < 11 ? 'g' : t < 14 ? 'y' : 'r';
  return t >= 15 && t < 26 ? 'g' : t >= 26 && t < 29 ? 'y' : 'r';
}
const tlHeads = [];
const TL = (() => {
  const e = ROAD / 2 + .8;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    tlHeads.push({ i, j, axis: 'x', x: R[i] - e, z: R[j] + e, ry: -Math.PI / 2 });
    tlHeads.push({ i, j, axis: 'x', x: R[i] + e, z: R[j] - e, ry: Math.PI / 2 });
    tlHeads.push({ i, j, axis: 'z', x: R[i] - e, z: R[j] - e, ry: Math.PI });
    tlHeads.push({ i, j, axis: 'z', x: R[i] + e, z: R[j] + e, ry: 0 });
  }
  const body = mergeGeometries([
    new THREE.CylinderGeometry(.07, .08, 3.6, 8).translate(0, 1.8, 0),
    new THREE.BoxGeometry(.34, 1.0, .24).translate(0, 3.15, .05),
    new THREE.BoxGeometry(.52, 1.2, .03).translate(0, 3.15, -.08),
    ...[3.47, 3.15, 2.83].map(y => new THREE.BoxGeometry(.26, .04, .14).translate(0, y + .12, .22)),
  ]);
  const poles = new THREE.InstancedMesh(body, M(0x2b2d30, { roughness: .6, metalness: .3 }), tlHeads.length);
  const lampGeo = new THREE.CircleGeometry(.095, 10);   // flache Leuchtscheibe statt Kugel (768 Lampen!)
  const lamps = [3.47, 3.15, 2.83].map(() => new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), tlHeads.length));
  const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), one = V(1, 1, 1);
  tlHeads.forEach((h, k) => {
    q.setFromAxisAngle(UP, h.ry);
    poles.setMatrixAt(k, mm.compose(V(h.x, 0, h.z), q, one));
    [3.47, 3.15, 2.83].forEach((y, l) => lamps[l].setMatrixAt(k, mm.compose(V(0, y, .175).applyQuaternion(q).add(V(h.x, 0, h.z)), q, one)));
  });
  scene.add(poles, ...lamps);
  return { poles, lamps, t: 0 };
})();
const LAMP_ON = [new THREE.Color(3, .25, .15), new THREE.Color(3, 1.8, .1), new THREE.Color(.2, 3, .6)];
const LAMP_OFF = [new THREE.Color(.12, .02, .02), new THREE.Color(.12, .09, .02), new THREE.Color(.02, .1, .04)];
function updLights(dt) {
  TL.t -= dt; if (TL.t > 0) return; TL.t = .2;
  tlHeads.forEach((h, k) => {
    const s = signal(h.i, h.j, h.axis), on = [s === 'r', s === 'y', s === 'g'];
    for (let l = 0; l < 3; l++) TL.lamps[l].setColorAt(k, on[l] ? LAMP_ON[l] : LAMP_OFF[l]);
  });
  TL.lamps.forEach(m => { m.instanceColor.needsUpdate = true; });
}

// ===================================================================
// Autobahn A8
// ===================================================================
{
  const HL = TS;                                   // A8 über die ganze Karte
  hwTex.repeat.set(1, 3000 / 24);
  const hwGeo = (len) => { const g = new THREE.PlaneGeometry(30, len).rotateX(-Math.PI / 2); g.attributes.uv.array.forEach((v, i, a) => { if (i % 2) a[i] = v * len / 3000; }); return g; };
  const hw = new THREE.Mesh(hwGeo(HL), MAT.hw);
  hw.rotation.y = Math.PI / 2; hw.position.set(0, .03, HZ); scene.add(hw);
  const conc = M(0xb0aea8), steel = M(0xb8bcc0, { metalness: .7, roughness: .35 });
  const rail = (x0, x1, z) => { if (x1 - x0 < 1) return; box(x1 - x0, .35, .12, steel, (x0 + x1) / 2, .7, z); colliders.push({ minX: x0, maxX: x1, minZ: z - .1, maxZ: z + .1 }); };
  box(HL, .9, .6, conc, 0, .45, HZ); colliders.push({ minX: -HL / 2, maxX: HL / 2, minZ: HZ - .3, maxZ: HZ + .3 });
  rail(-HL / 2, HL / 2, HZ + 15);
  const gap = R[3];
  // Nordseite mit Auffahrten (Stadt + A81)
  rail(-HL / 2, gap - 10, HZ - 15); rail(gap + 10, HX - 18, HZ - 15); rail(HX + 18, HL / 2, HZ - 15);
  const zl = HZ - 15 - (HALF + 8);
  const z = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, zl).rotateX(-Math.PI / 2), MAT.road);
  z.position.set(gap, .02, HALF + 8 + zl / 2); scene.add(z);
  // A81 nach Norden (Heilbronn)
  const z81a = -TS / 2, z81b = HZ - 15, L81 = z81b - z81a;
  const a81 = new THREE.Mesh(hwGeo(L81), MAT.hw); a81.position.set(HX, .035, (z81a + z81b) / 2); scene.add(a81);
  box(.6, .9, L81, conc, HX, .45, (z81a + z81b) / 2); colliders.push({ minX: HX - .3, maxX: HX + .3, minZ: z81a, maxZ: z81b });
  const railZ = (x, z0, z1) => { if (z1 - z0 < 1) return; box(.12, .35, z1 - z0, steel, x, .7, (z0 + z1) / 2); colliders.push({ minX: x - .1, maxX: x + .1, minZ: z0, maxZ: z1 }); };
  railZ(HX + 15, z81a, z81b); railZ(HX - 15, z81a, R[4] - 9); railZ(HX - 15, R[4] + 9, z81b);
  // Zubringer Stadt -> A81
  const cl = HX - 15 - (HALF + 8);
  const con = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, cl).rotateX(-Math.PI / 2), MAT.road); con.rotation.y = Math.PI / 2; con.position.set(HALF + 8 + cl / 2, .02, R[4]); scene.add(con);
  for (const gz of [-600, -1500]) {
    box(.4, 7, .4, steel, HX - 15.5, 3.5, gz); box(.4, 7, .4, steel, HX + 15.5, 3.5, gz); box(31, .5, .4, steel, HX, 7, gz);
    sign(['A81  Heilbronn ⬆', 'Stuttgart-Zuffenhausen'], 9, 3, HX + 7.5, 5.5, gz + .3, 0, '#1d4fa0', '#fff', 'bold 54px system-ui', 512, 170);
    sign(['A81  Stuttgart ⬆', 'A8 München / Karlsruhe'], 9, 3, HX - 7.5, 5.5, gz - .3, Math.PI, '#1d4fa0', '#fff', 'bold 54px system-ui', 512, 170);
  }
  // Bergstraße (folgt dem Gelände)
  {
    const pos = [], uv = [], idx = [], W = 4.6;
    mroadPts.forEach((p, i) => {
      const q = mroadPts[Math.min(i + 1, mroadPts.length - 1)], o = mroadPts[Math.max(i - 1, 0)];
      const dx = q.x - o.x, dz = q.z - o.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
      for (const s of [-1, 1]) { const x = p.x + nx * W * s, z = p.z + nz * W * s; pos.push(x, groundAt(x, z) + .12, z); uv.push(s < 0 ? 0 : 1, p.s / ROAD_L); }
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, MAT.road); m.receiveShadow = true; scene.add(m);
    // Leitpfosten links und rechts
    const posts = [];
    mroadPts.forEach((p, i) => { if (i % 12) return; const q = mroadPts[Math.min(i + 1, mroadPts.length - 1)], dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1; for (const s of [-1, 1]) { const x = p.x - dz / l * 5.6 * s, z = p.z + dx / l * 5.6 * s; posts.push(new THREE.BoxGeometry(.12, 1, .12).translate(x, groundAt(x, z) + .5, z)); } });
    scene.add(new THREE.Mesh(mergeGeometries(posts), M(0xf2f2f2)));
    sign(['Bergstraße', 'Fernsehturm 1,5 km'], 2.6, 1.2, 50, 2.6, -318, 0, '#f4f4f4', '#111', 'bold 52px system-ui', 512, 240);
  }
  // Fernsehturm Stuttgart (217 m)
  {
    const by = groundAt(TVT.x, TVT.z), concT = M(0xc9c6bf, { roughness: .85 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 5.4, 136, 32), concT); shaft.position.set(TVT.x, by + 68, TVT.z); scene.add(shaft);
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 6.6, 15, 32), concT); basket.position.set(TVT.x, by + 143, TVT.z); scene.add(basket);
    const win = new THREE.Mesh(new THREE.CylinderGeometry(7.7, 7.2, 5, 32, 1, true), M(0x1b2530, { metalness: .8, roughness: .1 })); win.position.set(TVT.x, by + 141, TVT.z); scene.add(win);
    box(17, .6, 17, concT, TVT.x, by + 151, TVT.z).rotation.y = .4;
    for (let i = 0; i < 8; i++) { const seg = new THREE.Mesh(new THREE.CylinderGeometry(.7 - i * .06, .75 - i * .06, 8, 12), M(i % 2 ? 0xffffff : 0xc81e1e)); seg.position.set(TVT.x, by + 155 + i * 8, TVT.z); scene.add(seg); }
    colliders.push({ minX: TVT.x - 5.5, maxX: TVT.x + 5.5, minZ: TVT.z - 5.5, maxZ: TVT.z + 5.5 });
    // kann angezündet werden (Feuerzeug unten am Turm): das Feuer frisst sich langsam nach oben
    addFlammable({ kind: 'building', tower: true, box: new THREE.Box3(new THREE.Vector3(TVT.x - 5.8, by, TVT.z - 5.8), new THREE.Vector3(TVT.x + 5.8, by + 158, TVT.z + 5.8)), mats: [concT], duration: 480 });
    sign(['FERNSEHTURM', 'STUTTGART'], 6, 2.2, TVT.x, by + 4, TVT.z + 5.8, 0, '#1d1d1d', '#ffffff', 'bold 60px system-ui', 512, 190);
    // Parkplatz oben
    const lot = new THREE.Mesh(new THREE.CircleGeometry(40, 32).rotateX(-Math.PI / 2), MAT.lot); lot.position.set(TVT.x, by + .08, TVT.z); scene.add(lot);
  }
  // Wald auf den Bergen
  for (let k = 0; k < 9000; k++) {
    const x = (hash2(k, 1) - .5) * TS * .96, z = (hash2(k, 2) - .5) * TS * .96, h = groundAt(x, z);
    if (h < 6 || Math.abs(z - HZ) < 60 || (Math.abs(x - HX) < 60 && z < HZ)) continue;
    let nearRoad = false; for (let i = 0; i < mroadPts.length; i += 3) if ((mroadPts[i].x - x) ** 2 + (mroadPts[i].z - z) ** 2 < 400) { nearRoad = true; break; }
    if (nearRoad || Math.hypot(x - TVT.x, z - TVT.z) < 70) continue;
    tree(x, z, .9 + hash2(k, 3) * .8, h - .2);
  }
  for (const gx of [220, -260]) {
    box(.4, 7, .4, steel, gx, 3.5, HZ - 15.5); box(.4, 7, .4, steel, gx, 3.5, HZ + 15.5); box(.4, .5, 31, steel, gx, 7, HZ);
    sign(['A8  München ➜', 'Stuttgart-Vaihingen'], 9, 3, gx - .3, 5.5, HZ + 7.5, -Math.PI / 2, '#1d4fa0', '#fff', 'bold 54px system-ui', 512, 170);
    sign(['A8  Karlsruhe ➜', 'Stuttgart-Zentrum'], 9, 3, gx + .3, 5.5, HZ - 7.5, Math.PI / 2, '#1d4fa0', '#fff', 'bold 54px system-ui', 512, 170);
  }
  for (let x = -1400; x < 1400; x += 22) { tree(x + rand(-4, 4), HZ + 22 + rand(0, 15), rand(1, 1.6)); tree(x + rand(-4, 4), HZ - 24 - rand(0, 10), rand(1, 1.6)); }
}

// ===================================================================
// Blöcke
// ===================================================================
const WALLS = ['#f2ead8', '#e9e2d3', '#dfe6ea', '#f3dfc4', '#dde6d6', '#f7f0e2', '#ecd6c4', '#f0ece6', '#e6dccb'];
function blockType(bx, bz) {
  if (bx === 1 && bz === 5) return 'tank';
  if (bx === 5 && bz === 5) return 'tank';
  if (bx === 5 && bz === 1) return 'school';
  if (bx === 1 && bz === 1) return 'market';
  if (bx === 3 && bz === 4) return 'park';
  if (bx >= 2 && bx <= 4 && bz >= 2 && bz <= 3) return 'downtown';
  if (bx === 0 || bx === 6 || bz === 0 || bz === 6) return 'houses';
  return 'apts';
}
const walkGeos = [];
const POI = {};
let SPAWN = null;
for (let bx = 0; bx < N; bx++) for (let bz = 0; bz < N; bz++) {
  const cx = bc(bx), cz = bc(bz), type = blockType(bx, bz);
  blocks.push({ bx, bz, cx, cz, type });
  if (type !== 'tank') walkGeos.push(new THREE.BoxGeometry(BLOCK, .15, BLOCK).translate(cx, .075, cz));
  if (type === 'downtown') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      building(cx + sx * 16, cz + sz * 16, 27, 27, rand(24, 70), 'apt', pick(['#d8d4cc', '#e6e1d6', '#cfd3d6', '#e9dcc8']));
    }
  } else if (type === 'apts') {
    for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) {
      building(cx + sx * 16, cz + sz * 21, 27, 18, rand(12, 22), 'apt', pick(WALLS), { shops: true, front: [sx, 0] });
      shopSpots.push([cx + sx * (16 + 13.5 + .09), cz + sz * 21, sx]);
    }
    tree(cx, cz, 1.2);
  } else if (type === 'houses') {
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
      if (ix === 0 && iz === 0) { tree(cx, cz, 1.4); tree(cx + 5, cz - 4); continue; }
      const x = cx + ix * 21.5, z = cz + iz * 21.5;
      house(x, z, pick([9, 12]), 9, pick(WALLS), ix ? [ix, 0] : [0, iz]);
      tree(x + 7, z + 7, rand(.7, 1.1));
    }
  } else if (type === 'school') {
    building(cx, cz - 20, 54, 12, 12, 'apt', '#f0c896', { front: [0, 1], enter: 'school' });
    building(cx - 22, cz + 2, 12, 30, 12, 'apt', '#f0c896');
    building(cx + 22, cz + 2, 12, 30, 9, 'apt', '#e6ecef');
    sign(['Grundschule', 'am Hasenberg'], 10, 2.5, cx, 10.5, cz - 13.8, 0, '#244a7a', '#fff', 'bold 56px system-ui', 512, 128);
    const ft = (() => { const [c, g] = C(256, 160); g.fillStyle = '#3f7a35'; g.fillRect(0, 0, 256, 160); g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(8, 8, 240, 144); g.beginPath(); g.moveTo(128, 8); g.lineTo(128, 152); g.stroke(); g.beginPath(); g.arc(128, 80, 22, 0, 7); g.stroke(); return T(c, false); })();
    const f = new THREE.Mesh(new THREE.PlaneGeometry(30, 20).rotateX(-Math.PI / 2), M(0xffffff, { map: ft }));
    f.position.set(cx, .17, cz + 14); scene.add(f);
    for (const s of [-1, 1]) { const gm = M(0xffffff); box(.1, 2, .1, gm, cx + s * 14.5, 1, cz + 12.5); box(.1, 2, .1, gm, cx + s * 14.5, 1, cz + 15.5); box(.1, .1, 3, gm, cx + s * 14.5, 2, cz + 14); }
    POI.Schule = [cx, cz];
  } else if (type === 'market') {
    building(cx + 8, cz - 10, 44, 30, 7, 'shop', '#d9d9d9', { front: [0, 1], enter: 'market' });
    sign(['SUPERMARKT'], 14, 2.2, cx + 8, 5.8, cz + 5.1, 0, '#c8102e', '#fff', 'bold 80px system-ui');
    for (let i = 0; i < 6; i++) prop('crate', cx - 18 + i * .9, 0, cz - 26);
    prop('bin', cx - 25, 0, cz - 20); prop('bag', cx - 23.5, 0, cz - 21);
    POI.Supermarkt = [cx, cz];
  } else if (type === 'park') {
    const pg0 = new THREE.PlaneGeometry(BLOCK - 6, BLOCK - 6).rotateX(-Math.PI / 2); pg0.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 16; });
    const p = new THREE.Mesh(pg0, MAT.park);
    p.position.set(cx, .16, cz); scene.add(p);
    const path = M(0xc9b48a, { roughness: 1 });
    box(4, .02, BLOCK - 6, path, cx, .17, cz); box(BLOCK - 6, .02, 4, path, cx, .17, cz);
    const fo = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.3, .7, 24), M(0xb5b0a5)); fo.position.set(cx, .5, cz); scene.add(fo);
    const wa = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, .1, 24), M(0x3a6f8f, { roughness: .1, metalness: .3 })); wa.position.set(cx, .8, cz); scene.add(wa);
    for (let i = 0; i < 26; i++) { const a = rand(0, 7), r = rand(9, 30); tree(cx + Math.cos(a) * r, cz + Math.sin(a) * r, rand(1, 1.5)); }
    for (const [x, z, ry] of [[6, 10, 0], [-6, -10, Math.PI], [10, 6, -Math.PI / 2], [-10, -6, Math.PI / 2]]) prop('bench', cx + x, .15, cz + z, ry);
    POI.Park = [cx, cz];
  } else if (type === 'tank') {
    buildTankstelle(cx, cz, bx === 1);
  }
  if (type !== 'tank') {
    prop('bin', cx - BLOCK / 2 + 2.2, .15, cz - BLOCK / 2 + 5, Math.PI / 2);
    prop('bag', cx - BLOCK / 2 + 1.6, .15, cz - BLOCK / 2 + 7.3);
    if ((bx + bz) % 2) prop('ubox', cx + BLOCK / 2 - 1.2, .15, cz + BLOCK / 2 - 5, -Math.PI / 2);
  }
}
{
  walkTex.repeat.set(BLOCK / 4, BLOCK / 4);
  scene.add(new THREE.Mesh(mergeGeometries(walkGeos), MAT.walk));
}
// Bodenhöhe inkl. Gehwege: die Blöcke liegen 15 cm höher (Bordstein) – Räder und Füße stehen darauf statt darin zu versinken
function surfaceAt(x, z) {
  const g = groundAt(x, z), i = Math.floor((x + HALF) / P), j = Math.floor((z + HALF) / P);
  if (i < 0 || j < 0 || i >= N || j >= N) return g;
  const b = blocks[i * N + j];
  if (!b || Math.abs(x - b.cx) > BLOCK / 2 || Math.abs(z - b.cz) > BLOCK / 2) return g;
  return g + (b.type === 'tank' ? .02 : .15);
}
// ===================================================================
// Begehbare Gebäude: Schule, Supermarkt, Tankstellen-Shop – echte Tür (automatische Schiebetür), Innenraum, Einrichtung
// ===================================================================
const interiors = [], slideDoors = [];
// Material, das wie von Deckenlampen beleuchtet aussieht (leuchtet leicht in der eigenen Farbe – keine echte Lampe nötig)
function roomMat(o = {}, lift = .42) {
  const m = new THREE.MeshStandardMaterial({ roughness: .85, ...o });
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * ' + lift.toFixed(2) + ';'); };
  m.customProgramCacheKey = () => 'room' + lift.toFixed(2);
  return m;
}
const ITEX = (() => {
  const tiles = (() => { const [c, g] = C(256, 256); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = '#bdb8ae'; g.fillRect(i * 64, j * 64, 64, 64); g.fillStyle = (i + j) % 2 ? '#e4e1da' : '#d6d2ca'; g.fillRect(i * 64 + 1, j * 64 + 1, 62, 62); } return T(c); })();
  const lino = (() => { const [c, g] = C(256, 256); g.fillStyle = '#b89d74'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 16; i++) { g.fillStyle = `rgba(${90 + rand(0, 40)},${60 + rand(0, 30)},${30 + rand(0, 20)},.2)`; g.fillRect(0, i * 16, 256, 15); } return T(c); })();
  const goods = (() => {                                              // Regalware: Reihen bunter Packungen
    const [c, g] = C(512, 256); g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 4; row++) {
      const y0 = row * 64; g.fillStyle = '#8f969c'; g.fillRect(0, y0 + 58, 512, 6);
      let x = 2; while (x < 508) { const w = rand(14, 34), h = rand(30, 54); g.fillStyle = `hsl(${rand(0, 360)},${rand(40, 85)}%,${rand(35, 60)}%)`; g.fillRect(x, y0 + 58 - h, w - 2, h); g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(x + 2, y0 + 58 - h * .6, w - 6, h * .22); x += w; }
    }
    return T(c);
  })();
  const drinks = (() => {                                             // Kühlschrank: Flaschen hinter Glas
    const [c, g] = C(512, 256); g.fillStyle = '#dfe9ef'; g.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 5; row++) { const y0 = row * 51; g.fillStyle = '#b8c4cc'; g.fillRect(0, y0 + 47, 512, 4); for (let x = 3; x < 508; x += 13) { g.fillStyle = `hsl(${pick([0, 30, 120, 200, 45, 280, 15])},70%,${rand(35, 55)}%)`; g.fillRect(x, y0 + 12, 10, 35); g.fillRect(x + 3, y0 + 6, 4, 7); } }
    g.strokeStyle = '#8899a6'; g.lineWidth = 5; for (let x = 0; x <= 512; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
    return T(c);
  })();
  const board = lines => { const [c, g] = C(512, 160); g.fillStyle = '#1f4a33'; g.fillRect(0, 0, 512, 160); g.fillStyle = 'rgba(240,240,230,.92)'; g.font = '600 25px system-ui'; g.textBaseline = 'top'; lines.forEach((l, i) => g.fillText(l, 22, 14 + i * 34)); return T(c, false); };
  const notes = (() => { const [c, g] = C(256, 160); g.fillStyle = '#b8895a'; g.fillRect(0, 0, 256, 160); [['Schulfest Fr.', '#fff59d'], ['AG Fußball', '#b3e5fc'], ['Mensa: Nudeln', '#c8e6c9'], ['Fundsachen', '#ffccbc'], ['Lesewoche!', '#e1bee7']].forEach(([t, col], i) => { const x = 10 + (i % 3) * 82, y = 12 + Math.floor(i / 3) * 74; g.fillStyle = col; g.fillRect(x, y, 74, 62); g.fillStyle = '#c62828'; g.beginPath(); g.arc(x + 37, y + 7, 4, 0, 7); g.fill(); g.fillStyle = '#333'; g.font = '600 12px system-ui'; g.fillText(t, x + 4, y + 32); }); return T(c, false); })();
  const signs = (() => { const [c, g] = C(512, 256); ['Obst & Gemüse', 'Getränke', 'Backwaren', 'Süßes & Snacks'].forEach((t, i) => { g.fillStyle = ['#2e7d32', '#1565c0', '#a1662f', '#c2185b'][i]; g.fillRect(0, i * 64, 512, 64); g.fillStyle = '#fff'; g.font = 'bold 40px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 256, i * 64 + 33); }); return T(c, false); })();
  return { tiles, lino, goods, drinks, board, notes, signs };
})();
function buildInteriors() {
  const goodsM = roomMat({ map: ITEX.goods, roughness: .7 }, .45);
  const drinkM = new THREE.MeshStandardMaterial({ map: ITEX.drinks, emissive: 0xffffff, emissiveMap: ITEX.drinks, emissiveIntensity: .55, roughness: .25 });
  const glassM = new THREE.MeshStandardMaterial({ color: 0xbfd8e6, metalness: .2, roughness: .05, transparent: true, opacity: .28, side: THREE.DoubleSide });
  const frameM = M(0x2b2f35, { metalness: .6, roughness: .4 });
  for (const S of enterSpecs) {
    // lokales Raster: Eingang zeigt nach +z, Türloch zwischen d0 und d1 (x)
    const [fx, fz] = S.front, rot = Math.atan2(fx, fz), along = fz !== 0;
    const HX = (along ? S.w : S.d) / 2, HZ = (along ? S.d : S.w) / 2, TW = .3, ix = HX - TW, iz = HZ - TW;
    // Boden knapp über dem Gehweg; an der Tankstelle etwas höher (der Asphalt dort wird nach vorne gezogen)
    const y0 = surfaceAt(S.x, S.z) + (S.kind === 'shop' ? .06 : .012);
    const H = S.kind === 'school' || S.kind === 'home' ? 2.95 : Math.min(S.h - .35, S.kind === 'market' ? 4.2 : 3.3);   // Raumhöhe
    let d0, d1;
    if (S.kit) { const L = 2 * HX, bays = Math.max(1, Math.round(L / 3)), bw = L / bays, i = Math.floor(bays / 2); d0 = -HX + i * bw; d1 = d0 + bw; }   // dort, wo die Fassade die Tür hat
    else { const DW = S.kind === 'market' ? 2.8 : 2.2; d0 = -DW / 2; d1 = DW / 2; }
    const DH = S.kit ? 2.7 : 2.5, WALL = S.kind === 'school' ? 0xf2ead8 : 0xf3f1ec;
    const grp = new THREE.Group(), ext = new THREE.Group();
    for (const o of [grp, ext]) { o.position.set(S.x, y0, S.z); o.rotation.y = rot; scene.add(o); }
    const toW = (x, z) => V(x, 0, z).applyAxisAngle(UP, rot).add(V(S.x, 0, S.z));
    const col = (x0, x1, z0, z1) => { const a = toW(x0, z0), b = toW(x1, z1); colliders.push({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) }); };
    const vc = [], emi = [], tex = new Map(), etex = new Map();
    const paint = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const bx = (w, h, d, x, y, z, hex, list = vc) => { const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z); g.deleteAttribute('uv'); list.push(paint(g, hex)); };
    const quad = (pts, uv, hex, list) => {                              // 4 Ecken, von vorne gesehen gegen den Uhrzeigersinn
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
      if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); if (hex !== undefined) paint(g, hex);
      list.push(g); return g;
    };
    const tq = (mat, pts, uv, map = tex) => { if (!map.has(mat)) map.set(mat, []); quad(pts, uv, undefined, map.get(mat)); };
    const U4 = [0, 0, 1, 0, 1, 1, 0, 1];
    // ---- Raum: Boden, Decke, Wände (vorne mit Türloch), Laibung ----
    const rep = S.kind === 'school' ? 2.5 : 1.6;
    tq(roomMat({ map: S.kind === 'school' ? ITEX.lino : ITEX.tiles, roughness: .55 }, .35), [[-ix, 0, iz], [ix, 0, iz], [ix, 0, -iz], [-ix, 0, -iz]], [0, 0, 2 * ix / rep, 0, 2 * ix / rep, 2 * iz / rep, 0, 2 * iz / rep]);
    quad([[-ix, H, -iz], [ix, H, -iz], [ix, H, iz], [-ix, H, iz]], null, 0xd9d9d4, emi);   // Decke: hell (von den Lampen angestrahlt)
    quad([[-ix, 0, -iz], [ix, 0, -iz], [ix, H, -iz], [-ix, H, -iz]], null, WALL, vc);
    quad([[-ix, 0, iz], [-ix, 0, -iz], [-ix, H, -iz], [-ix, H, iz]], null, WALL, vc);
    quad([[ix, 0, -iz], [ix, 0, iz], [ix, H, iz], [ix, H, -iz]], null, WALL, vc);
    const front = (xa, xb, ya, yb) => quad([[xb, ya, iz], [xa, ya, iz], [xa, yb, iz], [xb, yb, iz]], null, WALL, vc);
    front(-ix, d0, 0, H); front(d1, ix, 0, H); front(d0, d1, DH, H);
    const zo = HZ + .04, JC = 0xcfcac2;
    quad([[d0, 0, zo], [d0, 0, iz], [d0, DH, iz], [d0, DH, zo]], null, JC, vc);
    quad([[d1, 0, iz], [d1, 0, zo], [d1, DH, zo], [d1, DH, iz]], null, JC, vc);
    quad([[d0, DH, iz], [d1, DH, iz], [d1, DH, zo], [d0, DH, zo]], null, JC, vc);
    col(-HX, d0, iz, HZ); col(d1, HX, iz, HZ); col(-HX, HX, -HZ, -iz); col(-HX, -ix, -HZ, HZ); col(ix, HX, -HZ, HZ);
    // ---- außen: Laden-Gebäude bekommen eine eigene Hülle mit Türloch (die Kiste wird unsichtbar, bleibt für Treffer) ----
    if (!S.kit) {
      const mF = along ? S.mz : S.mx, mS = along ? S.mx : S.mz, h = S.h - y0, zf = HZ + .001, u = x => (x + HX) / (2 * HX);
      const fq = (xa, xb, ya, yb) => tq(mF, [[xa, ya, zf], [xb, ya, zf], [xb, yb, zf], [xa, yb, zf]], [u(xa), (ya + y0) / S.h, u(xb), (ya + y0) / S.h, u(xb), (yb + y0) / S.h, u(xa), (yb + y0) / S.h], etex);
      fq(-HX, d0, -y0, h); fq(d1, HX, -y0, h); fq(d0, d1, DH, h);
      tq(mF, [[HX, -y0, -zf], [-HX, -y0, -zf], [-HX, h, -zf], [HX, h, -zf]], U4, etex);
      tq(mS, [[-HX - .001, -y0, -HZ], [-HX - .001, -y0, HZ], [-HX - .001, h, HZ], [-HX - .001, h, -HZ]], U4, etex);
      tq(mS, [[HX + .001, -y0, HZ], [HX + .001, -y0, -HZ], [HX + .001, h, -HZ], [HX + .001, h, HZ]], U4, etex);
      tq(S.roof, [[-HX, h, HZ], [HX, h, HZ], [HX, h, -HZ], [-HX, h, -HZ]], U4, etex);
      S.ent.mesh.material = HIDDEN;
    } else quad([[d0, DH, HZ + .035], [d1, DH, HZ + .035], [d1, 3 - y0, HZ + .035], [d0, 3 - y0, HZ + .035]], null, new THREE.Color(S.wall).getHex(), vc);   // Sturz über der Tür (Fassade)
    // ---- automatische Schiebetür aus Glas ----
    const dw = (d1 - d0) / 2, panel = () => {
      const p = new THREE.Group(), gl = new THREE.Mesh(new THREE.PlaneGeometry(dw - .04, DH - .06), glassM); gl.position.y = DH / 2; p.add(gl);
      for (const [w, h, x, y] of [[.05, DH, -dw / 2 + .025, DH / 2], [.05, DH, dw / 2 - .025, DH / 2], [dw, .06, 0, DH - .03], [dw, .1, 0, .05]]) { const b = new THREE.Mesh(BOX, frameM); b.scale.set(w, h, .05); b.position.set(x, y, 0); p.add(b); }
      p.position.z = HZ - .14; grp.add(p); return p;
    };
    const sd = { L: panel(), R: panel(), d0, d1, dw, c: toW((d0 + d1) / 2, HZ).setY(y0 + 1), k: 1, open: false, lock: S.home };
    slideDoors.push(sd);
    const reg = (x, y, z, name, cash, stars, t) => robSpots.push({ kind: 'kasse', name, p: toW(x, z).setY(y0 + y), cash, stars, time: t, cool: 0 });   // Kasse zum Ausrauben
    if (S.home !== undefined) {                                           // Haus zum Kaufen: Tür ist zu, nur für den Besitzer offen
      const a = toW(d0, HZ - .3), b = toW(d1, HZ); colliders.push({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z), lock: S.home });
      const H0 = homes[S.home]; H0.door = toW((d0 + d1) / 2, HZ + 2.5); H0.y0 = y0;
      // Schild im Vorgarten
      const [sc, sg2] = C(256, 128), stex = T(sc, false); H0.signG = sg2; H0.signT = stex;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .6), new THREE.MeshBasicMaterial({ map: stex, side: THREE.DoubleSide })); sign.position.set(d1 + 1.6, 1.25, HZ + 1.8); ext.add(sign);
      const post = new THREE.Mesh(BOX, M(0x6d4c41)); post.scale.set(.06, 1.2, .06); post.position.set(d1 + 1.6, .6, HZ + 1.78); ext.add(post);
      H0.drawSign = mine => { sg2.fillStyle = mine ? '#1f6b35' : '#c62828'; sg2.fillRect(0, 0, 256, 128); sg2.fillStyle = '#fff'; sg2.textAlign = 'center'; sg2.textBaseline = 'middle'; sg2.font = 'bold 34px system-ui'; sg2.fillText(mine ? 'DEIN HAUS' : 'ZU VERKAUFEN', 128, 46); sg2.font = '600 28px system-ui'; sg2.fillText(mine ? 'Willkommen!' : H0.price.toLocaleString('de-DE') + ' €', 128, 92); stex.needsUpdate = true; };
      H0.drawSign(false);
    }
    // ---- Einrichtung ----
    if (S.kind === 'market') {
      for (const x of [-16, -11, -6, 5, 10, 15]) {                      // Regalreihen, beidseitig mit Ware
        const z0 = -10.5, z1 = 4, L = z1 - z0, zc = (z0 + z1) / 2;
        bx(1, 2, L, x, 1, zc, 0x9aa0a6); bx(1.06, .08, L + .06, x, 2.04, zc, 0x7d848b);
        tq(goodsM, [[x + .531, .1, z1], [x + .531, .1, z0], [x + .531, 1.95, z0], [x + .531, 1.95, z1]], [0, 0, L / 3, 0, L / 3, 1, 0, 1]);
        tq(goodsM, [[x - .531, .1, z0], [x - .531, .1, z1], [x - .531, 1.95, z1], [x - .531, 1.95, z0]], [0, 0, L / 3, 0, L / 3, 1, 0, 1]);
        col(x - .55, x + .55, z0, z1);
      }
      bx(40, 2.2, .9, 0, 1.1, -iz + .45, 0xeef1f3);                       // Kühlregale hinten
      tq(drinkM, [[-20, .15, -iz + .91], [20, .15, -iz + .91], [20, 2, -iz + .91], [-20, 2, -iz + .91]], [0, 0, 10, 0, 10, 1, 0, 1]);
      col(-20, 20, -iz, -iz + .9);
      for (const x of [-6, -10.5, -15]) {                                 // Kassen am Eingang
        bx(.8, .9, 2.6, x, .45, 8.3, 0x3a3f46); bx(.62, .02, 2.4, x, .91, 8.3, 0x111111); bx(.35, .25, .3, x - .15, 1.05, 9.3, 0x222831); bx(.06, .5, .06, x - .3, 1.15, 7.2, 0x888888); bx(.5, .9, .5, x + .75, .45, 9.4, 0x5b6470);
        col(x - .4, x + .4, 7, 9.6); reg(x - .15, 1.05, 9.3, 'Supermarkt-Kasse', [250, 600], 2, 4);
      }
      const fruit = [0x7cb342, 0xff9800, 0xfdd835, 0xe53935, 0x8e24aa, 0x43a047];
      for (let i = 0; i < 6; i++) {                                     // Obst & Gemüse
        const x = 8 + (i % 3) * 3.2, z = 8.3 + Math.floor(i / 3) * 2.2;
        bx(2.6, .7, 1.6, x, .35, z, 0x8d6e4b); bx(2.4, .12, 1.4, x, .76, z, fruit[i]);
        for (let k = 0; k < 10; k++) bx(.12, .12, .12, x + rand(-1.05, 1.05), .86, z + rand(-.55, .55), fruit[i]);
        col(x - 1.3, x + 1.3, z - .8, z + .8);
      }
      const signM = roomMat({ map: ITEX.signs, side: THREE.DoubleSide }, .6);
      for (const [x, z, row] of [[11.2, 6.2, 0], [0, -11.8, 1], [-8.5, -1.5, 2], [7.5, -1.5, 3]]) {   // Schilder über den Gängen
        const v0 = 1 - (row + 1) / 4, v1 = 1 - row / 4;
        tq(signM, [[x - 1.5, 3, z], [x + 1.5, 3, z], [x + 1.5, 3.7, z], [x - 1.5, 3.7, z]], [0, v0, 1, v0, 1, v1, 0, v1]);
        for (const s of [-1.3, 1.3]) bx(.02, H - 3.7, .02, x + s, (3.7 + H) / 2, z, 0x555555);
      }
      for (const x of [-14, -4, 6, 16]) bx(.3, .05, 22, x, H - .03, -2, 0xffffff, emi);   // Lichtbänder
    } else if (S.kind === 'school') {
      for (const x of [-9, 9]) {                                        // Trennwände: Flur in der Mitte, links/rechts Klassenzimmer
        for (const [z0, z1] of [[-iz, -.7], [.7, iz]]) { bx(.15, H, z1 - z0, x, H / 2, (z0 + z1) / 2, WALL); col(x - .08, x + .08, z0, z1); }
        bx(.15, H - 2.3, 1.4, x, (H + 2.3) / 2, 0, WALL);
      }
      for (let i = 0; i < 26; i++) { const x = -7.2 + i * .56; bx(.54, 1.85, .45, x, .925, -iz + .23, i % 2 ? 0x2f6db5 : 0x3b82c4); bx(.04, .2, .02, x + .18, 1.05, -iz + .465, 0xd0d0d0); }   // Spinde
      col(-7.5, 7.3, -iz, -iz + .45);
      bx(2.4, .45, .4, -2, .225, 0, 0x8d6e4b); col(-3.2, -.8, -.2, .2);   // Bank
      tq(roomMat({ map: ITEX.notes }, .5), [[-8.92, 1.1, 2.6], [-8.92, 1.1, 1], [-8.92, 2.1, 1], [-8.92, 2.1, 2.6]], U4);   // Pinnwand
      for (const x of [-1.6, 4.6]) { bx(.5, .5, .5, x, .25, iz - .6, 0x6d4c41); bx(.8, .9, .8, x, .95, iz - .6, 0x2e7d32); }   // Pflanzen
      const room = (sg, lines) => {
        const xb = sg * (ix - .02), bm = roomMat({ map: ITEX.board(lines) }, .3);
        tq(bm, sg < 0 ? [[xb, 1, 2.2], [xb, 1, -2.2], [xb, 2.35, -2.2], [xb, 2.35, 2.2]] : [[xb, 1, -2.2], [xb, 1, 2.2], [xb, 2.35, 2.2], [xb, 2.35, -2.2]], U4);   // Tafel
        bx(.05, 1.5, 4.6, xb + sg * .03, 1.675, 0, 0x6d4c41); bx(.08, .05, 4.4, xb - sg * .05, .97, 0, 0x8d6e4b);
        const xt = sg * (ix - 2); bx(.8, .76, 1.6, xt, .38, -2.8, 0x8d6e4b); bx(.5, .45, .5, xt + sg * .6, .225, -2.8, 0x37474f); col(xt - .4, xt + .4, -3.6, -2);   // Lehrerpult
        for (let r = 0; r < 4; r++) for (const z of [-3.2, 0, 3.2]) {   // Zweiertische + Stühle, Blick zur Tafel
          const x = sg * (ix - 4.5 - r * 2.6);
          bx(.6, .04, 1.3, x, .74, z, 0xc8a679);
          for (const dz of [-.6, .6]) for (const dx of [-.26, .26]) bx(.04, .72, .04, x + dx, .36, z + dz, 0x555b61);
          for (const dz of [-.33, .33]) { const xc = x - sg * .55; bx(.42, .04, .4, xc, .44, z + dz, 0x1e88e5); bx(.04, .4, .4, xc - sg * .2, .66, z + dz, 0x1e88e5); bx(.03, .42, .03, xc, .21, z + dz, 0x555b61); }
          col(x - .3, x + .3, z - .65, z + .65);
        }
        for (let k = 0; k < 3; k++) bx(2.2, 1.4, .02, sg * (12 + k * 5), 1.75, -iz + .015, 0xcfe8ff, emi);   // Fenster (Tageslicht)
      };
      room(-1, ['Mathe 3b', '12 + 7 = 19', '8 · 6 = 48', 'Hausaufgabe: S. 42 Nr. 3']);
      room(1, ['Deutsch 4a', 'Der Hase springt über die Wiese.', 'Nomen, Verben, Adjektive']);
      for (const x of [-21, -14, -4, 4, 14, 21]) for (const z of [-2.5, 2.5]) bx(1.2, .04, 1.2, x, H - .02, z, 0xffffff, emi);
    } else if (S.kind === 'home') {                                     // eigenes Haus: Wohnzimmer, Schlafecke, Küche
      bx(2.2, .45, .85, -1.2, .225, -iz + .5, 0x4f5d7a); bx(2.2, .5, .2, -1.2, .7, -iz + .12, 0x4f5d7a); for (const s of [-1, 1]) bx(.2, .6, .85, -1.2 + s * 1.1, .3, -iz + .5, 0x43506b);   // Sofa
      bx(1.1, .4, .6, -1.2, .2, -iz + 1.9, 0x8d6e4b); bx(2.6, .01, 1.8, -1.2, .006, -iz + 1.7, 0xb03a2e);   // Couchtisch + Teppich
      bx(.08, .75, 1.3, -ix + .05, 1.25, -iz + 2.2, 0x111111); bx(.02, .65, 1.2, -ix + .1, 1.25, -iz + 2.2, 0x3d7bd9, emi); bx(.4, .5, 1.3, -ix + .22, .25, -iz + 2.2, 0x5d4037);   // Fernseher
      bx(1.6, .45, 2.1, ix - .9, .225, -iz + 1.15, 0xf2f2f2); bx(1.6, .2, .9, ix - .9, .55, -iz + 1.5, 0x3f7fbf); bx(1.6, .9, .1, ix - .9, .45, -iz + .06, 0x6d4c41); bx(.7, .12, .4, ix - .9, .52, -iz + .35, 0xffffff);   // Bett
      bx(.65, .9, 2.4, ix - .33, .45, iz - 2.2, 0xdedede); bx(.7, .04, 2.45, ix - .33, .92, iz - 2.2, 0x37474f); bx(.7, 1.85, .7, ix - .35, .925, iz - 4, 0xf5f5f5);   // Küche + Kühlschrank
      bx(.6, .05, .6, 0, H - .03, 0, 0xfff3d6, emi);                         // Deckenlampe
      col(-2.4, 0, -iz, -iz + .95); col(ix - 1.7, ix, -iz, -iz + 2.2); col(ix - .7, ix, iz - 4.4, iz - 1);
    } else {                                                            // Tankstellen-Shop
      bx(5, 1.05, .8, 6.5, .525, 2.2, 0x37474f); bx(5.1, .05, .9, 6.5, 1.075, 2.2, 0xb0bec5); bx(.4, .3, .35, 5.2, 1.25, 2.2, 0x212121);   // Theke + Kasse
      bx(.35, .45, .35, 8.4, 1.32, 2.15, 0x5d4037); bx(.2, .1, .2, 8.4, 1.6, 2.15, 0xc62828); col(4, 9, 1.8, 2.6);   // Kaffeemaschine
      reg(5.2, 1.25, 2.2, 'Tankstellen-Kasse', [300, 700], 2, 4);
      bx(.5, 2.2, 5, ix - .25, 1.1, 1.5, 0x8d8d8d); tq(goodsM, [[ix - .51, .2, -1], [ix - .51, .2, 4], [ix - .51, 2.1, 4], [ix - .51, 2.1, -1]], [0, 0, 5 / 3, 0, 5 / 3, 1, 0, 1]); col(ix - .5, ix, -1, 4);
      for (const x of [-6.5, -2.5]) {                                   // Snack-Regale
        const z0 = -4, z1 = 2, L = z1 - z0;
        bx(.9, 1.6, L, x, .8, -1, 0x9aa0a6);
        tq(goodsM, [[x + .451, .1, z1], [x + .451, .1, z0], [x + .451, 1.55, z0], [x + .451, 1.55, z1]], [0, 0, L / 3, 0, L / 3, .75, 0, .75]);
        tq(goodsM, [[x - .451, .1, z0], [x - .451, .1, z1], [x - .451, 1.55, z1], [x - .451, 1.55, z0]], [0, 0, L / 3, 0, L / 3, .75, 0, .75]);
        col(x - .45, x + .45, z0, z1);
      }
      bx(12, 2.1, .8, -3.5, 1.05, -iz + .4, 0xeef1f3); tq(drinkM, [[-9.5, .15, -iz + .81], [2.5, .15, -iz + .81], [2.5, 1.95, -iz + .81], [-9.5, 1.95, -iz + .81]], [0, 0, 3, 0, 3, 1, 0, 1]); col(-9.5, 2.5, -iz, -iz + .8);
      for (const z of [-1.5, 1.5]) { const x = -9.4; bx(.08, 1.05, .08, x, .525, z, 0x444444); bx(.7, .04, .7, x, 1.07, z, 0xd7ccc8); bx(.45, .03, .45, x, .015, z, 0x444444); col(x - .35, x + .35, z - .35, z + .35); }   // Stehtische
      for (const x of [-7, -2, 3, 8]) bx(1.2, .04, .5, x, H - .02, 0, 0xffffff, emi);
    }
    // zusammenfassen: wenige Zeichenaufrufe
    const add = (parent, list, mat, cast) => { if (!list.length) return; const g = mergeGeometries(list); if (!g) return; const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = !!cast; parent.add(m); };
    add(grp, vc, roomMat({ vertexColors: true }, .42));
    add(grp, emi, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    for (const [mat, list] of tex) add(grp, list, mat);
    for (const [mat, list] of etex) add(ext, list, mat, true);
    cull(grp, 95);                                                      // Innenraum nur aus der Nähe zeichnen
    { const a = toW(-ix + .1, -iz + .1), b = toW(ix - .1, iz - .1); S.ent.fl.hollow = new THREE.Box3(V(Math.min(a.x, b.x), y0, Math.min(a.z, b.z)), V(Math.max(a.x, b.x), y0 + H, Math.max(a.z, b.z))); }
    interiors.push({ kind: S.kind, x: S.x, z: S.z, grp, door: sd.c });
  }
}
buildInteriors();
// Geldautomaten an einigen Läden (zum Knacken)
{
  const body = M(0x3c4652, { metalness: .5, roughness: .4 }), scr = new THREE.MeshBasicMaterial({ color: 0x2f7fd1 }), key = M(0xb0b5ba);
  shopSpots.filter((s, i) => i % 7 === 2).slice(0, 7).forEach(([x, z, sx]) => {
    const g = new THREE.Group(); g.position.set(x + sx * .3, .15, z + 3.4); g.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2; scene.add(g);
    const b = new THREE.Mesh(BOX, body); b.scale.set(.7, 1.7, .55); b.position.y = .85; g.add(b);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(.42, .3), scr); s.position.set(0, 1.28, .28); s.rotation.x = -.2; g.add(s);
    const k = new THREE.Mesh(BOX, key); k.scale.set(.32, .04, .2); k.position.set(0, 1.02, .33); k.rotation.x = .5; g.add(k);
    shade(g); cull(g, 80);
    colliders.push({ minX: g.position.x - .4, maxX: g.position.x + .4, minZ: g.position.z - .4, maxZ: g.position.z + .4 });
    robSpots.push({ kind: 'atm', name: 'Geldautomat', p: V(g.position.x + sx * .45, 1.1, g.position.z), cash: [400, 900], stars: 1, time: 6, cool: 0, scr });
  });
}
POI.Autobahn = [R[3], HZ - 20];
POI.Fernsehturm = [TVT.x, TVT.z];
POI.A81 = [HX, -600];

// Ladenschilder über den Geschäften im Erdgeschoss
{
  const SH_N = [['BÄCKEREI', '#f3e3c3', '#6b3e1e'], ['APOTHEKE', '#d71920', '#ffffff'], ['DÖNER KEBAB', '#1d1d1d', '#ffcc00'], ['FRISEUR', '#ffffff', '#222222'],
    ['SPÄTI 24/7', '#2b6cff', '#ffffff'], ['BIO MARKT', '#3d7a2f', '#ffffff'], ['PIZZERIA', '#0f7a3a', '#ffffff'], ['HANDY SHOP', '#e20074', '#ffffff']];
  const [c, g] = C(1024, 1024);
  SH_N.forEach(([t, bg, fg], i) => {
    g.fillStyle = bg; g.fillRect(0, i * 128, 1024, 128); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, i * 128 + 118, 1024, 10);
    g.fillStyle = fg; g.font = 'bold 84px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 512, i * 128 + 64);
  });
  const tex = T(c, false), pos = [], uv = [];
  for (const [x, z, sx] of shopSpots) {
    const row = Math.floor(Math.random() * 8), v0 = 1 - (row + 1) / 8 + .002, v1_ = 1 - row / 8 - .002, hw = 4.5, y0 = 2.82, y1 = 3.3;
    if (row === 6) pizzerias.push({ x: x + sx * 2.5, z, sx });                // Pizzeria (Lieferdienst holt hier ab)
    // Schild zeigt in Richtung sx (x-Achse), Breite entlang z
    const zl = z + sx * hw, zr = z - sx * hw;
    for (const [px, py, pz, u, v] of [[x, y0, zl, 0, v0], [x, y0, zr, 1, v0], [x, y1, zr, 1, v1_], [x, y0, zl, 0, v0], [x, y1, zr, 1, v1_], [x, y1, zl, 0, v1_]]) { pos.push(px, py, pz); uv.push(u, v); }
  }
  const sg2 = new THREE.BufferGeometry();
  sg2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg2.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); sg2.computeVertexNormals();
  scene.add(new THREE.Mesh(sg2, new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: .35, roughness: .5 })));
}

function buildTankstelle(cx, cz, isSpawn) {
  const a = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK, BLOCK).rotateX(-Math.PI / 2), MAT.lot);
  a.position.set(cx, .02, cz); scene.add(a);
  const kx = cx - 18, cy = 5.4;
  const canopy = box(14, .8, 26, M(0xf5f5f5), kx, cy, cz);
  box(14.2, .3, 26.2, M(0xfbce07), kx, cy - .25, cz);
  box(14.25, .12, 26.25, M(0xdd1d21), kx, cy - .45, cz);
  box(13.9, .02, 25.9, M(0xeeeeee, { emissive: 0x777777 }), kx, cy - .52, cz);
  for (const sz of [-8, 0, 8]) box(9, .03, .5, M(0xffffff, { emissive: 0xffffff }), kx, cy - .54, cz + sz);
  addFlammable({ kind: 'building', box: new THREE.Box3().setFromObject(canopy).expandByScalar(.5), mats: [canopy.material], duration: 80 });
  for (const sx of [-5, 5]) for (const sz of [-10, 10]) box(.45, cy, .45, M(0xdddddd), kx + sx, cy / 2, cz + sz);
  for (const ix of [-3, 3]) for (const iz of [-6, 6]) {
    box(1.2, .25, 4.5, M(0x9c9a94), kx + ix, .12, cz + iz);
    const pm = M(0xf2f2f2);
    const pump = box(.8, 1.9, .55, pm, kx + ix, 1.2, cz + iz);
    box(.82, .3, .57, M(0xdd1d21), kx + ix, 2.05, cz + iz);
    box(.84, .25, .3, M(0x111111, { emissive: 0x113322 }), kx + ix, 1.6, cz + iz);
    const ent = { kind: 'pump', mesh: pump };
    pump.userData.ent = ent; shootables.push(pump);
    ent.fl = addFlammable({ kind: 'pump', box: new THREE.Box3().setFromObject(pump).expandByScalar(.2), mats: [pm], explodeAfter: 3, owner: ent });
    pumps.push({ x: kx + ix, z: cz + iz });
    colliders.push({ minX: kx + ix - .6, maxX: kx + ix + .6, minZ: cz + iz - 2.25, maxZ: cz + iz + 2.25 });
  }
  building(cx + 16, cz, 14, 22, 4.6, 'shop', '#f0f0f0', { front: [-1, 0], enter: 'shop' });
  sign(['SHOP · BISTRO · WASCHANLAGE'], 12, 1, cx + 8.9, 4, cz, -Math.PI / 2, '#dd1d21', '#fff', 'bold 46px system-ui');
  box(.4, 9, .4, M(0x888888), cx - 31, 4.5, cz - 28);
  const nm = isSpawn ? 'Pforzheimer Str.' : 'Neckarstraße';
  sign(['TANKSTELLE', nm, 'Super E10   1,79', 'Super E5    1,85', 'Diesel      1,69'], 3.4, 5, cx - 31, 7, cz - 27.75, 0, '#fbce07', '#222', 'bold 46px system-ui', 300, 440);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) prop('crate', cx + 24 + i * .9, j * .35, cz - 13);
  for (let i = 0; i < 3; i++) prop('can', cx + 9.5, .02, cz + 6 + i * .45, Math.PI / 2);
  for (let i = 0; i < 4; i++) prop('barrel', cx + 26 + (i % 2) * .7, .02, cz + 8 + Math.floor(i / 2) * .7);
  for (let i = 0; i < 4; i++) prop('tyre', cx + 26, .02 + i * .17, cz + 12);
  prop('bin', cx + 26, .02, cz - 6, Math.PI / 2);
  const pos = { car: [kx, cz], player: [kx + 2.6, cz] };
  if (isSpawn) { SPAWN = pos; POI.Tankstelle = [cx, cz]; } else POI['Tankstelle 2'] = [cx, cz];
  if (!isSpawn) {                                                       // Tuning-Werkstatt: Auto auf die Fläche stellen
    const px = cx + 16, pz = cz + 24, pad = new THREE.Mesh(new THREE.PlaneGeometry(7, 9).rotateX(-Math.PI / 2), M(0x2b2f36, { roughness: .6 }));
    pad.position.set(px, .035, pz); scene.add(pad);
    for (const s of [-1, 1]) box(.15, .01, 9, M(0xffc400, { emissive: 0x7a5d00 }), px + s * 3.4, .045, pz);
    box(7.4, .4, .3, M(0x1d1f24), px, 4.4, pz - 4.7); box(.3, 4.6, .3, M(0x1d1f24), px - 3.6, 2.3, pz - 4.7); box(.3, 4.6, .3, M(0x1d1f24), px + 3.6, 2.3, pz - 4.7);
    sign(['TUNING', 'WERKSTATT'], 6, 1.6, px, 3.4, pz - 4.5, 0, '#ffc400', '#111', 'bold 64px system-ui', 512, 140);
    tuningPad.x = px; tuningPad.z = pz; POI['Tuning-Werkstatt'] = [px, pz];
  }
}

// Bäume & Laternen als Instanzen (ein Draw-Call)
{
  // Rinde
  const bark = (() => { const [c, g] = C(128, 256); g.fillStyle = '#4a3f35'; g.fillRect(0, 0, 128, 256); for (let i = 0; i < 260; i++) { const b = pick([25, 70, 105, 130]); g.fillStyle = `rgba(${b},${b * .88},${b * .75},${rand(.2, .6)})`; g.fillRect(rand(0, 128), rand(0, 256), rand(2, 6), rand(20, 90)); } return T(c); })();
  bark.repeat.set(2, 2);
  // Blätter: viele kleine Blätter auf transparentem Grund
  const leaves = (() => {
    const [c, g] = C(512, 512);
    for (let i = 0; i < 2600; i++) {
      const a = rand(0, 7), r = Math.pow(Math.random(), .6) * 235, x = 256 + Math.cos(a) * r, y = 256 + Math.sin(a) * r;
      g.save(); g.translate(x, y); g.rotate(rand(0, 7));
      g.fillStyle = `hsl(${rand(78, 118)},${rand(35, 60)}%,${rand(14, 36)}%)`;
      g.beginPath(); g.ellipse(0, 0, rand(5, 11), rand(2.5, 5), 0, 0, 7); g.fill(); g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ANISO; return t;
  })();
  const trunkGeo = mergeGeometries([
    new THREE.CylinderGeometry(.11, .22, 4.6, 8).translate(0, 2.3, 0),
    ...[0, 1.6, 3.2, 4.6].map((a, i) => new THREE.CylinderGeometry(.04, .09, 2, 5).translate(0, 1, 0).rotateZ(.75 + i * .08).rotateY(a).translate(0, 3.1 + i * .25, 0)),
  ]);
  const cards = [], ctr = new THREE.Vector3(0, 5.3, 0);
  for (let i = 0; i < 38; i++) {
    const p = new THREE.Vector3().randomDirection().multiply(new THREE.Vector3(2.3, 1.7, 2.3)).multiplyScalar(Math.cbrt(Math.random()) * .95).add(ctr);
    const s = rand(1.5, 2.3), g = new THREE.PlaneGeometry(s, s).rotateX(rand(-.7, .7)).rotateY(rand(0, Math.PI)).translate(p.x, p.y, p.z);
    const n = p.clone().sub(ctr).normalize().lerp(UP, .3).normalize(), na = g.attributes.normal;
    for (let k = 0; k < na.count; k++) na.setXYZ(k, n.x, n.y, n.z);
    cards.push(g);
  }
  const leafMat = new THREE.MeshStandardMaterial({ map: leaves, alphaTest: .45, alphaToCoverage: true, side: THREE.DoubleSide, roughness: .9, envMapIntensity: .4 });
  const crownGeo = mergeGeometries(cards), barkMat = M(0xffffff, { map: bark, roughness: 1 });
  var farTreeGeo = mergeGeometries([0, Math.PI / 2].map(a => new THREE.PlaneGeometry(5, 6.5).rotateY(a).translate(0, 4.6, 0)));
  var farTreeMat = new THREE.MeshLambertMaterial({ map: leaves, alphaTest: .4, side: THREE.DoubleSide, color: 0x9fb090 });
  const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  // in Zonen aufteilen, damit nur Bäume in Sichtweite gezeichnet werden
  const zones = new Map(), farMats = [];
  for (const t of treeM) { const k = Math.floor(t[0] / 160) + ',' + Math.floor(t[1] / 160); if (!zones.has(k)) zones.set(k, []); zones.get(k).push(t); }
  for (const list of zones.values()) {
    const trunk = new THREE.InstancedMesh(trunkGeo, barkMat, list.length), crown = new THREE.InstancedMesh(crownGeo, leafMat, list.length);
    list.forEach(([x, z, s, y], i) => {
      mm.compose(v1.set(x, y || 0, z), q.setFromAxisAngle(UP, rand(0, 6)), v2.set(s, s * rand(.85, 1.2), s)); trunk.setMatrixAt(i, mm); crown.setMatrixAt(i, mm);
      crown.setColorAt(i, col.setHSL(rand(.0, .08), rand(0, .3), rand(.75, 1)));
    });
    trunk.computeBoundingSphere(); crown.computeBoundingSphere();
    scene.add(trunk, crown);
    const zc = crown.boundingSphere.center.clone();
    culls.push({ o: trunk, r: 230, p: zc }, { o: crown, r: 230, p: zc });
    farTrees.zones.push({ p: zc, start: farMats.length, n: list.length, near: false });
    list.forEach((_, i) => { crown.getMatrixAt(i, mm); farMats.push(mm.clone()); });
  }
  // weit weg: einfache Baum-Karten (4 Dreiecke statt ~180) – alle in EINEM Draw-Call (vorher ~120 einzelne).
  // Wo die echten Bäume stehen (in der Nähe), werden die Karten ausgeblendet.
  const far = new THREE.InstancedMesh(farTreeGeo, farTreeMat, farMats.length);
  farMats.forEach((m, i) => far.setMatrixAt(i, m)); far.frustumCulled = false; far.castShadow = false; far.receiveShadow = false;
  scene.add(far); Object.assign(farTrees, { mesh: far, mats: farMats });
  const lg = mergeGeometries([
    new THREE.CylinderGeometry(.08, .12, 8, 8).translate(0, 4, 0),
    new THREE.CylinderGeometry(.05, .05, 1.6, 6).rotateZ(Math.PI / 2 - .15).translate(.78, 7.95, 0),
    new THREE.BoxGeometry(.7, .14, .32).translate(1.55, 7.98, 0)]);
  const lamps = new THREE.InstancedMesh(lg, M(0x5d6166, { metalness: .6, roughness: .5 }), lampM.length);
  // nachts: Leuchtfläche unter dem Lampenkopf + warmer Lichtkegel auf dem Boden (ohne echte Lampen – kostet fast nichts)
  const glow = new THREE.InstancedMesh(new THREE.BoxGeometry(.6, .03, .24).translate(1.55, 7.9, 0), new THREE.MeshBasicMaterial({ color: 0x404040 }), lampM.length);
  const poolTex = (() => { const [c, g] = C(64, 64), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return T(c, false); })();
  const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2).translate(1.55, .08, 0), new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffcf8a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), lampM.length);
  lampM.forEach(([x, z, ry], i) => { mm.compose(v1.set(x, 0, z), q.setFromAxisAngle(UP, ry), v2.set(1, 1, 1)); lamps.setMatrixAt(i, mm); glow.setMatrixAt(i, mm); pool.setMatrixAt(i, mm); });
  pool.visible = false; pool.renderOrder = 1; glow.castShadow = pool.castShadow = false;
  scene.add(lamps, glow, pool); lampFx.glow = glow; lampFx.pool = pool;
}

// ===================================================================
// Autos (Platzhalter; werden durch das 3D-Modell ersetzt)
// ===================================================================
const carShape = (() => {
  const s = new THREE.Shape(); s.moveTo(-2.3, .32);
  [[-2.36, .78], [-2.0, .95], [-1.45, .98], [-.85, 1.42], [.45, 1.44], [1.15, .98], [2.2, .82], [2.36, .55], [2.3, .32]].forEach(p => s.lineTo(...p));
  s.closePath(); return s;
})();
const BODY_GEO = new THREE.ExtrudeGeometry(carShape, { depth: 1.84, bevelEnabled: true, bevelThickness: .04, bevelSize: .04, bevelSegments: 2 }).translate(0, 0, -.92).rotateY(-Math.PI / 2);
const WHEEL_GEO = (() => {
  const t = [];
  for (const [x, z] of [[.86, 1.45], [-.86, 1.45], [.86, -1.4], [-.86, -1.4]]) t.push(new THREE.CylinderGeometry(.34, .34, .24, 18).rotateZ(Math.PI / 2).translate(x, .34, z));
  return mergeGeometries(t);
})();
const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a232b, metalness: .9, roughness: .05, transparent: true, opacity: .55 });
const tireMat = M(0x161616, { roughness: .9 });
const CAR_COLORS = [0xc0c4c8, 0x1b1c1e, 0xf2f2f2, 0x6b6f74, 0x1f3f7a, 0x8c1a1a, 0x2e4a3a, 0xa8a090, 0x3d4c5c, 0xb5a28a];

function createCar(color, isPlayer) {
  const g = new THREE.Group(); scene.add(g);
  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: .65, roughness: .3 });
  const vis = new THREE.Group(); g.add(vis);
  vis.add(new THREE.Mesh(BODY_GEO, bodyMat), new THREE.Mesh(WHEEL_GEO, tireMat));
  const hit = new THREE.Mesh(BOX, HIDDEN); hit.scale.set(1.95, 1.2, 4.6); hit.position.y = .75; g.add(hit);
  const car = { kind: 'car', group: g, vis, hit, bodyMat, glassMat: glassMat.clone(), hp: 6, dead: false, speed: 0, heading: 0, player: isPlayer, half: V().set(1, 1.45, 2.4) };
  hit.userData.ent = car; shootables.push(hit);
  const fb = new THREE.Box3();
  car.fl = addFlammable({ kind: 'car', mats: [bodyMat], explodeAfter: rand(8, 13), owner: car,
    getBox: () => fb.setFromCenterAndSize(v3.copy(g.position).setY(.8), v2.set(3.2, 1.6, 3.2)) });
  if (isPlayer) buildPlaceholderInterior(car);
  return car;
}

function buildPlaceholderInterior(car) {
  const g = car.vis, dark = M(0x1c1c1e, { roughness: .9 });
  box(1.72, .28, .5, dark, 0, .86, .95, g);
  for (const x of [.4, -.4]) { box(.52, .14, .55, dark, x, .55, -.3, g); box(.52, .65, .12, dark, x, .9, -.6, g); }
  const pivot = new THREE.Group(); pivot.position.set(.97, .62, .55); g.add(pivot);
  box(.06, .58, 1.15, car.bodyMat, .03, 0, -.575, pivot);
  const handle = box(.03, .035, .16, M(0xc8ccd0, { metalness: .9, roughness: .2 }), .075, .17, -.95, pivot);
  const wb = new THREE.Group(); wb.position.set(.4, .98, .6); wb.rotation.x = .35; g.add(wb);
  const ws = new THREE.Group(); wb.add(ws);
  ws.add(new THREE.Mesh(new THREE.TorusGeometry(.18, .022, 8, 28), dark));
  box(.34, .03, .02, dark, 0, -.02, 0, ws);
  const holder = new THREE.Object3D(); holder.position.set(.05, 1.1, .76); holder.rotation.set(.3, Math.PI, 0); g.add(holder);
  box(.09, .025, .04, dark, .05, 1.03, .78, g);
  Object.assign(car, {
    doors: [{ key: 'FL', pivot, handle, side: 1, front: true, a: 0, max: 1.25, a0: Math.atan2(handle.position.x, -handle.position.z) }],
    wheelBase: wb, wheelSpin: ws, wheelR: .18, spin: 0, holder, DX: 1,
    head: V().set(.4, 1.2, -.35), seatHint: V().set(1.3, 1.2, -.1), exitPos: V().set(2.1, 0, -.2), wheels: [],
  });
  car.seats = [car.head.clone(), V(-.4, 1.2, -.35)];
}

// Spieler-Auto
const pcar = createCar(0x2a2d31, true);
pcar.group.position.set(SPAWN.car[0], 0, SPAWN.car[1]);
pcar.group.rotation.order = 'YXZ';
pcar.fl.explodeAfter = 12;
pcar.locked = true;   // anfangs abgeschlossen: niemand kann einsteigen (am Hauptdisplay entsperren)
// Aktuelles eigenes Fahrzeug (wird in der Garage-App gewechselt)
let vehicle = { id: 'ferrari', name: 'Ferrari 458', type: 'car' };
const vehicleCache = {}, vehicleFar = {};
const lowTrimMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .4, roughness: .5 });
let carBoot = false;   // eigenes Auto fertig geladen (vorher nichts senden, sonst sehen andere kurz ein falsches Auto)
// Sitzplätze je Fahrzeug (Fahrer, Beifahrer, hinten …) – damit andere Spieler mitfahren können
const vehicleMeta = { scooter: { seats: [V(0, 1.6, -.05)], half: V(.3, 1.2, .5), paint: 0x15171a } };
const DEFAULT_META = { seats: [V(.37, 1.12, -.1), V(-.37, 1.12, -.1), V(.36, 1.12, -.95), V(-.36, 1.12, -.95)], half: V(.92, 1.45, 2.3), paint: 0x8a1010 };
const metaOf = type => vehicleMeta[type] || DEFAULT_META;
const NICE_NAMES = { jetta: 'VW Jetta (2024)', bmw: 'BMW (2024)', urus: 'Lamborghini Urus', taigo: 'VW Taigo', polo: 'VW Polo', van: 'Van', golf: 'VW Golf', mercedes: 'Mercedes', porsche: 'Porsche' };
const VEHICLES = [
  { id: 'scooter', name: 'E-Scooter', type: 'scooter' },
  { id: 'ferrari', name: 'Ferrari 458', type: 'car' },
];
// E-Scooter (eigenes Modell)
function buildScooter() {
  const g = new THREE.Group(), blk = M(0x15171a, { roughness: .5 }), alu = M(0xb9bec4, { metalness: .8, roughness: .3 }), acc = M(0x2fbf71, { roughness: .4 });
  box(.17, .05, .6, blk, 0, .13, -.02, g); box(.18, .015, .5, M(0x0c0c0c, { roughness: 1 }), 0, .16, -.04, g);
  const wheel = new THREE.CylinderGeometry(.1, .1, .05, 20).rotateZ(Math.PI / 2);
  for (const z of [.36, -.38]) { const w = new THREE.Mesh(wheel, blk); w.position.set(0, .1, z); g.add(w); box(.03, .06, .2, acc, 0, .19, z, g); }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.022, .025, 1.0, 10), alu); stem.position.set(0, .63, .33); stem.rotation.x = -.12; g.add(stem);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(.016, .016, .52, 10).rotateZ(Math.PI / 2), alu); bar.position.set(0, 1.12, .27); g.add(bar);
  for (const x of [-.24, .24]) box(.12, .035, .035, blk, x, 1.12, .27, g);
  box(.08, .05, .03, M(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1 }), 0, 1.0, .33, g);
  box(.08, .03, .02, M(0x550000, { emissive: 0xff0000, emissiveIntensity: .8 }), 0, .18, -.33, g);
  return g;
}
function setVehicleVisual(vis, chassis) { pcar.group.remove(pcar.vis); pcar.vis = vis; pcar.chassis = chassis; pcar.group.add(vis); if (pcar.low) { pcar.group.remove(pcar.low); pcar.low = null; } }
// Fahrzeug holen (Garage) – erscheint neben dir
async function getVehicle(id) {
  const v = VEHICLES.find(q => q.id === id); if (!v) return;
  if (player.inCar) exitCar();
  msg('Hole ' + v.name + ' …', 2);
  if (v.type === 'scooter') {
    if (phone.where === 'holder') setPhone('pocket');                  // Scooter hat keinen Magneten
    dashRemove();                                                        // ... und keine Dashcam
    const s = buildScooter(); shade(s);
    setVehicleVisual(s, s);
    Object.assign(pcar, { half: V(.3, 1.2, .5), wheels: [], head: V(0, 1.6, -.05), seatHint: V(0, 1.2, 0), exitPos: V(.9, 0, 0), doors: [], seats: [V(0, 1.6, -.05)], screen: null, cluster: null, rainFx: null, doorGlass: null, wins: null, winT: null, dmg: null, dents: [], crack: null });
    pcar.hit.scale.set(.5, 1.2, 1); pcar.hit.position.y = .6; vehicleCache.scooter = s.clone(true);
  } else {
    try { const g = v.file ? await AS.loadUrl(v.file) : await AS.loadCar(); upgradePlayerCar(g, v.id); }
    catch (e) { msg('Modell konnte nicht geladen werden: ' + v.name, 4); return; }
  }
  vehicle = v; resetVehicle(true);
  msg(v.name + ' steht bereit', 3);
}
// Jeder Spieler hat seinen eigenen Parkplatz an der Tankstelle (sonst stehen alle Autos ineinander)
const CAR_SLOTS = [[0, 0], [-6.5, 0], [6.5, 0], [0, 12.5], [-6.5, 12.5], [6.5, 12.5], [0, -12.5]];
function spawnCarPos() {
  const h = save.house >= 0 ? homeCarSpot() : null; if (h) return [h.x, h.z, h.heading];   // eigenes Haus: Auto steht davor
  const s = CAR_SLOTS[net.id ? (net.id - 1) % CAR_SLOTS.length : 0]; return [SPAWN.car[0] + s[0], SPAWN.car[1] + s[1]];
}
// Fahrzeug reparieren und neben den Spieler (oder an die Tankstelle) stellen
function resetVehicle(nearPlayer) {
  const c = pcar;
  const i = burning.indexOf(c.fl); if (i >= 0) burning.splice(i, 1);
  Object.assign(c.fl, { burning: false, done: false, heat: 0, burnT: 0 });
  c.fl.mats.forEach((m, k) => c.fl.orig[k] && m.color.copy(c.fl.orig[k]));
  c.dead = false; c.hp = 6; c.speed = 0; c.glassMat.visible = true; c.spin = 0; c.gyS = c.slS = c.sdS = c.gyF = c.pgy = c.pgvy = c.lastGvy = undefined; c.sus = {}; c.air = false; c.vy = 0;
  if (nearPlayer) {
    camera.getWorldDirection(v1); v1.y = 0; v1.normalize();
    c.group.position.set(headWorld.x + v1.x * 4, 0, headWorld.z + v1.z * 4); c.heading = Math.atan2(v1.x, v1.z) + Math.PI / 2;
  } else { const [x, z, hd] = spawnCarPos(); c.group.position.set(x, 0, z); c.heading = hd || 0; }
  c.group.position.y = surfaceAt(c.group.position.x, c.group.position.z);
  c.group.rotation.set(0, c.heading, 0);
  repairCar(c);                                                       // Dellen, kaputte Lichter und Scheiben weg
}
// Teile mit Markierung ein-/ausblenden: "inner" = Innenraum (nur aus der Nähe), "outer" = von innen unsichtbar (Räder, Lampen)
const flagged = new WeakMap();
function flagVis(root, flag, on) {
  let m = flagged.get(root); if (!m) flagged.set(root, m = {});
  const l = m[flag] || (m[flag] = []); if (!l.done) { root.traverse(o => o.userData[flag] && l.push(o)); l.done = true; }
  for (const o of l) o.visible = on;
}
const innerVis = (root, on) => flagVis(root, 'inner', on);
function remoteVehicleMesh(type) {
  if (type === 'scooter') return vehicleCache.scooter ? vehicleCache.scooter.clone(true) : buildScooter();
  if (vehicleCache[type]) {
    // eigene Materialien je Auto (Schäden/Alarm eines Spielers sollen nicht an allen Autos gleichen Typs auftauchen)
    const full = carClone(vehicleCache[type]), low = vehicleFar[type];
    full.traverse(o => { if (o.isMesh && o.userData.inner) [].concat(o.material).forEach(m => liftMat(m)); });
    if (!low) return full;
    const lod = new THREE.LOD(); lod.addLevel(full, 0);
    lod.addLevel(new THREE.Mesh(low, [M(metaOf(type).paint, { metalness: .6, roughness: .3 }), lowTrimMat, M(0x141b22, { metalness: .9, roughness: .05 })]), 45);
    return lod;
  }
  const paint = M(0x8a1010, { metalness: .7, roughness: .3 });
  return npcCarGeo ? new THREE.Mesh(npcCarGeo.near, [paint, npcCarGeo.trim, M(0x141b22, { metalness: .9, roughness: .05 })]) : new THREE.Mesh(BODY_GEO, paint);
}
// Auto eines anderen Spielers, das du selbst nicht geladen hast (z.B. er fährt Ferrari, du Jetta): einmal nachladen, nur zum Anzeigen
const remoteLoads = {};
function needRemoteModel(type) {
  if (vehicleCache[type] || remoteLoads[type] || !carBoot) return;
  const v = VEHICLES.find(q => q.id === type); if (!v || v.type !== 'car') return;
  remoteLoads[type] = true;
  (v.file ? AS.loadUrl(v.file) : AS.loadCar()).then(g => { if (!vehicleCache[type]) upgradePlayerCar(g, type, false); })
    .catch(e => console.warn('Auto für andere Spieler konnte nicht geladen werden:', type, e));
}

// NPC-Autos im Stadtraster
const laneOff = (axis, dir) => axis === 'x' ? (dir > 0 ? LANE : -LANE) : (dir > 0 ? -LANE : LANE);
const npcCars = [];
function planTurn(c) {
  let k = -1;
  if (c.dir > 0) { for (let i = 0; i <= N; i++) if (R[i] - c.s > 5) { k = i; break; } }
  else { for (let i = N; i >= 0; i--) if (c.s - R[i] > 5) { k = i; break; } }
  if (k < 0) { c.dir *= -1; c.s += c.dir * 8; return planTurn(c); }
  const opts = [];
  if (c.dir > 0 ? k < N : k > 0) opts.push(0, 0, 0);
  for (const nd of [1, -1]) if (nd > 0 ? c.j < N : c.j > 0) opts.push(nd);
  const o = pick(opts); c.k = k;
  if (!o) { c.turn = null; c.turnAt = R[k] + c.dir * 2; }
  else { const na = c.axis === 'x' ? 'z' : 'x'; c.turn = { axis: na, dir: o }; c.turnAt = R[k] + laneOff(na, o); }
}
for (let i = 0; i < 26; i++) {
  const c = createCar(pick(CAR_COLORS), false);
  c.axis = Math.random() < .5 ? 'x' : 'z'; c.dir = Math.random() < .5 ? 1 : -1;
  c.j = Math.floor(Math.random() * (N + 1)); c.s = R[Math.floor(Math.random() * N)] + rand(15, P - 15);
  c.vmax = rand(9, 14); c.speed = c.vmax; c.wait = 0; c.ghost = 0;
  planTurn(c); npcCars.push(c);
}
const hwCars = [];
for (let i = 0; i < 12; i++) {
  const c = createCar(pick(CAR_COLORS), false);
  c.dir = i % 2 ? 1 : -1; c.lane = Math.floor(Math.random() * 3);
  c.z = HZ + c.dir * (2.6 + c.lane * 3.75); c.x = rand(-1300, 1300); c.vmax = rand(25, 40) - c.lane * 3; c.speed = c.vmax;
  c.group.rotation.y = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2; hwCars.push(c);
}
// Verkehr auf der A81 (Nord-Süd)
for (let i = 0; i < 6; i++) {
  const c = createCar(pick(CAR_COLORS), false);
  c.az = true; c.dir = i % 2 ? 1 : -1; c.lane = Math.floor(Math.random() * 3);
  c.ax = HX - c.dir * (2.6 + c.lane * 3.75); c.x = rand(-TS / 2 + 50, HZ - 40); c.vmax = rand(25, 38) - c.lane * 3; c.speed = c.vmax;
  c.group.rotation.y = c.dir > 0 ? 0 : Math.PI; hwCars.push(c);
}
// Parkende Autos am Straßenrand
const parked = [];
for (let i = 0; i <= N; i++) for (let k = 0; k < N; k++) for (const s of [-1, 1]) for (const axis of ['x', 'z']) {
  for (let a = R[k] + 17; a < R[k] + P - 17; a += 6.3) {
    if (Math.random() > .2 || parked.length >= 140) continue;
    const off = R[i] + s * 6.55, x = axis === 'z' ? off : a, z = axis === 'z' ? a : off;
    if (Math.hypot(x - SPAWN.car[0], z - SPAWN.car[1]) < 45) continue;
    const c = createCar(pick(CAR_COLORS), false); c.parked = true;
    c.group.position.set(x, 0, z);
    c.group.rotation.y = c.heading = axis === 'z' ? (s > 0 ? Math.PI : 0) : (s > 0 ? Math.PI / 2 : -Math.PI / 2);
    colliders.push(axis === 'z' ? { minX: x - 1, maxX: x + 1, minZ: z - 2.3, maxZ: z + 2.3 } : { minX: x - 2.3, maxX: x + 2.3, minZ: z - 1, maxZ: z + 1 });
    parked.push(c);
  }
}
const allNpc = [...npcCars, ...hwCars, ...parked];

// ===================================================================
// Fußgänger (Platzhalter; werden durch animierte 3D-Menschen ersetzt)
// ===================================================================
const peds = [];
const HEAD = new THREE.SphereGeometry(.12, 12, 10);
function makePed() {
  const g = new THREE.Group(); g.rotation.order = 'YXZ'; scene.add(g);
  const vis = new THREE.Group(); g.add(vis);
  const shirt = M(new THREE.Color().setHSL(Math.random(), .45, .42)), pants = M(0x2b3a55), skin = M(0xe0ac85);
  box(.42, .6, .24, shirt, 0, 1.2, 0, vis); box(.3, .85, .2, pants, 0, .43, 0, vis);
  const head = new THREE.Mesh(HEAD, skin); head.position.y = 1.66; vis.add(head);
  const hit = new THREE.Mesh(BOX, HIDDEN); hit.scale.set(.5, 1.8, .4); hit.position.y = .9; g.add(hit);
  const ped = { kind: 'ped', root: g, vis, hit, alive: true, mixer: null };
  hit.userData.ent = ped; shootables.push(hit);
  return ped;
}
function placePed(p) {
  const b = pick(blocks); p.bi = blocks.indexOf(b); p.cx = b.cx; p.cz = b.cz; p.hs = BLOCK / 2 - 1.5;
  p.s = rand(0, 8 * p.hs); p.dir = Math.random() < .5 ? 1 : -1; p.speed = rand(1.1, 1.5); p.flee = 0;
  p.alive = true; p.root.rotation.set(0, 0, 0); p.root.visible = true; if (p.blob) p.blob.visible = true;
}
for (let i = 0; i < 22; i++) { const p = makePed(); placePed(p); peds.push(p); }
function pedPos(p, out) {
  const L = 2 * p.hs, per = 4 * L; p.s = ((p.s % per) + per) % per;
  const seg = Math.floor(p.s / L), t = p.s - seg * L, hs = p.hs;
  const C4 = [[-hs, -hs, 1, 0], [hs, -hs, 0, 1], [hs, hs, -1, 0], [-hs, hs, 0, -1]][seg];
  out.set(p.cx + C4[0] + C4[2] * t, 0, p.cz + C4[1] + C4[3] * t);
  return Math.atan2(C4[2] * p.dir, C4[3] * p.dir);
}
function killPed(p, push) {
  if (!p.alive) return; p.alive = false; p.deadT = 0; if (p.blob) p.blob.visible = false;
  if (vil.ped === p) endVillain(vilKillByMe);                           // Angreifer-Mission erledigt
  p.root.rotation.x = -Math.PI / 2; p.root.position.y = .15;
  if (push) p.root.position.addScaledVector(push, 1.5);
  scarePeds(p.root.position, 30);
}
function scarePeds(pos, r) { for (const p of peds) if (p.alive && p.root.position.distanceTo(pos) < r) { p.flee = 10; if (Math.random() < .5) p.dir *= -1; } }

// ===================================================================
// Partikel (Feuer, Rauch, Funken) + Trümmer
// ===================================================================
const flameTex = (() => { const [c, g] = C(64, 64); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.4, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return T(c, false); })();
class PSys {
  constructor(n, size, additive, smoke, white = false) {
    Object.assign(this, { n, i: 0, smoke, white, pos: new Float32Array(n * 3), col: new Float32Array(n * 4), vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n) });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.g = g;
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, map: flameTex, vertexColors: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    pts.frustumCulled = false; scene.add(pts);
  }
  spawn(x, y, z, vx, vy, vz, life) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.life[i] = this.max[i] = life;
  }
  update(dt, buoy) {
    const { pos, vel, col, life, max } = this;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) { col[i * 4 + 3] = 0; continue; }
      life[i] -= dt; const k = Math.max(0, life[i] / max[i]);
      vel[i * 3 + 1] += buoy * dt;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (this.smoke) { const c = this.white ? .82 + .15 * (1 - k) : .25 + .2 * (1 - k); col.set([c, c, c, k * (1 - k) * 2.2], i * 4); }
      else col.set([1, .25 + .65 * k * k, .08 * k, k], i * 4);
    }
    this.g.attributes.position.needsUpdate = true; this.g.attributes.color.needsUpdate = true;
  }
}
const fireBig = new PSys(1600, 3.2, true), fireSmall = new PSys(700, .35, true), smoke = new PSys(900, 6, false, true);
const fireHuge = new PSys(450, 10, true), smokeHuge = new PSys(260, 22, false, true);   // brennender Fernsehturm (von weit weg sichtbar)
let towerFxT = 0;

const DEB = 220;
const debMesh = new THREE.InstancedMesh(BOX, M(0xffffff, { roughness: .8 }), DEB);
debMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); debMesh.frustumCulled = false; scene.add(debMesh);
const deb = [...Array(DEB)].map(() => ({ p: V(), v: V(), r: new THREE.Euler(), w: V(), s: 0, life: 0 }));
let debI = 0;
const debCol = new THREE.Color();
for (let i = 0; i < DEB; i++) debMesh.setColorAt(i, debCol.set(0xffffff));
function spawnDebris(pos, color, n, size = .2, sp = 4) {
  for (let k = 0; k < n; k++) {
    const d = deb[debI]; debMesh.setColorAt(debI, debCol.set(color)); debI = (debI + 1) % DEB;
    d.p.copy(pos).add(v1.set(rand(-.3, .3), rand(0, .3), rand(-.3, .3)));
    d.v.set(rand(-1, 1) * sp, rand(.5, 1.5) * sp, rand(-1, 1) * sp); d.w.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
    d.s = size * rand(.5, 1.3); d.life = rand(6, 10);
  }
  debMesh.instanceColor.needsUpdate = true;
}
const debM4 = new THREE.Matrix4(), debQ = new THREE.Quaternion();
function updDebris(dt) {
  deb.forEach((d, i) => {
    if (d.life > 0) {
      d.life -= dt; d.v.y -= 9.8 * dt; d.p.addScaledVector(d.v, dt);
      if (d.p.y < d.s / 2) { d.p.y = d.s / 2; d.v.y *= -.3; d.v.x *= .7; d.v.z *= .7; d.w.multiplyScalar(.7); }
      d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
    }
    const s = d.life > 0 ? d.s : 0;
    debM4.compose(d.p, debQ.setFromEuler(d.r), v1.set(s, s, s)); debMesh.setMatrixAt(i, debM4);
  });
  debMesh.instanceMatrix.needsUpdate = true;
}
function sparks(p, n = 12) { for (let i = 0; i < n; i++) fireSmall.spawn(p.x, p.y, p.z, rand(-3, 3), rand(0, 4), rand(-3, 3), rand(.15, .4)); }

// ===================================================================
// Sound (prozedural, räumlich – leiser je weiter weg)
// ===================================================================
const listener = new THREE.AudioListener(); camera.add(listener);
const AC = listener.context;
function mkBuf(dur, f) { const sr = AC.sampleRate, n = Math.floor(sr * dur), b = AC.createBuffer(1, n, sr), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = f(i / sr, Math.random() * 2 - 1); return b; }
let lp = 0;
const SND = {
  gun: mkBuf(.6, (t, r) => r * Math.exp(-t * 28) * .9 + Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 12) * .8),
  boom: mkBuf(3, (t, r) => { lp += (r - lp) * .04; return lp * Math.exp(-t * 1.3) * 5 + Math.sin(2 * Math.PI * 38 * t) * Math.exp(-t * 3) * .9; }),
  hit: mkBuf(.25, (t, r) => r * Math.exp(-t * 50) * .8 + Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 30) * .5),
  crash: mkBuf(.8, (t, r) => r * Math.exp(-t * 7) * .9),
  click: mkBuf(.12, (t, r) => r * Math.exp(-t * 60) * .6),
  tap: mkBuf(.05, (t, r) => Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 90) * .4),
  whoosh: mkBuf(1.8, (t, r) => (r * .5 + Math.sin(2 * Math.PI * (120 + 500 * t) * t) * .3) * Math.sin(Math.PI * t / 1.8) * .7),
};
// Handy liegt im Auto, du bist weg (z.B. rausgeschleudert): der Anrufer hört, was am Handy los ist – nicht dich
const phoneAud = { bus: null, away: false, pos: V(), wind: null, rain: null };
const phoneBusNode = () => phoneAud.bus || (phoneAud.bus = AC.createGain());
function playAt(buf, pos, vol = 1, ref = 6) {
  if (AC.state !== 'running') return;
  const o = new THREE.Object3D(); o.position.copy(pos); scene.add(o);
  const s = new THREE.PositionalAudio(listener); s.setBuffer(buf); s.setRefDistance(ref); s.setRolloffFactor(1.3); s.setVolume(vol); o.add(s);
  s.onEnded = () => { s.isPlaying = false; scene.remove(o); s.disconnect(); };
  s.play();
  if (phoneAud.away) {                                                    // auch "ins Handy" (leiser, je weiter weg)
    const d = pos.distanceTo(phoneAud.pos);
    if (d < 60) { const s2 = AC.createBufferSource(), g2 = AC.createGain(); s2.buffer = buf; g2.gain.value = vol * Math.min(1, ref / Math.max(ref, d)) * .8; s2.connect(g2); g2.connect(phoneBusNode()); s2.start(); }
  }
}
let engine = null;
// Motor-Stimme: Sägezahn + Rechteck durch Tiefpass
function engineVoice(lp = 380) {
  const o1 = AC.createOscillator(), o2 = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain();
  o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = lp; g.gain.value = .25;
  o1.connect(f); o2.connect(f); f.connect(g); o1.start(); o2.start();
  const pa = new THREE.PositionalAudio(listener); pa.setNodeSource(g);
  return { o1, o2, f, pa, stop() { try { o1.stop(); o2.stop(); g.disconnect(); } catch (e) { } } };
}
function ensureEngine() {
  if (engine || AC.state !== 'running') return;
  engine = engineVoice(380); engine.pa.setRefDistance(4); pcar.group.add(engine.pa);   // drinnen: dumpf
}
// Motoren von draußen: die Autos der anderen Spieler und die 3 nächsten NPC-Autos (offener, lauter Klang)
function remoteEngine(p, k, drive) {
  if (AC.state !== 'running') return;
  const near = drive && p.carMesh.position.distanceToSquared(headWorld) < 90 * 90;
  if (!p.eng) { if (!near) return; p.eng = engineVoice(900); p.eng.pa.setRefDistance(7); p.eng.pa.setRolloffFactor(1.1); }
  const e = p.eng; if (e.pa.parent !== p.carMesh) p.carMesh.add(e.pa);
  const s = Math.abs(k[9]), inside = player.ride?.id === p.id;
  e.o1.frequency.value = 38 + s * 3.2; e.o2.frequency.value = 19 + s * 1.6;
  e.f.frequency.value = inside ? 380 : 900;                           // drinnen dumpf, draußen offener
  e.pa.setVolume(near ? (inside ? .5 : 1) : 0);
}
const npcEng = []; let npcEngT = 0;
function updNpcEngines(dt) {
  if (AC.state !== 'running') return;
  if (!npcEng.length) for (let i = 0; i < 3; i++) { const v = engineVoice(1000); v.pa.setRefDistance(5); v.pa.setVolume(0); npcEng.push(v); }
  npcEngT -= dt;
  if (npcEngT <= 0) {
    npcEngT = .3;
    const near = allNpc.filter(c => !c.dead && Math.abs(c.speed) > 1).map(c => [c, c.group.position.distanceToSquared(headWorld)]).filter(a => a[1] < 60 * 60).sort((a, b) => a[1] - b[1]).slice(0, 3).map(a => a[0]);
    for (const v of npcEng) if (v.car && !near.includes(v.car)) { v.car = null; v.pa.setVolume(0); }
    for (const c of near) if (!npcEng.some(v => v.car === c)) { const v = npcEng.find(q => !q.car); if (v) { v.car = c; c.group.add(v.pa); } }
  }
  for (const v of npcEng) if (v.car) { const s = Math.abs(v.car.speed); v.o1.frequency.value = 45 + s * 3; v.o2.frequency.value = 22 + s * 1.5; v.pa.setVolume(.6); }
}
const ring = new Audio('assets/klingelton.mp3'); ring.loop = true;

// ===================================================================
// Feuer & Explosionen
// ===================================================================
const burning = [];
// why = Brandursache ("einer Explosion", "Brandstiftung" …) -> Warnung auf den Auto-Displays / dem Handy
function ignite(f, why) { if (!f || f.burning || f.done) return; f.burning = true; f.burnT = 0; burning.push(f); if (why && f.kind === 'building') fireAlert(why); }
const BLACK = new THREE.Color(0x141414);
function explode(pos, power = 1) {
  playAt(SND.boom, pos, 3, 25);
  boomLight.position.copy(pos).y += 2; boomLight.intensity = 400 * power;
  for (let i = 0; i < 160 * power; i++) { const a = rand(0, 7), b = rand(-1, 1), s = rand(3, 11); fireBig.spawn(pos.x, pos.y + 1, pos.z, Math.cos(a) * s * Math.sqrt(1 - b * b), Math.abs(b) * s + 2, Math.sin(a) * s * Math.sqrt(1 - b * b), rand(.4, 1.1)); }
  for (let i = 0; i < 50; i++) smoke.spawn(pos.x + rand(-2, 2), pos.y + 1.5, pos.z + rand(-2, 2), rand(-2, 2), rand(2, 5), rand(-2, 2), rand(3, 6));
  spawnDebris(pos.clone().setY(1), 0x2a2a2a, 25, .3, 7);
  const r = 7 * power;
  for (const p of peds) if (p.alive && p.root.position.distanceTo(pos) < r) killPed(p, v1.subVectors(p.root.position, pos).setY(0).normalize());
  // Explosion zündet alles in der Nähe an – Gebäude auch noch etwas weiter weg (Hitze, brennende Trümmer)
  for (const f of flammables) if (!f.burning && !f.done) { const b = fBox(f); if (b.distanceToPoint(pos) < r * (f.kind === 'building' ? 1.85 : .8)) ignite(f, 'einer Explosion'); }
  for (const p of props) if (!p.broken && p.mesh.position.distanceTo(pos) < r * .6) breakProp(p);
  for (const c of [pcar, ...allNpc]) if (!c.dead && c.group.position.distanceTo(pos) < r) { c.speed = 0; }
  if (headWorld.distanceTo(pos) < r * .85) die('Explosion');
  scarePeds(pos, 60);
}
let facadeColors = null;
function darken(f, k) {
  f.mats.forEach((m, i) => m.color.lerpColors(f.orig[i], BLACK, k));
  if (f.facade?.attr) {
    const { start, count, orig, attr } = f.facade, a = attr.array;
    for (let i = 0; i < count * 3; i++) a[start * 3 + i] = orig[i] * (1 - k * .9);
    attr.needsUpdate = true;
  }
}
let darkenT = 0;
function updFire(dt) {
  darkenT -= dt; const doDark = darkenT <= 0; if (doDark) darkenT = .5;
  for (let n = burning.length - 1; n >= 0; n--) {
    const f = burning[n]; f.burnT += dt; const b = fBox(f);
    const sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
    const big = f.kind === 'building';
    const rate = f.tower ? 70 : big ? Math.min(40, Math.sqrt(sx * sz) * 1.2) : 14;
    const towerTop = f.tower ? b.min.y + Math.min(sy, 4 + f.burnT * 1.3) : 0;   // Fernsehturm: Flammen klettern hoch
    for (let i = 0; i < rate * dt * (f.burnT < 2 ? f.burnT / 2 : 1); i++) {
      let x, y, z; const side = Math.random();
      if (f.tower) {                                                    // rund um den Schaft (oben der Korb ist breiter)
        y = rand(b.min.y + .5, towerTop); const a = rand(0, 7), hh = y - b.min.y, rr = hh > 134 && hh < 152 ? 7.8 : 5.5 - Math.min(1, hh / 136) * 2.7;
        x = (b.min.x + b.max.x) / 2 + Math.cos(a) * rr; z = (b.min.z + b.max.z) / 2 + Math.sin(a) * rr;
        fireHuge.spawn(x, y, z, Math.cos(a) * 1.5, rand(3, 7), Math.sin(a) * 1.5, rand(.8, 1.6));
        if (Math.random() < .35) smokeHuge.spawn(x, y + 4, z, rand(-1.5, 1.5) + 2, rand(5, 9), rand(-1.5, 1.5), rand(7, 12));
      }
      else if (side < .4 || !big) { x = rand(b.min.x, b.max.x); z = rand(b.min.z, b.max.z); y = b.max.y - (big ? 0 : rand(0, sy * .5)); }
      else { y = rand(b.min.y + sy * .3, b.max.y); if (Math.random() < .5) { x = Math.random() < .5 ? b.min.x : b.max.x; z = rand(b.min.z, b.max.z); } else { z = Math.random() < .5 ? b.min.z : b.max.z; x = rand(b.min.x, b.max.x); } }
      (big ? fireBig : fireSmall).spawn(x, y, z, rand(-.5, .5), rand(1.5, 3.5), rand(-.5, .5), rand(.5, 1.1));
      if (!big) fireBig.spawn(x, y, z, rand(-.3, .3), rand(1, 2), rand(-.3, .3), rand(.2, .5));
      if (Math.random() < .25) smoke.spawn(x, y + 1, z, rand(-.6, .6), rand(2, 4), rand(-.6, .6), rand(4, 8));
    }
    if (doDark) darken(f, Math.min(1, f.burnT / (big ? 60 : 10)));
    f.spreadT += dt;
    const host = amHost(), own = f.owner === pcar;
    if (f.spreadT > 1) {
      f.spreadT = 0; const range = big ? 5 : f.kind === 'car' ? 11 : 3;   // brennende Autos greifen auf Häuser über
      if (host || own) for (const o of flammables) if (!o.burning && !o.done && Math.random() < (f.kind === 'car' && o.kind === 'building' ? .2 : .07)) {
        const ob = fBox(o);
        if (ob.min.x - range < b.max.x && ob.max.x + range > b.min.x && ob.min.z - range < b.max.z && ob.max.z + range > b.min.z) igniteNet(o, 0, f.kind === 'car' ? 'einem Autobrand' : big ? 'einem Feuer im Nachbargebäude' : 'Funkenflug');
      }
      if (headWorld.x > b.min.x - 1 && headWorld.x < b.max.x + 1 && headWorld.z > b.min.z - 1 && headWorld.z < b.max.z + 1 && headWorld.y < b.max.y + 1) die('Verbrannt');
    }
    // Explodieren entscheidet der Host (bzw. beim eigenen Auto man selbst) -> alle sehen dieselbe Explosion
    if (f.explodeAfter && f.burnT >= f.explodeAfter) { if (host || own) boom(f, true); }
    else if (f.duration && f.burnT > f.duration) { f.burning = false; f.done = true; burning.splice(n, 1); }
  }
}
function boom(f, send) {
  if (f.done) return;
  f.burning = false; f.done = true; const n = burning.indexOf(f); if (n >= 0) burning.splice(n, 1);
  const c = fBox(f).getCenter(V());
  if (f.owner?.kind === 'car') carDestroyed(f.owner);
  if (f.owner?.kind === 'prop') { f.owner.exploded = true; breakProp(f.owner); }
  if (f.owner?.kind === 'pump') f.owner.mesh.visible = false;
  explode(c, f.kind === 'pump' ? 1.3 : 1);
  if (send && f.owner !== pcar) share('boom', { i: flammables.indexOf(f) });
}

// ===================================================================
// Netzwerk-Ereignisse: was einer anzündet/kaputt macht, passiert bei allen
// ===================================================================
const amHost = () => !net.online || [...net.players.keys()].every(id => net.id < id);
function share(k, d) { if (net.online) netSend({ t: 'ev', k, ...d }); }
const r2 = v => Math.round(v * 100) / 100;
function igniteNet(f, bt = 0, why) {
  if (!f || f.burning || f.done) return;
  ignite(f, why); f.burnT = Math.max(f.burnT, bt);
  if (f.owner !== pcar) share('ign', { i: flammables.indexOf(f), bt, r: why || '' });
}
function breakPropNet(p) { if (p.broken) return; breakProp(p); share('prop', { i: props.indexOf(p) }); }
function killPedNet(p, d) { if (!p.alive) return; vilKillByMe = true; killPed(p, d); vilKillByMe = false; share('ped', { i: peds.indexOf(p), d: d ? [r2(d.x), r2(d.z)] : 0 }); }
function damageCarNet(c, n, pos) { if (c === pcar) return damageCar(c, n, pos); damageCar(c, n, pos); share('cdmg', { i: allNpc.indexOf(c), n, p: pos ? pos.toArray().map(r2) : 0 }); }
function glassNet(c, pos) { if (!c.glassMat.visible) return; c.glassMat.visible = false; spawnDebris(pos, 0x9fb7c4, 10, .06, 2); if (c !== pcar) share('glass', { i: allNpc.indexOf(c), p: pos.toArray().map(r2) }); }
function applyEv(m) {
  const P3 = a => V(a[0], a[1], a[2]);
  if (m.k === 'ign') { const f = flammables[m.i]; if (f && f.owner !== pcar) { if (m.a) lastFireAlert = -999; ignite(f, m.r); f.burnT = Math.max(f.burnT, m.bt || 0); } }   // a = vom Admin: Warnung immer zeigen
  else if (m.k === 'tornado') startTornado(m);
  else if (m.k === 'tsunami') startTsunami(m);
  else if (m.k === 'dstop') stopDisasters();
  else if (m.k === 'vil') { setVillain(m.i); }
  else if (m.k === 'boom') { const f = flammables[m.i]; if (f && f.owner !== pcar) boom(f, false); }
  else if (m.k === 'prop') { const p = props[m.i]; if (p) breakProp(p); }
  else if (m.k === 'ped') { const p = peds[m.i]; if (p) killPed(p, m.d ? V(m.d[0], 0, m.d[1]) : null); }
  else if (m.k === 'cdmg') { const c = allNpc[m.i]; if (c) damageCar(c, m.n, m.p ? P3(m.p) : null); }
  else if (m.k === 'glass') { const c = allNpc[m.i]; if (c && c.glassMat.visible) { c.glassMat.visible = false; spawnDebris(P3(m.p), 0x9fb7c4, 10, .06, 2); } }
  else if (m.k === 'shot') {
    const o = P3(m.o), e = P3(m.e);
    playAt(SND.gun, o, 1.6, 10); showTracer(o, e); if (m.h) sparks(e); scarePeds(o, 40);
  }
  else if (m.k === 'w') { weather.target = m.v; if (m.t) weather.t = m.t; }
  else if (m.k === 'hitfx') { const p = P3(m.p); playAt(m.s === 'hit' ? SND.hit : SND.crash, p, 1); sparks(p, 6); }
  else if (m.k === 'rob') { const s = robSpots[m.i]; if (s) robEffects(s); }                       // jemand hat ausgeraubt: Alarm
  else if (m.k === 'horn') playAt(m.s ? SND.ding : SND.horn, P3(m.p), 1.5, 14);
  else if (m.k === 'bark') playAt(SND.bark, P3(m.p), .9, 6);
  else if (m.k === 'chat') { if (!m.to || m.to === net.id) addChat(m); }
}
// Snapshot für Spieler, die später dazukommen
function makeSnap() {
  return {
    b: burning.filter(f => f.owner !== pcar).map(f => [flammables.indexOf(f), r2(f.burnT)]),
    d: flammables.map((f, i) => f.done && f.owner !== pcar ? i : -1).filter(i => i >= 0),
    pr: props.map((p, i) => p.broken ? i : -1).filter(i => i >= 0),
    w: weather.target,
  };
}
function applySnap(s) {
  for (const i of s.pr || []) { const p = props[i]; if (p && !p.broken) { p.exploded = true; p.broken = true; p.mesh.visible = false; if (p.model) { p.model.visible = false; p.model.userData.gone = true; } p.fl.done = true; } }
  for (const i of s.d || []) { const f = flammables[i]; if (!f || f.done) continue; f.done = true; darken(f, 1); if (f.owner?.kind === 'car') carDestroyed(f.owner); if (f.owner?.kind === 'pump') f.owner.mesh.visible = false; }
  for (const [i, bt] of s.b || []) { const f = flammables[i]; if (f) { ignite(f); f.burnT = bt; } }
  if (s.w !== undefined) weather.target = s.w;
}
function carDestroyed(c) {
  c.dead = true; c.speed = 0; c.bodyMat.color.copy(BLACK); c.glassMat.visible = false;
  c.group.rotation.z = rand(-.1, .1); c.group.position.y = -.1;
  if (c.player && player.inCar) { exitCar(); die('Auto explodiert'); }
}
function breakProp(p) {
  if (p.broken) return; p.broken = true; p.mesh.visible = false; if (p.model) { p.model.visible = false; p.model.userData.gone = true; } p.fl.done = true;
  spawnDebris(p.mesh.position, p.color, 10, .15, 3); playAt(SND.crash, p.mesh.position, .8);
  if (p.explosive && !p.exploded) { p.exploded = true; explode(p.mesh.position.clone(), .7); }
  const i = shootables.indexOf(p.mesh); if (i >= 0) shootables.splice(i, 1);
}
function damageCar(c, n, pos) {
  if (c.dead) return; c.hp -= n; c.bodyMat.color.multiplyScalar(.9);
  if (pos) spawnDebris(pos, c.bodyMat.color.getHex(), 3, .1, 2);
  if (c.hp <= 0) ignite(c.fl);
}
function hitAt(p, dirV) {
  for (const pl of net.players.values()) {
    const r = pl.root; if (!r.visible || pl.car || pl.st?.rd) continue;
    if (Math.hypot(r.position.x - p.x, r.position.z - p.z) < .5 && p.y > r.position.y && p.y < r.position.y + 1.95) { pvpHit(pl, 40); return 'player'; }
  }
  for (const ped of peds) if (ped.alive && v1.copy(ped.root.position).setY(p.y).distanceTo(p) < .45 && p.y < ped.root.position.y + 1.9) { killPedNet(ped, dirV); return 'ped'; }
  for (const c of [pcar, ...allNpc]) {
    if (c === pcar && player.inCar) continue;
    const l = c.group.worldToLocal(v1.copy(p));
    if (Math.abs(l.x) < c.half.x && l.y < c.half.y && l.y > .2 && Math.abs(l.z) < c.half.z) {
      damageCarNet(c, 1, p);
      if (l.y > c.half.y * .7 && Math.random() < .4) glassNet(c, p);
      return 'car';
    }
  }
  for (const pr of props) if (!pr.broken && pr.fl.box.clone().expandByScalar(.1).containsPoint(p)) { breakPropNet(pr); return 'prop'; }
  for (const f of flammables) if (f.kind === 'pump' && !f.done && f.box.containsPoint(p)) { igniteNet(f, 2); return 'pump'; }
  for (const f of flammables) if (f.kind === 'building' && !f.hollow?.containsPoint(p) && f.box.clone().expandByScalar(.15).containsPoint(p)) { spawnDebris(p, 0xbbb4a8, 6, .12, 2); return 'wall'; }   // im Innenraum ist Luft
  return null;
}
function heatAt(p, dt) {
  for (const f of flammables) {
    if (f.burning || f.done) continue;
    const b = fBox(f);
    if (p.x > b.min.x - .4 && p.x < b.max.x + .4 && p.y > b.min.y - .4 && p.y < b.max.y + .4 && p.z > b.min.z - .4 && p.z < b.max.z + .4) {
      f.heat += dt; if (f.heat > 1.2) igniteNet(f, 0, 'Brandstiftung');
    }
  }
}

// ===================================================================
// Spieler, Controller, Werkzeuge
// ===================================================================
const player = { inCar: false, calib: V(), dead: false, deadT: 0, hp: 100, hOff: 0, seatOff: 0 };
try { player.seatOff = clamp(+localStorage.getItem('svr_seatoff') || 0, -.7, .7); } catch (e) { }
try { player.hOff = clamp(+localStorage.getItem('svr_hoff') || 0, -.7, .7); } catch (e) { }
let money = 0;
const headWorld = V();
const factory = new XRControllerModelFactory();
const hands = [0, 1].map(i => {
  const ctrl = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i);
  grip.add(factory.createControllerModel(grip)); dolly.add(ctrl, grip);
  const h = { i, ctrl, grip, side: null, gp: null, held: null, now: [], prev: [], down: [], up: [] };
  ctrl.addEventListener('connected', e => { h.side = e.data.handedness; h.gp = e.data.gamepad; });
  ctrl.addEventListener('disconnected', () => { h.side = null; h.gp = null; });
  return h;
});
const handBy = s => hands.find(h => h.side === s);
function pollPads() {
  for (const h of hands) {
    const b = h.gp?.buttons || [];
    for (let k = 0; k < 6; k++) { h.now[k] = !!b[k]?.pressed; h.down[k] = h.now[k] && !h.prev[k]; h.up[k] = !h.now[k] && h.prev[k]; h.prev[k] = h.now[k]; }
  }
}
const haptic = (h, v, ms) => { try { h?.gp?.hapticActuators?.[0]?.pulse(v, ms); } catch (e) { } };
const xrOn = () => renderer.xr.isPresenting;

const belt = new THREE.Group(); dolly.add(belt);
function mkTool() { const g = new THREE.Group(), vis = new THREE.Group(); g.add(vis); return { g, vis }; }
const H = mkTool(), Pi = mkTool(), Li = mkTool();
// Platzhalter-Optik
H.vis.add(new THREE.Mesh(new THREE.CylinderGeometry(.016, .02, .8, 8).rotateX(Math.PI / 2).translate(0, 0, -.35), M(0xd8b400)));
box(.09, .09, .2, M(0x333333), 0, 0, -.8, H.vis).rotation.y = Math.PI / 2;
box(.032, .042, .2, M(0x1b1c1e), 0, .02, -.08, Pi.vis); box(.03, .11, .045, M(0x222222), 0, -.045, .0, Pi.vis);
box(.04, .06, .014, M(0x999999, { metalness: .9 }), 0, 0, 0, Li.vis);
const hammerHead = new THREE.Object3D(); hammerHead.position.set(0, 0, -.8); H.g.add(hammerHead);
const muzzle = new THREE.Object3D(); muzzle.position.set(0, .02, -.19); Pi.g.add(muzzle);
const lighterTip = new THREE.Object3D(); lighterTip.position.set(0, .045, 0); Li.g.add(lighterTip);
const flame = new THREE.Mesh(new THREE.ConeGeometry(.007, .03, 8).translate(0, .015, 0), new THREE.MeshBasicMaterial({ color: 0xffa21a, transparent: true, opacity: .9 }));
flame.visible = false; lighterTip.add(flame);
const TOOLS = [
  { name: 'hammer', obj: H.g, vis: H.vis, head: hammerHead, hp: [-.2, 0, .05], hr: [-Math.PI / 2, 0, 0], prev: V(), cd: 0 },
  { name: 'pistol', obj: Pi.g, vis: Pi.vis, muzzle, hp: [.22, 0, .05], hr: [-Math.PI / 2, 0, 0] },
  { name: 'lighter', obj: Li.g, vis: Li.vis, fl: flame, tip: lighterTip, hp: [.1, .08, -.16], hr: [0, 0, 0] },
];
function holster(t) { belt.add(t.obj); t.obj.position.set(...t.hp); t.obj.rotation.set(...t.hr); t.heldBy = null; if (t.fl) t.fl.visible = false; }
TOOLS.forEach(holster);
function holdTool(t, h) { h.ctrl.add(t.obj); t.obj.position.set(0, -.01, .03); t.obj.rotation.set(0, 0, 0); t.heldBy = h; h.held = { type: 'tool', t }; haptic(h, .3, 40); }

const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x66ccff }));
laser.visible = false;

// HUD
const [hudC, hudG] = C(1024, 128); const hudTex = T(hudC, false);
const hud = new THREE.Mesh(new THREE.PlaneGeometry(.8, .1), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, toneMapped: false }));
hud.renderOrder = 999; hud.position.set(0, -.22, -.9); camera.add(hud);
let hudUntil = 0, hudText = '';
function msg(s, dur = 3) {
  hudUntil = time + dur; if (s === hudText) return; hudText = s;
  hudG.clearRect(0, 0, 1024, 128); hudG.font = '600 42px system-ui';
  const fs = Math.min(42, 42 * 930 / hudG.measureText(s).width); hudG.font = `600 ${fs}px system-ui`;
  const w = Math.min(1000, hudG.measureText(s).width + 60);
  hudG.fillStyle = 'rgba(0,0,0,.65)'; hudG.beginPath(); hudG.roundRect(512 - w / 2, 24, w, 80, 40); hudG.fill();
  hudG.fillStyle = '#fff'; hudG.textAlign = 'center'; hudG.textBaseline = 'middle'; hudG.fillText(s, 512, 64); hudTex.needsUpdate = true;
}
const deathFx = new THREE.Mesh(new THREE.SphereGeometry(.3, 16, 12), new THREE.MeshBasicMaterial({ color: 0x990000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false }));
deathFx.renderOrder = 998; camera.add(deathFx);

function die(why) {
  if (player.dead) return;
  player.dead = true; player.deadT = 0; msg(why + ' – Respawn an der Tankstelle', 4);
  if (player.inCar) exitCar();
  if (player.ride) leaveRide('');
}
function respawn() {
  player.dead = false; player.hp = 100; hurt = 0; deathFx.material.opacity = 0;
  const hd = save.house >= 0 ? houseDoor(homes[save.house]) : null;     // eigenes Haus = Startpunkt
  if (hd) placeHeadAt(hd.x, hd.z); else placeHeadAt(SPAWN.player[0], SPAWN.player[1]);
  resetVehicle(false);   // nach dem Tod steht dein Fahrzeug wieder heil an der Tankstelle
  msg('Respawn – dein Fahrzeug wurde zurückgesetzt', 3);
}
function placeHeadAt(x, z) {
  const off = v1.copy(camera.position).setY(0).applyAxisAngle(UP, dolly.rotation.y);
  dolly.position.set(x - off.x, surfaceAt(x, z), z - off.z);
}

// ===================================================================
// Handy (Low-End: ruckelt, reagiert verzögert, friert beim Anruf ein)
// ===================================================================
const PW = 360, PH = 768;
const [pCan, pg] = C(PW, PH);
const [appCan, ag] = C(PW, PH);
const [snapCan, sg] = C(PW, PH);
const phoneTex = new THREE.CanvasTexture(pCan); phoneTex.colorSpace = THREE.SRGBColorSpace;
const phoneG = new THREE.Group(), phoneBody = new THREE.Group(); phoneG.add(phoneBody);
phoneBody.add(new THREE.Mesh(new RoundedBoxGeometry(.078, .162, .011, 4, .008), M(0x23262b, { metalness: .3, roughness: .55 })));
{
  const bump = new THREE.Mesh(new RoundedBoxGeometry(.026, .034, .004, 2, .004), M(0x15171a, { roughness: .4 })); bump.position.set(-.02, .058, -.0065); phoneBody.add(bump);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(.005, .005, .003, 16).rotateX(Math.PI / 2), M(0x050608, { metalness: .9, roughness: .1 })); lens.position.set(-.02, .065, -.009); phoneBody.add(lens);
  box(.0025, .02, .004, M(0x2c2f34), .0395, .03, 0, phoneBody); box(.0025, .012, .004, M(0x2c2f34), .0395, .055, 0, phoneBody);
}
const rt = new THREE.WebGLRenderTarget(240, 512); rt.texture.colorSpace = THREE.SRGBColorSpace;
const feed = new THREE.Mesh(new THREE.PlaneGeometry(.068, .146), new THREE.MeshBasicMaterial({ map: rt.texture, toneMapped: false }));
feed.position.z = .0058; phoneBody.add(feed);
const ui = new THREE.Mesh(new THREE.PlaneGeometry(.068, .146), new THREE.MeshBasicMaterial({ map: phoneTex, transparent: true, toneMapped: false }));
ui.position.z = .0061; phoneBody.add(ui);
// Handy-Rückkamera: hängt am Handy, 0.5x Ultraweitwinkel (nur diese Kamera)
const phoneCam = new THREE.PerspectiveCamera(108, 240 / 512, .05, 300);
phoneCam.position.set(-.02, .065, -.012); phoneBody.add(phoneCam);
phoneG.visible = false; scene.add(phoneG);
const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 160, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x33ddff, transparent: true, opacity: .25, depthWrite: false, side: THREE.DoubleSide }));
beam.visible = false; scene.add(beam);

const phone = { where: 'pocket', app: 'home', btns: [], call: null, gallery: [], view: -1, wantPhoto: false, flash: 0, dest: null, drawT: 0, cool: 0, queue: [], anim: null, seq: null, raise: 1, appT: 0, ripple: null, zoom: 0 };
const ZOOMS = [{ n: '.5', fov: 108 }, { n: '1x', fov: 72 }, { n: '2x', fov: 40 }];

function setPhone(where) {
  phone.where = where; phoneG.visible = where !== 'pocket';
  if (where === 'pocket') { scene.add(phoneG); phoneG.visible = false; return; }
  if (where === 'holder') { pcar.holder.add(phoneG); phoneG.position.set(0, 0, 0); phoneG.rotation.set(0, 0, 0); phone.raise = 1; return; }
  const L = handBy('left');
  if (xrOn() && L) { L.ctrl.add(phoneG); phoneG.position.set(0, .05, -.07); phoneG.rotation.set(0, 0, 0); }
  else { camera.add(phoneG); deskPhonePose(); }
  phone.raise = 0; phone.drawT = 0;
}
function openApp(a, anim = true) {
  if (a !== 'view') phone.gallery.forEach(it => it.vid?.pause());
  if (anim && phone.where !== 'pocket') { sg.clearRect(0, 0, PW, PH); sg.drawImage(pCan, 0, 0); phone.anim = { t0: time, type: a === 'home' ? 'shrink' : 'zoom' }; }
  phone.app = a; phone.appT = time; phone.drawT = 0; deskPhonePose();
}

function rr(g, x, y, w, h, r, fill) { g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = fill; g.fill(); }
function tx(g, s, x, y, size, color = '#fff', align = 'center', weight = 600) { g.font = `${weight} ${size}px system-ui,sans-serif`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); }
const btn = (x, y, w, h, a) => phone.btns.push({ x, y, w, h, a });
const hhmm = () => { const d = new Date(); return d.getHours().toString().padStart(2, '0') + (Math.floor(time * 2) % 2 && phone.app === 'home' ? ' ' : ':') + d.getMinutes().toString().padStart(2, '0'); };

// Icons selbst zeichnen (Emoji-Schrift ist auf der Quest extrem langsam -> Freeze)
function icon(g, kind, x, y, s = 1) {
  g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round';
  if (kind === 'gps') { g.beginPath(); g.arc(0, -8, 16, Math.PI, 0); g.lineTo(0, 24); g.closePath(); g.fill(); g.fillStyle = '#2fa84f'; g.beginPath(); g.arc(0, -8, 6, 0, 7); g.fill(); }
  if (kind === 'camera') { g.beginPath(); g.roundRect(-26, -14, 52, 34, 6); g.fill(); g.fillRect(-10, -20, 20, 8); g.fillStyle = '#555'; g.beginPath(); g.arc(0, 3, 10, 0, 7); g.fill(); }
  if (kind === 'tel') { g.rotate(-.6); g.beginPath(); g.roundRect(-8, -22, 16, 44, 8); g.fill(); g.fillRect(-14, -24, 14, 10); g.fillRect(-14, 14, 14, 10); }
  if (kind === 'gal') { g.beginPath(); g.roundRect(-24, -18, 48, 36, 5); g.fill(); g.fillStyle = '#f39c12'; g.beginPath(); g.moveTo(-18, 14); g.lineTo(-4, -4); g.lineTo(6, 8); g.lineTo(12, 2); g.lineTo(20, 14); g.fill(); g.beginPath(); g.arc(10, -8, 4, 0, 7); g.fill(); }
  if (kind === 'x') { g.beginPath(); g.moveTo(-12, -12); g.lineTo(12, 12); g.moveTo(12, -12); g.lineTo(-12, 12); g.stroke(); }
  if (kind === 'play') { g.beginPath(); g.moveTo(-10, -14); g.lineTo(14, 0); g.lineTo(-10, 14); g.fill(); }
  if (kind === 'garage') { g.beginPath(); g.roundRect(-26, -4, 52, 16, 5); g.fill(); g.beginPath(); g.moveTo(-16, -4); g.lineTo(-9, -16); g.lineTo(11, -16); g.lineTo(18, -4); g.fill(); g.fillStyle = '#3b6fd8'; for (const x of [-15, 15]) { g.beginPath(); g.arc(x, 13, 6, 0, 7); g.fill(); } }
  if (kind === 'mis') { g.fillRect(-14, -22, 4, 44); g.beginPath(); g.moveTo(-10, -22); g.lineTo(18, -14); g.lineTo(-10, -4); g.fill(); }
  if (kind === 'admin') { g.beginPath(); g.moveTo(0, -24); g.lineTo(20, -16); g.lineTo(18, 6); g.quadraticCurveTo(12, 18, 0, 25); g.quadraticCurveTo(-12, 18, -18, 6); g.lineTo(-20, -16); g.closePath(); g.fill(); g.fillStyle = '#b3001b'; g.font = 'bold 22px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('A', 0, 1); }
  if (kind === 'tornado') { for (let i = 0; i < 6; i++) { const w = 34 - i * 5.5; g.lineWidth = 4; g.beginPath(); g.moveTo(-w / 2 + i * 1.5, -20 + i * 8); g.lineTo(w / 2 + i * 1.5, -20 + i * 8); g.stroke(); } }
  if (kind === 'wave') { g.lineWidth = 5; g.beginPath(); g.moveTo(-24, 14); g.quadraticCurveTo(-10, 14, -4, 0); g.quadraticCurveTo(4, -18, 18, -14); g.quadraticCurveTo(8, -6, 12, 4); g.stroke(); g.beginPath(); g.moveTo(-24, 22); g.lineTo(24, 22); g.stroke(); }
  if (kind === 'vil') { g.beginPath(); g.arc(0, 0, 18, 0, 7); g.stroke(); g.beginPath(); g.arc(0, 0, 8, 0, 7); g.stroke(); g.lineWidth = 3; g.beginPath(); g.moveTo(0, -26); g.lineTo(0, 26); g.moveTo(-26, 0); g.lineTo(26, 0); g.stroke(); }
  if (kind === 'fire') { g.beginPath(); g.moveTo(0, -24); g.quadraticCurveTo(18, -4, 14, 10); g.quadraticCurveTo(10, 24, 0, 24); g.quadraticCurveTo(-10, 24, -14, 10); g.quadraticCurveTo(-16, -2, -6, -10); g.quadraticCurveTo(-4, 0, 0, -2); g.closePath(); g.fill(); }
  if (kind === 'rain') { g.beginPath(); g.arc(-8, -6, 11, Math.PI * .9, Math.PI * 1.9); g.arc(6, -8, 13, Math.PI * 1.1, Math.PI * 2.1); g.lineTo(18, 4); g.lineTo(-18, 4); g.closePath(); g.fill(); g.lineWidth = 3; for (const x of [-10, 0, 10]) { g.beginPath(); g.moveTo(x, 10); g.lineTo(x - 4, 22); g.stroke(); } }
  if (kind === 'stop') { g.beginPath(); g.roundRect(-14, -14, 28, 28, 4); g.fill(); }
  if (kind === 'jobs') { g.beginPath(); g.roundRect(-24, -12, 48, 32, 5); g.fill(); g.lineWidth = 5; g.beginPath(); g.roundRect(-9, -20, 18, 10, 3); g.stroke(); g.fillStyle = '#6d4c41'; g.fillRect(-24, -2, 48, 4); }
  if (kind === 'chat') { g.beginPath(); g.roundRect(-24, -20, 48, 32, 10); g.fill(); g.beginPath(); g.moveTo(-12, 10); g.lineTo(-18, 24); g.lineTo(0, 10); g.fill(); g.fillStyle = '#00897b'; for (const x of [-11, 0, 11]) { g.beginPath(); g.arc(x, -4, 3.5, 0, 7); g.fill(); } }
  if (kind === 'immo') { g.beginPath(); g.moveTo(0, -24); g.lineTo(24, -2); g.lineTo(18, -2); g.lineTo(18, 22); g.lineTo(-18, 22); g.lineTo(-18, -2); g.lineTo(-24, -2); g.closePath(); g.fill(); g.fillStyle = '#5e35b1'; g.fillRect(-6, 6, 12, 16); }
  if (kind === 'tiere') { g.beginPath(); g.arc(0, 8, 11, 0, 7); g.fill(); for (const [x, y] of [[-15, -6], [-5, -15], [6, -15], [15, -6]]) { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); } }
  if (kind === 'radio') { g.beginPath(); g.roundRect(-24, -12, 48, 32, 6); g.fill(); g.lineWidth = 4; g.beginPath(); g.moveTo(-14, -12); g.lineTo(12, -24); g.stroke(); g.fillStyle = '#333'; g.beginPath(); g.arc(-9, 4, 8, 0, 7); g.fill(); g.fillRect(4, -4, 14, 4); g.fillRect(4, 6, 14, 4); }
  if (kind === 'siren') { g.fillStyle = '#ff2a2a'; g.beginPath(); g.arc(-8, 2, 10, Math.PI, 0); g.fill(); g.fillStyle = '#2a6bff'; g.beginPath(); g.arc(10, 2, 10, Math.PI, 0); g.fill(); g.fillStyle = '#fff'; g.fillRect(-22, 4, 44, 8); }
  g.restore();
}
// zeichnet die aktuelle App in appCan
function drawApp() {
  const g = ag; phone.btns = []; g.clearRect(0, 0, PW, PH);
  const a = phone.app, at = time - phone.appT;
  if (a !== 'camera') {
    const gr = g.createLinearGradient(0, 0, PW, PH); const sh = Math.sin(time * .3) * .1;
    gr.addColorStop(0, '#e20074'); gr.addColorStop(.55 + sh, '#5a1050'); gr.addColorStop(1, '#14081c');
    g.fillStyle = a === 'home' ? gr : '#111318'; g.fillRect(0, 0, PW, PH);
  }
  if (a === 'home') {
    tx(g, hhmm(), PW / 2, 150, 76, '#fff', 'center', 300);
    tx(g, new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }), PW / 2, 205, 20);
    const apps = [['GPS', '#2fa84f', 'gps'], ['Kamera', '#555', 'camera'], ['Telefon', '#2fc14f', 'tel'], ['Galerie', '#f39c12', 'gal'],
      ['Garage', '#3b6fd8', 'garage'], ['Missionen', '#d8402b', 'mis'], ['Jobs', '#6d4c41', 'jobs'], ['Chat', '#00897b', 'chat'],
      ['Immobilien', '#5e35b1', 'immo'], ['Tiere', '#ef6c00', 'tiere']];
    if (isAdmin()) apps.push(['Admin', '#b3001b', 'admin']);             // nur für Gabriel
    apps.forEach(([n, c, id], i) => {
      const k = ease((at - i * .07) / .35); if (k <= 0) return;
      const x = 14 + (i % 4) * 85, y = 252 + Math.floor(i / 4) * 118 + (1 - k) * 30;
      g.globalAlpha = k; rr(g, x, y, 72, 72, 18, c); icon(g, id, x + 36, y + 36, .78); tx(g, n, x + 36, y + 88, n.length > 8 ? 12 : 14); g.globalAlpha = 1;
      btn(x, y, 72, 100, 'app:' + id);
    });
    if (phone.missed) { rr(g, 20, 610, PW - 40, 44, 14, 'rgba(0,0,0,.45)'); tx(g, 'Verpasster Anruf: ' + phone.missed, PW / 2, 632, 16); }
    const J = job.id ? JOBS.find(j => j.id === job.id).name : '';
    tx(g, (net.online ? `Online: ${net.players.size + 1}` : 'Offline') + `  ·  ${Math.round(money)} €  ·  ${Math.round(player.hp)} HP` + (save.fuel < 1 && vehicle.type !== 'scooter' ? `  ·  Tank ${Math.round(save.fuel * 100)} %` : ''), PW / 2, 676, 14, net.online ? '#9f9' : '#f99');
    if (J || wanted.stars) tx(g, (J ? 'Job: ' + J : '') + (J && wanted.stars ? '   ' : '') + (wanted.stars ? 'Fahndungsstufe ' + wanted.stars : ''), PW / 2, 700, 14, wanted.stars ? '#ffd21a' : '#cfd8dc');
  } else if (a === 'gps') drawMap(g);
  else if (a === 'garage') {
    tx(g, 'Garage', 24, 100, 34, '#fff', 'left', 700); tx(g, 'Fahrzeug holen – erscheint vor dir', 24, 132, 15, '#aaa', 'left');
    VEHICLES.forEach((v, i) => {
      const y = 155 + i * 58, cur = v.id === vehicle.id;
      rr(g, 16, y, PW - 32, 50, 12, cur ? '#2a4a8a' : '#1e2129'); tx(g, v.name, 32, y + 25, 19, '#fff', 'left'); if (cur) tx(g, 'aktiv', PW - 32, y + 25, 14, '#9cf', 'right');
      btn(16, y, PW - 32, 50, 'veh:' + v.id);
    });
    const yb = 155 + VEHICLES.length * 58 + 6;
    rr(g, 16, yb, PW - 32, 48, 12, '#444'); tx(g, 'Fahrzeug reparieren / holen', PW / 2, yb + 24, 17); btn(16, yb, PW - 32, 48, 'vreset');
    if (!VEHICLES.some(v => v.file)) { tx(g, 'Eigene Autos (BMW, Urus …):', PW / 2, yb + 80, 14, '#aaa'); tx(g, '.glb in assets/models/autos/', PW / 2, yb + 100, 14, '#aaa'); }
  } else if (a === 'jobs') {
    tx(g, 'Jobs', 24, 100, 34, '#fff', 'left', 700); tx(g, 'Konto: ' + Math.round(money) + ' €', 24, 132, 15, '#9f9', 'left');
    JOBS.forEach((j, i) => {
      const y = 150 + i * 92, act = job.id === j.id;
      rr(g, 14, y, PW - 28, 84, 16, act ? j.col : '#1e2129'); if (act) { g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.roundRect(14, y, PW - 28, 84, 16); g.stroke(); }
      tx(g, j.name, 30, y + 26, 20, '#fff', 'left', 800); tx(g, j.desc, 30, y + 52, 13, '#cfd8dc', 'left', 500);
      rr(g, PW - 118, y + 22, 92, 40, 12, act ? '#c62828' : '#2e7d32'); tx(g, act ? 'Beenden' : 'Starten', PW - 72, y + 42, 15, '#fff', 'center', 700);
      btn(14, y, PW - 28, 84, act ? 'jobstop' : 'job:' + j.id);
    });
    const S = save.st;
    tx(g, `Taxi-Fahrten ${S.taxi} · Lieferungen ${S.deliv}`, PW / 2, 538, 14, '#b0bec5'); tx(g, `Festnahmen ${S.arrest} · Raubzüge ${S.rob} · erwischt ${S.busted}`, PW / 2, 560, 14, '#b0bec5');
    tx(g, 'Krimineller: Grip an Kasse/Automat halten (PC: E)', PW / 2, 596, 12, '#90a4ae'); tx(g, 'Polizist: Sirene am Auto-Display (PC: N)', PW / 2, 616, 12, '#90a4ae');
  } else if (a === 'chat') {
    tx(g, 'Chat', 24, 96, 32, '#fff', 'left', 700);
    const pl = [{ id: 0, name: 'Alle' }, ...[...net.players.values()].slice(0, 3)];
    pl.forEach((p, i) => { const x = 14 + i * 84, on = chat.to === p.id; rr(g, x, 116, 78, 32, 12, on ? '#00897b' : '#263238'); tx(g, p.name.slice(0, 9), x + 39, 132, 13, '#fff', 'center', on ? 700 : 500); btn(x, 116, 78, 32, 'chatto:' + p.id); });
    if (chat.to && !net.players.has(chat.to)) chat.to = 0;
    rr(g, 10, 156, PW - 20, 300, 12, '#15181d');
    g.font = '500 14px system-ui,sans-serif'; let y = 446;
    for (const m of save.chat.slice(-12).reverse()) {
      const lines = wrapText(g, m.x, PW - 120).slice(0, 2), h = 20 + lines.length * 17; y -= h + 6; if (y < 160) break;
      const x = m.me ? PW - 22 - (PW - 90) : 20; rr(g, m.me ? 80 : 18, y, PW - 98, h, 10, m.me ? '#00695c' : '#37474f');
      tx(g, (m.me ? 'Du' : m.n) + (m.to ? ' (privat)' : ''), (m.me ? 80 : 18) + 10, y + 11, 11, '#b2dfdb', 'left', 700);
      lines.forEach((l, i) => tx(g, l, (m.me ? 80 : 18) + 10, y + 28 + i * 17, 14, '#fff', 'left', 500));
    }
    if (!xrOn()) { rr(g, 10, 462, PW - 20, 34, 10, '#263238'); tx(g, chat.draft ? chat.draft + (Math.floor(time * 2) % 2 ? '|' : '') : 'Tippen … (Enter = senden)', 20, 479, 14, chat.draft ? '#fff' : '#78909c', 'left', 500); }
    QUICK.forEach((q, i) => { const x = 10 + (i % 3) * 114, y2 = 504 + Math.floor(i / 3) * 44; rr(g, x, y2, 108, 38, 12, '#00796b'); tx(g, q, x + 54, y2 + 19, 13, '#fff', 'center', 600); btn(x, y2, 108, 38, 'q:' + i); });
  } else if (a === 'immo') {
    tx(g, 'Immobilien', 24, 100, 32, '#fff', 'left', 700); tx(g, 'Dein Haus = Startpunkt, Tür öffnet nur für dich', 24, 130, 13, '#b39ddb', 'left', 500);
    homes.forEach((h, i) => {
      const y = 150 + i * 98, mine = save.house === i, d = Math.round(Math.hypot(h.x - headWorld.x, h.z - headWorld.z));
      rr(g, 14, y, PW - 28, 88, 16, mine ? '#4527a0' : '#1e2129');
      tx(g, 'Haus ' + (i + 1) + (mine ? ' – deins' : ''), 30, y + 24, 19, '#fff', 'left', 800); tx(g, h.price.toLocaleString('de-DE') + ' €  ·  ' + (d > 999 ? (d / 1000).toFixed(1) + ' km' : d + ' m'), 30, y + 50, 14, '#d1c4e9', 'left', 500);
      rr(g, 30, y + 60, 92, 22, 8, '#37474f'); tx(g, 'Route', 76, y + 71, 12, '#fff', 'center', 700); btn(30, y + 56, 92, 30, 'hnav:' + i);
      if (!mine) { const ok = money >= h.price; rr(g, PW - 122, y + 22, 96, 40, 12, ok ? '#2e7d32' : '#555'); tx(g, 'Kaufen', PW - 74, y + 42, 15, '#fff', 'center', 700); btn(PW - 122, y + 16, 96, 52, 'buy:' + i); }
    });
    tx(g, 'Konto: ' + Math.round(money) + ' €', PW / 2, 556, 15, '#9f9');
  } else if (a === 'tiere') {
    tx(g, 'Tiere', 24, 100, 32, '#fff', 'left', 700);
    g.save(); g.translate(PW / 2, 250); g.fillStyle = '#8b5a2b'; g.beginPath(); g.ellipse(0, 20, 70, 42, 0, 0, 7); g.fill(); g.beginPath(); g.arc(70, -30, 36, 0, 7); g.fill(); g.fillStyle = '#2b1a10'; g.beginPath(); g.ellipse(52, -60, 12, 24, -.5, 0, 7); g.fill(); g.beginPath(); g.ellipse(92, -58, 12, 24, .5, 0, 7); g.fill(); g.beginPath(); g.arc(100, -24, 7, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(62, -38, 6, 0, 7); g.arc(84, -38, 6, 0, 7); g.fill(); g.fillStyle = '#8b5a2b'; for (const x of [-45, -15, 25, 50]) g.fillRect(x, 50, 14, 46); g.restore();
    if (!save.dog) { tx(g, 'Hund „Bello“', PW / 2, 390, 24, '#fff', 'center', 800); tx(g, 'folgt dir, fährt mit, bellt, lässt sich streicheln', PW / 2, 420, 13, '#ffcc80'); const ok = money >= 600; rr(g, 60, 450, PW - 120, 56, 16, ok ? '#ef6c00' : '#555'); tx(g, 'Kaufen – 600 €', PW / 2, 478, 19, '#fff', 'center', 800); btn(60, 450, PW - 120, 56, 'dog:buy'); }
    else { tx(g, 'Bello ist dein Hund', PW / 2, 390, 22, '#fff', 'center', 800); tx(g, 'Hand an seinen Kopf = streicheln', PW / 2, 420, 13, '#ffcc80'); rr(g, 60, 450, PW - 120, 56, 16, '#ef6c00'); tx(g, 'Bello rufen', PW / 2, 478, 19, '#fff', 'center', 800); btn(60, 450, PW - 120, 56, 'dog:call'); }
  } else if (a === 'admin') {
    // Admin Panel (nur Gabriel): Ereignisse für alle Spieler auslösen
    rr(g, 0, 60, PW, 96, 0, '#5c0010'); tx(g, 'Admin Panel', 24, 96, 32, '#fff', 'left', 800); tx(g, 'Gilt für alle Spieler auf dem Server', 24, 130, 14, '#ffb3b3', 'left', 500);
    const T = disaster.tornado, S = disaster.tsunami;
    [['tornado', 'tornado', 'Tornado starten', T ? 'läuft gerade …' : 'zieht durch die Stadt', '#6b4e16'],
     ['tornado', 'tornado5', 'EF5-Tornado (stärkster)', 'saugt Spieler + Autos ein, wirft sie hoch', '#5c0010'],
     ['wave', 'tsunami', 'Tsunami starten', S ? 'läuft gerade …' : 'Riesenwelle + Überschwemmung', '#0d4f6b'],
     ['vil', 'vil', 'NPC-Angriff starten', vil.ped ? 'läuft gerade …' : 'ein NPC schießt auf andere', '#8e1b1b'],
     ['fire', 'fire', 'Gebäude anzünden', 'ein Haus in der Nähe brennt', '#b34700'],
     ['rain', 'rain', weather.target ? 'Regen ausschalten' : 'Regen einschalten', weather.target ? 'es regnet gerade' : 'es ist gerade trocken', '#2b5d9b'],
     ['stop', 'stop', 'Alles stoppen', 'Tornado, Tsunami, Angriff beenden', '#444a55']].forEach(([ic, act, n, sub, c], i) => {
      const y = 166 + i * 80;
      rr(g, 14, y, PW - 28, 72, 16, c); g.beginPath(); g.arc(50, y + 36, 24, 0, 7); g.fillStyle = 'rgba(0,0,0,.25)'; g.fill(); icon(g, ic, 50, y + 36, .75);
      tx(g, n, 88, y + 26, 18, '#fff', 'left', 800); tx(g, sub, 88, y + 50, 12, 'rgba(255,255,255,.75)', 'left', 500);
      btn(14, y, PW - 28, 72, 'adm:' + act);
    });
  } else if (a === 'mis') {
    tx(g, 'Missionen', 24, 100, 34, '#fff', 'left', 700); tx(g, 'Konto: ' + money + ' €', 24, 132, 16, '#9f9', 'left');
    // Live-Mission: NPC-Angreifer (rot)
    const vy = vil.ped ? 92 : 0;
    if (vil.ped) {
      const d = Math.round(vil.ped.root.position.distanceTo(headWorld)), blink = Math.floor(time * 2) % 2;
      rr(g, 16, 148, PW - 32, 84, 12, blink ? '#8e1b1b' : '#6e1212');
      tx(g, 'Ein NPC greift andere an', 30, 170, 18, '#fff', 'left', 800); tx(g, '+' + VIL_REWARD + ' €', PW - 30, 170, 15, '#ffd0d0', 'right', 700);
      tx(g, 'Deine Aufgabe ist, ihn zu töten.', 30, 194, 14, '#ffc9c9', 'left', 600); tx(g, 'Rot markiert · ' + d + ' m entfernt', 30, 216, 13, '#ff9a9a', 'left', 500);
    }
    MISSIONS.forEach((m, i) => {
      const y = 152 + vy + i * 78, act = mission?.d.id === m.id;
      rr(g, 16, y, PW - 32, 70, 12, act ? '#6a2a1a' : '#1e2129');
      tx(g, m.name, 30, y + 22, 19, '#fff', 'left', 700); tx(g, m.desc, 30, y + 48, 13, '#bbb', 'left'); tx(g, '+' + m.reward + ' €', PW - 30, y + 22, 15, '#9f9', 'right');
      btn(16, y, PW - 32, 70, 'mis:' + m.id);
    });
    if (mission) { const yb = 152 + vy + MISSIONS.length * 78 + 4; rr(g, 16, yb, PW - 32, 46, 12, '#a33'); tx(g, 'Mission abbrechen', PW / 2, yb + 23, 17); btn(16, yb, PW - 32, 46, 'misstop'); }
  }
  else if (a === 'camera') {
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, PH - 170, PW, 170); g.fillRect(0, 0, PW, 60);
    g.beginPath(); g.arc(PW / 2, PH - 100, 38, 0, 7); g.fillStyle = '#fff'; g.fill();
    g.beginPath(); g.arc(PW / 2, PH - 100, 31, 0, 7); g.lineWidth = 4; g.strokeStyle = '#000'; g.stroke();
    btn(PW / 2 - 45, PH - 145, 90, 90, 'photo');
    rr(g, PW - 105, PH - 125, 80, 50, 25, rec.active ? '#ff2b2b' : '#444'); tx(g, rec.active ? 'STOP' : 'REC', PW - 65, PH - 100, 18);
    if (!phone.front) ZOOMS.forEach((z, i) => { const x = PW / 2 - 75 + i * 52, on = phone.zoom === i; g.beginPath(); g.arc(x, PH - 195, 20, 0, 7); g.fillStyle = on ? 'rgba(255,210,30,.9)' : 'rgba(0,0,0,.55)'; g.fill(); tx(g, z.n, x, PH - 195, 13, on ? '#000' : '#fff', 'center', 700); btn(x - 24, PH - 219, 48, 48, 'zoom:' + i); });
    // Kamera umdrehen (Front / Rück)
    g.beginPath(); g.arc(PW - 52, PH - 195, 24, 0, 7); g.fillStyle = 'rgba(0,0,0,.55)'; g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(PW - 52, PH - 195, 11, .3, Math.PI - .3); g.stroke(); g.beginPath(); g.arc(PW - 52, PH - 195, 11, Math.PI + .3, -.3); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(PW - 66, PH - 201); g.lineTo(PW - 60, PH - 193); g.lineTo(PW - 70, PH - 192); g.fill(); g.beginPath(); g.moveTo(PW - 38, PH - 189); g.lineTo(PW - 44, PH - 197); g.lineTo(PW - 34, PH - 198); g.fill();
    btn(PW - 80, PH - 223, 56, 56, 'flip');
    tx(g, phone.front ? 'FRONT' : 'RÜCK', PW - 52, PH - 160, 11, '#ddd');
    btn(PW - 110, PH - 130, 90, 60, 'rec');
    const last = phone.gallery[phone.gallery.length - 1];
    if (last) { g.drawImage(last.type === 'photo' ? last.c : last.thumb, 28, PH - 128, 52, 56); btn(20, PH - 135, 70, 70, 'app:gal'); }
    tx(g, 'FOTO · VIDEO', PW / 2, PH - 30, 14, '#ddd');
    if (rec.active) { const s = Math.floor(time - rec.t0); tx(g, (Math.floor(time * 2) % 2 ? '● ' : '   ') + 'REC 00:' + String(s).padStart(2, '0'), PW / 2, 90, 22, '#ff4040'); }
    if (phone.flash > 0) { g.fillStyle = `rgba(255,255,255,${phone.flash})`; g.fillRect(0, 0, PW, PH); }
  } else if (a === 'tel') {
    tx(g, 'Spieler online', 24, 100, 30, '#fff', 'left', 700);
    tx(g, 'Du: ' + net.name, 24, 130, 16, '#aaa', 'left');
    const list = [...net.players.values()];
    if (!list.length) { tx(g, 'Niemand sonst online.', PW / 2, 300, 20, '#bbb'); tx(g, 'Öffne die Seite auf einem', PW / 2, 340, 17, '#888'); tx(g, 'zweiten Gerät zum Mitspielen.', PW / 2, 364, 17, '#888'); }
    list.slice(0, 7).forEach((p, i) => {
      const k = ease((at - i * .06) / .3), y = 150 + i * 72 + (1 - k) * 30;
      const d = p.root ? Math.round(p.root.position.distanceTo(headWorld)) : 0;
      g.globalAlpha = k; rr(g, 16, y, PW - 32, 62, 14, '#1e2129');
      rr(g, 28, y + 11, 40, 40, 20, '#e20074'); tx(g, p.name[0].toUpperCase(), 48, y + 31, 20); tx(g, p.name, 84, y + 24, 22, '#fff', 'left'); tx(g, d + ' m entfernt', 84, y + 46, 13, '#999', 'left');
      g.beginPath(); g.arc(PW - 50, y + 31, 20, 0, 7); g.fillStyle = '#2fc14f'; g.fill(); icon(g, 'tel', PW - 50, y + 31, .55);
      g.globalAlpha = 1; btn(16, y, PW - 32, 62, 'call:' + p.id);
    });
  } else if (a === 'gal') {
    tx(g, 'Galerie', 24, 100, 34, '#fff', 'left', 700);
    if (!phone.gallery.length) tx(g, 'Noch keine Fotos', PW / 2, 300, 20, '#999');
    phone.gallery.slice(-12).forEach((it, k) => {
      const i = phone.gallery.length - Math.min(12, phone.gallery.length) + k;
      const x = 12 + (k % 3) * 114, y = 140 + Math.floor(k / 3) * 150;
      if (it.dash) { g.fillStyle = '#000'; g.fillRect(x, y, 108, 142); const s = it.thumb, sw = s.height * 108 / 142; g.drawImage(s, (s.width - sw) / 2, 0, sw, s.height, x, y, 108, 142); tx(g, 'Dashcam', x + 8, y + 14, 11, '#ffd21a', 'left', 700); }   // Querformat: Mitte ausschneiden
      else g.drawImage(it.type === 'photo' ? it.c : it.thumb, x, y, 108, 142);
      if (it.type === 'clip') { icon(g, 'play', x + 54, y + 71, 1.2); tx(g, it.len + ' s', x + 96, y + 130, 13, '#fff', 'right'); }
      btn(x, y, 108, 142, 'view:' + i);
    });
  } else if (a === 'view') {
    const it = phone.gallery[phone.view];
    if (it) {
      if (it.type === 'clip') {
        if (it.vid.paused) it.vid.play().catch(() => { });
        const src = it.vid.readyState >= 2 ? it.vid : it.thumb;
        if (it.dash) { g.fillStyle = '#000'; g.fillRect(0, 60, PW, PH - 200); const h = PW * 9 / 16; g.drawImage(src, 0, 60 + (PH - 200 - h) / 2, PW, h); tx(g, 'Dashcam-Video', PW / 2, 110, 18, '#ffd21a', 'center', 700); }   // Querformat mit schwarzen Balken
        else g.drawImage(src, 0, 60, PW, PH - 200);
      }
      else g.drawImage(it.c, 0, 60, PW, PH - 200);
      rr(g, 20, PH - 130, 150, 54, 14, '#333'); tx(g, '← Zurück', 95, PH - 103, 20); btn(20, PH - 130, 150, 54, 'app:gal');
      rr(g, 190, PH - 130, 150, 54, 14, '#2b6cff'); tx(g, 'Speichern', 265, PH - 103, 20); btn(190, PH - 130, 150, 54, 'save');
      rr(g, 20, PH - 66, PW - 40, 44, 14, '#5d1a1a'); tx(g, 'Löschen', PW / 2, PH - 44, 17); btn(20, PH - 66, PW - 40, 44, 'del');
    }
  } else if (a === 'incoming') {
    const gr = g.createLinearGradient(0, 0, 0, PH); gr.addColorStop(0, '#203a5a'); gr.addColorStop(1, '#0b0f18'); g.fillStyle = gr; g.fillRect(0, 0, PW, PH);
    for (let i = 0; i < 3; i++) { const k = ((time * .8 + i / 3) % 1); g.beginPath(); g.arc(PW / 2, 210, 60 + k * 70, 0, 7); g.strokeStyle = `rgba(226,0,116,${.6 * (1 - k)})`; g.lineWidth = 4; g.stroke(); }
    rr(g, PW / 2 - 60, 150, 120, 120, 60, '#e20074'); tx(g, phone.call.name[0], PW / 2, 212, 60);
    tx(g, phone.call.name, PW / 2, 330, 34, '#fff', 'center', 700); tx(g, 'eingehender Anruf' + '.'.repeat(1 + Math.floor(time * 2) % 3), PW / 2, 372, 20, '#bbb');
    const wob = Math.sin(time * 9) * 6;
    g.beginPath(); g.arc(90, PH - 170, 42, 0, 7); g.fillStyle = '#ff3b30'; g.fill(); icon(g, 'x', 90, PH - 170);
    g.beginPath(); g.arc(PW - 90, PH - 170 + wob, 42, 0, 7); g.fillStyle = '#34c759'; g.fill(); icon(g, 'tel', PW - 90, PH - 170 + wob, .9);
    tx(g, 'Ablehnen', 90, PH - 105, 18); tx(g, 'Annehmen', PW - 90, PH - 105, 18);
    btn(30, PH - 230, 120, 140, 'decline'); btn(PW - 150, PH - 230, 120, 140, 'accept');
  } else if (a === 'incall' || a === 'outgoing') {
    g.fillStyle = '#0f1420'; g.fillRect(0, 0, PW, PH);
    rr(g, PW / 2 - 60, 150, 120, 120, 60, '#e20074'); tx(g, phone.call.name[0], PW / 2, 212, 60);
    tx(g, phone.call.name, PW / 2, 330, 34, '#fff', 'center', 700);
    let st = 'Wählt' + '.'.repeat(1 + Math.floor(time * 2) % 3);
    if (a === 'incall') { const s = Math.floor(time - phone.call.t0); st = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); for (let i = 0; i < 12; i++) { const hgt = 6 + Math.abs(Math.sin(time * 7 + i)) * 26; rr(g, PW / 2 - 66 + i * 11, 430 - hgt / 2, 6, hgt, 3, '#34c759'); } }
    if (phone.call.state === 'offline') st = phone.call.text || 'Nicht erreichbar';
    tx(g, st, PW / 2, 372, 22, '#bbb');
    g.beginPath(); g.arc(PW / 2, PH - 170, 42, 0, 7); g.fillStyle = '#ff3b30'; g.fill(); icon(g, 'x', PW / 2, PH - 170);
    btn(PW / 2 - 60, PH - 230, 120, 140, 'hangup');
  }
  tx(g, hhmm(), 28, 26, 18, '#fff', 'left'); tx(g, 'Telekom 4G   23%', PW - 20, 26, 15, '#fff', 'right');
  if (!['incoming', 'incall', 'outgoing'].includes(a)) { rr(g, PW / 2 - 60, PH - 16, 120, 6, 3, '#fff'); if (a !== 'home') btn(0, PH - 48, PW, 48, 'app:home'); }
  // Mitteilung oben (z.B. "Auto verbunden")
  const N0 = phone.notif;
  if (N0 && time < N0.until) {
    const k = Math.min(ease((time - N0.t0) / .3), ease((N0.until - time) / .3)), y = -76 + 118 * k;
    rr(g, 12, y, PW - 24, 68, 18, 'rgba(32,35,44,.96)');
    g.beginPath(); g.arc(46, y + 34, 20, 0, 7); g.fillStyle = '#34c759'; g.fill(); icon(g, 'tel', 46, y + 34, .5);
    tx(g, N0.title, 78, y + 24, 18, '#fff', 'left', 700); tx(g, N0.text, 78, y + 47, 13, '#bbb', 'left', 500);
  }
  if (phone.ripple && time - phone.ripple.t < .35) { const k = (time - phone.ripple.t) / .35; g.beginPath(); g.arc(phone.ripple.x, phone.ripple.y, 10 + k * 50, 0, 7); g.fillStyle = `rgba(255,255,255,${.35 * (1 - k)})`; g.fill(); }
}

// Wie oft das Handy-Bild neu gezeichnet wird: nur so oft wie nötig (jedes Neuzeichnen = Textur-Upload, kostet auf der Quest)
function phoneRate() {
  const a = phone.app, at = time - phone.appT;
  if (phone.anim || at < .8 || (phone.ripple && time - phone.ripple.t < .4) || phone.flash > 0) return 1 / 30;   // Übergänge/Antippen: flüssig
  if (phone.notif && time < phone.notif.until) return 1 / 20;
  if (a === 'incoming') return 1 / 20;
  if (a === 'gps' || a === 'view') return 1 / 15;
  if (a === 'incall' || a === 'outgoing' || (a === 'camera' && rec.active)) return 1 / 6;
  return 1 / 2;                                                                    // ruhige Bildschirme (Uhr, Listen)
}
// setzt das Bild aufs Handy (mit Übergängen)
function composePhone() {
  drawApp();
  pg.clearRect(0, 0, PW, PH);
  const A = phone.anim;
  if (A) {
    const k = ease((time - A.t0) / (A.type === 'slide' ? .5 : .45));
    if (A.type === 'zoom') { pg.drawImage(snapCan, 0, 0); const s = .25 + .75 * k; pg.globalAlpha = k; pg.drawImage(appCan, PW * (1 - s) / 2, PH * (1 - s) / 2, PW * s, PH * s); }
    else if (A.type === 'shrink') { pg.drawImage(appCan, 0, 0); const s = 1 - .7 * k; pg.globalAlpha = 1 - k; pg.drawImage(snapCan, PW * (1 - s) / 2, PH * (1 - s) / 2, PW * s, PH * s); }
    else if (A.type === 'slide') { pg.filter = 'grayscale(1) brightness(.3)'; pg.drawImage(snapCan, 0, 0); pg.filter = 'none'; pg.drawImage(appCan, 0, -PH * (1 - k)); }
    pg.globalAlpha = 1;
    if (k >= 1) phone.anim = null;
  } else pg.drawImage(appCan, 0, 0);
  phoneTex.needsUpdate = true;
}

function drawMap(g) {
  const S = player.inCar ? .3 : .9, cx = PW / 2, cy = 330, px = headWorld.x, pz = headWorld.z;
  g.save(); g.beginPath(); g.rect(0, 50, PW, 560); g.clip();
  g.fillStyle = '#d9d4c7'; g.fillRect(0, 50, PW, 560);
  const X = x => cx + (x - px) * S, Y = z => cy + (z - pz) * S;
  const col = { downtown: '#b9b4ab', apts: '#c8c1b4', houses: '#d6cdb9', school: '#e3c38f', tank: '#f1d36b', market: '#e3a7a7', park: '#9bc58a' };
  for (const b of blocks) { g.fillStyle = col[b.type]; g.fillRect(X(b.cx - BLOCK / 2), Y(b.cz - BLOCK / 2), BLOCK * S, BLOCK * S); }
  g.strokeStyle = '#fff'; g.lineWidth = ROAD * S;
  for (const r of R) { g.beginPath(); g.moveTo(X(r), Y(-HALF - 8)); g.lineTo(X(r), Y(HALF + 8)); g.stroke(); g.beginPath(); g.moveTo(X(-HALF - 8), Y(r)); g.lineTo(X(HALF + 8), Y(r)); g.stroke(); }
  g.beginPath(); g.moveTo(X(R[3]), Y(HALF)); g.lineTo(X(R[3]), Y(HZ)); g.stroke();
  g.strokeStyle = '#f2a33a'; g.lineWidth = Math.max(4, 26 * S); g.beginPath(); g.moveTo(X(-TS / 2), Y(HZ)); g.lineTo(X(TS / 2), Y(HZ)); g.stroke();
  g.beginPath(); g.moveTo(X(HX), Y(-TS / 2)); g.lineTo(X(HX), Y(HZ)); g.stroke();
  g.strokeStyle = '#fff'; g.lineWidth = Math.max(3, 9 * S); g.beginPath(); mroadPts.forEach((p, i) => i ? g.lineTo(X(p.x), Y(p.z)) : g.moveTo(X(p.x), Y(p.z))); g.stroke();
  g.beginPath(); g.moveTo(X(HALF + 8), Y(R[4])); g.lineTo(X(HX), Y(R[4])); g.stroke();
  if (mission) { const tg = mission.car ? [mission.car.group.position.x, mission.car.group.position.z] : mission.pts[mission.step]; if (tg) { g.beginPath(); g.arc(X(tg[0]), Y(tg[1]), 9 + Math.sin(time * 6) * 3, 0, 7); g.fillStyle = '#ffd21a'; g.fill(); } }
  for (const [n, [x, z]] of Object.entries(POI)) { g.beginPath(); g.arc(X(x), Y(z), 7, 0, 7); g.fillStyle = '#2b6cff'; g.fill(); tx(g, n, X(x), Y(z) - 16, 13, '#123'); }
  if (vil.ped) { const q = vil.ped.root.position; g.beginPath(); g.arc(X(q.x), Y(q.z), 9 + Math.sin(time * 8) * 3, 0, 7); g.fillStyle = '#e01010'; g.fill(); tx(g, 'Angreifer', X(q.x), Y(q.z) - 18, 13, '#900', 'center', 800); }
  if (phone.dest) {
    const [dx, dz] = phone.dest.p;
    g.strokeStyle = '#2b6cff'; g.lineWidth = 6; g.lineJoin = 'round';
    if (nav.route) { g.beginPath(); g.moveTo(cx, cy); for (let i = nav.k; i < nav.route.length; i++) g.lineTo(X(nav.route[i].x), Y(nav.route[i].z)); g.stroke(); }   // Route über die Straßen
    else { g.setLineDash([10, 8]); g.lineDashOffset = -time * 20; g.beginPath(); g.moveTo(cx, cy); g.lineTo(X(dx), Y(dz)); g.stroke(); g.setLineDash([]); }
    g.beginPath(); g.arc(X(dx), Y(dz), 9 + Math.sin(time * 5) * 3, 0, 7); g.fillStyle = '#e20074'; g.fill();
  }
  camera.getWorldDirection(v1);
  g.save(); g.translate(cx, cy); g.rotate(Math.atan2(v1.x, -v1.z));
  g.beginPath(); g.arc(0, 0, 16 + Math.sin(time * 4) * 3, 0, 7); g.fillStyle = 'rgba(226,0,116,.2)'; g.fill();
  g.beginPath(); g.moveTo(0, -14); g.lineTo(10, 10); g.lineTo(0, 5); g.lineTo(-10, 10); g.closePath(); g.fillStyle = '#e20074'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke();
  g.restore(); g.restore();
  if (phone.dest) { const d = Math.hypot(phone.dest.p[0] - px, phone.dest.p[1] - pz); rr(g, 12, 62, PW - 24, 44, 12, 'rgba(0,0,0,.7)'); tx(g, `Ziel ${phone.dest.n}: ${d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'}`, PW / 2, 84, 20); }
  Object.keys(POI).forEach((n, i) => {
    const x = 12 + (i % 3) * 114, y = 620 + Math.floor(i / 3) * 52;
    rr(g, x, y, 108, 44, 12, phone.dest?.n === n ? '#e20074' : '#2a2e38'); tx(g, n, x + 54, y + 22, 14); btn(x, y, 108, 44, 'dest:' + n);
  });
}

function phoneAction(a) {
  playAt(SND.tap, headWorld, .4);
  if (a.startsWith('app:')) return openApp(a.slice(4));
  if (a.startsWith('dest:')) { const n = a.slice(5); if (nav.on && nav.n === n) stopNav(); else startNav(n); return; }
  if (a.startsWith('view:')) { phone.view = +a.slice(5); return openApp('view'); }
  if (a === 'photo') { phone.wantPhoto = true; phone.flash = 1; return; }
  if (a === 'rec') { if (rec.active) stopRec(); else startRec(); return; }
  if (a.startsWith('zoom:')) { phone.zoom = +a.slice(5); phoneCam.fov = ZOOMS[phone.zoom].fov; phoneCam.updateProjectionMatrix(); return; }
  if (a === 'flip') { setCamSide(!phone.front); return; }
  if (a.startsWith('veh:')) { getVehicle(a.slice(4)); return; }
  if (a === 'vreset') { resetVehicle(true); if (save.fuel < .25) { save.fuel = .25; money = Math.max(0, money - 50); msg('Fahrzeug geholt + Benzin für 50 €', 2.5); } else msg('Fahrzeug zurückgesetzt', 2); return; }
  if (a.startsWith('mis:')) { startMission(a.slice(4)); return openApp('home'); }
  if (a === 'misstop') { mission = null; msg('Mission abgebrochen', 2); return; }
  if (a.startsWith('adm:')) { adminAction(a.slice(4)); return; }
  if (a.startsWith('job:')) { startJob(a.slice(4)); return; }
  if (a === 'jobstop') { endJob(); phone.drawT = 0; return; }
  if (a.startsWith('chatto:')) { chat.to = +a.slice(7); return; }
  if (a.startsWith('q:')) { sendChat(QUICK[+a.slice(2)]); return; }
  if (a.startsWith('buy:')) { buyHome(+a.slice(4)); return; }
  if (a.startsWith('hnav:')) { const h = homes[+a.slice(5)]; if (h) { const d = houseDoor(h); startNavXY('Haus ' + (+a.slice(5) + 1), [d.x, d.z]); msg('Route zum Haus', 2); } return; }
  if (a === 'dog:buy') { if (money < 600) return msg('Zu wenig Geld (600 €)', 2); money -= 600; save.dog = true; writeSave(); msg('Bello gehört jetzt dir!', 3); playAt(SND.bark, headWorld, .8, 4); return; }
  if (a === 'dog:call') { if (dog.g) { dog.pos.set(headWorld.x + 1, 0, headWorld.z + 1); } playAt(SND.bark, headWorld, .8, 4); msg('Bello kommt!', 1.5); return; }
  if (a === 'del') { delGallery(phone.view); return openApp('gal'); }
  if (a === 'save') {
    const it = phone.gallery[phone.view]; if (!it) return;
    const l = document.createElement('a');
    if (it.type === 'clip') { l.download = 'stuttgart_' + Date.now() + '.' + it.ext; l.href = it.url; } else { l.download = 'stuttgart_' + Date.now() + '.png'; l.href = it.c.toDataURL('image/png'); }
    l.click(); msg('Gespeichert', 2); return;
  }
  if (a.startsWith('call:')) {
    const id = +a.slice(5), pl = net.players.get(id); if (!pl || phone.call) return;
    phone.call = { id, name: pl.name, state: 'dial', t0: time }; openApp('outgoing');
    netSig(id, { call: 'ring' });
    return;
  }
  if (a === 'accept' && phone.call) { ring.pause(); phone.call.state = 'active'; phone.call.t0 = time; openApp('incall', false); netSig(phone.call.id, { call: 'accept' }); callAudio(phone.call.id, true); return; }
  if (a === 'decline' || a === 'hangup') { if (phone.call) netSig(phone.call.id, { call: 'end' }); endCall(); }
}
function endCall(text) {
  ring.pause(); ring.currentTime = 0; phone.seq = null; phone.anim = null;
  if (phone.call) callAudio(phone.call.id, false);
  if (text && phone.call) { phone.call.state = 'offline'; phone.call.text = text; phone.drawT = 0; const c = phone.call; setTimeout(() => { if (phone.call === c) { phone.call = null; openApp('home'); } }, 2000); return; }
  phone.call = null; phone.seq = null; openApp('home');
}
// Tipp wird sofort verarbeitet (flüssiges Handy)
function phoneClickUV(uv) {
  if (phone.seq) return;
  phone.queue.push({ x: uv.x * PW, y: (1 - uv.y) * PH, at: time });
}
function startIncoming(name, id) {
  phone.call = { id, name, state: 'ring', t0: time };
  ring.currentTime = 0; ring.play().catch(() => { });           // 1) Ton spielt sofort
  if (phone.where === 'pocket' && !cp.conn) { setPhone('hand'); composePhone(); }   // mit dem Auto verbunden: Anruf kommt aufs Display
  sg.clearRect(0, 0, PW, PH);
  if (feed.visible) sg.drawImage(capture(), 0, 0, PW, PH);
  sg.drawImage(pCan, 0, 0);
  phone.seq = { t0: time, stage: 0 };                            // 2) Handy friert ein
}
function updPhone(dt) {
  const S = phone.seq;
  if (S) {
    const e = time - S.t0;
    if (e >= 1 && S.stage === 0) {                               // 3) nach 1 s: schwarz-weiß + dunkel
      S.stage = 1; feed.visible = false;
      pg.clearRect(0, 0, PW, PH); pg.filter = 'grayscale(1) brightness(.32) contrast(1.1)'; pg.drawImage(snapCan, 0, 0); pg.filter = 'none';
      phoneTex.needsUpdate = true;
    }
    if (e >= 1.5 && S.stage === 1) {                             // 4) nach 0,5 s: Anruf-Bildschirm
      phone.seq = null; phone.app = 'incoming'; phone.appT = time;
      phone.anim = { t0: time, type: 'slide' }; phone.drawT = 0;
    }
  }
  if (phone.call?.state === 'ring') {
    if (Math.floor(time * 2) !== Math.floor((time - dt) * 2)) haptic(handBy('left'), .6, 120);
    if (time - phone.call.t0 > 25) { netSig(phone.call.id, { call: 'end' }); phone.missed = phone.call.name; endCall(); msg('Verpasster Anruf'); }
  }
  phone.flash = Math.max(0, phone.flash - dt * 3);
  // Rausholen-Animation
  if (phone.raise < 1) { phone.raise = Math.min(1, phone.raise + dt / .35); phoneBody.position.y = -.12 * (1 - ease(phone.raise)); phoneBody.rotation.x = .9 * (1 - ease(phone.raise)); }
  else { phoneBody.position.y = 0; phoneBody.rotation.x = 0; }
  if (!phoneG.visible) return;
  // verzögerte Taps
  for (let i = phone.queue.length - 1; i >= 0; i--) {
    const q = phone.queue[i]; if (time < q.at) continue; phone.queue.splice(i, 1);
    for (let j = phone.btns.length - 1; j >= 0; j--) { const b = phone.btns[j]; if (q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h) { phone.ripple = { x: q.x, y: q.y, t: time }; phoneAction(b.a); phone.drawT = 0; break; } }
  }
  if (phone.seq) return; // eingefroren (nur beim Anruf-Effekt)
  phone.drawT -= dt;
  if (phone.drawT <= 0) { composePhone(); phone.drawT = phoneRate(); }
  if (player.inCar && phone.where === 'hand' && time > phone.cool) {
    phoneG.getWorldPosition(v1); pcar.holder.getWorldPosition(v2);
    if (v1.distanceTo(v2) < .16) { setPhone('holder'); msg('Handy in der Halterung'); }
  }
}
function capture(target = rt) {
  const w = target.width, h = target.height, buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(target, 0, 0, w, h, buf);
  const [c, g] = C(w, h); const id = g.createImageData(w, h);
  for (let y = 0; y < h; y++) id.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  g.putImageData(id, 0, 0); return c;
}
// ---------- Frontkamera (Selfie) ----------
// Du selbst als Figur – nur für die Handy-Kamera sichtbar (eigene Ebene), nicht in deinem Sichtfeld
const SELF = 6; phoneCam.layers.enable(SELF);
let me = null;
const setLayer = (o, l) => o.traverse(c => c.layers.set(l));
// PC: für Selfies hält man das Handy auf Armlänge
function deskPhonePose() { if (phoneG.parent !== camera) return; if (phone.front && phone.app === 'camera') { phoneG.position.set(.06, -.05, -.62); phoneG.rotation.set(0, -.08, 0); } else { phoneG.position.set(.12, -.08, -.3); phoneG.rotation.set(0, -.15, 0); } }
function setCamSide(front) {
  phone.front = front; deskPhonePose();
  if (front) { phoneCam.position.set(0, .069, .008); phoneCam.rotation.set(0, Math.PI, 0); phoneCam.fov = 88; feed.scale.x = -1; }   // Vorschau gespiegelt wie beim echten Handy
  else { phoneCam.position.set(-.02, .065, -.012); phoneCam.rotation.set(0, 0, 0); phoneCam.fov = ZOOMS[phone.zoom].fov; feed.scale.x = 1; }
  phoneCam.updateProjectionMatrix();
}
// Dein eigener Körper: Rumpf, Beine, Arme und Hände siehst du, wenn du runterschaust.
// Den Kopf sieht nur die Handy-Kamera (Selfie), sonst würde er dir die Sicht versperren.
function updSelf(dt) {
  if (!me) {
    me = { id: 0, name: '', root: new THREE.Group(), st: null, first: true, hp: V(), hq: new THREE.Quaternion() };
    scene.add(me.root); makeAvatar(me);
    const i = shootables.indexOf(me.hit); if (i >= 0) shootables.splice(i, 1);
    me.layerBody = null;
  }
  me.root.visible = !player.dead;
  me.st = myState(); updAvatar(me, dt, 1, true);
  if (me.layerBody !== me.body) { setLayer(me.headM, SELF); me.phone.visible = false; me.hit.visible = false; me.layerBody = me.body; }
}
// ---------- Handy in der Halterung: Zittern beim Fahren, kurzes heftiges Wackeln beim Crash ----------
function updHolderShake(dt) {
  phone.crash = Math.max(0, (phone.crash || 0) - dt * .065);
  if (phone.where !== 'holder') return;
  // weiches Vibrieren (überlagerte Schwingungen) statt Zufall pro Bild – das sah wie ein Glitch aus
  const sp = Math.abs(pcar.speed), amp = Math.min(1, sp / 25) * .0007 + (sp > .5 ? .00015 : 0) + phone.crash;
  const t = time, n = (a, b, c) => Math.sin(t * a) * .5 + Math.sin(t * b + 1.3) * .3 + Math.sin(t * c + 2.1) * .2;
  phoneG.position.set(n(23, 37, 61) * amp, n(29, 43, 71) * amp, 0);
  phoneG.rotation.set(n(19, 31, 53) * amp * 4, n(17, 41, 67) * amp * 4, n(13, 27, 47) * amp * 3);
}
// Handy-Kamerabild asynchron auslesen (für Video + Bildschirm-Teilen): die GPU muss nicht anhalten -> kein Ruckler.
// WebGL2: Pixel in einen Puffer kopieren lassen und erst abholen, wenn die GPU fertig ist.
// Je Kamera ein eigener Ausleser (Handy, Dashcam)
const mkGrab = target => ({ target, want: [], pending: null, sync: null, pbo: null, buf: null, can: null, g: null });
const grab = mkGrab(rt);
function grabRT(cb, G = grab) { G.want.push(cb); }
function grabIssue(G = grab) {
  const gl = renderer.getContext();
  if (!G.want.length || G.sync || !renderer.capabilities.isWebGL2) { if (!renderer.capabilities.isWebGL2 && G.want.length) { const c = capture(G.target); G.want.splice(0).forEach(f => f(c)); } return; }
  const w = G.target.width, h = G.target.height;
  if (!G.pbo) { G.pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, G.pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ); G.buf = new Uint8Array(w * h * 4); [G.can, G.g] = C(w, h); G.img = G.g.createImageData(w, h); }
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, G.pbo);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);         // liest aus dem gerade gebundenen Kamerabild
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  G.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
  G.pending = G.want.splice(0);
}
function grabPoll(G = grab) {
  if (!G.sync) return;
  const gl = renderer.getContext(), st = gl.clientWaitSync(G.sync, 0, 0);
  if (st === gl.TIMEOUT_EXPIRED) return;
  gl.deleteSync(G.sync); G.sync = null;
  const w = G.target.width, h = G.target.height;
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, G.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, G.buf); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  for (let y = 0; y < h; y++) G.img.data.set(G.buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  G.g.putImageData(G.img, 0, 0);
  for (const f of G.pending) f(G.can);
  G.pending = null;
}
// Handykamera: am PC jedes Bild, in VR jedes 2. Bild (36 fps – echte Handys filmen mit 30). Schatten werden dafür nicht neu berechnet.
let camFrame = 0;
function renderPhoneCam() {
  grabPoll();
  if (phone.seq) return;                                  // Kamerabild bleibt beim Einfrieren stehen
  feed.visible = phoneG.visible && phone.app === 'camera' && !phone.anim;
  if (!feed.visible && !rec.active) return;
  if (xrOn() && ++camFrame % 2 && !phone.wantPhoto) return;
  const xr = renderer.xr.enabled; renderer.xr.enabled = false;
  const prev = renderer.getRenderTarget(), su = renderer.shadowMap.autoUpdate;
  ui.visible = false; const fv = feed.visible; feed.visible = false; renderer.shadowMap.autoUpdate = false;
  try { renderer.setRenderTarget(rt); renderer.render(scene, phoneCam); recFrame(); grabIssue(); }
  finally { renderer.setRenderTarget(prev); ui.visible = true; feed.visible = fv; renderer.xr.enabled = xr; renderer.shadowMap.autoUpdate = su; }
  if (phone.wantPhoto) { phone.wantPhoto = false; addGallery({ type: 'photo', c: capture() }); msg('Foto gespeichert'); }
}

// ===================================================================
// Navigation: Straßennetz als Graph, Route (Dijkstra) und Sprachansagen
// ===================================================================
const NAV = (() => {
  const nodes = [], edges = [], key = new Map();
  const node = (x, z) => { const k = Math.round(x) + ',' + Math.round(z); let i = key.get(k); if (i === undefined) { i = nodes.length; nodes.push({ x, z, adj: [] }); key.set(k, i); } return i; };
  const link = (a, b) => { if (a === b) return; const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z); nodes[a].adj.push({ to: b, d }); nodes[b].adj.push({ to: a, d }); edges.push([a, b]); };
  const line = pts => { for (let i = 1; i < pts.length; i++) link(node(...pts[i - 1]), node(...pts[i])); };
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {          // Stadtraster
    if (i < N) link(node(R[i], R[j]), node(R[i + 1], R[j]));
    if (j < N) link(node(R[i], R[j]), node(R[i], R[j + 1]));
  }
  line([[R[3], R[N]], [R[3], HZ]]);                                     // Zubringer A8
  line([[-2000, HZ], [R[3], HZ], [HX, HZ], [2000, HZ]]);               // A8
  line([[R[N], R[4]], [HX, R[4]]]);                                     // Zubringer A81
  line([[HX, HZ], [HX, R[4]], [HX, -600], [HX, -2100]]);               // A81
  line([[R[4], R[0]], ...mroadPts.filter((p, i) => i % 3 === 0 || i === mroadPts.length - 1).map(p => [p.x, p.z])]);   // Bergstraße
  return { nodes, edges };
})();
function nearestOnRoad(x, z) {
  let best = null;
  for (const [a, b] of NAV.edges) {
    const A = NAV.nodes[a], B = NAV.nodes[b], dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - A.x) * dx + (z - A.z) * dz) / L2, 0, 1), px = A.x + dx * t, pz = A.z + dz * t, d = (x - px) ** 2 + (z - pz) ** 2;
    if (!best || d < best.d) best = { a, b, x: px, z: pz, d };
  }
  return best;
}
// kürzester Weg über die Straßen; Punkte mit Abbiege-Hinweis ('rechts' / 'links' / 'wenden') an Kreuzungen
function findRoute(fx, fz, tx, tz) {
  const s = nearestOnRoad(fx, fz), e = nearestOnRoad(tx, tz), nodes = NAV.nodes, n = nodes.length, S = n, E = n + 1;
  const P = i => i === S ? s : i === E ? e : nodes[i];
  const sameEdge = (s.a === e.a && s.b === e.b) || (s.a === e.b && s.b === e.a);
  const nb = i => {
    const out = i === S ? [s.a, s.b] : i === E ? [] : nodes[i].adj.map(q => q.to);
    if (i === e.a || i === e.b || (i === S && sameEdge)) out.push(E);
    return out;
  };
  const dist = new Float64Array(n + 2).fill(Infinity), prev = new Int32Array(n + 2).fill(-1), done = new Uint8Array(n + 2);
  dist[S] = 0;
  for (;;) {
    let u = -1, b = Infinity; for (let i = 0; i < n + 2; i++) if (!done[i] && dist[i] < b) { b = dist[i]; u = i; }
    if (u < 0 || u === E) break; done[u] = 1;
    for (const v of nb(u)) { const d = dist[u] + Math.hypot(P(u).x - P(v).x, P(u).z - P(v).z); if (d < dist[v]) { dist[v] = d; prev[v] = u; } }
  }
  const path = []; for (let i = E; i >= 0; i = prev[i]) { path.push(i); if (i === S) break; }
  path.reverse();
  let pts = path[0] === S ? path.map(i => ({ x: P(i).x, z: P(i).z, junc: i < n && nodes[i].adj.length >= 3, turn: null })) : [{ x: s.x, z: s.z }, { x: e.x, z: e.z }];
  pts = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > .5);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const ix = b.x - a.x, iz = b.z - a.z, ox = c.x - b.x, oz = c.z - b.z, il = Math.hypot(ix, iz), ol = Math.hypot(ox, oz);
    const ang = Math.atan2((ix * oz - iz * ox) / il / ol, (ix * ox + iz * oz) / il / ol);   // > 0 = rechts (Blick in Fahrtrichtung)
    if (b.junc && Math.abs(ang) > .6) b.turn = Math.abs(ang) > 2.6 ? 'wenden' : ang > 0 ? 'rechts' : 'links';
  }
  return pts;
}
// ---------- Sprachansagen als Aufnahmen (assets/voice/*.wav) – der Quest-Browser hat keine Sprachausgabe ----------
// Erzeugt mit tools/make-voice.ps1 (deutsche Windows-Stimme). Ansagen werden aus Teilen zusammengesetzt.
const VOICE = {};
// alle Ansagen stecken in einer Datei (assets/voice/voice.bin, 16-Bit-PCM) + Inhaltsverzeichnis voice.json
Promise.all([fetch('assets/voice/voice.json').then(r => r.json()), fetch('assets/voice/voice.bin').then(r => r.arrayBuffer())]).then(([ix, bin]) => {
  for (const [k, [off, len]] of Object.entries(ix.clips)) {
    const pcm = new Int16Array(bin, off, len / 2), buf = AC.createBuffer(1, pcm.length, ix.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) d[i] = pcm[i] / 32768;
    VOICE[k] = buf;
  }
}).catch(e => console.warn('Sprachansagen fehlen', e));
const voiceGain = AC.createGain(); voiceGain.gain.value = 1.15; voiceGain.connect(AC.destination);
let voiceEnd = 0, voiceSrcs = [];
// Teile nacheinander abspielen (now = laufende Ansage abbrechen)
function playVoice(parts, now = false) {
  if (AC.state !== 'running') return;
  if (now) { voiceSrcs.forEach(s => { try { s.stop(); } catch (e) { } }); voiceSrcs = []; voiceEnd = 0; }
  let t = Math.max(AC.currentTime + .05, voiceEnd);
  for (const k of [].concat(parts)) {
    const b = VOICE[k]; if (!b) continue;
    const s = AC.createBufferSource(); s.buffer = b; s.connect(voiceGain); s.start(t); voiceSrcs.push(s);
    s.onended = () => { voiceSrcs = voiceSrcs.filter(x => x !== s); }; t += b.duration + .03;
  }
  voiceEnd = t;
}
// Spielername als Teile: "Spieler487" -> Spieler vier acht sieben (andere Namen gehen nur mit Sprachausgabe, z.B. am PC)
const nameParts = n => { const m = /^spieler\s*(\d{1,4})$/i.exec(n || ''); return m ? ['spieler', ...m[1].split('').map(d => 'z' + d)] : null; };
// Entfernung als Teil ("500 Meter", "eineinhalb Kilometer" …)
const distKey = d => { const L = [500, 600, 700, 800, 900, 1000, 1500, 2000, 2500, 3000, 4000, 5000]; return 'd' + L.reduce((a, b) => Math.abs(b - d) < Math.abs(a - d) ? b : a); };
// Notlösung: Sprachausgabe des Browsers (gibt es am PC, auf der Quest nicht)
function say(t) { try { if (!speechSynthesis.getVoices().length) return; const u = new SpeechSynthesisUtterance(t); u.lang = 'de-DE'; speechSynthesis.speak(u); } catch (e) { } }
const fmtDist = d => d >= 950 ? (d / 1000).toFixed(1).replace('.', ',') + ' Kilometer' : Math.max(50, Math.round(d / 50) * 50) + ' Meter';
const fmtShort = d => d >= 950 ? (d / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(d / 10) * 10 + ' m';
SND.chime = mkBuf(1, t => (Math.sin(2 * Math.PI * 784 * t) * (t < .2 ? Math.exp(-t * 6) : 0) + (t >= .17 ? Math.sin(2 * Math.PI * 1175 * t) * Math.exp(-(t - .17) * 4.5) : 0)) * .45);
SND.arrive = mkBuf(1.5, t => [523, 659, 784].reduce((s, f, i) => s + (t >= i * .17 ? Math.sin(2 * Math.PI * f * t) * Math.exp(-(t - i * .17) * 3.5) : 0), 0) * .33);
SND.ding = mkBuf(.6, t => Math.sin(2 * Math.PI * 988 * t) * Math.exp(-t * 6) * .3);
SND.recalc = mkBuf(.7, t => (Math.sin(2 * Math.PI * 740 * t) * (t < .16 ? Math.exp(-t * 14) : 0) + (t >= .14 ? Math.sin(2 * Math.PI * 988 * t) * Math.exp(-(t - .14) * 7) : 0)) * .32);
// kurzer Ton direkt ins Ohr (nicht im Raum)
function uiTone(buf) { if (AC.state !== 'running') return; const s = AC.createBufferSource(); s.buffer = buf; s.connect(voiceGain); s.start(); }

const nav = { on: false, n: '', p: null, route: null, end: null, k: 1, said: new Set(), offT: 0, t: 0, info: null };
const navPos = () => player.inCar ? pcar.group.position : headWorld;
function speak(parts, now) { if (player.inCar) playVoice(parts, now); }
function startNav(n) {
  const p = POI[n]; if (!p) return;
  phone.dest = { n, p }; beam.position.set(p[0], 80, p[1]); beam.visible = true;
  Object.assign(nav, { on: true, n, p, offT: 0, t: 0 });
  planRoute(true); phone.drawT = 0; cp.drawT = 0;
  msg('Navigation: ' + n, 2);
}
function stopNav() { nav.on = false; nav.route = null; nav.info = null; phone.dest = null; beam.visible = false; cp.drawT = 0; phone.drawT = 0; }
function planRoute(first) {
  const pos = navPos();
  nav.route = findRoute(pos.x, pos.z, nav.p[0], nav.p[1]); nav.end = nav.route[nav.route.length - 1]; nav.k = 1; nav.said = new Set();
  if (first) speak('nav_berechnet', true); else if (player.inCar) uiTone(SND.recalc);   // Neuberechnung: nur ein kurzer Ton
  const r = nav.route;
  if (player.inCar && r.length > 1) {   // falsche Richtung? -> wenden
    const dx = r[1].x - r[0].x, dz = r[1].z - r[0].z, l = Math.hypot(dx, dz) || 1;
    if ((Math.sin(pcar.heading) * dx + Math.cos(pcar.heading) * dz) / l < -.4) speak('nav_wenden');
  }
}
function arrive() {
  const n = nav.n; stopNav();
  playAt(SND.arrive, headWorld, .9, 4);
  playVoice('nav_ziel', true);
  msg('Ziel erreicht: ' + n, 3);
}
// läuft immer (auch zu Fuß mit der GPS-App); Sprachansagen nur am Steuer
function updNav(dt) {
  if (!nav.on || !nav.route) return;
  nav.t -= dt; if (nav.t > 0) return; nav.t = .2;
  const pos = navPos(), r = nav.route;
  if (Math.hypot(pos.x - nav.end.x, pos.z - nav.end.z) < 25 || Math.hypot(pos.x - nav.p[0], pos.z - nav.p[1]) < 30) return arrive();
  // Fortschritt: Punkt gilt als passiert, wenn man nah dran war oder schon ein Stück auf der nächsten Straße ist
  while (nav.k < r.length - 1) {
    const A = r[nav.k], B = r[nav.k + 1], dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1;
    if (((pos.x - A.x) * dx + (pos.z - A.z) * dz) / L > 7 || Math.hypot(pos.x - A.x, pos.z - A.z) < 9) nav.k++; else break;
  }
  // von der Route abgekommen? -> neu berechnen
  {
    const A = r[nav.k - 1], B = r[nav.k], dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz || 1;
    const t = clamp(((pos.x - A.x) * dx + (pos.z - A.z) * dz) / L2, 0, 1), off = Math.hypot(pos.x - A.x - dx * t, pos.z - A.z - dz * t);
    nav.offT = off > 35 ? nav.offT + .2 : 0;
    if (nav.offT > 1.6) { nav.offT = 0; planRoute(false); return; }
  }
  const distTo = i => { let d = Math.hypot(r[nav.k].x - pos.x, r[nav.k].z - pos.z); for (let j = nav.k; j < i; j++) d += Math.hypot(r[j + 1].x - r[j].x, r[j + 1].z - r[j].z); return d; };
  let m = -1; for (let i = nav.k; i < r.length - 1; i++) if (r[i].turn) { m = i; break; }
  const sp = player.inCar ? Math.abs(pcar.speed) : 1.5;
  if (m >= 0) {
    const d = distTo(m), dir = r[m].turn, junc = r.slice(nav.k, m).some(q => q.junc);
    nav.info = { dir, d };
    if (!nav.said.has('pre' + m) && (junc || d > 250)) {
      nav.said.add('pre' + m);
      speak(d > 400 ? ['nav_folge', distKey(d), 'nav_dann_' + dir] : 'nav_gerade_' + dir);
    } else if (!nav.said.has('near' + m) && !junc && d < Math.max(70, sp * 4.5)) {
      nav.said.add('near' + m); nav.said.add('pre' + m);
      if (player.inCar) playAt(SND.ding, headWorld, .6, 3);
      speak('nav_next_' + dir, true);
    }
  } else {
    const d = distTo(r.length - 1);
    nav.info = { dir: 'ziel', d };
    if (!nav.said.has('ziel') && d > 120) { nav.said.add('ziel'); speak(d > 400 ? ['nav_folge', distKey(d), 'nav_dann_ziel'] : 'nav_ziel_vorne'); }
  }
}

// ===================================================================
// CarPlay: Hauptdisplay (Telefon, Karte, Türschloss) + zweites Display hinter dem Lenkrad (Intro, Mini-Karte, Tacho)
// ===================================================================
const CW = 768, CH = 384, RX = 704;                       // RX: rechts davon sitzt der Türschloss-Schalter
const [carCan, cg] = C(CW, CH);
const carTex = new THREE.CanvasTexture(carCan); carTex.colorSpace = THREE.SRGBColorSpace; carTex.anisotropy = 4;
const carMat = new THREE.MeshBasicMaterial({ map: carTex, toneMapped: false });
// on = Display an (man sitzt im Auto), conn = Handy verbunden (Telefon + Karte), callMin = Anruf als grüner Punkt
const cp = { on: false, conn: false, mesh: null, app: 'home', btns: [], drawT: 0, banner: -9, ripple: null, appT: 0, callMin: false, alert: null, uv: null };
const pokeRay = new THREE.Raycaster();
// Bild genau auf die UV-Fläche des Modell-Bildschirms legen (manche Modelle nutzen nur einen Teil der Textur)
function fitTex(tex, b) { if (!b) return; tex.repeat.set(1 / (b.u1 - b.u0), 1 / (b.v1 - b.v0)); tex.offset.set(-b.u0 / (b.u1 - b.u0), -b.v0 / (b.v1 - b.v0)); }
const uvToCanvas = (uv, b, W, H) => b ? [(uv.x - b.u0) / (b.u1 - b.u0) * W, (1 - (uv.y - b.v0) / (b.v1 - b.v0)) * H] : [uv.x * W, (1 - uv.y) * H];
SND.welcome = mkBuf(3.2, t => {                           // eigener Willkommens-Gong (sanfte Glocken, aufsteigend)
  let s = 0; [[0, 587], [.22, 784], [.44, 988], [.7, 1175], [.7, 784]].forEach(([t0, f]) => { if (t >= t0) { const u = t - t0; s += (Math.sin(2 * Math.PI * f * u) + .35 * Math.sin(2 * Math.PI * f * 2 * u) + .12 * Math.sin(2 * Math.PI * f * 3 * u)) * Math.exp(-u * 2.2) * Math.min(1, u * 60); } });
  return s * .16 + Math.sin(2 * Math.PI * 294 * t) * Math.exp(-t * 1.1) * Math.min(1, t * 8) * .08;
});
SND.warn = mkBuf(1.6, t => { const k = Math.floor(t / .4); return t % .4 < .3 ? Math.sin(2 * Math.PI * (k % 2 ? 660 : 880) * t) * .35 * Math.min(1, (.3 - t % .4) * 30) : 0; });
SND.beep = mkBuf(.5, t => (t < .14 || (t > .24 && t < .38)) ? Math.sign(Math.sin(2 * Math.PI * 2900 * t)) * .22 : 0);
function cpOn() {
  Object.assign(cp, { on: true, conn: false, mesh: pcar.screen, uv: pcar.screenUV, app: 'home', appT: time, drawT: 0, callMin: false });
  fitTex(carTex, cp.uv); cp.mesh.material = carMat;
}
function cpOff() {
  if (cp.mesh) cp.mesh.material = pcar.screen === cp.mesh ? pcar.screenOrig : cp.mesh.material;
  const wasConn = cp.conn; cp.on = false; cp.conn = false; cp.mesh = null;
  if (wasConn && phone.call?.state === 'active') callAudio(phone.call.id, true);   // Gespräch zurück ans Ohr
}
function cpConnect() {
  cp.conn = true; cp.banner = time; cp.drawT = 0;
  playAt(SND.chime, cp.mesh.getWorldPosition(V()), 1, 3);
  phone.notif = { title: 'Auto verbunden', text: 'CarPlay · ' + vehicle.name, t0: time, until: time + 3.5 }; phone.drawT = 0;
  msg('Telefon – Auto verbunden', 3);
  if (phone.call?.state === 'active') callAudio(phone.call.id, true);   // laufendes Gespräch über die Auto-Lautsprecher
}
function updCarPlay(dt) {
  const want = player.inCar && !!pcar.screen && vehicle.type !== 'scooter' && !pcar.dead;
  if (cp.on && (!want || cp.mesh !== pcar.screen)) cpOff();
  if (!cp.on && want) cpOn();
  if (cp.on && !cp.conn && phone.where !== 'pocket') cpConnect();     // eingestiegen + Handy raus -> verbinden
  if (!phone.call) cp.callMin = false;
  updNav(dt); updDialTone(); updCluster(dt);
  if (!cp.on) return;
  const pad = onPad(); if (pad && !cp.padSeen) { cp.app = 'tune'; cp.appT = time; cp.drawT = 0; msg('Willkommen in der Tuning-Werkstatt', 2.5); } cp.padSeen = pad;   // auf der Werkstatt-Fläche: Tuning öffnet sich
  // mit dem Finger (Controller-Spitze) aufs Display tippen
  if (xrOn()) for (const h of hands) {
    h.ctrl.updateWorldMatrix(true, false);
    pokeRay.ray.origin.setFromMatrixPosition(h.ctrl.matrixWorld);
    pokeRay.ray.direction.set(0, 0, -1).transformDirection(h.ctrl.matrixWorld);
    pokeRay.near = 0; pokeRay.far = .09;
    const hit = pokeRay.intersectObject(cp.mesh, false)[0];
    if (hit && !h.poke) { h.poke = true; if (carClickUV(hit.uv)) haptic(h, .35, 35); } else if (!hit) h.poke = false;
  }
  cp.drawT -= dt;
  if (cp.drawT <= 0) {
    drawCar(); carTex.needsUpdate = true;
    const busy = time - cp.banner < 4 || time - cp.appT < .5 || (cp.ripple && time - cp.ripple.t < .4) || phone.call?.state === 'ring' || (cp.alert && time - cp.alert.t < 9);
    cp.drawT = busy ? 1 / 20 : cp.app === 'map' || (cp.app === 'radio' && radio.on) || fuelInfo.filling ? 1 / 10 : phone.call || canFuel() || onPad() ? 1 / 4 : 1 / 2;
  }
}
function carClickUV(uv) {
  if (!cp.on) return false;
  const [x, y] = uvToCanvas(uv, cp.uv, CW, CH);
  for (let j = cp.btns.length - 1; j >= 0; j--) {
    const b = cp.btns[j];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { cp.ripple = { x, y, t: time }; playAt(SND.tap, cp.mesh.getWorldPosition(V()), .6, 2); carAction(b.a); cp.drawT = 0; return true; }
  }
  return false;
}
function carAction(a) {
  if (a === 'lock') { pcar.locked = !pcar.locked; playAt(SND.click, cp.mesh.getWorldPosition(V()), 1, 3); msg(pcar.locked ? 'Auto abgeschlossen – niemand kann einsteigen' : 'Türen entsperrt – andere können einsteigen', 2.5); return; }
  if (a === 'callmax') { cp.callMin = false; return; }
  if (a.startsWith('radio:')) { setRadio(+a.slice(6)); return; }
  if (a === 'radiooff') { radio.on = false; msg('Radio aus', 1.5); return; }
  if (a === 'vol:+' || a === 'vol:-') { save.vol = clamp(save.vol + (a === 'vol:+' ? .1 : -.1), 0, 1); return; }
  if (a === 'siren') { setSiren(!job.siren); return; }
  if (a === 'fuel') { startFuel(); return; }
  if (a.startsWith('tn:')) { const [, k, i] = a.split(':'); buyTune(k, +i); return; }
  if (a.startsWith('app:')) {
    const id = a.slice(4);
    if (!cp.conn && id !== 'home' && id !== 'radio' && id !== 'tune') { msg('Hol dein Handy raus, dann verbindet es sich mit dem Auto', 3); return; }
    cp.app = id; cp.appT = time; if (phone.call && phone.call.state !== 'ring') cp.callMin = true;   // im Anruf: Gespräch wird zum grünen Punkt
    return;
  }
  if (a.startsWith('dest:')) { startNav(a.slice(5)); return; }
  if (a === 'navstop') { stopNav(); playVoice('nav_ende', true); return; }
  phoneAction(a);                                                      // Anrufen / Annehmen / Ablehnen / Auflegen läuft übers Handy
}
let cbtnList = cp.btns;
const cbtn = (x, y, w, h, a) => cbtnList.push({ x, y, w, h, a });
function localCarView() {
  return { btns: cp.btns, conn: cp.conn, app: cp.app, call: phone.call, callMin: cp.callMin, locked: pcar.locked, appT: cp.appT, name: net.name, veh: vehicle.name,
    players: [...net.players.values()], nav, speed: Math.abs(pcar.speed), pos: pcar.group.position, heading: pcar.heading, alert: cp.alert, banner: cp.banner, ripple: cp.ripple,
    radio: radio.on ? radio.st : -1, vol: save.vol, fuel: save.fuel, canFuel: canFuel(), filling: fuelInfo.filling, onPad: onPad(), police: job.id === 'police', siren: job.siren, tune: save.tune[vehicle.id] || {}, local: true };
}
// Text auf mehrere Zeilen umbrechen
function wrapText(g, s, maxW) { const out = []; let line = ''; for (const w of s.split(' ')) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; }
function warnIcon(g, x, y, s = 1) { g.save(); g.translate(x, y); g.scale(s, s); g.beginPath(); g.moveTo(0, -18); g.lineTo(18, 14); g.lineTo(-18, 14); g.closePath(); g.fillStyle = '#ffd21a'; g.fill(); g.fillStyle = '#111'; g.fillRect(-2.5, -7, 5, 12); g.fillRect(-2.5, 8, 5, 4); g.restore(); }
function lockIcon(g, x, y, locked, s = 1) {
  g.save(); g.translate(x, y); g.scale(s, s); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 4;
  g.beginPath(); if (locked) g.arc(0, -6, 9, Math.PI, 0); else g.arc(-10, -6, 9, Math.PI, -.2); g.stroke();
  rr(g, -13, -6, 26, 20, 4, '#fff'); g.fillStyle = '#222'; g.fillRect(-2, 0, 4, 8); g.restore();
}
// Abbiege-Pfeil für die Navigation
function navArrow(g, dir, x, y, s = 1) {
  g.save(); g.translate(x, y); g.scale(s, s); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
  const head = (hx, hy, ang) => { g.save(); g.translate(hx, hy); g.rotate(ang); g.beginPath(); g.moveTo(0, -11); g.lineTo(10, 4); g.lineTo(-10, 4); g.closePath(); g.fill(); g.restore(); };
  g.beginPath();
  if (dir === 'rechts' || dir === 'links') { const k = dir === 'rechts' ? 1 : -1; g.moveTo(-6 * k, 22); g.lineTo(-6 * k, -2); g.quadraticCurveTo(-6 * k, -12, 4 * k, -12); g.lineTo(12 * k, -12); g.stroke(); head(16 * k, -12, k * Math.PI / 2); }
  else if (dir === 'wenden') { g.moveTo(8, 22); g.lineTo(8, -4); g.arc(-2, -4, 10, 0, Math.PI, true); g.lineTo(-12, 8); g.stroke(); head(-12, 12, Math.PI); }
  else if (dir === 'ziel') { g.moveTo(-8, 22); g.lineTo(-8, -20); g.stroke(); g.fillStyle = '#e20074'; g.beginPath(); g.moveTo(-8, -20); g.lineTo(16, -12); g.lineTo(-8, -3); g.closePath(); g.fill(); }
  else { g.moveTo(0, 22); g.lineTo(0, -10); g.stroke(); head(0, -14, 0); }
  g.restore();
}
// Karte mit Route (Blick in Fahrtrichtung = oben), dunkles Design wie im Auto; Angreifer = roter Punkt
function drawRouteMap(g, x0, y0, w, h, S, heading, px, pz, nv = nav) {
  g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
  g.fillStyle = '#1c2029'; g.fillRect(x0, y0, w, h);
  const cx = x0 + w / 2, cy = y0 + h * .7;
  g.translate(cx, cy); g.rotate(-Math.PI / 2 - Math.atan2(Math.cos(heading), Math.sin(heading))); g.scale(S, S); g.translate(-px, -pz);
  const col = { downtown: '#2a2f39', apts: '#262b34', houses: '#232831', school: '#3a3426', tank: '#3d3a22', market: '#3a2a2e', park: '#1f3324' };
  for (const b of blocks) { g.fillStyle = col[b.type] || '#262b34'; g.fillRect(b.cx - BLOCK / 2, b.cz - BLOCK / 2, BLOCK, BLOCK); }
  const ln = (a, b, c, d) => { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); };
  g.lineCap = 'butt'; g.strokeStyle = '#4b5363'; g.lineWidth = ROAD;
  for (const r of R) { ln(r, -HALF - 8, r, HALF + 8); ln(-HALF - 8, r, HALF + 8, r); }
  ln(R[3], HALF, R[3], HZ); ln(HALF + 8, R[4], HX, R[4]);
  g.lineWidth = 10; g.beginPath(); mroadPts.forEach((p, i) => i ? g.lineTo(p.x, p.z) : g.moveTo(p.x, p.z)); g.stroke();
  g.strokeStyle = '#b8823e'; g.lineWidth = 26; ln(-TS / 2, HZ, TS / 2, HZ); ln(HX, -TS / 2, HX, HZ);
  if (nv.route) {
    const r = nv.route; g.strokeStyle = '#3d8bff'; g.lineWidth = Math.max(7, 7 / S); g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(px, pz); for (let i = nv.k; i < r.length; i++) g.lineTo(r[i].x, r[i].z); g.stroke();
    g.fillStyle = '#e20074'; g.beginPath(); g.arc(nv.end.x, nv.end.z, 10 / S, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 3 / S; g.stroke();
  }
  if (vil.ped) { const q = vil.ped.root.position; g.fillStyle = Math.floor(time * 3) % 2 ? '#ff2020' : '#ff8080'; g.beginPath(); g.arc(q.x, q.z, 11 / S, 0, 7); g.fill(); }
  // Polizist: gesuchte Spieler + flüchtender Räuber (blau/rot blinkend)
  if (job.id === 'police') {
    const dot = q => { g.fillStyle = Math.floor(time * 4) % 2 ? '#2a5bff' : '#ff2020'; g.beginPath(); g.arc(q.x, q.z, 10 / S, 0, 7); g.fill(); };
    for (const p of net.players.values()) if (p.st?.ws) dot(p.st.c && p.carMesh ? p.carMesh.position : p.root.position);
    if (job.robber) dot(job.robber.root.position);
  }
  g.restore();
  g.save(); g.translate(cx, cy);                                       // eigenes Auto: Pfeil nach oben
  g.beginPath(); g.arc(0, 0, 20, 0, 7); g.fillStyle = 'rgba(61,139,255,.25)'; g.fill();
  g.beginPath(); g.moveTo(0, -15); g.lineTo(11, 11); g.lineTo(0, 5); g.lineTo(-11, 11); g.closePath(); g.fillStyle = '#fff'; g.fill();
  g.restore();
}
function drawCar() { cp.btns = []; drawCarView(cg, localCarView()); }
// W = was angezeigt wird (eigenes Auto oder – für Mitfahrer – das des Fahrers)
function drawCarView(g, W) {
  cbtnList = W.btns; g.textBaseline = 'middle';
  g.fillStyle = '#07080b'; g.fillRect(0, 0, CW, CH);
  // Leiste links (wie CarPlay): Uhrzeit, Home, Telefon, Karte
  g.fillStyle = '#15171d'; g.fillRect(0, 0, 76, CH);
  tx(g, hhmm(), 38, 22, 17, '#fff', 'center', 700); tx(g, W.conn ? '5G' : '–', 38, 42, 11, '#9aa', 'center', 700);
  const showCall = W.call && W.conn && (W.call.state === 'ring' || !W.callMin);
  const dock = [['home', '#3a3f4b', 92], ['tel', '#34c759', 172], ['map', '#2b6cff', 252], ['radio', '#8e24aa', 332]];
  for (const [id, c, y] of dock) {
    const on = W.app === id && !showCall; if (on) rr(g, 4, y - 30, 4, 60, 2, '#fff');
    g.globalAlpha = W.conn || id === 'home' || id === 'radio' ? 1 : .35;
    g.beginPath(); g.arc(40, y, 27, 0, 7); g.fillStyle = c; g.fill();
    if (id === 'home') { for (const [dx, dy] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) rr(g, 40 + dx - 6, y + dy - 6, 12, 12, 3, '#fff'); }
    else if (id === 'tel') icon(g, 'tel', 40, y, .6); else if (id === 'radio') icon(g, 'radio', 40, y, .6); else navArrow(g, 'gerade', 40, y + 2, .7);
    g.globalAlpha = 1; cbtn(0, y - 38, 76, 76, 'app:' + id);
  }
  // Türschloss-Schalter rechts (immer da)
  {
    const lk = W.locked; g.fillStyle = '#101217'; g.fillRect(RX, 0, CW - RX, CH);
    rr(g, RX + 10, 118, 44, 120, 22, lk ? '#7a1f1f' : '#1f6b35');
    g.beginPath(); g.arc(RX + 32, lk ? 148 : 208, 18, 0, 7); g.fillStyle = '#fff'; g.fill();
    lockIcon(g, RX + 32, lk ? 150 : 210, lk, .55);
    tx(g, lk ? 'Zu' : 'Offen', RX + 32, 258, 13, lk ? '#ff9a9a' : '#8fe3a5', 'center', 700);
    tx(g, 'Türen', RX + 32, 100, 11, '#99a', 'center', 600);
    cbtn(RX, 90, CW - RX, 190, 'lock');
  }
  const X0 = 84, cx = (X0 + RX) / 2;
  if (showCall) {
    // Anruf: eingehend (mit Klingelton), wählt, aktiv
    const c = W.call, ringing = c.state === 'ring';
    if (ringing) for (let i = 0; i < 3; i++) { const k = (time * .8 + i / 3) % 1; g.beginPath(); g.arc(cx, 128, 46 + k * 50, 0, 7); g.strokeStyle = `rgba(52,199,89,${.55 * (1 - k)})`; g.lineWidth = 3; g.stroke(); }
    g.beginPath(); g.arc(cx, 128, 46, 0, 7); g.fillStyle = '#e20074'; g.fill(); tx(g, c.name[0].toUpperCase(), cx, 130, 44, '#fff', 'center', 700);
    tx(g, c.name, cx, 205, 30, '#fff', 'center', 700);
    let st = ringing ? 'Eingehender Anruf' + '.'.repeat(1 + Math.floor(time * 2) % 3) : c.state === 'dial' ? 'Wählt' + '.'.repeat(1 + Math.floor(time * 2) % 3) : '';
    if (c.state === 'active') { const s = Math.floor(time - c.t0); st = 'Verbunden · ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
    if (c.state === 'offline') st = c.text || 'Nicht erreichbar';
    tx(g, st, cx, 238, 17, '#aab', 'center', 500);
    const btnC = (x, color, kind, label, act, wob = 0) => { g.beginPath(); g.arc(x, 310 + wob, 32, 0, 7); g.fillStyle = color; g.fill(); if (kind === 'x') icon(g, 'x', x, 310 + wob, .9); else icon(g, 'tel', x, 310 + wob, .7); tx(g, label, x, 362, 14, '#ccd', 'center', 600); cbtn(x - 60, 260, 120, 120, act); };
    if (ringing) { btnC(cx - 130, '#ff3b30', 'x', 'Ablehnen', 'decline'); btnC(cx + 130, '#34c759', 'tel', 'Annehmen', 'accept', Math.sin(time * 9) * 4); }
    else if (c.state !== 'offline') btnC(cx, '#ff3b30', 'x', 'Auflegen', 'hangup');
    if (!ringing) tx(g, 'Andere App antippen = Anruf läuft im Hintergrund weiter', cx, 22, 12, '#778', 'center', 500);
  } else if (W.app === 'home') {
    tx(g, 'Guten Tag, ' + W.name, X0 + 24, 40, 20, '#fff', 'left', 700);
    tx(g, W.conn ? 'Telefon verbunden' : 'Kein Telefon verbunden – hol dein Handy raus', X0 + 24, 64, 13, W.conn ? '#7fdc8f' : '#f0b45a', 'left', 600);
    const tiles = [['tel', 'Telefon', '#34c759'], ['map', 'Karte', '#2b6cff'], ['radio', W.radio >= 0 ? STATIONS[W.radio].name : 'Radio', '#8e24aa']];
    if (W.police) tiles.push(['siren', W.siren ? 'Sirene aus' : 'Sirene an', W.siren ? '#c62828' : '#1e5bd8']);
    const tw = tiles.length > 3 ? 120 : 150, gap = tiles.length > 3 ? 18 : 20;
    tiles.forEach(([id, n, c], i) => {
      const k = ease((time - W.appT - i * .08) / .3), x = cx - (tiles.length * (tw + gap) - gap) / 2 + i * (tw + gap), y = 110 + (1 - k) * 20;
      g.globalAlpha = Math.max(0, k) * (W.conn || id === 'radio' || id === 'siren' ? 1 : .35); rr(g, x, y, tw, tw, 30, c);
      if (id === 'tel') icon(g, 'tel', x + tw / 2, y + tw / 2, 1.4); else if (id === 'map') navArrow(g, 'gerade', x + tw / 2, y + tw / 2 + 4, 1.5); else icon(g, id, x + tw / 2, y + tw / 2, 1.5);
      tx(g, n, x + tw / 2, y + tw + 26, tiles.length > 3 ? 14 : 17, '#fff', 'center', 600); g.globalAlpha = 1;
      cbtn(x, y, tw, tw + 40, id === 'siren' ? 'siren' : 'app:' + id);
    });
  } else if (W.app === 'tel') {
    tx(g, 'Telefon', X0 + 20, 36, 24, '#fff', 'left', 700); tx(g, 'Spieler online – antippen zum Anrufen', X0 + 20, 62, 13, '#99a', 'left', 500);
    const list = W.players;
    if (!list.length) { tx(g, 'Gerade ist niemand sonst online.', cx, 200, 19, '#aab'); tx(g, 'Andere Spieler erscheinen hier automatisch.', cx, 230, 14, '#778'); }
    list.slice(0, 8).forEach((p, i) => {
      const col = i % 2, row = Math.floor(i / 2), x = X0 + 10 + col * 306, y = 84 + row * 72;
      const d = p.root ? Math.round(p.root.position.distanceTo(headWorld)) : 0;
      rr(g, x, y, 296, 62, 16, '#1d2027');
      g.beginPath(); g.arc(x + 32, y + 31, 21, 0, 7); g.fillStyle = '#e20074'; g.fill(); tx(g, p.name[0].toUpperCase(), x + 32, y + 32, 19, '#fff', 'center', 700);
      tx(g, p.name, x + 64, y + 24, 19, '#fff', 'left', 700); tx(g, (d > 999 ? (d / 1000).toFixed(1) + ' km' : d + ' m') + ' entfernt', x + 64, y + 45, 12, '#99a', 'left', 500);
      g.beginPath(); g.arc(x + 264, y + 31, 20, 0, 7); g.fillStyle = '#34c759'; g.fill(); icon(g, 'tel', x + 264, y + 31, .5);
      cbtn(x, y, 296, 62, 'call:' + p.id);
    });
  } else if (W.app === 'map') {
    const LW = 220; g.fillStyle = '#101217'; g.fillRect(X0, 0, LW, CH);   // links: große Liste mit Zielen
    tx(g, 'Ziele', X0 + 16, 26, 20, '#fff', 'left', 700);
    Object.keys(POI).forEach((n, i) => {
      const y = 46 + i * 41, on = W.nav.on && W.nav.n === n;
      rr(g, X0 + 8, y, LW - 16, 36, 10, on ? '#2b6cff' : '#1d2027');
      g.beginPath(); g.arc(X0 + 28, y + 18, 7, 0, 7); g.fillStyle = on ? '#fff' : '#e20074'; g.fill();
      tx(g, n, X0 + 44, y + 19, 16, '#fff', 'left', 600);
      cbtn(X0 + 8, y, LW - 16, 36, 'dest:' + n);
    });
    const mx = X0 + LW, sp = W.speed, S = clamp(1.25 - sp * .028, .42, 1.25), pp = W.pos;
    drawRouteMap(g, mx, 0, RX - mx, CH, S, W.heading, pp.x, pp.z, W.nav);   // rechts: Karte mit Route
    if (W.nav.on && W.nav.info) {
      rr(g, mx + 10, 10, RX - mx - 20, 70, 14, 'rgba(10,60,30,.92)');
      navArrow(g, W.nav.info.dir, mx + 48, 45, 1);
      tx(g, fmtShort(W.nav.info.d), mx + 88, 34, 24, '#fff', 'left', 700);
      tx(g, W.nav.info.dir === 'ziel' ? 'Ziel: ' + W.nav.n : W.nav.info.dir === 'wenden' ? 'Wenden' : W.nav.info.dir[0].toUpperCase() + W.nav.info.dir.slice(1) + ' abbiegen', mx + 88, 60, 15, '#cfe', 'left', 600);
      rr(g, RX - 118, CH - 52, 108, 40, 12, '#c0392b'); tx(g, 'Beenden', RX - 64, CH - 32, 15, '#fff', 'center', 700); cbtn(RX - 118, CH - 52, 108, 40, 'navstop');
    } else { rr(g, mx + 10, 10, RX - mx - 20, 44, 12, 'rgba(0,0,0,.6)'); tx(g, 'Ziel links antippen', (mx + RX) / 2, 32, 16, '#fff', 'center', 600); }
  }
  if (!showCall && W.app === 'radio') {                                 // Radio: 4 Sender, Lautstärke, Aus
    tx(g, 'Radio', X0 + 20, 32, 24, '#fff', 'left', 700); tx(g, W.radio >= 0 ? 'Läuft: ' + STATIONS[W.radio].name : 'Aus – Sender antippen', X0 + 20, 58, 13, '#c9b3e6', 'left', 600);
    STATIONS.forEach((s, i) => {
      const x = X0 + 16 + (i % 2) * 300, y = 76 + Math.floor(i / 2) * 104, on = W.radio === i;
      rr(g, x, y, 288, 92, 18, on ? s.col : '#1d2027'); tx(g, s.name, x + 20, y + 32, 20, '#fff', 'left', 800); tx(g, s.bpm + ' BPM', x + 20, y + 60, 13, '#ddd', 'left', 500);
      if (on) for (let b = 0; b < 6; b++) { const h = 8 + Math.abs(Math.sin(time * (4 + b) + b)) * 30; rr(g, x + 205 + b * 12, y + 74 - h, 8, h, 2, '#fff'); }
      cbtn(x, y, 288, 92, 'radio:' + i);
    });
    const yb = 300; rr(g, X0 + 16, yb, 100, 54, 14, '#263238'); tx(g, 'Leiser', X0 + 66, yb + 27, 15, '#fff', 'center', 700); cbtn(X0 + 16, yb, 100, 54, 'vol:-');
    rr(g, X0 + 126, yb + 18, 220, 18, 9, '#263238'); rr(g, X0 + 126, yb + 18, 220 * W.vol, 18, 9, '#ab47bc');
    rr(g, X0 + 356, yb, 100, 54, 14, '#263238'); tx(g, 'Lauter', X0 + 406, yb + 27, 15, '#fff', 'center', 700); cbtn(X0 + 356, yb, 100, 54, 'vol:+');
    rr(g, X0 + 466, yb, 120, 54, 14, W.radio >= 0 ? '#c62828' : '#444'); tx(g, 'Aus', X0 + 526, yb + 27, 16, '#fff', 'center', 700); cbtn(X0 + 466, yb, 120, 54, 'radiooff');
  }
  if (!showCall && W.app === 'tune') {                                  // Tuning-Werkstatt
    tx(g, 'Tuning-Werkstatt', X0 + 20, 32, 24, '#ffc400', 'left', 800);
    tx(g, W.onPad ? 'Antippen = kaufen (sofort am Auto)' : 'Stell das Auto auf die gelbe Fläche der Werkstatt', X0 + 20, 58, 13, W.onPad ? '#ddd' : '#ff8a80', 'left', 600);
    const row = (y, label, list, kind, cur) => {
      tx(g, label + '  ·  ' + TUNE_PRICE[kind] + ' €', X0 + 20, y, 16, '#fff', 'left', 700);
      list.forEach((c, i) => {
        const x = X0 + 48 + i * 72, on = (cur ?? 0) === c;
        g.beginPath(); g.arc(x, y + 42, 25, 0, 7); g.fillStyle = c ? '#' + c.toString(16).padStart(6, '0') : '#222'; g.fill();
        g.lineWidth = on ? 5 : 2; g.strokeStyle = on ? '#ffc400' : '#555'; g.stroke(); if (!c) tx(g, 'Aus', x, y + 42, 12, '#bbb', 'center', 700);
        cbtn(x - 32, y + 10, 64, 64, 'tn:' + kind + ':' + i);
      });
    };
    row(92, 'Lack', PAINTS, 'p', W.tune.p); row(192, 'Felgen', RIMS, 'r', W.tune.r); row(292, 'Neon unterm Auto', NEONS, 'n', W.tune.n || 0);
  }
  // Zapfsäule / Werkstatt: Knopf unten
  if (W.local && !showCall && (W.canFuel || W.filling)) {
    const cost = Math.round((1 - W.fuel) * TANK_L * PRICE_L * 100) / 100;
    rr(g, X0 + 120, CH - 64, 400, 54, 16, W.filling ? '#2e7d32' : '#1565c0');
    tx(g, W.filling ? 'Tankt … ' + Math.round(W.fuel * 100) + ' %' : 'Tanken  ·  ca. ' + cost.toFixed(2).replace('.', ',') + ' €', X0 + 320, CH - 37, 18, '#fff', 'center', 800);
    if (!W.filling) cbtn(X0 + 120, CH - 64, 400, 54, 'fuel');
  } else if (W.local && !showCall && W.onPad && W.app !== 'tune') { rr(g, X0 + 120, CH - 64, 400, 54, 16, '#c79a00'); tx(g, 'Tuning-Werkstatt öffnen', X0 + 320, CH - 37, 18, '#111', 'center', 800); cbtn(X0 + 120, CH - 64, 400, 54, 'app:tune'); }
  // Navigation läuft, aber andere App offen: kleiner Hinweis oben
  if (W.nav.on && W.nav.info && (W.app !== 'map' || showCall)) {
    rr(g, RX - 250, 8, 240, 44, 12, 'rgba(10,60,30,.92)'); navArrow(g, W.nav.info.dir, RX - 222, 30, .55);
    tx(g, fmtShort(W.nav.info.d) + ' · ' + (W.nav.info.dir === 'ziel' ? 'Ziel' : W.nav.info.dir), RX - 196, 31, 16, '#fff', 'left', 700);
  }
  // Anruf im Hintergrund: grüner Punkt unten rechts – antippen öffnet das Gespräch wieder
  if (W.call && W.conn && !showCall) {
    const pulse = 1 + Math.sin(time * 4) * .06;
    g.beginPath(); g.arc(RX - 40, CH - 40, 26 * pulse, 0, 7); g.fillStyle = '#34c759'; g.fill(); icon(g, 'tel', RX - 40, CH - 40, .6);
    if (W.call.state === 'active') { const s = Math.floor(time - W.call.t0); tx(g, Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'), RX - 40, CH - 76, 12, '#8fe3a5', 'center', 700); }
    cbtn(RX - 72, CH - 92, 64, 84, 'callmax');
  }
  // Warnung oben (brennendes Gebäude, NPC-Angriff)
  const A = W.alert;
  if (A && time - A.t < 9) {
    const at = time - A.t, k = Math.min(ease(at / .35), ease((9 - at) / .35)), y = -120 + 128 * k;
    rr(g, X0 + 8, y, RX - X0 - 16, 104, 16, A.col);
    warnIcon(g, X0 + 44, y + 40, 1.2);
    tx(g, A.title, X0 + 80, y + 26, 19, '#fff', 'left', 800);
    g.font = '500 14px system-ui,sans-serif'; wrapText(g, A.text, RX - X0 - 110).slice(0, 3).forEach((l, i) => tx(g, l, X0 + 80, y + 52 + i * 18, 14, '#fde', 'left', 500));
  }
  // "Telefon – Auto verbunden" Banner (gleitet von oben rein)
  const bt = time - W.banner;
  if (bt < 3.5) {
    const k = Math.min(ease(bt / .35), ease((3.5 - bt) / .35)), y = -70 + 82 * k;
    rr(g, cx - 210, y, 420, 62, 18, 'rgba(32,35,44,.97)');
    g.beginPath(); g.arc(cx - 178, y + 31, 20, 0, 7); g.fillStyle = '#34c759'; g.fill(); icon(g, 'tel', cx - 178, y + 31, .5);
    tx(g, 'Telefon – Auto verbunden', cx - 148, y + 23, 18, '#fff', 'left', 700);
    tx(g, 'Handy von ' + W.name + ' · ' + W.veh, cx - 148, y + 44, 13, '#aab', 'left', 500);
  }
  if (W.ripple && time - W.ripple.t < .35) { const k = (time - W.ripple.t) / .35; g.beginPath(); g.arc(W.ripple.x, W.ripple.y, 12 + k * 46, 0, 7); g.fillStyle = `rgba(255,255,255,${.3 * (1 - k)})`; g.fill(); }
}

// ---------- zweites Display (hinter dem Lenkrad): Intro "Willkommen", dann Menü | Mini-Karte | Tacho ----------
const KW = 768, KH = 256;
const [kCan, kg] = C(KW, KH);
const kTex = new THREE.CanvasTexture(kCan); kTex.colorSpace = THREE.SRGBColorSpace; kTex.anisotropy = 4;
const kMat = new THREE.MeshBasicMaterial({ map: kTex, toneMapped: false });
const cl = { on: false, mesh: null, t0: 0, drawT: 0, said: false, popup: null, ringSaid: -1, spark: [] };
function updCluster(dt) {
  const want = player.inCar && !!pcar.cluster && vehicle.type !== 'scooter' && !pcar.dead;
  if (cl.on && (!want || cl.mesh !== pcar.cluster)) { if (cl.mesh === pcar.cluster) cl.mesh.material = pcar.clusterOrig; cl.on = false; cl.mesh = null; }
  if (!cl.on && want) {
    Object.assign(cl, { on: true, mesh: pcar.cluster, t0: time, drawT: 0, said: false, spark: [] });
    fitTex(kTex, pcar.clusterUV); cl.mesh.material = kMat;
    playAt(SND.welcome, cl.mesh.getWorldPosition(V()), 1.1, 3);       // Willkommens-Gong
  }
  if (!cl.on) return;
  if (!cl.said && time - cl.t0 > 1.4) { cl.said = true; const np = nameParts(net.name); playVoice(['willkommen', ...(np || [])]); if (!np) setTimeout(() => say(net.name), 1100); }
  if (phone.call?.state === 'ring' && cl.ringSaid !== phone.call.t0) { cl.ringSaid = phone.call.t0; const np = nameParts(phone.call.name); playVoice(np ? [...np, 'ruft_an'] : 'anruf'); }
  cl.drawT -= dt;
  if (cl.drawT <= 0) { drawCluster(); kTex.needsUpdate = true; cl.drawT = time - cl.t0 < 4.2 || (cl.popup && time - cl.popup.t < 4) ? 1 / 30 : 1 / 10; }
}
function drawIntro(g, t) {
  // fließender Farbverlauf + Lichtkranz
  const hue = (t * 60) % 360, gr = g.createLinearGradient(0, 0, KW, KH);
  gr.addColorStop(0, `hsl(${215 + Math.sin(t * 1.3) * 20},80%,12%)`); gr.addColorStop(.5, `hsl(${(hue + 280) % 360},70%,22%)`); gr.addColorStop(1, `hsl(${190 + Math.sin(t) * 25},85%,14%)`);
  g.fillStyle = gr; g.fillRect(0, 0, KW, KH);
  const rg = g.createRadialGradient(KW / 2, KH / 2, 10, KW / 2, KH / 2, 260 + Math.sin(t * 3) * 20);
  rg.addColorStop(0, `rgba(120,200,255,${.45 * Math.min(1, t)})`); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(0, 0, KW, KH);
  // Funken, die nach außen fliegen
  if (cl.spark.length < 70 && t < 3) for (let i = 0; i < 3; i++) { const a = rand(0, 7); cl.spark.push({ x: KW / 2, y: KH / 2, vx: Math.cos(a) * rand(60, 260), vy: Math.sin(a) * rand(30, 120), h: rand(160, 330), l: 1 }); }
  for (const s of cl.spark) { s.x += s.vx / 30; s.y += s.vy / 30; s.l -= 1 / 45; if (s.l > 0) { g.fillStyle = `hsla(${s.h},100%,70%,${s.l})`; g.fillRect(s.x, s.y, 3, 3); } }
  cl.spark = cl.spark.filter(s => s.l > 0);
  // "Willkommen" + Name: dreht sich in 3D herein, mit Tiefe (Schichten) und Glanz
  const k = ease(t / .9), ang = (1 - k) * 1.3, sx = Math.max(.05, Math.cos(ang)), pop = 1 + Math.sin(Math.min(1, t / 1.1) * Math.PI) * .08;
  g.save(); g.translate(KW / 2, KH / 2 + 8); g.transform(sx * pop, Math.sin(ang) * .25, 0, pop, 0, 0);
  g.globalAlpha = Math.min(1, t * 2); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 26px system-ui,sans-serif'; g.fillStyle = 'rgba(220,235,255,.9)'; g.fillText('Willkommen', 0, -52);
  g.font = '900 64px system-ui,sans-serif';
  for (let d = 9; d > 0; d--) { g.fillStyle = `hsl(${(hue + d * 12) % 360},80%,${18 + d * 3}%)`; g.fillText(net.name, d * 1.2, d * 1.6); }   // 3D-Tiefe
  const tg = g.createLinearGradient(0, -34, 0, 34); tg.addColorStop(0, '#ffffff'); tg.addColorStop(.5, `hsl(${(hue + 40) % 360},100%,75%)`); tg.addColorStop(1, `hsl(${(hue + 200) % 360},100%,62%)`);
  g.shadowColor = `hsl(${(hue + 40) % 360},100%,60%)`; g.shadowBlur = 24; g.fillStyle = tg; g.fillText(net.name, 0, 0); g.shadowBlur = 0;
  // Glanzstreifen läuft über den Namen
  const sw = ((t - .6) / 1.4) * 700 - 350; const sg2 = g.createLinearGradient(sw - 40, 0, sw + 40, 0);
  sg2.addColorStop(0, 'rgba(255,255,255,0)'); sg2.addColorStop(.5, 'rgba(255,255,255,.55)'); sg2.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = sg2; g.fillRect(-380, -45, 760, 90); g.globalCompositeOperation = 'source-over';
  g.font = '600 15px system-ui,sans-serif'; g.fillStyle = 'rgba(200,220,255,.8)'; g.fillText(vehicle.name, 0, 58);
  g.restore(); g.globalAlpha = 1;
}
function drawCluster() {
  const g = kg, t = time - cl.t0; g.textBaseline = 'middle';
  g.fillStyle = '#04060a'; g.fillRect(0, 0, KW, KH);
  if (t < 4.2) { if (t > 3.4) drawClusterMain(g); g.globalAlpha = t > 3.4 ? 1 - (t - 3.4) / .8 : 1; drawIntro(g, t); g.globalAlpha = 1; return; }
  drawClusterMain(g);
}
function drawClusterMain(g, W = localCarView()) {
  // links: kleines Menü
  tx(g, hhmm(), 18, 22, 18, '#fff', 'left', 700);
  const act = W.call ? 1 : W.nav.on ? 0 : 3;
  [['Navigation', 'gps'], ['Telefon', 'tel'], ['Medien', 'play'], ['Fahrzeug', 'garage']].forEach(([n, ic], i) => {
    const y = 58 + i * 38, on = i === act;
    if (on) rr(g, 8, y - 16, 150, 32, 10, '#2b6cff');
    icon(g, ic, 26, y, .4); tx(g, n, 44, y + 1, 14, on ? '#fff' : '#9aa3b2', 'left', on ? 700 : 500);
  });
  lockIcon(g, 24, 226, W.locked, .45); tx(g, W.locked ? 'Türen zu' : 'Türen offen', 40, 228, 12, W.locked ? '#ff9a9a' : '#8fe3a5', 'left', 700);
  // Mitte: Mini-Karte
  const sp = W.speed, pp = W.pos;
  drawRouteMap(g, 170, 6, 350, KH - 12, clamp(1.1 - sp * .025, .4, 1.1), W.heading, pp.x, pp.z, W.nav);
  g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 2; g.strokeRect(170, 6, 350, KH - 12);
  if (W.nav.on && W.nav.info) { rr(g, 178, 12, 190, 40, 10, 'rgba(10,60,30,.92)'); navArrow(g, W.nav.info.dir, 198, 32, .5); tx(g, fmtShort(W.nav.info.d), 220, 32, 17, '#fff', 'left', 700); }
  // rechts: Tacho
  const kmh = sp * 3.6, cx = 644, cy = 134, R0 = 92, a0 = Math.PI * .75, a1 = Math.PI * 2.25, va = a0 + (a1 - a0) * clamp(kmh / 240, 0, 1);
  g.lineCap = 'round'; g.lineWidth = 10; g.strokeStyle = '#1d2230'; g.beginPath(); g.arc(cx, cy, R0, a0, a1); g.stroke();
  const ag = g.createLinearGradient(cx - R0, 0, cx + R0, 0); ag.addColorStop(0, '#2b9bff'); ag.addColorStop(.6, '#7a5cff'); ag.addColorStop(1, '#ff3b5c');
  g.strokeStyle = ag; g.beginPath(); g.arc(cx, cy, R0, a0, va); g.stroke();
  for (let v = 0; v <= 240; v += 20) { const a = a0 + (a1 - a0) * v / 240, big = v % 40 === 0; g.lineWidth = big ? 3 : 1.5; g.strokeStyle = '#8b93a6'; g.beginPath(); g.moveTo(cx + Math.cos(a) * (R0 - 16), cy + Math.sin(a) * (R0 - 16)); g.lineTo(cx + Math.cos(a) * (R0 - (big ? 26 : 21)), cy + Math.sin(a) * (R0 - (big ? 26 : 21))); g.stroke(); if (big) tx(g, String(v), cx + Math.cos(a) * (R0 - 40), cy + Math.sin(a) * (R0 - 40), 11, '#8b93a6', 'center', 600); }
  g.strokeStyle = '#ff4d4d'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(va) * (R0 - 12), cy + Math.sin(va) * (R0 - 12)); g.stroke();
  tx(g, String(Math.round(kmh)), cx, cy + 18, 38, '#fff', 'center', 800); tx(g, 'km/h', cx, cy + 46, 12, '#9aa3b2', 'center', 600);
  tx(g, 'D', cx, cy - 30, 16, '#7fdc8f', 'center', 800);
  // Tankanzeige + Radiosender
  const fu = clamp(W.fuel ?? 1, 0, 1), low = fu < .15 && Math.floor(time * 2) % 2;
  tx(g, 'Tank', 556, 240, 11, low ? '#ff5252' : '#9aa3b2', 'left', 700); rr(g, 590, 234, 140, 11, 5, '#1d2230'); rr(g, 590, 234, Math.max(4, 140 * fu), 11, 5, fu < .15 ? '#ff5252' : fu < .3 ? '#ffb300' : '#7fdc8f');
  if ((W.radio ?? -1) >= 0) tx(g, 'Radio: ' + STATIONS[W.radio].name, 176, 238, 12, '#d1b3ff', 'left', 600);
  // unten links: Anruf
  const c = W.call;
  if (c && c.state !== 'offline') {
    const ringing = c.state === 'ring', p = 1 + (ringing ? Math.sin(time * 8) * .08 : 0);
    rr(g, 8, 176, 300, 70, 14, 'rgba(18,40,24,.96)');
    g.beginPath(); g.arc(42, 211, 20 * p, 0, 7); g.fillStyle = '#34c759'; g.fill(); icon(g, 'tel', 42, 211, .5);
    tx(g, c.name + (ringing ? ' ruft an…' : ''), 72, 202, 17, '#fff', 'left', 700);
    let st = ringing ? 'Annehmen am Hauptdisplay' : c.state === 'dial' ? 'Wählt…' : '';
    if (c.state === 'active') { const s = Math.floor(time - c.t0); st = 'Im Gespräch · ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
    tx(g, st, 72, 225, 12, '#9fd8ae', 'left', 600);
  }
  // Mitte: kurzes Popup (brennendes Gebäude …)
  const P = cl.popup;
  if (P && time - P.t < 4) {
    const k = Math.min(ease((time - P.t) / .25), ease((4 - (time - P.t)) / .3));
    g.globalAlpha = k; rr(g, KW / 2 - 175, 72, 350, 100, 18, P.col || '#b3261e'); warnIcon(g, KW / 2 - 130, 122, 1.3);
    tx(g, P.text, KW / 2 + 20, 122, 24, '#fff', 'center', 800); g.globalAlpha = 1;
  }
}

// ---------- Warnungen: brennendes Gebäude, NPC-Angriff ----------
let lastFireAlert = -99;
function carAlert(title, text, col, short) {
  if (cp.on) { cp.alert = { t: time, title, text, col }; cp.drawT = 0; playAt(SND.warn, cp.mesh.getWorldPosition(V()), 1, 3); }
  else { phone.notif = { title, text, t0: time, until: time + 5 }; phone.drawT = 0; }
  if (cl.on) { cl.popup = { t: time, text: short, col }; cl.drawT = 0; }
}
function fireAlert(why) {
  if (time - lastFireAlert < 300 || time < 5) return; lastFireAlert = time;   // höchstens alle 5 Minuten eine Warnung
  carAlert('Gebäude brennt nach ' + why + '.', 'Wenn du ein brennendes Gebäude siehst, bitte halte dich fern, um Verletzungen zu vermeiden.', '#b3261e', 'Brennendes Gebäude');
}

// ---------- Mitfahrer: im Auto eines anderen zeigen Hauptdisplay + Mini-Display dasselbe wie beim Fahrer ----------
const [rCan, rCg] = C(CW, CH), rTex = new THREE.CanvasTexture(rCan); rTex.colorSpace = THREE.SRGBColorSpace; rTex.anisotropy = 4;
const rMat = new THREE.MeshBasicMaterial({ map: rTex, toneMapped: false });
const [rkCan, rKg] = C(KW, KH), rkTex = new THREE.CanvasTexture(rkCan); rkTex.colorSpace = THREE.SRGBColorSpace; rkTex.anisotropy = 4;
const rkMat = new THREE.MeshBasicMaterial({ map: rkTex, toneMapped: false });
const rideNav = { on: false, n: '', p: null, route: null, end: null, k: 1, info: null, offT: 0 };
const rideScr = { p: null, mesh: null, main: null, clus: null, mainOrig: null, clusOrig: null, drawT: 0, navT: 0 };
// Route des Fahrers nachbilden (gleiches Ziel), Fortschritt + nächste Abbiegung – ohne Ansagen
function rideNavStep(p) {
  const n = p.st?.cp?.n || '', pos = p.carMesh.position;
  if (n !== rideNav.n) {
    rideNav.n = n; rideNav.on = !!n && !!POI[n];
    if (rideNav.on) { rideNav.p = POI[n]; rideNav.route = findRoute(pos.x, pos.z, rideNav.p[0], rideNav.p[1]); rideNav.end = rideNav.route[rideNav.route.length - 1]; rideNav.k = 1; rideNav.offT = 0; }
    else { rideNav.route = null; rideNav.info = null; }
  }
  if (!rideNav.on || !rideNav.route) return;
  const r = rideNav.route;
  while (rideNav.k < r.length - 1) {
    const A = r[rideNav.k], B = r[rideNav.k + 1], dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1;
    if (((pos.x - A.x) * dx + (pos.z - A.z) * dz) / L > 7 || Math.hypot(pos.x - A.x, pos.z - A.z) < 9) rideNav.k++; else break;
  }
  const A = r[rideNav.k - 1], B = r[rideNav.k], dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz || 1;
  const t = clamp(((pos.x - A.x) * dx + (pos.z - A.z) * dz) / L2, 0, 1), off = Math.hypot(pos.x - A.x - dx * t, pos.z - A.z - dz * t);
  rideNav.offT = off > 35 ? rideNav.offT + .3 : 0;
  if (rideNav.offT > 1.6) { rideNav.n = ''; return; }                    // neu berechnen (nächster Schritt)
  const distTo = i => { let d = Math.hypot(r[rideNav.k].x - pos.x, r[rideNav.k].z - pos.z); for (let j = rideNav.k; j < i; j++) d += Math.hypot(r[j + 1].x - r[j].x, r[j + 1].z - r[j].z); return d; };
  let m = -1; for (let i = rideNav.k; i < r.length - 1; i++) if (r[i].turn) { m = i; break; }
  rideNav.info = m >= 0 ? { dir: r[m].turn, d: distTo(m) } : { dir: 'ziel', d: distTo(r.length - 1) };
}
function rideView(p) {
  const s = p.st, q = s.cp || {}, c = s.c;
  return { btns: [], conn: !!q.k, app: q.a || 'home', call: q.c ? { name: q.c[0], state: q.c[1], t0: time - q.c[2] } : null, callMin: !!q.m, locked: s.lk !== 0, appT: -9,
    name: p.name, veh: NICE_NAMES[p.carType] || p.carType, players: [...net.players.values()].filter(o => o !== p), nav: rideNav,
    speed: c ? Math.hypot(c[10] || 0, c[11] || 0) : 0, pos: p.carMesh.position, heading: p.cyaw || 0, alert: null, banner: -9, ripple: null,
    radio: q.r ?? -1, vol: .6, fuel: s.fu ?? 1, canFuel: false, filling: false, onPad: false, police: !!s.sir, siren: !!s.sir, tune: {}, local: false };
}
function rideScreensOff() {
  if (rideScr.main && rideScr.main.material === rMat) rideScr.main.material = rideScr.mainOrig;
  if (rideScr.clus && rideScr.clus.material === rkMat) rideScr.clus.material = rideScr.clusOrig;
  Object.assign(rideScr, { p: null, mesh: null, main: null, clus: null }); rideNav.on = false; rideNav.n = ''; rideNav.route = null; rideNav.info = null;
}
function updRideScreens(dt) {
  const p = player.ride ? net.players.get(player.ride.id) : null;
  if (!p || !p.carMesh?.visible || p.carType === 'scooter') { if (rideScr.p) rideScreensOff(); return; }
  if (rideScr.p !== p || rideScr.mesh !== p.carMesh) {
    rideScreensOff(); rideScr.p = p; rideScr.mesh = p.carMesh; rideScr.drawT = 0;
    const full = p.carMesh.isLOD ? p.carMesh.levels[0].object : p.carMesh;
    full.traverse(o => { if (o.isMesh && o.userData.main) rideScr.main = o; if (o.isMesh && o.userData.cluster) rideScr.clus = o; });
    if (rideScr.main) { rideScr.mainOrig = p.cmScreens.find(x => x.m === rideScr.main)?.orig || rideScr.main.material; fitTex(rTex, rideScr.main.userData.uvb); }
    if (rideScr.clus) { rideScr.clusOrig = p.cmScreens.find(x => x.m === rideScr.clus)?.orig || rideScr.clus.material; fitTex(rkTex, rideScr.clus.userData.uvb); }
  }
  if (p.alarmOn) return;                                                // Alarm hat Vorrang ("!")
  if (rideScr.main && rideScr.main.material !== rMat) rideScr.main.material = rMat;
  if (rideScr.clus && rideScr.clus.material !== rkMat) rideScr.clus.material = rkMat;
  rideScr.navT -= dt; if (rideScr.navT <= 0) { rideScr.navT = .3; rideNavStep(p); }
  rideScr.drawT -= dt;
  if (rideScr.drawT <= 0) {
    const W = rideView(p); rideScr.drawT = W.app === 'map' ? 1 / 10 : 1 / 5;
    if (rideScr.main) { drawCarView(rCg, W); rTex.needsUpdate = true; }
    if (rideScr.clus) { rKg.textBaseline = 'middle'; rKg.fillStyle = '#04060a'; rKg.fillRect(0, 0, KW, KH); drawClusterMain(rKg, W); rkTex.needsUpdate = true; }
  }
}

// ---------- Freiton beim Anrufen (Deutschland: 425 Hz, 1 s an, 4 s aus) ----------
let dialTone = null;
function updDialTone() {
  const on = phone.call?.state === 'dial' && AC.state === 'running';
  if (on && !dialTone) { const o = AC.createOscillator(), gn = AC.createGain(); o.frequency.value = 425; gn.gain.value = 0; o.connect(gn); gn.connect(AC.destination); o.start(); dialTone = { o, gn, t0: time }; }
  if (!on && dialTone) { const d = dialTone; dialTone = null; d.gn.gain.setTargetAtTime(0, AC.currentTime, .02); setTimeout(() => { try { d.o.stop(); d.o.disconnect(); d.gn.disconnect(); } catch (e) { } }, 250); }
  if (dialTone) dialTone.gn.gain.setTargetAtTime((time - dialTone.t0) % 5 < 1 ? .08 : 0, AC.currentTime, .012);
}

// ---------- Im Anruf hört der andere auch, was um dich herum los ist (Motor, Regen, Leute …) ----------
const amb = { dest: null, mic: null, gain: null };
function callAmbience(id, on) {
  const p = net.players.get(id); if (!p?.pc || !net.mic || AC.state !== 'running') return;
  const tr = p.pc.getTransceivers()[0]; if (!tr) return;
  if (on && !amb.dest) {
    amb.dest = AC.createMediaStreamDestination();
    amb.mic = AC.createMediaStreamSource(net.mic); amb.micGain = AC.createGain(); amb.mic.connect(amb.micGain); amb.micGain.connect(amb.dest);
    amb.gain = AC.createGain(); amb.gain.gain.value = .7; listener.getInput().connect(amb.gain); amb.gain.connect(amb.dest);
    amb.phoneGain = AC.createGain(); amb.phoneGain.gain.value = 0; phoneBusNode().connect(amb.phoneGain); amb.phoneGain.connect(amb.dest);   // Geräusche am Handy (wenn du weg bist)
  }
  tr.sender.replaceTrack(on ? amb.dest.stream.getAudioTracks()[0] : net.mic.getAudioTracks()[0]).catch(() => { });
  // die Stimme des Gesprächspartners nicht mitschicken (sonst hört er sich selbst als Echo)
  if (p.pa) { try { p.pa.gain.disconnect(); p.pa.gain.connect(on ? AC.destination : listener.getInput()); } catch (e) { } }
}

// ---------- Türschloss + Alarm: steigt jemand in dein Auto, während du weg bist ----------
const alarm = { on: false, acked: false, t: 0, drawT: 0 };
const [alCan, alg] = C(256, 128);
const alTex = new THREE.CanvasTexture(alCan); alTex.colorSpace = THREE.SRGBColorSpace;
const alMat = new THREE.MeshBasicMaterial({ map: alTex, toneMapped: false });
function drawAlarmScreen() {
  alarm.drawT -= 1 / 60; if (alarm.drawT > 0) return; alarm.drawT = .12;
  const on = Math.floor(time * 2.5) % 2 === 0; alg.fillStyle = on ? '#5a0000' : '#0a0000'; alg.fillRect(0, 0, 256, 128);
  if (on) { alg.beginPath(); alg.moveTo(128, 14); alg.lineTo(192, 112); alg.lineTo(64, 112); alg.closePath(); alg.fillStyle = '#ff2a2a'; alg.fill(); alg.fillStyle = '#fff'; alg.fillRect(122, 44, 12, 40); alg.fillRect(122, 92, 12, 12); }
  alTex.needsUpdate = true;
}
// Scheinwerfer + Blinker eines Autos an/aus (für den Alarm)
const lightOrig = new WeakMap();
function carLights(root, on) {
  let L = lightOrig.get(root);
  if (!L) {
    L = []; const seen = new Set();
    root.traverse(o => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (!m.emissive || seen.has(m)) continue; const n = m.name || ''; const kind = /orange/i.test(n) ? 'ind' : /glow_1|glow_2|glass_light/i.test(n) ? 'head' : null; if (!kind) continue; seen.add(m); L.push({ m, kind, e: m.emissive.clone(), i: m.emissiveIntensity, op: m.opacity }); } });
    lightOrig.set(root, L);
  }
  for (const l of L) {
    if (on) { l.m.emissive.set(l.kind === 'ind' ? 0xff8a00 : 0xffffff); l.m.emissiveIntensity = l.kind === 'ind' ? 6 : 4; if (l.m.transparent) l.m.opacity = Math.max(l.op, .85); }
    else { l.m.emissive.copy(l.e); l.m.emissiveIntensity = l.i; l.m.opacity = l.op; }
  }
}
function setAlarmScreens(c, on) { if (c.screen) c.screen.material = on ? alMat : c.screenOrig; if (c.cluster) c.cluster.material = on ? alMat : c.clusterOrig; }
function updAlarm(dt) {
  const riders = [...net.players.values()].filter(p => p.st?.rd?.[0] === net.id);
  const near = player.inCar || headWorld.distanceTo(pcar.group.position) < 4.5;   // Besitzer ist wieder da
  if (!riders.length) alarm.acked = false; else if (near) alarm.acked = true;
  const on = riders.length > 0 && !near && !alarm.acked && !pcar.dead && vehicle.type !== 'scooter';
  if (on !== alarm.on) {
    alarm.on = on;
    if (on) { setAlarmScreens(pcar, true); msg('ALARM: ' + riders[0].name + ' ist in dein Auto eingestiegen!', 5); phone.notif = { title: 'Auto-Alarm', text: riders[0].name + ' sitzt in deinem Auto', t0: time, until: time + 5 }; phone.drawT = 0; }
    else { setAlarmScreens(pcar, false); carLights(pcar.vis, false); }
  }
  if (on) {
    drawAlarmScreen(); carLights(pcar.vis, Math.floor(time * 2.5) % 2 === 0);
    alarm.t -= dt; if (alarm.t <= 0) { alarm.t = .9; playAt(SND.beep, pcar.group.position, 2.2, 14); }
  }
}

// ===================================================================
// Auto: Einsteigen, Fahren, Aussteigen
// ===================================================================
function enterCar() {
  player.inCar = true; player.calib.copy(camera.position);
  // Höhe nicht vom Moment des Einsteigens nehmen (da bückt man sich zum Türgriff),
  // sondern deine normale aufrechte Kopfhöhe -> kein Kopf durchs Dach, kein Ducken
  if (xrOn() && player.stand) player.calib.y = Math.max(camera.position.y, player.stand);
  player.recalT = xrOn() ? time + 1.5 : 0;   // nach dem Hinsetzen Sitz automatisch auf deine entspannte Position einstellen
  if (!xrOn()) { desk.yaw = 0; desk.pitch = -.1; }
  for (const d of pcar.doors) if (d.grab) { d.grab.held = null; d.grab = null; }
  ensureEngine();
  msg(vehicle.type === 'scooter' ? 'R-Trigger Gas · L-Trigger Bremse · linker Stick lenken · B absteigen' : 'Lenkrad greifen · R-Trigger Gas · L-Trigger Bremse · B Aussteigen', 5);
}
function exitCar() {
  player.inCar = false; if (pcar.doors[0]) pcar.doors[0].a = 1;
  for (const h of hands) if (h.held?.type === 'wheel') h.held = null;
  // Handy am Magneten bleibt im Auto (nimmt auch weiter auf, wenn es gerade filmt)
  if (phone.where === 'holder') msg('Dein Handy bleibt am Magneten im Auto', 2.5);
  pcar.group.localToWorld(v2.copy(pcar.exitPos));
  placeHeadAt(v2.x, v2.z);
}
const nearSeat = () => headWorld.distanceTo(pcar.group.localToWorld(v1.copy(pcar.seatHint))) < (vehicle.type === 'scooter' ? 1.3 : 1.4);
const canEnter = () => !seated() && !pcar.dead && nearSeat() && (vehicle.type === 'scooter' || (pcar.doors[0]?.a ?? 1) > .35);
const seated = () => player.inCar || !!player.ride;   // im eigenen Auto oder als Mitfahrer
const desk = { tool: null, keys: {}, mouse: false, yaw: Math.PI / 2, pitch: 0, swing: 0 };

// Feder-Dämpfer (Stoßdämpfer): schwingt gedämpft zum Zielwert
const spring = (s, key, target, dt, K = 140, D = 13) => { s[key + 'v'] = (s[key + 'v'] || 0) + ((target - (s[key] || 0)) * K - (s[key + 'v'] || 0) * D) * dt; s[key] = (s[key] || 0) + s[key + 'v'] * dt; return s[key]; };
function updPlayerCar(dt) {
  const c = pcar, g = c.group, sc = vehicle.type === 'scooter', ch = c.chassis || c.vis;
  // Türen: am echten Griff aufziehen; beim Ein-/Aussteigen von Mitfahrern kurz auf und zu; beim Fahren fallen sie zu
  if (!sc) for (const d of c.doors) {
    if (d.grab) {
      const l = ch.worldToLocal(d.grab.ctrl.getWorldPosition(v1)), pv = d.pivot.position;
      d.a = clamp(Math.atan2(d.side * (l.x - pv.x), -(l.z - pv.z)) - d.a0, 0, d.max);
    } else if (d.pulse > 0) { d.pulse -= dt; d.a += ((d.pulse > .7 ? .9 : 0) - d.a) * Math.min(1, dt * 5); }
    else if ((player.inCar && d === c.doors[0]) || Math.abs(c.speed) > 1.5) d.a = Math.max(0, d.a - dt * 2);
    d.pivot.rotation.y = -d.side * d.a;
    doorSound(d, d.a, d.handle, dt, s => slamCar(c.sus || (c.sus = {}), d.side, s));   // Tür auf: Klacken, zu: dumpfer Schlag + Auto wippt
  }
  if (!sc) updWindows(dt);
  let thr = 0, brk = 0, stx = 0;
  if (player.inCar && !c.dead) {
    const L = handBy('left'), Rh = handBy('right');
    if (xrOn()) {
      if (!(Rh?.held?.type === 'tool') && !laser.visible) thr = Rh?.gp?.buttons[0]?.value || 0;
      if (!(L?.held?.type === 'tool')) brk = L?.gp?.buttons[0]?.value || 0;
      if (sc) { stx = L?.gp?.axes[2] || 0; if (Math.abs(stx) < .12) stx = 0; }
      else {
        let sum = 0, n = 0;
        for (const h of hands) if (h.held?.type === 'wheel') {
          const l = c.wheelBase.worldToLocal(h.ctrl.getWorldPosition(v1)); const a = Math.atan2(l.y, l.x);
          sum += wrapA(a - h.held.last); h.held.last = a; n++;
        }
        if (n) c.spin = clamp(c.spin + sum / n, -4.7, 4.7); else c.spin *= 1 - Math.min(1, dt * 2.5);
      }
    } else {
      thr = desk.keys.KeyW ? 1 : 0; brk = desk.keys.KeyS ? 1 : 0;
      const st = (desk.keys.KeyA ? 1 : 0) - (desk.keys.KeyD ? 1 : 0);
      if (sc) stx = -st;
      else c.spin = st ? clamp(c.spin - st * dt * 6, -4.7, 4.7) : c.spin * (1 - Math.min(1, dt * 4));
    }
  }
  // Lenkrad dreht in die gleiche Richtung wie deine Hände
  if (!sc) { c.wheelSpin.rotation.z = c.spin; if (c.brakeMat) c.brakeMat.emissiveIntensity = c.dmg?.tl ? 0 : brk > .05 ? 4 : .5; }
  if (c.fly) { carFlight(c, dt); return; }                              // vom EF5-Tornado erfasst
  const inAir = !!c.air;
  if (inAir) { thr = 0; brk = 0; }   // in der Luft greifen die Räder nicht
  if (!sc && save.fuel <= 0) { if (thr > .05 && time > (c.fuelMsgT || 0)) { c.fuelMsgT = time + 4; msg('Tank leer! Handy → Garage → Reparieren/holen bringt Benzin (50 €)', 3); } thr = 0; }   // Tank leer
  if (!sc && c.totaled) {                                                // Totalschaden: Motor springt nicht an, qualmt
    if (thr > .05 && time > (c.fuelMsgT || 0)) { c.fuelMsgT = time + 4; msg('Totalschaden! Handy → Garage → Reparieren/holen', 3); } thr = 0;
    if (Math.random() < dt * 6) { const f = g.localToWorld(V(0, 1, 1.6)); smoke.spawn(f.x, f.y, f.z, rand(-.4, .4), rand(1.5, 3), rand(-.4, .4), rand(3, 5)); }
  }
  const maxV = sc ? 7 : 62, acc = sc ? 3.2 : 7.5;
  if (thr > .05) c.speed += (c.speed < 0 ? 14 : acc) * thr * dt;
  if (brk > .05) c.speed -= (c.speed > .5 ? (sc ? 6 : 14) : 4) * brk * dt;
  if (thr <= .05 && brk <= .05 && !inAir) c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), (sc ? .8 : 1.2) * dt);
  c.speed -= c.speed * Math.abs(c.speed) * .00035 * dt;
  c.speed = clamp(c.speed, sc ? -1.5 : -9, maxV);
  let yawRate, steer = 0;
  if (sc) yawRate = -stx * 1.7 * clamp(Math.abs(c.speed) / 2.5, 0, 1) * (c.speed < 0 ? -1 : 1);
  else { c.steerS = (c.steerS || 0) + (-(c.spin / 4.7) * .6 - (c.steerS || 0)) * Math.min(1, dt * 10); steer = c.steerS; yawRate = c.speed / 2.8 * Math.tan(steer); }   // Lenkung geglättet (Hand-Zittern filtern)
  if (inAir) yawRate = 0;            // in der Luft lenkt man nicht
  c.yawRate = yawRate; c.heading += yawRate * dt;
  g.position.x += Math.sin(c.heading) * c.speed * dt; g.position.z += Math.cos(c.heading) * c.speed * dt;
  // Gelände: Höhe, Neigung nach vorne/hinten und zur Seite
  const sh = Math.sin(c.heading), chd = Math.cos(c.heading), wb = sc ? .4 : 1.4, tw = sc ? .12 : .85, x = g.position.x, z = g.position.z;
  const hf = surfaceAt(x + sh * wb, z + chd * wb), hb = surfaceAt(x - sh * wb, z - chd * wb), hl = surfaceAt(x + chd * tw, z - sh * tw), hr = surfaceAt(x - chd * tw, z + sh * tw);
  const gy = (hf + hb + hl + hr) / 4, slope = Math.atan2(hf - hb, 2 * wb), side = Math.atan2(hl - hr, 2 * tw);
  // Höhe mit echter Schwerkraft: an Kuppen hebt das Auto bei Tempo ab, fliegt im Bogen und landet hart
  const D = Math.max(dt, .001);
  c.gyF = (c.gyF ?? gy) + (gy - (c.gyF ?? gy)) * Math.min(1, dt * 25);             // leicht geglättet (Geländekanten)
  const gvy = (c.gyF - (c.pgy ?? c.gyF)) / D, gacc = (gvy - (c.pgvy ?? gvy)) / D;   // Steig-Tempo und -Beschleunigung des Bodens
  c.pgy = c.gyF; c.pgvy = gvy;
  const sm = Math.min(1, dt * 6);
  if (!c.air) {
    c.speed -= 9.8 * Math.sin(slope) * dt * .85;              // bergauf langsamer, bergab schneller
    c.slS = (c.slS ?? slope) + (slope - (c.slS ?? slope)) * sm; c.sdS = (c.sdS ?? side) + (side - (c.sdS ?? side)) * sm;
    // Boden fällt schneller weg als die Schwerkraft das Auto runterziehen kann -> abheben
    if (!sc && Math.abs(c.speed) > 9 && gacc < -13) { c.air = true; c.vy = c.lastGvy ?? 0; c.airT = 0; }
    else { g.position.y = gy; c.vy = gvy; }
    c.lastGvy = gvy;
  }
  if (c.air) {
    c.airT += dt; c.vy -= 9.8 * dt; g.position.y += c.vy * dt;
    c.slS += (Math.atan2(c.vy, Math.max(6, Math.abs(c.speed))) - c.slS) * Math.min(1, dt * 1.6);   // Nase folgt der Flugbahn
    c.sdS *= 1 - Math.min(1, dt * 2);
    if (g.position.y <= gy) {                                 // Landung
      const impact = Math.max(0, gvy - c.vy);
      g.position.y = gy; c.air = false; c.vy = gvy;
      if (impact > 2.5) { crash(impact * 1.8, null); const S = c.sus || (c.sus = {}); S.hv = (S.hv || 0) - impact * .05; }
      if (impact > 12) carDamage(c, impact + 6, g.localToWorld(V(0, 0, 3)));   // sehr harte Landung (z.B. aus dem Tornado): Front eingedrückt
      dashKick(Math.min(1.6, impact * .09));                       // Landung: Dashcam nickt kräftig nach
    }
  }
  c.lean = sc ? (c.lean || 0) + ((-stx * .3 * clamp(c.speed / 4, 0, 1)) - (c.lean || 0)) * Math.min(1, dt * 5) : 0;
  g.rotation.set(-c.slS, c.heading, sc ? c.lean : c.sdS, 'YXZ');
  g.updateMatrixWorld(true);
  // Stoßdämpfer: Karosserie taucht beim Bremsen ein, hebt beim Gasgeben die Nase, neigt sich in Kurven
  // und schwingt nach. Jedes Rad federt einzeln über Unebenheiten.
  // Die Kamera hängt NICHT an der Karosserie -> von innen nur dezent, dein Bild wackelt nicht.
  if (!sc && ch !== c.vis) {
    const S = c.sus || (c.sus = {}), accl = (c.speed - (c.prevSpeed ?? c.speed)) / Math.max(dt, .001); c.prevSpeed = c.speed;
    S.a = (S.a || 0) + (accl - (S.a || 0)) * Math.min(1, dt * 4);            // Beschleunigung geglättet
    S.lat = (S.lat || 0) + (c.speed * yawRate - (S.lat || 0)) * Math.min(1, dt * 4);
    let sum = 0;
    for (const w of c.wheels) {
      g.localToWorld(v1.copy(w.c));
      // jedes Rad fährt auf den Boden darunter (auch auf Bordsteine hoch); in der Luft hängen die Räder aus
      const want = c.air ? -.07 : clamp(surfaceAt(v1.x, v1.z) - (v1.y - w.c.y), -.12, .22);
      if (Math.abs(want - (w.lastWant ?? want)) > .04 && Math.abs(c.speed) > 1) dashKick(Math.min(.9, Math.abs(want - w.lastWant) * (2 + Math.abs(c.speed) * .12)));   // Kante -> Dashcam wackelt
      w.lastWant = want;
      w.oy = (w.oy || 0) + (want - (w.oy || 0)) * Math.min(1, dt * 20);
      w.steer.position.y = w.c.y + w.oy; sum += w.oy;
    }
    if (!c.air && gacc > 18) { S.hv = (S.hv || 0) - Math.min(.5, (gacc - 18) * .01); dashKick(Math.min(1.2, (gacc - 18) * .008)); }   // Senke/Kante: Karosserie federt ein, Dashcam wackelt
    dashRoad(Math.abs(c.speed), dt);                                          // leichtes Fahrbahn-Zittern der Dashcam
    const pit = spring(S, 'p', clamp(-S.a * .004, -.035, .035), dt, 55, 7);
    const rol = spring(S, 'r', clamp(S.lat * .004, -.05, .05), dt, 50, 7);
    const hv = clamp(spring(S, 'h', c.wheels.length ? sum / c.wheels.length * .6 : 0, dt, 110, 8), -.12, .07);
    const f = player.inCar ? .35 : 1;
    ch.rotation.x = pit * f + (c.bend?.x || 0); ch.rotation.z = rol * f + (c.bend?.z || 0); ch.position.y = hv * f;   // bend: vom Tornado schief gedrückt
    c.susOut = [pit, rol, hv];                                                 // für die anderen Spieler
  }
  // Räder drehen + lenken
  for (const w of c.wheels) { w.spin.rotation.x += c.speed / .34 * dt; if (w.front) w.steer.rotation.y = steer * .8; }
  for (const lz of sc ? [.35, -.35] : [1.5, -1.5]) {
    const p = g.localToWorld(v1.set(0, 0, lz)), r = sc ? .35 : 1.05;
    for (const k of colliders) {
      if (p.x > k.minX - r && p.x < k.maxX + r && p.z > k.minZ - r && p.z < k.maxZ + r) {
        const dx1 = p.x - (k.minX - r), dx2 = (k.maxX + r) - p.x, dz1 = p.z - (k.minZ - r), dz2 = (k.maxZ + r) - p.z, m = Math.min(dx1, dx2, dz1, dz2);
        if (m === dx1) g.position.x -= dx1; else if (m === dx2) g.position.x += dx2; else if (m === dz1) g.position.z -= dz1; else g.position.z += dz2;
        crash(Math.abs(c.speed), p); c.speed *= -.2;
      }
    }
  }
  const RR = sc ? 1.5 : 2.9;
  for (const o of allNpc) {
    const d = o.group.position.distanceTo(g.position);
    if (d < RR) {
      v1.subVectors(g.position, o.group.position).setY(0).normalize(); g.position.addScaledVector(v1, RR - d);
      const imp = Math.abs(c.speed - o.speed * .5); crash(imp, o.group.position); c.speed *= -.25; o.speed = 0;
      if (imp > 14 && o.glassMat.visible) glassNet(o, o.group.position.clone().setY(o.group.position.y + 1.2));   // NPC-Auto: Scheiben gehen kaputt, brennt aber nicht
    }
  }
  if (Math.abs(c.speed) > 3) for (const p of peds) if (p.alive && p.root.position.distanceTo(g.position) < 1.9) killPedNet(p, v1.set(Math.sin(c.heading), 0, Math.cos(c.heading)));
  if (engine) {
    const s = Math.abs(c.speed);
    if (sc) { engine.o1.frequency.value = 180 + s * 40; engine.o2.frequency.value = 90 + s * 20; engine.pa.setVolume(player.inCar && s > .3 ? .12 : 0); }
    else { engine.o1.frequency.value = 38 + s * 3.2 + thr * 12; engine.o2.frequency.value = 19 + s * 1.6; engine.pa.setVolume(player.inCar && !c.dead ? .5 : 0); }
  }
}
// p = Aufprallpunkt (Welt) oder null (Landung)
function crash(imp, p) {
  if (imp < 2) return;
  phone.crash = Math.max(phone.crash || 0, Math.min(.045, imp * .003));   // Handy in der Halterung wackelt kurz heftig
  playAt(SND.crash, p || pcar.group.position, Math.min(2, imp / 8)); hands.forEach(h => haptic(h, Math.min(1, imp / 15), 150));
  // Dashcam: wackelt; bei hartem Aufprall reißt sie ab und fliegt durchs Auto
  if (p && imp > 12) dashFly(imp, p); else dashKick(Math.min(1.8, imp * .07));
  // statt Feuer: echte Schäden (Dellen, kaputte Scheinwerfer, Scheiben)
  if (p && imp > 8) carDamage(pcar, imp, p);
}
function seatPlayer() {
  if (vehicle.type === 'scooter') {   // auf dem Scooter steht man: echte Kopfhöhe, nur Position/Richtung folgen
    pcar.group.updateMatrixWorld(true);
    const deck = pcar.group.localToWorld(v1.set(0, .16, -.06));
    dolly.rotation.set(0, pcar.heading + Math.PI, 0);
    const off = v2.set(player.calib.x, 0, player.calib.z).applyAxisAngle(UP, dolly.rotation.y);
    dolly.position.set(deck.x - off.x, deck.y + player.seatOff, deck.z - off.z);
    return;
  }
  pcar.group.updateMatrixWorld(true);   // aktuelle Auto-Position verwenden (nicht die vom letzten Bild -> sonst Zittern!)
  const head = pcar.group.localToWorld(v1.copy(pcar.head));   // am Fahrgestell, nicht an der federnden Karosserie
  dolly.rotation.set(0, pcar.heading + Math.PI, 0);
  const off = v2.copy(player.calib).applyAxisAngle(UP, dolly.rotation.y);
  dolly.position.set(head.x - off.x, head.y - off.y + player.seatOff, head.z - off.z);
}

// ===================================================================
// Auto-Extras: Dashcam, Fenster (X/Y), Unfallschäden (statt Feuer), Türgeräusche
// ===================================================================
let lpD = 0;
SND.doorOpen = mkBuf(.4, (t, r) => (t < .025 ? r * (1 - t / .025) * .7 : 0) + (t > .05 && t < .075 ? r * (1 - (t - .05) / .025) * .45 : 0) + Math.sin(2 * Math.PI * 160 * t) * Math.exp(-t * 25) * .3);
SND.doorClose = mkBuf(.55, (t, r) => { lpD += (r - lpD) * .06; return Math.sin(2 * Math.PI * 58 * t) * Math.exp(-t * 13) * 1.1 + lpD * Math.exp(-t * 18) * 2.2 + (t < .012 ? r * .6 : 0) + (t > .03 && t < .04 ? r * .25 : 0); });
SND.glass = mkBuf(.9, (t, r) => { let s = r * Math.exp(-t * 9) * .45; for (const f of [3100, 4700, 6900, 5300, 8200]) s += Math.sin(2 * Math.PI * f * t + f) * Math.exp(-t * (6 + f / 900)) * .1; return s; });
SND.winMotor = mkBuf(2.3, (t, r) => (Math.sign(Math.sin(2 * Math.PI * 95 * t)) * .07 + r * .04 + Math.sin(2 * Math.PI * 190 * t) * .05) * Math.min(1, t * 20) * Math.min(1, (2.3 - t) * 20));
SND.dashOn = mkBuf(.2, t => Math.sin(2 * Math.PI * 1900 * t) * (t < .1 ? 1 : 0) * .25);
SND.dashOff = mkBuf(.35, t => Math.sin(2 * Math.PI * (t < .12 ? 1900 : 1300) * t) * ((t < .1 || (t > .15 && t < .25)) ? 1 : 0) * .25);
SND.dashHit = mkBuf(.15, (t, r) => (r * .6 + Math.sin(2 * Math.PI * 900 * t) * .4) * Math.exp(-t * 45));
SND.slide = mkBuf(.9, (t, r) => (r * .1 + Math.sin(2 * Math.PI * 70 * t) * .05) * Math.sin(Math.PI * t / .9));

// ---------- automatische Schiebetüren (Supermarkt, Schule, Tankstellen-Shop) ----------
function updSlideDoors(dt) {
  for (const s of slideDoors) {
    const mine = s.lock === undefined || s.lock === save.house;          // Haustür: geht nur für den Besitzer auf
    let near = mine && s.c.distanceToSquared(headWorld) < 3.4 * 3.4;
    if (!near) for (const p of net.players.values()) if ((s.lock === undefined || p.st?.home === s.lock) && p.root?.visible && p.root.position.distanceToSquared(s.c) < 3.4 * 3.4) { near = true; break; }
    if (near !== s.open) { s.open = near; if (near) playAt(SND.slide, s.c, .6, 3); }
    const k = s.k + clamp((near ? 1 : 0) - s.k, -dt * 1.6, dt * 2.2);
    if (k === s.k) continue; s.k = k;
    s.L.position.x = s.d0 + s.dw / 2 - k * s.dw * .92; s.R.position.x = s.d1 - s.dw / 2 + k * s.dw * .92;
    for (const o of [s.L, s.R]) { o.updateMatrix(); o.updateMatrixWorld(true); }
  }
}

// ---------- Türen: Klacken beim Öffnen, dumpfes Zuschlagen ----------
// onSlam(stärke 0..1): Tür ist zugefallen -> Auto wippt kurz in den Stoßdämpfern
function doorSound(st, a, obj, dt, onSlam) {
  if (!st.sOpen && a > .05) { st.sOpen = true; playAt(SND.doorOpen, obj.getWorldPosition(V()), .9, 3); }
  else if (st.sOpen && a < .015) {
    st.sOpen = false; const v = clamp(.45 + ((st.sA ?? a) - a) / Math.max(dt, .001) * .35, .45, 1.5);
    playAt(SND.doorClose, obj.getWorldPosition(V()), v, 4); onSlam?.(clamp((v - .3) / 1.2, .3, 1));
  }
  st.sA = a;
}
// Tür zugeschlagen: Karosserie federt kurz ein und wippt zur Seite (ganz leicht)
function slamCar(S, side, s) { S.hv = (S.hv || 0) - .3 * s; S.rv = (S.rv || 0) - side * .2 * s; }

// ---------- Dashcam: hängt an der Frontscheibe, Weitwinkel, wackelt bei Wellen, fliegt bei hartem Crash durchs Auto ----------
const dashRT = new THREE.WebGLRenderTarget(512, 288); dashRT.texture.colorSpace = THREE.SRGBColorSpace;
const dashGrabber = mkGrab(dashRT);
const dash = { root: null, pivot: null, body: null, cam: null, led: null, btn: null, ch: null, sp: 0, sv: 0, rp: 0, rv: 0, loose: false, held: null,
  vel: V(), spin: V(), bounds: null, rec: false, mr: null, chunks: [], can: null, g: null, dest: null, t0: 0, next: 0, scrT: 0 };
function buildDashcam(ch, ws, eye, halfW, top) {
  dashRemove();
  // Platz: oben mittig an der Frontscheibe (hinter dem Innenspiegel), 3 cm vor dem Glas
  let mount;
  if (ws) {
    ws.computeBoundingBox(); const b = ws.boundingBox;
    mount = V(0, b.min.y, b.max.z).lerp(V(0, b.max.y, b.min.z), .86);
    mount.addScaledVector(V(0, b.max.z - b.min.z, b.max.y - b.min.y).normalize(), -.035);
  } else mount = V(0, eye.y + .2, eye.z + .62);
  mount.x = -Math.sign(eye.x || 1) * .2;                              // neben dem Innenspiegel (Beifahrerseite)
  const dark = M(0x16181b, { roughness: .45, metalness: .2 });
  const root = new THREE.Group(); root.position.copy(mount); ch.add(root);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(.03, .006, .03), dark); root.add(plate);
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(.0055, .0055, .03, 8), dark); stalk.position.y = -.015; root.add(stalk);
  const pivot = new THREE.Group(); pivot.position.y = -.03; root.add(pivot);
  const body = new THREE.Group(); body.position.y = -.026; pivot.add(body);
  body.add(new THREE.Mesh(new RoundedBoxGeometry(.075, .045, .034, 3, .008), dark));
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(.013, .015, .012, 20).rotateX(Math.PI / 2), M(0x050505, { roughness: .15, metalness: .6 })); lens.position.set(.012, 0, .022); body.add(lens);
  const lg = new THREE.Mesh(new THREE.CircleGeometry(.0105, 20), M(0x0a1830, { roughness: .02, metalness: .9 })); lg.position.set(.012, 0, .0285); body.add(lg);
  const [sc, sg] = C(128, 72), stex = new THREE.CanvasTexture(sc); stex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(.058, .033), new THREE.MeshBasicMaterial({ map: stex, toneMapped: false })); screen.position.set(0, 0, -.0175); screen.rotation.y = Math.PI; body.add(screen);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(.0065, .0065, .006, 14), M(0xc0201a, { roughness: .4 })); btn.position.set(.024, .0245, -.004); body.add(btn);
  const led = new THREE.Mesh(new THREE.SphereGeometry(.0028, 8, 6), new THREE.MeshBasicMaterial({ color: 0x330000 })); led.position.set(-.029, .013, -.0176); body.add(led);
  const look = new THREE.Group(); look.position.set(.012, 0, .03); look.rotation.y = Math.PI; body.add(look);
  const cam = new THREE.PerspectiveCamera(118, 16 / 9, .05, 450); cam.rotation.x = -.07; look.add(cam);
  Object.assign(dash, { root, pivot, body, cam, led, btn, ch, sc, sg, stex, sp: 0, sv: 0, rp: 0, rv: 0, loose: false, held: null, scrT: 0,
    bounds: { x: halfW * .75, y0: eye.y - .72, y1: top - .12, z0: eye.z - 1.3, z1: mount.z - .04 } });
}
function dashRemove() {
  if (dash.rec) dashStop();
  if (dash.held) { const h = dash.held; if (h.held?.type === 'dash') h.held = null; }
  dash.body?.parent?.remove(dash.body); dash.root?.parent?.remove(dash.root);
  Object.assign(dash, { root: null, pivot: null, body: null, cam: null, held: null, loose: false });
}
const dashMounted = () => !!dash.body && !dash.loose;
function dashKick(s) { if (!dashMounted() || !(s > 0)) return; dash.sv -= s * 2.2; dash.rv += (Math.random() - .5) * s * 1.6; }
function dashRoad(sp, dt) { if (!dashMounted() || sp < 1) return; const a = Math.min(1, sp / 30) * .05 * dt * 60; dash.sv += (Math.random() - .5) * a; dash.rv += (Math.random() - .5) * a * .5; }
function dashMount(quiet) {
  if (!dash.body) return;
  if (dash.held?.held?.type === 'dash') dash.held.held = null;
  dash.pivot.add(dash.body); dash.body.position.set(0, -.026, 0); dash.body.rotation.set(0, 0, 0);
  Object.assign(dash, { loose: false, held: null, out: false, sp: 0, sv: 0, rp: 0, rv: 0 });
  if (!quiet) { playAt(SND.click, dash.root.getWorldPosition(V()), .8, 2); msg('Dashcam wieder angebracht', 2); }
}
// harter Aufprall: Dashcam reißt ab und fliegt (im Auto) Richtung Aufprall, prallt ab, liegt dann irgendwo
function dashFly(imp, p) {
  if (!dash.body) return;
  if (dash.held || dash.out) return;
  const ch = dash.ch; ch.updateMatrixWorld(true); dash.body.updateMatrixWorld(true);
  if (!dash.loose) { ch.attach(dash.body); dash.loose = true; msg(xrOn() ? 'Die Dashcam ist abgerissen! Greifen und an die Scheibe halten' : 'Die Dashcam ist abgerissen! C = wieder anbringen', 3.5); }
  const lp = ch.worldToLocal(p.clone()); lp.y = 0; if (lp.lengthSq() < .01) lp.set(0, 0, 1); lp.normalize();
  dash.vel.copy(lp).multiplyScalar(Math.min(9, imp * .42)).add(V(rand(-1.5, 1.5), rand(1.8, 3.8), rand(-1, 1)));
  dash.spin.set(rand(-16, 16), rand(-16, 16), rand(-16, 16));
}
function dashPhysics(dt) {
  const B = dash.bounds, b = dash.body, v = dash.vel; if (!B) return;
  v.y -= 9.8 * dt; v.z -= (pcar.sus?.a || 0) * dt * .8;                // Bremsen/Gasgeben schiebt sie herum
  b.position.addScaledVector(v, dt);
  b.rotation.x += dash.spin.x * dt; b.rotation.y += dash.spin.y * dt; b.rotation.z += dash.spin.z * dt;
  let hit = 0;
  const wall = (ax, lo, hi) => { const q = b.position[ax]; if (q < lo) { b.position[ax] = lo; if (v[ax] < 0) { hit = Math.max(hit, -v[ax]); v[ax] *= -.45; } } else if (q > hi) { b.position[ax] = hi; if (v[ax] > 0) { hit = Math.max(hit, v[ax]); v[ax] *= -.45; } } };
  wall('x', -B.x, B.x); wall('y', B.y0, B.y1); wall('z', B.z0, B.z1);
  if (b.position.y <= B.y0 + .002) {                                   // liegt: rutscht aus, hört auf zu drehen
    const f = 1 - Math.min(1, dt * 6); v.x *= f; v.z *= f; dash.spin.multiplyScalar(1 - Math.min(1, dt * 5)); if (Math.abs(v.y) < .35) v.y = 0;
  }
  if (hit > .9) { dash.spin.multiplyScalar(.7); playAt(SND.dashHit, b.getWorldPosition(V()), Math.min(1, hit / 4), 2); }
  // durch eine kaputte Scheibe / offene oder fehlende Tür raus aus dem Auto
  if (hit > 3 && dashCanExit(b.position) && Math.random() < .7) dashOut();
}
function dashCanExit(p) {
  const c = pcar, B = dash.bounds, D = c.dmg || {}, glassGone = D.all || !c.glassMat.visible;
  if (glassGone) return true;
  if (p.z >= B.z1 - .01 && D.ws && Math.abs(c.speed) > 8) return true;   // durch die gesprungene Frontscheibe (bei Tempo)
  if (Math.abs(p.x) >= B.x - .01) {                                     // Seite: Fenster kaputt/offen oder Tür offen/weg
    const side = Math.sign(p.x), i = c.doors.findIndex(d => d.side === side && Math.abs(d.pivot.position.z - p.z) < 1.2);
    const d = c.doors[i]; if (d && (!d.pivot.visible || d.a > .3 || ((D.wb >> i) & 1) || (c.wins?.[i] || 0) > .6)) return true;
  }
  return false;
}
// Dashcam fliegt aus dem Auto: ab jetzt eigene Flugbahn in der Welt (Boden, Abprallen), nimmt weiter auf
function dashOut() {
  const c = pcar, b = dash.body, q = new THREE.Quaternion();
  dash.ch.getWorldQuaternion(q);
  const v = dash.vel.clone().applyQuaternion(q).add(V(Math.sin(c.heading) * c.speed, c.vy || 0, Math.cos(c.heading) * c.speed));
  if (c.fly) v.add(V(-Math.sin(c.fly.ang) * 16, rand(4, 9), Math.cos(c.fly.ang) * 16));   // im Tornado: mit Schwung raus
  scene.attach(b); dash.vel.copy(v); dash.out = true;
  playAt(SND.glass, b.getWorldPosition(V()), .8, 3); msg('Die Dashcam ist aus dem Auto geflogen!', 3);
}
function dashWorldPhysics(dt) {
  const b = dash.body, v = dash.vel;
  v.y -= 9.8 * dt; b.position.addScaledVector(v, dt);
  b.rotation.x += dash.spin.x * dt; b.rotation.y += dash.spin.y * dt; b.rotation.z += dash.spin.z * dt;
  const gy = surfaceAt(b.position.x, b.position.z) + .03;
  if (b.position.y <= gy) {
    b.position.y = gy;
    if (v.y < -1.5) { playAt(SND.dashHit, b.position, Math.min(1, -v.y / 6), 3); v.y *= -.35; dash.spin.multiplyScalar(.6); }
    else { v.y = 0; dash.spin.multiplyScalar(1 - Math.min(1, dt * 6)); }
    const f = 1 - Math.min(1, dt * 5); v.x *= f; v.z *= f;                // rutscht aus
  }
  pushOutOf(b.position, .05);
}
function dashGrab(h, p) {
  if (!dash.loose || dash.held || !dash.body) return false;
  if (dash.body.getWorldPosition(v1).distanceTo(p) > .15) return false;
  h.ctrl.attach(dash.body); dash.held = h; h.held = { type: 'dash' }; haptic(h, .4, 50); return true;
}
function dashRelease(h) {
  if (dash.held !== h) return;
  dash.held = null;
  if (dash.body.getWorldPosition(v1).distanceTo(dash.root.getWorldPosition(v2)) < .22) { dashMount(); return; }
  // fallen lassen: im Auto bleibt sie im Auto, draußen fällt sie auf den Boden
  const B = dash.bounds, l = dash.ch.worldToLocal(dash.body.getWorldPosition(v1).clone()), inside = B && Math.abs(l.x) < B.x + .1 && l.y > B.y0 - .2 && l.y < B.y1 + .1 && l.z > B.z0 - .1 && l.z < B.z1 + .1;
  if (inside) { dash.ch.attach(dash.body); dash.out = false; } else { scene.attach(dash.body); dash.out = true; }
  dash.vel.set(0, 0, 0); dash.spin.set(0, 0, 0);
}
// Knopf an der Dashcam (oder C am PC): Aufnahme starten / stoppen; abgerissen -> am PC wieder anbringen
function dashButton() {
  if (!dash.body) return;
  if (dash.loose) { if (!xrOn()) dashMount(); return; }
  if (dash.rec) dashStop(); else dashStart();
}
function dashStart() {
  if (dash.rec || !dash.cam) return;
  if (typeof MediaRecorder === 'undefined') { msg('Video-Aufnahme wird hier nicht unterstützt', 3); return; }
  AC.resume();
  const [c, g] = C(dashRT.width, dashRT.height); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); dash.can = c; dash.g = g;
  dash.dest = AC.createMediaStreamDestination(); try { listener.getInput().connect(dash.dest); } catch (e) { }
  const stream = new MediaStream([...c.captureStream(24).getVideoTracks(), ...dash.dest.stream.getAudioTracks()]);
  const mime = ['video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported?.(m)) || '';
  let mr; try { mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2000000 } : undefined); } catch (e) { msg('Aufnahme nicht möglich', 3); return; }
  const chunks = [], t0 = time; dash.mr = mr;
  mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = () => {
    // Video geht ans Handy (Galerie) – wie bei echten Dashcams per WLAN
    const type = mr.mimeType || 'video/webm', blob = new Blob(chunks, { type }), url = URL.createObjectURL(blob);
    const [th, tg] = C(c.width, c.height); tg.drawImage(c, 0, 0);
    const vid = document.createElement('video'); vid.src = url; vid.loop = true; vid.playsInline = true;
    const len = Math.round(time - t0);
    addGallery({ type: 'clip', url, blob, thumb: th, vid, ext: type.includes('mp4') ? 'mp4' : 'webm', len, dash: true });
    phone.notif = { title: 'Dashcam', text: 'Video an dein Handy gesendet (' + len + ' s)', t0: time, until: time + 4 }; phone.drawT = 0;
    msg('Dashcam-Video ist jetzt in deiner Handy-Galerie', 3);
  };
  mr.start(250); dash.rec = true; dash.t0 = time; dash.next = 0;
  playAt(SND.dashOn, dash.body.getWorldPosition(V()), .8, 2); msg('Dashcam nimmt auf', 2);
}
function dashStop() {
  if (!dash.rec) return; dash.rec = false;
  try { dash.mr.stop(); } catch (e) { }
  try { listener.getInput().disconnect(dash.dest); } catch (e) { }
  if (dash.body) playAt(SND.dashOff, dash.body.getWorldPosition(V()), .8, 2);
}
// ein Bild der Dashcam: Szene rendern, asynchron auslesen, mit Datum/Uhrzeit/Tempo ins Video
function renderDashcam() {
  grabPoll(dashGrabber);
  if (!dash.rec || !dash.cam || time < dash.next) return;
  dash.next = time + 1 / (xrOn() ? 18 : 24);
  grabRT(c => {
    if (!dash.g) return; const g = dash.g, W = dash.can.width, H = dash.can.height;
    g.drawImage(c, 0, 0);
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, H - 22, W, 22);
    g.font = '600 13px monospace'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#fff';
    g.fillText(`${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}  ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`, 8, H - 11);
    g.textAlign = 'right'; g.fillText(Math.round(Math.abs(pcar.speed) * 3.6) + ' km/h  ' + (net.name || ''), W - 8, H - 11);
    if (Math.floor(time * 2) % 2) { g.fillStyle = '#ff2a2a'; g.beginPath(); g.arc(14, 14, 5, 0, 7); g.fill(); g.textAlign = 'left'; g.fillText('REC', 24, 14); }
  }, dashGrabber);
  const xr = renderer.xr.enabled; renderer.xr.enabled = false;
  const prev = renderer.getRenderTarget(), su = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
  dash.cam.updateMatrixWorld(true);
  try { renderer.setRenderTarget(dashRT); renderer.render(scene, dash.cam); grabIssue(dashGrabber); }
  finally { renderer.setRenderTarget(prev); renderer.xr.enabled = xr; renderer.shadowMap.autoUpdate = su; }
}
function updDash(dt) {
  if (!dash.body) return;
  if (!dash.loose) {
    // Feder: nickt erst hoch, dann runter und schwingt langsam aus – stärkere Stöße = stärkeres Wackeln
    dash.sv += (-160 * dash.sp - 3.2 * dash.sv) * dt; dash.sp = clamp(dash.sp + dash.sv * dt, -.6, .6);
    dash.rv += (-120 * dash.rp - 3 * dash.rv) * dt; dash.rp = clamp(dash.rp + dash.rv * dt, -.5, .5);
    dash.pivot.rotation.set(dash.sp, 0, dash.rp);
    // Knopf mit dem Finger (Controller-Spitze) drücken
    if (xrOn()) for (const h of hands) {
      const d = dash.btn.getWorldPosition(v1).distanceTo(h.ctrl.getWorldPosition(v2));
      if (d < .035 && !h.dashPoke) { h.dashPoke = true; haptic(h, .5, 40); dashButton(); } else if (d > .07) h.dashPoke = false;
    }
  } else if (!dash.held) { if (dash.out) dashWorldPhysics(dt); else dashPhysics(dt); }
  dash.led.material.color.set(dash.rec ? (Math.floor(time * 2) % 2 ? 0xff1a1a : 0x550000) : 0x0a3a12);
  dash.scrT -= dt;
  if (dash.scrT <= 0 && headWorld.distanceTo(dash.root.getWorldPosition(v1)) < 3) {   // kleiner Bildschirm hinten: REC-Zeit oder "Bereit"
    dash.scrT = .5; const g = dash.sg; g.fillStyle = '#05070a'; g.fillRect(0, 0, 128, 72); g.textAlign = 'center'; g.textBaseline = 'middle';
    if (dash.rec) { const s = Math.floor(time - dash.t0); g.fillStyle = '#ff3030'; g.font = '700 20px system-ui'; g.fillText('● REC', 64, 26); g.fillStyle = '#fff'; g.font = '600 18px monospace'; g.fillText(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'), 64, 52); }
    else { g.fillStyle = '#9fd8ae'; g.font = '700 17px system-ui'; g.fillText('DASHCAM', 64, 26); g.fillStyle = '#aab'; g.font = '500 12px system-ui'; g.fillText(xrOn() ? 'roter Knopf = REC' : 'C = Aufnahme', 64, 50); }
    dash.stex.needsUpdate = true;
  }
}

// ---------- Fenster: X = runter, Y = hoch (deine Seite). 0 = zu, 1 = ganz offen ----------
// Bei geschlossenem Fenster hört man draußen niemanden (und draußen hört dich keiner)
function setWindow(t) {
  if (player.inCar) { if (vehicle.type === 'scooter' || !pcar.doorGlass?.[0]) return; if (pcar.winT[0] === t) return; pcar.winT[0] = t; }
  else if (player.ride) { if (player.ride.winT === t) return; player.ride.winT = t; }
  else return;
  playAt(SND.winMotor, headWorld, .45, 2); haptic(handBy('left'), .25, 60);
}
// Fensterscheibe(n) einer Tür senken
function setGlass(list, v) { if (list) for (const g of list) g.m.position.y = g.y0 - g.drop * v; }
function updWindows(dt) {
  const c = pcar; if (!c.wins) return;
  c.wins[0] += clamp(c.winT[0] - c.wins[0], -dt / 2.2, dt / 2.2);
  // Mitfahrer in meinem Auto: deren Fenster
  for (let i = 1; i < c.wins.length; i++) {
    let t = 0; for (const o of net.players.values()) if (o.st?.rd && o.st.rd[0] === net.id && o.st.rd[1] === i) t = o.st.rw || 0;
    c.wins[i] += clamp(t - c.wins[i], -dt / 2.2, dt / 2.2);
  }
  if (c.doorGlass) c.doorGlass.forEach((l, i) => setGlass(l, c.wins[i] || 0));
  if (player.ride) { const r = player.ride; r.win = (r.win || 0) + clamp((r.winT || 0) - (r.win || 0), -dt / 2.2, dt / 2.2); }
}
// wie offen ist ein Auto (Fenster/Türen)? 1 = offen/kein Auto
function carOpen(id) {
  if (id === net.id) { if (vehicle.type === 'scooter') return 1; let o = 0; for (const v of pcar.wins || []) o = Math.max(o, v); for (const d of pcar.doors) if (d.a > .1) o = 1; return o; }
  const p = net.players.get(id); if (!p || p.carType === 'scooter') return 1;
  let o = 0; for (const v of p.winVal || []) o = Math.max(o, v || 0); for (const d of p.cmDoors || []) if ((d?.userData.a || 0) > .1) o = 1; return o;
}
const myCarId = () => player.inCar ? net.id : player.ride ? player.ride.id : 0;
const carIdOf = p => p.st?.c ? p.id : p.st?.rd ? p.st.rd[0] : 0;
function hearFactor(p) {
  const a = myCarId(), b = carIdOf(p);
  if (a && a === b) return 1;                                          // im selben Auto hört man sich immer
  return (a ? carOpen(a) : 1) * (b ? carOpen(b) : 1);
}
const nearHolder = r => !!pcar.holder && pcar.holder.getWorldPosition(v1).distanceTo(headWorld) < r;

// ---------- Unfallschäden: Dellen, kaputte Scheinwerfer/Rücklichter, Scheiben – das Auto brennt davon nicht ----------
const geo0 = new WeakMap();                                           // Originalgeometrie (zum Reparieren)
function dentMeshes(root, wp, wd, depth, R) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4(), lp = V(), ld = V();
  root.traverse(o => {
    if (!o.isMesh || o.userData.inner || o.userData.screen || !o.geometry?.attributes?.position || o.material?.colorWrite === false) return;
    if (dash.body && (o.parent === dash.body || o.parent === dash.root || o.parent === dash.pivot)) return;
    inv.copy(o.matrixWorld).invert(); lp.copy(wp).applyMatrix4(inv); ld.copy(wd).transformDirection(inv);
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (o.geometry.boundingBox.distanceToPoint(lp) > R) return;
    if (!geo0.has(o)) { geo0.set(o, o.geometry); o.geometry = o.geometry.clone(); }   // eigene Kopie: andere Autos gleichen Typs bleiben heil
    const pos = o.geometry.attributes.position, R2 = R * R; let hit = false;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), dx = x - lp.x, dy = y - lp.y, dz = z - lp.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R2) continue;
      const f = (1 - d2 / R2) ** 2, k = depth * f, n = (Math.sin(i * 12.9898 + x * 78.233) * 43758.5453 % 1) * .3 * k;   // ungleichmäßig zerknautscht
      pos.setXYZ(i, x - ld.x * k + n * ld.z, y - ld.y * k - Math.abs(n) * .6, z - ld.z * k - n * ld.x); hit = true;
    }
    if (hit) { pos.needsUpdate = true; o.geometry.computeVertexNormals(); o.geometry.computeBoundingSphere(); }
  });
}
// dent = { q: Punkt (Auto-Koordinaten), d: Richtung [x, z], s: Stärke 0..1 }; frame = Auto-Wurzel, root = Karosserie
function applyDent(root, frame, dent) {
  frame.updateMatrixWorld(true);
  const wp = frame.localToWorld(V(dent.q[0], dent.q[1], dent.q[2])), wd = V(dent.d[0], dent.d[2] || 0, dent.d[1]).transformDirection(frame.matrixWorld);   // d = [x, z, y]
  dentMeshes(root, wp, wd, .04 + dent.s * .2, .4 + dent.s * .45);
}
function crackWindshield(c) {
  if (c.crack || !c.rainFx) return;
  const [cv, g] = C(512, 320), ox = rand(150, 360), oy = rand(90, 220);
  g.strokeStyle = 'rgba(235,245,255,.85)'; g.lineWidth = 1.6; g.lineCap = 'round';
  for (let i = 0; i < 18; i++) {                                       // Sternbruch: Strahlen mit Knicken + Ringe
    let x = ox, y = oy, a = i / 18 * Math.PI * 2 + rand(-.15, .15); g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 7; s++) { a += rand(-.35, .35); const L = rand(14, 42); x += Math.cos(a) * L; y += Math.sin(a) * L; g.lineTo(x, y); }
    g.stroke();
  }
  for (const r of [12, 26, 44]) { g.beginPath(); for (let k = 0; k <= 24; k++) { const a = k / 24 * Math.PI * 2, rr = r * rand(.8, 1.2); k ? g.lineTo(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr) : g.moveTo(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr); } g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(ox, oy, 6, 0, 7); g.fill();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(c.rainFx.mesh.geometry, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  m.renderOrder = 3; c.rainFx.mesh.parent.add(m); c.crack = m;
}
function breakDoorWindow(c, i, wp) {
  const D = c.dmg; if (!c.doorGlass?.[i] || (D.wb >> i) & 1) return;
  D.wb |= 1 << i; for (const g of c.doorGlass[i]) g.m.visible = false;
  playAt(SND.glass, wp, 1, 4); spawnDebris(wp, 0x9fb7c4, 16, .05, 2.5);
}
function carDamage(c, imp, p) {
  if (!c.chassis || c.chassis === c.vis || vehicle.type === 'scooter') return;
  c.group.updateMatrixWorld(true);
  const dir = c.group.worldToLocal(p.clone()); dir.y = 0; if (dir.lengthSq() < .01) dir.set(0, 0, 1); dir.normalize();   // vom Auto zur Aufprallstelle
  const h = c.half, s = Math.min(Math.abs(h.x / (dir.x || 1e-6)), Math.abs(h.z / (dir.z || 1e-6)));
  const q = V(dir.x * s, Math.min(.72, h.y * .48), dir.z * s), sev = clamp((imp - 8) / 24, 0, 1);
  const dent = { q: [r2(q.x), r2(q.y), r2(q.z)], d: [r2(dir.x), r2(dir.z)], s: r2(sev) };
  applyDent(c.chassis, c.group, dent);
  c.dents ||= []; if (c.dents.length < 12) c.dents.push(dent);
  const D = c.dmg || (c.dmg = { hl: 0, tl: 0, ws: 0, wb: 0, all: 0 }), wq = c.group.localToWorld(q.clone());
  if (dir.z > .55 && sev > .08 && !D.hl) { D.hl = 1; if (c.headMat) { c.headMat.emissiveIntensity = 0; c.headMat.color.multiplyScalar(.35); } playAt(SND.glass, wq, .8, 4); spawnDebris(wq, 0xdfe8ee, 14, .05, 2.5); msg('Scheinwerfer kaputt', 2); }
  if (dir.z < -.55 && sev > .08 && !D.tl) { D.tl = 1; if (c.brakeMat) { c.brakeMat.emissiveIntensity = 0; c.brakeMat.color.multiplyScalar(.4); } playAt(SND.glass, wq, .7, 4); spawnDebris(wq, 0xb01010, 10, .05, 2.5); }
  if (dir.z > .4 && sev > .3 && !D.ws) { D.ws = 1; crackWindshield(c); playAt(SND.glass, wq, 1, 4); }
  if (Math.abs(dir.x) > .5 && sev > .25) { const i = c.doors.findIndex(d => d.front && d.side === Math.sign(dir.x)); if (i >= 0) breakDoorWindow(c, i, wq); }
  if (sev > .85 && !D.all) { D.all = 1; glassNet(c, wq); playAt(SND.glass, wq, 1.4, 5); }   // sehr harter Crash: alle Scheiben weg
}
function repairCar(c) {
  if (c.chassis) c.chassis.traverse(o => { if (o.isMesh && geo0.has(o)) { o.geometry.dispose(); o.geometry = geo0.get(o); geo0.delete(o); } });
  if (c.headMat && c.headCol) { c.headMat.color.copy(c.headCol); c.headMat.emissiveIntensity = 1.2; }
  if (c.brakeMat && c.brakeCol) { c.brakeMat.color.copy(c.brakeCol); c.brakeMat.emissiveIntensity = .5; }
  if (c.crack) { c.crack.parent?.remove(c.crack); c.crack.material.map.dispose(); c.crack.material.dispose(); c.crack = null; }
  if (c.doorGlass) for (const l of c.doorGlass) for (const g of l) g.m.visible = true;
  if (c.glassMat) c.glassMat.visible = true;
  c.dmg = null; c.dents = []; c.bend = null; c.totaled = false; c.hits = 0;
  for (const d of c.doors || []) d.pivot.visible = true;                // abgerissene Türen wieder dran
  for (const j of c.junk || []) scene.remove(j); c.junk = [];
  if (dash.loose) dashMount(true);
}
// Schäden am Auto eines anderen Spielers anzeigen (Bitmaske aus seinem Zustand)
function applyRemoteDamage(p, dm) {
  const full = p.carMesh?.isLOD ? p.carMesh.levels[0].object : p.carMesh; if (!full) return;
  const meta = vehicleMeta[p.carType] || {};
  full.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (meta.headName && m.name === meta.headName && m.emissive) m.emissiveIntensity = dm & 1 ? 0 : 1.2;
      if (meta.brakeName && m.name === meta.brakeName && m.emissive) m.emissiveIntensity = dm & 2 ? 0 : .5;
      if (m.userData.glass) m.visible = !(dm & 8);
    }
  });
  (p.cmWins || []).forEach((l, i) => { if (l) for (const g of l) g.m.visible = !((dm >> 4) >> i & 1); });
  (p.cmDoors || []).forEach((pv, i) => { if (!pv) return; const off = (dm >> 8) >> i & 1; if (off && pv.visible) spawnDebris(pv.getWorldPosition(V()), metaOf(p.carType).paint, 8, .25, 6); pv.visible = !off; });   // abgerissene Türen
}

function placeCityCar(c, dt) {
  const line = R[c.j] + laneOff(c.axis, c.dir);
  if (c.axis === 'x') c.group.position.set(c.s, 0, line); else c.group.position.set(line, 0, c.s);
  const th = c.axis === 'x' ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.dir > 0 ? 0 : Math.PI);
  c.group.rotation.y = lerpAngle(c.group.rotation.y, th, Math.min(1, dt * 6));
}
// Nicht-Host: NPCs nur weiterrechnen (zwischen den Updates vom Host)
function updNpcClient(dt) {
  for (const c of npcCars) {
    if (c.dead) continue;
    c.s += c.dir * c.speed * dt;
    if (c.dir * (c.s - c.turnAt) >= 0) {
      if (c.turn) { const line = R[c.j] + laneOff(c.axis, c.dir); c.j = c.k; c.axis = c.turn.axis; c.dir = c.turn.dir; c.s = line; c.turn = null; }
      c.turnAt = c.dir * 1e9;
    }
    placeCityCar(c, dt);
  }
  for (const c of hwCars) { if (c.dead) continue; c.x += c.dir * c.speed * dt; hwPlace(c); }
}
function npcPacket() {
  return {
    t: 'npc',
    c: npcCars.map(c => [c.axis === 'x' ? 1 : 0, c.dir, c.j, r2(c.s), c.k ?? -1, r2(c.turnAt), c.turn ? c.turn.dir : 0, r2(c.speed)]),
    h: hwCars.map(c => [r2(c.x), r2(c.speed)]),
    p: peds.map(p => p.alive ? [p.bi, r2(p.s), p.dir, p.flee > 0 ? 1 : 0, r2(p.speed)] : [-1, r2(p.root.position.x), r2(p.root.position.z), r2(p.root.rotation.y)]),
    v: vil.i,                                                           // aktueller NPC-Angreifer (-1 = keiner)
  };
}
function applyNpc(m) {
  m.c?.forEach((a, i) => {
    const c = npcCars[i]; if (!c || c.dead) return;
    c.axis = a[0] ? 'x' : 'z'; c.dir = a[1]; c.j = a[2]; c.s = a[3]; c.k = a[4] < 0 ? undefined : a[4]; c.turnAt = a[5];
    c.turn = a[6] ? { axis: c.axis === 'x' ? 'z' : 'x', dir: a[6] } : null; c.speed = a[7];
  });
  m.h?.forEach((a, i) => { const c = hwCars[i]; if (c) { c.x = a[0]; c.speed = a[1]; } });
  m.p?.forEach((a, i) => {
    const p = peds[i]; if (!p) return;
    if (a[0] < 0) { if (p.alive) killPed(p, null); if (!p.flying) { p.root.position.set(a[1], .15, a[2]); p.root.rotation.y = a[3]; } return; }
    if (!p.alive) { p.alive = true; p.root.rotation.set(0, 0, 0); p.root.visible = true; if (p.blob) p.blob.visible = true; }
    const b = blocks[a[0]]; p.bi = a[0]; p.cx = b.cx; p.cz = b.cz; p.s = a[1]; p.dir = a[2]; p.flee = a[3] ? 5 : 0; p.speed = a[4];
  });
  if (m.v !== undefined && m.v !== vil.i) setVillain(m.v);
}
// Autobahn-Autos: A8 (x-Achse) und A81 (z-Achse), am Kartenrand wieder von vorne
function hwPlace(c) {
  if (c.az) { if (c.x > HZ - 30) c.x = -TS / 2 + 40; if (c.x < -TS / 2 + 40) c.x = HZ - 30; c.group.position.set(c.ax, 0, c.x); }
  else { if (c.x > TS / 2 - 40) c.x = -TS / 2 + 40; if (c.x < -TS / 2 + 40) c.x = TS / 2 - 40; c.group.position.set(c.x, 0, c.z); }
}
function updNpc(dt) {
  if (!amHost()) return updNpcClient(dt);
  for (const c of npcCars) {
    if (c.dead) continue;
    const fx = c.axis === 'x' ? c.dir : 0, fz = c.axis === 'z' ? c.dir : 0, px = c.group.position.x, pz = c.group.position.z;
    let target = c.vmax;
    const chk = (ox, oz, dist = 12) => { const dx = ox - px, dz = oz - pz, al = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx); if (al > 0 && al < dist && lat < 2.3) target = Math.min(target, Math.max(0, (al - 6) * 1.5)); };
    if (c.ghost <= 0) { for (const o of npcCars) if (o !== c) chk(o.group.position.x, o.group.position.z); }
    else c.ghost -= dt;
    chk(pcar.group.position.x, pcar.group.position.z); chk(headWorld.x, headWorld.z, 9);
    for (const pl of net.players.values()) { const o = pl.car && pl.carMesh ? pl.carMesh.position : pl.root.position; chk(o.x, o.z, pl.car ? 12 : 9); }
    // Ampel an der nächsten Kreuzung
    c.atRed = false;
    if (c.k !== undefined) {
      const ii = c.axis === 'x' ? c.k : c.j, jj = c.axis === 'x' ? c.j : c.k;
      const d = c.dir * (R[c.k] - c.dir * (ROAD / 2 + 1.5) - c.s), st = signal(ii, jj, c.axis);
      if (d > -.3 && d < 32 && (st === 'r' || (st === 'y' && d > 7))) { target = Math.min(target, Math.max(0, d * .8)); c.atRed = true; }
    }
    c.wait = c.speed < .3 && !c.atRed ? c.wait + dt : 0; if (c.wait > 6) { c.ghost = 2.5; c.wait = 0; }
    c.speed += clamp(target - c.speed, -14 * dt, 3 * dt);
    c.s += c.dir * c.speed * dt;
    if (c.dir * (c.s - c.turnAt) >= 0) {
      if (c.turn) { const line = R[c.j] + laneOff(c.axis, c.dir); c.j = c.k; c.axis = c.turn.axis; c.dir = c.turn.dir; c.s = line; }
      planTurn(c);
    }
    placeCityCar(c, dt);
  }
  for (const c of hwCars) {
    if (c.dead) continue;
    let target = c.vmax;
    for (const o of [...hwCars, pcar]) if (o !== c && !!o.az === !!c.az) {
      const op = o.group.position, al = c.az ? (op.z - c.x) * c.dir : (op.x - c.x) * c.dir, lat = c.az ? Math.abs(op.x - c.ax) : Math.abs(op.z - c.z);
      if (al > 0 && al < 30 && lat < 2) target = Math.min(target, o.speed * (o === pcar ? Math.abs(c.az ? Math.cos(pcar.heading) : Math.sin(pcar.heading)) : 1) + (al - 12));
    }
    if (c.az) { const op = pcar.group.position, al = (op.z - c.x) * c.dir; if (al > 0 && al < 30 && Math.abs(op.x - c.ax) < 2) target = Math.min(target, al - 12); }
    c.speed += clamp(target - c.speed, -15 * dt, 4 * dt); c.speed = Math.max(0, c.speed);
    c.x += c.dir * c.speed * dt; hwPlace(c);
  }
}
function updPeds(dt) {
  const host = amHost();
  for (const p of peds) {
    if (!p.alive) { p.deadT += dt; if (host && p.deadT > 45) placePed(p); else continue; }
    const running = p.flee > 0, sp = running ? 4.2 : p.speed; p.flee -= dt;
    p.s += p.dir * sp * dt;
    const yaw = pedPos(p, p.root.position); p.root.rotation.y = lerpAngle(p.root.rotation.y, yaw, Math.min(1, dt * 8));
    const near = p.root.position.distanceTo(headWorld) < (p === vil.ped ? 320 : 55);   // Angreifer sieht man von weiter weg
    p.root.visible = near; p.root.matrixWorldAutoUpdate = near;   // weit weg: Skelett gar nicht erst durchrechnen
    if (p.mixer && near) {
      p.walk.setEffectiveWeight(running ? 0 : 1); p.run.setEffectiveWeight(running ? 1 : 0);
      p.mixer.update(dt * (running ? 1.1 : sp / 1.4));
    }
  }
}

// ===================================================================
// Waffen & Werkzeuge
// ===================================================================
const rc = new THREE.Raycaster();
const tracer = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V()]), new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true }));
tracer.frustumCulled = false; scene.add(tracer); let tracerT = 0;
function shoot(origin, dir, h) {
  playAt(SND.gun, origin, 1.6, 10); haptic(h, 1, 70);
  muzzleLight.position.copy(origin); muzzleLight.intensity = 6;
  rc.set(origin, dir); rc.far = 400;
  const hit = rc.intersectObjects(shootables, false).find(x => x.object.visible && !(player.inCar && x.object.userData.ent === pcar));
  const end = hit ? hit.point.clone() : origin.clone().addScaledVector(dir, 200);
  showTracer(origin, end);
  scarePeds(origin, 40);
  share('shot', { o: origin.toArray().map(r2), e: end.toArray().map(r2), h: hit ? 1 : 0 });
  if (!hit) return;
  sparks(hit.point); const e = hit.object.userData.ent;
  if (e.kind === 'player') pvpHit(e.p, 25);
  else if (e.kind === 'ped') killPedNet(e, dir);
  else if (e.kind === 'car') { damageCarNet(e, 1, hit.point); if (Math.random() < .25) glassNet(e, hit.point); }
  else if (e.kind === 'prop') breakPropNet(e);
  else if (e.kind === 'pump') igniteNet(e.fl, 1.5);
  else spawnDebris(hit.point, 0xbbb4a8, 3, .06, 2);
}
function showTracer(a, b) {
  tracer.geometry.attributes.position.setXYZ(0, a.x, a.y, a.z); tracer.geometry.attributes.position.setXYZ(1, b.x, b.y, b.z);
  tracer.geometry.attributes.position.needsUpdate = true; tracerT = .06;
}
function useTools(dt) {
  for (const h of hands) {
    const t = h.held?.type === 'tool' ? h.held.t : null;
    if (!t) continue;
    if (t.name === 'pistol' && h.down[0]) {
      const o = t.muzzle.getWorldPosition(V()); const d = t.obj.getWorldDirection(V()).negate();
      shoot(o, d, h); t.vis.position.z = .025;
    }
    if (t.name === 'pistol') t.vis.position.z *= .8;
    if (t.name === 'lighter') {
      t.fl.visible = h.now[0];
      if (h.down[0]) playAt(SND.click, headWorld, .5);
      if (t.fl.visible) { const p = t.tip.getWorldPosition(V()); heatAt(p, dt); if (Math.random() < .5) fireSmall.spawn(p.x, p.y, p.z, 0, .4, 0, .2); t.fl.scale.y = 1 + Math.sin(time * 40) * .2; }
    }
    if (t.name === 'hammer') hammerTick(t, h, dt);
  }
}
function hammerTick(t, h, dt) {
  const pw = t.head.getWorldPosition(V()), pl = dolly.worldToLocal(pw.clone());
  const vel = pl.distanceTo(t.prev) / dt; t.prev.copy(pl); t.cd -= dt;
  if (vel > 2.2 && t.cd <= 0) {
    const what = hitAt(pw, v1.copy(pw).sub(headWorld).setY(0).normalize());
    if (what) { t.cd = .3; haptic(h, 1, 90); const s = what === 'ped' || what === 'wall' || what === 'player' ? 'hit' : 'crash'; playAt(SND[s], pw, 1); sparks(pw, 6); share('hitfx', { p: pw.toArray().map(r2), s }); }
  }
}
function tryGrab(h) {
  const p = h.ctrl.getWorldPosition(V());
  if (player.inCar) {
    const l = pcar.wheelBase.worldToLocal(p.clone()), r = Math.hypot(l.x, l.y);
    if (Math.abs(r - pcar.wheelR) < .11 && Math.abs(l.z) < .15) { h.held = { type: 'wheel', last: Math.atan2(l.y, l.x) }; haptic(h, .3, 40); return; }
  }
  // Handy vom Magneten nehmen (auch von außen durch die offene Tür / das Fenster)
  if (phone.where === 'holder' && phoneG.getWorldPosition(v1).distanceTo(p) < .15) { setPhone('hand'); phone.cool = time + 1.5; return; }
  if (dashGrab(h, p)) return;                                            // heruntergefallene Dashcam aufheben
  if (!seated() && !rob.spot) { const s = robNear(p, .55); if (s) { h.held = { type: 'rob' }; robStart(s, h); haptic(h, .5, 60); return; } }   // Kasse/Automat ausrauben (Grip halten)
  let best = null, bd = .25;
  for (const t of TOOLS) { if (t.heldBy) continue; const d = t.obj.getWorldPosition(v1).distanceTo(p); if (d < bd) { bd = d; best = t; } }
  if (best) return holdTool(best, h);
  // Tür am echten Türgriff greifen (jede der Türen)
  if (seated()) return;
  let door = null, dd = .2, rem = null;
  if (!pcar.dead) for (const d of pcar.doors) { const dist = d.handle.getWorldPosition(v1).distanceTo(p); if (dist < dd) { dd = dist; door = d; } }
  // echte Türgriffe an den Autos der anderen Spieler
  for (const pl of net.players.values()) {
    if (!pl.carMesh?.visible || !pl.cmHandles || pl.carType === 'scooter') continue;
    pl.cmHandles.forEach((hd, i) => { if (!hd) return; const dist = hd.getWorldPosition(v1).distanceTo(p); if (dist < dd) { dd = dist; rem = { p: pl, seat: i }; door = null; } });
  }
  if (rem) {
    const s = rem.p.st;
    if (rem.seat === 0 && s?.c) { msg(rem.p.name + ' sitzt am Steuer', 2); haptic(h, .3, 40); return; }
    if (seatTaken(rem.p.id, rem.seat)) { msg('Der Platz ist schon besetzt', 2); haptic(h, .3, 40); return; }
    haptic(h, .4, 50); startRide({ p: rem.p, seat: rem.seat, dist: dd });   // abgeschlossen -> rüttelt nur (Meldung in startRide)
    return;
  }
  if (door) { h.held = { type: 'door', d: door }; door.grab = h; door.pulse = 0; haptic(h, .4, 50); }
}
function release(h) {
  const x = h.held; if (!x) return;
  if (x.type === 'tool') holster(x.t);
  if (x.type === 'door') x.d.grab = null;
  if (x.type === 'dash') dashRelease(h);
  h.held = null;
}

// ===================================================================
// Eingaben
// ===================================================================
const phoneRay = new THREE.Raycaster();
function vrInput(dt) {
  const L = handBy('left'), Rh = handBy('right');
  for (const h of hands) { if (h.down[1]) tryGrab(h); if (h.up[1]) release(h); }
  laser.visible = false;
  // Zeigestrahl aufs Handy oder aufs Auto-Display (CarPlay); Abzug = antippen
  const rayTargets = [];
  if (phoneG.visible) rayTargets.push(ui);
  if (cp.on && cp.mesh && Rh?.held?.type !== 'wheel') rayTargets.push(cp.mesh);
  if (Rh && rayTargets.length && Rh.held?.type !== 'tool') {
    // Strahl aus dem rechten Controller (setFromXRController gibt es in three r160 noch nicht!)
    Rh.ctrl.updateWorldMatrix(true, false);
    phoneRay.ray.origin.setFromMatrixPosition(Rh.ctrl.matrixWorld);
    phoneRay.ray.direction.set(0, 0, -1).transformDirection(Rh.ctrl.matrixWorld);
    phoneRay.near = 0; phoneRay.far = 3;
    const hit = phoneRay.intersectObjects(rayTargets, false)[0];
    if (hit && hit.distance < 1.5) {
      if (laser.parent !== Rh.ctrl) Rh.ctrl.add(laser);
      laser.visible = true; laser.scale.z = hit.distance;
      if (Rh.down[0]) { if (hit.object === ui) phoneClickUV(hit.uv); else carClickUV(hit.uv); }
    }
  }
  if (L?.now[3] && player.inCar) honk();                                // linker Stick drücken = Hupe
  if (Rh?.down[4]) {
    const ride = !seated() && rideTarget(), arr = arrestTarget();
    if (arr) doArrest(arr);                                             // Polizist: gesuchten Spieler festnehmen
    else if (canEnter()) enterCar();
    else if (ride && !(phone.where === 'hand')) startRide(ride);
    else if (phone.where === 'pocket') setPhone('hand');
    else if (phone.where === 'holder') {
      if (player.inCar || nearHolder(2.2)) { setPhone('hand'); phone.cool = time + 1.5; }
      else msg('Dein Handy hängt noch im Auto am Magneten', 2.5);
    }
    else setPhone('pocket');
  }
  // linker Controller: X = Fenster runter, Y = Fenster hoch (deine Tür)
  if (L?.down[4] && seated()) setWindow(1);
  if (L?.down[5] && seated()) setWindow(0);
  if (Rh?.down[5] && player.inCar) exitCar();
  else if (Rh?.down[5] && player.ride) leaveRide();
  if (Rh?.down[3] && seated()) player.calib.copy(camera.position);
  if (!seated() && !player.fly && L?.gp) {
    let mx = L.gp.axes[2] || 0, mz = L.gp.axes[3] || 0;
    if (Math.hypot(mx, mz) < .15) mx = mz = 0;
    walk(mx, mz, L.now[3] ? 6 : 3, dt);
    vigTarget = Math.min(1, Math.hypot(mx, mz)) * (L.now[3] ? .75 : .5);
  }
  if (!seated() && Rh?.gp) {
    const ax = Rh.gp.axes[2] || 0;
    if (Math.abs(ax) > .7 && !Rh.turned) {
      Rh.turned = true; const before = camera.getWorldPosition(V());
      dolly.rotation.y -= Math.sign(ax) * Math.PI / 6; dolly.updateMatrixWorld(true);
      const after = camera.getWorldPosition(V()); dolly.position.add(before.sub(after));
    } else if (Math.abs(ax) < .3) Rh.turned = false;
  }
  // Rechter Stick hoch/runter: Körpergröße (im Auto: Sitzhöhe) einstellen
  if (Rh?.gp) {
    const ay = Rh.gp.axes[3] || 0;
    if (Math.abs(ay) > .5 && Math.abs(ay) > Math.abs(Rh.gp.axes[2] || 0)) {
      const key = seated() ? 'seatOff' : 'hOff';
      player[key] = clamp(player[key] - ay * dt * .45, -.7, .7);
      msg((seated() ? 'Sitzhöhe ' : 'Größe ') + (player[key] >= 0 ? '+' : '') + Math.round(player[key] * 100) + ' cm', .8);
      try { localStorage.setItem('svr_' + key.toLowerCase(), player[key].toFixed(2)); } catch (e) { }
    }
  }
}
const fwd = V(), rgt = V();
function walk(mx, mz, sp, dt) {
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize(); rgt.crossVectors(fwd, UP);
  dolly.position.addScaledVector(fwd, -mz * sp * dt).addScaledVector(rgt, mx * sp * dt);
  const hp = camera.getWorldPosition(v1), r = .35;
  for (const k of colliders) {
    if (k.lock !== undefined && k.lock === save.house) continue;        // eigene Haustür: offen
    if (hp.x > k.minX - r && hp.x < k.maxX + r && hp.z > k.minZ - r && hp.z < k.maxZ + r) {
      const dx1 = hp.x - (k.minX - r), dx2 = (k.maxX + r) - hp.x, dz1 = hp.z - (k.minZ - r), dz2 = (k.maxZ + r) - hp.z, m = Math.min(dx1, dx2, dz1, dz2);
      if (m === dx1) dolly.position.x -= dx1; else if (m === dx2) dolly.position.x += dx2; else if (m === dz1) dolly.position.z -= dz1; else dolly.position.z += dz2;
    }
  }
}

const startEl = document.getElementById('start');
const lockMouse = () => { try { renderer.domElement.requestPointerLock()?.catch?.(() => { }); } catch (e) { } };
document.getElementById('desk').onclick = () => { startEl.style.display = 'none'; AC.resume(); startIntro(); lockMouse(); };
renderer.xr.addEventListener('sessionstart', () => {
  // Quest: etwas kleinere Schattenkarte für flüssige 72 FPS
  sunLight.shadow.mapSize.set(1024, 1024); sunLight.shadow.map?.dispose(); sunLight.shadow.map = null;
  Object.assign(sunLight.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40 }); sunLight.shadow.camera.updateProjectionMatrix();
  startEl.style.display = 'none'; startOnline(); startIntro(); AC.resume(); camera.rotation.set(0, 0, 0); TOOLS.forEach(t => { if (!t.heldBy) holster(t); }); if (phone.where === 'hand') setPhone('hand'); msg('Willkommen in Stuttgart! A = Handy · Grip = greifen', 5); });
addEventListener('keydown', e => {
  // Chat am PC: tippen, solange die Chat-App offen ist
  if (!xrOn() && phone.where === 'hand' && phone.app === 'chat' && !e.ctrlKey && !e.altKey) {
    if (e.key === 'Enter') { sendChat(chat.draft); e.preventDefault(); return; }
    if (e.key === 'Backspace') { chat.draft = chat.draft.slice(0, -1); phone.drawT = 0; e.preventDefault(); return; }
    if (e.key === 'Escape') { if (chat.draft) chat.draft = ''; else { setPhone('pocket'); lockMouse(); } phone.drawT = 0; return; }
    if (e.key.length === 1 && chat.draft.length < 120) { chat.draft += e.key; phone.drawT = 0; e.preventDefault(); return; }
  }
  desk.keys[e.code] = true; if (xrOn()) return;
  if (e.code === 'KeyE' && !seated() && !rob.spot) { const s = robNear(headWorld, 1.9); if (s) robStart(s, null); }   // E halten = ausrauben
  if (e.code === 'KeyB' && player.inCar) honk();                       // Hupe
  if (e.code === 'KeyT') startFuel();                                   // Tanken (an der Zapfsäule)
  if (e.code === 'KeyN' && job.id === 'police' && player.inCar) setSiren(!job.siren);   // Sirene
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
    const t = TOOLS[+e.code.slice(5) - 1]; if (desk.tool) holster(desk.tool);
    desk.tool = desk.tool === t ? null : t;
    if (desk.tool) { camera.add(t.obj); t.obj.position.set(.2, -.22, -.42); t.obj.rotation.set(0, 0, 0); }
  }
  if (e.code === 'KeyF' && arrestTarget()) doArrest(arrestTarget());
  else if (e.code === 'KeyF') {
    if (player.inCar) exitCar();
    else if (player.ride) leaveRide();
    else {
      const ride = rideTarget(3), own = pcar.dead ? 1e9 : pcar.group.position.distanceTo(headWorld);
      if (ride && (own >= 5 || ride.dist < own)) startRide(ride);
      else if (own < 5) { if (pcar.doors[0]) pcar.doors[0].a = .8; enterCar(); }
    }
  }
  if (e.code === 'KeyP') {
    if (phone.where === 'holder' && !player.inCar && !nearHolder(3)) msg('Dein Handy hängt noch im Auto am Magneten', 2.5);
    else if (phone.where !== 'hand') { setPhone('hand'); document.exitPointerLock(); } else { setPhone('pocket'); lockMouse(); }
  }
  if (e.code === 'KeyH' && player.inCar) setPhone(phone.where === 'holder' ? 'hand' : 'holder');
  if (e.code === 'KeyC' && player.inCar) dashButton();                  // Dashcam: Aufnahme starten/stoppen (bzw. wieder anbringen)
  if ((e.key === 'x' || e.key === 'X') && seated()) setWindow(1);         // Fenster runter
  if ((e.key === 'y' || e.key === 'Y') && seated()) setWindow(0);         // Fenster hoch
});
addEventListener('keyup', e => { desk.keys[e.code] = false; });
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  desk.yaw -= e.movementX * .0022; desk.pitch = clamp(desk.pitch - e.movementY * .0022, -1.4, 1.4);
});
renderer.domElement.addEventListener('mousedown', e => {
  if (xrOn()) return;
  AC.resume();
  const locked = document.pointerLockElement === renderer.domElement;
  // Auto-Display (CarPlay) anklicken: mit Fadenkreuz (Maus gefangen) oder Mauszeiger
  if (cp.on && cp.mesh) {
    const m = locked ? new THREE.Vector2(0, 0) : new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
    phoneRay.setFromCamera(m, camera); phoneRay.far = 2;
    const hit = phoneRay.intersectObject(cp.mesh, false)[0];
    if (hit && carClickUV(hit.uv)) return;
  }
  if (!locked) {
    if (phoneG.visible) {
      const m = new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
      phoneRay.setFromCamera(m, camera); phoneRay.far = 3; const hit = phoneRay.intersectObject(ui, false)[0];
      if (hit) { phoneClickUV(hit.uv); return; }
    }
    if (startEl.style.display === 'none') lockMouse();
    return;
  }
  desk.mouse = true; deskUse(true);
});
addEventListener('mouseup', () => { desk.mouse = false; });
function deskUse(click) {
  const t = desk.tool; if (!t) return;
  const o = camera.getWorldPosition(V()), d = camera.getWorldDirection(V());
  if (t.name === 'pistol' && click) { shoot(t.muzzle.getWorldPosition(V()), d, null); t.vis.position.z = .03; }
  if (t.name === 'hammer' && click) {
    desk.swing = .3; rc.set(o, d); rc.far = 2.8;
    const hit = rc.intersectObjects(shootables, false).find(x => x.object.visible && !(player.inCar && x.object.userData.ent === pcar));
    if (hit) { const w = hitAt(hit.point.clone().addScaledVector(d, .05), d); if (w) { playAt(SND.hit, hit.point, 1); sparks(hit.point, 6); } }
  }
}
function deskTick(dt) {
  camera.rotation.set(desk.pitch, desk.yaw, 0);
  if (!seated() && !player.fly) {
    const mx = (desk.keys.KeyD ? 1 : 0) - (desk.keys.KeyA ? 1 : 0), mz = (desk.keys.KeyS ? 1 : 0) - (desk.keys.KeyW ? 1 : 0);
    if (mx || mz) walk(mx, mz, desk.keys.ShiftLeft ? 7 : 3.5, dt);
  }
  const t = desk.tool;
  if (t?.name === 'pistol') t.vis.position.z *= .8;
  if (t?.name === 'lighter') {
    t.fl.visible = desk.mouse;
    if (desk.mouse) { const o = camera.getWorldPosition(V()), d = camera.getWorldDirection(V()); rc.set(o, d); rc.far = 3; const hit = rc.intersectObjects(shootables, false)[0]; const p = hit ? hit.point : t.tip.getWorldPosition(V()); heatAt(p, dt); fireSmall.spawn(p.x, p.y, p.z, 0, .5, 0, .25); }
  }
  if (t?.name === 'hammer') { desk.swing = Math.max(0, desk.swing - dt); t.obj.rotation.x = desk.swing > 0 ? -1.1 * Math.sin(desk.swing / .3 * Math.PI) : .5; }
}

// Welt ist aufgebaut: ab hier wieder echter Zufall
Math.random = realRandom;

// Schatten für die Welt (flache Bodenflächen werfen keine)
scene.traverse(m => {
  if (!m.isMesh || m.material?.isMeshBasicMaterial) return;
  m.receiveShadow = true;
  if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
  const hgt = (m.geometry.boundingBox.max.y - m.geometry.boundingBox.min.y) * m.scale.y;
  m.castShadow = !(hgt < .3 && m.position.y < .3);
});
terrainMesh.traverse(o => { o.castShadow = false; });   // Gelände wirft keine Schatten (spart ~100.000 Dreiecke pro Bild)
sunLight.shadow.autoUpdate = false;        // Schatten nur jedes 2. (Quest: 3.) Bild neu berechnen
let shadowFrame = 0;
// Feste Welt einfrieren: Häuser, Straßen, Bäume, Schilder … bewegen sich nie.
// Ihre Lage wird einmal berechnet statt jedes Bild für ~6.000 Objekte (spart viel Rechenzeit auf der Quest).
function freezeObj(o) { o.traverse(c => { c.matrixAutoUpdate = true; }); o.updateMatrixWorld(true); o.traverse(c => { c.matrixAutoUpdate = false; }); o.matrixWorldAutoUpdate = false; return o; }
{
  const dyn = new Set([dolly, sky, sunLight.target, pcar.group, phoneG, beam, debMesh, tracer, ...allNpc.map(c => c.group), ...peds.map(p => p.root)]);
  for (const o of [...scene.children]) if (!dyn.has(o) && !o.isLight && !o.isPoints) freezeObj(o);
}

// VR-Komfort: dunkler Rand bei schneller Bewegung (gegen Übelkeit)
const vignette = (() => {
  const [c, g] = C(256, 256); const gr = g.createRadialGradient(128, 128, 40, 128, 128, 128);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(.55, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: T(c, false), transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  m.position.z = -.3; m.renderOrder = 997; camera.add(m); return m;
})();
let vigTarget = 0;

// ===================================================================
// Wetter: manchmal Regen – nasse, spiegelnde Straßen (vom Host für alle gleich)
// ===================================================================
// Innenraum-Aufhellung: das fast schwarze Cockpit leuchtet leicht in seiner eigenen Farbe/Textur (Details bleiben erhalten),
// damit man in der Brille im Auto etwas sieht – kostet fast nichts (keine zusätzliche Lampe)
const cabinLift = { value: 0 }, lifted = new WeakSet();
let CABIN_LIFT_VR = .9;
function liftMat(m) {
  if (!m.isMeshStandardMaterial || lifted.has(m)) return; lifted.add(m);
  m.onBeforeCompile = sh => {
    sh.uniforms.cabinLift = cabinLift;
    sh.fragmentShader = 'uniform float cabinLift;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * cabinLift;');
  };
  m.customProgramCacheKey = () => 'cabinLift';
  m.needsUpdate = true;
}
const weather = { k: 0, target: 0, t: 900 };   // 15 Minuten trocken, 15 Minuten Regen, immer im Wechsel
let sunBase = 2.6, hemiBase = .9, fogBase = scene.fog.color.clone();
const rainFog = new THREE.Color(.42, .45, .5);
const nightSun = new THREE.Color(.55, .65, 1), nightSky = new THREE.Color(.45, .55, .95), nightFog = new THREE.Color(.04, .06, .11), hemiSky0 = hemi.color.clone();
const rain = (() => {
  const n = 2200, pos = new Float32Array(n * 6), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb4bec8, transparent: true, opacity: 0, depthWrite: false }));
  m.frustumCulled = false; m.visible = false; scene.add(m);
  return { m, g, pos, d: [...Array(n)].map(() => [rand(-22, 22), rand(0, 20), rand(-22, 22), rand(13, 17)]) };
})();
let rainSnd = null;
function updWeather(dt) {
  if (amHost()) {
    weather.t -= dt;
    if (weather.t <= 0) { weather.t = 900; weather.target = weather.target ? 0 : 1; share('w', { v: weather.target }); }
  }
  const was = weather.k > .5;
  weather.k += (weather.target - weather.k) * Math.min(1, dt * .12);
  const k = weather.k;
  if (!was && k > .5) msg('Es regnet', 2);
  // In der Brille: deutlich heller belichten und viel mehr Umgebungslicht (helle, weiche Schatten) – die Quest zeigt dunkler als ein Monitor.
  // Regen macht es nur etwas trüber, nicht dunkel.
  const vr = xrOn();
  // Tag/Nacht: nachts Mondlicht (bläulich, schwach), Himmel dunkel, Abends warmes Licht – nachts bleibt es hell genug zum Sehen
  updDayNight(dt); const D = day.k;
  sunLight.intensity = sunBase * (vr ? .75 : 1) * (1 - k * .4) * (.07 + .93 * D); hemi.intensity = hemiBase * (vr ? 2.4 : 1) * (1 + k * .5) * (.38 + .62 * D);
  sunLight.color.setRGB(1, .94 - day.dusk * .25, .84 - day.dusk * .4).lerp(nightSun, 1 - D);
  hemi.color.copy(hemiSky0).lerp(nightSky, 1 - D);
  renderer.toneMappingExposure = (vr ? 1.85 : 1) + k * .15 + (1 - D) * .25;
  cabinLift.value = (vr ? CABIN_LIFT_VR : .12) + (1 - D) * .15;
  scene.backgroundIntensity = (1 - k * .3) * (.05 + .95 * D);
  scene.fog.color.lerpColors(fogBase, rainFog, k).lerp(nightFog, 1 - D); scene.fog.near = 200 - k * 150; scene.fog.far = 1100 - k * 700;
  for (const m of [MAT.road, MAT.inter, MAT.hw, MAT.lot]) { m.roughness = .95 - k * .65; m.envMapIntensity = (1 + k * 1.6) * (.25 + .75 * D); }
  MAT.walk.roughness = .95 - k * .5;
  rain.m.visible = k > .03;
  if (rain.m.visible) {
    rain.m.material.opacity = .5 * k;
    const { pos, d } = rain, hx = headWorld.x, hy = headWorld.y - 1.7, hz = headWorld.z;
    for (let i = 0; i < d.length; i++) {
      const q = d[i]; q[1] -= q[3] * dt; if (q[1] < 0) { q[1] = 20; q[0] = rand(-22, 22); q[2] = rand(-22, 22); }
      const x = hx + q[0], z = hz + q[2], y = hy + q[1];
      pos.set([x, y, z, x - .04, y + .55, z - .02], i * 6);
    }
    rain.g.attributes.position.needsUpdate = true;
  }
  if (AC.state === 'running') {
    if (!rainSnd) {
      rainSnd = new THREE.Audio(listener); let l = 0; rainSnd.setBuffer(mkBuf(2, (t, r) => { l += (r - l) * .35; return l * .8; })); rainSnd.setLoop(true); rainSnd.setVolume(0);
      rainLP = AC.createBiquadFilter(); rainLP.type = 'lowpass'; rainLP.frequency.value = 18000; rainSnd.setFilter(rainLP); rainSnd.play();
      // Regen aufs Auto (nachts, entspannend): leise "Tok"-Tropfen aufs Blechdach, feine Ticks auf der Scheibe
      rainRoof = new THREE.Audio(listener); rainRoof.setBuffer(mkCarRain()); rainRoof.setLoop(true); rainRoof.setVolume(0); rainRoof.play();
    }
    // im geschlossenen Auto: Regen draußen nur noch dumpf, Dach-Prasseln leise im Hintergrund – der Motor bleibt gut hörbar
    const inside = player.inCar || !!player.ride;
    rainLP.frequency.setTargetAtTime(inside ? 600 : 18000, AC.currentTime, .15);
    rainSnd.setVolume(k * (inside ? .16 : .35));
    rainRoof.setVolume(inside ? k * .32 : 0);
  }
}
// "Rain on a car at night": Stereo-Schleife aus weichem Rauschen, vielen leisen dumpfen Tropfen aufs Dach (ab und zu ein schwerer),
// hellen Ticks auf der Scheibe und langsamen Böen. Ende und Anfang werden überblendet -> nahtlose Schleife ohne Knacken.
function mkCarRain(dur = 6) {
  const sr = AC.sampleRate, n = Math.floor(sr * dur), m = Math.floor(sr * .08), b = AC.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const tmp = new Float32Array(n + m), drops = []; let brown = 0, hiss = 0;
    for (let i = 0; i < n + m; i++) {
      const t = i / sr, gust = .7 + .3 * Math.sin(2 * Math.PI * 2 * t / dur + ch * 1.7) * Math.sin(2 * Math.PI * 3 * t / dur);
      if (Math.random() < 140 * gust / sr) {
        const glass = Math.random() < .28, a = Math.pow(Math.random(), 2.6);
        drops.push(glass ? { f: rand(1800, 3600), a: a * .22, dec: rand(260, 420), s: i } : { f: rand(220, 720), a: a * (.5 + Math.random() * .5), dec: rand(55, 110), s: i });
      }
      let v = 0;
      for (let k = drops.length - 1; k >= 0; k--) {
        const q = drops[k], age = (i - q.s) / sr, env = q.a * Math.exp(-q.dec * age);
        if (env < .002) { drops.splice(k, 1); continue; }
        v += env * Math.sin(2 * Math.PI * q.f * age) + (age < .0015 ? (Math.random() * 2 - 1) * q.a * .45 : 0);
      }
      brown = (brown + (Math.random() * 2 - 1) * .02) * .998;            // tiefes, weiches Rauschen
      hiss += ((Math.random() * 2 - 1) - hiss) * .07;                     // leises Zischen
      tmp[i] = v * .5 + brown * .85 * gust + hiss * .05 * gust;
    }
    const d = b.getChannelData(ch);
    for (let j = 0; j < n; j++) d[j] = j < m ? tmp[j] * (j / m) + tmp[n + j] * (1 - j / m) : tmp[j];
  }
  return b;
}
let rainLP = null, rainRoof = null;
// ---------- Regen am Auto: Tropfen auf der Frontscheibe + automatische Scheibenwischer ----------
function buildRainFx(c, geo, ch, eye) {
  c.rainFx = null; if (!geo) return;
  geo.computeBoundingBox(); const b = geo.boundingBox, ctr = b.getCenter(V());
  // Ebene der Scheibe: quer = x, "hoch" = entlang der schrägen Scheibe, n = nach außen
  const right = V(1, 0, 0), up = V(0, b.max.y - b.min.y, b.min.z - b.max.z).normalize(), n = V().crossVectors(right, up);
  const p = geo.attributes.position, L = new Float32Array(p.count * 2); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < p.count; i++) { v1.fromBufferAttribute(p, i).sub(ctr); const lx = v1.dot(right), ly = v1.dot(up); L[i * 2] = lx; L[i * 2 + 1] = ly; x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); y0 = Math.min(y0, ly); y1 = Math.max(y1, ly); }
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (L[i * 2] - x0) / (x1 - x0); uv[i * 2 + 1] = (L[i * 2 + 1] - y0) / (y1 - y0); }
  const g = geo.clone(); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.translate(-n.x * .004, -n.y * .004, -n.z * .004);   // knapp innen vor dem Glas
  const [can, dg] = C(512, 320), tex = new THREE.CanvasTexture(can); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  mesh.renderOrder = 2; mesh.visible = false; ch.add(mesh);
  // Scheibenwischer: zwei Arme unten an der Scheibe, liegen in Ruhe waagrecht
  const wf = new THREE.Group(); wf.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n)); wf.position.copy(ctr).addScaledVector(n, .014); ch.add(wf);
  const W = x1 - x0, arm = M(0x111214, { roughness: .55, metalness: .4 }), rub = M(0x050505, { roughness: .9 });
  const wipers = [[x0 + W * .5, W * .47], [x0 + W * .97, W * .45]].map(([px, len]) => {
    const pv = new THREE.Group(); pv.position.set(px, y0 + .045, 0); wf.add(pv);
    box(len, .014, .01, arm, -len / 2, 0, 0, pv); box(len * .9, .022, .014, rub, -len * .52, 0, .007, pv);
    return { pv, px, py: y0 + .045, len, th: 0 };
  });
  c.rainFx = { mesh, tex, dg, x0, x1, y0, y1, drops: [], acc: 0, wipers, wipeT: 0, phase: -1, drawT: 0 };
}
function updRainFx(dt) {
  const R = pcar.rainFx; if (!R) return;
  const k = weather.k, near = player.inCar || headWorld.distanceTo(pcar.group.position) < 12;
  if (!near && !R.drops.length) { R.mesh.visible = false; return; }
  if (k > .05 && near) { R.acc += dt * 95 * k; while (R.acc > 1) { R.acc--; if (R.drops.length < 380) R.drops.push({ x: rand(R.x0, R.x1), y: rand(R.y0, R.y1), r: rand(1.1, 3.4) }); } }
  else if (R.drops.length) R.drops.splice(0, Math.max(1, Math.floor(R.drops.length * dt * .4)));   // trocknet ab
  const sp = Math.abs(pcar.speed);
  for (const d of R.drops) { if (d.r > 2.7) d.y -= dt * .05; if (sp > 8) d.y += dt * (sp - 8) * .012; }   // große laufen runter, Fahrtwind drückt hoch
  R.drops = R.drops.filter(d => d.y > R.y0 - .02 && d.y < R.y1 + .02);
  // bei Regen wischen die Wischer automatisch alle 2 Sekunden
  if (k > .25 && player.inCar) { R.wipeT -= dt; if (R.wipeT <= 0 && R.phase < 0) { R.phase = 0; R.wipeT = 2; } }
  if (R.phase >= 0) {
    R.phase = Math.min(1, R.phase + dt / 1.1);
    const th = Math.sin(R.phase * Math.PI) * 1.62;
    for (const w of R.wipers) {
      const a = Math.min(w.th, th), b = Math.max(w.th, th);
      R.drops = R.drops.filter(d => { const dx = d.x - w.px, dy = d.y - w.py, an = Math.atan2(dy, -dx); return !(Math.hypot(dx, dy) < w.len * 1.03 && an >= a - .04 && an <= b + .04); });
      w.th = th; w.pv.rotation.z = -th;
    }
    if (R.phase >= 1) { R.phase = -1; for (const w of R.wipers) { w.th = 0; w.pv.rotation.z = 0; } }
  }
  R.drawT -= dt;
  if (R.drawT <= 0) {
    R.drawT = 1 / 12; const g = R.dg, Wd = R.x1 - R.x0, Hd = R.y1 - R.y0; g.clearRect(0, 0, 512, 320);
    for (const d of R.drops) {
      const X = (d.x - R.x0) / Wd * 512, Y = (1 - (d.y - R.y0) / Hd) * 320;
      g.beginPath(); g.arc(X, Y, d.r, 0, 7); g.fillStyle = 'rgba(190,205,222,.32)'; g.fill();
      g.beginPath(); g.arc(X - d.r * .3, Y - d.r * .3, d.r * .35, 0, 7); g.fillStyle = 'rgba(255,255,255,.6)'; g.fill();
    }
    R.tex.needsUpdate = true;
  }
  R.mesh.visible = R.drops.length > 0;
}

// ===================================================================
// Intro beim Beitreten: aus dem Schwarz, Lichtsäule, Titel
// ===================================================================
const fadeFx = new THREE.Mesh(new THREE.SphereGeometry(.25, 16, 12), new THREE.MeshBasicMaterial({ color: 0, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false }));
fadeFx.renderOrder = 999; camera.add(fadeFx);
// Einblendungen (Hinweise, roter Rand, Vignette) nur im eigenen Sichtfeld – nicht im Handy-Video
const OVERLAY = 5; camera.layers.enable(OVERLAY); for (const o of [hud, deathFx, fadeFx, vignette]) o.layers.set(OVERLAY);
let intro = null;
function startIntro() {
  if (intro) return; intro = { t: 0 };
  fadeFx.material.opacity = 1;
  setTimeout(() => { joinBeam(V(headWorld.x, groundAt(headWorld.x, headWorld.z), headWorld.z)); msg('Willkommen in Stuttgart, ' + net.name, 4); }, 400);
}
function updIntro(dt) {
  if (!intro || intro.t > 4) return;
  intro.t += dt; fadeFx.material.opacity = 1 - smooth(.3, 3, intro.t); fadeFx.visible = fadeFx.material.opacity > .01;
}

// ===================================================================
// Missionen
// ===================================================================
const missionBeam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 220, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd21a, transparent: true, opacity: .3, depthWrite: false, side: THREE.DoubleSide }));
missionBeam.visible = false; scene.add(missionBeam);
const MISSIONS = [
  { id: 'berg', name: 'Bergrennen', desc: 'Fahr die Bergstraße hoch zum Fernsehturm', time: 150, reward: 500, targets: () => [[TVT.x, TVT.z]] },
  { id: 'kurier', name: 'Kurier', desc: 'Paket am Supermarkt holen, zum Park bringen', time: 160, reward: 350, targets: () => [POI.Supermarkt, POI.Park] },
  { id: 'raser', name: 'Autobahn-Raser', desc: 'Erreiche 200 km/h', time: 120, reward: 400, speed: 200 },
  { id: 'boom', name: 'Zerstörer', desc: 'Jag das markierte Auto in die Luft', time: 90, reward: 350, car: true },
  { id: 'a81', name: 'Nach Heilbronn', desc: 'Fahr die A81 bis zum Kartenrand', time: 180, reward: 450, targets: () => [[HX, -2050]] },
];
let mission = null;
function startMission(id) {
  const d = MISSIONS.find(m => m.id === id); if (!d) return;
  mission = { d, t0: time, step: 0, pts: d.targets ? d.targets() : [], car: null, lastSec: -1 };
  if (d.car) mission.car = pick(parked.filter(c => !c.dead && c.group.position.distanceTo(headWorld) < 400)) || pick(parked.filter(c => !c.dead));
  msg('Mission: ' + d.desc, 4); playAt(SND.whoosh, headWorld, .8);
}
function updMission(dt) {
  if (!mission) { missionBeam.visible = false; return; }
  const d = mission.d, left = d.time - (time - mission.t0);
  let tgt = null, done = false;
  if (mission.pts.length) { tgt = mission.pts[mission.step]; if (Math.hypot(tgt[0] - headWorld.x, tgt[1] - headWorld.z) < 22) { mission.step++; if (mission.step >= mission.pts.length) done = true; else msg('Weiter zum nächsten Ziel!', 2); } }
  if (d.speed && Math.abs(pcar.speed) * 3.6 >= d.speed && player.inCar) done = true;
  if (mission.car) { const p = mission.car.group.position; tgt = [p.x, p.z]; if (mission.car.dead) done = true; }
  if (tgt) { missionBeam.visible = true; missionBeam.position.set(tgt[0], groundAt(tgt[0], tgt[1]) + 110, tgt[1]); }
  if (done) { money += d.reward; msg(`Mission geschafft! +${d.reward} €  (Konto: ${money} €)`, 5); playAt(SND.whoosh, headWorld, 1); mission = null; return; }
  if (left <= 0) { msg('Mission gescheitert – Zeit abgelaufen', 4); mission = null; return; }
  const s = Math.ceil(left); if (s !== mission.lastSec && (s <= 10 || s % 5 === 0)) { mission.lastSec = s; msg(`${d.name}: noch ${s} s${d.speed ? ' · ' + Math.round(Math.abs(pcar.speed) * 3.6) + ' km/h' : ''}`, 1.2); }
}

// ===================================================================
// Zufalls-Mission: ein NPC dreht durch und schießt auf Autos und Leute.
// Er wird rot markiert, eine rote Blase + Lichtsäule zeigt, wo er ist. Wer ihn erledigt, bekommt die Belohnung.
// Der Host entscheidet (gleich für alle).
// ===================================================================
const VIL_REWARD = 600;
const vil = { i: -1, ped: null, t0: 0, shotT: 0, nextT: rand(1500, 2400), mats: [] };   // selten: frühestens nach ~25–40 Minuten
const vilBeam = new THREE.Mesh(new THREE.CylinderGeometry(.7, .7, 140, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: .32, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
const vilBubble = new THREE.Mesh(new THREE.SphereGeometry(.5, 20, 14), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending }));
vilBeam.visible = vilBubble.visible = false; scene.add(vilBeam, vilBubble);
let vilKillByMe = false;
function setVillain(i) {
  if (vil.i === i) return;
  for (const { m, e, k } of vil.mats) { m.emissive.copy(e); m.emissiveIntensity = k; }   // alte Markierung weg
  vil.mats = []; vil.ped = null; vil.i = -1; vilBeam.visible = vilBubble.visible = false;
  if (i < 0) return;
  const p = peds[i]; if (!p || !p.alive) return;
  vil.i = i; vil.ped = p; vil.t0 = time; vil.shotT = 3;
  p.vis.traverse(o => { if (o.isMesh && o.material?.emissive) { const m = o.material; vil.mats.push({ m, e: m.emissive.clone(), k: m.emissiveIntensity }); m.emissive.set(0xff1010); m.emissiveIntensity = .8; } });
  vilBeam.visible = vilBubble.visible = true;
  carAlert('Ein NPC greift andere an!', 'Mission: Deine Aufgabe ist, ihn zu töten. Er ist rot markiert – folge der roten Blase. Belohnung: ' + VIL_REWARD + ' €.', '#8e1b1b', 'NPC-Angriff');
  msg('MISSION: Ein NPC greift andere an – töte ihn! (rot markiert)', 6);
}
function endVillain(mine) {
  if (vil.i < 0) return;
  setVillain(-1);
  if (mine) { money += VIL_REWARD; msg(`Angreifer erledigt! +${VIL_REWARD} €  (Konto: ${money} €)`, 5); playAt(SND.whoosh, headWorld, 1); }
  else msg('Der Angreifer wurde erledigt', 3);
}
function updVillain(dt) {
  const host = amHost();
  if (vil.i < 0) {
    if (!host) return;
    vil.nextT -= dt;
    if (vil.nextT <= 0) {
      vil.nextT = rand(1800, 3000);                                     // danach erst wieder in 30–50 Minuten
      const cand = peds.map((p, i) => [p, i]).filter(([p]) => { const d = p.root.position.distanceTo(headWorld); return p.alive && d > 40 && d < 260; });
      if (cand.length) { const [, i] = pick(cand); setVillain(i); share('vil', { i }); }
    }
    return;
  }
  const p = vil.ped; if (!p || !p.alive) return endVillain(false);
  const q = p.root.position;
  vilBubble.position.set(q.x, q.y + 2.45 + Math.sin(time * 3) * .08, q.z); vilBubble.scale.setScalar(1 + Math.sin(time * 6) * .12);
  vilBeam.position.set(q.x, q.y + 72, q.z);
  if (time - vil.t0 > 300) { if (host) share('vil', { i: -1 }); setVillain(-1); msg('Der Angreifer ist entkommen', 3); return; }
  if (host) { vil.shotT -= dt; if (vil.shotT <= 0) { vil.shotT = rand(1.4, 2.8); villainShoot(p); } }
}
// Der Angreifer schießt auf Autos (die irgendwann brennen) und Fußgänger in der Nähe
function villainShoot(p) {
  const o = p.root.position.clone(); o.y += 1.35;
  const cars = allNpc.filter(c => !c.dead && c.group.position.distanceTo(o) < 90);
  const ps = peds.filter(q => q !== p && q.alive && q.root.position.distanceTo(o) < 60);
  let e;
  if (cars.length && (Math.random() < .7 || !ps.length)) { const c = pick(cars); e = c.group.position.clone(); e.y += .9; damageCarNet(c, 1, e); }
  else if (ps.length) { const q = pick(ps); e = q.root.position.clone(); e.y += 1.2; killPedNet(q, V(e.x - o.x, 0, e.z - o.z).normalize()); }
  else return;
  playAt(SND.gun, o, 1.6, 12); showTracer(o, e); sparks(e, 6); scarePeds(o, 40);
  share('shot', { o: o.toArray().map(r2), e: e.toArray().map(r2), h: 1 });
}

// ===================================================================
// Admin (Spielername "Gabriel"): Tornado, Tsunami, NPC-Angriff, Gebäudebrand, Regen – für alle Spieler
// ===================================================================
const isAdmin = () => /^gabriel$/i.test((net.name || '').trim());
const flying = [];                                                      // durch die Luft fliegende Autos / Leute
const disaster = { tornado: null, tsunami: null };
const spray = new PSys(500, 7, false, true, true);                     // weiße Gischt (Tsunami)
let lpW = 0, lpW2 = 0;
SND.wind = mkBuf(4, (t, r) => { lpW += (r - lpW) * .03; lpW2 += (lpW - lpW2) * .06; return lpW2 * 7 * (1 + .35 * Math.sin(t * Math.PI * 1.5)) + lpW * .6; });   // tiefes Brausen (Schleife)
// Auto oder Mensch wird weggeschleudert (dir = Schubrichtung beim Tsunami, sonst Wirbel um cx/cz)
function tossCar(c, cx, cz, dir) {
  if (c.dead || c.flying) return;
  c.home = c.home || { p: c.group.position.clone(), r: c.group.rotation.clone() };
  c.dead = true; c.flying = true; c.speed = 0;
  const p = c.group.position, ax = p.x - cx, az = p.z - cz, l = Math.hypot(ax, az) || 1;
  const vel = dir ? V(dir.x * rand(13, 19), rand(3, 7), dir.z * rand(13, 19))
    : V(-az / l * rand(10, 16) + ax / l * rand(4, 9), rand(15, 25), ax / l * rand(10, 16) + az / l * rand(4, 9));
  flying.push({ o: c.group, vel, spin: V(rand(-3, 3), rand(-4, 4), rand(-3, 3)), car: c, t: 0, b: 0 });
  playAt(SND.crash, p, 1.2, 10);
}
function tossPed(p, cx, cz, dir) {
  if (!p.alive) return;
  killPed(p, null); p.flying = true;
  const q = p.root.position, ax = q.x - cx, az = q.z - cz, l = Math.hypot(ax, az) || 1;
  const vel = dir ? V(dir.x * rand(9, 14), rand(2, 5), dir.z * rand(9, 14)) : V(-az / l * 9 + ax / l * 5, rand(12, 20), ax / l * 9 + az / l * 5);
  flying.push({ o: p.root, vel, spin: V(rand(-6, 6), rand(-6, 6), rand(-6, 6)), ped: p, t: 0, b: 0 });
}
// gelandetes Auto: bleibt als Wrack liegen (auf Rad, Seite oder Dach) und taucht nach einer Weile heil wieder auf
function wreckCar(c) {
  const q = Math.PI / 2, g = c.group;
  g.rotation.x = Math.round(g.rotation.x / q) * q; g.rotation.z = Math.round(g.rotation.z / q) * q;
  const up = V(0, 1, 0).applyEuler(g.rotation), roof = up.y < -.5, side = Math.abs(up.y) <= .5;   // liegt es auf dem Dach / auf der Seite?
  g.position.y = surfaceAt(g.position.x, g.position.z) + (side ? c.half.x : roof ? c.half.y : 0);
  c.bodyMat.color.multiplyScalar(.7); c.glassMat.visible = false;
  c.flying = false; c.wrecked = true; c.wreckT = 0;
}
function reviveCar(c) {
  c.wrecked = false; c.dead = false; c.flying = false;
  if (c.fl?.orig?.[0]) c.bodyMat.color.copy(c.fl.orig[0]); c.glassMat.visible = true;
  const h = c.home; c.home = null;
  if (h) { c.group.position.copy(h.p); c.group.rotation.copy(h.r); } else c.group.rotation.set(0, c.group.rotation.y, 0);
}
function updFlying(dt) {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i], o = f.o; f.t += dt;
    f.vel.y -= 9.8 * dt;
    o.position.addScaledVector(f.vel, dt);
    o.rotation.x += f.spin.x * dt; o.rotation.y += f.spin.y * dt; o.rotation.z += f.spin.z * dt;
    const gy = surfaceAt(o.position.x, o.position.z);
    if (o.position.y <= gy && f.vel.y < 0) {
      o.position.y = gy;
      if (f.vel.y < -5 && f.b < 2) { f.vel.y *= -.3; f.vel.x *= .5; f.vel.z *= .5; f.spin.multiplyScalar(.5); f.b++; if (f.car) playAt(SND.crash, o.position, 1.4, 12); continue; }
      if (f.car) wreckCar(f.car);
      if (f.ped) { f.ped.flying = false; o.rotation.set(-Math.PI / 2, o.rotation.y, 0); o.position.y = gy + .15; }
      flying.splice(i, 1);
    } else if (f.t > 25) { if (f.car) wreckCar(f.car); if (f.ped) f.ped.flying = false; flying.splice(i, 1); }
  }
  // Wracks verschwinden nach 2 Minuten (wenn keiner hinschaut) und fahren wieder heil herum
  for (const c of allNpc) if (c.wrecked && (c.wreckT += dt) > 120 && c.group.position.distanceTo(headWorld) > 70) reviveCar(c);
}

// ---------- Tornado: zieht durch die Stadt, wirbelt Autos und Leute durch die Luft ----------
function buildTornado() {
  const [c, g] = C(256, 512);
  g.fillStyle = 'rgba(120,114,104,.45)'; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 1100; i++) { const v = rand(60, 165) | 0; g.strokeStyle = `rgba(${v},${v - 6},${v - 14},${rand(.05, .3)})`; g.lineWidth = rand(2, 9); const x = rand(-40, 256), y = rand(0, 512); g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(30, 140), y + rand(-14, 14)); g.stroke(); }
  const tex = T(c); tex.repeat.set(3, 1);
  const prof = [[3.5, 0], [5, 10], [7, 35], [10, 70], [16, 110], [26, 160], [42, 210], [75, 255], [125, 278]].map(([r, y]) => new THREE.Vector2(r, y));
  const mat = (col, op) => new THREE.MeshBasicMaterial({ map: tex, color: col, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false });
  const grp = new THREE.Group(), outer = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), mat(0x9a948c, .8));
  const inner = new THREE.Mesh(new THREE.LatheGeometry(prof.map(v => new THREE.Vector2(v.x * .62, v.y)), 32), mat(0x5e5952, .9));
  const cloud = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12), new THREE.MeshBasicMaterial({ color: 0x3a3d43, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false }));
  cloud.scale.set(330, 34, 330); cloud.position.y = 292;
  grp.add(outer, inner, cloud); grp.visible = false; scene.add(grp);
  const snd = new THREE.PositionalAudio(listener); snd.setBuffer(SND.wind); snd.setLoop(true); snd.setRefDistance(45); snd.setRolloffFactor(.9); snd.setVolume(0); grp.add(snd);
  return { grp, outer, inner, tex, snd };
}
let tornadoFx = null;
// ef = 5: der stärkste Tornado (EF5) – riesig, saugt Spieler und ihre Autos ein, wirbelt sie hoch und schleudert sie weg
function makeTornadoEv(ef = 0, c = headWorld) {
  const d = ef ? 300 : 260, a = rand(0, Math.PI * 2), x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
  const tx = c.x + rand(-20, 20), tz = c.z + rand(-20, 20), l = Math.hypot(tx - x, tz - z);
  return { x: r2(x), z: r2(z), dx: r2((tx - x) / l), dz: r2((tz - z) / l), len: ef ? 760 : 520, sp: ef ? 6.5 : 7.5, seed: r2(rand(0, 9)), ef };
}
function startTornado(ev) {
  tornadoFx ||= buildTornado();
  disaster.tornado = { ...ev, t: 0, hitCar: false, hitPark: false };
  tornadoFx.grp.visible = true;
  if (AC.state === 'running' && !tornadoFx.snd.isPlaying) tornadoFx.snd.play();
  if (ev.ef) { carAlert('EF5-TORNADO!', 'Der stärkste Tornado zieht durch Stuttgart und saugt alles ein – auch Menschen und Autos. Sofort in Deckung!', '#5c0010', 'EF5-Tornado'); msg('EF5-TORNADO! Er saugt alles ein – lauf!', 6); }
  else { carAlert('Tornado-Warnung!', 'Ein Tornado zieht durch Stuttgart. Geh in ein Gebäude und halte dich fern!', '#6b4e16', 'Tornado'); msg('TORNADO! Geh in Deckung!', 5); }
  if (weather.target === 0) weather.target = 1;                           // dazu kommt ein Unwetter
}
function endTornado() {
  disaster.tornado = null;
  if (tornadoFx) { tornadoFx.grp.visible = false; try { tornadoFx.snd.stop(); } catch (e) { } }
}
function updTornado(dt) {
  const T = disaster.tornado; if (!T) return;
  T.t += dt; const dur = T.len / T.sp; if (T.t > dur) return endTornado();
  const s = T.t * T.sp, wob = Math.sin(T.t * .35 + T.seed) * 18;
  const x = T.x + T.dx * s - T.dz * wob, z = T.z + T.dz * s + T.dx * wob, gy = groundAt(x, z);
  T.cx = x; T.cz = z;
  const k = Math.min(1, T.t / 4, (dur - T.t) / 4), F = tornadoFx, S = T.ef ? 1.8 : 1;
  F.grp.position.set(x, gy, z); F.grp.scale.set((.2 + .8 * k) * S, (.3 + .7 * k) * (T.ef ? 1.25 : 1), (.2 + .8 * k) * S);
  F.outer.rotation.y += dt * 2.4 * (T.ef ? 1.4 : 1); F.inner.rotation.y -= dt * 3.4 * (T.ef ? 1.4 : 1); F.tex.offset.x -= dt * .5; F.grp.rotation.z = Math.sin(T.t * .6) * .05;
  F.snd.setVolume((T.ef ? 5 : 3) * k);
  // Staub + Trümmer am Boden
  for (let i = 0; i < 40 * S * dt; i++) { const a = rand(0, 7), r = rand(4, 16) * S; smoke.spawn(x + Math.cos(a) * r, gy + rand(0, 3), z + Math.sin(a) * r, -Math.sin(a) * 9 + Math.cos(a) * 3, rand(3, 9), Math.cos(a) * 9 + Math.sin(a) * 3, rand(2, 4)); }
  if (Math.random() < dt * 3 * S) spawnDebris(V(x + rand(-8, 8), gy + 1, z + rand(-8, 8)), pick([0x6b5a45, 0x8a8a8a, 0x4a3b2b]), 3, .25, 9);
  if (k < .5) return;
  const d2 = (px, pz) => (px - x) ** 2 + (pz - z) ** 2;
  for (const c of allNpc) if (!c.dead && d2(c.group.position.x, c.group.position.z) < (20 * S) ** 2) tossCar(c, x, z);
  for (const p of peds) if (p.alive && d2(p.root.position.x, p.root.position.z) < (13 * S) ** 2) tossPed(p, x, z);
  if (amHost()) for (const pr of props) if (!pr.broken && d2(pr.mesh.position.x, pr.mesh.position.z) < (12 * S) ** 2) breakPropNet(pr);
  const dh = Math.sqrt(d2(headWorld.x, headWorld.z));
  if (T.ef) {                                                           // EF5: saugt ein, wirbelt hoch, schleudert weg
    const ax = x - headWorld.x, az = z - headWorld.z, l = Math.hypot(ax, az) || 1, pull = (1 - dh / 60) * 13 + 1.5;
    if (player.inCar && !pcar.fly && !pcar.air && vehicle.type !== 'scooter' && dh < 50) {
      pcar.group.position.x += (ax / l * pull - az / l * 5) * dt; pcar.group.position.z += (az / l * pull + ax / l * 5) * dt; pcar.speed *= 1 - Math.min(1, dt * 2);
      if (dh < 14) { pcar.fly = { t: 0, ang: Math.atan2(-az, -ax), r: dh, h: 0 }; msg('Der Tornado hat dein Auto erfasst!', 2.5); }
    } else if (!seated() && !player.dead && !player.fly && dh < 60) {
      dolly.position.x += (ax / l * pull - az / l * 5) * dt; dolly.position.z += (az / l * pull + ax / l * 5) * dt;
      if (dh < 11) { player.fly = { t: 0, ang: Math.atan2(-az, -ax), r: dh, h: headWorld.y - groundAt(headWorld.x, headWorld.z), phase: 'up' }; msg('Der Tornado saugt dich ein!', 2.5); }
    }
    if (!player.inCar && !pcar.fly && !pcar.air && !pcar.dead && vehicle.type !== 'scooter' && d2(pcar.group.position.x, pcar.group.position.z) < 14 * 14) pcar.fly = { t: 0, ang: Math.atan2(pcar.group.position.z - z, pcar.group.position.x - x), r: 12, h: 0 };   // dein geparktes Auto fliegt auch
    return;
  }
  if (player.inCar && dh < 18) {                                         // im Auto: wird zur Seite geschoben + Schaden
    const ax = pcar.group.position.x - x, az = pcar.group.position.z - z, l = Math.hypot(ax, az) || 1;
    pcar.group.position.x += (-az / l * 9 + ax / l * 4) * dt; pcar.group.position.z += (ax / l * 9 + az / l * 4) * dt;
    if (!T.hitCar) { T.hitCar = true; crash(17, V(x, pcar.group.position.y + .5, z)); }
  } else if (!seated() && !player.dead && dh < 9) die('Vom Tornado erfasst');
  if (!player.inCar && !T.hitPark && !pcar.dead && vehicle.type !== 'scooter' && d2(pcar.group.position.x, pcar.group.position.z) < 18 * 18) { T.hitPark = true; carDamage(pcar, 26, V(x, 1, z)); }
}

// ---------- Tsunami: riesige Welle rollt durch die Stadt, danach steht das Wasser ----------
function buildWave() {
  // Querschnitt (z = Laufrichtung, y = Höhe): flacher Rücken, steile Front, überhängende Krone
  const prof = [[-80, 0], [-48, 7], [-24, 16], [-10, 22.5], [0, 25], [5.5, 23.5], [7, 19.5], [3.5, 14], [1.5, 7], [3, 0]];
  const W = 1900, SEG = 80, pos = [], col = [], idx = [], cDeep = new THREE.Color(0x123f4d), cMid = new THREE.Color(0x2b7a8c), cFoam = new THREE.Color(0xf2f7f7), cc = new THREE.Color();
  for (let i = 0; i <= SEG; i++) {
    const x = -W / 2 + W * i / SEG;
    prof.forEach(([z, y], j) => {
      pos.push(x, y + Math.sin(i * 1.7) * .9 * (y / 25), z + Math.sin(i * .9) * 1.5 * (y / 25));
      if (j >= 3 && j <= 6) cc.copy(cFoam).lerp(cMid, j === 3 || j === 6 ? .35 : 0); else cc.lerpColors(cDeep, cMid, y / 25);   // Krone weiß schäumend
      col.push(cc.r, cc.g, cc.b);
    });
  }
  const P = prof.length;
  for (let i = 0; i < SEG; i++) for (let j = 0; j < P - 1; j++) { const a = i * P + j, b = a + P; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const wave = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .18, metalness: .1, transparent: true, opacity: .93, side: THREE.DoubleSide }));
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1c4652, roughness: .3, metalness: 0, transparent: true, opacity: .9, envMapIntensity: .6 }));
  wave.frustumCulled = water.frustumCulled = false; wave.visible = water.visible = false; scene.add(wave, water);
  const snd = new THREE.PositionalAudio(listener); snd.setBuffer(SND.wind); snd.setLoop(true); snd.setRefDistance(60); snd.setRolloffFactor(.7); snd.setPlaybackRate(.55); snd.setVolume(0);
  const so = new THREE.Object3D(); so.add(snd); scene.add(so);
  return { wave, water, snd, so };
}
let tsunamiFx = null;
const FLOOD = 1.0;                                                     // so hoch steht danach das Wasser (m)
function makeTsunamiEv() { const a = pick([0, 1, 2, 3]) * Math.PI / 2; return { dx: r2(Math.sin(a)), dz: r2(Math.cos(a)), sp: 20 }; }
function startTsunami(ev) {
  tsunamiFx ||= buildWave();
  disaster.tsunami = { ...ev, t: 0, s0: -620, swept: 0, hitMe: false };
  const F = tsunamiFx; F.wave.visible = F.water.visible = true;
  F.wave.rotation.y = F.water.rotation.y = Math.atan2(ev.dx, ev.dz);
  if (AC.state === 'running' && !F.snd.isPlaying) F.snd.play();
  carAlert('Tsunami-Warnung!', 'Eine riesige Welle rollt auf die Stadt zu. Sofort auf einen Berg oder in die Höhe!', '#0d4f6b', 'Tsunami');
  msg('TSUNAMI! Sofort nach oben – auf den Berg!', 6);
}
function endTsunami() {
  disaster.tsunami = null;
  if (tsunamiFx) { tsunamiFx.wave.visible = tsunamiFx.water.visible = false; try { tsunamiFx.snd.stop(); } catch (e) { } }
}
// aktueller Wasserstand an einer Stelle (für Spieler-Bewegung / Anzeige)
function floodAt(x, z) { const S = disaster.tsunami; if (!S || !tsunamiFx) return -1; return x * S.dx + z * S.dz < S.front ? S.level : -1; }
function updTsunami(dt) {
  const S = disaster.tsunami; if (!S) return;
  S.t += dt; const F = tsunamiFx, dir = V(S.dx, 0, S.dz);
  const front = S.s0 + S.sp * S.t; S.front = front;
  const passed = front > 640, recede = passed ? (S.t - 1280 / S.sp) : 0;
  S.level = FLOOD * clamp(1 - recede / 40, 0, 1) * Math.min(1, (S.t) / 6);
  if (passed && S.level <= 0) return endTsunami();
  // Welle + Wasserfläche dahinter
  F.wave.visible = !passed; F.wave.position.set(dir.x * front, 0, dir.z * front);
  const back = S.s0 - 400, len = Math.max(1, front - back - 30);
  F.water.position.set(dir.x * (back + len / 2), S.level, dir.z * (back + len / 2)); F.water.scale.set(2200, 1, len);
  // Ton an der Stelle der Welle, die mir am nächsten ist
  const hd = headWorld.x * S.dx + headWorld.z * S.dz;
  F.so.position.set(headWorld.x + dir.x * (front - hd), 2, headWorld.z + dir.z * (front - hd)); F.snd.setVolume(passed ? 0 : 4);
  if (passed) return;
  // Gischt an der Krone (nur in meiner Nähe)
  for (let i = 0; i < 90 * dt; i++) { const lat = rand(-80, 80), px = headWorld.x + dir.z * lat + dir.x * (front - hd + 4), pz = headWorld.z - dir.x * lat + dir.z * (front - hd + 4); spray.spawn(px, rand(19, 25), pz, dir.x * rand(14, 22), rand(0, 4), dir.z * rand(14, 22), rand(1.2, 2.6)); }
  // Was die Front erreicht, wird mitgerissen
  const hit = p => { const d = p.x * S.dx + p.z * S.dz; return d < front + 2 && d > front - 6; };
  for (const c of allNpc) if (!c.dead && hit(c.group.position) && groundAt(c.group.position.x, c.group.position.z) < 12) tossCar(c, 0, 0, dir);
  for (const p of peds) if (p.alive && hit(p.root.position)) tossPed(p, 0, 0, dir);
  if (amHost()) for (const pr of props) if (!pr.broken && hit(pr.mesh.position)) breakPropNet(pr);
  const high = headWorld.y - 1.7 > 22;                                  // auf dem Berg / weit oben: sicher
  if (!high && !S.hitMe && hit(headWorld)) {
    S.hitMe = true;
    if (player.inCar) { S.swept = 3.5; crash(18, V(headWorld.x - dir.x * 3, pcar.group.position.y + .5, headWorld.z - dir.z * 3)); }
    else if (!player.dead) die('Vom Tsunami erfasst');
  }
  if (S.swept > 0 && player.inCar) { S.swept -= dt; pcar.group.position.addScaledVector(dir, 16 * (S.swept / 3.5) * dt); }
}
// ---------- Handy im Auto, du bist weg: Anrufer hört Sturm/Regen/Krachen/Leute am Handy, aber nicht mehr dich ----------
function phoneLoop(key, buf, vol) {
  if (!buf) return; let o = phoneAud[key];
  if (!o) { if (vol <= 0) return; const s = AC.createBufferSource(), g = AC.createGain(); s.buffer = buf; s.loop = true; g.gain.value = 0; s.connect(g); g.connect(phoneBusNode()); s.start(); o = phoneAud[key] = { s, g }; }
  o.g.gain.setTargetAtTime(Math.max(0, vol), AC.currentTime, .2);
}
function updPhoneAudio() {
  if (AC.state !== 'running') return;
  phoneG.getWorldPosition(phoneAud.pos);
  const away = phone.call?.state === 'active' && !!amb.dest && phone.where === 'holder' && phoneAud.pos.distanceTo(headWorld) > 2.5;
  if (away !== phoneAud.away) {
    phoneAud.away = away; const t = AC.currentTime;
    amb.micGain?.gain.setTargetAtTime(away ? 0 : 1, t, .05); amb.gain?.gain.setTargetAtTime(away ? 0 : .7, t, .05); amb.phoneGain?.gain.setTargetAtTime(away ? 1 : 0, t, .05);
    if (away) msg('Dein Handy liegt im Auto – der Anrufer hört nur, was dort los ist', 3);
  }
  const T = disaster.tornado, k = away ? 1 : 0;
  phoneLoop('wind', SND.wind, k * (T && T.cx !== undefined ? clamp(1 - Math.hypot(phoneAud.pos.x - T.cx, phoneAud.pos.z - T.cz) / 260, 0, 1) * (T.ef ? 2 : 1.2) : 0));
  phoneLoop('rain', rainRoof?.buffer, k * weather.k * .5);
  for (const p of net.players.values()) {                               // Stimmen von Leuten in der Nähe des Handys (nicht der Anrufer selbst)
    if (!p.pa?.source || p.id === phone.call?.id) continue;
    if (!p.phoneTap) { p.phoneTap = AC.createGain(); p.phoneTap.gain.value = 0; p.pa.source.connect(p.phoneTap); p.phoneTap.connect(phoneBusNode()); }
    p.phoneTap.gain.setTargetAtTime(k * Math.max(0, 1 - p.headM.getWorldPosition(v1).distanceTo(phoneAud.pos) / 18) * .9, AC.currentTime, .1);
  }
}
// ---------- EF5 zerschmettert Autos: Dach/Seiten eingedrückt, Karosserie schief, Scheiben weg, Türen reißen ab ----------
function addDent(c, q, d, s) {
  const dent = { q: [r2(q.x), r2(q.y), r2(q.z)], d: [r2(d.x), r2(d.z), r2(d.y)], s: r2(s) };
  applyDent(c.chassis, c.group, dent); c.dents ||= []; if (c.dents.length < 12) c.dents.push(dent);
}
function ripDoor(c, i) {
  const d = c.doors[i]; if (!d || !d.pivot.visible) return;
  const D = c.dmg || (c.dmg = { hl: 0, tl: 0, ws: 0, wb: 0, all: 0 }); D.off = (D.off || 0) | (1 << i);
  d.pivot.updateMatrixWorld(true); const cl = d.pivot.clone(true); d.pivot.getWorldPosition(cl.position); d.pivot.getWorldQuaternion(cl.quaternion); scene.add(cl);
  d.pivot.visible = false; c.junk ||= []; c.junk.push(cl);
  flying.push({ o: cl, vel: V(rand(-14, 14), rand(6, 14), rand(-14, 14)), spin: V(rand(-8, 8), rand(-8, 8), rand(-8, 8)), t: 0, b: 0 });
  playAt(SND.crash, cl.position, 1.4, 10);
}
function tornadoHit(c) {
  if (!c.chassis || c.chassis === c.vis) return;
  const h = c.half, roof = Math.random() < .35, a = rand(0, Math.PI * 2);
  if (roof) addDent(c, V(rand(-h.x, h.x) * .6, h.y - .05, rand(-h.z, h.z) * .4), V(0, -1, 0), rand(.6, 1));   // Dach eingedrückt
  else { const dx = Math.sin(a), dz = Math.cos(a), s = Math.min(Math.abs(h.x / (dx || 1e-6)), Math.abs(h.z / (dz || 1e-6))); addDent(c, V(dx * s, rand(.4, .9), dz * s), V(dx, rand(-.3, .2), dz), rand(.7, 1)); }
  const D = c.dmg || (c.dmg = { hl: 0, tl: 0, ws: 0, wb: 0, all: 0 }), wp = c.group.position.clone();
  if (!D.all) { D.all = 1; D.hl = 1; D.tl = 1; glassNet(c, wp); if (c.headMat) c.headMat.emissiveIntensity = 0; if (c.brakeMat) c.brakeMat.emissiveIntensity = 0; playAt(SND.glass, wp, 1.5, 6); }
  c.bend = { x: clamp((c.bend?.x || 0) + rand(-.035, .035), -.1, .1), z: clamp((c.bend?.z || 0) + rand(-.05, .05), -.14, .14) };   // Karosserie wird schief
  if (Math.random() < .4) ripDoor(c, Math.floor(Math.random() * c.doors.length));
  // Dashcam reißt ab und fliegt oft durch die kaputten Scheiben aus dem Auto
  if (c === pcar && dash.body && !dash.out && !dash.held) {
    if (!dash.loose) dashFly(20, c.group.localToWorld(V(rand(-1, 1), .8, rand(-1, 1))));
    else dash.vel.add(V(rand(-6, 6), rand(2, 7), rand(-6, 6)));
    if (D.all && Math.random() < .45) dashOut();
  }
  c.hits = (c.hits || 0) + 1; if (c.hits >= 2 && !c.totaled) { c.totaled = true; D.tot = 1; }
  playAt(SND.crash, wp, 1.6, 10); if (player.inCar) hands.forEach(h => haptic(h, 1, 200));
}
// aus dem Auto geschleudert: du fliegst und überschlägst dich
function ejectPlayer(vel) {
  if (player.inCar) { player.inCar = false; for (const h of hands) if (h.held?.type === 'wheel') h.held = null; }
  if (player.ride) player.ride = null;
  player.fly = { phase: 'eject', t: 0, vel, spin: (Math.random() < .5 ? -1 : 1) * rand(5, 7.5), rot: 0, roll: rand(-.6, .6), yaw: dolly.rotation.y };
  msg('Du wirst aus dem Auto geschleudert!', 2.5); hands.forEach(h => haptic(h, 1, 300)); playAt(SND.glass, headWorld, 1.2, 4);
}
// Spieler im EF5-Tornado: kreist im Trichter nach oben (bis 70 m), wird dann weggeschleudert und landet hart
function updPlayerFly(dt) {
  const F = player.fly; if (!F) return;
  if (player.dead || seated()) { player.fly = null; dolly.rotation.x = dolly.rotation.z = 0; return; }
  const T = disaster.tornado, hp = camera.getWorldPosition(v1).clone(); F.t += dt;
  let tx, ty, tz;
  if (F.phase === 'up') {
    if (T) { F.cx = T.cx; F.cz = T.cz; }
    F.ang += dt * 2.3; F.r += (8 - F.r) * Math.min(1, dt * 1.5); F.h = Math.min(70, F.h + dt * 13);
    tx = F.cx + Math.cos(F.ang) * F.r; tz = F.cz + Math.sin(F.ang) * F.r; ty = groundAt(F.cx, F.cz) + F.h;
    if (F.t > 5.5 || !T) {                                              // rausgeschleudert: tangential + nach außen + hoch
      F.phase = 'throw'; F.vel = V(-Math.sin(F.ang) * 18 + Math.cos(F.ang) * 10, 12, Math.cos(F.ang) * 18 + Math.sin(F.ang) * 10);
      msg('Du wirst weggeschleudert!', 2); hands.forEach(h => haptic(h, .8, 200));
    }
    if (Math.random() < dt * 4) hands.forEach(h => haptic(h, .4, 60));
  } else {
    F.vel.y -= 9.8 * dt; tx = hp.x + F.vel.x * dt; tz = hp.z + F.vel.z * dt; ty = hp.y + F.vel.y * dt;
    const gy = surfaceAt(tx, tz) + 1.6;
    if (F.phase === 'eject') F.rot += F.spin * dt;                       // überschlägt sich (360°)
    if (ty <= gy) {                                                     // Landung
      ty = gy; const v = -F.vel.y; player.fly = null;
      player.hp -= clamp(v * 1.5, 10, 75); hurt = 1; lastHurt = time; hands.forEach(h => haptic(h, 1, 300)); playAt(SND.hit, V(tx, gy, tz), 1.6);
      if (player.hp <= 0) die('Vom Tornado weggeschleudert'); else msg('Hart gelandet! Noch ' + Math.round(player.hp) + ' HP', 3);
    }
  }
  // Drehung der Welt um den Kopf (Überschlag) – nach der Landung wieder aufrecht
  if (F.phase === 'eject') {
    dolly.rotation.order = 'YXZ';
    if (player.fly) dolly.rotation.set(F.rot, F.yaw, F.rot * F.roll); else dolly.rotation.set(0, F.yaw, 0);
    dolly.updateMatrixWorld(true); camera.getWorldPosition(hp);
  }
  dolly.position.x += tx - hp.x; dolly.position.y += ty - hp.y; dolly.position.z += tz - hp.z;
  if (!player.fly) walk(0, 0, 0, dt);                                     // nicht in einer Wand landen
  vigTarget = F.phase === 'eject' ? .8 : .55;                           // Komfort-Rand gegen Übelkeit
}
// Auto im EF5-Tornado: kreist hoch und dreht sich, dann wird es weggeschleudert (Landung = normale Flugphysik + Schaden)
function carFlight(c, dt) {
  const F = c.fly, T = disaster.tornado, g = c.group; F.t += dt;
  if (T) { F.cx = T.cx; F.cz = T.cz; }
  F.ang += dt * 1.9; F.r += (9 - F.r) * Math.min(1, dt * 1.5); F.h = Math.min(48, F.h + dt * 11);
  g.position.set(F.cx + Math.cos(F.ang) * F.r, groundAt(F.cx, F.cz) + F.h, F.cz + Math.sin(F.ang) * F.r);
  c.heading += dt * 3.2; c.slS = Math.sin(F.t * 2.1) * .5; c.sdS = Math.cos(F.t * 1.6) * .6; c.speed = 0; c.yawRate = 3.2;
  g.rotation.set(-c.slS, c.heading, c.sdS, 'YXZ'); g.updateMatrixWorld(true);
  // Trümmer und Wucht zerschmettern das Auto
  F.hitT = (F.hitT ?? .5) - dt; if (F.hitT <= 0) { F.hitT = rand(.5, .9); tornadoHit(c); }
  // du (bzw. deine Mitfahrer bei sich) kannst rausgeschleudert werden
  if (player.inCar && !F.ejChk && F.t > 1.4) { F.ejChk = true; if (Math.random() < .65) ejectPlayer(V(-Math.sin(F.ang) * 17 + Math.cos(F.ang) * 9, rand(8, 13), Math.cos(F.ang) * 17 + Math.sin(F.ang) * 9)); }
  if (F.t > 5 || !T) {
    c.fly = null; c.air = true; c.airT = 0; c.vy = rand(6, 10);
    c.heading = F.ang + Math.PI / 2 + rand(-.4, .4); c.speed = rand(20, 28); c.yawRate = 0;
    if (player.inCar) msg('Dein Auto wird weggeschleudert!', 2);
  }
}
function stopDisasters() { endTornado(); endTsunami(); }
function updDisasters(dt) {
  updTornado(dt); updTsunami(dt); updFlying(dt); updPlayerFly(dt);
  spray.update(dt, -6);
}
// Admin-Knöpfe (Handy-App "Admin Panel")
const FIRE_WHY = ['einem Kurzschluss', 'einer Gasexplosion', 'Brandstiftung', 'einem Blitzeinschlag', 'einem Küchenbrand'];
function adminAction(k) {
  if (!isAdmin()) return;
  if (k === 'tornado' || k === 'tornado5') { const ev = makeTornadoEv(k === 'tornado5' ? 5 : 0); startTornado(ev); share('tornado', ev); }
  else if (k === 'tsunami') { const ev = makeTsunamiEv(); startTsunami(ev); share('tsunami', ev); }
  else if (k === 'vil') {
    const cand = peds.map((p, i) => [p, i]).filter(([p]) => p.alive && p !== vil.ped).sort((a, b) => a[0].root.position.distanceTo(headWorld) - b[0].root.position.distanceTo(headWorld));
    const near = cand.filter(([p]) => p.root.position.distanceTo(headWorld) > 30).slice(0, 6);
    const c = pick(near.length ? near : cand); if (!c) return msg('Gerade ist kein NPC da', 2);
    setVillain(-1); setVillain(c[1]); share('vil', { i: c[1] });
  }
  else if (k === 'fire') {
    const b = flammables.filter(f => f.kind === 'building' && !f.tower && !f.burning && !f.done).map(f => [f, fBox(f).getCenter(V()).distanceTo(headWorld)]).filter(([, d]) => d > 25).sort((a, b) => a[1] - b[1]).slice(0, 8);
    if (!b.length) return msg('Kein Gebäude mehr zum Anzünden', 2);
    const f = pick(b)[0], why = pick(FIRE_WHY); lastFireAlert = -999; ignite(f, why); share('ign', { i: flammables.indexOf(f), bt: 0, r: why, a: 1 });
  }
  else if (k === 'rain') { const v = weather.target ? 0 : 1; weather.target = v; weather.t = 900; share('w', { v, t: 900 }); msg(v ? 'Regen an' : 'Regen aus', 2); }
  else if (k === 'stop') { stopDisasters(); share('dstop', {}); if (vil.i >= 0) { setVillain(-1); share('vil', { i: -1 }); } msg('Alles gestoppt', 2); }
  phone.drawT = 0;
}

// ===================================================================
// Speicherstand: Geld, Statistik, Haus, Hund, Tuning, Tank, Radio, Chat (localStorage) + Handy-Galerie (IndexedDB)
// ===================================================================
const SAVE_KEY = 'svr_save1';
const save = { money: 0, st: { taxi: 0, deliv: 0, arrest: 0, rob: 0, busted: 0 }, house: -1, dog: false, tune: {}, fuel: 1, radio: 0, vol: .6, chat: [] };
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s) { Object.assign(save, s); save.st = { taxi: 0, deliv: 0, arrest: 0, rob: 0, busted: 0, ...(s.st || {}) }; } } catch (e) { }
money = save.money || 0;
let saveT = 3;
function writeSave() { save.money = Math.round(money); try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { } }
addEventListener('pagehide', writeSave); document.addEventListener('visibilitychange', () => { if (document.hidden) writeSave(); });
// Galerie dauerhaft (Fotos + Videos bleiben nach dem Neuladen)
const galDB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { try { const r = indexedDB.open('svr_gallery', 1); r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }));
  const store = async mode => (await open()).transaction('items', mode).objectStore('items');
  return {
    put: async it => { try { (await store('readwrite')).put(it); } catch (e) { } },
    del: async id => { try { (await store('readwrite')).delete(id); } catch (e) { } },
    all: async () => { try { const s = await store('readonly'); return await new Promise(r => { const q = s.getAll(); q.onsuccess = () => r(q.result || []); q.onerror = () => r([]); }); } catch (e) { return []; } },
  };
})();
const canvasBlob = (c, type = 'image/jpeg', q = .85) => new Promise(r => c.toBlob(b => r(b), type, q));
function addGallery(it) {
  it.id = it.id || Date.now() + '_' + Math.floor(Math.random() * 1e6);
  phone.gallery.push(it); phone.drawT = 0;
  (async () => {
    const rec = { id: it.id, type: it.type, t: Date.now() };
    if (it.type === 'photo') rec.img = await canvasBlob(it.c);
    else Object.assign(rec, { blob: it.blob, thumb: await canvasBlob(it.thumb), ext: it.ext, len: it.len, dash: !!it.dash });
    galDB.put(rec);
  })();
  while (phone.gallery.length > 40) { const old = phone.gallery.shift(); galDB.del(old.id); }   // höchstens 40 behalten
}
function delGallery(i) { const it = phone.gallery[i]; if (!it) return; phone.gallery.splice(i, 1); galDB.del(it.id); }
(async () => {
  const items = (await galDB.all()).sort((a, b) => a.t - b.t);
  const img = async b => { const bmp = await createImageBitmap(b); const [c, g] = C(bmp.width, bmp.height); g.drawImage(bmp, 0, 0); return c; };
  const loaded = [];
  for (const r of items) {
    try {
      if (r.type === 'photo') loaded.push({ id: r.id, type: 'photo', c: await img(r.img) });
      else { const url = URL.createObjectURL(r.blob), vid = document.createElement('video'); vid.src = url; vid.loop = true; vid.playsInline = true; loaded.push({ id: r.id, type: 'clip', url, blob: r.blob, thumb: await img(r.thumb), vid, ext: r.ext, len: r.len, dash: r.dash }); }
    } catch (e) { }
  }
  phone.gallery.unshift(...loaded); phone.drawT = 0;
})();

// ===================================================================
// Fahndung: wer ausraubt, bekommt Sterne – Streifenwagen mit Blaulicht und Sirene jagen dich
// ===================================================================
const wanted = { stars: 0, calm: 0, bustT: 0, cops: [], flash: 0 };
const [stC, stG] = C(256, 56), stTex = T(stC, false);
const starHud = new THREE.Mesh(new THREE.PlaneGeometry(.11, .024), new THREE.MeshBasicMaterial({ map: stTex, transparent: true, depthTest: false, toneMapped: false }));
starHud.position.set(.13, .12, -.42); starHud.renderOrder = 996; starHud.visible = false; starHud.layers.set(OVERLAY); camera.add(starHud);
function drawStar(g, x, y, r, col) { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke(); }
function drawStars() {
  stG.clearRect(0, 0, 256, 56);
  const fl = Math.floor(time * 3) % 2 && wanted.cops.length;
  for (let i = 0; i < 5; i++) drawStar(stG, 28 + i * 50, 28, 22, i < wanted.stars ? (fl ? '#ffffff' : '#ffd21a') : 'rgba(255,255,255,.15)');
  stTex.needsUpdate = true; starHud.visible = wanted.stars > 0;
}
function addWanted(n, why) {
  const before = wanted.stars; wanted.stars = clamp(wanted.stars + n, 0, 5); wanted.calm = 0;
  if (wanted.stars > before) { msg('FAHNDUNGSSTUFE ' + wanted.stars + (why ? ' – ' + why : ''), 3.5); playAt(SND.warn, headWorld, .7, 3); }
  drawStars();
}
// Sirene: deutsches Martinshorn "Tatü-tata" (zwei Töne im Wechsel)
function sirenVoice() {
  const o = AC.createOscillator(), lfo = AC.createOscillator(), lg = AC.createGain(), f = AC.createBiquadFilter(), g = AC.createGain();
  o.type = 'sawtooth'; o.frequency.value = 512; lfo.type = 'square'; lfo.frequency.value = .9; lg.gain.value = 73; f.type = 'lowpass'; f.frequency.value = 2400; g.gain.value = .16;
  lfo.connect(lg); lg.connect(o.frequency); o.connect(f); f.connect(g); o.start(); lfo.start();
  const pa = new THREE.PositionalAudio(listener); pa.setNodeSource(g); pa.setRefDistance(12); pa.setRolloffFactor(1);
  return { pa, stop() { try { o.stop(); lfo.stop(); g.disconnect(); } catch (e) { } } };
}
const copBody = M(0xf4f4f4, { metalness: .45, roughness: .35 }), copGlass = M(0x141b22, { metalness: .9, roughness: .05 });
const POL_GEO = new THREE.PlaneGeometry(1.3, .26);
const copDecal = (() => { const [c, g] = C(256, 52); g.fillStyle = '#0b5fa5'; g.fillRect(0, 0, 256, 52); g.fillStyle = '#fff'; g.font = 'bold 38px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('POLIZEI', 128, 28); return new THREE.MeshBasicMaterial({ map: T(c, false), polygonOffset: true, polygonOffsetFactor: -2 }); })();
const copBlue = new THREE.MeshBasicMaterial({ color: 0x1040ff }), copDark = new THREE.MeshBasicMaterial({ color: 0x0a0f30 });
function makeCopCar(siren = true) {
  const g = new THREE.Group(), geo = npcCarGeo?.near;
  if (geo && !geo.boundingBox) geo.computeBoundingBox();
  const h = geo ? geo.boundingBox.max.y : 1.3;
  g.add(geo ? new THREE.Mesh(geo, [copBody, npcCarGeo.trim, copGlass]) : new THREE.Mesh(BODY_GEO, copBody));
  for (const s of [-1, 1]) { const st = new THREE.Mesh(POL_GEO, copDecal); st.position.set(s * ((geo ? geo.boundingBox.max.x : .95) + .01), .62, 0); st.rotation.y = s * Math.PI / 2; g.add(st); }   // Aufschrift an den Türen
  const l = new THREE.Mesh(BOX, copBlue), r = new THREE.Mesh(BOX, copBlue); for (const [m, x] of [[l, -.24], [r, .24]]) { m.scale.set(.42, .1, .2); m.position.set(x, h + .05, -.15); g.add(m); }
  shade(g, true, false); scene.add(g);
  const c = { g, l, r, speed: 0, yaw: 0, route: null, k: 1, rt: 0, snd: null };
  if (siren && AC.state === 'running') { c.snd = sirenVoice(); g.add(c.snd.pa); }
  return c;
}
function removeCop(c) { c.snd?.stop(); scene.remove(c.g); }
function copLights(c) { const on = Math.floor(time * 5 + (c.ph || 0)) % 2; c.l.material = on ? copBlue : copDark; c.r.material = on ? copDark : copBlue; }
// Hindernisse (Gebäude): Position aus Kollisionsboxen herausschieben
function pushOutOf(p, r) {
  for (const k of colliders) {
    if (k.lock !== undefined) continue;
    if (p.x > k.minX - r && p.x < k.maxX + r && p.z > k.minZ - r && p.z < k.maxZ + r) {
      const dx1 = p.x - (k.minX - r), dx2 = (k.maxX + r) - p.x, dz1 = p.z - (k.minZ - r), dz2 = (k.maxZ + r) - p.z, m = Math.min(dx1, dx2, dz1, dz2);
      if (m === dx1) p.x -= dx1; else if (m === dx2) p.x += dx2; else if (m === dz1) p.z -= dz1; else p.z += dz2;
    }
  }
}
function spawnCop() {
  const nodes = NAV.nodes.filter(n => { const d = Math.hypot(n.x - headWorld.x, n.z - headWorld.z); return d > 130 && d < 240; });
  const n = pick(nodes.length ? nodes : NAV.nodes), c = makeCopCar();
  c.g.position.set(n.x, surfaceAt(n.x, n.z), n.z); c.ph = Math.random() * 2; wanted.cops.push(c);
}
function busted(by) {
  const fine = Math.min(Math.round(money), Math.max(100, Math.round(money * .25)));
  money -= fine; save.st.busted++;
  wanted.stars = 0; wanted.bustT = 0; drawStars();
  while (wanted.cops.length) removeCop(wanted.cops.pop());
  if (player.inCar) pcar.speed = 0;
  if (job.id === 'crime') { msg('Mission gescheitert – festgenommen!', 3); job.stage = ''; setTimeout(() => job.id === 'crime' && nextJobTask(), 4000); }
  msg('FESTGENOMMEN von ' + by + '! Strafe: ' + fine + ' €', 5); playAt(SND.warn, headWorld, 1, 3);
  return fine;
}
function updCops(dt) {
  const want = wanted.stars ? Math.min(4, wanted.stars) : 0;
  while (wanted.cops.length < want) spawnCop();
  while (wanted.cops.length > want) removeCop(wanted.cops.pop());
  if (Math.floor(time * 3) !== Math.floor((time - dt) * 3) && wanted.stars) drawStars();
  if (!wanted.stars) return;
  const me = player.inCar ? pcar.group.position : player.ride ? (rideCar()?.position || headWorld) : headWorld;
  const indoors = !seated() && flammables.some(f => f.hollow?.containsPoint(headWorld));   // im Gebäude versteckt: die Polizei sieht dich nicht
  let seen = false;
  for (const c of wanted.cops) {
    const p = c.g.position, d = Math.hypot(me.x - p.x, me.z - p.z);
    if (d < 75 && !indoors) seen = true;
    for (const o of wanted.cops) if (o !== c) { const dx = p.x - o.g.position.x, dz = p.z - o.g.position.z, l = Math.hypot(dx, dz); if (l < 5 && l > .01) { p.x += dx / l * (5 - l) * .5; p.z += dz / l * (5 - l) * .5; } }   // nicht übereinander
    c.rt -= dt;
    if (c.rt <= 0) { c.rt = 2.5; c.route = d > 35 ? findRoute(p.x, p.z, me.x, me.z) : null; c.k = 1; }
    let tx = me.x, tz = me.z;
    if (c.route && c.k < c.route.length) { const q = c.route[c.k]; tx = q.x; tz = q.z; if (Math.hypot(q.x - p.x, q.z - p.z) < 7) c.k++; }
    c.yaw += clamp(wrapA(Math.atan2(tx - p.x, tz - p.z) - c.yaw), -dt * 2.4, dt * 2.4);
    const vmax = d < 14 ? Math.max(0, (d - 5) * 1.6) : d > 70 ? 27 : 19;
    c.speed += clamp(vmax - c.speed, -14 * dt, 7 * dt);
    p.x += Math.sin(c.yaw) * c.speed * dt; p.z += Math.cos(c.yaw) * c.speed * dt;
    pushOutOf(p, 1.3); p.y = surfaceAt(p.x, p.z); c.g.rotation.set(0, c.yaw, 0);
    copLights(c);
    if (player.inCar && d < 3.2 && Math.abs(pcar.speed) > 6) { crash(Math.abs(pcar.speed) * .7, p.clone()); pcar.speed *= .4; c.speed = 0; }   // rammt
  }
  const close = wanted.cops.some(c => Math.hypot(me.x - c.g.position.x, me.z - c.g.position.z) < (seated() ? 6.5 : 4.5) && c.speed < 4);
  const slow = player.inCar ? Math.abs(pcar.speed) < 1.5 : true;
  wanted.bustT = close && slow ? wanted.bustT + dt : 0;
  if (wanted.bustT > (player.inCar ? 3 : 1.5)) { busted('der Polizei'); return; }
  // ohne Sichtkontakt verlierst du nach und nach die Sterne
  wanted.calm = seen ? 0 : wanted.calm + dt;
  if (wanted.calm > 25) { wanted.calm = 0; wanted.stars--; drawStars(); msg(wanted.stars ? 'Fahndungsstufe ' + wanted.stars : 'Die Polizei hat dich verloren', 2.5); }
}
// Streifenwagen, die andere Spieler jagen (aus deren Zustand)
function updRemoteCops(p, dt) {
  const L = p.st?.cops || [], M0 = p.copMeshes || (p.copMeshes = []);
  while (M0.length < L.length) M0.push(makeCopCar(M0.length < 2));
  while (M0.length > L.length) removeCop(M0.pop());
  L.forEach((a, i) => { const c = M0[i], q = c.g.position; q.x += (a[0] - q.x) * Math.min(1, dt * 6); q.z += (a[1] - q.z) * Math.min(1, dt * 6); q.y = surfaceAt(q.x, q.z); c.yaw = lerpAngle(c.yaw, a[2], Math.min(1, dt * 6)); c.g.rotation.set(0, c.yaw, 0); copLights(c); });
}

// ===================================================================
// Ausrauben: Kassen (Supermarkt, Tankstellen) und Geldautomaten – Grip halten (PC: E halten)
// ===================================================================
SND.bell = mkBuf(3, t => Math.sign(Math.sin(2 * Math.PI * 1150 * t)) * .1 * (Math.floor(t * 18) % 2 ? 1 : .25) * Math.min(1, (3 - t) * 2));
const rob = { spot: null, t: 0, hand: null, hintT: 0 };
const robNear = (pos, r) => robSpots.find(s => time > s.cool && s.p.distanceTo(pos) < r);
function robStart(s, hand) { rob.spot = s; rob.t = 0; rob.hand = hand; scarePeds(s.p, 30); msg(s.kind === 'atm' ? 'Automat wird geknackt …' : 'Kasse wird ausgeräumt …', 1.2); }
function robEffects(s) { s.cool = time + 300; playAt(SND.bell, s.p, 1.4, 10); if (s.scr) s.scr.color.set(0x111111); }
function updRob(dt) {
  if (!rob.spot) {
    rob.hintT -= dt;
    if (!seated() && rob.hintT <= 0) { const s = robNear(headWorld, 2); if (s) { rob.hintT = 1.2; msg((xrOn() ? 'Grip an ' : 'E halten am ') + s.name + ' = ausrauben', 1.2); } }
    return;
  }
  const s = rob.spot, holding = rob.hand ? rob.hand.held?.type === 'rob' : !!desk.keys.KeyE;
  if (!holding || seated() || s.p.distanceTo(headWorld) > 2.4) { rob.spot = null; msg('Abgebrochen', 1.2); return; }
  rob.t += dt; const k = rob.t / s.time;
  if (Math.floor(rob.t * 3) !== Math.floor((rob.t - dt) * 3)) { msg((s.kind === 'atm' ? 'Automat knacken … ' : 'Kasse ausräumen … ') + Math.min(100, Math.round(k * 100)) + ' %', .5); if (rob.hand) haptic(rob.hand, .35, 40); playAt(SND.hit, s.p, .35, 2); }
  if (k >= 1) {
    rob.spot = null; if (rob.hand?.held?.type === 'rob') rob.hand.held = null;
    const cash = Math.round(rand(s.cash[0], s.cash[1]) / 10) * 10; money += cash; save.st.rob++;
    robEffects(s); msg('+' + cash + ' € erbeutet! Hau ab, die Polizei kommt!', 4);
    addWanted(s.stars, s.name + ' ausgeraubt');
    share('rob', { i: robSpots.indexOf(s) });
    jobEvent('rob', s);
  }
}

// ===================================================================
// Jobs (Handy-App "Jobs"): Taxifahrer, Lieferdienst, Polizist, Krimineller
// ===================================================================
const JOBS = [
  { id: 'taxi', name: 'Taxifahrer', desc: 'Fahrgäste abholen und ans Ziel bringen', col: '#c99400' },
  { id: 'deliv', name: 'Lieferdienst', desc: 'Pizza abholen und schnell ausliefern', col: '#c4471b' },
  { id: 'police', name: 'Polizist', desc: 'Räuber und gesuchte Spieler festnehmen', col: '#1e5bd8' },
  { id: 'crime', name: 'Krimineller', desc: 'Ausrauben und der Polizei entkommen', col: '#3d3d3d' },
];
const TAXI_SAY = ['Zum Ziel bitte, aber schnell!', 'Ich hab\'s eilig!', 'Schönes Auto!', 'Bitte vorsichtig fahren.', 'Musik wäre nett.', 'Ich zahle auch Trinkgeld!'];
const job = { id: null, stage: '', target: null, t0: 0, deadline: 0, dist: 0, npc: null, robber: null, spot: null, nextT: 0, sayT: -1, navN: '', siren: false };
const beamMat = col => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .32, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
const jobBeam = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 160, 16, 1, true), beamMat(0x33ff88)); jobBeam.visible = false; scene.add(jobBeam);
const robberBeam = new THREE.Mesh(new THREE.CylinderGeometry(.7, .7, 140, 14, 1, true), beamMat(0x2a5bff)); robberBeam.visible = false; scene.add(robberBeam);
let figTpl = null;                                                       // Vorlage für Fahrgäste (aus den Fußgänger-Modellen)
function startNavXY(n, p) { phone.dest = { n, p }; Object.assign(nav, { on: true, n, p, offT: 0, t: 0 }); planRoute(true); phone.drawT = 0; cp.drawT = 0; }
function setJobTarget(p, col, label) {
  job.target = p;
  if (!p) { jobBeam.visible = false; if (nav.on && nav.n === job.navN) stopNav(); return; }
  jobBeam.visible = true; jobBeam.material.color.set(col); jobBeam.position.set(p.x, groundAt(p.x, p.z) + 80, p.z);
  job.navN = label; startNavXY(label, [p.x, p.z]);
}
function makeFigure() {
  const root = new THREE.Group(); scene.add(root);
  if (figTpl) {
    const m = AS.cloneSkinned(figTpl.g.scene); m.scale.setScalar(figTpl.s); m.rotation.y = figTpl.ry; root.add(m);
    const tint = new THREE.Color().setHSL(Math.random(), .35, .75);
    m.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiply(tint); o.frustumCulled = false; } });
    const idle = figTpl.g.animations.find(a => /idle/i.test(a.name)) || figTpl.g.animations[0];
    root.userData.mixer = new THREE.AnimationMixer(m); root.userData.mixer.clipAction(idle).play();
  } else { box(.42, .6, .24, M(0x3366cc), 0, 1.2, 0, root); box(.3, .85, .2, M(0x2b3a55), 0, .43, 0, root); }
  const bl = new THREE.Mesh(BLOB_GEO, blobMat); bl.rotation.x = -Math.PI / 2; bl.position.y = .03; root.add(bl);
  return root;
}
function clearJobNpc() { if (job.npc) { scene.remove(job.npc); job.npc = null; } }
// Punkt am Bordstein (auf dem Gehweg, direkt an der Straße) in einer bestimmten Entfernung
function randomCurb(minD, maxD) {
  for (let i = 0; i < 60; i++) {
    const b = pick(blocks); if (b.type === 'tank' || b.type === 'park') continue;
    const side = Math.floor(Math.random() * 4), t = rand(-27, 27), e = BLOCK / 2 - 1.3;
    const x = b.cx + (side === 0 ? e : side === 1 ? -e : t), z = b.cz + (side === 2 ? e : side === 3 ? -e : t);
    const d = Math.hypot(x - headWorld.x, z - headWorld.z);
    if (d >= minD && d <= maxD) { const p = V(x, surfaceAt(x, z), z); p.road = side === 0 ? Math.PI / 2 : side === 1 ? -Math.PI / 2 : side === 2 ? 0 : Math.PI; return p; }
  }
  const b = blocks[0]; const p = V(b.cx + BLOCK / 2 - 1.3, .15, b.cz); p.road = Math.PI / 2; return p;
}
const houseDoor = h => V(h.x + h.front[0] * (h.w / 2 + 2.5), .15, h.z + h.front[1] * (h.d / 2 + 2.5));
function startJob(id) {
  endJob(true); job.id = id; job.stage = ''; job.t0 = time;
  msg('Job gestartet: ' + JOBS.find(j => j.id === id).name, 3); uiTone(SND.chime);
  if (id === 'police') policeBar(true);
  nextJobTask(); openApp('home');
}
function endJob(quiet) {
  if (!job.id) return;
  clearJobNpc(); setJobTarget(null); robberBeam.visible = false;
  if (job.robber) { job.robber.flee = 0; job.robber = null; }
  policeBar(false); setSiren(false);
  job.id = null; job.stage = '';
  if (!quiet) msg('Job beendet', 2);
}
function nextJobTask() {
  const J = job.id; if (!J) return;
  const me = player.inCar ? pcar.group.position : headWorld;
  if (J === 'taxi') {
    const p = randomCurb(120, 420); job.stage = 'pickup';
    clearJobNpc(); job.npc = makeFigure(); job.npc.position.copy(p); job.npc.rotation.y = p.road;
    setJobTarget(p, 0xffd21a, 'Fahrgast'); msg('Taxi: Ein Fahrgast wartet – hol ihn mit dem Auto ab!', 3.5);
  } else if (J === 'deliv') {
    const d = q => Math.hypot(q.x - me.x, q.z - me.z);
    const z = pizzerias.length ? pizzerias.reduce((a, b) => d(a) < d(b) ? a : b) : { x: POI.Supermarkt[0], z: POI.Supermarkt[1] };
    job.stage = 'pickup'; setJobTarget(V(z.x, .15, z.z), 0xff7043, 'Pizzeria'); msg('Lieferdienst: Hol die Pizza in der Pizzeria ab', 3.5);
  } else if (J === 'police') {
    job.stage = 'patrol'; setJobTarget(null); job.nextT = time + rand(12, 25); msg('Polizei: Fahr Streife – Einsätze kommen über Funk', 3.5);
  } else if (J === 'crime') {
    const cand = robSpots.filter(s => time > s.cool).sort((a, b) => a.p.distanceTo(me) - b.p.distanceTo(me)).slice(0, 4);
    const s = pick(cand); if (!s) { msg('Gerade nichts auszurauben – warte kurz', 3); job.stage = 'wait'; setTimeout(() => job.id === 'crime' && nextJobTask(), 20000); return; }
    job.stage = 'rob'; job.spot = s; setJobTarget(s.p, 0xff2020, s.name);
    msg('Auftrag: Raube ' + (s.kind === 'atm' ? 'einen Geldautomaten' : 'die ' + s.name) + ' aus', 3.5);
  }
}
// Rückmeldung von außen (z.B. Raub erledigt)
function jobEvent(kind, s) {
  if (job.id !== 'crime' || kind !== 'rob') return;
  const bonus = s === job.spot ? 200 : 0; if (bonus) { money += bonus; msg('Auftrag erledigt: +' + bonus + ' € Bonus! Jetzt entkommen!', 4); }
  job.stage = 'escape'; job.deadline = time + 60; setJobTarget(null);
}
function updJob(dt) {
  const J = job.id; if (!J) return;
  job.npc?.userData.mixer?.update(dt);
  const me = player.inCar ? pcar.group.position : headWorld, still = player.inCar ? Math.abs(pcar.speed) < 2 : true;
  const near = (p, r) => p && Math.hypot(me.x - p.x, me.z - p.z) < r;
  if (J === 'taxi') {
    if (job.stage === 'pickup' && near(job.target, 9) && still) {
      if (!player.inCar) { if (Math.floor(time) !== job.sayT) { job.sayT = Math.floor(time); msg('Hol den Fahrgast mit dem Auto ab', 1.5); } return; }
      const rd = pcar.doors[2] || pcar.doors[1]; if (rd) rd.pulse = 1.4;
      job.npc.visible = false; job.stage = 'drive'; job.t0 = time;
      let dest = null; for (let i = 0; i < 20 && !dest; i++) { const p = randomCurb(300, 800); if (p.distanceTo(me) > 280) dest = p; }
      dest ||= randomCurb(200, 1000); job.dist = dest.distanceTo(me);
      setJobTarget(dest, 0x33ff88, 'Fahrgast-Ziel'); msg('Fahrgast: „' + pick(TAXI_SAY) + '“', 4);
    } else if (job.stage === 'drive' && near(job.target, 13) && still && player.inCar) {
      const tt = time - job.t0, pay = Math.round(25 + job.dist * .09 + Math.max(0, job.dist / 10 - tt) * .6);
      money += pay; save.st.taxi++; uiTone(SND.arrive);
      const rd = pcar.doors[2] || pcar.doors[1]; if (rd) rd.pulse = 1.4;
      const n = job.npc; job.npc = null; if (n) { n.visible = true; n.position.copy(job.target); n.rotation.y = (job.target.road || 0) + Math.PI; setTimeout(() => scene.remove(n), 6000); }
      msg('Fahrt bezahlt: +' + pay + ' €  (Fahrten insgesamt: ' + save.st.taxi + ')', 4);
      setJobTarget(null); job.stage = 'wait'; setTimeout(() => job.id === 'taxi' && nextJobTask(), 3000);
    }
  } else if (J === 'deliv') {
    if (job.stage === 'pickup' && near(job.target, 7) && still) {
      const h = pick(houses.filter(h => { const d = Math.hypot(h.x - me.x, h.z - me.z); return d > 140 && d < 650; })) || pick(houses);
      const door = houseDoor(h); job.dist = door.distanceTo(me); job.deadline = time + job.dist / 7 + 35; job.stage = 'deliver';
      setJobTarget(door, 0xff7043, 'Lieferadresse'); msg('Pizza eingepackt! Liefere sie in ' + Math.round(job.deadline - time) + ' Sekunden', 3.5); uiTone(SND.ding);
    } else if (job.stage === 'deliver') {
      const left = job.deadline - time, s = Math.floor(left);
      if (s > 0 && (s % 15 === 0 || s <= 10) && s !== job.sayT) { job.sayT = s; msg('Lieferung: noch ' + s + ' s', 1.2); }
      if (near(job.target, 8) && still) {
        const pay = Math.round(35 + job.dist * .05 + Math.max(0, left) * 1.2); money += pay; save.st.deliv++; uiTone(SND.arrive);
        msg('Geliefert! +' + pay + ' € (mit Trinkgeld)', 4); setJobTarget(null); job.stage = 'wait'; setTimeout(() => job.id === 'deliv' && nextJobTask(), 2500);
      } else if (left < 0) { msg('Zu spät – die Pizza ist kalt. Neue Bestellung …', 3); setJobTarget(null); job.stage = 'wait'; setTimeout(() => job.id === 'deliv' && nextJobTask(), 3000); }
    }
  } else if (J === 'police') updPoliceJob(me);
  else if (J === 'crime' && job.stage === 'escape') {
    const left = job.deadline - time;
    if (wanted.stars === 0 || left <= 0) {
      const pay = wanted.stars === 0 ? 300 : 450; money += pay; uiTone(SND.arrive);
      msg((wanted.stars === 0 ? 'Polizei abgehängt' : '60 Sekunden überlebt') + '! +' + pay + ' €', 4);
      job.stage = 'wait'; setTimeout(() => job.id === 'crime' && nextJobTask(), 6000);
    } else if (Math.floor(left) % 10 === 0 && Math.floor(left) !== job.sayT) { job.sayT = Math.floor(left); msg('Entkomme der Polizei: noch ' + Math.floor(left) + ' s', 1.5); }
  }
}
// ---------- Polizist: Blaulicht, Sirene, Räuber jagen, gesuchte Spieler festnehmen ----------
function policeBar(on) {
  if (!on) { if (pcar.pbar) { pcar.pbar.parent?.remove(pcar.pbar); pcar.pbar = null; } return; }
  if (pcar.pbar || vehicle.type === 'scooter' || !pcar.chassis) return;
  const g = new THREE.Group(), l = new THREE.Mesh(BOX, copBlue), r = new THREE.Mesh(BOX, copDark);
  for (const [m, x] of [[l, -.25], [r, .25]]) { m.scale.set(.44, .1, .2); m.position.x = x; g.add(m); }
  g.position.set(0, pcar.half.y + .04, -.35); pcar.chassis.add(g); pcar.pbar = g; g.userData = { l, r };
}
let sirenSnd = null;
function setSiren(on) {
  job.siren = on;
  if (on && !sirenSnd && AC.state === 'running') { sirenSnd = sirenVoice(); pcar.group.add(sirenSnd.pa); }
  if (!on && sirenSnd) { sirenSnd.stop(); sirenSnd.pa.parent?.remove(sirenSnd.pa); sirenSnd = null; }
}
function updPoliceJob(me) {
  if (pcar.pbar) { const on = Math.floor(time * 5) % 2; pcar.pbar.userData.l.material = on ? copBlue : copDark; pcar.pbar.userData.r.material = on ? copDark : copBlue; }
  else policeBar(true);
  if (job.stage === 'patrol' && time > job.nextT) {
    const cand = peds.filter(p => p.alive && p !== vil.ped && p.root.position.distanceTo(headWorld) > 70 && p.root.position.distanceTo(headWorld) < 320);
    if (cand.length) {
      const p = pick(cand); job.robber = p; p.flee = 1e9; job.stage = 'chase'; job.target = null;
      carAlert('Funk: Raubüberfall!', 'Ein Räuber flüchtet zu Fuß. Nimm ihn fest – er ist blau markiert.', '#1e5bd8', 'Räuber flüchtet');
      msg('EINSATZ: Ein Räuber flüchtet – fang ihn! (blau markiert)', 4);
    } else job.nextT = time + 10;
  }
  if (job.stage === 'chase') {
    const p = job.robber;
    if (!p || !p.alive) { job.stage = 'patrol'; job.nextT = time + 20; robberBeam.visible = false; setJobTarget(null); job.robber = null; return; }
    const q = p.root.position; p.flee = 1e9;
    robberBeam.visible = true; robberBeam.position.set(q.x, q.y + 72, q.z);
    if (!job.target || job.target.distanceTo(q) > 30) { setJobTarget(q.clone(), 0x2a5bff, 'Räuber'); jobBeam.visible = false; }
    const d = Math.hypot(me.x - q.x, me.z - q.z);
    if ((d < 2.3 && !seated()) || (player.inCar && d < 5 && Math.abs(pcar.speed) < 4)) {
      p.flee = 0; money += 300; save.st.arrest++; uiTone(SND.arrive);
      msg('Räuber festgenommen! +300 €  (Festnahmen: ' + save.st.arrest + ')', 4);
      p.root.visible = false; setTimeout(() => { if (amHost()) placePed(p); }, 1500);
      robberBeam.visible = false; setJobTarget(null); job.robber = null; job.stage = 'patrol'; job.nextT = time + rand(25, 50);
    }
  }
  // gesuchte Spieler in der Nähe: Hinweis zum Festnehmen
  const t = arrestTarget(); if (t && Math.floor(time) !== job.sayT) { job.sayT = Math.floor(time); msg((xrOn() ? 'A' : 'F') + ' = ' + t.name + ' festnehmen', 1.1); }
}
function arrestTarget() {
  if (job.id !== 'police' || player.inCar) return null;
  for (const p of net.players.values()) {
    if (!(p.st?.ws > 0)) continue;
    const q = p.st.c && p.carMesh ? p.carMesh.position : p.root.position;
    if (Math.hypot(q.x - headWorld.x, q.z - headWorld.z) < (p.st.c ? 5 : 2.8)) return p;
  }
  return null;
}
function doArrest(p) { netSig(p.id, { arrest: 1 }); msg('Festnahme: ' + p.name + ' …', 2); haptic(handBy('right'), .6, 80); }

// ===================================================================
// Hupe (linker Stick drücken / PC: B) – alle hören sie
// ===================================================================
SND.horn = mkBuf(.5, t => { const e = Math.min(1, t * 50) * Math.min(1, (.5 - t) * 25); return (Math.sin(2 * Math.PI * 415 * t) + Math.sin(2 * Math.PI * 523 * t) + .35 * Math.sin(2 * Math.PI * 830 * t) + .25 * Math.sin(2 * Math.PI * 1046 * t)) * .16 * e; });
let hornCool = 0;
function honk() {
  if (time < hornCool || !player.inCar) return; hornCool = time + .42;
  const p = pcar.group.localToWorld(V(0, .8, 2)), s = vehicle.type === 'scooter' ? SND.ding : SND.horn;
  playAt(s, p, 1.5, 14); share('horn', { p: p.toArray().map(r2), s: vehicle.type === 'scooter' ? 1 : 0 }); scarePeds(p, 14);
}

// ===================================================================
// Radio im Auto: 4 Sender (selbst erzeugte Musik), am Auto-Display umschalten
// ===================================================================
const STATIONS = [{ name: 'Stuttgart Lofi', bpm: 76, col: '#8e7cc3' }, { name: 'Techno 130', bpm: 130, col: '#e53935' }, { name: 'Klassik Radio', bpm: 96, col: '#c9a227' }, { name: 'Schlager FM', bpm: 120, col: '#ec407a' }];
const radio = { on: false, st: clamp(save.radio | 0, 0, 3), out: null, pa: null, next: 0, step: 0, noise: null };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function radioOut() {
  if (radio.out) return;
  radio.out = AC.createGain();
  radio.pa = new THREE.PositionalAudio(listener); radio.pa.setNodeSource(radio.out); radio.pa.setRefDistance(1.6); radio.pa.setRolloffFactor(1.6);
  const n = AC.sampleRate, b = AC.createBuffer(1, n, n), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; radio.noise = b;
}
function tone(f, t, dur, type = 'sine', vol = .2, att = .01) { const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(.0005, t + dur); o.connect(g); g.connect(radio.out); o.start(t); o.stop(t + dur + .05); }
function kick(t, vol = .9) { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + .14); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + .3); o.connect(g); g.connect(radio.out); o.start(t); o.stop(t + .32); }
function noiseHit(t, dur, freq, vol, type = 'highpass') { const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(); s.buffer = radio.noise; f.type = type; f.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); s.connect(f); f.connect(g); g.connect(radio.out); s.start(t, Math.random() * .5); s.stop(t + dur + .02); }
const CHORDS = { lofi: [[57, 60, 64, 67], [50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59]], klassik: [[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]], schlager: [[48, 52, 55], [53, 57, 60], [55, 59, 62], [48, 52, 55]] };
function radioStep(i, t, sp) {
  const bar = Math.floor(i / 16) % 4, s = i % 16;
  if (radio.st === 0) {                                                 // Lofi: weiche Akkorde, gemütlicher Beat
    const ch = CHORDS.lofi[bar];
    if (s === 0) ch.forEach(m => tone(mtof(m), t, sp * 15, 'triangle', .05, .08));
    if (s === 0 || s === 7 || s === 10) kick(t, .55);
    if (s === 4 || s === 12) noiseHit(t, .18, 1800, .16, 'bandpass');
    if (s % 2 === 0) noiseHit(t, .04, 7000, .045);
    if (s === 8 || s === 14) tone(mtof(ch[3] + 12 + pick([0, 2, -2])), t, sp * 3, 'sine', .05);
  } else if (radio.st === 1) {                                          // Techno
    if (s % 4 === 0) kick(t, 1);
    if (s % 4 === 2) noiseHit(t, .06, 8000, .11);
    if (s === 4 || s === 12) noiseHit(t, .12, 2500, .11, 'bandpass');
    if (s % 2 === 1) tone(mtof([33, 33, 45, 33, 36, 33, 45, 31][Math.floor(s / 2)]), t, sp * 1.5, 'sawtooth', .09);
    if (bar % 2 === 1 && s === 14) tone(mtof(69), t, sp * 2, 'square', .03);
  } else if (radio.st === 2) {                                          // Klassik: gebrochene Akkorde wie am Klavier
    const ch = CHORDS.klassik[bar], arp = [0, 1, 2, 3, 2, 1, 2, 3];
    if (s % 2 === 0) tone(mtof(ch[arp[(s / 2) % 8]] + 12), t, sp * 6, 'triangle', .08, .005);
    if (s === 0) tone(mtof(ch[0] - 12), t, sp * 16, 'sine', .1);
    if (s === 8 && Math.random() < .7) tone(mtof(ch[pick([1, 2, 3])] + 24), t, sp * 6, 'sine', .04, .005);
  } else {                                                              // Schlager: Humpa-Bass, Akkord-Schläge, Melodie
    const ch = CHORDS.schlager[bar];
    if (s === 0 || s === 8) tone(mtof(ch[0] - 12), t, sp * 3, 'triangle', .14);
    if (s === 4 || s === 12) { ch.forEach(m => tone(mtof(m), t, sp * 2, 'square', .022)); noiseHit(t, .1, 3000, .09, 'bandpass'); }
    if (s % 4 === 0) kick(t, .65);
    if (s % 4 === 2) tone(mtof(ch[Math.floor(Math.random() * 3)] + 12), t, sp * 2.5, 'square', .03);
  }
}
function updRadio() {
  if (!(radio.on && player.inCar && vehicle.type !== 'scooter' && AC.state === 'running')) return;
  radioOut(); if (radio.pa.parent !== pcar.group) { pcar.group.add(radio.pa); radio.pa.position.set(0, 1, .6); }
  radio.out.gain.value = save.vol;
  const sp = 60 / STATIONS[radio.st].bpm / 4;
  if (radio.next < AC.currentTime) radio.next = AC.currentTime + .05;
  while (radio.next < AC.currentTime + .2) { radioStep(radio.step++, radio.next, sp); radio.next += sp; }
}
function setRadio(i) { radio.st = save.radio = i; radio.on = true; radio.step = 0; msg('Radio: ' + STATIONS[i].name, 2); }

// ===================================================================
// Tanken: Benzin wird beim Fahren leer, an der Zapfsäule am Auto-Display tanken
// ===================================================================
const fuelInfo = { warned: false, filling: false };
const nearPump = () => { const p = pcar.group.position; return pumps.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 5.5); };
const canFuel = () => player.inCar && vehicle.type !== 'scooter' && Math.abs(pcar.speed) < .5 && save.fuel < .97 && nearPump();
const PRICE_L = 1.79, TANK_L = 70;
function startFuel() { if (!canFuel()) return; if (money < 2) return msg('Zu wenig Geld zum Tanken', 2); fuelInfo.filling = true; msg('Tankt …', 2); playAt(SND.click, pcar.group.position, .8, 3); }
function updFuel(dt) {
  if (vehicle.type === 'scooter') return;
  if (player.inCar && !pcar.dead) save.fuel = Math.max(0, save.fuel - (Math.abs(pcar.speed) / 80000 + .0000012) * dt);   // großer Tank: reicht ca. 80 km
  if (save.fuel < .15 && !fuelInfo.warned && player.inCar) { fuelInfo.warned = true; msg('Tank fast leer – fahr zur Tankstelle!', 4); uiTone(SND.ding); }
  if (save.fuel > .3) fuelInfo.warned = false;
  if (fuelInfo.filling) {
    const add = Math.min(dt / 6, 1 - save.fuel), cost = add * TANK_L * PRICE_L;
    if (money < cost || Math.abs(pcar.speed) > .5 || !player.inCar) { fuelInfo.filling = false; msg('Tanken abgebrochen', 2); return; }
    money -= cost; save.fuel += add;
    if (save.fuel >= .999) { save.fuel = 1; fuelInfo.filling = false; msg('Vollgetankt!', 2); uiTone(SND.ding); }
  }
}

// ===================================================================
// Tuning-Werkstatt (2. Tankstelle): Lack, Felgen, Neon – am Auto-Display, wenn das Auto auf der Fläche steht
// ===================================================================
const PAINTS = [0xc0392b, 0x1f3a93, 0x111111, 0xf2f2f2, 0x2e7d32, 0xffb300, 0x8e24aa, 0x8d9499];
const RIMS = [0xc7ccd1, 0x151515, 0xd4af37, 0xc62828];
const NEONS = [0, 0x00e5ff, 0xff1744, 0x76ff03, 0xd500f9];
const TUNE_PRICE = { p: 500, r: 300, n: 800 };
const onPad = () => player.inCar && vehicle.type !== 'scooter' && Math.hypot(pcar.group.position.x - tuningPad.x, pcar.group.position.z - tuningPad.z) < 5 && Math.abs(pcar.speed) < 1;
const neonTex = (() => { const [c, g] = C(128, 128), gr = g.createRadialGradient(64, 64, 8, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.6, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return T(c, false); })();
function rimMatsOf(root) {
  const out = [], done = new Map();
  root.traverse(o => {
    if (!o.isMesh || !(o.parent?.name === 'spin' || o.parent?.name === 'wheel')) return;
    const m = o.material; if (Array.isArray(m) || !m.isMeshStandardMaterial || (m.metalness ?? 0) < .5) return;
    if (!done.has(m)) { const c = m.clone(); c.userData.rim0 = c.color.clone(); done.set(m, c); out.push(c); }
    o.material = done.get(m);
  });
  return out;
}
function neonPlane(half) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(half.x * 2 + 1.2, half.z * 2 + 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: neonTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .9 }));
  m.position.y = .04; m.renderOrder = 2; m.visible = false; return m;
}
// t = { p: Lackfarbe, r: Felgenfarbe, n: Neonfarbe } (Zahlen; fehlend = Original)
function applyTune(c, t) {
  if (!c.chassis || vehicle.type === 'scooter') return;
  c.paint0 ??= c.bodyMat.color.getHex();
  c.bodyMat.color.setHex(t?.p ?? c.paint0); if (c.fl?.orig) c.fl.orig[0] = c.bodyMat.color.clone();
  c.rimMats ||= rimMatsOf(c.vis);
  for (const m of c.rimMats) m.color.copy(t?.r !== undefined ? new THREE.Color(t.r) : m.userData.rim0);
  if (!c.neon) { c.neon = neonPlane(c.half); c.group.add(c.neon); }
  c.neon.visible = !!t?.n; if (t?.n) c.neon.material.color.setHex(t.n);
}
function buyTune(kind, i) {
  const list = kind === 'p' ? PAINTS : kind === 'r' ? RIMS : NEONS, price = TUNE_PRICE[kind];
  if (!onPad()) return msg('Stell dein Auto auf die Fläche der Tuning-Werkstatt', 2.5);
  if (money < price) return msg('Zu wenig Geld (' + price + ' €)', 2);
  const t = save.tune[vehicle.id] || (save.tune[vehicle.id] = {});
  money -= price; t[kind] = list[i]; if (kind === 'n' && !list[i]) delete t.n;
  applyTune(pcar, t); playAt(SND.whoosh, pcar.group.position, .5, 4); msg('Werkstatt: erledigt (−' + price + ' €)', 2); writeSave();
}
// Tuning eines anderen Spielers an seinem Auto zeigen
function applyRemoteTune(p, tn) {
  const cm = p.carMesh; if (!cm || p.carType === 'scooter') return;
  const full = cm.isLOD ? cm.levels[0].object : cm;
  if (!p.tunePaint) full.traverse(o => { if (o.isMesh && !p.tunePaint) for (const m of [].concat(o.material)) if (m.isMeshPhysicalMaterial && m.clearcoat > 0) p.tunePaint = m; });
  if (p.tunePaint) { p.tunePaint0 ??= p.tunePaint.color.getHex(); p.tunePaint.color.setHex(tn?.[0] || p.tunePaint0); }
  if (cm.isLOD) { const low = cm.levels[1]?.object; if (low) [].concat(low.material)[0].color.setHex(tn?.[0] || metaOf(p.carType).paint); }
  p.rimMats ||= rimMatsOf(full);
  for (const m of p.rimMats) m.color.copy(tn?.[1] ? new THREE.Color(tn[1]) : m.userData.rim0);
  if (!p.neon) { p.neon = neonPlane(metaOf(p.carType).half); cm.add(p.neon); }
  p.neon.visible = !!tn?.[2]; if (tn?.[2]) p.neon.material.color.setHex(tn[2]);
}

// ===================================================================
// Tag und Nacht (für alle gleich, nach der Uhrzeit): ein Tag dauert 40 Minuten, davon ~12 Minuten Nacht
// ===================================================================
const DAY_LEN = 2400;
const day = { k: 1, night: 0, envK: 1, envT: 0, mats: null, matsT: 0 };
const starPts = (() => {
  const n = 1300, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, y = Math.random() * .92 + .06, r = Math.sqrt(1 - y * y); pos.set([Math.cos(a) * r * 900, y * 900, Math.sin(a) * r * 900], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  p.frustumCulled = false; p.visible = false; scene.add(p); return p;
})();
const headBeam = (() => {                                              // Lichtkegel der eigenen Scheinwerfer auf der Straße (nachts)
  const [c, g] = C(64, 128), gr = g.createLinearGradient(0, 128, 0, 0); gr.addColorStop(0, 'rgba(255,240,210,.9)'); gr.addColorStop(1, 'rgba(255,240,210,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(26, 128); g.lineTo(38, 128); g.lineTo(64, 0); g.lineTo(0, 0); g.closePath(); g.fill();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 24).rotateX(-Math.PI / 2).translate(0, .06, 14), new THREE.MeshBasicMaterial({ map: T(c, false), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  m.visible = false; return m;
})();
function updDayNight(dt) {
  const ph = ((Date.now() / 1000) % DAY_LEN) / DAY_LEN;                 // 0..1 – für alle Spieler gleich
  const elev = Math.sin(ph * Math.PI * 2) * .6 + .35;                   // Sonnenhöhe: ~70 % der Zeit über dem Horizont
  day.k = smooth(-.12, .22, elev); day.night = 1 - day.k; day.dusk = clamp(1 - Math.abs(elev - .05) / .25, 0, 1);
  day.hour = (ph * 24 + 6) % 24;
  // Sterne + Straßenlaternen + Scheinwerfer
  starPts.visible = day.night > .05; starPts.material.opacity = day.night * .9; starPts.position.copy(headWorld);
  if (lampFx.glow) { lampFx.glow.material.color.setScalar(.25 + day.night * .75); lampFx.pool.visible = day.night > .05; lampFx.pool.material.opacity = day.night * .5; }
  if (pcar.headMat && !pcar.dmg?.hl) pcar.headMat.emissiveIntensity = 1.2 + day.night * 3;
  if (headBeam.parent !== pcar.group) pcar.group.add(headBeam);
  headBeam.visible = day.night > .1 && vehicle.type !== 'scooter' && !pcar.dmg?.hl && (player.inCar || pcar.group.position.distanceTo(headWorld) < 60); headBeam.material.opacity = day.night * .55;
  // Spiegelungen vom (hellen) Himmel nachts abschwächen – alle Materialien (alle 0,5 s, nur bei Änderung)
  day.matsT -= dt;
  if (!day.mats || day.matsT <= 0) { day.matsT = 8; const s = new Set(); scene.traverse(o => { if (o.material) for (const m of [].concat(o.material)) if (m.envMapIntensity !== undefined) s.add(m); }); day.mats = [...s]; day.envK = -1; }
  const envK = .2 + .8 * day.k;
  if (Math.abs(envK - day.envK) > .02) { day.envK = envK; for (const m of day.mats) { m.userData.envBase ??= m.envMapIntensity; m.envMapIntensity = m.userData.envBase * envK; } }
}

// ===================================================================
// Chat: Textnachrichten an alle oder an einen Spieler (Schnellnachrichten, am PC auch tippen)
// ===================================================================
const QUICK = ['Hallo!', 'Wo bist du?', 'Komm her!', 'Lass uns fahren!', 'Danke!', 'Hilfe!', 'Ja', 'Nein', 'Bin gleich da', 'Polizei kommt!', 'Gute Fahrt!', 'Hahaha'];
const chat = { to: 0, draft: '' };
function sendChat(text) {
  text = String(text).trim().slice(0, 120); if (!text) return;
  const m = { n: net.name, to: chat.to, x: text, ts: Date.now() };
  share('chat', m); addChat(m, true); chat.draft = '';
}
function addChat(m, mine) {
  save.chat.push({ n: m.n, x: m.x, to: m.to || 0, me: !!mine, ts: m.ts || Date.now() }); if (save.chat.length > 40) save.chat.shift(); phone.drawT = 0;
  if (!mine) { phone.notif = { title: m.n + (m.to ? ' (privat)' : ''), text: m.x, t0: time, until: time + 4.5 }; uiTone(SND.ding); if (phone.where === 'pocket' || phone.app !== 'chat') msg(m.n + ': ' + m.x, 4); }
}

// ===================================================================
// Haus kaufen (App "Immobilien"): eigener Startpunkt, Tür geht nur für dich auf. Hund kaufen (App "Tiere")
// ===================================================================
function buyHome(i) {
  const h = homes[i]; if (!h || save.house === i) return;
  if (money < h.price) return msg('Zu wenig Geld (' + h.price.toLocaleString('de-DE') + ' €)', 2.5);
  if (save.house >= 0) homes[save.house]?.drawSign(false);
  money -= h.price; save.house = i; h.drawSign(true); writeSave();
  msg('Glückwunsch! Das Haus gehört dir – hier startest du ab jetzt.', 5); uiTone(SND.arrive);
}
// Parkplatz vor dem eigenen Haus (am Straßenrand)
function homeCarSpot() { const h = homes[save.house]; if (!h) return null; const d = houseDoor(h); return { x: d.x + h.front[0] * 7.5, z: d.z + h.front[1] * 7.5, heading: Math.atan2(h.front[1], -h.front[0]) }; }
// ---------- Hund: folgt dir, setzt sich zu dir ins Auto, bellt, lässt sich streicheln ----------
SND.bark = mkBuf(.5, (t, r) => { const b = (tt) => tt > 0 && tt < .14 ? (Math.sin(2 * Math.PI * (560 - 1400 * tt) * tt) * .55 + r * .35) * Math.exp(-tt * 18) * Math.min(1, tt * 90) : 0; return b(t) + b(t - .22) * .85; });
const dog = { g: null, legs: [], tail: null, head: null, pos: V(), yaw: 0, t: 0, barkT: 6, petT: 0, sp: 0 };
function buildDog(col = 0x8b5a2b) {
  const g = new THREE.Group(), fur = M(col, { roughness: .9 }), dark = M(0x2b1a10, { roughness: .9 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(.24, .24, .55, 3, .08), fur); body.position.y = .42; g.add(body);
  const head = new THREE.Group(); head.position.set(0, .6, .3); g.add(head);
  head.add(new THREE.Mesh(new RoundedBoxGeometry(.2, .19, .2, 3, .06), fur));
  const snout = new THREE.Mesh(new RoundedBoxGeometry(.11, .09, .13, 2, .03), fur); snout.position.set(0, -.04, .14); head.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(.025, 8, 6), dark); nose.position.set(0, -.02, .21); head.add(nose);
  for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.BoxGeometry(.06, .12, .03), dark); ear.position.set(s * .08, .06, -.02); ear.rotation.z = s * .5; head.add(ear); const eye = new THREE.Mesh(new THREE.SphereGeometry(.018, 6, 5), dark); eye.position.set(s * .05, .03, .1); head.add(eye); }
  const legs = []; for (const [x, z] of [[-.08, .2], [.08, .2], [-.08, -.2], [.08, -.2]]) { const pv = new THREE.Group(); pv.position.set(x, .34, z); const l = new THREE.Mesh(new THREE.BoxGeometry(.06, .34, .06), fur); l.position.y = -.17; pv.add(l); g.add(pv); legs.push(pv); }
  const tail = new THREE.Group(); tail.position.set(0, .5, -.27); const tm = new THREE.Mesh(new THREE.BoxGeometry(.04, .04, .22), fur); tm.position.z = -.1; tm.rotation.x = .6; tail.add(tm); g.add(tail);
  const bl = new THREE.Mesh(BLOB_GEO, blobMat); bl.rotation.x = -Math.PI / 2; bl.position.y = .03; bl.scale.setScalar(.9); g.add(bl);
  shade(g, true, false); scene.add(g);
  return { g, legs, tail, head };
}
function animDog(D, sp, dt, sit) {
  D.t = (D.t || 0) + dt * (4 + sp * 2.2);
  const sw = sp > .2 ? Math.sin(D.t * 2.2) * Math.min(.7, sp * .25) : 0;
  D.legs.forEach((l, i) => { l.rotation.x = (i === 0 || i === 3 ? sw : -sw); });
  D.tail.rotation.y = Math.sin(D.t * (D.petT > 0 ? 6 : 3)) * (D.petT > 0 ? .9 : .45);
  D.g.children[0].rotation.x = sit ? -.35 : 0;                             // sitzen: Rücken schräg
}
function updDog(dt) {
  if (!save.dog) { if (dog.g) dog.g.visible = false; return; }
  if (!dog.g) { Object.assign(dog, buildDog()); dog.pos.set(headWorld.x + 1, surfaceAt(headWorld.x, headWorld.z), headWorld.z + 1); }
  dog.g.visible = true; dog.petT -= dt;
  // im eigenen Auto: sitzt auf dem Beifahrersitz
  if (player.inCar && vehicle.type !== 'scooter' && pcar.seats?.[1]) {
    if (dog.g.parent !== pcar.group) pcar.group.add(dog.g);
    const s = pcar.seats[1]; dog.g.position.set(s.x, s.y - .95, s.z + .1); dog.g.rotation.set(0, 0, 0); dog.g.scale.setScalar(.85);
    animDog(dog, 0, dt, true); pcar.group.localToWorld(dog.pos.copy(dog.g.position)); dog.inCar = true; return;
  }
  if (dog.g.parent !== scene) { scene.add(dog.g); dog.g.scale.setScalar(1); }
  if (dog.inCar) { dog.inCar = false; dog.pos.y = surfaceAt(dog.pos.x, dog.pos.z); }
  camera.getWorldDirection(v2); v2.y = 0; v2.normalize();
  const tx = headWorld.x - v2.x * 1.3 + v2.z * .6, tz = headWorld.z - v2.z * 1.3 - v2.x * .6, dx = tx - dog.pos.x, dz = tz - dog.pos.z, d = Math.hypot(dx, dz);
  if (d > 30) { dog.pos.set(tx, 0, tz); }
  const want = d > 6 ? 7 : d > 1 ? 2.6 : 0; dog.sp += (want - dog.sp) * Math.min(1, dt * 4);
  if (d > .3) { dog.yaw = lerpAngle(dog.yaw, Math.atan2(dx, dz), Math.min(1, dt * 6)); dog.pos.x += dx / d * dog.sp * dt; dog.pos.z += dz / d * dog.sp * dt; }
  pushOutOf(dog.pos, .3); dog.pos.y = surfaceAt(dog.pos.x, dog.pos.z);
  dog.g.position.copy(dog.pos); dog.g.rotation.set(0, dog.yaw, 0);
  animDog(dog, dog.sp, dt, dog.sp < .2);
  // streicheln: Hand an den Kopf
  for (const h of hands) if (h.ctrl && dog.head.getWorldPosition(v1).distanceTo(h.ctrl.getWorldPosition(v3)) < .28 && dog.petT < -1) { dog.petT = 1.5; haptic(h, .3, 120); playAt(SND.bark, dog.g.position, .5, 4); }
  dog.barkT -= dt;
  if (dog.barkT <= 0) { dog.barkT = rand(10, 30); const busy = peds.some(p => p.alive && p.root.position.distanceTo(dog.pos) < 8) || [...net.players.values()].some(p => p.root.position.distanceTo(dog.pos) < 8); if (busy || Math.random() < .35) { playAt(SND.bark, dog.g.position, .9, 6); share('bark', { p: dog.pos.toArray().map(r2) }); } }
}
// Hund eines anderen Spielers (aus seinem Zustand)
function updRemoteDog(p, dt) {
  const a = p.st?.dg;
  if (!a) { if (p.dog) p.dog.g.visible = false; return; }
  if (!p.dog) { p.dog = buildDog(); p.dog.pos = V(a[0], a[1], a[2]); p.dog.yaw = a[3]; }
  const D = p.dog; D.g.visible = true; const q = D.g.position, ox = q.x, oz = q.z;
  q.x += (a[0] - q.x) * Math.min(1, dt * 8); q.y += (a[1] - q.y) * Math.min(1, dt * 8); q.z += (a[2] - q.z) * Math.min(1, dt * 8);
  D.yaw = lerpAngle(D.yaw, a[3], Math.min(1, dt * 8)); D.g.rotation.set(0, D.yaw, 0);
  const sp = Math.hypot(q.x - ox, q.z - oz) / Math.max(dt, .001); animDog(D, sp, dt, a[4] === 1 || sp < .2);
}

// ===================================================================
// Handy-Video mit Ton (eigene Stimme + alles was man hört, auch andere Spieler)
// ===================================================================
const rec = { active: false, mr: null, chunks: [], can: null, g: null, dest: null, t0: 0, src: null, next: 0 };
function startRec() {
  if (rec.active || typeof MediaRecorder === 'undefined') { if (!rec.active) msg('Video-Aufnahme wird hier nicht unterstützt', 3); return; }
  AC.resume();
  const [c, g] = C(rt.width, rt.height); rec.can = c; rec.g = g; g.fillRect(0, 0, c.width, c.height);
  rec.dest = AC.createMediaStreamDestination();
  try { listener.getInput().connect(rec.dest); } catch (e) { }
  if (net.mic) { try { rec.src = AC.createMediaStreamSource(net.mic); rec.src.connect(rec.dest); } catch (e) { } }
  const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...rec.dest.stream.getAudioTracks()]);
  const mime = ['video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported?.(m)) || '';
  try { rec.mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : undefined); } catch (e) { msg('Aufnahme nicht möglich', 3); return; }
  rec.chunks = [];
  rec.mr.ondataavailable = e => { if (e.data.size) rec.chunks.push(e.data); };
  rec.mr.onstop = () => {
    const type = rec.mr.mimeType || 'video/webm', blob = new Blob(rec.chunks, { type }), url = URL.createObjectURL(blob);
    const [th, tg] = C(rec.can.width, rec.can.height); tg.drawImage(rec.can, 0, 0);
    const vid = document.createElement('video'); vid.src = url; vid.loop = true; vid.playsInline = true;
    addGallery({ type: 'clip', url, blob, thumb: th, vid, ext: type.includes('mp4') ? 'mp4' : 'webm', len: Math.round(time - rec.t0) });
    msg('Video mit Ton gespeichert', 3); phone.drawT = 0;
  };
  rec.mr.start(250); rec.active = true; rec.t0 = time;
}
function stopRec() {
  if (!rec.active) return; rec.active = false;
  try { rec.mr.stop(); } catch (e) { }
  try { listener.getInput().disconnect(rec.dest); } catch (e) { }
  try { rec.src?.disconnect(); } catch (e) { } rec.src = null;
}
function recFrame() {
  if (!rec.active || time < rec.next) return; rec.next = time + 1 / 30;
  grabRT(c => { if (rec.g) rec.g.drawImage(c, 0, 0); });   // asynchron -> Aufnahme ruckelt das Spiel nicht
}

// ===================================================================
// Multiplayer: andere Spieler sehen, Sprach-Chat (leiser je weiter weg), echte Anrufe
// ===================================================================
const net = { ws: null, id: 0, online: false, players: new Map(), name: '', mic: null, sendT: 0, started: false };
try { net.name = localStorage.getItem('svr_name') || ''; } catch (e) { }
if (!net.name) { net.name = 'Spieler' + Math.floor(rand(100, 999)); try { localStorage.setItem('svr_name', net.name); } catch (e) { } }
{
  const el = document.getElementById('name');
  if (el) { el.value = net.name; el.oninput = () => { net.name = el.value.trim().slice(0, 16) || net.name; try { localStorage.setItem('svr_name', net.name); } catch (e) { } if (net.online) netSend({ t: 'hello', name: net.name }); }; }
}
let humanTpl = null, npcCarGeo = null;
const netSend = o => { if (net.ws?.readyState === 1) net.ws.send(JSON.stringify(o)); };
function netSig(to, data) { if (to) netSend({ t: 'sig', to, ...data }); }
async function startOnline() {
  if (net.started) return; net.started = true;
  const onl = document.getElementById('online');
  try {
    net.mic = await Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      new Promise((_, no) => setTimeout(() => no(new Error('Zeit abgelaufen')), 12000))]);
    if (onl) onl.textContent = 'Mikrofon an ✓';
  } catch (e) { msg('Kein Mikrofon: du hörst die anderen, aber sie dich nicht', 5); if (onl) onl.textContent = 'Kein Mikrofon'; }
  netConnect();
}
function netConnect() {
  let ws; try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); } catch (e) { return; }
  net.ws = ws;
  ws.onopen = () => { net.online = true; netSend({ t: 'hello', name: net.name }); phone.drawT = 0; };
  ws.onmessage = e => { try { onNet(JSON.parse(e.data)); } catch (err) { console.warn(err); } };
  ws.onclose = () => {
    const was = net.online; net.online = false;
    if (phone.call) endCall();
    for (const p of net.players.values()) removePlayer(p); net.players.clear();
    if (was) msg('Verbindung zum Server verloren', 3);
    setTimeout(netConnect, 3000);
  };
}
function onNet(m) {
  if (m.t === 'welcome') {
    net.id = m.id;
    // Auto steht noch unberührt am Start -> auf den eigenen Parkplatz stellen
    const gp = pcar.group.position;
    if (!player.inCar && Math.hypot(gp.x - SPAWN.car[0], gp.z - SPAWN.car[1]) < 1) { const [x, z] = spawnCarPos(); gp.set(x, groundAt(x, z), z); }
    return;
  }
  if (m.t === 'list') {
    const ids = new Set();
    for (const { id, name } of m.players) {
      if (id === net.id) continue; ids.add(id);
      let p = net.players.get(id);
      if (!p) {
        p = addPlayer(id, name); net.players.set(id, p);
        if (net.id < id) connectRTC(p);
        msg(name + ' ist beigetreten', 3);
        // Host schickt dem Neuen den aktuellen Zustand der Welt (Feuer, Kaputtes, Wetter)
        if (amHost()) setTimeout(() => netSig(id, { snap: makeSnap() }), 1500);
      } else if (p.name !== name) { p.name = name; setTag(p); }
    }
    for (const p of [...net.players.values()]) if (!ids.has(p.id)) {
      msg(p.name + ' ist offline', 3); if (phone.call?.id === p.id) endCall('Verbindung weg');
      removePlayer(p); net.players.delete(p.id);
    }
    phone.drawT = 0; return;
  }
  if (m.t === 'sig' && m.snap) { applySnap(m.snap); return; }
  if (m.t === 'ev') { applyEv(m); return; }
  if (m.t === 'npc') { if (!amHost() && m.from === hostId()) applyNpc(m); return; }
  const p = net.players.get(m.from); if (!p) return;
  if (m.t === 's') { rideNote(p, p.st, m); carSnap(p, m); p.st = m; p.last = time; return; }
  if (m.t === 'scr') { showRemoteScreen(p, m.d); return; }
  if (m.t === 'sig') {
    if (m.rtc) onRTC(p, m.rtc);
    if (m.call === 'ring') { if (phone.call || phone.seq) netSig(p.id, { call: 'busy' }); else startIncoming(p.name, p.id); }
    if (m.call === 'accept' && phone.call?.id === p.id) { phone.call.state = 'active'; phone.call.t0 = time; openApp('incall', false); callAudio(p.id, true); }
    if (m.call === 'busy' && phone.call?.id === p.id) endCall('Besetzt');
    if (m.call === 'end' && phone.call?.id === p.id) { if (phone.call.state === 'ring') phone.missed = p.name; endCall(phone.call.state === 'dial' ? 'Abgelehnt' : 'Aufgelegt'); }
    if (m.hit) onHit(m.hit, p);
    if (m.arrest && wanted.stars) { const fine = busted(p.name + ' (Polizei)'); netSig(p.id, { reward: Math.max(200, fine) }); }   // von einem Polizisten festgenommen
    if (m.reward) { money += m.reward; save.st.arrest++; msg('Festnahme erfolgreich! +' + m.reward + ' €', 4); uiTone(SND.arrive); }
    if (m.killed) { msg('Du hast ' + p.name + ' erledigt!', 3); money += 100; }
  }
}
const hostId = () => Math.min(net.id, ...net.players.keys());
function setTag(p) {
  const [c, g] = C(256, 64); g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.roundRect(4, 4, 248, 56, 28); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 32px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.name, 128, 33);
  if (p.tag) p.tag.material.map.dispose(); else { p.tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true })); p.tag.scale.set(.8, .2, 1); scene.add(p.tag); }
  p.tag.material.map = T(c, false); p.tag.material.needsUpdate = true;
}

// ---------- PvP: Leben, Treffer, Tod ----------
let hurt = 0, lastHurt = -99;
function pvpHit(pl, dmg) { netSig(pl.id, { hit: dmg }); haptic(handBy('right'), .8, 60); }
function onHit(dmg, from) {
  if (player.dead) return;
  player.hp -= dmg; hurt = 1; lastHurt = time;
  hands.forEach(h => haptic(h, 1, 120));
  if (player.hp <= 0) { player.hp = 0; die('Erledigt von ' + from.name); netSig(from.id, { killed: 1 }); }
  else msg(`Getroffen von ${from.name}! ${Math.round(player.hp)} HP`, 2);
}

// ---------- Avatar der anderen Spieler ----------
const armMat = M(0x2c312b, { roughness: .9 }), gloveMat = M(0x111111, { roughness: .7 });
const CYL = new THREE.CylinderGeometry(.045, .04, 1, 8).translate(0, .5, 0);
function limb() { const m = new THREE.Mesh(CYL, armMat); m.castShadow = true; scene.add(m); return m; }
function setLimb(m, a, b) { const d = v3.subVectors(b, a), L = d.length(); m.position.copy(a); m.scale.set(1, Math.max(.01, L), 1); m.quaternion.setFromUnitVectors(UP, d.normalize()); }
function makeAvatar(p) {
  if (p.body) p.root.remove(p.body);
  const body = new THREE.Group(); p.body = body; p.root.add(body); p.mixer = null; p.bones = {};
  if (humanTpl) {
    const m = AS.cloneSkinned(humanTpl.scene); m.rotation.y = Math.PI;
    m.traverse(o => {
      if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(.55, .6, .75)); }
      if (o.isBone) { if (/LeftArm$/.test(o.name)) p.bones.la = o; if (/RightArm$/.test(o.name)) p.bones.ra = o; if (/Head$/.test(o.name)) p.bones.head = o; }
    });
    body.add(m); p.mixer = new THREE.AnimationMixer(m);
    const walk = humanTpl.animations.find(a => /walk/i.test(a.name)), idle = humanTpl.animations.find(a => /idle/i.test(a.name));
    p.walk = walk && p.mixer.clipAction(walk).play(); p.idle = idle && p.mixer.clipAction(idle).play();
  } else {
    box(.45, .7, .28, M(0x223355), 0, 1.2, 0, body); box(.35, .85, .22, M(0x111111), 0, .43, 0, body);
  }
  if (!p.hands) {
    p.hands = [0, 1].map(() => { const g = new THREE.Group(); g.add(box(.08, .1, .12, gloveMat, 0, -.01, .03)); scene.add(g); return { g, up: limb(), lo: limb(), tool: null, toolName: '' }; });
    // Kopf: Gesicht + SWAT-Helm + Schutzbrille (Kopf schaut nach -z)
    p.headM = new THREE.Group(); scene.add(p.headM);
    const face = new THREE.Mesh(new THREE.SphereGeometry(.1, 20, 16), M(0xc89a7a, { roughness: .75 })); face.scale.set(.92, 1.15, 1); face.position.set(0, -.03, -.012); p.headM.add(face);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(.125, 24, 14, 0, Math.PI * 2, 0, Math.PI * .55), M(0x3b4236, { roughness: .7 })); helmet.scale.set(1, 1, 1.08); helmet.position.set(0, .005, .008); p.headM.add(helmet);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.124, .012, 8, 32), M(0x2c3229, { roughness: .8 })); rim.rotation.x = Math.PI / 2; rim.position.y = -.015; rim.scale.set(1, 1.08, 1); p.headM.add(rim);
    const goggles = new THREE.Mesh(new THREE.CylinderGeometry(.106, .106, .045, 24, 1, true, Math.PI * .72, Math.PI * .56), M(0x0a0d10, { roughness: .05, metalness: .9, side: THREE.DoubleSide })); goggles.position.set(0, -.012, -.01); p.headM.add(goggles);
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(.103, .103, .022, 24, 1, true), M(0x15171a, { roughness: .9, side: THREE.DoubleSide })); strap.position.set(0, -.012, -.01); p.headM.add(strap);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(.04, .006, .01), M(0x6a3a30)); mouth.position.set(0, -.085, -.104); p.headM.add(mouth);
    shade(p.headM, true, false);
    // Handy in der Hand (mit live übertragenem Bildschirm)
    const [sc] = C(90, 192); p.scrCan = sc; p.scrTex = new THREE.CanvasTexture(sc); p.scrTex.colorSpace = THREE.SRGBColorSpace;
    p.phone = new THREE.Group(); p.phone.add(new THREE.Mesh(new RoundedBoxGeometry(.078, .162, .011, 3, .008), M(0x23262b)));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(.068, .146), new THREE.MeshBasicMaterial({ map: p.scrTex, toneMapped: false })); scr.position.z = .006; p.phone.add(scr);
    p.phone.visible = false; scene.add(p.phone);
    // unsichtbare Trefferbox für PvP
    p.hit = new THREE.Mesh(BOX, HIDDEN); p.hit.scale.set(.55, 1.85, .45); p.hit.userData.ent = { kind: 'player', p }; scene.add(p.hit); shootables.push(p.hit);
  }
}
function showRemoteScreen(p, d) {
  const img = new Image();
  img.onload = () => { p.scrCan.getContext('2d').drawImage(img, 0, 0, 90, 192); p.scrTex.needsUpdate = true; };
  img.src = d;
}
const TOOL_BY_NAME = n => TOOLS.find(t => t.name === n);
function setRemoteTool(hd, name) {
  if (hd.toolName === name) return;
  if (hd.tool) hd.g.remove(hd.tool);
  hd.tool = null; hd.toolName = name;
  const t = TOOL_BY_NAME(name); if (!t) return;
  hd.tool = t.vis.clone(true); hd.tool.position.add(V(0, -.01, .03)); hd.g.add(hd.tool);
}
// Beitritts-Effekt: Lichtsäule + Funken
const joinFx = [];
function joinBeam(pos) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, 40, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.position.copy(pos).setY(20); scene.add(m); joinFx.push({ m, t: 0 });
  for (let i = 0; i < 60; i++) fireSmall.spawn(pos.x + rand(-.8, .8), rand(0, 2), pos.z + rand(-.8, .8), rand(-1, 1), rand(2, 8), rand(-1, 1), rand(.5, 1.2));
  playAt(SND.whoosh, pos, 2, 10);
}
function addPlayer(id, name) {
  const root = new THREE.Group(); scene.add(root);
  const p = { id, name, root, st: null, pc: null, pa: null, first: true, hp: V(), hq: new THREE.Quaternion() };
  makeAvatar(p); setTag(p); root.visible = false;
  return p;
}
function removePlayer(p) {
  if (player.ride?.id === p.id) leaveRide(p.name + ' ist offline – ausgestiegen');
  if (p.eng) { p.eng.stop(); p.eng.pa.parent?.remove(p.eng.pa); p.eng = null; }
  for (const c of p.copMeshes || []) removeCop(c); p.copMeshes = [];
  if (p.dog) scene.remove(p.dog.g); if (p.siren) p.siren.stop();
  scene.remove(p.root); if (p.tag) scene.remove(p.tag); if (p.carMesh) scene.remove(p.carMesh);
  if (p.hands) { for (const h of p.hands) scene.remove(h.g, h.up, h.lo); scene.remove(p.headM, p.phone, p.hit); const i = shootables.indexOf(p.hit); if (i >= 0) shootables.splice(i, 1); }
  try { p.pc?.close(); } catch (e) { }
  try { p.pa?.disconnect(); p.pa?.parent?.remove(p.pa); } catch (e) { }
  if (p.audioEl) p.audioEl.srcObject = null;
}
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
function makePC(p) {
  const pc = new RTCPeerConnection(ICE); p.pc = pc;
  pc.onicecandidate = e => { if (e.candidate) netSig(p.id, { rtc: { c: e.candidate.toJSON() } }); };
  pc.ontrack = e => attachVoice(p, e.streams[0] || new MediaStream([e.track]));
  return pc;
}
async function connectRTC(p) {
  try {
    const pc = makePC(p), tr = net.mic?.getAudioTracks()[0];
    if (tr) pc.addTransceiver(tr, { direction: 'sendrecv', streams: [net.mic] }); else pc.addTransceiver('audio', { direction: 'recvonly' });
    await pc.setLocalDescription(await pc.createOffer());
    netSig(p.id, { rtc: { d: pc.localDescription.toJSON() } });
  } catch (e) { console.warn('RTC', e); }
}
async function onRTC(p, r) {
  try {
    if (r.d?.type === 'offer') {
      const pc = p.pc || makePC(p);
      await pc.setRemoteDescription(r.d);
      const tr = net.mic?.getAudioTracks()[0], t = pc.getTransceivers()[0];
      if (t) { if (tr) { await t.sender.replaceTrack(tr); t.sender.setStreams?.(net.mic); t.direction = 'sendrecv'; } else t.direction = 'recvonly'; }
      await pc.setLocalDescription(await pc.createAnswer());
      netSig(p.id, { rtc: { d: pc.localDescription.toJSON() } });
      for (const c of p.ice || []) await pc.addIceCandidate(c); p.ice = [];
    } else if (r.d) await p.pc?.setRemoteDescription(r.d);
    if (r.c) { if (p.pc?.remoteDescription) await p.pc.addIceCandidate(r.c); else (p.ice ||= []).push(r.c); }
  } catch (e) { console.warn('RTC', e); }
}
// Sprach-Chat: linear leiser, bis ca. 70 m hörbar (wie im echten Leben)
function attachVoice(p, stream) {
  if (p.pa) return;
  const el = new Audio(); el.srcObject = stream; el.muted = true; el.play().catch(() => { }); p.audioEl = el; // Chrome braucht das, damit Ton fließt
  AC.resume();
  p.stream = stream;
  const pa = new THREE.PositionalAudio(listener);
  pa.setMediaStreamSource(stream); pa.setDistanceModel('linear'); pa.setRefDistance(3); pa.setMaxDistance(70); pa.setRolloffFactor(1); pa.setVolume(2);
  p.headM.add(pa); p.pa = pa;
  if (phone.call?.id === p.id && phone.call.state === 'active') callAudio(p.id, true);
}
// Im Telefonat: Stimme direkt am Ohr statt aus der Entfernung
function callAudio(id, on) {
  callAmbience(id, on);                                                 // der andere hört auch deine Umgebung
  const p = net.players.get(id); if (!p?.pa) return;
  if (on && cp.conn && cp.mesh) { cp.mesh.add(p.pa); p.pa.position.set(0, 0, 0); }   // CarPlay: Stimme aus den Auto-Lautsprechern
  else if (on && phone.where === 'holder' && !player.inCar) { phoneG.add(p.pa); p.pa.position.set(0, 0, 0); }   // Handy liegt im Auto: Stimme kommt von dort
  else if (on) { camera.add(p.pa); p.pa.position.set(0, 0, -.15); } else { p.headM.add(p.pa); p.pa.position.set(0, 0, 0); }
}

// ---------- eigene Pose senden ----------
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _p = V(), _s = V();
const pose = o => { o.updateWorldMatrix(true, false); o.matrixWorld.decompose(_p, _q, _s); return [..._p.toArray(), ..._q.toArray()].map(v => Math.round(v * 1000) / 1000); };
const camPose = (x, y, z) => { const o = V(x, y, z).applyMatrix4(camera.matrixWorld); camera.getWorldQuaternion(_q); return [...o.toArray(), ..._q.toArray()].map(v => Math.round(v * 1000) / 1000); };
const r3 = v => Math.round(v * 1000) / 1000;
const _fq = new THREE.Quaternion(), _lq = new THREE.Quaternion();
// Welt -> Auto-Koordinaten (Position [+ Drehung])
function toLocal(fr, a) {
  const p = fr.worldToLocal(V(a[0], a[1], a[2])), out = [r3(p.x), r3(p.y), r3(p.z)];
  if (a.length === 7) { fr.getWorldQuaternion(_fq).invert(); _lq.set(a[3], a[4], a[5], a[6]).premultiply(_fq); out.push(r3(_lq.x), r3(_lq.y), r3(_lq.z), r3(_lq.w)); }
  return out;
}
function myState() {
  const L = handBy('left'), Rh = handBy('right'), vr = xrOn(), c = pcar;
  const toolOf = h => h?.held?.type === 'tool' ? h.held.t.name : '';
  const st = {
    t: 's', tm: r3(performance.now() / 1000),   // Zeitstempel: damit die anderen dein Auto ruckelfrei zwischen den Updates berechnen
    p: camera.getWorldPosition(V()).toArray().map(r3), q: camera.getWorldQuaternion(_q).toArray().map(r3),
    l: vr && L ? pose(L.ctrl) : camPose(-.24, -.55, -.12),
    r: vr && Rh ? pose(Rh.ctrl) : desk.tool ? pose(desk.tool.obj) : camPose(.24, -.55, -.12),
    tl: vr ? toolOf(L) : '', tr: vr ? toolOf(Rh) : desk.tool?.name || '',
    pp: phoneG.visible && phone.where === 'hand' ? pose(phoneG) : 0,
    c: 0, d: player.dead ? 1 : 0,
  };
  const gp = c.group.position;
  if (player.inCar) {
    // Ort, Lage, Federung und Tempo – damit die anderen dein Auto flüssig und mit Stoßdämpfern sehen
    const so = c.susOut || [0, 0, 0];
    st.c = [r2(gp.x), r2(gp.y), r2(gp.z), r3(c.heading), vehicle.id, r3(-(c.slS || 0)), r3(vehicle.type === 'scooter' ? c.lean || 0 : c.sdS || 0), r3(so[0]), r3(so[1]), r3(so[2]),
      r2(Math.sin(c.heading) * c.speed), r2(Math.cos(c.heading) * c.speed), r3(c.yawRate || 0)];
  } else if (carBoot) st.pk = [r2(gp.x), r2(gp.y), r2(gp.z), r3(c.heading), vehicle.id];   // geparktes Auto sehen die anderen auch
  if (c.doors.some(d => d.a > .01)) st.da = c.doors.map(d => r2(d.a));
  if (player.ride) st.rd = [player.ride.id, player.ride.seat];
  if (c.wins?.[0] > .01) st.wd = r2(c.wins[0]);                       // mein Fahrerfenster
  if (player.ride?.win > .01) st.rw = r2(player.ride.win);              // mein Fenster als Mitfahrer
  if (c.dmg) { const D = c.dmg; st.dm = (D.hl ? 1 : 0) | (D.tl ? 2 : 0) | (D.ws ? 4 : 0) | (D.all ? 8 : 0) | (D.wb << 4) | ((D.off || 0) << 8) | (D.tot ? 4096 : 0); }
  if (c.dents?.length) st.dl = c.dents.flatMap(d => [...d.q, d.d[0], d.d[1], d.d[2] || 0, d.s]);   // je Delle 7 Zahlen
  if (c.bend) st.bd = [r3(c.bend.x), r3(c.bend.z)];                     // schiefe Karosserie
  if (c.fly) st.fly = 1;                                                // Auto wird gerade vom Tornado herumgewirbelt
  if (wanted.stars) st.ws = wanted.stars;                                // Fahndungssterne (Polizisten sehen dich)
  if (wanted.cops.length) st.cops = wanted.cops.map(c => [r2(c.g.position.x), r2(c.g.position.z), r2(c.yaw)]);
  if (player.inCar && vehicle.type !== 'scooter') st.fu = r2(save.fuel);
  const tn = save.tune[vehicle.id]; if (tn && vehicle.type !== 'scooter') st.tn = [tn.p || 0, tn.r || 0, tn.n || 0];
  if (save.house >= 0) st.home = save.house;
  if (save.dog && dog.g) st.dg = [r2(dog.pos.x), r2(dog.pos.y), r2(dog.pos.z), r2(dog.yaw), dog.inCar ? 1 : 0];
  if (job.siren) st.sir = 1;
  // CarPlay des Fahrers, damit Mitfahrer dasselbe auf den Displays sehen
  if (player.inCar && cp.on) st.cp = { a: cp.app, k: cp.conn ? 1 : 0, m: cp.callMin ? 1 : 0, n: nav.on && POI[nav.n] ? nav.n : '', c: phone.call && cp.conn && phone.call.state !== 'offline' ? [phone.call.name, phone.call.state, Math.round(time - (phone.call.t0 || time))] : 0, r: radio.on ? radio.st : -1 };
  st.lk = pcar.locked ? 1 : 0;                                          // abgeschlossen?
  if (alarm.on) st.al = 1;                                              // Auto-Alarm (Licht + Hupe bei allen)
  // Im Auto: Kopf, Hände und Handy relativ zum Auto senden -> bei Tempo hängt nichts hinterher
  const fr = player.inCar ? c.group : player.ride ? rideCar() : null;
  if (fr) {
    st.lc = 1;
    for (const k of ['p', 'l', 'r', 'pp']) if (st[k]) st[k] = toLocal(fr, st[k]);
    fr.getWorldQuaternion(_fq).invert(); st.q = _lq.fromArray(st.q).premultiply(_fq).toArray().map(r3);
  }
  return st;
}
let scrT = 0;
function sendScreen(dt) {
  scrT -= dt; if (scrT > 0 || !phoneG.visible) return; scrT = .25;
  let near = false; for (const p of net.players.values()) if (p.root.position.distanceTo(headWorld) < 25) near = true;
  if (!near) return;
  const [c, g] = sendScreen.c || (sendScreen.c = C(90, 192));
  const send = cam => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 90, 192);
    if (cam) g.drawImage(cam, 0, 0, 90, 192);
    g.drawImage(pCan, 0, 0, 90, 192);
    netSend({ t: 'scr', d: c.toDataURL('image/jpeg', .55) });
  };
  if (feed.visible) grabRT(send); else send(null);              // Kamerabild asynchron holen (kein Ruckler)
}
let npcT = 0;
function updNet(dt) {
  for (let i = joinFx.length - 1; i >= 0; i--) { const j = joinFx[i]; j.t += dt; j.m.material.opacity = .8 * (1 - j.t / 2.5); j.m.scale.x = j.m.scale.z = 1 + j.t * .6; if (j.t > 2.5) { scene.remove(j.m); joinFx.splice(i, 1); } }
  if (!net.online) { if (player.ride) leaveRide('Verbindung weg – ausgestiegen'); return; }
  // erst alle Autos bewegen, dann Mitfahrer + Avatare daran festmachen (sonst zittern sie ein Bild hinterher)
  for (const p of net.players.values()) updRemoteCar(p, dt);
  // Mitfahrer: wirbelt der Tornado das Auto herum, kannst du rausgeschleudert werden
  if (player.ride) { const o = net.players.get(player.ride.id); if (o?.st?.fly && !player.ride.ejChk) { player.ride.ejChk = true; if (Math.random() < .65) ejectPlayer(V(rand(-16, 16), rand(8, 13), rand(-16, 16))); } }
  if (player.ride) { rideSeat(); camera.getWorldPosition(headWorld); }
  net.sendT -= dt;
  if (net.sendT <= 0) { net.sendT = .08; netSend(myState()); }
  if (net.players.size && amHost()) { npcT -= dt; if (npcT <= 0) { npcT = .12; netSend(npcPacket()); } }
  sendScreen(dt);
  const k = Math.min(1, dt * 12);
  for (const p of net.players.values()) {
    updAvatar(p, dt, k); updRemoteCops(p, dt); updRemoteDog(p, dt);
    // Tuning + Sirene am Auto des anderen
    const tk = p.st?.tn ? p.st.tn.join(',') : ''; if (p.carMesh && (tk !== p.tuneKey || p.tuneMesh !== p.carMesh)) { p.tuneKey = tk; p.tuneMesh = p.carMesh; p.tunePaint = null; p.rimMats = null; if (p.neon) { p.neon.parent?.remove(p.neon); p.neon = null; } applyRemoteTune(p, p.st?.tn); }
    if (!!p.st?.sir !== !!p.siren && AC.state === 'running' && p.carMesh) { if (p.st?.sir) { p.siren = sirenVoice(); p.carMesh.add(p.siren.pa); } else { p.siren.stop(); p.siren.pa.parent?.remove(p.siren.pa); p.siren = null; } }
    // Stimme: Fenster zu = draußen hört man nichts (im selben Auto immer); im Telefonat nicht dämpfen
    if (p.pa && !(phone.call?.id === p.id && phone.call.state === 'active')) { const f = hearFactor(p); if (Math.abs(f - (p.hf ?? 1)) > .02) { p.hf = f; p.pa.setVolume(2 * f); } }
  }
  updRideScreens(dt);
}

// ---------- Mitfahren: in das Auto eines anderen Spielers einsteigen ----------
const SEAT_NAMES = ['Fahrer', 'Beifahrer', 'hinten links', 'hinten rechts'];
const rideCar = () => { const d = player.ride && net.players.get(player.ride.id); return d?.carMesh?.visible ? d.carMesh : null; };
// Auto, an dem ein Spieler gerade festgemacht ist (als Fahrer oder Mitfahrer)
function carFrame(p, s, self) {
  if (s.c) return self ? pcar.group : p.carMesh?.visible ? p.carMesh : null;
  if (s.rd) {
    if (self) return rideCar();
    if (s.rd[0] === net.id) return pcar.group;                          // sitzt in meinem Auto (auch wenn ich nicht drin bin)
    const d = net.players.get(s.rd[0]); return d?.carMesh?.visible ? d.carMesh : null;
  }
  return null;
}
const seatTaken = (id, i) => [...net.players.values()].some(o => o.st?.rd && o.st.rd[0] === id && o.st.rd[1] === i);
// nächster freier Sitz im Auto eines anderen Spielers (gefahren oder geparkt). Fahrersitz nur, wenn der Besitzer nicht drin sitzt.
function rideTarget(reach = 1.6) {
  let best = null;
  for (const d of net.players.values()) {
    const s = d.st, c = s?.c || s?.pk, cm = d.carMesh;
    if (!c || !cm?.visible || d.carType === 'scooter' || s.d) continue;
    if (s.c && Math.hypot(s.c[10] || 0, s.c[11] || 0) > 3) continue;     // nur wenn es (fast) steht
    const seats = metaOf(d.carType).seats;
    for (let i = s.c ? 1 : 0; i < seats.length; i++) {
      if (seatTaken(d.id, i)) continue;                                  // Platz besetzt
      const w = cm.localToWorld(v1.copy(seats[i])), dist = Math.hypot(w.x - headWorld.x, w.z - headWorld.z);
      if (dist < (best ? best.dist : reach)) best = { p: d, seat: i, dist, locked: s.lk !== 0 };
    }
  }
  return best;
}
function startRide(t) {
  if (t.locked ?? t.p.st?.lk !== 0) {                                   // abgeschlossen: Türgriff rüttelt nur
    playAt(SND.click, headWorld, 1, 3); hands.forEach(h => haptic(h, .5, 60));
    msg('Abgeschlossen – ' + t.p.name + ' muss das Auto am Display entsperren', 3); return false;
  }
  for (const h of hands) if (h.held?.type === 'door' || h.held?.type === 'wheel') release(h);
  player.ride = { id: t.p.id, seat: t.seat };
  player.calib.copy(camera.position);
  if (xrOn() && player.stand) player.calib.y = Math.max(camera.position.y, player.stand);
  player.recalT = xrOn() ? time + 1.5 : 0;
  if (!xrOn()) { desk.yaw = 0; desk.pitch = -.1; }
  (t.p.dp ||= {})[t.seat] = 1.4;                                       // Tür geht kurz auf und zu
  msg((t.p.st?.c ? 'Du fährst bei ' + t.p.name + ' mit' : 'Du sitzt in ' + t.p.name + 's Auto') + ' (' + SEAT_NAMES[t.seat] + ') · ' + (xrOn() ? 'B' : 'F') + ' = Aussteigen', 4);
  return true;
}
function leaveRide(why) {
  const r = player.ride; if (!r) return;
  player.ride = null;
  const d = net.players.get(r.id), cm = d?.carMesh;
  if (cm) {
    const meta = metaOf(d.carType), s = meta.seats[r.seat] || meta.seats[1], side = Math.sign(s.x) || 1;
    cm.updateMatrixWorld(true); cm.localToWorld(v2.set(side * (meta.half.x + .9), 0, s.z));
    placeHeadAt(v2.x, v2.z); (d.dp ||= {})[r.seat] = 1.4;
  }
  if (why !== '') msg(why || 'Ausgestiegen', 2);
}
// Sitzplatz im fremden Auto: Kopf genau auf den Sitz, Blick in Fahrtrichtung
function rideSeat() {
  const d = net.players.get(player.ride.id), cm = d?.carMesh;
  if (!d || !(d.st?.c || d.st?.pk) || !cm?.visible || d.st.d) return leaveRide((d ? d.name : 'Der Fahrer') + ' ist weg – ausgestiegen');
  const seats = metaOf(d.carType).seats;
  if (player.ride.seat === 0 && d.st.c) {                               // Besitzer steigt ein -> Fahrersitz frei machen
    const free = [1, 2, 3].find(i => i < seats.length && !seatTaken(d.id, i));
    if (free === undefined) return leaveRide(d.name + ' ist eingestiegen – kein Platz mehr');
    player.ride.seat = free; msg(d.name + ' ist eingestiegen – du sitzt jetzt ' + SEAT_NAMES[free], 3);
  }
  const seat = seats[player.ride.seat] || seats[seats.length - 1];
  const head = cm.localToWorld(v1.copy(seat));
  dolly.rotation.set(0, d.cyaw + Math.PI, 0);
  const off = v2.copy(player.calib).applyAxisAngle(UP, dolly.rotation.y);
  dolly.position.set(head.x - off.x, head.y - off.y + player.seatOff, head.z - off.z);
}
// Meldungen + Türen, wenn jemand ein- oder aussteigt
function rideNote(p, a, b) {
  const was = a?.rd ? a.rd.join(':') : '', now = b.rd ? b.rd.join(':') : '';
  if (was === now) return;
  for (const r of [a?.rd, b.rd]) if (r) {
    if (r[0] === net.id) { const dr = pcar.doors[r[1]]; if (dr && !dr.grab) dr.pulse = 1.4; }
    else { const dp = net.players.get(r[0]); if (dp) (dp.dp ||= {})[r[1]] = 1.4; }
  }
  if (b.rd?.[0] === net.id) msg(p.name + ' fährt bei dir mit (' + SEAT_NAMES[b.rd[1]] + ')', 3);
  else if (a?.rd?.[0] === net.id) msg(p.name + ' ist ausgestiegen', 2);
}

// ---------- Autos der anderen: ruckelfrei, Federung, Räder, Türen ----------
// Jedes Update hat einen Zeitstempel. Gezeigt wird das Auto 0,12 s "in der Vergangenheit", weich zwischen zwei
// Updates berechnet (mit Ort UND Tempo) -> kein Ruckeln, auch wenn Pakete unregelmäßig ankommen. Für Mitfahrer wichtig.
const CAR_DELAY = .12;
function carSnap(p, m) {
  if (!m.c || !m.tm) { p.cbuf = null; return; }
  const b = p.cbuf || (p.cbuf = []), last = b[b.length - 1];
  if (last && m.tm <= last.tm) return;
  if (last && (Math.hypot(m.c[0] - last.c[0], m.c[2] - last.c[2]) > 40 || m.c[4] !== last.c[4])) b.length = 0;   // zurückgesetzt / anderes Auto
  b.push({ tm: m.tm, c: m.c }); if (b.length > 16) b.shift();
  // Uhr-Abstand (+ Laufzeit) zum anderen Gerät: kleinster Wert der letzten 3 s (wird in updRemoteCar weich nachgeführt)
  const now = performance.now() / 1000, offs = p.offs || (p.offs = []);
  offs.push([now, now - m.tm]); while (offs.length && offs[0][0] < now - 3) offs.shift();
  p.offT = Math.min(...offs.map(o => o[1]));
}
// weicher Übergang zwischen zwei Punkten mit Tempo (Hermite)
const herm = (p0, v0, p1, v1, s, T) => { const s2 = s * s, s3 = s2 * s; return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * T * v0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * T * v1; };
// Fahrzustand zur Zeit rt: [x, z, yaw, Luft, Nicken, Rollen, Kar.-Nicken, Kar.-Rollen, Kar.-Höhe, Tempo vorwärts]
function carAt(p, rt) {
  const b = p.cbuf, air = c => Math.max(0, c[1] - surfaceAt(c[0], c[2])), fv = c => (c[10] || 0) * Math.sin(c[3]) + (c[11] || 0) * Math.cos(c[3]);
  let i = b.length - 1; while (i > 0 && b[i].tm > rt) i--;
  const A = b[i], B = b[i + 1];
  if (!B || rt < A.tm) {                                             // nichts Neueres da: kurz mit Tempo weiterrechnen
    const c = A.c, t = clamp(rt - A.tm, 0, .3);
    return [c[0] + (c[10] || 0) * t, c[2] + (c[11] || 0) * t, c[3] + (c[12] || 0) * t, air(c), c[5] || 0, c[6] || 0, c[7] || 0, c[8] || 0, c[9] || 0, fv(c)];
  }
  const a = A.c, c = B.c, T = Math.max(.001, B.tm - A.tm), s = clamp((rt - A.tm) / T, 0, 1), L = (u, v) => u + (v - u) * s;
  const ya = a[3], yb = ya + wrapA(c[3] - ya);
  return [herm(a[0], a[10] || 0, c[0], c[10] || 0, s, T), herm(a[2], a[11] || 0, c[2], c[11] || 0, s, T), herm(ya, a[12] || 0, yb, c[12] || 0, s, T),
    L(air(a), air(c)), L(a[5] || 0, c[5] || 0), L(a[6] || 0, c[6] || 0), L(a[7] || 0, c[7] || 0), L(a[8] || 0, c[8] || 0), L(a[9] || 0, c[9] || 0), L(fv(a), fv(c))];
}
function updRemoteCar(p, dt) {
  const s = p.st, c = s && (s.c || s.pk);
  if (!c) { if (p.carMesh) p.carMesh.visible = false; p.car = null; return; }
  const type = c[4] || 'ferrari';
  // echtes Modell da? Sonst nachladen und das Ersatz-Auto ersetzen, sobald es fertig ist (vorher blieb es ein Klotz)
  const q = type === 'scooter' || vehicleCache[type] ? 2 : 0;
  if (!q) needRemoteModel(type);
  if (!p.carMesh || p.carType !== type || p.carQ < q) {
    if (p.carMesh) scene.remove(p.carMesh);
    const cm = p.carMesh = remoteVehicleMesh(type); p.carType = type; p.carQ = q; scene.add(cm); cm.visible = false;
    p.cmCh = cm.getObjectByName('chassis'); p.cmWheels = []; p.cmDoors = []; p.cmScreens = [];
    cm.traverse(o => { if (o.name === 'wheel') p.cmWheels.push(o); if (/^door\d$/.test(o.name)) p.cmDoors[+o.name[4]] = o; if (o.isMesh && o.userData.screen) p.cmScreens.push({ m: o, orig: o.material }); });
    p.cmHandles = p.cmDoors.map(pv => pv?.getObjectByName('handle') || null);   // echte Türgriffe zum Einsteigen
    p.cmWins = p.cmDoors.map((pv, i) => { const l = []; pv?.children.forEach(o => { if (o.isMesh && o.userData.win === i) l.push({ m: o, y0: o.position.y, drop: o.userData.drop }); }); return l.length ? l : null; });
    p.winVal = p.cmDoors.map(() => 0);
    p.alarmOn = false; p.dentN = 0; p.dmSeen = 0;
  }
  const cm = p.carMesh;
  cm.visible = true;
  let k = [c[0], c[2], c[3], 0, 0, 0, 0, 0, 0, 0];                   // geparkt: einfach hinstellen
  if (s.c && p.cbuf?.length) {
    // Anzeige-Uhr läuft gleichmäßig mit und gleicht Abweichungen nur ganz langsam aus (max. 5 %) -> kein Ruckeln
    if (p.off === undefined || Math.abs(p.offT - p.off) > .5) p.off = p.offT;
    else p.off += clamp(p.offT - p.off, -dt * .05, dt * .05);
    p.crt = performance.now() / 1000 - p.off - CAR_DELAY; k = carAt(p, p.crt);
  }
  p.cyaw = k[2];
  cm.position.set(k[0], surfaceAt(k[0], k[1]) + k[3], k[1]);
  cm.rotation.set(k[4], k[2], k[5], 'YXZ');
  // Stoßdämpfer: Karosserie federt wie beim Fahrer (wer drin sitzt, sieht es nur dezent)
  if (p.cmCh) {
    const f = player.ride?.id === p.id ? .35 : 1, L = p.sl || (p.sl = {});
    const sr = spring(L, 'r', 0, dt, 50, 7), sh = spring(L, 'h', 0, dt, 110, 8);   // Wippen nach Türschlag
    p.cmCh.rotation.x = k[6] * f + (s.bd ? s.bd[0] : 0); p.cmCh.rotation.z = (k[7] + sr) * f + (s.bd ? s.bd[1] : 0); p.cmCh.position.y = (k[8] + sh) * f;   // bd = schiefe Karosserie
  }
  // Räder drehen sich mit dem Tempo
  for (const w of p.cmWheels) { const sp = w.children[0]; if (sp) sp.rotation.x += k[9] / .34 * dt; }
  // Motor von draußen hören
  remoteEngine(p, k, !!s.c);
  // Türen: wie beim Besitzer offen, bzw. kurz auf und zu, wenn jemand ein-/aussteigt
  for (let i = 0; i < p.cmDoors.length; i++) {
    const pv = p.cmDoors[i]; if (!pv) continue;
    let tgt = (s.da && s.da[i]) || 0;
    if (p.dp?.[i] > 0) { p.dp[i] -= dt; if (p.dp[i] > .7) tgt = Math.max(tgt, .9); }
    pv.userData.a = (pv.userData.a || 0) + (tgt - (pv.userData.a || 0)) * Math.min(1, dt * 6);
    pv.rotation.y = -pv.userData.side * pv.userData.a;
    doorSound(pv.userData, pv.userData.a, pv, dt, s => slamCar(p.sl || (p.sl = {}), pv.userData.side, s));   // Tür auf: Klacken, zu: dumpfer Schlag + Auto wippt
  }
  // Fenster: Fahrer (wd), Mitfahrer (rw) – mein eigener Sitz sofort aus meiner Eingabe
  for (let i = 0; i < p.winVal.length; i++) {
    let t = i === 0 ? (s.wd || 0) : 0;
    if (i > 0) for (const o of net.players.values()) if (o.st?.rd && o.st.rd[0] === p.id && o.st.rd[1] === i) t = o.st.rw || 0;
    if (player.ride?.id === p.id && player.ride.seat === i) t = player.ride.win || 0;
    p.winVal[i] += clamp(t - p.winVal[i], -dt / 2.2, dt / 2.2);
    setGlass(p.cmWins[i], p.winVal[i]);
  }
  // Unfallschäden des Besitzers: Dellen (Liste), Lichter/Scheiben (Bitmaske); repariert -> Auto neu aufbauen
  const dl = s.dl || [], nd = dl.length / 7, dm = s.dm || 0;
  if (nd < p.dentN || (dm === 0 && p.dmSeen)) { p.carQ = -1; }
  else {
    if (nd > p.dentN) { const full = cm.isLOD ? cm.levels[0].object : cm, root = full.getObjectByName('chassis') || full; for (let i = p.dentN; i < nd; i++) applyDent(root, cm, { q: dl.slice(i * 7, i * 7 + 3), d: dl.slice(i * 7 + 3, i * 7 + 6), s: dl[i * 7 + 6] }); p.dentN = nd; }
    if (dm !== p.dmSeen) { applyRemoteDamage(p, dm); p.dmSeen = dm; }
  }
  if (dm & 4096 && Math.random() < dt * 5) { const f = cm.localToWorld(V(0, 1, 1.6)); smoke.spawn(f.x, f.y, f.z, rand(-.4, .4), rand(1.5, 3), rand(-.4, .4), rand(3, 5)); }   // Totalschaden: Motor qualmt
  // Auto-Alarm des Besitzers: Licht + Blinker blinken, Hupe piept, Displays zeigen "!"
  const al = !!s.al;
  if (al !== p.alarmOn) { p.alarmOn = al; for (const sc of p.cmScreens) sc.m.material = al ? alMat : sc.orig; if (!al) carLights(cm, false); }
  if (al) { drawAlarmScreen(); carLights(cm, Math.floor(time * 2.5) % 2 === 0); p.alarmT = (p.alarmT || 0) - dt; if (p.alarmT <= 0) { p.alarmT = .9; playAt(SND.beep, cm.position, 2.2, 14); } }
  cm.updateMatrixWorld(true);
  p.car = s.c || null;
}


// Avatar aus einem Zustand (Kopf, Hände, Handy) bewegen – für andere Spieler und für dich selbst (Selfie)
const _frq = new THREE.Quaternion(), _tq = new THREE.Quaternion();
function updAvatar(p, dt, k, self = false) {
  const s = p.st; if (!s) return;
  if (humanTpl && !p.mixer) makeAvatar(p);
  const r = p.root;
  // Im Auto kommen Kopf/Hände relativ zum Auto: am (geglätteten) Auto festmachen und dort glätten -> nichts hängt hinterher
  const fr = s.lc ? carFrame(p, s, self) : null;
  if (s.lc && !fr) return;
  if (fr) fr.getWorldQuaternion(_frq);
  const snap = p.first || p.mode !== !!fr; p.mode = !!fr;            // Wechsel Auto <-> zu Fuß: springen statt quer durch die Welt gleiten
  const toW = (pos, q) => { if (fr) { fr.localToWorld(pos); if (q) q.premultiply(_frq); } };
  p.sp = p.sp || V(); p.sq = p.sq || new THREE.Quaternion();
  const tp = V(s.p[0], s.p[1], s.p[2]); _tq.fromArray(s.q);
  if (snap) { p.sp.copy(tp); p.sq.copy(_tq); } else { p.sp.lerp(tp, k); p.sq.slerp(_tq, k); }
  p.hp.copy(p.sp); p.hq.copy(p.sq); toW(p.hp, p.hq);
  if (p.first) { p.first = false; if (!self) { r.visible = true; joinBeam(V(p.hp.x, 0, p.hp.z)); } }
  const yaw = _e.setFromQuaternion(p.hq, 'YXZ').y;
  const inCar = !!s.c || !!s.rd;
  // Körper unter dem Kopf
  const ox = r.position.x, oz = r.position.z;
  const back = V(0, 0, 1).applyAxisAngle(UP, yaw).multiplyScalar(self ? .17 : .08);   // eigener Körper etwas hinter der Kamera (kein Blick in den Hals)
  // Körper folgt dem Kopf: beim Ducken/Hocken wird er gestaucht statt dass der Kopf in den Körper rutscht
  const gnd = surfaceAt(p.hp.x, p.hp.z), headH = p.hp.y - gnd;
  r.position.set(p.hp.x + back.x, Math.max(gnd, p.hp.y - 1.62), p.hp.z + back.z);
  r.scale.y = inCar ? 1 : clamp(headH / 1.62, .45, 1.08);
  r.rotation.set(s.d ? -Math.PI / 2 : 0, yaw + Math.PI, 0, 'YXZ');
  const sp = snap ? 0 : Math.hypot(r.position.x - ox, r.position.z - oz) / Math.max(dt, .001);
  if (p.mixer) {
    p.walk?.setEffectiveWeight(sp > .4 && !inCar ? 1 : 0); p.idle?.setEffectiveWeight(sp > .4 && !inCar ? 0 : 1); p.mixer.update(dt * clamp(sp / 1.4, .7, 2));
    if (p.bones.la) p.bones.la.scale.setScalar(.001); if (p.bones.ra) p.bones.ra.scale.setScalar(.001);   // eigene Arme ersetzen die Animations-Arme
    if (p.bones.head) p.bones.head.scale.setScalar(.001);
  }
  p.body.visible = !inCar;
  // Helm-Kopf folgt dem echten Kopf (nicken, umschauen)
  p.headM.position.copy(p.hp); p.headM.quaternion.copy(p.hq); p.headM.visible = !s.d;
  // Hände + Arme (IK) – sieht man auch im Auto
  p.hands.forEach((hd, i) => {
    const a = i === 0 ? s.l : s.r; if (!a) return;
    hd.sp = hd.sp || V(); hd.sq = hd.sq || new THREE.Quaternion();
    const ta = V(a[0], a[1], a[2]), tqa = new THREE.Quaternion(a[3], a[4], a[5], a[6]);
    if (snap || !hd.init) { hd.sp.copy(ta); hd.sq.copy(tqa); hd.init = true; } else { hd.sp.lerp(ta, k); hd.sq.slerp(tqa, k); }
    hd.g.position.copy(hd.sp); hd.g.quaternion.copy(hd.sq); toW(hd.g.position, hd.g.quaternion);
    if (!self) setRemoteTool(hd, i === 0 ? s.tl : s.tr);   // bei dir selbst ist die echte Waffe schon in der Hand
    const sh = V((i === 0 ? 1 : -1) * .19, 1.43, 0).applyMatrix4(r.matrixWorld.compose(r.position, r.quaternion, r.scale));
    if (inCar) sh.copy(p.hp).add(V((i === 0 ? 1 : -1) * .19, -.22, 0).applyAxisAngle(UP, yaw + Math.PI));
    const hand = hd.g.position.clone(), dir = hand.clone().sub(sh), d = Math.min(dir.length(), .58); dir.normalize();
    const end = sh.clone().addScaledVector(dir, d);
    const side = V((i === 0 ? 1 : -1), 0, 0).applyAxisAngle(UP, yaw + Math.PI);
    const pole = V(0, -1, 0).addScaledVector(side, .6).addScaledVector(V(0, 0, 1).applyAxisAngle(UP, yaw), .3);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = sh.clone().addScaledVector(dir, d / 2).addScaledVector(pole, Math.sqrt(Math.max(0, .29 * .29 - d * d / 4)));
    setLimb(hd.up, sh, elbow); setLimb(hd.lo, elbow, end);
    hd.g.visible = hd.up.visible = hd.lo.visible = !s.d;
  });
  // Handy
  p.phone.visible = !self && !!s.pp && !s.d;
  if (s.pp) { p.phone.position.set(s.pp[0], s.pp[1], s.pp[2]); p.phone.quaternion.set(s.pp[3], s.pp[4], s.pp[5], s.pp[6]); toW(p.phone.position, p.phone.quaternion); }
  if (self) return;
  p.hit.position.set(r.position.x, r.position.y + .92, r.position.z); p.hit.visible = !inCar && !s.d;
  p.tag.position.set(p.hp.x, p.hp.y + .45, p.hp.z);
}

document.addEventListener('pointerdown', startOnline, { once: true });
window.addEventListener('error', e => msg('Fehler: ' + String(e.message || '').slice(0, 70), 8));

// ===================================================================
// 3D-Modelle laden und einsetzen
// ===================================================================
const loadEl = document.getElementById('load');
AS.setProgress(k => { if (loadEl) loadEl.textContent = k >= 1 ? '3D-Modelle geladen ✓' : `3D-Modelle werden geladen … ${Math.round(k * 100)} %`; });
const fixMats = root => root.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m.transmission) { m.transmission = 0; m.transparent = true; m.opacity = .5; } }); } });
const safe = (name, p, fn) => p.then(fn).catch(e => console.warn('Modell konnte nicht geladen werden:', name, e));

const STEER_RE = /steer|lenk|(^|_)sw(#|_|$)/i;
function orientCar(parts, keepScale = false) {
  // nach vorne (+z) drehen, auf den Boden stellen, zentrieren, auf 4,6 m skalieren
  const bb = new THREE.Box3(); parts.forEach(p => { p.geo.computeBoundingBox(); bb.union(p.geo.boundingBox); });
  const size = bb.getSize(V()), m = new THREE.Matrix4();
  if (size.x > size.z) { m.makeRotationY(Math.PI / 2); parts.forEach(p => p.geo.applyMatrix4(m)); }
  const steer = parts.filter(p => STEER_RE.test(p.name));
  const sb = new THREE.Box3(); steer.forEach(p => { p.geo.computeBoundingBox(); sb.union(p.geo.boundingBox); });
  bb.makeEmpty(); parts.forEach(p => { p.geo.computeBoundingBox(); bb.union(p.geo.boundingBox); });
  const ctr = bb.getCenter(V());
  if (steer.length && sb.getCenter(V()).z < ctr.z) { m.makeRotationY(Math.PI); parts.forEach(p => p.geo.applyMatrix4(m)); }
  bb.makeEmpty(); parts.forEach(p => { p.geo.computeBoundingBox(); bb.union(p.geo.boundingBox); });
  // Maßeinheit erkennen: Meter, Zentimeter (z.B. Sketchfab-Export) – sonst auf 4,6 m bringen
  const len = bb.getSize(V()).z, okLen = l => l > 3 && l < 7;
  const s = keepScale && okLen(len) ? 1 : keepScale && okLen(len * 100) ? 100 : keepScale && okLen(len / 100) ? .01 : 4.6 / len, c2 = bb.getCenter(V());
  m.makeTranslation(-c2.x, -bb.min.y, -c2.z).premultiply(new THREE.Matrix4().makeScale(s, s, s));
  parts.forEach(p => { p.geo.applyMatrix4(m); p.geo.computeBoundingBox(); });
  bb.makeEmpty(); parts.forEach(p => bb.union(p.geo.boundingBox));
  return bb;
}
const partBox = list => { const b = new THREE.Box3(); list.forEach(p => b.union(p.geo.boundingBox)); return b; };

// Türen im Modell erkennen ("Door_FL", "door_rr" …) – Halter/Scharniere bleiben an der Karosserie
const doorKeyOf = n => { if (/limiter|hinge|scharnier/i.test(n)) return null; const m = n.match(/door[\s_.-]*(front|rear|f|r)[\s_.-]*(left|right|l|r)(?![a-z])/i); return m ? (m[1][0] + m[2][0]).toUpperCase() : null; };
// zusammenhängende Stücke einer Geometrie (der Türgriff ist im Modell ein eigenes Stück)
function islands(geo) {
  const pos = geo.attributes.position, n = pos.count, par = new Int32Array(n), seen = new Map(), out = new Map();
  for (let i = 0; i < n; i++) par[i] = i;
  const f = a => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  const u = (a, b) => { a = f(a); b = f(b); if (a !== b) par[a] = b; };
  for (let i = 0; i < n; i++) { const k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4); const j = seen.get(k); if (j === undefined) seen.set(k, i); else u(i, j); }
  const ix = geo.index, T = ix ? ix.count : n;
  for (let t = 0; t < T; t += 3) { const a = ix ? ix.getX(t) : t; u(a, ix ? ix.getX(t + 1) : t + 1); u(a, ix ? ix.getX(t + 2) : t + 2); }
  for (let i = 0; i < n; i++) { const r = f(i); let b = out.get(r); if (!b) out.set(r, b = new THREE.Box3()); b.expandByPoint(v1.fromBufferAttribute(pos, i)); }
  return [...out.values()];
}
// Echten Türgriff finden: kleines längliches Stück außen am Türblatt, hinten, etwa auf Hüfthöhe der Tür
function findHandle(list, db, side) {
  const len = db.max.z - db.min.z, h = db.max.y - db.min.y, cx = (db.min.x + db.max.x) / 2;
  let best = null, bs = 1e9;
  for (const p of list) for (const b of islands(p.geo)) {
    const s = b.getSize(V()), c = b.getCenter(V()), rz = (c.z - db.min.z) / len, ry = (c.y - db.min.y) / h;
    if (s.z < .08 || s.z > .42 || s.y < .015 || s.y > .14 || s.x > .1 || rz > .45 || ry < .3 || ry > .85 || side * (c.x - cx) < 0) continue;
    const score = Math.abs(rz - .15) + Math.abs(ry - .6);
    if (score < bs) { bs = score; best = c.setX(c.x + side * .015); }
  }
  return best;
}
// Scharnier: vordere Kante der Tür, außen (unterhalb vom Spiegel gemessen)
function hingeOf(list, db, side) {
  const h = db.max.y - db.min.y; let mx = 0;
  for (const p of list) { const a = p.geo.attributes.position; for (let i = 0; i < a.count; i++) if (a.getZ(i) > db.max.z - .12 && a.getY(i) < db.min.y + .6 * h) mx = Math.max(mx, side * a.getX(i)); }
  if (!mx) mx = Math.max(Math.abs(db.min.x), Math.abs(db.max.x));
  return V(side * (mx - .03), db.min.y + h * .45, db.max.z - .04);
}
// Neigung der Lenksäule aus der Lenkrad-Form (das Lenkrad ist eine flache Scheibe)
function wheelTilt(list, ctr) {
  const pts = [];
  for (const p of list) { const a = p.geo.attributes.position; for (let i = 0; i < a.count; i += 3) pts.push(a.getY(i) - ctr.y, a.getZ(i) - ctr.z); }
  if (pts.length < 60) return .28;
  let best = .28, bv = 1e9; const n = pts.length / 2;
  for (let t = 0; t <= .9; t += .01) {
    const s = Math.sin(t), c = Math.cos(t); let m = 0, v = 0;
    for (let i = 0; i < pts.length; i += 2) { const d = pts[i] * s - pts[i + 1] * c; m += d; v += d * d; }
    v = v / n - (m / n) ** 2; if (v < bv) { bv = v; best = t; }
  }
  return best > .08 && best < .75 ? best : .28;
}
// Kopie für andere Spieler: eigene Materialien (sonst leuchten deren Bremslichter, wenn du bremst)
function carClone(vis) {
  const mm = new Map(), cl = m => mm.get(m) || (mm.set(m, m.clone()), mm.get(m)), out = vis.clone(true);
  out.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(cl) : cl(o.material); });
  return out;
}

// own = false: nur das Modell für andere Spieler bauen (dein eigenes Auto bleibt unverändert)
function upgradePlayerCar(gltf, id = 'ferrari', own = true) {
  const c = own ? pcar : { fl: { mats: [], orig: [] } }, parts = AS.flatten(gltf.scene);
  const bb = orientCar(parts, true), halfW = bb.max.x, top = bb.max.y;
  const triCount = gg => (gg.index ? gg.index.count : gg.attributes.position.count) / 3;
  const hasTex = m => m.map || m.normalMap || m.roughnessMap || m.metalnessMap || m.aoMap || m.emissiveMap;
  const isGlass = p => { const n = p.name + ' ' + (p.mat.name || ''); return /glass|window|scheibe/i.test(n) && !/light|lamp|red|orange|projector|reflector|chrome/i.test(n); };
  const isBody = p => /^body$/i.test(p.name) || /body|paint|lack/i.test(p.mat.name || '');
  const isInner = p => /leather|interior|carbon|plastic|trim|carpet/i.test(p.name);
  const isInt = p => /^int[_#]/i.test(p.name);                     // Innenraum-Teile ("Int_…")
  // Leistung: sehr fein unterteilte Teile ohne Textur auf 6-mm-Raster vereinfachen.
  // Der Lack bleibt original (sonst Dellen in den Spiegelungen).
  let t0 = 0, t1 = 0;
  for (const p of parts) { t0 += triCount(p.geo); p.dec = triCount(p.geo) > 4000 && !hasTex(p.mat) && !isBody(p); }
  const simp = (gg, p) => { if (!p.dec) return gg; const d = AS.decimate(gg, .006); return d.index.count ? d : gg; };
  // Schatten wirft nur eine grobe Kopie (~5.000 Dreiecke)
  const low = parts.map(p => ({ p, g: AS.decimate(p.geo, .09) })).filter(e => e.g.index.count);
  const shadowGeo = mergeGeometries(low.map(e => e.g));
  const steer = parts.filter(p => STEER_RE.test(p.name) && !/column/i.test(p.name));
  const sc = steer.length ? partBox(steer).getCenter(V()) : V(.37, top * .66, .4);
  const DX = Math.sign(sc.x) || 1;                                   // Fahrerseite (+1 = links)
  const wheelParts = parts.filter(p => !steer.includes(p) && !doorKeyOf(p.name) && /(wheel|tire|tyre|(^|[^t])rim|brake|centre|nuts|reifen|felge)/i.test(p.name + ' ' + (p.mat.name || '')) && p.geo.boundingBox.max.y < top * .55);
  const tires = wheelParts.filter(p => /(tire|tyre|reifen)/i.test(p.name + ' ' + (p.mat.name || '')));
  const frontZ = tires.length ? Math.max(...tires.map(p => p.geo.boundingBox.getCenter(V()).z)) : bb.max.z * .6;
  const zF = frontZ - .4, zR = zF - 1.15;
  c.brakeMat = c.headMat = null;

  const vis = new THREE.Group(), ch = new THREE.Group(); ch.name = 'chassis'; vis.add(ch);   // ch = Karosserie (federt), Räder folgen einzeln dem Boden
  const paint = parts.find(isBody)?.mat;
  c.bodyMat = new THREE.MeshPhysicalMaterial({ color: paint?.color && !paint.map ? paint.color.getHex() : 0x3a3f46, metalness: .6, roughness: .28, clearcoat: 1, clearcoatRoughness: .03, side: THREE.DoubleSide });   // Originalfarbe des Modells; beidseitig: keine Löcher an Kanten
  c.fl.mats[0] = c.bodyMat; c.fl.orig[0] = c.bodyMat.color.clone();
  c.glassMat = new THREE.MeshStandardMaterial({ color: 0x18202a, metalness: .9, roughness: .05, transparent: true, opacity: .45 });
  c.glassMat.userData.glass = true;                                    // (zum Wiederfinden in Kopien für andere Spieler)
  // Räder als Gruppen: lenken, drehen, federn (Teile über beide Seiten, z.B. hintere Bremse, werden geteilt)
  const wheels = {}, pieces = [];
  for (const p of wheelParts) {
    const b = p.geo.boundingBox;
    if (b.min.x < -.2 && b.max.x > .2) { for (const gg of AS.splitGeometry(p.geo, x => x > 0)) if (gg.attributes.position.count) { gg.computeBoundingBox(); pieces.push({ ...p, geo: gg }); } }
    else pieces.push(p);
  }
  for (const p of pieces) {
    const ctr = p.geo.boundingBox.getCenter(V()), key = (ctr.x > 0 ? 'r' : 'l') + (ctr.z > 0 ? 'f' : 'b');
    if (!wheels[key]) {
      const t = tires.find(q => { const qc = q.geo.boundingBox.getCenter(V()); return Math.sign(qc.x) === Math.sign(ctr.x) && Math.sign(qc.z) === Math.sign(ctr.z); });
      const wc = t ? t.geo.boundingBox.getCenter(V()) : ctr;
      const steerG = new THREE.Group(); steerG.position.copy(wc); steerG.name = 'wheel'; Object.assign(steerG.userData, { front: wc.z > 0, outer: true }); vis.add(steerG);
      const spinG = new THREE.Group(); spinG.name = 'spin'; steerG.add(spinG);
      wheels[key] = { steer: steerG, spin: spinG, front: wc.z > 0, c: wc };
    }
    const w = wheels[key], g = simp(p.geo, p).clone().translate(-w.c.x, -w.c.y, -w.c.z);
    t1 += triCount(g);
    (/brake|caliper/i.test(p.name) ? w.steer : w.spin).add(new THREE.Mesh(g, p.mat));
  }
  // Lenkrad: dreht um die echte Lenksäule
  const wb = new THREE.Group(); wb.position.copy(sc); wb.rotation.x = steer.length ? wheelTilt(steer, sc) : .28; ch.add(wb);
  const ws = new THREE.Group(); wb.add(ws);
  wb.updateMatrix(); const toWheel = wb.matrix.clone().invert();

  // ---------- Türen ----------
  // Hat das Modell eigene Türen (wie der Jetta), gehen alle am echten Scharnier auf und man greift den echten Türgriff.
  const doors = [], doorMap = new Map();
  for (const p of parts) { const k = doorKeyOf(p.name); if (k && !wheelParts.includes(p) && !steer.includes(p)) (doorMap.get(k) || doorMap.set(k, []).get(k)).push(p); }
  const realDoors = doorMap.size >= 2;
  if (realDoors) {
    for (const [key, list] of doorMap) {
      const solid = list.filter(p => !isGlass(p)), ext = solid.filter(p => !isInt(p)), use = ext.length ? ext : solid.length ? solid : list;
      const db = partBox(solid.length ? solid : list), side = Math.sign(db.getCenter(V()).x) || 1;
      const pivot = new THREE.Group(); pivot.position.copy(hingeOf(use, db, side)); ch.add(pivot);
      const found = findHandle(use, db, side);
      const hp = found || V(side * Math.max(Math.abs(db.min.x), Math.abs(db.max.x)), db.min.y + (db.max.y - db.min.y) * .5, db.min.z + (db.max.z - db.min.z) * .15);
      const handle = new THREE.Object3D(); handle.name = 'handle'; handle.position.copy(hp).sub(pivot.position); pivot.add(handle);
      doors.push({ key, pivot, handle, side, found: !!found, front: key[0] === 'F', box: db, list, a: 0, max: key[0] === 'F' ? 1.15 : 1.05, a0: Math.atan2(side * handle.position.x, -handle.position.z) });
    }
    // Reihenfolge = Sitzplätze: Fahrer, Beifahrer, hinten Fahrerseite, hinten andere Seite
    doors.sort((a, b) => (b.front - a.front) || ((b.side === DX) - (a.side === DX)));
  } else {
    // Modell ohne eigene Türen: Fahrertür aus der Karosserie ausschneiden
    const pivot = new THREE.Group(); pivot.position.set(DX * halfW * .92, .6, zF); ch.add(pivot);
    const handle = new THREE.Object3D(); handle.name = 'handle'; handle.position.set(DX * (halfW * .08 + .02), .28, -(zF - zR) + .22); pivot.add(handle);
    doors.push({ key: 'F' + (DX > 0 ? 'L' : 'R'), pivot, handle, side: DX, found: false, front: true, a: 0, max: 1.25, a0: Math.atan2(DX * handle.position.x, -handle.position.z), box: new THREE.Box3(V(Math.min(DX * halfW * .74, DX * halfW), .22, zR), V(Math.max(DX * halfW * .74, DX * halfW), top * .9, zF)) });
  }
  doors.forEach((d, i) => { d.pivot.name = 'door' + i; d.pivot.userData.side = d.side; });
  const drv = doors[0], doorOf = new Map();
  if (realDoors) doors.forEach(d => d.list.forEach(p => doorOf.set(p, d)));
  const addTo = (parent, gg, mat, p, off) => {
    if (off) gg.translate(-off.x, -off.y, -off.z);
    t1 += triCount(gg);
    const m = new THREE.Mesh(gg, mat); if (isInt(p) || /interior|leather|carpet/i.test(p.name)) m.userData.inner = true;
    if (/headlight|taillight|fog_?light/i.test(p.name)) m.userData.outer = true;   // von innen nicht zu sehen
    if (/display|screen|infotain/i.test(p.name + ' ' + (p.mat.name || ''))) m.userData.screen = true;   // Bildschirme bleiben einzeln (CarPlay)
    parent.add(m); return m;
  };
  // Große Teile in vorne/Mitte/hinten teilen: was hinter dir liegt, wird dann gar nicht erst gezeichnet
  const chunks = gg => {
    if (triCount(gg) < 12000) return [gg];
    gg.computeBoundingBox(); const b = gg.boundingBox, z1 = b.min.z + (b.max.z - b.min.z) / 3, z2 = b.min.z + (b.max.z - b.min.z) * 2 / 3;
    const [low, front] = AS.splitGeometry(gg, (x, y, z) => z > z2), [rear, mid] = AS.splitGeometry(low, (x, y, z) => z > z1);
    return [rear, mid, front].filter(q => q.attributes.position.count).map(q => mergeVertices(q));
  };
  let wsGeo = null;
  for (const p of parts) {
    if (wheelParts.includes(p)) continue;
    if (steer.includes(p)) { const g = simp(p.geo, p).clone().applyMatrix4(toWheel); t1 += triCount(g); ws.add(new THREE.Mesh(g, p.mat)); continue; }
    const glass = isGlass(p);
    if (glass && realDoors && isInt(p)) continue;                   // Innenseite der Scheiben: doppelt, würde die Sicht nur abdunkeln
    if (glass && !isInt(p) && /windshield|windscreen|frontscheibe/i.test(p.name) && !/rear|heck/i.test(p.name)) wsGeo = p.geo.clone();   // Frontscheibe: für Regentropfen + Wischer
    const mat = isBody(p) ? c.bodyMat : glass ? c.glassMat : p.mat;
    const d = doorOf.get(p);
    if (d) { addTo(d.pivot, simp(p.geo, p).clone(), mat, p, d.pivot.position); continue; }
    if (realDoors) { for (const gg of chunks(simp(p.geo, p))) addTo(ch, gg, mat, p); continue; }
    const thr = glass ? .5 : isInner(p) ? .7 : .74;
    const inDoor = (x, y, z) => DX * x > halfW * thr && z < zF && z > zR && y > .22 && y < top * (glass ? .94 : .9);
    const [keep, door] = AS.splitGeometry(p.geo, inDoor);
    if (keep.attributes.position.count) addTo(ch, simp(keep, p), mat, p);
    if (door.attributes.position.count) addTo(drv.pivot, simp(door, p), mat, p, drv.pivot.position);
  }
  // kein Lenkrad im Modell gefunden -> eigenes einsetzen
  if (!steer.length) { const dark = M(0x151515, { roughness: .6 }); ws.add(new THREE.Mesh(new THREE.TorusGeometry(.18, .022, 10, 32), dark)); box(.34, .03, .02, dark, 0, -.02, 0, ws); box(.03, .16, .02, dark, 0, -.1, 0, ws); }
  fixMats(vis);
  // Bremslichter / Scheinwerfer leuchten; beim Ferrari zusätzlich dunkler Innenraum
  const darkened = new Map();
  vis.traverse(o => {
    if (!o.isMesh || o.material === c.bodyMat || o.material === c.glassMat) return;
    const nm = o.material.name || '';
    if (/taillight|glow_red|brake_?light/i.test(nm)) { o.material = c.brakeMat || (c.brakeMat = Object.assign(o.material.clone(), { emissive: new THREE.Color(0xff1010), emissiveIntensity: .5 })); return; }
    if (/projector|led/i.test(nm)) { o.material = c.headMat || (c.headMat = Object.assign(o.material.clone(), { emissive: new THREE.Color(0xfff2dd), emissiveIntensity: 1.2 })); return; }
    if (realDoors || o.material.map || !/interior|leather|carpet|plastic|carbon/i.test(nm)) return;
    if (!darkened.has(o.material)) { const m = o.material.clone(); m.color.multiplyScalar(.22); darkened.set(o.material, m); }
    o.material = darkened.get(o.material);
  });
  const wasHolder = phone.where === 'holder';
  // Augenhöhe: so tief, dass man geradeaus durch die Frontscheibe schaut (nicht gegen den Dachrahmen) – kein Ducken
  vis.updateMatrixWorld(true);
  const meshes = []; ch.traverse(o => { if (o.isMesh && o.material !== c.glassMat && !ws.getObjectById(o.id)) meshes.push(o); });
  const ray = new THREE.Raycaster();
  const eye = V(sc.x, sc.y + .36, sc.z - .38);   // näher ans Lenkrad
  for (let i = 0; i < 24 && eye.y > sc.y + .1; i++) {
    let blocked = false;
    for (const dy of [0, .06]) {   // geradeaus und leicht nach oben muss frei sein
      ray.set(eye, V(0, dy, 1).normalize()); ray.far = 2.6;
      if (ray.intersectObjects(meshes, false)[0]) { blocked = true; break; }
    }
    ray.set(eye, V(0, 1, 0)); ray.far = .1; if (ray.intersectObjects(meshes, false)[0]) blocked = true;
    if (!blocked) break;
    eye.y -= .03;
  }
  eye.y = Math.max(sc.y + .1, eye.y - .1);   // insgesamt 10 cm tiefer sitzen
  // Sitzplätze: Fahrer, Beifahrer und (bei 4 Türen) die Rückbank – Kopf nie im Dachhimmel
  const roofGap = e => { ray.set(e, V(0, 1, 0)); ray.far = .6; const h = ray.intersectObjects(meshes, false)[0]; return h ? h.distance : .6; };
  const seats = [eye.clone(), V(-eye.x, eye.y, eye.z)];
  if (doors.length >= 4) for (const sx of [1, -1]) { const e = V(eye.x * sx * .95, eye.y + .02, eye.z - .86); for (let i = 0; i < 12 && roofGap(e) < .15; i++) e.y -= .02; seats.push(e); }
  // Handyhalter: steht AUF dem Armaturenbrett (vorher steckte das Handy halb darin), leicht zum Fahrer gedreht
  const holder = new THREE.Object3D(); holder.position.set(sc.x * .05, sc.y + .14, sc.z + .3); holder.rotation.set(.3, Math.PI - DX * .35, 0); ch.add(holder);
  ray.set(V(holder.position.x, eye.y + .15, holder.position.z), V(0, -1, 0)); ray.far = 1;
  const dash = ray.intersectObjects(meshes, false)[0];
  if (dash) holder.position.y = dash.point.y + .088;
  box(.09, .02, .035, M(0x111111), holder.position.x, holder.position.y - .085, holder.position.z + .01, ch);
  // Weniger Zeichenaufrufe (wichtig für die Quest): pro Bauteil alle Teile mit gleichem Material zu einem Mesh zusammenfassen.
  // Einfarbige Materialien (schwarzes Leder, Plastik, Chrom …) werden Vertexfarben in wenigen gemeinsamen Materialien.
  const vcMats = {};
  const vcMat = m => { const metal = (m.metalness ?? 0) > .5, glossy = (m.roughness ?? 1) < .4, k = (metal ? 'm' : 'd') + (glossy ? 'g' : 'r') + m.side; return vcMats[k] || (vcMats[k] = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: metal ? .85 : .05, roughness: glossy ? .25 : .7, side: m.side })); };
  const plain = m => m.isMeshStandardMaterial && m !== c.bodyMat && m !== c.brakeMat && m !== c.headMat && !m.map && !m.roughnessMap && !m.metalnessMap && !m.aoMap && !m.emissiveMap && !m.alphaMap && !m.transparent && m.opacity === 1 && !(m.emissive && m.emissive.getHex()) && !m.vertexColors;
  const mergeIn = (parent, noInner) => {
    const groups = new Map();
    for (const o of [...parent.children]) {
      if (!o.isMesh || Array.isArray(o.material) || o.userData.screen || o.material.colorWrite === false) continue;
      o.updateMatrix(); const geo = o.geometry.clone().applyMatrix4(o.matrix); let mat = o.material;
      if (plain(mat)) {
        const n = geo.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { col[i * 3] = mat.color.r; col[i * 3 + 1] = mat.color.g; col[i * 3 + 2] = mat.color.b; }
        for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); mat = vcMat(mat);
      }
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const inner = !noInner && !!o.userData.inner, outer = !!o.userData.outer;
      const key = mat.uuid + '|' + Object.keys(geo.attributes).sort().join(',') + (geo.index ? 'i' : 'n') + '|' + inner + outer;
      (groups.get(key) || groups.set(key, { mat, inner, outer, list: [] }).get(key)).list.push({ geo, o });
    }
    for (const { mat, inner, outer, list } of groups.values()) {
      if (list.length < 2) continue;
      const merged = mergeGeometries(list.map(e => e.geo)); if (!merged) continue;
      for (const e of list) parent.remove(e.o);
      for (const gg of chunks(merged)) { const m = new THREE.Mesh(gg, mat); m.userData.inner = inner; m.userData.outer = outer; parent.add(m); }
    }
  };
  mergeIn(ch); mergeIn(ws); doors.forEach(d => mergeIn(d.pivot, true));
  for (const w of Object.values(wheels)) { mergeIn(w.steer); mergeIn(w.spin); }
  // Fensterscheiben in den Türen (zum Runterlassen): fahren um ihre eigene Höhe in die Tür
  const doorGlass = doors.map((d, i) => {
    const l = [];
    for (const o of d.pivot.children) if (o.isMesh && o.material === c.glassMat) {
      o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox;
      o.userData.win = i; o.userData.drop = (bb.max.y - bb.min.y) * .92; l.push({ m: o, y0: o.position.y, drop: o.userData.drop });
    }
    return l.length ? l : null;
  });
  // Innenraum heller: dunkle Materialien bekommen mehr Umgebungslicht vom Himmel (sonst sieht man in VR drinnen kaum etwas)
  const litM = new Set();
  vis.traverse(o => { if (!o.isMesh || !o.userData.inner) return; for (const m of [].concat(o.material)) if (m.isMeshStandardMaterial && m !== c.bodyMat && m !== c.glassMat && !litM.has(m)) { litM.add(m); m.envMapIntensity = 2.6; liftMat(m); } });
  // Infotainment-Display für CarPlay: der Bildschirm in der Mittelkonsole (am weitesten mittig)
  let screen = null;
  ch.traverse(o => { if (o.isMesh && o.userData.screen) { o.geometry.computeBoundingBox(); const ax = Math.abs(o.geometry.boundingBox.getCenter(V()).x); if (!screen || ax < screen.ax) screen = { m: o, ax }; } });
  if (!screen) {   // Modell ohne Display: eigenes in die Mitte vom Armaturenbrett setzen
    const pg0 = new THREE.PlaneGeometry(.24, .12);
    const m = new THREE.Mesh(pg0,M(0x050608, { roughness: .2 })); m.position.set(0, holder.position.y - .17, holder.position.z - .12); m.lookAt(eye.x * .3, eye.y, eye.z); ch.add(m);
    screen = { m };
  }
  c.screen = screen.m;
  // zweites Display hinter dem Lenkrad (das dem Lenkrad am nächsten liegt)
  let cluster = null;
  ch.traverse(o => { if (o.isMesh && o.userData.screen && o !== c.screen) { o.geometry.computeBoundingBox(); const d = Math.abs(o.geometry.boundingBox.getCenter(V()).x - sc.x); if (!cluster || d < cluster.d) cluster = { m: o, d }; } });
  c.cluster = cluster ? cluster.m : null;
  const uvBounds = m => { const a = m.geometry.attributes.uv; if (!a) return null; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (let i = 0; i < a.count; i++) { u0 = Math.min(u0, a.getX(i)); u1 = Math.max(u1, a.getX(i)); v0 = Math.min(v0, a.getY(i)); v1 = Math.max(v1, a.getY(i)); } return u1 - u0 > .05 && v1 - v0 > .05 ? { u0, u1, v0, v1 } : null; };
  c.screenUV = uvBounds(c.screen); c.screenOrig = c.screen.material;
  c.clusterUV = c.cluster ? uvBounds(c.cluster) : null; c.clusterOrig = c.cluster ? c.cluster.material : null;
  // markieren, damit Mitfahrer in der Kopie die Displays finden (zeigen dann CarPlay + Tacho des Fahrers)
  Object.assign(c.screen.userData, { main: true, uvb: c.screenUV });
  if (c.cluster) Object.assign(c.cluster.userData, { cluster: true, uvb: c.clusterUV });
  c.headCol = c.headMat?.color.clone(); c.brakeCol = c.brakeMat?.color.clone();
  vehicleMeta[id] = { seats, half: V(halfW, top, bb.max.z), paint: c.bodyMat.color.getHex(), headName: c.headMat?.name, brakeName: c.brakeMat?.name };
  vehicleCache[id] = carClone(vis);
  vehicleCache[id].traverse(o => { if (o.isMesh && o.userData.inner) [].concat(o.material).forEach(liftMat); });   // Mitfahrer sehen auch etwas
  // dasselbe Auto grob vereinfacht, für andere Spieler aus der Ferne: Lack | Teile mit ihrer Farbe | Glas
  {
    const cats = [[], [], []], col = new THREE.Color();
    for (const { p, g } of low) {
      if (STEER_RE.test(p.name)) continue;
      const k = isBody(p) ? 0 : isGlass(p) ? 2 : 1, gg = g.clone();
      col.set(k !== 1 ? 0xffffff : p.mat.map || !p.mat.color ? 0x2a2a2a : p.mat.color);
      const n = gg.attributes.position.count, ca = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.toArray(ca, i * 3);
      gg.setAttribute('color', new THREE.BufferAttribute(ca, 3)); cats[k].push(gg);
    }
    const empty = () => { const gg = new THREE.BufferGeometry(); for (const [n, s] of [['position', 3], ['normal', 3], ['color', 3]]) gg.setAttribute(n, new THREE.BufferAttribute(new Float32Array(0), s)); gg.setIndex([]); return gg; };
    vehicleFar[id] = mergeGeometries(cats.map(l => l.length ? mergeGeometries(l) : empty()), true);
  }
  if (!own) { console.log('Auto für andere Spieler geladen:', id); return; }
  // eigenes Auto aus der Ferne: vereinfachte Kopie (gleicher Lack -> Tuning-Farbe passt)
  if (c.low) c.group.remove(c.low);
  c.low = new THREE.Mesh(vehicleFar[id], [c.bodyMat, lowTrimMat, c.glassMat]); c.low.visible = false; c.low.castShadow = true; c.group.add(c.low);
  buildRainFx(c, wsGeo, ch, eye);
  buildDashcam(ch, wsGeo, eye, halfW, top);                            // Dashcam an der Frontscheibe
  Object.assign(c, { doorGlass, wins: doors.map(() => 0), winT: doors.map(() => 0), dmg: null, dents: [], crack: null });                                   // Regentropfen + Scheibenwischer (nur am eigenen Auto)
  c.group.remove(c.vis); c.vis = vis; c.chassis = ch; c.group.add(vis);
  const dz = drv.box.getCenter(V()).z;
  Object.assign(c, {
    doors, wheelBase: wb, wheelSpin: ws, wheelR: steer.length ? partBox(steer).getSize(V()).x / 2 : .18,
    holder, DX, wheels: Object.values(wheels), seats,
    head: eye, seatHint: V(DX * (halfW + .4), 1.0, dz), exitPos: V(DX * (halfW + 1), 0, dz),
    half: V(halfW, top, bb.max.z),
  });
  c.hit.scale.set(halfW * 2, top, bb.max.z * 2); c.hit.position.y = top / 2;
  shade(vis, false, true);
  const proxy = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  proxy.castShadow = true; ch.add(proxy);
  if (wasHolder) setPhone('holder');
  c.paint0 = undefined; c.rimMats = null; if (c.neon) { c.group.remove(c.neon); c.neon = null; }
  applyTune(c, save.tune[id]);                                          // gespeichertes Tuning (Lack, Felgen, Neon)
  if (job.id === 'police') { c.pbar = null; policeBar(true); }
  console.log('Spieler-Auto geladen:', id, Math.round(t0), '->', Math.round(t1), 'Dreiecke, Augenhöhe', eye.y.toFixed(2), '| Türen:', doors.map(d => d.key + (d.found ? ' (echter Griff)' : '')).join(', '), '| Sitze:', seats.length);
}

function upgradeNpcCars(gltf) {
  const parts = AS.flatten(gltf.scene); const bb = orientCar(parts);
  const colorOf = p => {
    const n = (p.name + ' ' + (p.mat.name || '')).toLowerCase();
    if (/taillight|lights_red|brakes/.test(n)) return 0x9a0f0f;
    if (/projector|led|^lights/.test(n)) return 0xe8e8e8;
    if (/rim|wheel|metal|chrome|nuts/.test(n)) return 0xb9bdc2;
    if (/yellow/.test(n)) return 0xd8b400;
    return 0x141414;
  };
  const mk = cell => {
    const cats = { paint: [], trim: [], glass: [] }; const col = new THREE.Color();
    for (const p of parts) {
      if (/steer|carpet|nuts|centre/i.test(p.name)) continue;
      const g = AS.decimate(p.geo, cell); if (!g.index.count) continue;
      const cat = /^body$/i.test(p.name) ? 'paint' : /glass/i.test(p.name) ? 'glass' : 'trim';
      col.set(cat === 'trim' ? colorOf(p) : 0xffffff);
      const n = g.attributes.position.count, ca = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.toArray(ca, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(ca, 3)); cats[cat].push(g);
    }
    const empty = () => { const g = new THREE.BufferGeometry(); for (const [n, s] of [['position', 3], ['normal', 3], ['color', 3]]) g.setAttribute(n, new THREE.BufferAttribute(new Float32Array(0), s)); g.setIndex([]); return g; };
    return mergeGeometries(['paint', 'trim', 'glass'].map(k => cats[k].length ? mergeGeometries(cats[k]) : empty()), true);
  };
  const near = mk(.065), far = mk(.14);
  const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .4, roughness: .5 });
  npcCarGeo = { near, trim: trimMat };
  for (const c of allNpc) {
    c.glassMat = new THREE.MeshStandardMaterial({ color: 0x141b22, metalness: .9, roughness: .05 });
    c.bodyMat.metalness = .75; c.bodyMat.roughness = .3;
    const lod = new THREE.LOD();
    lod.addLevel(shade(new THREE.Mesh(near, [c.bodyMat, trimMat, c.glassMat])), 0);
    lod.addLevel(shade(new THREE.Mesh(far, [c.bodyMat, trimMat, c.glassMat])), 35);
    lod.addLevel(new THREE.Object3D(), c.parked ? 110 : 220);
    c.group.remove(c.vis); c.vis = lod; c.group.add(lod);
    c.half = V(bb.max.x, bb.max.y, bb.max.z);
    c.hit.scale.set(bb.max.x * 2, bb.max.y, bb.max.z * 2); c.hit.position.y = bb.max.y / 2;
  }
  console.log('NPC-Autos:', near.index.count / 3, '/', far.index.count / 3, 'Dreiecke');
}

// weicher dunkler Fleck unter Fußgängern (statt teurer Echtzeit-Schatten)
const BLOB_GEO = new THREE.CircleGeometry(.42, 20);
const blobMat = (() => { const [c, g] = C(64, 64), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.MeshBasicMaterial({ map: T(c, false), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }); })();
function upgradePeds(gA, gB) {
  humanTpl = gA;
  const clip = re => gA.animations.find(a => re.test(a.name)) || gA.animations[0];
  const walk = clip(/walk/i), run = clip(/run/i);
  // Für andere Modelle mit gleichem Skelett: nur Drehungen übernehmen – aber nicht die der Hüfte
  // (die Hüfte ist beim Soldaten anders ausgerichtet; mit ihr lief die Frau kopfüber)
  const rotOnly = c => { const k = c.clone(); k.tracks = k.tracks.filter(t => !t.name.endsWith('.position') && !/Hips\.quaternion$/.test(t.name)); return k; };
  const info = g => {
    g.scene.updateMatrixWorld(true);
    let head, foot, toe; g.scene.traverse(o => { if (o.isBone) { if (/Head$/.test(o.name)) head = o; if (/LeftFoot$/.test(o.name)) foot = o; if (/LeftToeBase$/.test(o.name)) toe = o; } });
    const hy = head ? head.getWorldPosition(V()).y : 1.6;
    const fz = foot && toe ? toe.getWorldPosition(V()).z - foot.getWorldPosition(V()).z : -1;
    return { g, s: hy > 2.5 || hy < 1 ? 1.62 / hy : 1, ry: fz > 0 ? 0 : Math.PI };
  };
  const models = [info(gA)]; if (gB) models.push(info(gB));
  figTpl = models[0];                                                     // Vorlage für Taxi-Fahrgäste
  peds.forEach((p, idx) => {
    const I = models[idx % models.length], own = I.g === gA;
    const m = AS.cloneSkinned(I.g.scene); m.scale.setScalar(I.s); m.rotation.y = I.ry;
    const tint = new THREE.Color().setHSL(Math.random(), own ? rand(.1, .4) : rand(.05, .2), own ? rand(.55, .9) : rand(.8, 1));
    m.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiply(tint); } });
    shade(m, false, false);                                             // Leistung: keine echten Schatten (28.000 Dreiecke pro Person) – dafür ein Schattenfleck
    p.root.remove(p.vis); p.vis = m; p.root.add(m);
    p.mixer = new THREE.AnimationMixer(m);
    p.walk = p.mixer.clipAction(own ? walk : rotOnly(walk)); p.run = p.mixer.clipAction(own ? run : rotOnly(run));
    p.walk.play(); p.run.play(); p.run.setEffectiveWeight(0);
    p.mixer.update(Math.random() * 2);
    // nur zeichnen, wenn im Blickfeld: Grenzkugel aus der echten (animierten) Pose, großzügig
    m.updateMatrixWorld(true);
    m.traverse(o => { if (o.isSkinnedMesh) { o.computeBoundingSphere(); o.boundingSphere.radius *= 1.6; o.frustumCulled = true; } });
    if (!p.blob) { p.blob = new THREE.Mesh(BLOB_GEO, blobMat); p.blob.rotation.x = -Math.PI / 2; p.blob.position.y = .03; p.blob.renderOrder = 1; p.root.add(p.blob); }
  });
}

function placeModel(src, target, opt = {}) {
  // Modell an Stelle eines Platzhalters setzen; Platzhalter wird unsichtbare Trefferbox
  const m = src.clone(true);
  m.traverse(o => { if (o.isMesh) o.material = o.material.clone(); });
  return m;
}
function upgradeProps(type, gltf) {
  const tpl = AS.mergeByMaterial(gltf.scene);
  for (const p of props.filter(q => q.type === type)) {
    const m = placeModel(tpl);
    if (type === 'tyre') m.rotation.x = Math.PI / 2;
    const b0 = AS.bbox(m);
    m.position.set(p.x, p.y - b0.min.y, p.z); m.rotation.y = p.ry; scene.add(m);
    const b = AS.bbox(m), size = b.getSize(V()), ctr = b.getCenter(V());
    p.mesh.material = HIDDEN; p.mesh.rotation.set(0, 0, 0); p.mesh.scale.copy(size); p.mesh.position.copy(ctr);
    p.model = m; p.fl.box.copy(b);
    const mats = []; m.traverse(o => { if (o.isMesh) mats.push(o.material); });
    p.fl.mats = mats; p.fl.orig = mats.map(x => x.color.clone());
    shade(m); cull(m, 75); freezeObj(m); freezeObj(p.mesh);
    if (p.broken) m.visible = false;
  }
}

function setToolVis(T0, g) { const w = new THREE.Group(); w.add(g); T0.obj.remove(T0.vis); T0.vis = w; T0.obj.add(w); }
function upgradeTools(id, gltf) {
  const s = gltf.scene;
  if (id === 'service_pistol') {
    const keep = []; s.traverse(o => { if (o.isMesh && /_a$/.test(o.name)) keep.push(o); });
    const g = new THREE.Group(); s.updateMatrixWorld(true);
    keep.forEach(o => { const c = o.clone(); c.applyMatrix4(o.parent.matrixWorld); g.add(c); });
    g.rotation.y = Math.PI / 2;   // Lauf zeigt nach -z
    const b = AS.bbox(g); g.position.set(-(b.min.x + b.max.x) / 2, .035 - b.max.y, -.17 - b.min.z);
    const T0 = TOOLS[1]; setToolVis(T0, g);
    T0.muzzle.position.set(0, .035 - .012, -.17);
  }
  if (id === 'sledgehammer_01') {
    const g = new THREE.Group(); g.add(s);
    // Stiel (+y) -> -z, Kopf-Längsachse (x) -> y
    s.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 1, 0), V(0, 0, -1), V(-1, 0, 0)));
    const b = AS.bbox(g); g.position.z = .12 - b.max.z;
    const T0 = TOOLS[0]; setToolVis(T0, g);
    T0.head.position.set(0, 0, b.min.z + .12 - b.max.z + .1);
  }
  if (id === 'vintage_lighter') {
    const g = new THREE.Group(); g.add(s);
    const b = AS.bbox(g); g.position.set(-(b.max.x - .02), -b.max.y + .02, 0);
    const T0 = TOOLS[2]; setToolVis(T0, g);
    T0.tip.position.set(.003, .008, 0);
  }
  fixMats(s);
}

function upgradeFacades(kit) {
  const atlas = AS.bakeFacades(renderer, kit);
  // gleiche Fenster-Anordnung auf allen Geräten
  const keepRandom = Math.random; Math.random = seeded(4242);
  try { buildFacadeMesh(atlas); } finally { Math.random = keepRandom; }
}
function buildFacadeMesh(atlas) {
  // Leistung: Fassaden in 4×4 Stücke (je 2×2 Blöcke) – nur sichtbare Stücke werden gezeichnet (auch in den Schatten)
  const chunks = new Map(), roofG = [];
  let pos, uv, col;
  const c = new THREE.Color(), e = 1.5 / 2048;
  const quad = (p0, r, h, bw, row, colI, tint, shade) => {
    const u0 = colI / 4 + e, u1 = (colI + 1) / 4 - e, v0 = row / 4 + e, v1_ = (row + 1) / 4 - e;
    const p1 = p0.clone().addScaledVector(r, bw), p2 = p1.clone().setY(p1.y + h), p3 = p0.clone().setY(p0.y + h);
    for (const [p, u, v] of [[p0, u0, v0], [p1, u1, v0], [p2, u1, v1_], [p0, u0, v0], [p2, u1, v1_], [p3, u0, v1_]]) { pos.push(p.x, p.y, p.z); uv.push(u, v); }
    c.copy(tint).multiplyScalar(shade); for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b);
  };
  for (const s of facadeSpecs) {
    const key = clamp(Math.floor((s.x + HALF) / (2 * P)), 0, 3) + ',' + clamp(Math.floor((s.z + HALF) / (2 * P)), 0, 3);
    if (!chunks.has(key)) chunks.set(key, { pos: [], uv: [], col: [], specs: [] });
    const ch = chunks.get(key); ({ pos, uv, col } = ch); ch.specs.push(s);
    const start = pos.length / 3;
    const midRow = Math.random() < .5 ? 1 : 2, midCol = Math.floor(Math.random() * 3);
    const sides = [[0, 1, s.w, s.d], [0, -1, s.w, s.d], [1, 0, s.d, s.w], [-1, 0, s.d, s.w]];
    for (const [nx, nz, L, D] of sides) {
      const n = V(nx, 0, nz), r = V(nz, 0, -nx);
      const bays = Math.max(1, Math.round(L / 3)), bw = L / bays;
      const p0 = V(s.x, 0, s.z).addScaledVector(n, D / 2 + .03).addScaledVector(r, -L / 2);
      const shadeF = 1;
      const isFront = s.front[0] === nx && s.front[1] === nz;
      for (let f = 0; f < s.F; f++) for (let i = 0; i < bays; i++) {
        const p = p0.clone().addScaledVector(r, i * bw).setY(f * 3);
        let row = midRow, ci = Math.random() < .12 ? 3 : midCol, h = 3;
        if (f === 0 && s.door && isFront && i === Math.floor(bays / 2)) continue;   // echte Tür: hier ist ein Loch (Eingang)
        if (f === 0) { row = 0; ci = isFront && i === Math.floor(bays / 2) ? 0 : s.shops && isFront ? 1 : (midCol === 1 ? 3 : 2); }
        else if (f === s.F - 1 && !s.house) { row = 3; ci = midCol; h = 3.75; }
        quad(p, r, h, bw, row, ci, s.tint, shadeF);
      }
    }
    const count = pos.length / 3 - start;
    s.ent.fl.facade = { start, count, orig: new Float32Array(col.slice(start * 3, (start + count) * 3)) };
    // Box wird unsichtbar (bleibt für Treffer/Kollision), Dach kommt in ein gemeinsames Mesh
    s.ent.mesh.material = HIDDEN; s.ent.fl.mats = []; s.ent.fl.orig = [];
    if (!s.house) roofG.push(new THREE.PlaneGeometry(s.w, s.d).rotateX(-Math.PI / 2).translate(s.x, s.h, s.z));
  }
  // alle Dächer zusammenfassen: 2 Draw-Calls statt ~250
  scene.add(freezeObj(shade(new THREE.Mesh(mergeGeometries(roofG), M(0x6f7174, { roughness: .95 })))));
  const cones = houseRoofs.map(r => {
    r.updateMatrixWorld(); const gg = r.geometry.clone().applyMatrix4(r.matrixWorld).toNonIndexed();
    const cc = r.material.color.clone().lerp(new THREE.Color(1, 1, 1), .5), ca = new Float32Array(gg.attributes.position.count * 3);
    for (let i = 0; i < ca.length; i += 3) { ca[i] = cc.r; ca[i + 1] = cc.g; ca[i + 2] = cc.b; }
    gg.setAttribute('color', new THREE.BufferAttribute(ca, 3)); r.material = HIDDEN; return gg;
  });
  if (cones.length) scene.add(freezeObj(shade(new THREE.Mesh(mergeGeometries(cones), roofTileMat))));
  // PBR: echtes Licht, Schatten, Fenster spiegeln den Himmel
  const mat = new THREE.MeshStandardMaterial({ map: atlas.albedo, normalMap: atlas.normal, roughnessMap: atlas.rough, metalness: 0, vertexColors: true, envMapIntensity: 1.3 });
  let tris = 0;
  for (const ch of chunks.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ch.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(ch.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(ch.col, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    for (const s of ch.specs) s.ent.fl.facade.attr = g.attributes.color;   // zum Schwärzen bei Feuer
    const mesh = new THREE.Mesh(g, mat); mesh.castShadow = mesh.receiveShadow = true; scene.add(freezeObj(mesh));
    tris += ch.pos.length / 9;
  }
  facadeColors = true;
  console.log('Fassaden:', tris, 'Dreiecke in', chunks.size, 'Stücken');
}

function upgradeGround(tex) {
  const { asphalt, pavers, grass, roof, lawn } = tex;
  if (asphalt?.map) {
    const img = asphalt.map.image;
    const [c, g] = C(1024, 2048); drawRoad(g, 1024, 2048, img);
    const rt2 = T(c); rt2.repeat.set(1, ROAD_L / 32);
    MAT.road.map = rt2; MAT.road.normalMap = asphalt.normalMap; asphalt.normalMap.repeat.set(4, ROAD_L / 4); MAT.road.needsUpdate = true;
    const ia = asphalt.map.clone(); ia.needsUpdate = true; ia.repeat.set(4, 4); MAT.inter.map = ia; MAT.inter.needsUpdate = true;
    const la = asphalt.map.clone(); la.needsUpdate = true; la.repeat.set(16, 16); MAT.lot.map = la; MAT.lot.needsUpdate = true;
    const [hc, hg] = C(1024, 512); drawHighway(hg, 1024, 512, img); const ht = T(hc); ht.repeat.set(1, 3000 / 15); MAT.hw.map = ht; MAT.hw.needsUpdate = true;
  }
  if (pavers?.map) { pavers.map.repeat.set(BLOCK / 2.5, BLOCK / 2.5); pavers.normalMap?.repeat.set(BLOCK / 2.5, BLOCK / 2.5); MAT.walk.map = pavers.map; MAT.walk.normalMap = pavers.normalMap; MAT.walk.needsUpdate = true; }
  if (grass?.map) { MAT.grass.map = grass.map; if (grass.normalMap) MAT.grass.normalMap = grass.normalMap; MAT.grass.needsUpdate = true; }
  if (lawn?.map) { MAT.park.map = lawn.map; MAT.park.needsUpdate = true; }
  if (roof?.map) { roof.map.repeat.set(3, 2); roofTileMat.map = roof.map; if (roof.normalMap) { roof.normalMap.repeat.set(3, 2); roofTileMat.normalMap = roof.normalMap; } roofTileMat.needsUpdate = true; }
}

// Echter Foto-Himmel: Hintergrund + Spiegelungen + Sonne an der richtigen Stelle
function upgradeSky(hdr) {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromEquirectangular(hdr).texture;
  scene.background = hdr; sky.visible = false;
  const { data, width: w, height: h } = hdr.image, half = data instanceof Uint16Array;
  const get = i => half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i];
  let best = 0, bx = 0, by = 0;
  for (let y = 0; y < h / 2; y += 2) for (let x = 0; x < w; x += 2) {
    const i = (y * w + x) * 4, L = get(i) * .2126 + get(i + 1) * .7152 + get(i + 2) * .0722;
    if (L > best) { best = L; bx = x; by = y; }
  }
  const lat = (.5 - (by + .5) / h) * Math.PI, lon = ((bx + .5) / w - .5) * 2 * Math.PI;
  sunDir.set(Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat)).normalize();
  if (sunDir.y < .25) sunDir.y = .25, sunDir.normalize();
  const hor = [0, 0, 0]; let n = 0; const hy = Math.floor(h * .47);
  for (let x = 0; x < w; x += 4) { const i = (hy * w + x) * 4; hor[0] += get(i); hor[1] += get(i + 1); hor[2] += get(i + 2); n++; }
  scene.fog.color.setRGB(hor[0] / n, hor[1] / n, hor[2] / n, THREE.LinearSRGBColorSpace);
  hemiBase = .7; hemi.intensity = hemiBase; sunLight.intensity = sunBase = 3.2; fogBase.copy(scene.fog.color);   // mehr Umgebungslicht = weichere, hellere Schatten
  console.log('Himmel geladen, Sonne:', sunDir.toArray().map(v => v.toFixed(2)));
}
safe('Himmel', AS.loadHDRI('kloofendal_48d_partly_cloudy_puresky', '2k'), upgradeSky);

// Reihenfolge: Werkzeuge & Auto zuerst (sieht man sofort), dann Stadt
safe('Pistole', AS.loadPoly('service_pistol'), g => upgradeTools('service_pistol', g));
safe('Vorschlaghammer', AS.loadPoly('sledgehammer_01'), g => upgradeTools('sledgehammer_01', g));
safe('Feuerzeug', AS.loadPoly('vintage_lighter'), g => upgradeTools('vintage_lighter', g));
// Eigene Autos aus assets/models/autos/*.glb (z.B. bmw.glb, urus.glb, taigo.glb, polo.glb, van.glb)
const carBootP = AS.listDir('assets/models/autos/').then(async files => {
  for (const f of files) { const id = f.replace(/\.(glb|gltf)$/i, '').toLowerCase(); if (!VEHICLES.find(v => v.id === id)) VEHICLES.push({ id, name: NICE_NAMES[id] || f.replace(/\.(glb|gltf)$/i, ''), type: 'car', file: 'assets/models/autos/' + f }); }
  const def = VEHICLES.find(v => v.id === 'bmw') || VEHICLES.find(v => v.file);
  if (def) { try { upgradePlayerCar(await AS.loadUrl(def.file), def.id); vehicle = def; return; } catch (e) { console.warn(e); } }
  upgradePlayerCar(await AS.loadCar(), 'ferrari');
});
carBootP.catch(() => { }).finally(() => { carBoot = true; });
safe('Auto', carBootP, () => AS.loadNpcCar().then(upgradeNpcCars));
safe('Menschen', Promise.all([AS.loadHuman(), AS.loadHuman2().catch(() => null)]), ([a, b]) => upgradePeds(a, b));
for (const [type, D] of Object.entries(PROP_DEF)) safe(D.model, AS.loadPoly(D.model), g => upgradeProps(type, g));
safe('Fassaden', AS.loadPoly('modular_urban_apartments_facade'), upgradeFacades);
Promise.all(['asphalt_02', 'concrete_pavers', 'aerial_grass_rock', 'clay_roof_tiles_02', 'sparse_grass'].map(id => AS.loadTex(id, ANISO).catch(() => ({}))))
  .then(([asphalt, pavers, grass, roof, lawn]) => upgradeGround({ asphalt, pavers, grass, roof, lawn }));

// ===================================================================
// Spiel-Loop
// ===================================================================
setPhone('pocket');
// Handy einmal vorbereiten (Shader + Bildschirm), damit das erste A-Drücken nicht hängt
phoneG.visible = true; composePhone(); renderer.compile(scene, camera); phoneG.visible = false;
desk.yaw = Math.PI / 2;
placeHeadAt(SPAWN.player[0], SPAWN.player[1]);
// gespeichertes eigenes Haus: dort starten, Auto steht davor
if (save.house >= 0 && homes[save.house]) {
  const hd = houseDoor(homes[save.house]), s = homeCarSpot(); placeHeadAt(hd.x, hd.z);
  pcar.group.position.set(s.x, surfaceAt(s.x, s.z), s.z); pcar.heading = s.heading; pcar.group.rotation.set(0, s.heading, 0);
  homes[save.house].drawSign(true);
}
const clock = new THREE.Clock();
let hintT = 0, cullT = 0, lastErr = '', errCount = 0;
// Absturzsichere Schleife: ein Fehler in einem Frame darf VR nie einfrieren lassen
// Messwerkzeug: window.__prof.on = true -> Zeit pro Bereich in window.__prof.t (ms, aufsummiert)
const PROF = window.__prof = { on: false, t: {}, n: 0 };
let profT = 0;
const mark = k => { if (!PROF.on) return; const n = performance.now(); PROF.t[k] = (PROF.t[k] || 0) + n - profT; profT = n; };
renderer.setAnimationLoop(() => {
  try { frame(); }
  catch (e) {
    const s = String(e?.message || e);
    if (s !== lastErr || ++errCount % 300 === 0) { lastErr = s; console.error(e); msg('Fehler: ' + s.slice(0, 70), 6); }
  }
  try { renderer.render(scene, camera); } catch (e) { console.error(e); }
  mark('render');
});
function frame() {
  if (PROF.on) { profT = performance.now(); PROF.n++; }
  const dt = Math.min(clock.getDelta(), .05); time += dt;
  camera.getWorldPosition(headWorld);
  if (xrOn()) { pollPads(); if (!player.dead) { vrInput(dt); useTools(dt); } }
  else if (startEl.style.display === 'none' && !player.dead) deskTick(dt);
  mark('input');

  belt.position.set(camera.position.x, camera.position.y - .62, camera.position.z);
  belt.rotation.y = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;

  // aufrechte Kopfhöhe beim Laufen merken (steigt sofort, sinkt langsam)
  if (xrOn() && !seated()) player.stand = Math.max((player.stand || camera.position.y) - dt * .01, camera.position.y);
  if (seated() && player.recalT && time > player.recalT) { player.recalT = 0; player.calib.x = camera.position.x; player.calib.z = camera.position.z; msg('Sitz eingestellt (Stick drücken = neu einstellen)', 2); }
  updPlayerCar(dt);
  if (player.inCar) seatPlayer();
  else if (!player.ride && !player.fly) { const gy = surfaceAt(headWorld.x, headWorld.z) + player.hOff; dolly.position.y += (gy - dolly.position.y) * Math.min(1, dt * 12); }   // Mitfahrer: Sitz wird in updNet gesetzt
  camera.getWorldPosition(headWorld);   // Kopfposition nach der Bewegung in diesem Bild aktualisieren
  // VR: Handy in der Hand dreht den Bildschirm zu den Augen -> kein Kopf-Runterbeugen,
  // und die Rückkamera filmt genau das, was hinter dem Handy liegt (wohin du schaust)
  if (xrOn() && phone.where === 'hand' && phoneG.parent !== camera) { camera.getWorldPosition(v3); phoneG.lookAt(v3); }
  mark('car');
  updNpc(dt); mark('npc'); updPeds(dt); mark('peds'); updFire(dt); updLights(dt); mark('fire+lights'); updNet(dt); mark('net');

  // Sonnenschatten folgen dem Kopf
  v3.set(Math.round(headWorld.x), Math.round(headWorld.y - 1.6), Math.round(headWorld.z));
  sunLight.target.position.copy(v3); sunLight.position.copy(v3).addScaledVector(sunDir, 200);
  if (++shadowFrame % (xrOn() ? 3 : 2) === 0) sunLight.shadow.needsUpdate = true;
  // Sichtbarkeit nach Entfernung
  cullT -= dt;
  if (cullT <= 0) {
    cullT = .25; for (const c of culls) { const d2 = c.p.distanceToSquared(headWorld); c.o.visible = !c.o.userData.gone && d2 < c.r * c.r && (!c.min || d2 >= c.min * c.min); }
    updFarTrees();
    // Innenraum der Autos nur aus der Nähe zeichnen (spart auf der Quest viele Dreiecke)
    innerVis(pcar.vis, pcar.group.position.distanceTo(headWorld) < 12);
    // eigenes Auto ab 40 m nur als vereinfachte Kopie (spart rund 300.000 Dreiecke pro Bild)
    if (pcar.low) { const far = !player.inCar && !pcar.fly && pcar.group.position.distanceTo(headWorld) > 40; pcar.low.visible = far; pcar.vis.visible = !far; }
    flagVis(pcar.vis, 'outer', !player.inCar);                     // im Auto: Räder/Scheinwerfer sieht man nicht
    for (const p of net.players.values()) if (p.carMesh) innerVis(p.carMesh, p.carMesh.position.distanceTo(headWorld) < 12);
  }
  // VR-Komfort-Vignette
  if (xrOn()) {
    // Komfort-Rand nur leicht (vorher zu dunkel: im Auto sah man kaum etwas)
    if (player.inCar) vigTarget = Math.min(.28, Math.abs(pcar.speed) / 90 + Math.abs(pcar.spin) * Math.abs(pcar.speed) / 400);
    if (player.ride) { const rc = net.players.get(player.ride.id)?.st?.c; vigTarget = rc ? Math.min(.25, Math.hypot(rc[10] || 0, rc[11] || 0) / 90 + Math.abs(rc[12] || 0) * .12) : 0; }
    vignette.material.opacity += (vigTarget - vignette.material.opacity) * Math.min(1, dt * 6);
    vignette.visible = vignette.material.opacity > .01;
    if (!seated()) vigTarget = 0;
  } else vignette.visible = false;
  mark('cull');
  fireBig.update(dt, 1.2); fireSmall.update(dt, .5); smoke.update(dt, .3); updDebris(dt); updNpcEngines(dt);
  if (burning.some(f => f.tower)) towerFxT = 15;                      // nach dem Löschen noch ausklingen lassen
  if (towerFxT > 0) { towerFxT -= dt; fireHuge.update(dt, 2.5); smokeHuge.update(dt, .6); }
  mark('particles');
  updAlarm(dt); updPhone(dt); updCarPlay(dt); updRainFx(dt);
  mark('phone');

  hintT -= dt;
  if (!seated() && hintT < 0) {
    const d = pcar.dead ? 1e9 : headWorld.distanceTo(pcar.group.position), ride = rideTarget(xrOn() ? 1.6 : 3);
    if (ride && ride.dist < d) { msg(ride.locked ? 'Auto von ' + ride.p.name + ' ist abgeschlossen' : (xrOn() ? 'Türgriff greifen oder A' : 'F') + ' = bei ' + ride.p.name + ' einsteigen (' + SEAT_NAMES[ride.seat] + ')', 1.2); hintT = 1; }
    else if (d < 3.2) { msg(vehicle.type === 'scooter' || (pcar.doors[0]?.a ?? 1) > .35 ? (xrOn() ? 'A drücken = ' + (vehicle.type === 'scooter' ? 'Aufsteigen' : 'Einsteigen') : 'F = Einsteigen') : (xrOn() ? 'Echten Türgriff mit Grip greifen und aufziehen' : 'F = Einsteigen'), 1.2); hintT = 1; }
  }
  if (player.dead) { player.deadT += dt; deathFx.material.opacity = Math.min(.85, player.deadT); if (player.deadT > 3) respawn(); }
  else {
    if (time - lastHurt > 5 && player.hp < 100) player.hp = Math.min(100, player.hp + dt * 6);   // Leben regeneriert sich
    hurt = Math.max(0, hurt - dt * 1.5); deathFx.material.opacity = hurt * .45 + (player.hp < 35 ? .12 + Math.sin(time * 6) * .06 : 0);
  }
  updWeather(dt); updMission(dt); updVillain(dt); updIntro(dt); updDisasters(dt);
  updJob(dt); updCops(dt); updRob(dt); updRadio(); updFuel(dt); updDog(dt); updPhoneAudio();
  saveT -= dt; if (saveT <= 0) { saveT = 5; writeSave(); }
  hud.visible = time < hudUntil;
  boomLight.intensity *= Math.pow(.02, dt); muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 120);
  tracerT -= dt; tracer.visible = tracerT > 0;
  sky.position.copy(headWorld);
  mark('misc');
  updHolderShake(dt); updSelf(dt); updDash(dt); updSlideDoors(dt);
  mark('self');
  renderPhoneCam(); renderDashcam();
  mark('phoneCam');
}
window.__game = { pcar, player, phone, npcCars, peds, props, flammables, burning, ignite, explode, scene, renderer, camera, desk, TOOLS, startIncoming, net, phoneAction, hands, vrInput, ui, laser, step: () => frame(), getVehicle, weather, startMission, get mission() { return mission; }, get vehicle() { return vehicle; }, groundAt, surfaceAt, get me() { return me; }, cp, nav, carClickUV, startNav, findRoute, POI, cl, vil, setVillain, alarm, fireAlert, cabinLift, dash, dashStart, dashStop, dashFly, dashMount, crash, carDamage, repairCar, setWindow, hearFactor, rideScr: () => rideScr, enterCar, exitCar, interiors, startRide, leaveRide, adminAction, disaster, isAdmin, flying, allNpc,
  save, job, startJob, endJob, wanted, addWanted, robSpots, rob, radio, setRadio, buyTune, homes, buyHome, dog, sendChat, day, pumps, tuningPad, startFuel, honk, writeSave, get money() { return money; }, set money(v) { money = v; } };
