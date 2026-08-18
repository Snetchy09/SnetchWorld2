import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  DataStore, GameState, Player, BuildingType, TradeOffer,
  PlayerSummary, CountrySummary, DoCommand, DoVerb,
} from '../game/types';
import {
  newGameState, runTick, ensureCountriesPresent, makePlayer,
  uid, COSTS, UPGRADE_COST_MULT, tilesOwnedBy,
  WAR_COST, PROJECTS,
  computeLeaderboards, buildingsOnTile, TILES, COUNTRIES,
  generateStarterParcel, parcelOfPlayer, playerOwnsTile, businessesOnTile,
} from '../game/engine';
import { makeBusiness, makeStaff, addCommandToStaff } from '../game/businessEngine';

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const supabaseAnon = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnon && supabaseUrl.startsWith('http'));
}

export class SupabaseStore implements DataStore {
  mode = 'multiplayer' as const;
  private sb: SupabaseClient;
  private state: GameState;
  private subs = new Set<(s: GameState) => void>();
  private channel: ReturnType<SupabaseClient['channel']> | null = null;
  private playerId: string | null = null;
  private ready: Promise<void>;

  constructor() {
    if (!isSupabaseConfigured()) throw new Error('Supabase not configured');
    this.sb = createClient(supabaseUrl!, supabaseAnon!, { auth: { persistSession: true, autoRefreshToken: true } });
    this.state = newGameState();
    this.ready = this.init();
    this.startAnonAuth();
  }

  private startAnonAuth() {
    (async () => {
      try {
        const { data } = await this.sb.auth.getUser();
        if (!data.user) {
          await this.sb.auth.signInAnonymously();
        }
      } catch {}
    })();
  }

  private async init() {
    ensureCountriesPresent(this.state);
    await this.loadAll();
    this.subscribeRealtime();
    // Tick loop — only the "tick leader" runs the global tick to avoid duplicates.
    // For simplicity any client may run; we use an upsert with tick check server-side.
    this.startTickLoop();
  }

  private async loadAll() {
    const [players, buildings, cities, countries, wars, offers, owners, prices] = await Promise.all([
      this.sb.from('players').select('*'),
      this.sb.from('buildings').select('*'),
      this.sb.from('cities').select('*'),
      this.sb.from('countries').select('*'),
      this.sb.from('wars').select('*'),
      this.sb.from('trade_offers').select('*'),
      this.sb.from('tile_owners').select('*'),
      this.sb.from('tile_prices').select('*'),
    ]);
    for (const p of players.data || []) {
      this.state.players[p.id] = { id:p.id, name:p.name, color:p.color, gold:p.gold, food:p.food, resources:p.resources, population:p.population, isAI:p.is_ai, lastTickAt:p.last_tick_at, createdAt:p.created_at };
    }
    for (const b of buildings.data || []) {
      this.state.buildings[b.id] = { id:b.id, tileId:b.tile_id, ownerId:b.owner_id, type:b.type, level:b.level, createdAt:b.created_at };
    }
    for (const c of cities.data || []) {
      this.state.cities[c.id] = { id:c.id, name:c.name, ownerId:c.owner_id, countryId:c.country_id, centerTileId:c.center_tile_id, tileIds:c.tile_ids, foundedAt:c.founded_at };
    }
    for (const c of countries.data || []) {
      this.state.countries[c.country_id] = { countryId:c.country_id, leaderId:c.leader_id, treasury:c.treasury, taxRate:c.tax_rate, stockpileFood:c.stockpile_food, stockpileRes:c.stockpile_res, militaryStrength:c.military_strength, warExhaustion:c.war_exhaustion, diplomacy:c.diplomacy||{}, activeProjectId:c.active_project_id, projectProgress:c.project_progress };
    }
    ensureCountriesPresent(this.state);
    for (const w of wars.data || []) {
      this.state.wars[w.id] = { id:w.id, attackerId:w.attacker_id, defenderId:w.defender_id, attackerStrength:w.attacker_strength, defenderStrength:w.defender_strength, startTick:w.start_tick, lastResolutionTick:w.last_resolution_tick, status:w.status };
    }
    for (const o of offers.data || []) {
      this.state.tradeOffers[o.id] = { id:o.id, fromPlayerId:o.from_player_id, offer:o.offer, want:o.want, createdAt:o.created_at };
    }
    for (const o of owners.data || []) this.state.tileOwner[o.tile_id] = o.player_id;
    for (const pr of prices.data || []) this.state.tilePrice[pr.tile_id] = pr.price;
    if (!this.state.parcels) this.state.parcels = {};
    if (!this.state.businesses) this.state.businesses = {};
    if (!this.state.staff) this.state.staff = {};
    this.notify();
  }

