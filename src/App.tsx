import { useState, useEffect, useMemo, useRef } from 'react';
import type { DataStore, GameState } from './game/types';
import { LocalStore } from './store/LocalStore';
import { SupabaseStore, isSupabaseConfigured } from './store/SupabaseStore';
import { GlobeView } from './globe/GlobeView';
import { MainMenu } from './ui/MainMenu';
import { HUD, TilePanel } from './ui/HUD';
import { Leaderboard, CountryDashboard, TradePanel } from './ui/Panels';
import { TILES, COUNTRIES } from './game/engine';

type Screen = 'menu' | 'game';

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [store, setStore] = useState<DataStore | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const [, setVersion] = useState(0);
  const [selectedTileId, setSelectedTileId] = useState<number | null>(null);
  const [focusCountry, setFocusCountry] = useState<string | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showTrade, setShowTrade] = useState(false);

  useEffect(() => {
    if (!store) return;
    const unsub = store.subscribe(s => {
      stateRef.current = s;
      setVersion(v => (v + 1) % 1000000);
    });
    return () => { unsub(); };
  }, [store]);

  (window as any).__terr_deselect = () => setSelectedTileId(null);

  const handleStart = async (mode: 'solo' | 'multiplayer', name: string, color: string) => {
    let s: DataStore;
    if (mode === 'multiplayer') {
      if (!isSupabaseConfigured()) { alert('Supabase is not configured. See README.'); return; }
      s = new SupabaseStore();
    } else {
      s = new LocalStore();
    }
    await s.createPlayer(name, color);
    setStore(s);
    setScreen('game');
  };

  const state = stateRef.current;
  const currentPlayer = store && state ? state.players[store.getCurrentPlayerId() || ''] : null;

  const breadcrumb = useMemo(() => {
    if (!selectedTileId) return 'Globe';
    const t = TILES.find(x => x.id === selectedTileId);
    if (!t) return 'Globe';
    const c = COUNTRIES.find(x => x.id === t.country);
    return `Globe > ${c?.name || t.country} > Tile #${t.id}`;
  }, [selectedTileId]);

  if (screen === 'menu' || !store || !state) {
    return <MainMenu onStart={handleStart} />;
  }

  return (
    <div className="app-root">
      <GlobeView
        state={state}
        currentPlayer={currentPlayer || null}
        selectedTileId={selectedTileId}
        onSelectTile={(id) => setSelectedTileId(id)}
        focusCountry={focusCountry}
      />
      <HUD
        state={state}
        currentPlayer={currentPlayer || null}
        breadcrumb={breadcrumb}
        onShowLeaderboard={() => setShowLeaderboard(true)}
        onShowDashboard={() => setShowDashboard(true)}
        onShowTrade={() => setShowTrade(true)}
      />
      {selectedTileId != null && (
        <TilePanel state={state} currentPlayer={currentPlayer || null} selectedTileId={selectedTileId} store={store} />
      )}
      {showLeaderboard && <Leaderboard state={state} onClose={() => setShowLeaderboard(false)} />}
      {showDashboard && <CountryDashboard state={state} store={store} onClose={() => setShowDashboard(false)} />}
      {showTrade && <TradePanel state={state} store={store} onClose={() => setShowTrade(false)} />}
    </div>
  );
}
