export type BuildingType = 'house' | 'farm' | 'factory' | 'store' | 'road';

export interface Tile {
  id: number;
  lat: number;
  lng: number;
  country: string;
}

export interface CountryDef {
  id: string;
  name: string;
  color: string;
  centerLat: number;
  centerLng: number;
  tileCount: number;
}

export interface Building {
  id: string;
  tileId: number;
  ownerId: string;
  type: BuildingType;
  level: number;
  createdAt: number;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  gold: number;
  food: number;
  resources: number;
  population: number;
  isAI: boolean;
  lastTickAt: number;
  createdAt: number;
}

export interface City {
  id: string;
  name: string;
  ownerId: string;
  countryId: string;
  centerTileId: number;
  tileIds: number[];
  foundedAt: number;
}

export interface CountryState {
  countryId: string;
  leaderId: string | null;
  treasury: number;
  taxRate: number;
  stockpileFood: number;
  stockpileRes: number;
  militaryStrength: number;
  warExhaustion: number;
  diplomacy: Record<string, 'neutral' | 'ally' | 'hostile'>;
  activeProjectId: string | null;
  projectProgress: number;
}

export interface War {
  id: string;
  attackerId: string;   // country id
  defenderId: string;   // country id
  attackerStrength: number;
  defenderStrength: number;
  startTick: number;
  lastResolutionTick: number;
  status: 'active' | 'attacker_won' | 'defender_won' | 'white_peace';
}

export interface TradeOffer {
  id: string;
  fromPlayerId: string;
  offer: { gold?: number; food?: number; resources?: number };
  want: { gold?: number; food?: number; resources?: number };
  createdAt: number;
}

export interface MarketPrice {
  food: number;
  resources: number;
  updatedTick: number;
}

export interface GameState {
  tick: number;
  players: Record<string, Player>;
  buildings: Record<string, Building>;
  cities: Record<string, City>;
  countries: Record<string, CountryState>;
  wars: Record<string, War>;
  tradeOffers: Record<string, TradeOffer>;
  market: MarketPrice;
  tileOwner: Record<number, string>;     // tileId -> playerId
  tilePrice: Record<number, number>;
}

export interface PlayerSummary {
  id: string;
  name: string;
  color: string;
  tileCount: number;
  population: number;
  gold: number;
  isAI: boolean;
}

export interface CountrySummary {
  countryId: string;
  name: string;
  color: string;
  leaderName: string | null;
  treasury: number;
  militaryStrength: number;
  tileCount: number;
  population: number;
  cityCount: number;
}

export interface DataStore {
  mode: 'solo' | 'multiplayer';
  getState(): Promise<GameState>;
  subscribe(cb: (s: GameState) => void): () => void;
  createPlayer(name: string, color: string): Promise<string>;
  getCurrentPlayerId(): string | null;
  setCurrentPlayerId(id: string | null): void;
  claimTile(tileId: number): Promise<boolean>;
  buildOnTile(tileId: number, type: BuildingType): Promise<boolean>;
  upgradeBuilding(buildingId: string): Promise<boolean>;
  foundCity(name: string, centerTileId: number, tileIds: number[]): Promise<boolean>;
  setTaxRate(countryId: string, rate: number): Promise<boolean>;
  declareWar(attackerId: string, defenderId: string): Promise<boolean>;
  fundProject(countryId: string, projectId: string): Promise<boolean>;
  createTradeOffer(offer: TradeOffer['offer'], want: TradeOffer['want']): Promise<boolean>;
  acceptTradeOffer(offerId: string): Promise<boolean>;
  declineTradeOffer(offerId: string): Promise<boolean>;
  npcTrade(resource: 'food' | 'resources', qty: number, buy: boolean): Promise<boolean>;
  tick(): Promise<void>;
  getLeaderboards(): Promise<{ players: PlayerSummary[]; countries: CountrySummary[] }>;
  disconnect?: () => void;
}