  private subscribeRealtime() {
    this.channel = this.sb.channel('territoria');
    for (const t of ['players','buildings','cities','countries','wars','trade_offers','tile_owners','tile_prices','game_meta']) {
      this.channel!.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => { this.loadAll(); });
    }
    this.channel!.subscribe();
  }

  private startTickLoop() {
    setInterval(() => this.maybeRunTick(), 45000);
  }

  private async maybeRunTick() {
    // Simple approach: try to increment tick via upsert; whoever succeeds runs the tick.
    const { data } = await this.sb.from('game_meta').select('*').eq('id','main').maybeSingle();
    const now = Date.now();
    if (data && data.last_tick_at && now - data.last_tick_at < 44000) return;
    await this.sb.from('game_meta').upsert({ id:'main', last_tick_at: now, tick: (data?.tick||0)+1 });
    // run engine tick locally then persist
    this.state = runTick(this.state);
    await this.persistTickResults();
    this.notify();
  }

  private async persistTickResults() {
    // Bulk upsert player resources
    for (const p of Object.values(this.state.players)) {
      await this.sb.from('players').update({ gold:p.gold, food:p.food, resources:p.resources, population:p.population }).eq('id', p.id);
    }
    for (const c of Object.values(this.state.countries)) {
      await this.sb.from('countries').upsert({ country_id:c.countryId, leader_id:c.leaderId, treasury:c.treasury, tax_rate:c.taxRate, stockpile_food:c.stockpileFood, stockpile_res:c.stockpileRes, military_strength:c.militaryStrength, war_exhaustion:c.warExhaustion, active_project_id:c.activeProjectId, project_progress:c.projectProgress, diplomacy:c.diplomacy });
    }
    for (const w of Object.values(this.state.wars)) {
      await this.sb.from('wars').upsert({ id:w.id, attacker_id:w.attackerId, defender_id:w.defenderId, attacker_strength:w.attackerStrength, defender_strength:w.defenderStrength, start_tick:w.startTick, last_resolution_tick:w.lastResolutionTick, status:w.status });
    }
  }

  private notify() { for (const cb of this.subs) cb(this.state); }

  async getState(): Promise<GameState> { await this.ready; return this.state; }
  subscribe(cb: (s: GameState) => void): () => void { this.subs.add(cb); cb(this.state); return () => this.subs.delete(cb); }

  getCurrentPlayerId(): string | null { return this.playerId; }
  setCurrentPlayerId(id: string | null): void { this.playerId = id; localStorage.setItem('territoria_mp_player', id || ''); }

  async createPlayer(name: string, color: string, countryId: string): Promise<string> {
    await this.ready;
    const p = makePlayer(name, color, false);
    const parcel = generateStarterParcel(this.state, countryId, p.id, name);
    if (!parcel) throw new Error('Could not spawn in this country');
    p.spawnCountryId = countryId;
    p.parcelId = parcel.id;
    const { data, error } = await this.sb.from('players').insert({ id:p.id, name:p.name, color:p.color, gold:p.gold, food:p.food, resources:p.resources, population:p.population, is_ai:p.isAI }).select().single();
    if (error) throw error;
    this.state.players[data.id] = p;
    for (const tid of parcel.tileIds) {
      await this.sb.from('tile_owners').insert({ tile_id: tid, player_id: p.id });
    }
    const homeTile = parcel.tileIds[Math.floor(parcel.tileIds.length / 2)];
    const homeId = uid('b');
    this.state.buildings[homeId] = { id: homeId, tileId: homeTile, ownerId: p.id, type: 'home', level: 1, createdAt: Date.now(), parcelId: parcel.id };
    await this.sb.from('buildings').insert({ id: homeId, tile_id: homeTile, owner_id: p.id, type: 'home', level: 1 });
    this.setCurrentPlayerId(data.id);
    this.notify();
    return data.id;
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
    const id = uid('b');
    const parcel = parcelOfPlayer(this.state, p.id);
    const { error } = await this.sb.from('buildings').insert({ id, tile_id:tileId, owner_id:p.id, type, level:1 });
    if (error) return false;
    await this.sb.from('players').update({ gold: p.gold - c.gold, resources: p.resources - (c.resources||0) }).eq('id', p.id);
    p.gold -= c.gold; if (c.resources) p.resources -= c.resources;
    this.state.buildings[id] = { id, tileId, ownerId:p.id, type, level:1, createdAt:Date.now(), parcelId: parcel?.id };
    this.notify();
    return true;
  }

  async upgradeBuilding(buildingId: string): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const b = this.state.buildings[buildingId];
    if (!b || b.ownerId !== p.id) return false;
    const cost = Math.round(COSTS[b.type].gold * UPGRADE_COST_MULT * b.level);
    if (p.gold < cost) return false;
    await this.sb.from('buildings').update({ level: b.level + 1 }).eq('id', b.id);
    await this.sb.from('players').update({ gold: p.gold - cost }).eq('id', p.id);
    p.gold -= cost; b.level += 1;
    this.notify();
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
    this.notify();
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
    this.notify();
    return true;
  }

  async fireStaff(staffId: string): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const st = this.state.staff[staffId];
    if (!st || st.ownerId !== p.id) return false;
    const biz = this.state.businesses[st.businessId];
    if (biz) biz.staffIds = biz.staffIds.filter(id => id !== staffId);
    delete this.state.staff[staffId];
    this.notify();
    return true;
  }

  async updateStaffCommand(staffId: string, commandId: string, updates: Partial<DoCommand>): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const st = this.state.staff[staffId];
    if (!st || st.ownerId !== p.id) return false;
    const cmd = st.commands.find(c => c.id === commandId);
    if (!cmd) return false;
    Object.assign(cmd, updates);
    this.notify();
    return true;
  }

  async addStaffCommand(staffId: string, verb: DoVerb): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const st = this.state.staff[staffId];
    if (!st || st.ownerId !== p.id) return false;
    addCommandToStaff(st, verb);
    this.notify();
    return true;
  }

  async removeStaffCommand(staffId: string, commandId: string): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const st = this.state.staff[staffId];
    if (!st || st.ownerId !== p.id) return false;
    st.commands = st.commands.filter(c => c.id !== commandId);
    this.notify();
    return true;
  }

  async updateBusinessConfig(businessId: string, config: Record<string, string | number | boolean>): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const biz = this.state.businesses[businessId];
    if (!biz || biz.ownerId !== p.id) return false;
    biz.config = { ...biz.config, ...config };
    this.notify();
    return true;
  }

  async setTaxRate(countryId: string, rate: number): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const c = this.state.countries[countryId];
    if (!c || c.leaderId !== p.id) return false;
    const r = Math.max(0, Math.min(0.5, rate));
    await this.sb.from('countries').update({ tax_rate: r }).eq('country_id', countryId);
    c.taxRate = r;
    this.notify();
    return true;
  }

  async declareWar(attackerId: string, defenderId: string): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const att = this.state.countries[attackerId];
    const def = this.state.countries[defenderId];
    if (!att || !def || att.leaderId !== p.id) return false;
    if (att.treasury < WAR_COST) return false;
    const w = {
      id: uid('w'), attacker_id:attackerId, defender_id:defenderId,
      attacker_strength: att.militaryStrength, defender_strength: def.militaryStrength,
      start_tick: this.state.tick, last_resolution_tick: this.state.tick, status: 'active',
    };
    const { error } = await this.sb.from('wars').insert(w);
    if (error) return false;
    await this.sb.from('countries').update({ treasury: att.treasury - WAR_COST }).eq('country_id', attackerId);
    att.treasury -= WAR_COST;
    this.state.wars[w.id] = { id:w.id, attackerId, defenderId, attackerStrength:w.attacker_strength, defenderStrength:w.defender_strength, startTick:w.start_tick, lastResolutionTick:w.last_resolution_tick, status:'active' };
    this.notify();
    return true;
  }

  async fundProject(countryId: string, projectId: string): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const c = this.state.countries[countryId];
    if (!c || c.leaderId !== p.id) return false;
    const proj = PROJECTS.find(x => x.id === projectId);
    if (!proj || c.treasury < proj.cost) return false;
    await this.sb.from('countries').update({ treasury: c.treasury - proj.cost, active_project_id: projectId, project_progress: proj.duration }).eq('country_id', countryId);
    c.treasury -= proj.cost; c.activeProjectId = projectId; c.projectProgress = proj.duration;
    this.notify();
    return true;
  }

  async createTradeOffer(offer: TradeOffer['offer'], want: TradeOffer['want']): Promise<boolean> {
    const p = this.player(); if (!p) return false;
    const id = uid('t');
    const { error } = await this.sb.from('trade_offers').insert({ id, from_player_id:p.id, offer, want });
    if (error) return false;
    this.state.tradeOffers[id] = { id, fromPlayerId:p.id, offer, want, createdAt:Date.now() };
    this.notify();
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
    await this.sb.from('players').update({ gold:p.gold, food:p.food, resources:p.resources }).eq('id', p.id);
    await this.sb.from('players').update({ gold:from.gold, food:from.food, resources:from.resources }).eq('id', from.id);
    await this.sb.from('trade_offers').delete().eq('id', offerId);
    delete this.state.tradeOffers[offerId];
    this.notify();
    return true;
  }

  async declineTradeOffer(offerId: string): Promise<boolean> {
    await this.sb.from('trade_offers').delete().eq('id', offerId);
    delete this.state.tradeOffers[offerId];
    this.notify();
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
    await this.sb.from('players').update({ gold:p.gold, food:p.food, resources:p.resources }).eq('id', p.id);
    this.notify();
    return true;
  }

  async tick(): Promise<void> { /* server-side tick handled by loop */ }

  async getLeaderboards(): Promise<{ players: PlayerSummary[]; countries: CountrySummary[] }> {
    return computeLeaderboards(this.state);
  }

  disconnect() {
    if (this.channel) this.sb.removeChannel(this.channel);
  }
}
