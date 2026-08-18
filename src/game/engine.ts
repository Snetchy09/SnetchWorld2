import type { BuildingType, GameState, Player, CountryState, CountryDef, LandParcel } from './types';
import { tickBusinesses } from './businessEngine';
import tilesData from '../data/tiles.json';
import countriesData from '../data/countries.json';

export const TILES = tilesData as { id: number; lat: number; lng: number; country: string }[];
export const COUNTRIES = countriesData as CountryDef[];

// Precomputed neighbour map: tileId -> [neighbour tileIds]
// Built once at module load. Uses the tile grid spacing (2.5 degrees).
const TILE_STEP = 2.5;
const TILE_MAP: Map<number, { lat: number; lng: number; country: string }> = new Map();
const NEIGHBOURS: Map<number, number[]> = new Map();
export function getNeighbours(tileId: number): number[] { return NEIGHBOURS.get(tileId) || []; }
export function getTile(tileId: number): { lat: number; lng: number; country: string } | undefined { return TILE_MAP.get(tileId); }
(function buildNeighbourIndex() {
  for (const t of TILES) TILE_MAP.set(t.id, { lat: t.lat, lng: t.lng, country: t.country });
  const byLatLng: Record<string, number> = {};
  for (const t of TILES) byLatLng[`${t.lat.toFixed(1)},${t.lng.toFixed(1)}`] = t.id;
  for (const t of TILES) {
    const ns: number[] = [];
    for (let dlat = -TILE_STEP; dlat <= TILE_STEP; dlat += TILE_STEP) {
      for (let dlng = -TILE_STEP; dlng <= TILE_STEP; dlng += TILE_STEP) {
        if (dlat === 0 && dlng === 0) continue;
        const key = `${(t.lat + dlat).toFixed(1)},${(t.lng + dlng).toFixed(1)}`;
        if (byLatLng[key] != null) ns.push(byLatLng[key]);
      }
    }
    NEIGHBOURS.set(t.id, ns);
  }
})();

export const TICK_INTERVAL_MS = 45000;

export const COSTS: Record<BuildingType, { gold: number; resources?: number }> = {
  house:   { gold: 50 },
  home:    { gold: 0 },
  farm:    { gold: 40 },
  factory: { gold: 120, resources: 20 },
  store:   { gold: 80 },
  road:    { gold: 15 },
};

export const UPGRADE_COST_MULT = 2.2;

export const PRODUCTION: Record<BuildingType, { gold?: number; food?: number; resources?: number; pop?: number; consumes?: { food?: number; resources?: number } }> = {
  house:   { pop: 4 },
  home:    { pop: 6 },
  farm:    { food: 6 },
  factory: { gold: 10, consumes: { resources: 2, food: 1 } },
  store:   { gold: 4 },
  road:    { gold: 1 },
};

export const TOWN_THRESHOLD = 6;     // contiguous tiles to found a town
export const CITY_THRESHOLD = 18;    // tiles/pop to upgrade to city

export const WAR_COST = 500;          // upfront gold to declare
export const WAR_UPKEEP_PER_TICK = 40;
export const WAR_DEFENDER_BONUS = 1.4;
export const WAR_SMALL_COUNTRY_BONUS = 1.6; // when defender has < 30 tiles

export const PROJECTS = [
  { id: 'infra', name: 'Infrastructure Drive', cost: 600, effect: '+15% production for 10 ticks', duration: 10 },
  { id: 'agri',  name: 'Agricultural Reform',  cost: 450, effect: '+25% food for 10 ticks',        duration: 10 },
  { id: 'defense', name: 'National Defense',   cost: 800, effect: '+30% military strength',        duration: 12 },
] as const;

