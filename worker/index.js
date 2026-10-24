// Stuttgart VR auf Cloudflare (kostenlos, ohne Karte):
//  - alle Spieldateien (index.html, game.js, assets/) liefert Cloudflare direkt aus (unbegrenzt, mit Cache)
//  - Multiplayer: ein "Durable Object" ist die Lobby und leitet die Nachrichten weiter – genau wie server.js
import LISTS from './cars.json';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket erwartet', { status: 426 });
      return env.LOBBY.get(env.LOBBY.idFromName('stuttgart')).fetch(req);
    }
    // Liste der eigenen Autos (assets/models/autos/*.glb) – wird beim Hochladen erzeugt (worker/list-cars.js)
    if (/^\/assets\/models\/autos\/?$/.test(url.pathname)) return Response.json(LISTS.cars, { headers: { 'Cache-Control': 'no-cache' } });
    if (/^\/assets\/klingeltoene\/?$/.test(url.pathname)) return Response.json(LISTS.rings, { headers: { 'Cache-Control': 'no-cache' } });   // eigene Klingeltöne
    return env.ASSETS.fetch(req);
  },
};

// Die Lobby: alle Spieler hängen per WebSocket hier dran (mit "Hibernation": schläft, wenn nichts los ist)
export class Lobby {
  constructor(ctx) {
    this.ctx = ctx; this.maint = false;                                   // Wartung: Admin hat den Server heruntergefahren (bleibt gespeichert)
    ctx.blockConcurrencyWhile(async () => { this.maint = !!(await ctx.storage.get('maint')); });
  }
  isAdmin(me) { return /^gabriel$/i.test(me.name || ''); }

  async fetch() {
    const next = (await this.ctx.storage.get('next')) || 1;               // fortlaufende Spieler-Nummer (bleibt auch nach dem Schlafen)
    await this.ctx.storage.put('next', next + 1);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: next, name: '' });
    return new Response(null, { status: 101, webSocket: client });
  }

  info(ws) { return ws.deserializeAttachment() || {}; }
  send(ws, str) { try { ws.send(str); } catch (e) { } }
  list() { return JSON.stringify({ t: 'list', players: this.ctx.getWebSockets().map(w => this.info(w)).filter(c => c.name).map(c => ({ id: c.id, name: c.name })) }); }
  broadcast(str, except) { for (const w of this.ctx.getWebSockets()) if (w !== except && this.info(w).name) this.send(w, str); }

  async webSocketMessage(ws, data) {
    let msg; try { msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)); } catch (e) { return; }
    const me = this.info(ws);
    if (msg.t === 'hello') {
      me.name = String(msg.name || 'Spieler').replace(/[^\w äöüÄÖÜß.-]/g, '').slice(0, 16) || 'Spieler';
      ws.serializeAttachment(me);
      if (this.maint) { this.send(ws, JSON.stringify({ t: 'welcome', id: me.id, maint: true })); return; }
      this.send(ws, JSON.stringify({ t: 'welcome', id: me.id })); this.broadcast(this.list());
    } else if (msg.t === 'shutdown' && this.isAdmin(me)) {                // Admin: Server herunterfahren -> alle sehen "Service geschlossen"
      this.maint = true; await this.ctx.storage.put('maint', true);
      for (const w of this.ctx.getWebSockets()) this.send(w, '{"t":"shutdown"}');
    } else if (msg.t === 'reopen' && this.isAdmin(me)) {                  // Admin: wieder öffnen -> alle laden neu
      this.maint = false; await this.ctx.storage.delete('maint');
      for (const w of this.ctx.getWebSockets()) this.send(w, '{"t":"reopened"}');
    } else if (this.maint) {
      return;
    } else if (['s', 'ev', 'npc', 'scr'].includes(msg.t)) {
      msg.from = me.id; this.broadcast(JSON.stringify(msg), ws);
    } else if (msg.t === 'sig') {
      if ((msg.gift || msg.zero) && !this.isAdmin(me)) return;            // Geld verschenken / auf 0 setzen darf nur der Admin
      const to = this.ctx.getWebSockets().find(w => this.info(w).id === msg.to);
      if (to) { msg.from = me.id; this.send(to, JSON.stringify(msg)); }
    }
  }
  async webSocketClose(ws) { try { ws.close(); } catch (e) { } this.broadcast(this.list(), ws); }
  async webSocketError(ws) { this.broadcast(this.list(), ws); }
}
