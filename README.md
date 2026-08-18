# Territoria

A browser-based multiplayer geopolitical strategy game built on a 3D globe of Earth with real country borders. Claim land, build settlements, grow cities, lead nations, and (rarely) wage war.

## Quick Start

### Solo Mode (zero setup)

1. Install dependencies: `npm install`
2. Start the dev server: `npm run dev`
3. Open the displayed URL, pick **Solo Mode**, enter a name and color, and play.

Solo Mode runs entirely in your browser — all state is saved to `localStorage`. AI-controlled players populate the world so it feels alive. No internet, no accounts, no database needed.

### Multiplayer Mode (requires Supabase)

1. Create a free project at [supabase.com](https://supabase.com)
2. In the Supabase dashboard, open the **SQL Editor** and paste the entire contents of `supabase/schema.sql`, then run it. This creates all tables, RLS policies, and realtime configuration.
3. In your Supabase project settings, find **Project URL** and **anon public key**
4. Create a `.env` file in the project root with:
   ```
   VITE_SUPABASE_URL=https://yourproject.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
5. Enable **Anonymous Auth** in Supabase dashboard → Authentication → Sign In / Providers → enable "Anonymous"
6. `npm run dev` and choose **Multiplayer Mode**

Players are automatically given an anonymous identity that persists across sessions — no email signup required.

## Country Border Data

The game uses [Natural Earth](https://www.naturalearthdata.com/) public domain vector data. Specifically the `ne_110m_admin_0_countries` GeoJSON file, which is included at `public/countries.geo.json`.

To regenerate the tile grid (e.g. with higher resolution data):

1. Download a country borders GeoJSON file (e.g. from [Natural Earth Vector on GitHub](https://github.com/nvkelso/natural-earth-vector))
2. Place it at `public/countries.geo.json`
3. Run `node scripts/preprocess.mjs` — this generates `src/data/tiles.json` and `src/data/countries.json`

The preprocessing script subdivides land into a 3-degree grid, assigns each land tile to the country it falls within, and computes country centers and tile counts.

## Architecture

### Game Logic (`src/game/`)
- `types.ts` — All TypeScript interfaces including the `DataStore` interface
- `engine.ts` — Pure game logic: tile grid, economy, ticks, cities, countries, war resolution, leaderboards

### Data Stores (`src/store/`)
Two implementations of the same `DataStore` interface:
- `LocalStore.ts` — Solo mode, uses `localStorage`, runs AI players
- `SupabaseStore.ts` — Multiplayer mode, syncs via Supabase Realtime

Gameplay code never branches on mode — it calls `store.claimTile()`, `store.buildOnTile()`, etc. and the store handles persistence.

### Globe (`src/globe/`)
- `GlobeView.tsx` — Three.js sphere with country border outlines, tile markers, buildings, orbit camera

### UI (`src/ui/`)
- `MainMenu.tsx` — Mode selection, name/color picker
- `HUD.tsx` — Resource bar, breadcrumb, tile info panel with build actions
- `Panels.tsx` — Leaderboards, country dashboard (tax, projects, war), trade

## Gameplay

### Getting Started
- You start with 300 gold, 50 food, 30 resources, and 10 population
- Click any unclaimed land tile on the globe to see its price, then claim it
- Build on your tiles: Houses (population), Farms (food), Factories (gold), Stores (trade), Roads (boosts)

### Tick System
Every 45 seconds, production and consumption run across all your buildings. Farms produce food, factories consume resources and food to produce gold, houses grow population.

### Towns and Cities
- Control 6+ contiguous tiles → found a Town
- Grow to 18+ tiles → upgrade to a City

### Country Leadership
Control 25%+ of a country's tiles to become its leader. Leaders can:
- Set tax rates (0–50%) on citizens within their borders
- Fund national projects (infrastructure, agriculture, defense)
- Declare war on other countries

### War
War is intentionally expensive and risky:
- **Cost:** 500 gold upfront + 40 gold/tick upkeep
- **Resolution:** Every 2 ticks, attacker strength (modified by war exhaustion and randomness) is compared against defender strength (with a 1.4x defense bonus, plus 1.6x for small countries under 30 tiles)
- **Winning:** Transfer up to 10% of border tiles, drain 50% of defender treasury
- **Losing:** Lose 30% of your treasury, gain war exhaustion
- If you can't afford upkeep, you automatically lose

### Trade
- **Solo:** NPC market with fluctuating prices — buy/sell food and resources
- **Multiplayer:** Post trade offers (offer X for Y), other players accept or decline

## Tech Stack
- React 18 + TypeScript
- Three.js via @react-three/fiber and @react-three/drei
- Supabase (Postgres + Realtime + Anonymous Auth)
- Vite

## Build
```bash
npm run build    # type-check + production build to dist/
npm run preview  # preview the production build
```
