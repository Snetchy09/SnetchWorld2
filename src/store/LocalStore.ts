import type {
  DataStore, GameState, Player, BuildingType, TradeOffer,
  PlayerSummary, CountrySummary, DoCommand, DoVerb,
} from '../game/types';
import {
  newGameState, runTick, ensureCountriesPresent, makePlayer, makeCountryState,
  uid, TILES, COUNTRIES, COSTS, UPGRADE_COST_MULT, tilesOwnedBy,
  contiguousGroups, WAR_COST, PROJECTS,
  computeLeaderboards, buildingsOnTile, PRODUCTION,
  getNeighbours, getTile, generateStarterParcel, parcelOfPlayer,
  playerOwnsTile, businessesOnTile,
} from '../game/engine';
import { makeBusiness, makeStaff, addCommandToStaff } from '../game/businessEngine';

const STORAGE_KEY = 'territoria_solo_state_v2';
const PLAYER_KEY = 'territoria_solo_player_v1';

const AI_NAMES = ['Aria','Borin','Cael','Dara','Elin','Faro','Gwen','Halo','Iris','Jor','Kira','Lorn'];
const AI_COLORS = ['#e63946','#2a9d8f','#e9c46a','#f4a261','#588157','#a98467','#bc6c25','#118ab2'];

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
    this.migrateState();
    this.save();
    this.startTicks();
  }

  private migrateState() {
    if (!this.state.parcels) this.state.parcels = {};
    if (!this.state.businesses) this.state.businesses = {};
    if (!this.state.staff) this.state.staff = {};
    for (const p of Object.values(this.state.players)) {
      if (p.spawnCountryId === undefined) p.spawnCountryId = null;
      if (p.parcelId === undefined) p.parcelId = null;
    }
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
    const rng = (n: number) => Math.floor(Math.random() * n);
    for (let i = 0; i < 8; i++) {
      const name = AI_NAMES[i % AI_NAMES.length];
      const color = AI_COLORS[i % AI_COLORS.length];
      const p = makePlayer(name, color, true);
      p.gold = 400 + rng(200);
      s.players[p.id] = p;
      const country = COUNTRIES[rng(COUNTRIES.length)];
      const parcel = generateStarterParcel(s, country.id, p.id, name);
      if (parcel) {
        p.spawnCountryId = country.id;
        p.parcelId = parcel.id;
        const homeTile = parcel.tileIds[0];
        s.buildings[uid('b')] = { id: uid('b'), tileId: homeTile, ownerId: p.id, type: 'home', level: 1, createdAt: Date.now(), parcelId: parcel.id };
      }
    }
  }

  private startTicks() {
    this.tickTimer = setInterval(() => { this.runTickAndNotify(); }, 45000);
    this.aiTimer = setInterval(() => { this.runAI(); }, 25000);
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
      const parcel = parcelOfPlayer(this.state, p.id);
      if (!parcel) continue;
      for (const tid of parcel.tileIds) {
        if (buildingsOnTile(this.state, tid).length === 0 && businessesOnTile(this.state, tid).length === 0 && p.gold > 80) {
          const type: BuildingType = Math.random() > 0.5 ? 'farm' : 'house';
          const c = COSTS[type];
          if (p.gold >= c.gold) {
            p.gold -= c.gold;
            this.state.buildings[uid('b')] = { id: uid('b'), tileId: tid, ownerId: p.id, type, level: 1, createdAt: Date.now(), parcelId: parcel.id };
            changed = true;
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

  async createPlayer(name: string, color: string, countryId: string): Promise<string> {
    const p = makePlayer(name, color, false);
    const parcel = generateStarterParcel(this.state, countryId, p.id, name);
    if (!parcel) throw new Error('Could not spawn in this country');
    p.spawnCountryId = countryId;
    p.parcelId = parcel.id;
    this.state.players[p.id] = p;

    const homeTile = parcel.tileIds[Math.floor(parcel.tileIds.length / 2)];
    const homeId = uid('b');
    this.state.buildings[homeId] = {
      id: homeId, tileId: homeTile, ownerId: p.id, type: 'home', level: 1,
      createdAt: Date.now(), parcelId: parcel.id,
    };

    this.setCurrentPlayerId(p.id);
    this.save(); this.notify();
    return p.id;
  }

  private player(): Player | null {
    const id = this.getCurrentPlayerId();
    return id ? this.state.players[id] : null;
  }

  async buildOnTile(tileId: number, type: BuildingType): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    if (!playerOwnsTile(this.state, p.id, tileId)) return false;
    if (buildingsOnTile(this.state, tileId).length > 0) return false;
    if (businessesOnTile(this.state, tileId).length > 0) return false;
    const c = COSTS[type];
    if (p.gold < c.gold) return false;
    if (c.resources && p.resources < c.resources) return false;
    p.gold -= c.gold; if (c.resources) p.resources -= c.resources;
    const id = uid('b');
    const parcel = parcelOfPlayer(this.state, p.id);
    this.state.buildings[id] = { id, tileId, ownerId: p.id, type, level: 1, createdAt: Date.now(), parcelId: parcel?.id };
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

  async createBusiness(name: string, type: string, tileId: number): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    if (!playerOwnsTile(this.state, p.id, tileId)) return false;
    if (buildingsOnTile(this.state, tileId).length > 0) return false;
    if (businessesOnTile(this.state, tileId).length > 0) return false;
    if (p.gold < 150) return false;
    const parcel = parcelOfPlayer(this.state, p.id);
    if (!parcel) return false;
    p.gold -= 150;
    const biz = makeBusiness(p.id, parcel.id, name, type, tileId);
    this.state.businesses[biz.id] = biz;
    this.save(); this.notify();
    return true;
  }

  async hireStaff(businessId: string, name: string, role: string): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const biz = this.state.businesses[businessId];
    if (!biz || biz.ownerId !== p.id) return false;
    if (p.gold < 50) return false;
    p.gold -= 50;
    const st = makeStaff(businessId, p.id, name, role);
    this.state.staff[st.id] = st;
    biz.staffIds.push(st.id);
    this.save(); this.notify();
    return true;
  }

  async fireStaff(staffId: string): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const st = this.state.staff[staffId];
    if (!st || st.ownerId !== p.id) return false;
    const biz = this.state.businesses[st.businessId];
    if (biz) biz.staffIds = biz.staffIds.filter(id => id !== staffId);
    delete this.state.staff[staffId];
    this.save(); this.notify();
    return true;
  }

  async updateStaffCommand(staffId: string, commandId: string, updates: Partial<DoCommand>): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const st = this.state.staff[staffId];
    if (!st || st.ownerId !== p.id) return false;
    const cmd = st.commands.find(c => c.id === commandId);
    if (!cmd) return false;
    Object.assign(cmd, updates);
    this.save(); this.notify();
    return true;
  }

  async addStaffCommand(staffId: string, verb: DoVerb): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const st = this.state.staff[staffId];
    if (!st || st.ownerId !== p.id) return false;
    addCommandToStaff(st, verb);
    this.save(); this.notify();
    return true;
  }

  async removeStaffCommand(staffId: string, commandId: string): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const st = this.state.staff[staffId];
    if (!st || st.ownerId !== p.id) return false;
    st.commands = st.commands.filter(c => c.id !== commandId);
    this.save(); this.notify();
    return true;
  }

  async updateBusinessConfig(businessId: string, config: Record<string, string | number | boolean>): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const biz = this.state.businesses[businessId];
    if (!biz || biz.ownerId !== p.id) return false;
    biz.config = { ...biz.config, ...config };
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
