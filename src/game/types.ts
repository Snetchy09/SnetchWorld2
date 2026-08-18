export type BuildingType = 'house' | 'farm' | 'factory' | 'store' | 'road' | 'home';

export type DoVerb =
  | 'cash_customer'
  | 'restock'
  | 'repair'
  | 'auto_place'
  | 'clean'
  | 'deliver'
  | 'produce'
  | 'serve'
  | 'collect'
  | 'organize'
  | 'greet'
  | 'pack'
  | 'price_check'
  | 'inventory_count';

export interface DoCommand {
  id: string;
  verb: DoVerb;
  label: string;
  target?: string;
  params: Record<string, string | number | boolean>;
  priority: number;
  enabled: boolean;
  autoRepeat: boolean;
}

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

export interface LandParcel {
  id: string;
  ownerId: string;
  countryId: string;
  name: string;
  tileIds: number[];
  centerLat: number;
  centerLng: number;
  createdAt: number;
}

export interface Building {
  id: string;
  tileId: number;
  ownerId: string;
  type: BuildingType;
  level: number;
  createdAt: number;
  parcelId?: string;
}

export interface Business {
  id: string;
  ownerId: string;
  parcelId: string;
  name: string;
  type: string;
  tileId: number;
  cash: number;
  inventory: Record<string, number>;
  staffIds: string[];
  level: number;
  config: Record<string, string | number | boolean>;
  createdAt: number;
}

export interface Staff {
  id: string;
  businessId: string;
  ownerId: string;
  name: string;
  role: string;
  salary: number;
  skills: string[];
  commands: DoCommand[];
  currentTask: string | null;
  efficiency: number;
  hiredAt: number;
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
  spawnCountryId: string | null;
  parcelId: string | null;
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
  attackerId: string;
  defenderId: string;
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
  tileOwner: Record<number, string>;
  tilePrice: Record<number, number>;
  parcels: Record<string, LandParcel>;
  businesses: Record<string, Business>;
  staff: Record<string, Staff>;
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

export const DO_VERB_LABELS: Record<DoVerb, string> = {
  cash_customer: 'Cash out customers',
  restock: 'Restock shelves',
  repair: 'Repair equipment',
  auto_place: 'Auto-place items',
  clean: 'Clean area',
  deliver: 'Deliver goods',
  produce: 'Produce goods',
  serve: 'Serve customers',
  collect: 'Collect payments',
  organize: 'Organize stock',
  greet: 'Greet visitors',
  pack: 'Pack orders',
  price_check: 'Update prices',
  inventory_count: 'Count inventory',
};

export const DEFAULT_DO_COMMANDS: Omit<DoCommand, 'id'>[] = [
  { verb: 'cash_customer', label: 'Cash out customers', params: {}, priority: 1, enabled: true, autoRepeat: true },
  { verb: 'restock', label: 'Restock when low', params: { threshold: 5 }, priority: 2, enabled: true, autoRepeat: true },
  { verb: 'repair', label: 'Repair when broken', params: {}, priority: 3, enabled: false, autoRepeat: true },
  { verb: 'auto_place', label: 'Auto-place new items', params: {}, priority: 4, enabled: false, autoRepeat: true },
  { verb: 'clean', label: 'Keep area clean', params: {}, priority: 5, enabled: true, autoRepeat: true },
  { verb: 'serve', label: 'Serve customers', params: {}, priority: 1, enabled: true, autoRepeat: true },
  { verb: 'greet', label: 'Greet visitors', params: {}, priority: 6, enabled: true, autoRepeat: true },
];

export interface DataStore {
  mode: 'solo' | 'multiplayer';
  getState(): Promise<GameState>;
  subscribe(cb: (s: GameState) => void): () => void;
  createPlayer(name: string, color: string, countryId: string): Promise<string>;
  getCurrentPlayerId(): string | null;
  setCurrentPlayerId(id: string | null): void;
  buildOnTile(tileId: number, type: BuildingType): Promise<boolean>;
  upgradeBuilding(buildingId: string): Promise<boolean>;
  createBusiness(name: string, type: string, tileId: number): Promise<boolean>;
  hireStaff(businessId: string, name: string, role: string): Promise<boolean>;
  fireStaff(staffId: string): Promise<boolean>;
  updateStaffCommand(staffId: string, commandId: string, updates: Partial<DoCommand>): Promise<boolean>;
  addStaffCommand(staffId: string, verb: DoVerb): Promise<boolean>;
  removeStaffCommand(staffId: string, commandId: string): Promise<boolean>;
  updateBusinessConfig(businessId: string, config: Record<string, string | number | boolean>): Promise<boolean>;
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
