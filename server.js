// Kleiner Webserver für Stuttgart VR
//   PC:    http://localhost:8080
//   Quest: https://<PC-IP>:8443   (Quest und PC im selben WLAN; WebXR braucht HTTPS)
// Start:  node server.js
const http = require('http'), https = require('https'), net = require('net'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream', '.css': 'text/css' };

function handler(req, res) {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // Liste eigener Modelle (assets/models/*.glb), damit das Spiel nicht blind nachfragen muss
  if (/^\/assets\/(models\/([\w-]+\/)?|klingeltoene\/)$/.test(url)) {
    let files = []; try { files = fs.readdirSync(path.join(ROOT, url)).filter(f => /\.(glb|gltf|mp3|ogg|wav|m4a)$/i.test(f)); } catch (e) { }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); return res.end(JSON.stringify(files));
  }
  const file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
  if (!file.startsWith(ROOT) || file.includes(`${path.sep}.`)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Nicht gefunden'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// Selbst-signiertes Zertifikat erzeugen (ohne Zusatzprogramme)
function selfSigned() {
  const certFile = path.join(ROOT, '.cert.pem'), keyFile = path.join(ROOT, '.key.pem');
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  const len = n => { if (n < 128) return Buffer.from([n]); const b = []; while (n > 0) { b.unshift(n & 255); n >>= 8; } return Buffer.from([0x80 | b.length, ...b]); };
  const tlv = (tag, ...parts) => { const v = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(v.length), v]); };
  const seq = (...p) => tlv(0x30, ...p), set = (...p) => tlv(0x31, ...p);
  const int = b => tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
  const oid = s => { const a = s.split('.').map(Number), out = [40 * a[0] + a[1]]; for (const n of a.slice(2)) { const st = [n & 0x7f]; let x = n >> 7; while (x) { st.unshift((x & 0x7f) | 0x80); x >>= 7; } out.push(...st); } return tlv(0x06, Buffer.from(out)); };
  const utc = d => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
  const name = cn => seq(set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn)))));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const algo = seq(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));
  const now = new Date(Date.now() - 864e5), until = new Date(Date.now() + 2 * 365 * 864e5);
  const tbs = seq(tlv(0xa0, int(Buffer.from([2]))), int(crypto.randomBytes(8)), algo, name('Stuttgart VR'), seq(utc(now), utc(until)), name('Stuttgart VR'), publicKey.export({ type: 'spki', format: 'der' }));
  const sig = crypto.sign('sha256', tbs, privateKey);
  const der = seq(tbs, algo, tlv(0x03, Buffer.concat([Buffer.from([0]), sig])));
  const cert = '-----BEGIN CERTIFICATE-----\n' + der.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(certFile, cert); fs.writeFileSync(keyFile, key);
  return { cert, key };
}

