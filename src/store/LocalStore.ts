import type {
  DataStore, GameState, Player, BuildingType, TradeOffer,
  PlayerSummary, CountrySummary,
} from '../game/types';
import {
  newGameState, runTick, ensureCountriesPresent, makePlayer, makeCountryState,
  uid, TILES, COUNTRIES, COSTS, UPGRADE_COST_MULT, tilePriceFor, tilesOwnedBy,
  contiguousGroups, TOWN_THRESHOLD, WAR_COST, PROJECTS, countryOfPlayer,
  computeLeaderboards, baseTilePrice, buildingsOnTile, PRODUCTION,
  getNeighbours, getTile,
} from '../game/engine';

const STORAGE_KEY = 'territoria_solo_state_v1';
const PLAYER_KEY = 'territoria_solo_player_v1';

const AI_NAMES = ['Aria','Borin','Cael','Dara','Elin','Faro','Gwen','Halo','Iris','Jor','Kira','Lorn','Mira','Nyx','Orin','Pax','Quill','Rune','Sera','Tarn','Ursa','Vex','Wren','Xan','Yara','Zane'];
const AI_COLORS = ['#e63946','#2a9d8f','#e9c46a','#f4a261','#588157','#a98467','#bc6c25','#118ab2','#06d6a0','#fb5607'];

