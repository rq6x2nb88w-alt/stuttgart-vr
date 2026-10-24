// Laden + Aufbereiten der 3D-Modelle (alle CC0 / frei nutzbar)
//  - Poly Haven (polyhaven.com): Pistole, Vorschlaghammer, Feuerzeug, Kisten, Kanister, Fassaden-Baukasten, Texturen
//  - three.js Beispiele: Ferrari 458 (Auto), Soldier (animierter Mensch)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Alles liegt auch lokal im Ordner assets/ (tools/download-assets.js) – das Internet ist nur noch Notlösung
const draco = new DRACOLoader();
const DRACO_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/';
const dracoReady = fetch('assets/libs/draco/draco_wasm_wrapper.js', { method: 'HEAD' }).then(r => r.ok, () => false)
  .then(ok => draco.setDecoderPath(ok ? 'assets/libs/draco/' : DRACO_CDN));
const TJS = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/';
const PH = 'https://api.polyhaven.com/files/';
// Liste der lokal gespeicherten Poly-Haven-Dateien
const localIndex = fetch('assets/polyhaven/index.json').then(r => r.ok ? r.json() : null).catch(() => null);

let done = 0, total = 0, onProg = () => { };
export const setProgress = fn => { onProg = fn; };
const track = p => { total++; onProg(done / total); return p.finally(() => { done++; onProg(done / total); }); };

function loader(mgr) { const l = new GLTFLoader(mgr); l.setDRACOLoader(draco); return l; }
const loadGltf = async (url, mgr) => { await dracoReady; return loader(mgr).loadAsync(url); };
// Eigene Modelle haben Vorrang: assets/models/<name>.glb, dann assets/models/three/<datei>, dann Internet
let localList = null;
const ownModels = () => localList || (localList = fetch('assets/models/').then(r => r.ok ? r.json() : []).then(l => Array.isArray(l) ? l : []).catch(() => []));
async function localOr(name, file) {
  if ((await ownModels()).includes(name)) return loadGltf('assets/models/' + name);
  return loadGltf('assets/models/three/' + file).catch(() => loadGltf(TJS + file));
}
async function poly(id) {
  const loc = (await localIndex)?.models?.[id];
  if (loc) { try { return await loadGltf(loc); } catch (e) { console.warn('Lokales Modell fehlt, lade aus dem Internet:', id); } }
  const f = await fetch(PH + id).then(r => r.json());
  const g = f.gltf['1k'].gltf;
  const base = g.url.slice(0, g.url.lastIndexOf('/') + 1), map = {};
  for (const [k, v] of Object.entries(g.include || {})) map[base + k] = v.url;
  const mgr = new THREE.LoadingManager(); mgr.setURLModifier(u => map[u] || u);
  return loadGltf(g.url, mgr);
}
async function polyTex(id, maxAniso) {
  const L = new THREE.TextureLoader(); L.setCrossOrigin('anonymous');
  const loc = (await localIndex)?.tex?.[id];
  let map = null, normalMap = null;
  if (loc) { try { [map, normalMap] = await Promise.all([loc.map, loc.normalMap].map(u => u ? L.loadAsync(u) : null)); } catch (e) { map = normalMap = null; } }
  if (!map) {
    const f = await fetch(PH + id).then(r => r.json());
    const url = k => f[k]?.['1k']?.jpg?.url;
    [map, normalMap] = await Promise.all(['Diffuse', 'nor_gl'].map(k => url(k) ? L.loadAsync(url(k)) : null));
  }
  for (const t of [map, normalMap]) if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; }
  if (map) map.colorSpace = THREE.SRGBColorSpace;
  return { map, normalMap };
}

export const loadCar = () => track(localOr('auto.glb', 'ferrari.glb'));
export const loadUrl = url => track(loadGltf(url));
// Dateiliste eines Modell-Ordners (liefert server.js)
export const listDir = dir => fetch(dir).then(r => r.ok ? r.json() : []).then(l => Array.isArray(l) ? l : []).catch(() => []);
export const loadNpcCar = () => track(localOr('auto_npc.glb', 'ferrari.glb'));
export const loadHuman = () => track(localOr('mensch.glb', 'Soldier.glb'));
export const loadHuman2 = () => track(localOr('mensch2.glb', 'Michelle.glb'));
// Echter Foto-Himmel (HDRI) von Poly Haven – lokal, sonst aus dem Internet
export const loadHDRI = (id, res = '2k') => track(localIndex.then(ix => {
  const loc = ix?.hdri?.[id]?.[res];
  const remote = () => fetch(PH + id).then(r => r.json()).then(f => new RGBELoader().loadAsync(f.hdri[res].hdr.url));
  return loc ? new RGBELoader().loadAsync(loc).catch(remote) : remote();
}));

