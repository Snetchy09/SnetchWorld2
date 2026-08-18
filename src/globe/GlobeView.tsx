import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Canvas, useFrame, useThree, extend } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { GameState, Player } from '../game/types';
import { TILES, COUNTRIES, getTile } from '../game/engine';
import outlinesData from '../data/outlines.json';

const RADIUS = 2;

type Outline = { id: string; polys: [number, number][][] };
const OUTLINES = outlinesData as Outline[];

// Precompute tile positions on sphere (done once)
const TILE_POSITIONS = TILES.map(t => {
  const phi = (90 - t.lat) * (Math.PI / 180);
  const theta = (t.lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -RADIUS * 1.004 * Math.sin(phi) * Math.cos(theta),
    RADIUS * 1.004 * Math.cos(phi),
    RADIUS * 1.004 * Math.sin(phi) * Math.sin(theta),
  );
});

function latLngToVec3(lat: number, lng: number, r = RADIUS): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

// Merge all country landmass triangles into ONE buffer geometry (single draw call)
function CountryLandmass() {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    for (const outline of OUTLINES) {
      const country = COUNTRIES.find(c => c.id === outline.id);
      if (!country) continue;
      const base = new THREE.Color(country.color);
      const green = new THREE.Color('#3a7d44');
      base.lerp(green, 0.55);
      for (const ring of outline.polys) {
        if (ring.length < 3) continue;
        const pts = ring.map(([lat, lng]) => latLngToVec3(lat, lng, RADIUS * 1.001));
        for (let i = 1; i < pts.length - 1; i++) {
          positions.push(pts[0].x, pts[0].y, pts[0].z);
          positions.push(pts[i].x, pts[i].y, pts[i].z);
          positions.push(pts[i+1].x, pts[i+1].y, pts[i+1].z);
          const v = 0.85 + Math.random() * 0.3;
          colors.push(base.r * v, base.g * v, base.b * v);
          colors.push(base.r * v, base.g * v, base.b * v);
          colors.push(base.r * v, base.g * v, base.b * v);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors flatShading roughness={0.8} metalness={0.05} side={THREE.DoubleSide} />
    </mesh>
  );
}

// Country borders — merged into fewer Line components by batching
function CountryBorders() {
  const lines = useMemo(() => {
    const segs: { points: [number, number, number][]; color: string }[] = [];
    for (const outline of OUTLINES) {
      for (const ring of outline.polys) {
        if (ring.length < 2) continue;
        const pts: [number, number, number][] = ring.map(([lat, lng]) => {
          const v = latLngToVec3(lat, lng, RADIUS * 1.003);
          return [v.x, v.y, v.z];
        });
        pts.push(pts[0]);
        segs.push({ points: pts, color: '#1a3a2a' });
      }
    }
    return segs;
  }, []);

  return (
    <group>
      {lines.map((seg, i) => (
        <Line key={i} points={seg.points} color={seg.color} lineWidth={1} transparent opacity={0.35} />
      ))}
    </group>
  );
}

// Instanced tiles — one draw call for ALL unclaimed tiles
function UnclaimedTiles({ state, onSelectTile, selectedTileId, zoom }: {
  state: GameState;
  onSelectTile: (id: number) => void;
  selectedTileId: number | null;
  zoom: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  // Build a lookup: tile index -> whether it's unclaimed
  const unclaimedIndices = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < TILES.length; i++) {
      if (!state.tileOwner[TILES[i].id]) out.push(i);
    }
    return out;
  }, [state.tileOwner]);

  const visible = zoom <= 2.0;

  // Update instance matrices only when needed
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const count = visible ? unclaimedIndices.length : 0;
    mesh.count = count;
    for (let i = 0; i < count; i++) {
      const tileIdx = unclaimedIndices[i];
      const pos = TILE_POSITIONS[tileIdx];
      dummy.position.copy(pos);
      const isSel = TILES[tileIdx].id === selectedTileId;
      const scale = isSel ? 0.022 : 0.01;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (isSel) {
        colorObj.set('#ffeb3b');
      } else {
        colorObj.set('#4a8a54');
      }
      mesh.setColorAt(i, colorObj);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [unclaimedIndices, selectedTileId, visible, dummy, colorObj]);

  if (!visible) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, TILES.length]}
      onClick={(e) => {
        e.stopPropagation();
        const instId = e.instanceId;
        if (instId != null && instId < unclaimedIndices.length) {
          const tileIdx = unclaimedIndices[instId];
          onSelectTile(TILES[tileIdx].id);
        }
      }}
    >
      <sphereGeometry args={[1, 6, 5]} />
      <meshStandardMaterial vertexColors flatShading transparent opacity={0.5} />
    </instancedMesh>
  );
}

