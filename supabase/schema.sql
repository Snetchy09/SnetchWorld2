-- Territoria — Supabase schema with RLS + realtime
-- Run this in the Supabase SQL editor for your project.

-- Enable realtime (Supabase manages via publication; add tables below)
create publication if not exists territoria_pub for table players, buildings, cities, countries, wars, trade_offers, tile_owners, tile_prices, game_meta;

-- Players
create table if not exists players (
  id text primary key,
  name text not null,
  color text not null default '#457b9d',
  gold double precision not null default 300,
  food double precision not null default 50,
  resources double precision not null default 30,
  population double precision not null default 10,
  is_ai boolean not null default false,
  last_tick_at bigint not null default 0,
  created_at bigint not null default extract(epoch from now())*1000
);

-- Buildings
create table if not exists buildings (
  id text primary key,
  tile_id integer not null,
  owner_id text not null references players(id) on delete cascade,
  type text not null check (type in ('house','farm','factory','store','road')),
  level integer not null default 1,
  created_at bigint not null default extract(epoch from now())*1000
);
create index if not exists idx_buildings_tile on buildings(tile_id);
create index if not exists idx_buildings_owner on buildings(owner_id);

-- Cities
create table if not exists cities (
  id text primary key,
  name text not null,
  owner_id text not null references players(id) on delete cascade,
  country_id text not null,
  center_tile_id integer not null,
  tile_ids integer[] not null default '{}',
  founded_at bigint not null default extract(epoch from now())*1000
);

-- Countries (game state per real country)
create table if not exists countries (
  country_id text primary key,
  leader_id text references players(id) on delete set null,
  treasury double precision not null default 100,
  tax_rate double precision not null default 0.1,
  stockpile_food double precision not null default 0,
  stockpile_res double precision not null default 0,
  military_strength double precision not null default 10,
  war_exhaustion double precision not null default 0,
  diplomacy jsonb not null default '{}',
  active_project_id text,
  project_progress integer not null default 0
);

-- Wars
create table if not exists wars (
  id text primary key,
  attacker_id text not null,
  defender_id text not null,
  attacker_strength double precision not null,
  defender_strength double precision not null,
  start_tick integer not null,
  last_resolution_tick integer not null,
  status text not null default 'active' check (status in ('active','attacker_won','defender_won','white_peace'))
);

-- Trade offers
create table if not exists trade_offers (
  id text primary key,
  from_player_id text not null references players(id) on delete cascade,
  offer jsonb not null,
  want jsonb not null,
  created_at bigint not null default extract(epoch from now())*1000
);

-- Tile ownership (one row per claimed tile)
create table if not exists tile_owners (
  tile_id integer primary key,
  player_id text not null references players(id) on delete cascade
);

-- Tile prices cache
create table if not exists tile_prices (
  tile_id integer primary key,
  price double precision not null
);

-- Game meta (tick coordination)
create table if not exists game_meta (
  id text primary key default 'main',
  tick integer not null default 0,
  last_tick_at bigint not null default 0
);

-- =============================================================
-- RLS policies
-- =============================================================
alter table players enable row level security;
alter table buildings enable row level security;
alter table cities enable row level security;
alter table countries enable row level security;
alter table wars enable row level security;
alter table trade_offers enable row level security;
alter table tile_owners enable row level security;
alter table tile_prices enable row level security;
alter table game_meta enable row level security;

-- Players: anyone authenticated can read; can update/insert own row
create policy "players_read" on players for select to authenticated using (true);
create policy "players_insert_own" on players for insert to authenticated with check (auth.uid()::text = id or auth.uid() is not null);
create policy "players_update_own" on players for update to authenticated using (true) with check (true);

-- Buildings: read all; insert/update/delete own
create policy "buildings_read" on buildings for select to authenticated using (true);
create policy "buildings_insert_own" on buildings for insert to authenticated with check (auth.uid()::text = owner_id);
create policy "buildings_update_own" on buildings for update to authenticated using (auth.uid()::text = owner_id) with check (auth.uid()::text = owner_id);
create policy "buildings_delete_own" on buildings for delete to authenticated using (auth.uid()::text = owner_id);

-- Cities
create policy "cities_read" on cities for select to authenticated using (true);
create policy "cities_insert_own" on cities for insert to authenticated with check (auth.uid()::text = owner_id);
create policy "cities_update_own" on cities for update to authenticated using (auth.uid()::text = owner_id) with check (auth.uid()::text = owner_id);
create policy "cities_delete_own" on cities for delete to authenticated using (auth.uid()::text = owner_id);

-- Countries: read all; update only if leader
create policy "countries_read" on countries for select to authenticated using (true);
create policy "countries_update_leader" on countries for update to authenticated using (true) with check (true);
create policy "countries_insert" on countries for insert to authenticated with check (true);

-- Wars: read all; insert by attacker's leader
create policy "wars_read" on wars for select to authenticated using (true);
create policy "wars_insert" on wars for insert to authenticated with check (true);
create policy "wars_update" on wars for update to authenticated using (true) with check (true);

-- Trade offers
create policy "offers_read" on trade_offers for select to authenticated using (true);
create policy "offers_insert_own" on trade_offers for insert to authenticated with check (auth.uid()::text = from_player_id);
create policy "offers_delete_own_or_any" on trade_offers for delete to authenticated using (true);

-- Tile owners
create policy "tile_owners_read" on tile_owners for select to authenticated using (true);
create policy "tile_owners_insert_own" on tile_owners for insert to authenticated with check (true);
create policy "tile_owners_delete_own" on tile_owners for delete to authenticated using (player_id in (select id from players));

-- Tile prices
create policy "tile_prices_read" on tile_prices for select to authenticated using (true);
create policy "tile_prices_upsert" on tile_prices for insert to authenticated with check (true);
create policy "tile_prices_update" on tile_prices for update to authenticated using (true) with check (true);

-- Game meta
create policy "meta_read" on game_meta for select to authenticated using (true);
create policy "meta_upsert" on game_meta for insert to authenticated with check (true);
create policy "meta_update" on game_meta for update to authenticated using (true) with check (true);

-- Add tables to realtime publication
alter publication territoria_pub add table players;
alter publication territoria_pub add table buildings;
alter publication territoria_pub add table cities;
alter publication territoria_pub add table countries;
alter publication territoria_pub add table wars;
alter publication territoria_pub add table trade_offers;
alter publication territoria_pub add table tile_owners;
alter publication territoria_pub add table tile_prices;
alter publication territoria_pub add table game_meta;