// Alle Teile eines Modells pro Material zu einem Mesh zusammenfassen (weniger Draw-Calls)
export function mergeByMaterial(root) {
  const groups = new Map();
  for (const p of flatten(root)) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!groups.has(p.mat)) groups.set(p.mat, []);
    groups.get(p.mat).push(g);
  }
  const out = new THREE.Group();
  for (const [mat, list] of groups) out.add(new THREE.Mesh(mergeGeometries(list), mat));
  return out;
}
export const loadPoly = id => track(poly(id));
export const loadTex = (id, aniso) => track(polyTex(id, aniso));
export const cloneSkinned = o => SkeletonUtils.clone(o);

// Alle Meshes in Wurzel-Koordinaten "backen"
// bone = Knochen, an dem das Teil hängt (bei Modellen mit Skelett, z.B. Tür-Knochen) · path = Namen der Eltern-Knoten
export function flatten(root) {
  root.updateMatrixWorld(true);
  const out = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    let bone = null;
    if (o.isSkinnedMesh && g.attributes.skinIndex && o.skeleton) {
      const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, cnt = {}, step = Math.max(1, Math.floor(si.count / 48));
      for (let i = 0; i < si.count; i += step) {
        let bi = si.getX(i), bw = sw.getX(i);
        for (const [j, w] of [[si.getY(i), sw.getY(i)], [si.getZ(i), sw.getZ(i)], [si.getW(i), sw.getW(i)]]) if (w > bw) { bw = w; bi = j; }
        cnt[bi] = (cnt[bi] || 0) + 1;
      }
      const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; bone = top ? o.skeleton.bones[top[0]]?.name || null : null;
    }
    const path = []; for (let p = o.parent; p; p = p.parent) if (p.name) path.push(p.name);
    out.push({ name: o.name, geo: g, mat: o.material, bone, path });
  });
  return out;
}

// Schnelle Vereinfachung (Vertex-Clustering) – für NPC-Autos
export function decimate(geo, cell) {
  const p = geo.attributes.position, ix = geo.index, n = ix ? ix.count : p.count;
  const map = new Map(), sum = [], vid = new Int32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = Math.round(x / cell) + ',' + Math.round(y / cell) + ',' + Math.round(z / cell);
    let id = map.get(k);
    if (id === undefined) { id = sum.length / 4; map.set(k, id); sum.push(0, 0, 0, 0); }
    sum[id * 4] += x; sum[id * 4 + 1] += y; sum[id * 4 + 2] += z; sum[id * 4 + 3]++; vid[i] = id;
  }
  const seen = new Set(), idx = [];
  for (let t = 0; t < n; t += 3) {
    const a = vid[ix ? ix.getX(t) : t], b = vid[ix ? ix.getX(t + 1) : t + 1], c = vid[ix ? ix.getX(t + 2) : t + 2];
    if (a === b || b === c || a === c) continue;
    const s = [a, b, c].sort((u, v) => u - v).join(',');
    if (seen.has(s)) continue; seen.add(s); idx.push(a, b, c);
  }
  const pos = new Float32Array(sum.length / 4 * 3);
  for (let i = 0; i < sum.length / 4; i++) { const c = sum[i * 4 + 3]; pos[i * 3] = sum[i * 4] / c; pos[i * 3 + 1] = sum[i * 4 + 1] / c; pos[i * 3 + 2] = sum[i * 4 + 2] / c; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setIndex(idx); out.computeVertexNormals();
  return out;
}

// Dreiecke anhand ihres Mittelpunkts aufteilen (z.B. Tür aus der Karosserie schneiden)
export function splitGeometry(geo, pred) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const names = Object.keys(g.attributes), p = g.attributes.position;
  const get = [(a, i) => a.getX(i), (a, i) => a.getY(i), (a, i) => a.getZ(i), (a, i) => a.getW(i)];
  const A = names.map(() => []), B = names.map(() => []);
  for (let t = 0; t < p.count; t += 3) {
    const cx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3, cy = (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) / 3, cz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3;
    const dst = pred(cx, cy, cz) ? B : A;
    names.forEach((n, k) => { const at = g.attributes[n]; for (let v = t; v < t + 3; v++) for (let c = 0; c < at.itemSize; c++) dst[k].push(get[c](at, v)); });
  }
  const mk = arrs => {
    const o = new THREE.BufferGeometry();
    names.forEach((n, k) => o.setAttribute(n, new THREE.BufferAttribute(new Float32Array(arrs[k]), g.attributes[n].itemSize)));
    return o;
  };
  return [mk(A), mk(B)];
}