// Startet auf dem Wunsch-Port; ist er belegt, wird der nächste freie genommen (statt abzustürzen)
function start(server, port, tries, onOk) {
  const onErr = e => {
    server.off('listening', onListen);
    if (e.code === 'EADDRINUSE' && tries > 0) { console.log(`Port ${port} ist belegt, versuche ${port + 1} ...`); start(server, port + 1, tries - 1, onOk); }
    else { console.error('Server-Fehler:', e.message); process.exit(1); }
  };
  const onListen = () => { server.off('error', onErr); onOk(port); };
  server.once('error', onErr); server.once('listening', onListen);
  server.listen(port);
}
const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
const plain = http.createServer(handler); plain.on('upgrade', wsAccept);
start(plain, +process.env.PORT || 8080, 10, p => console.log(`PC:    http://localhost:${p}`));
// ===== Multiplayer: kleiner WebSocket-Server (ohne Zusatzpakete) =====
const clients = new Map(); let nextId = 1;
let maint = false;                                                     // Wartung: Admin hat den Server heruntergefahren
const isAdmin = c => /^gabriel$/i.test(c.name);
function wsSend(c, str) {
  const p = Buffer.from(str), n = p.length;
  const h = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  try { c.sock.write(Buffer.concat([h, p])); } catch (e) { }
}
function wsParse(c) {
  const b = c.buf; if (b.length < 2) return null;
  const op = b[0] & 15, masked = b[1] & 128; let len = b[1] & 127, off = 2;
  if (len === 126) { if (b.length < 4) return null; len = b.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (b.length < 10) return null; len = Number(b.readBigUInt64BE(2)); off = 10; }
  const mo = off; if (masked) off += 4; if (b.length < off + len) return null;
  const p = Buffer.from(b.subarray(off, off + len)); if (masked) for (let i = 0; i < len; i++) p[i] ^= b[mo + (i & 3)];
  c.buf = b.subarray(off + len);
  return { op, text: p.toString() };
}
const list = () => JSON.stringify({ t: 'list', players: [...clients.values()].filter(c => c.name).map(c => ({ id: c.id, name: c.name })) });
const broadcast = (str, except) => { for (const c of clients.values()) if (c !== except && c.name) wsSend(c, str); };
function wsAccept(req, sock) {
  if (req.url !== '/ws') return sock.destroy();
  const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { id: nextId++, sock, name: '', buf: Buffer.alloc(0) };
  clients.set(c.id, c);
  const bye = () => { if (!clients.delete(c.id)) return; if (c.name) console.log(`Spieler weg: ${c.name}`); broadcast(list()); };
  sock.on('data', d => {
    c.buf = Buffer.concat([c.buf, d]); let m;
    while ((m = wsParse(c))) {
      if (m.op === 8) { sock.end(); return bye(); }
      if (m.op !== 1) continue;
      let msg; try { msg = JSON.parse(m.text); } catch (e) { continue; }
      if (msg.t === 'hello') {
        c.name = String(msg.name || 'Spieler').replace(/[^\w äöüÄÖÜß.-]/g, '').slice(0, 16) || 'Spieler';
        console.log(`Spieler da: ${c.name} (${sock.remoteAddress})`);
        if (maint) { wsSend(c, JSON.stringify({ t: 'welcome', id: c.id, maint: true })); continue; }
        wsSend(c, JSON.stringify({ t: 'welcome', id: c.id })); broadcast(list());
      } else if (msg.t === 'shutdown' && isAdmin(c)) {                 // Admin: Server herunterfahren -> alle sehen "Service geschlossen"
        maint = true; console.log(`Server heruntergefahren von ${c.name}`);
        for (const o of clients.values()) wsSend(o, JSON.stringify({ t: 'shutdown' }));
      } else if (msg.t === 'reopen' && isAdmin(c)) {                   // Admin: wieder öffnen -> alle laden neu
        maint = false; console.log(`Server wieder geöffnet von ${c.name}`);
        for (const o of clients.values()) wsSend(o, JSON.stringify({ t: 'reopened' }));
      } else if (maint) continue;
      else if (['s', 'ev', 'npc', 'scr'].includes(msg.t)) { msg.from = c.id; broadcast(JSON.stringify(msg), c); }
      else if (msg.t === 'sig') { if (msg.gift && !isAdmin(c)) continue; const to = clients.get(msg.to); if (to) { msg.from = c.id; wsSend(to, JSON.stringify(msg)); } }
    }
  });
  sock.on('close', bye); sock.on('error', bye);
}

// Bei einem Hoster (Render, Railway …) gibt es PORT und HTTPS macht der Hoster selbst -> nur ein Server
const CLOUD = !!process.env.PORT;

if (!CLOUD) {
  // Port 8443 versteht beides: https wird ausgeliefert, normales http wird auf https umgeleitet
  const tls = https.createServer(selfSigned(), handler); tls.on('upgrade', wsAccept);
  const toHttps = http.createServer((req, res) => { res.writeHead(301, { Location: 'https://' + req.headers.host + req.url }); res.end(); });
  const mux = net.createServer(sock => {
    sock.once('data', buf => {
      sock.pause(); sock.unshift(buf);
      (buf[0] === 22 ? tls : toHttps).emit('connection', sock);   // 22 = TLS-Handshake
      process.nextTick(() => sock.resume());
    });
    sock.on('error', () => { });
  });
  start(mux, 8443, 10, p => {
    console.log('Quest (im Quest-Browser oeffnen, Warnung mit "Erweitert" -> "Weiter" bestaetigen):');
    ips.forEach(ip => console.log(`       https://${ip}:${p}`));
  });
  // Anfragen anzeigen, damit man sieht, ob die Quest ankommt
  const logReq = req => { if (/^\/(index\.html)?$/.test(req.url)) console.log(`Verbindung von ${req.socket.remoteAddress} -> ${req.url}`); };
  tls.on('request', logReq); toHttps.on('request', req => console.log(`http-Anfrage von ${req.socket.remoteAddress} -> leite auf https um`));
} else console.log('Cloud-Modus: HTTPS kommt vom Hoster');