// Instanced owned territory — one draw call for ALL owned tiles
function OwnedTerritory({ state, currentPlayer }: { state: GameState; currentPlayer: Player | null }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  const ownedEntries = useMemo(() => {
    const out: { tileIdx: number; playerId: string }[] = [];
    for (let i = 0; i < TILES.length; i++) {
      const pid = state.tileOwner[TILES[i].id];
      if (pid) out.push({ tileIdx: i, playerId: pid });
    }
    return out;
  }, [state.tileOwner]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = ownedEntries.length;
    for (let i = 0; i < ownedEntries.length; i++) {
      const { tileIdx, playerId } = ownedEntries[i];
      const pos = TILE_POSITIONS[tileIdx];
      dummy.position.copy(pos);
      dummy.scale.setScalar(0.025);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const isMine = playerId === currentPlayer?.id;
      if (isMine) {
        colorObj.set('#ffd166');
      } else {
        const p = state.players[playerId];
        colorObj.set(p?.color || '#ffffff');
      }
      mesh.setColorAt(i, colorObj);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [ownedEntries, state.players, currentPlayer, dummy, colorObj]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, Math.max(1, ownedEntries.length)]}
    >
      <sphereGeometry args={[1, 8, 6]} />
      <meshStandardMaterial vertexColors flatShading roughness={0.6} />
    </instancedMesh>
  );
}

// Instanced buildings — one draw call for ALL buildings
function BuildingsLayer({ state, zoom }: { state: GameState; zoom: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  const buildings = useMemo(() => Object.values(state.buildings), [state.buildings]);

  if (zoom > 1.2) return null;

  return (
    <BuildingsInstanced
      buildings={buildings}
      state={state}
      meshRef={meshRef}
      dummy={dummy}
      colorObj={colorObj}
    />
  );
}

function BuildingsInstanced({ buildings, state, meshRef, dummy, colorObj }: {
  buildings: ReturnType<typeof Object.values<any>>;
  state: GameState;
  meshRef: React.RefObject<THREE.InstancedMesh>;
  dummy: THREE.Object3D;
  colorObj: THREE.Color;
}) {
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = buildings.length;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      const t = getTile(b.tileId);
      if (!t) continue;
      const phi = (90 - t.lat) * (Math.PI / 180);
      const theta = (t.lng + 180) * (Math.PI / 180);
      const r = RADIUS * 1.015 + b.level * 0.008;
      dummy.position.set(
        -r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      );
      const h = 0.03 + b.level * 0.015;
      // Use box shape for all buildings, scale differently per type
      const sx = b.type === 'factory' ? 0.04 : b.type === 'house' ? 0.035 : 0.03;
      const sy = b.type === 'factory' ? h * 1.3 : h;
      const sz = sx;
      dummy.scale.set(sx, sy, sz);
      dummy.rotation.set(0, (b.id.charCodeAt(2) || 0) % 3, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const p = state.players[b.ownerId];
      colorObj.set(p?.color || '#ffffff');
      mesh.setColorAt(i, colorObj);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [buildings, state, meshRef, dummy, colorObj]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(1, buildings.length)]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial vertexColors flatShading roughness={0.7} />
    </instancedMesh>
  );
}