export function newGameState(): GameState {
  return {
    tick: 0,
    players: {},
    buildings: {},
    cities: {},
    countries: {},
    wars: {},
    tradeOffers: {},
    market: { food: 2.0, resources: 3.0, updatedTick: 0 },
    tileOwner: {},
    tilePrice: {},
    parcels: {},
    businesses: {},
    staff: {},
  };
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

// Base tile price influenced by country desirability (tile count as proxy for land size).
export function baseTilePrice(countryId: string): number {
  const c = COUNTRIES.find(x => x.id === countryId);
  if (!c) return 30;
  // bigger countries = cheaper per tile; clamp 15..120
  const raw = 120 - Math.log2(c.tileCount + 1) * 12;
  return Math.max(15, Math.round(Math.min(120, raw)));
}

export function tilePriceFor(state: GameState, tileId: number): number {
  if (state.tilePrice[tileId] != null) return state.tilePrice[tileId];
  const t = TILES.find(x => x.id === tileId);
  if (!t) return 30;
  return baseTilePrice(t.country);
}

export function buildingsOnTile(state: GameState, tileId: number) {
  return Object.values(state.buildings).filter(b => b.tileId === tileId);
}

export function tilesOwnedBy(state: GameState, playerId: string): number[] {
  return Object.entries(state.tileOwner).filter(([, pid]) => pid === playerId).map(([tid]) => Number(tid));
}

export function countryTileCount(state: GameState, countryId: string): number {
  return TILES.filter(t => t.country === countryId).length;
}

export function playerPopulation(state: GameState, playerId: string): number {
  const p = state.players[playerId];
  return p ? p.population : 0;
}

export function playerTileCount(state: GameState, playerId: string): number {
  return tilesOwnedBy(state, playerId).length;
}

export function cityTileCount(state: GameState, cityId: string): number {
  const c = state.cities[cityId];
  return c ? c.tileIds.length : 0;
}

// Contiguous tiles (grid-neighbour) owned by a player
export function contiguousGroups(state: GameState, playerId: string): number[][] {
  const owned = new Set(tilesOwnedBy(state, playerId));
  const groups: number[][] = [];
  const visited = new Set<number>();
  for (const id of owned) {
    if (visited.has(id)) continue;
    const stack = [id];
    const group: number[] = [];
    while (stack.length) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      group.push(cur);
      const ns = NEIGHBOURS.get(cur) || [];
      for (const n of ns) if (owned.has(n) && !visited.has(n)) stack.push(n);
    }
    groups.push(group);
  }
  return groups;
}

export function canFoundCity(state: GameState, playerId: string): boolean {
  const groups = contiguousGroups(state, playerId);
  return groups.some(g => g.length >= TOWN_THRESHOLD);
}

export function countryOfPlayer(state: GameState, playerId: string): string | null {
  for (const c of Object.values(state.countries)) {
    if (c.leaderId === playerId) return c.countryId;
  }
  return null;
}

export function computeLeaderboards(state: GameState) {
  const players = Object.values(state.players).map(p => {
    const tc = playerTileCount(state, p.id);
    return {
      id: p.id, name: p.name, color: p.color,
      tileCount: tc, population: p.population, gold: Math.floor(p.gold), isAI: p.isAI,
    };
  }).sort((a, b) => b.tileCount - a.tileCount || b.population - a.population);

  const countries = Object.values(state.countries).map(c => {
    const def = COUNTRIES.find(x => x.id === c.countryId);
    const leader = c.leaderId ? state.players[c.leaderId] : null;
    let tileCount = 0, population = 0, cityCount = 0;
    for (const t of TILES) if (t.country === c.countryId) tileCount++;
    for (const p of Object.values(state.players)) {
      const owned = tilesOwnedBy(state, p.id).filter(tid => {
        const t = TILES.find(x => x.id === tid);
        return t && t.country === c.countryId;
      });
      if (owned.length) population += p.population;
    }
    cityCount = Object.values(state.cities).filter(city => city.countryId === c.countryId).length;
    return {
      countryId: c.countryId, name: def?.name || c.countryId, color: def?.color || '#888',
      leaderName: leader?.name || null, treasury: Math.floor(c.treasury),
      militaryStrength: Math.floor(c.militaryStrength), tileCount, population, cityCount,
    };
  }).sort((a, b) => b.tileCount - a.tileCount || b.treasury - a.treasury);

  return { players, countries };
}

