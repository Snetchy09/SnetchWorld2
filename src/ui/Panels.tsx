import { useMemo, useState } from 'react';
import type { GameState, DataStore } from '../game/types';
import { computeLeaderboards, COUNTRIES, tilesOwnedBy, countryOfPlayer, TILES, WAR_COST, PROJECTS } from '../game/engine';

export function Leaderboard({ state, onClose }: { state: GameState; onClose: () => void }) {
  const { players, countries } = useMemo(() => computeLeaderboards(state), [state]);
  const [tab, setTab] = useState<'players' | 'countries'>('players');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Leaderboards</h2>
          <button className="panel-close" onClick={onClose}>x</button>
        </div>
        <div className="tab-toggle">
          <button className={tab === 'players' ? 'active' : ''} onClick={() => setTab('players')}>Players</button>
          <button className={tab === 'countries' ? 'active' : ''} onClick={() => setTab('countries')}>Countries</button>
        </div>
        {tab === 'players' ? (
          <table className="lb-table">
            <thead><tr><th>#</th><th>Player</th><th>Tiles</th><th>Pop</th><th>Gold</th></tr></thead>
            <tbody>
              {players.slice(0, 30).map((p, i) => (
                <tr key={p.id} className={p.isAI ? 'ai-row' : ''}>
                  <td>{i + 1}</td>
                  <td><span className="lb-color" style={{ background: p.color }} /> {p.name}{p.isAI && <span className="ai-tag">AI</span>}</td>
                  <td>{p.tileCount}</td>
                  <td>{Math.floor(p.population)}</td>
                  <td>{p.gold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="lb-table">
            <thead><tr><th>#</th><th>Country</th><th>Leader</th><th>Tiles</th><th>Military</th><th>Treasury</th></tr></thead>
            <tbody>
              {countries.slice(0, 30).map((c, i) => (
                <tr key={c.countryId}>
                  <td>{i + 1}</td>
                  <td><span className="lb-color" style={{ background: c.color }} /> {c.name}</td>
                  <td>{c.leaderName || '—'}</td>
                  <td>{c.tileCount}</td>
                  <td>{c.militaryStrength}</td>
                  <td>{c.treasury}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function CountryDashboard({ state, store, onClose }: { state: GameState; store: DataStore; onClose: () => void }) {
  const playerId = store.getCurrentPlayerId();
  const myCountryId = playerId ? countryOfPlayer(state, playerId) : null;
  const myCountry = myCountryId ? state.countries[myCountryId] : null;
  const def = myCountryId ? COUNTRIES.find(c => c.id === myCountryId) : null;
  const [warTarget, setWarTarget] = useState<string>('');
  const [confirmWar, setConfirmWar] = useState(false);

  if (!myCountry || !def || !myCountryId) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card" onClick={e => e.stopPropagation()}>
          <div className="modal-header"><h2>Nation Dashboard</h2><button className="panel-close" onClick={onClose}>x</button></div>
          <p className="empty-msg">You are not the leader of any country yet. Control at least 25% of a country's tiles to become its leader.</p>
        </div>
      </div>
    );
  }

  const otherCountries = COUNTRIES.filter(c => c.id !== myCountryId && state.countries[c.id]);
  const activeWars = Object.values(state.wars).filter(w => (w.attackerId === myCountryId || w.defenderId === myCountryId) && w.status === 'active');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2><span className="lb-color" style={{ background: def.color }} /> {def.name}</h2>
          <button className="panel-close" onClick={onClose}>x</button>
        </div>
        <div className="dash-stats">
          <div className="stat-box"><span className="stat-val">{Math.floor(myCountry.treasury)}</span><span className="stat-label">Treasury</span></div>
          <div className="stat-box"><span className="stat-val">{Math.floor(myCountry.militaryStrength)}</span><span className="stat-label">Military</span></div>
          <div className="stat-box"><span className="stat-val">{(myCountry.taxRate * 100).toFixed(0)}%</span><span className="stat-label">Tax Rate</span></div>
          <div className="stat-box"><span className="stat-val">{myCountry.warExhaustion.toFixed(1)}</span><span className="stat-label">War Exhaustion</span></div>
        </div>

        <div className="dash-section">
          <h3>Tax Rate</h3>
          <input type="range" min="0" max="50" value={myCountry.taxRate * 100} onChange={e => store.setTaxRate(myCountryId, Number(e.target.value) / 100)} />
          <p className="hint">Higher taxes fill the treasury but slow citizen growth.</p>
        </div>

        <div className="dash-section">
          <h3>National Projects</h3>
          <div className="project-list">
            {PROJECTS.map(p => (
              <div key={p.id} className="project-card">
                <div><strong>{p.name}</strong><p className="hint">{p.effect}</p></div>
                <button disabled={myCountry.treasury < p.cost || myCountry.activeProjectId === p.id} onClick={() => store.fundProject(myCountryId, p.id)}>
                  {myCountry.activeProjectId === p.id ? `Active (${myCountry.projectProgress})` : `Fund (${p.cost}g)`}
                </button>
              </div>
            ))}
          </div>
        </div>

        {activeWars.length > 0 && (
          <div className="dash-section">
            <h3>Active Wars</h3>
            {activeWars.map(w => {
              const other = w.attackerId === myCountryId ? w.defenderId : w.attackerId;
              const od = COUNTRIES.find(c => c.id === other);
              return <div key={w.id} className="war-row">vs {od?.name} — {w.status}</div>;
            })}
          </div>
        )}

        <div className="dash-section">
          <h3>Declare War</h3>
          <p className="warning">War costs {WAR_COST} gold upfront plus ongoing upkeep. Small countries get a defense bonus — conquest is a gamble.</p>
          <select value={warTarget} onChange={e => setWarTarget(e.target.value)}>
            <option value="">Select target country...</option>
            {otherCountries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {warTarget && (
            <>
              {!confirmWar ? (
                <button className="war-btn" disabled={myCountry.treasury < WAR_COST} onClick={() => setConfirmWar(true)}>
                  Prepare War Declaration
                </button>
              ) : (
                <div className="war-confirm">
                  <p>Are you sure? This costs {WAR_COST} gold and will drain your treasury every tick.</p>
                  <button className="war-btn danger" onClick={async () => { await store.declareWar(myCountryId, warTarget); setConfirmWar(false); setWarTarget(''); }}>
                    Declare War
                  </button>
                  <button className="hud-btn" onClick={() => setConfirmWar(false)}>Cancel</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function TradePanel({ state, store, onClose }: { state: GameState; store: DataStore; onClose: () => void }) {
  const [offerGold, setOfferGold] = useState(0);
  const [offerFood, setOfferFood] = useState(0);
  const [offerRes, setOfferRes] = useState(0);
  const [wantGold, setWantGold] = useState(0);
  const [wantFood, setWantFood] = useState(0);
  const [wantRes, setWantRes] = useState(0);
  const playerId = store.getCurrentPlayerId();
  const offers = Object.values(state.tradeOffers).filter(o => o.fromPlayerId !== playerId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h2>Trade</h2><button className="panel-close" onClick={onClose}>x</button></div>

        <div className="dash-section">
          <h3>NPC Market (Solo)</h3>
          <p className="hint">Food: {state.market.food.toFixed(2)}g each | Resources: {state.market.resources.toFixed(2)}g each</p>
          <div className="market-row">
            <button onClick={() => store.npcTrade('food', 10, true)}>Buy 10 food</button>
            <button onClick={() => store.npcTrade('food', 10, false)}>Sell 10 food</button>
            <button onClick={() => store.npcTrade('resources', 10, true)}>Buy 10 res</button>
            <button onClick={() => store.npcTrade('resources', 10, false)}>Sell 10 res</button>
          </div>
        </div>

        <div className="dash-section">
          <h3>Create Trade Offer</h3>
          <div className="trade-grid">
            <div>
              <p className="trade-label">You offer</p>
              <label>Gold: <input type="number" value={offerGold} onChange={e => setOfferGold(+e.target.value)} min={0} /></label>
              <label>Food: <input type="number" value={offerFood} onChange={e => setOfferFood(+e.target.value)} min={0} /></label>
              <label>Resources: <input type="number" value={offerRes} onChange={e => setOfferRes(+e.target.value)} min={0} /></label>
            </div>
            <div>
              <p className="trade-label">You want</p>
              <label>Gold: <input type="number" value={wantGold} onChange={e => setWantGold(+e.target.value)} min={0} /></label>
              <label>Food: <input type="number" value={wantFood} onChange={e => setWantFood(+e.target.value)} min={0} /></label>
              <label>Resources: <input type="number" value={wantRes} onChange={e => setWantRes(+e.target.value)} min={0} /></label>
            </div>
          </div>
          <button onClick={() => store.createTradeOffer({ gold: offerGold, food: offerFood, resources: offerRes }, { gold: wantGold, food: wantFood, resources: wantRes })}>
            Post Offer
          </button>
        </div>

        {offers.length > 0 && (
          <div className="dash-section">
            <h3>Open Offers</h3>
            {offers.map(o => {
              const from = state.players[o.fromPlayerId];
              return (
                <div key={o.id} className="offer-row">
                  <span><span className="lb-color" style={{ background: from?.color }} /> {from?.name} offers {o.offer.gold||0}g {o.offer.food||0}f {o.offer.resources||0}r for {o.want.gold||0}g {o.want.food||0}f {o.want.resources||0}r</span>
                  <div>
                    <button className="mini-btn" onClick={() => store.acceptTradeOffer(o.id)}>Accept</button>
                    <button className="mini-btn" onClick={() => store.declineTradeOffer(o.id)}>Decline</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