// Zoom tracker — passive, no camera fighting
function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
  const { camera } = useThree();
  const last = useRef(0);
  useFrame(() => {
    const dist = camera.position.length();
    const z = Math.max(0, Math.min(3, (dist - RADIUS * 1.3) / (RADIUS * 5 - RADIUS * 1.3) * 3));
    if (Math.abs(z - last.current) > 0.02) {
      last.current = z;
      onZoom(z);
    }
  });
  return null;
}

export interface GlobeViewProps {
  state: GameState;
  currentPlayer: Player | null;
  selectedTileId: number | null;
  onSelectTile: (id: number | null) => void;
  focusCountry: string | null;
}

export function GlobeView({ state, currentPlayer, selectedTileId, onSelectTile, focusCountry }: GlobeViewProps) {
  const [zoom, setZoom] = useState(3);
  const controlsRef = useRef<any>(null);

  const handleSelect = useCallback((id: number) => {
    onSelectTile(id);
  }, [onSelectTile]);

  useEffect(() => {
    if (focusCountry && controlsRef.current) {
      const c = COUNTRIES.find(x => x.id === focusCountry);
      if (c) {
        const target = latLngToVec3(c.centerLat, c.centerLng, RADIUS);
        const camPos = target.clone().normalize().multiplyScalar(RADIUS * 3.2);
        controlsRef.current.object.position.copy(camPos);
        controlsRef.current.target.copy(new THREE.Vector3(0, 0, 0));
        controlsRef.current.update();
      }
    }
  }, [focusCountry]);

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 50%, #0a1929 0%, #050a14 70%)' }}>
      <Canvas camera={{ position: [0, 0, RADIUS * 4], fov: 45 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 3, 5]} intensity={1.3} />
        <directionalLight position={[-5, -2, -3]} intensity={0.4} color="#6aa8d8" />

        {/* Ocean */}
        <mesh>
          <sphereGeometry args={[RADIUS * 0.998, 48, 48]} />
          <meshStandardMaterial color="#1a5f8a" roughness={0.7} metalness={0.1} flatShading />
        </mesh>
        {/* Atmosphere */}
        <mesh scale={1.05}>
          <sphereGeometry args={[RADIUS, 24, 24]} />
          <meshBasicMaterial color="#5aa8d8" transparent opacity={0.06} side={THREE.BackSide} />
        </mesh>

        {/* Green landmasses — single mesh */}
        <CountryLandmass />
        <CountryBorders />

        {/* Territory + tiles — instanced, single draw calls */}
        <OwnedTerritory state={state} currentPlayer={currentPlayer} />
        <UnclaimedTiles state={state} onSelectTile={handleSelect} selectedTileId={selectedTileId} zoom={zoom} />
        <BuildingsLayer state={state} zoom={zoom} />

        <ZoomTracker onZoom={setZoom} />
        <OrbitControls
          ref={controlsRef}
          enablePan={false}
          minDistance={RADIUS * 1.15}
          maxDistance={RADIUS * 5}
          rotateSpeed={0.6}
          zoomSpeed={0.9}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>

      {/* Zoom buttons */}
      <div style={{ position: 'absolute', right: 16, bottom: 80, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 10 }}>
        <button className="ctrl-btn" onClick={() => {
          const ctrl = controlsRef.current;
          if (ctrl) {
            const dir = ctrl.object.position.clone().sub(ctrl.target).normalize();
            ctrl.object.position.addScaledVector(dir, -RADIUS * 0.4);
            ctrl.update();
          }
        }}>+</button>
        <button className="ctrl-btn" onClick={() => {
          const ctrl = controlsRef.current;
          if (ctrl) {
            const dir = ctrl.object.position.clone().sub(ctrl.target).normalize();
            ctrl.object.position.addScaledVector(dir, RADIUS * 0.4);
            ctrl.update();
          }
        }}>-</button>
      </div>
    </div>
  );
}
