import type { Business, DoCommand, GameState, Staff } from './types';
import { DEFAULT_DO_COMMANDS, DO_VERB_LABELS } from './types';
import { uid } from './engine';

export function makeDefaultCommands(): DoCommand[] {
  return DEFAULT_DO_COMMANDS.map(c => ({ ...c, id: uid('cmd') }));
}

export function makeStaff(businessId: string, ownerId: string, name: string, role: string): Staff {
  return {
    id: uid('st'),
    businessId,
    ownerId,
    name,
    role,
    salary: 15 + Math.floor(Math.random() * 20),
    skills: [],
    commands: makeDefaultCommands(),
    currentTask: null,
    efficiency: 0.7 + Math.random() * 0.3,
    hiredAt: Date.now(),
  };
}

export function makeBusiness(
  ownerId: string,
  parcelId: string,
  name: string,
  type: string,
  tileId: number,
): Business {
  return {
    id: uid('biz'),
    ownerId,
    parcelId,
    name,
    type,
    tileId,
    cash: 0,
    inventory: { goods: 10, supplies: 5 },
    staffIds: [],
    level: 1,
    config: { openHours: 12, markup: 1.2, autoHire: false },
    createdAt: Date.now(),
  };
}

const VERB_EFFECTS: Record<string, { gold?: number; inv?: string; qty?: number }> = {
  cash_customer: { gold: 8 },
  restock: { inv: 'goods', qty: 3 },
  serve: { gold: 5 },
  collect: { gold: 6 },
  produce: { inv: 'goods', qty: 2 },
  deliver: { gold: 4 },
  pack: { inv: 'supplies', qty: -1 },
  inventory_count: {},
  greet: { gold: 1 },
  clean: {},
  repair: {},
  auto_place: { inv: 'goods', qty: 1 },
  organize: {},
  price_check: { gold: 2 },
};

export function executeStaffCommands(state: GameState, staff: Staff, business: Business): void {
  const player = state.players[staff.ownerId];
  if (!player) return;

  const sorted = [...staff.commands].filter(c => c.enabled).sort((a, b) => a.priority - b.priority);
  for (const cmd of sorted) {
    const effect = VERB_EFFECTS[cmd.verb];
    if (!effect) continue;

    if (effect.gold) {
      const amount = effect.gold * staff.efficiency * business.level;
      business.cash += amount;
      player.gold += amount * 0.8;
    }
    if (effect.inv && effect.qty != null) {
      const cur = business.inventory[effect.inv] || 0;
      if (effect.qty < 0 && cur + effect.qty < 0) continue;
      business.inventory[effect.inv] = Math.max(0, cur + effect.qty * staff.efficiency);
    }
    staff.currentTask = cmd.label;
    break;
  }
}

export function tickBusinesses(state: GameState): void {
  for (const biz of Object.values(state.businesses)) {
    const player = state.players[biz.ownerId];
    if (!player) continue;

    for (const sid of biz.staffIds) {
      const st = state.staff[sid];
      if (st) executeStaffCommands(state, st, biz);
      if (st) player.gold -= st.salary * 0.01;
    }

    biz.cash = Math.max(0, biz.cash);
  }
}

export function addCommandToStaff(staff: Staff, verb: DoCommand['verb']): DoCommand {
  const cmd: DoCommand = {
    id: uid('cmd'),
    verb,
    label: DO_VERB_LABELS[verb],
    params: {},
    priority: staff.commands.length + 1,
    enabled: true,
    autoRepeat: true,
  };
  staff.commands.push(cmd);
  return cmd;
}
