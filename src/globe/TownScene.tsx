import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { GameState, Building, Business, LandParcel } from '../game/types';
import { getTile } from '../game/engine';

const CELL_SIZE = 0.12;

function slerpVec3(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const dot = Math.max(-1, Math.min(1, a.dot(b)));
  const theta = Math.acos(dot) * t;
  const rel = new THREE.Vector3().subVectors(b, a).addScaledVector(a, -dot).normalize();
  return out.copy(a).multiplyScalar(Math.cos(theta)).addScaledVector(rel, Math.sin(theta));
}

export function computeParcelLayout(parcel: LandParcel): Map<number, { x: number; z: number; lat: number; lng: number }> {
  const layout = new Map<number, { x: number; z: number; lat: number; lng: number }>();
  if (!parcel.tileIds.length) return layout;

  const centerLat = parcel.centerLat;
  const centerLng = parcel.centerLng;
  const cosLat = Math.cos(centerLat * Math.PI / 180);

  for (const tid of parcel.tileIds) {
    const t = getTile(tid);
    if (!t) continue;
    const x = (t.lng - centerLng) * cosLat * 0.035;
    const z = -(t.lat - centerLat) * 0.035;
    layout.set(tid, { x, z, lat: t.lat, lng: t.lng });
  }
  return layout;
}

function LowPolyBuilding({ x, z, type, color, scale = 1 }: {
  x: number; z: number; type: string; color: string; scale?: number;
}) {
  const h = type === 'factory' ? 0.18 : type === 'home' || type === 'house' ? 0.14 : 0.12;
  const w = type === 'factory' ? 0.1 : 0.08;
  const roofH = 0.04 * scale;

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h * scale / 2, 0]} castShadow>
        <boxGeometry args={[w * scale, h * scale, w * scale * 0.9]} />
        <meshStandardMaterial color={color} flatShading />
      </mesh>
      <mesh position={[0, h * scale + roofH / 2, 0]} castShadow>
        <coneGeometry args={[w * scale * 0.75, roofH, 4]} />
        <meshStandardMaterial color={new THREE.Color(color).multiplyScalar(0.7)} flatShading />
      </mesh>
    </group>
  );
}

function LowPolyBusiness({ x, z, name, type, color }: {
  x: number; z: number; name: string; type: string; color: string;
}) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.12, 0.2, 0.1]} />
        <meshStandardMaterial color={color} flatShading />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[0.13, 0.04, 0.11]} />
        <meshStandardMaterial color="#ffd166" flatShading />
      </mesh>
      <mesh position={[0.06, 0.08, 0.051]}>
        <boxGeometry args={[0.04, 0.06, 0.01]} />
        <meshStandardMaterial color="#87ceeb" flatShading />
      </mesh>
    </group>
  );
}

function RoadGrid({ layout, parcel }: { layout: Map<number, { x: number; z: number }>; parcel: LandParcel }) {
  const roads = useMemo(() => {
    const segs: { x1: number; z1: number; x2: number; z2: number }[] = [];
    const tileSet = new Set(parcel.tileIds);
    for (const tid of parcel.tileIds) {
      const a = layout.get(tid);
      if (!a) continue;
      const t = getTile(tid);
      if (!t) continue;
      for (let dlat = -2.5; dlat <= 2.5; dlat += 2.5) {
        for (let dlng = -2.5; dlng <= 2.5; dlng += 2.5) {
          if (dlat === 0 && dlng === 0) continue;
          const key = `${(t.lat + dlat).toFixed(1)},${(t.lng + dlng).toFixed(1)}`;
          for (const [otherId, b] of layout) {
            const ot = getTile(otherId);
            if (!ot) continue;
            const okey = `${ot.lat.toFixed(1)},${ot.lng.toFixed(1)}`;
            if (key === okey && tileSet.has(otherId) && otherId > tid) {
              segs.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z });
            }
          }
        }
      }
    }
    return segs;
  }, [layout, parcel]);

  return (
    <group>
      {roads.map((r, i) => {
        const mx = (r.x1 + r.x2) / 2;
        const mz = (r.z1 + r.z2) / 2;
        const len = Math.hypot(r.x2 - r.x1, r.z2 - r.z1);
        const rot = Math.atan2(r.x2 - r.x1, r.z2 - r.z1);
        return (
          <mesh key={i} position={[mx, 0.005, mz]} rotation={[0, rot, 0]}>
            <boxGeometry args={[0.04, 0.01, len + 0.02]} />
            <meshStandardMaterial color="#555555" flatShading />
          </mesh>
        );
      })}
    </group>
  );
}