// Fassaden-Atlas aus dem 3D-Baukasten rendern (4x4 Kacheln à 3m x 3m bzw. 3,75m mit Dachgesims)
// Drei Atlanten: Farbe (albedo), Normalen (Relief der Fenster/Putz), Rauheit (Glas glänzt, Putz matt)
export function bakeFacades(renderer, kit) {
  const S = 512, N = 4;
  const mkRT = srgb => {
    const rt = new THREE.WebGLRenderTarget(S * N, S * N, { samples: 4 });
    if (srgb) rt.texture.colorSpace = THREE.SRGBColorSpace;
    rt.texture.generateMipmaps = true; rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
    rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return rt;
  };
  const passes = [
    { rt: mkRT(true), bg: new THREE.Color(0x1d2228) },
    { rt: mkRT(false), bg: new THREE.Color().setRGB(.5, .5, 1, THREE.LinearSRGBColorSpace) },
    { rt: mkRT(false), bg: new THREE.Color().setRGB(0, .2, 0, THREE.LinearSRGBColorSpace) },
  ];
  const cache = new Map();
  const desat = m => { m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(.3,.59,.11))) * 1.55;'); }; return m; };
  const matFor = (m, pass) => {
    const key = m.uuid + pass; if (cache.has(key)) return cache.get(key);
    const glass = /glass/i.test(m.name);
    let out;
    if (pass === 0) out = glass ? new THREE.MeshBasicMaterial({ color: 0x2a3540 }) : /plaster/i.test(m.name) ? desat(new THREE.MeshBasicMaterial({ map: m.map, color: m.color })) : new THREE.MeshBasicMaterial({ map: m.map, color: m.color });
    else if (pass === 1) out = new THREE.MeshNormalMaterial({ normalMap: glass ? null : m.normalMap, normalScale: m.normalScale });
    else out = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0, glass ? .04 : (m.roughness ?? .8), 0, THREE.LinearSRGBColorSpace), map: glass ? null : m.roughnessMap });
    cache.set(key, out); return out;
  };
  const sc = new THREE.Scene();
  const get = (n, pass) => {
    const o = kit.scene.getObjectByName(n); if (!o) { console.warn('Fassadenteil fehlt:', n); return null; }
    const c = o.clone(); c.position.set(0, 0, 0);
    c.traverse(q => { if (q.isMesh) q.material = matFor(q.material, pass); });
    return c;
  };
  const cam = new THREE.OrthographicCamera(-3, 0, 3, 0, .1, 30); cam.position.set(0, 0, 10);
  const B = 'base_standard_01', CR = 'crown_standard_standard_01';
  // [Zeile, Spalte, Teile, mit Dachgesims?]
  const cells = [
    [0, 0, ['wall_door_centered_small_01', 'door_centered_small_01', B]],
    [0, 1, ['wall_door_centered_large_01', 'door_centered_large_01', B]],
    [0, 2, ['wall_window_centered_large_02', 'window_centered_large_02', B]],
    [0, 3, ['wall_window_centered_double_02', 'window_centered_double_02', B]],
    [1, 0, ['wall_window_centered_large_02', 'window_centered_large_02']],
    [1, 1, ['wall_window_centered_double_02', 'window_centered_double_02']],
    [1, 2, ['wall_window_centered_small_02', 'window_centered_small_02']],
    [1, 3, ['wall_window_offset_small_03', 'window_offset_small_03']],
    [2, 0, ['wall_window_centered_large_01', 'window_centered_large_01']],
    [2, 1, ['wall_window_centered_double_01', 'window_centered_double_01']],
    [2, 2, ['wall_window_centered_small_01', 'window_centered_small_01']],
    [2, 3, ['wall_door_window_small_01', 'door_window_small_01']],
    [3, 0, ['wall_window_centered_large_03', 'window_centered_large_03', CR], true],
    [3, 1, ['wall_window_centered_double_03', 'window_centered_double_03', CR], true],
    [3, 2, ['wall_window_centered_small_03', 'window_centered_small_03', CR], true],
    [3, 3, ['wall_standard_standard_01', CR], true],
  ];
  const xr = renderer.xr.enabled; renderer.xr.enabled = false;
  const prevRT = renderer.getRenderTarget(), tm = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  try { passes.forEach(({ rt, bg }, pass) => {
    sc.background = bg;
    for (const [r, c, parts, top] of cells) {
      const grp = new THREE.Group();
      for (const n of parts) { const o = get(n, pass); if (!o) continue; if (n === CR) o.position.y = 3; grp.add(o); }
      cam.top = top ? 3.75 : 3; cam.updateProjectionMatrix();
      rt.viewport.set(c * S, r * S, S, S); rt.scissor.set(c * S, r * S, S, S); rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      sc.add(grp); renderer.render(sc, cam); sc.remove(grp);
    }
    rt.scissorTest = false; rt.viewport.set(0, 0, S * N, S * N); rt.scissor.set(0, 0, S * N, S * N);
  }); } finally { renderer.setRenderTarget(prevRT); renderer.xr.enabled = xr; renderer.toneMapping = tm; }
  return { albedo: passes[0].rt.texture, normal: passes[1].rt.texture, rough: passes[2].rt.texture };
}

// Hilfen zum Ausrichten von Modellen
export function verts(root) {
  root.updateMatrixWorld(true);
  const out = [], v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh) return; const p = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(p.count / 3000));
    for (let i = 0; i < p.count; i += step) out.push(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).clone());
  });
  return out;
}
export function bbox(root) { return new THREE.Box3().setFromObject(root); }