// Core tick: production, consumption, city growth, country leadership, war resolution, market
// Mutates state in place (no deep clone) for performance.
export function runTick(state: GameState): GameState {
  state.tick = state.tick + 1;
  const s = state;

  const projBoost = (countryId: string, kind: 'prod' | 'food' | 'mil'): number => {
    const c = s.countries[countryId];
    if (!c || !c.activeProjectId) return 1;
    if (c.projectProgress <= 0) { c.activeProjectId = null; c.projectProgress = 0; return 1; }
    c.projectProgress -= 1;
    if (c.activeProjectId === 'infra') return kind === 'prod' ? 1.15 : 1;
    if (c.activeProjectId === 'agri') return kind === 'food' ? 1.25 : 1;
    if (c.activeProjectId === 'defense') return kind === 'mil' ? 1.3 : 1;
    return 1;
  };

  for (const b of Object.values(s.buildings)) {
    const p = s.players[b.ownerId];
    if (!p) continue;
    const t = getTile(b.tileId);
    const prod = PRODUCTION[b.type];
    const mult = t ? projBoost(t.country, 'prod') : 1;
    const foodMult = t ? projBoost(t.country, 'food') : 1;
    if (prod.food) p.food += prod.food * b.level * foodMult;
    if (prod.gold) p.gold += prod.gold * b.level * mult;
    if (prod.resources) p.resources += prod.resources * b.level * mult;
    if (prod.pop) p.population += prod.pop * b.level * 0.1;
    if (prod.consumes) {
      if (prod.consumes.food) p.food -= prod.consumes.food * b.level;
      if (prod.consumes.resources) p.resources -= prod.consumes.resources * b.level;
    }
    if (p.food < 0) { p.population += p.food * 0.5; p.food = 0; }
    if (p.resources < 0) p.resources = 0;
    if (p.population < 0) p.population = 0;
  }

  // Precompute tile counts per player per country for tax + leadership
  const tilesByCountry: Record<string, Record<string, number>> = {};
  for (const [tidStr, pid] of Object.entries(s.tileOwner)) {
    const tid = Number(tidStr);
    const t = getTile(tid);
    if (!t) continue;
    if (!tilesByCountry[t.country]) tilesByCountry[t.country] = {};
    tilesByCountry[t.country][pid] = (tilesByCountry[t.country][pid] || 0) + 1;
  }

  for (const c of Object.values(s.countries)) {
    if (!c.leaderId) continue;
    let taxIncome = 0;
    const counts = tilesByCountry[c.countryId];
    if (counts) {
      for (const [pid, n] of Object.entries(counts)) {
        if (s.players[pid]) taxIncome += n * c.taxRate * 0.5;
      }
    }
    c.treasury += taxIncome;
    const milMult = projBoost(c.countryId, 'mil');
    c.militaryStrength = Math.max(0, c.militaryStrength * 0.98 + c.treasury * 0.01 * milMult);
    if (c.warExhaustion > 0) c.warExhaustion = Math.max(0, c.warExhaustion - 1);
  }

  // Country leadership
  for (const def of COUNTRIES) {
    const c = s.countries[def.id];
    if (!c) continue;
    const counts = tilesByCountry[def.id];
    if (!counts) { c.leaderId = null; continue; }
    let topId: string | null = null, topN = 0;
    for (const [pid, n] of Object.entries(counts)) if (n > topN) { topN = n; topId = pid; }
    if (topId && topN >= def.tileCount * 0.25) {
      c.leaderId = topId;
    } else if (topN === 0) {
      c.leaderId = null;
    }
  }

  // War resolution
  for (const w of Object.values(s.wars)) {
    if (w.status !== 'active') continue;
    const att = s.countries[w.attackerId];
    const def = s.countries[w.defenderId];
    if (!att || !def) { w.status = 'white_peace'; continue; }
    if (att.treasury >= WAR_UPKEEP_PER_TICK) {
      att.treasury -= WAR_UPKEEP_PER_TICK;
      att.warExhaustion += 1;
    } else {
      w.status = 'defender_won';
      continue;
    }
    if (s.tick - w.lastResolutionTick < 2) continue;
    w.lastResolutionTick = s.tick;
    const attStr = att.militaryStrength * (1 - att.warExhaustion * 0.05);
    const defStr = def.militaryStrength * WAR_DEFENDER_BONUS * (def.tileCount < 30 ? WAR_SMALL_COUNTRY_BONUS : 1) * (1 - def.warExhaustion * 0.05);
    const roll = 0.7 + Math.random() * 0.6;
    const attScore = attStr * roll;
    if (attScore > defStr * 1.1) {
      w.status = 'attacker_won';
      const counts = tilesByCountry[w.defenderId];
      if (counts && def.leaderId && counts[def.leaderId]) {
        const toTransfer = Math.min(counts[def.leaderId], Math.ceil(counts[def.leaderId] * 0.1));
        let transferred = 0;
        for (const [tidStr, pid] of Object.entries(s.tileOwner)) {
          if (transferred >= toTransfer) break;
          if (pid !== def.leaderId) continue;
          const tid = Number(tidStr);
          const t = getTile(tid);
          if (t && t.country === w.defenderId) {
            s.tileOwner[tid] = att.leaderId!;
            transferred++;
          }
        }
      }
      def.treasury = Math.floor(def.treasury * 0.5);
      def.warExhaustion += 5;
    } else if (attScore < defStr * 0.7) {
      w.status = 'defender_won';
      att.treasury = Math.floor(att.treasury * 0.7);
      att.warExhaustion += 5;
    }
  }

  tickBusinesses(s);

  s.market.food = Math.max(0.5, Math.min(5, s.market.food + (Math.random() - 0.5) * 0.3));
  s.market.resources = Math.max(0.5, Math.min(6, s.market.resources + (Math.random() - 0.5) * 0.4));
  s.market.updatedTick = s.tick;

  return s;
}