function Trees({ layout, seed }: { layout: Map<number, { x: number; z: number }>; seed: number }) {
  const trees = useMemo(() => {
    const out: { x: number; z: number; s: number }[] = [];
    let rng = seed;
    const rand = () => { rng = (rng * 16807 + 0) % 2147483647; return rng / 2147483647; };
    for (const [, pos] of layout) {
      if (rand() > 0.6) {
        out.push({ x: pos.x + (rand() - 0.5) * 0.06, z: pos.z + (rand() - 0.5) * 0.06, s: 0.5 + rand() * 0.5 });
      }
    }
    return out;
  }, [layout, seed]);

  return (
    <group>
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]}>
          <mesh position={[0, 0.02 * t.s, 0]}>
            <cylinderGeometry args={[0.008 * t.s, 0.01 * t.s, 0.04 * t.s, 5]} />
            <meshStandardMaterial color="#6b4423" flatShading />
          </mesh>
          <mesh position={[0, 0.05 * t.s, 0]}>
            <coneGeometry args={[0.025 * t.s, 0.05 * t.s, 5]} />
            <meshStandardMaterial color="#2d6a4f" flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export interface TownSceneProps {
  parcel: LandParcel;
  state: GameState;
  zoom: number;
  position: THREE.Vector3;
  up: THREE.Vector3;
  playerColor: string;
  onSelectTile?: (id: number) => void;
  selectedTileId: number | null;
}

export function TownScene({ parcel, state, zoom, position, up, playerColor, onSelectTile, selectedTileId }: TownSceneProps) {
  const layout = useMemo(() => computeParcelLayout(parcel), [parcel]);
  const opacity = Math.min(1, Math.max(0, (zoom - 4) / 2));

  const quaternion = useMemo(() => {
    const normal = position.clone().normalize();
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    return q;
  }, [position]);

  const buildings = useMemo(() =>
    Object.values(state.buildings).filter(b => parcel.tileIds.includes(b.tileId)),
    [state.buildings, parcel],
  );
  const businesses = useMemo(() =>
    Object.values(state.businesses).filter(b => b.parcelId === parcel.id),
    [state.businesses, parcel],
  );

  if (opacity <= 0.01) return null;

  const terrainSize = Math.max(0.4, Math.sqrt(parcel.tileIds.length) * CELL_SIZE * 1.5);

  return (
    <group position={position} quaternion={quaternion}>
      <group scale={1 + (10 - zoom) * 0.05}>
        {/* Terrain pad */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <circleGeometry args={[terrainSize, 24]} />
          <meshStandardMaterial color="#4a7c59" flatShading transparent opacity={opacity} />
        </mesh>

        <group visible={opacity > 0.3}>
          <RoadGrid layout={layout} parcel={parcel} />
          <Trees layout={layout} seed={parcel.id.charCodeAt(6) || 42} />

          {buildings.map(b => {
            const pos = layout.get(b.tileId);
            if (!pos) return null;
            const p = state.players[b.ownerId];
            return (
              <LowPolyBuilding
                key={b.id}
                x={pos.x}
                z={pos.z}
                type={b.type}
                color={p?.color || playerColor}
                scale={0.8 + b.level * 0.15}
              />
            );
          })}

          {businesses.map(biz => {
            const pos = layout.get(biz.tileId);
            if (!pos) return null;
            return (
              <LowPolyBusiness
                key={biz.id}
                x={pos.x}
                z={pos.z}
                name={biz.name}
                type={biz.type}
                color="#c77dff"
              />
            );
          })}

          {/* Clickable tile pads */}
          {parcel.tileIds.map(tid => {
            const pos = layout.get(tid);
            if (!pos) return null;
            const isSel = tid === selectedTileId;
            return (
              <mesh
                key={tid}
                position={[pos.x, 0.008, pos.z]}
                rotation={[-Math.PI / 2, 0, 0]}
                onClick={(e) => { e.stopPropagation(); onSelectTile?.(tid); }}
              >
                <planeGeometry args={[CELL_SIZE * 0.9, CELL_SIZE * 0.9]} />
                <meshStandardMaterial
                  color={isSel ? '#ffd166' : playerColor}
                  transparent
                  opacity={isSel ? 0.5 : 0.15}
                  flatShading
                />
              </mesh>
            );
          })}
        </group>
      </group>
    </group>
  );
}

export { slerpVec3 };
