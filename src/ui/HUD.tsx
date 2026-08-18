import type { GameState, Player } from '../game/types';
import { TILES, COUNTRIES, tilesOwnedBy, tilePriceFor, buildingsOnTile, COSTS } from '../game/engine';
import { useMemo } from 'react';
import type { DataStore } from '../game/types';

export function HUD({ state, currentPlayer, breadcrumb, onShowLeaderboard, onShowDashboard, onShowTrade }: {
  state: GameState;
  currentPlayer: Player | null;
  breadcrumb: string;
  onShowLeaderboard: () => void;
  onShowDashboard: () => void;
  onShowTrade: () => void;
}) {
  if (!currentPlayer) return null;
  const owned = tilesOwnedBy(state, currentPlayer.id);

  return (
    <>
      <div className="hud-top">
        <div className="hud-resources">
          <span className="res" title="Gold"><span className="res-icon gold" /> {Math.floor(currentPlayer.gold)}</span>
          <span className="res" title="Food"><span className="res-icon food" /> {Math.floor(currentPlayer.food)}</span>
          <span className="res" title="Resources"><span className="res-icon res" /> {Math.floor(currentPlayer.resources)}</span>
          <span className="res" title="Population"><span className="res-icon pop" /> {Math.floor(currentPlayer.population)}</span>
          <span className="res" title="Tiles"><span className="res-icon tile" /> {owned.length}</span>
        </div>
        <div className="hud-nav">
          <button className="hud-btn" onClick={onShowTrade}>Trade</button>
          <button className="hud-btn" onClick={onShowDashboard}>Nation</button>
          <button className="hud-btn" onClick={onShowLeaderboard}>Ranks</button>
        </div>
      </div>
      <div className="hud-breadcrumb">{breadcrumb}</div>
    </>
  );
}

export function TilePanel({ state, currentPlayer, selectedTileId, store }: {
  state: GameState;
  currentPlayer: Player | null;
  selectedTileId: number | null;
  store: DataStore;
}) {
  const tile = selectedTileId != null ? TILES.find(t => t.id === selectedTileId) : null;
  if (!tile) return null;
  const owner = state.tileOwner[tile.id];
  const ownerPlayer = owner ? state.players[owner] : null;
  const isMine = owner === currentPlayer?.id;
  const buildings = buildingsOnTile(state, tile.id);
  const price = tilePriceFor(state, tile.id);
  const country = COUNTRIES.find(c => c.id === tile.country);

  return (
    <div className="info-panel">
      <div className="panel-header">
        <span className="panel-country" style={{ color: country?.color }}>{country?.name}</span>
        <button className="panel-close" onClick={() => (window as any).__terr_deselect?.()}>x</button>
      </div>
      <div className="panel-body">
        <div className="panel-row"><span>Tile #{tile.id}</span><span>{tile.lat.toFixed(0)}°, {tile.lng.toFixed(0)}°</span></div>
        <div className="panel-row"><span>Owner</span><span>{ownerPlayer ? ownerPlayer.name : 'Unclaimed'}</span></div>
        {buildings.length > 0 && (
          <div className="panel-buildings">
            {buildings.map(b => (
              <div key={b.id} className="panel-building">
                <span className="building-type">{b.type} Lv.{b.level}</span>
                {isMine && <button className="mini-btn" onClick={() => store.upgradeBuilding(b.id)}>Upgrade</button>}
              </div>
            ))}
          </div>
        )}
        {!owner && currentPlayer && (
          <button className="action-btn" disabled={currentPlayer.gold < price} onClick={async () => store.claimTile(tile.id)}>
            Claim for {price} gold
          </button>
        )}
        {isMine && buildings.length === 0 && (
          <div className="build-menu">
            <p className="build-label">Build:</p>
            {(['house','farm','factory','store','road'] as const).map(type => {
              const c = COSTS[type];
              return (
                <button key={type} className="build-btn" disabled={currentPlayer.gold < c.gold} onClick={async () => store.buildOnTile(tile.id, type)}>
                  {type} ({c.gold}g{c.resources ? ` +${c.resources}r` : ''})
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
