import { useState } from 'react';
import type { DataStore } from '../game/types';
import { isSupabaseConfigured } from '../store/SupabaseStore';

const COLORS = ['#e63946','#457b9d','#2a9d8f','#e9c46a','#f4a261','#588157','#118ab2','#06d6a0','#fb5607','#bc6c25','#52796f','#a98467'];

export function MainMenu({ onStart }: { onStart: (mode: 'solo' | 'multiplayer', name: string, color: string) => void }) {
  const [mode, setMode] = useState<'solo' | 'multiplayer'>('solo');
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const supabaseOk = isSupabaseConfigured();

  return (
    <div className="menu-overlay">
      <div className="menu-card">
        <h1 className="menu-title">TERRITORIA</h1>
        <p className="menu-sub">Claim land. Build cities. Rule nations.</p>

        <div className="mode-toggle">
          <button className={`mode-btn ${mode === 'solo' ? 'active' : ''}`} onClick={() => setMode('solo')}>
            Solo Mode
            <span className="mode-desc">Play against AI, no internet needed</span>
          </button>
          <button
            className={`mode-btn ${mode === 'multiplayer' ? 'active' : ''}`}
            onClick={() => setMode('multiplayer')}
            disabled={!supabaseOk}
          >
            Multiplayer
            <span className="mode-desc">{supabaseOk ? 'Live world synced online' : 'Requires Supabase setup'}</span>
          </button>
        </div>

        {!supabaseOk && mode === 'multiplayer' && (
          <div className="setup-notice">
            <p>Multiplayer needs a Supabase project. See the README for setup steps. Solo mode works right now.</p>
          </div>
        )}

        <div className="input-group">
          <label>Your name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Commander" maxLength={20} />
        </div>

        <div className="input-group">
          <label>Your color</label>
          <div className="color-grid">
            {COLORS.map(c => (
              <button key={c} className={`color-swatch ${color === c ? 'selected' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>

        <button className="start-btn" disabled={!name.trim()} onClick={() => onStart(mode, name.trim(), color)}>
          Enter the World
        </button>
      </div>
    </div>
  );
}