export class LocalStore implements DataStore {
  mode = 'solo' as const;
  private state: GameState;
  private subs = new Set<(s: GameState) => void>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private aiTimer: ReturnType<typeof setInterval> | null = null;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.state = this.load();
    ensureCountriesPresent(this.state);
    this.save();
    this.startTicks();
  }

  private load(): GameState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as GameState;
        ensureCountriesPresent(s);
        return s;
      }
    } catch {}
    const s = newGameState();
    ensureCountriesPresent(s);
    this.seedAI(s);
    return s;
  }

  private save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch {}
      this.saveTimer = null;
    }, 2000);
  }

  private seedAI(s: GameState) {
    // Create ~12 AI players each owning a few tiles in random countries
    const rng = (n: number) => Math.floor(Math.random() * n);
    for (let i = 0; i < 12; i++) {
      const name = AI_NAMES[i % AI_NAMES.length] + '_' + i;
      const color = AI_COLORS[i % AI_COLORS.length];
      const p = makePlayer(name, color, true);
      p.gold = 200 + rng(300);
      s.players[p.id] = p;
      // claim 2-5 tiles in a random country
      const country = COUNTRIES[rng(COUNTRIES.length)];
      const ct = TILES.filter(t => t.country === country.id);
      const n = 2 + rng(4);
      for (let j = 0; j < n && j < ct.length; j++) {
        const tile = ct[rng(ct.length)];
        if (tile && !s.tileOwner[tile.id]) {
          s.tileOwner[tile.id] = p.id;
          s.tilePrice[tile.id] = baseTilePrice(country.id);
          // build a house + farm
          s.buildings[uid('b')] = { id: uid('b'), tileId: tile.id, ownerId: p.id, type: 'house', level: 1, createdAt: Date.now() };
        }
      }
    }
    // Make one AI a country leader for demo
    const aiIds = Object.keys(s.players).filter(id => s.players[id].isAI);
    if (aiIds.length) {
      const lead = aiIds[0];
      // find country where this AI has most tiles
      const owned = tilesOwnedBy(s, lead);
      if (owned.length) {
        const t = TILES.find(x => x.id === owned[0]);
        if (t) {
          s.countries[t.country].leaderId = lead;
          s.countries[t.country].militaryStrength = 60;
          s.countries[t.country].treasury = 500;
        }
      }
    }
  }

  private startTicks() {
    this.tickTimer = setInterval(() => { this.runTickAndNotify(); }, 45000);
    this.aiTimer = setInterval(() => { this.runAI(); }, 20000);
  }

  private runTickAndNotify() {
    this.state = runTick(this.state);
    this.save();
    this.notify();
  }

  private notify() { for (const cb of this.subs) cb(this.state); }

  private runAI() {
    let changed = false;
    for (const p of Object.values(this.state.players)) {
      if (!p.isAI) continue;
      const owned = tilesOwnedBy(this.state, p.id);
      if (owned.length < 8 && p.gold > 150) {
        // try to claim a neighbour tile
        const groups = contiguousGroups(this.state, p.id);
        if (groups.length) {
          const group = groups[0];
          for (const tid of group) {
            const t = getTile(tid);
            if (!t) continue;
            const candidates = getNeighbours(tid).filter(nid => {
              const nt = getTile(nid);
              return nt && nt.country === t.country && !this.state.tileOwner[nid];
            });
            if (candidates.length) {
              const pick = candidates[Math.floor(Math.random()*candidates.length)];
              const price = tilePriceFor(this.state, pick);
              if (p.gold >= price) {
                p.gold -= price;
                this.state.tileOwner[pick] = p.id;
                this.state.tilePrice[pick] = price;
                changed = true;
                break;
              }
            }
          }
        }
      }
      // build a farm or factory if has unimproved tiles
      if (p.gold > 100) {
        for (const tid of owned) {
          const existing = buildingsOnTile(this.state, tid);
          if (existing.length === 0) {
            const type: BuildingType = Math.random() > 0.5 ? 'farm' : 'house';
            const c = COSTS[type];
            if (p.gold >= c.gold) {
              p.gold -= c.gold;
              this.state.buildings[uid('b')] = { id: uid('b'), tileId: tid, ownerId: p.id, type, level: 1, createdAt: Date.now() };
              changed = true;
            }
            break;
          }
        }
      }
    }
    if (changed) { this.save(); this.notify(); }
  }

  async getState(): Promise<GameState> { return this.state; }
  subscribe(cb: (s: GameState) => void): () => void { this.subs.add(cb); cb(this.state); return () => this.subs.delete(cb); }

  getCurrentPlayerId(): string | null {
    return localStorage.getItem(PLAYER_KEY);
  }
  setCurrentPlayerId(id: string | null): void {
    if (id) localStorage.setItem(PLAYER_KEY, id); else localStorage.removeItem(PLAYER_KEY);
  }

  async createPlayer(name: string, color: string): Promise<string> {
    const p = makePlayer(name, color, false);
    this.state.players[p.id] = p;
    this.setCurrentPlayerId(p.id);
    this.save(); this.notify();
    return p.id;
  }

  private player(): Player | null {
    const id = this.getCurrentPlayerId();
    return id ? this.state.players[id] : null;
  }

  async claimTile(tileId: number): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    if (this.state.tileOwner[tileId]) return false;
    const price = tilePriceFor(this.state, tileId);
    if (p.gold < price) return false;
    p.gold -= price;
    this.state.tileOwner[tileId] = p.id;
    this.state.tilePrice[tileId] = price;
    this.save(); this.notify();
    return true;
  }

  async buildOnTile(tileId: number, type: BuildingType): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    if (this.state.tileOwner[tileId] !== p.id) return false;
    if (buildingsOnTile(this.state, tileId).length > 0) return false;
    const c = COSTS[type];
    if (p.gold < c.gold) return false;
    if (c.resources && p.resources < c.resources) return false;
    p.gold -= c.gold; if (c.resources) p.resources -= c.resources;
    const id = uid('b');
    this.state.buildings[id] = { id, tileId, ownerId: p.id, type, level: 1, createdAt: Date.now() };
    this.save(); this.notify();
    return true;
  }

  async upgradeBuilding(buildingId: string): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const b = this.state.buildings[buildingId];
    if (!b || b.ownerId !== p.id) return false;
    const cost = Math.round(COSTS[b.type].gold * UPGRADE_COST_MULT * b.level);
    if (p.gold < cost) return false;
    p.gold -= cost; b.level += 1;
    this.save(); this.notify();
    return true;
  }

  async foundCity(name: string, centerTileId: number, tileIds: number[]): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const groups = contiguousGroups(this.state, p.id);
    const ok = groups.some(g => g.length >= TOWN_THRESHOLD && g.includes(centerTileId));
    if (!ok) return false;
    const t = TILES.find(x => x.id === centerTileId);
    if (!t) return false;
    const id = uid('c');
    this.state.cities[id] = { id, name, ownerId: p.id, countryId: t.country, centerTileId, tileIds, foundedAt: Date.now() };
    this.save(); this.notify();
    return true;
  }

  async setTaxRate(countryId: string, rate: number): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const c = this.state.countries[countryId];
    if (!c || c.leaderId !== p.id) return false;
    c.taxRate = Math.max(0, Math.min(0.5, rate));
    this.save(); this.notify();
    return true;
  }

  async declareWar(attackerId: string, defenderId: string): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const att = this.state.countries[attackerId];
    const def = this.state.countries[defenderId];
    if (!att || !def || att.leaderId !== p.id) return false;
    if (attackerId === defenderId) return false;
    if (att.treasury < WAR_COST) return false;
    att.treasury -= WAR_COST;
    const w = {
      id: uid('w'), attackerId, defenderId,
      attackerStrength: att.militaryStrength, defenderStrength: def.militaryStrength,
      startTick: this.state.tick, lastResolutionTick: this.state.tick, status: 'active' as const,
    };
    this.state.wars[w.id] = w;
    att.diplomacy[defenderId] = 'hostile';
    def.diplomacy[attackerId] = 'hostile';
    this.save(); this.notify();
    return true;
  }

  async fundProject(countryId: string, projectId: string): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const c = this.state.countries[countryId];
    if (!c || c.leaderId !== p.id) return false;
    const proj = PROJECTS.find(x => x.id === projectId);
    if (!proj) return false;
    if (c.treasury < proj.cost) return false;
    c.treasury -= proj.cost;
    c.activeProjectId = projectId;
    c.projectProgress = proj.duration;
    this.save(); this.notify();
    return true;
  }

  async createTradeOffer(offer: TradeOffer['offer'], want: TradeOffer['want']): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    if ((offer.gold||0) > p.gold || (offer.food||0) > p.food || (offer.resources||0) > p.resources) return false;
    const id = uid('t');
    this.state.tradeOffers[id] = { id, fromPlayerId: p.id, offer, want, createdAt: Date.now() };
    this.save(); this.notify();
    return true;
  }

  async acceptTradeOffer(offerId: string): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const o = this.state.tradeOffers[offerId];
    if (!o || o.fromPlayerId === p.id) return false;
    if ((o.want.gold||0) > p.gold || (o.want.food||0) > p.food || (o.want.resources||0) > p.resources) return false;
    const from = this.state.players[o.fromPlayerId]; if (!from) return false;
    p.gold -= (o.want.gold||0); p.food -= (o.want.food||0); p.resources -= (o.want.resources||0);
    p.gold += (o.offer.gold||0); p.food += (o.offer.food||0); p.resources += (o.offer.resources||0);
    from.gold += (o.want.gold||0); from.food += (o.want.food||0); from.resources += (o.want.resources||0);
    from.gold -= (o.offer.gold||0); from.food -= (o.offer.food||0); from.resources -= (o.offer.resources||0);
    delete this.state.tradeOffers[offerId];
    this.save(); this.notify();
    return true;
  }

  async declineTradeOffer(offerId: string): Promise<boolean> {
    delete this.state.tradeOffers[offerId];
    this.save(); this.notify();
    return true;
  }

  async npcTrade(resource: 'food' | 'resources', qty: number, buy: boolean): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const price = this.state.market[resource] * qty;
    if (buy) {
      if (p.gold < price) return false;
      p.gold -= price; p[resource] += qty;
    } else {
      if (p[resource] < qty) return false;
      p[resource] -= qty; p.gold += price;
    }
    this.save(); this.notify();
    return true;
  }

  async tick(): Promise<void> { this.runTickAndNotify(); }

  async getLeaderboards(): Promise<{ players: PlayerSummary[]; countries: CountrySummary[] }> {
    return computeLeaderboards(this.state);
  }

  disconnect() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.aiTimer) clearInterval(this.aiTimer);
  }
}