export function ensureCountriesPresent(state: GameState): void {
  for (const def of COUNTRIES) {
    if (!state.countries[def.id]) {
      state.countries[def.id] = {
        countryId: def.id, leaderId: null, treasury: 100, taxRate: 0.1,
        stockpileFood: 0, stockpileRes: 0, militaryStrength: 10,
        warExhaustion: 0, diplomacy: {}, activeProjectId: null, projectProgress: 0,
      };
    }
  }
}

export function makePlayer(name: string, color: string, isAI = false): Player {
  return {
    id: uid('p'), name, color, gold: 500, food: 80, resources: 50,
    population: 10, isAI, lastTickAt: Date.now(), createdAt: Date.now(),
    spawnCountryId: null, parcelId: null,
  };
}

/** Generate an organic small land parcel within a country (6–10 contiguous tiles). */
export function generateStarterParcel(
  state: GameState,
  countryId: string,
  ownerId: string,
  playerName: string,
): LandParcel | null {
  const countryTiles = TILES.filter(t => t.country === countryId && !state.tileOwner[t.id]);
  if (countryTiles.length < 6) return null;

  const seedIdx = Math.floor(Math.random() * countryTiles.length);
  const seed = countryTiles[seedIdx];
  const targetSize = 6 + Math.floor(Math.random() * 5);
  const owned = new Set<number>([seed.id]);
  const frontier = [seed.id];

  while (owned.size < targetSize && frontier.length > 0) {
    const cur = frontier.splice(Math.floor(Math.random() * frontier.length), 1)[0];
    const ns = getNeighbours(cur).filter(nid => {
      const nt = getTile(nid);
      return nt && nt.country === countryId && !state.tileOwner[nid] && !owned.has(nid);
    });
    for (const n of ns) {
      if (owned.size >= targetSize) break;
      if (Math.random() > 0.35) {
        owned.add(n);
        frontier.push(n);
      }
    }
    if (frontier.length === 0 && owned.size < targetSize) {
      for (const n of getNeighbours(cur)) {
        const nt = getTile(n);
        if (nt && nt.country === countryId && !state.tileOwner[n] && !owned.has(n)) {
          owned.add(n);
          frontier.push(n);
          if (owned.size >= targetSize) break;
        }
      }
    }
  }

  const tileIds = [...owned];
  let sumLat = 0, sumLng = 0;
  for (const tid of tileIds) {
    const t = getTile(tid);
    if (t) { sumLat += t.lat; sumLng += t.lng; }
    state.tileOwner[tid] = ownerId;
    state.tilePrice[tid] = 0;
  }

  const def = COUNTRIES.find(c => c.id === countryId);
  const parcel: LandParcel = {
    id: uid('parcel'),
    ownerId,
    countryId,
    name: `${playerName}'s Land`,
    tileIds,
    centerLat: sumLat / tileIds.length,
    centerLng: sumLng / tileIds.length,
    createdAt: Date.now(),
  };
  state.parcels[parcel.id] = parcel;
  return parcel;
}

export function parcelOfPlayer(state: GameState, playerId: string): LandParcel | null {
  const p = state.players[playerId];
  if (!p?.parcelId) return null;
  return state.parcels[p.parcelId] || null;
}

export function tilesInParcel(state: GameState, parcelId: string): number[] {
  return state.parcels[parcelId]?.tileIds || [];
}

export function playerOwnsTile(state: GameState, playerId: string, tileId: number): boolean {
  const parcel = parcelOfPlayer(state, playerId);
  return parcel ? parcel.tileIds.includes(tileId) : false;
}

export function businessesOnTile(state: GameState, tileId: number) {
  return Object.values(state.businesses).filter(b => b.tileId === tileId);
}

export function makeCountryState(countryId: string, leaderId: string | null = null): CountryState {
  return {
    countryId, leaderId, treasury: 100, taxRate: 0.1,
    stockpileFood: 0, stockpileRes: 0, militaryStrength: 10,
    warExhaustion: 0, diplomacy: {}, activeProjectId: null, projectProgress: 0,
  };
}
