import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { GameState, Player } from '../game/types';
import { TILES, COUNTRIES, getTile, parcelOfPlayer } from '../game/engine';
import outlinesData from '../data/outlines.json';
import { TownScene } from './TownScene';

const RADIUS = 2;

type Outline = { id: string; polys: [number, number][][] };
const OUTLINES = outlinesData as Outline[];

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

function subdivideRing(ring: [number, number][], segments = 4): [number, number][] {
  if (ring.length < 2) return ring;
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push(a);
    for (let s = 1; s < segments; s++) {
      const t = s / segments;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function CountryLandmass() {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];

    for (const outline of OUTLINES) {
      const country = COUNTRIES.find(c => c.id === outline.id);
      if (!country) continue;
      const base = new THREE.Color(country.color);
      const green = new THREE.Color('#3d8b5a');
      base.lerp(green, 0.45);

      for (const ring of outline.polys) {
        if (ring.length < 3) continue;
        const subdiv = subdivideRing(ring, 6);
        const pts = subdiv.map(([lat, lng]) => latLngToVec3(lat, lng, RADIUS * 1.001));

        for (let i = 1; i < pts.length - 1; i++) {
          positions.push(pts[0].x, pts[0].y, pts[0].z);
          positions.push(pts[i].x, pts[i].y, pts[i].z);
          positions.push(pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
          const v = 0.88 + (i % 5) * 0.025;
          for (let k = 0; k < 3; k++) colors.push(base.r * v, base.g * v, base.b * v);
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
      <meshStandardMaterial vertexColors flatShading roughness={0.85} metalness={0.02} side={THREE.DoubleSide} />
    </mesh>
  );
}

function CountryBorders() {
  const lines = useMemo(() => {
    const segs: { points: [number, number, number][]; color: string }[] = [];
    for (const outline of OUTLINES) {
      for (const ring of outline.polys) {
        if (ring.length < 2) continue;
        const subdiv = subdivideRing(ring, 8);
        const pts: [number, number, number][] = subdiv.map(([lat, lng]) => {
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
        <Line key={i} points={seg.points} color={seg.color} lineWidth={1} transparent opacity={0.4} />
      ))}
    </group>
  );
}

function ParcelHighlight({ state, currentPlayer, zoom }: { state: GameState; currentPlayer: Player | null; zoom: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  const entries = useMemo(() => {
    const out: { tileIdx: number; playerId: string; isMine: boolean }[] = [];
    for (const parcel of Object.values(state.parcels)) {
      for (const tid of parcel.tileIds) {
        const idx = TILES.findIndex(t => t.id === tid);
        if (idx >= 0) {
          out.push({ tileIdx: idx, playerId: parcel.ownerId, isMine: parcel.ownerId === currentPlayer?.id });
        }
      }
    }
    return out;
  }, [state.parcels, currentPlayer]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = entries.length;
    const scale = zoom > 4 ? 0.035 : 0.028;
    for (let i = 0; i < entries.length; i++) {
      const { tileIdx, playerId, isMine } = entries[i];
      const pos = TILE_POSITIONS[tileIdx];
      dummy.position.copy(pos);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (isMine) colorObj.set('#ffd166');
      else {
        const p = state.players[playerId];
        colorObj.set(p?.color || '#888');
      }
      mesh.setColorAt(i, colorObj);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [entries, state.players, currentPlayer, dummy, colorObj, zoom]);

  if (zoom > 6) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(1, entries.length)]}>
      <boxGeometry args={[1, 0.15, 1]} />
      <meshStandardMaterial vertexColors flatShading roughness={0.7} transparent opacity={0.7} />
    </instancedMesh>
  );
}

function GlobeBuildings({ state, zoom }: { state: GameState; zoom: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);
  const buildings = useMemo(() => Object.values(state.buildings), [state.buildings]);
  const visible = zoom <= 3.5 && zoom >= 1.5;

  useEffect(() => {
    if (!visible) return;
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = buildings.length;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      const t = getTile(b.tileId);
      if (!t) continue;
      const phi = (90 - t.lat) * (Math.PI / 180);
      const theta = (t.lng + 180) * (Math.PI / 180);
      const r = RADIUS * 1.018 + b.level * 0.006;
      dummy.position.set(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
      const h = 0.025 + b.level * 0.01;
      dummy.scale.set(0.025, h, 0.025);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      colorObj.set(state.players[b.ownerId]?.color || '#fff');
      mesh.setColorAt(i, colorObj);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [buildings, state, dummy, colorObj, visible]);

  if (!visible) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(1, buildings.length)]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial vertexColors flatShading roughness={0.7} />
    </instancedMesh>
  );
}

function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
  const { camera } = useThree();
  const last = useRef(0);
  useFrame(() => {
    const dist = camera.position.length();
    const z = Math.max(0, Math.min(10, (dist - RADIUS * 0.08) / (RADIUS * 8 - RADIUS * 0.08) * 10));
    if (Math.abs(z - last.current) > 0.03) {
      last.current = z;
      onZoom(z);
    }
  });
  return null;
}

function CameraFocus({ target, controlsRef }: { target: { lat: number; lng: number } | null; controlsRef: React.RefObject<any> }) {
  useEffect(() => {
    if (!target || !controlsRef.current) return;
    const pos = latLngToVec3(target.lat, target.lng, RADIUS);
    const camPos = pos.clone().normalize().multiplyScalar(RADIUS * 0.25);
    controlsRef.current.object.position.copy(camPos);
    controlsRef.current.target.copy(pos.clone().normalize().multiplyScalar(RADIUS * 0.5));
    controlsRef.current.update();
  }, [target, controlsRef]);
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
  const [zoom, setZoom] = useState(5);
  const controlsRef = useRef<any>(null);

  const myParcel = currentPlayer ? parcelOfPlayer(state, currentPlayer.id) : null;
  const focusTarget = useMemo(() => {
    if (myParcel) return { lat: myParcel.centerLat, lng: myParcel.centerLng };
    if (focusCountry) {
      const c = COUNTRIES.find(x => x.id === focusCountry);
      if (c) return { lat: c.centerLat, lng: c.centerLng };
    }
    return null;
  }, [myParcel, focusCountry]);

  const parcelCenter = myParcel
    ? latLngToVec3(myParcel.centerLat, myParcel.centerLng, RADIUS * 1.002)
    : null;

  const handleSelect = useCallback((id: number) => {
    onSelectTile(id);
  }, [onSelectTile]);

  useEffect(() => {
    if (focusCountry && controlsRef.current) {
      const c = COUNTRIES.find(x => x.id === focusCountry);
      if (c) {
        const target = latLngToVec3(c.centerLat, c.centerLng, RADIUS);
        const camPos = target.clone().normalize().multiplyScalar(RADIUS * 2.5);
        controlsRef.current.object.position.copy(camPos);
        controlsRef.current.target.copy(new THREE.Vector3(0, 0, 0));
        controlsRef.current.update();
      }
    }
  }, [focusCountry]);

  const globeOpacity = zoom > 4 ? Math.max(0.15, 1 - (zoom - 4) / 4) : 1;

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 50%, #0a1929 0%, #050a14 70%)' }}>
      <Canvas camera={{ position: [0, 0, RADIUS * 3], fov: 50, near: 0.001, far: 100 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <ambientLight intensity={0.55 + (10 - zoom) * 0.03} />
        <directionalLight position={[5, 3, 5]} intensity={1.2} castShadow />
        <directionalLight position={[-3, -1, -2]} intensity={0.35} color="#6aa8d8" />

        <group visible={globeOpacity > 0.05}>
          <mesh>
            <sphereGeometry args={[RADIUS * 0.998, 64, 64]} />
            <meshStandardMaterial color="#1a5f8a" roughness={0.7} metalness={0.1} transparent opacity={globeOpacity} />
          </mesh>
          <mesh scale={1.05}>
            <sphereGeometry args={[RADIUS, 32, 32]} />
            <meshBasicMaterial color="#5aa8d8" transparent opacity={0.06 * globeOpacity} side={THREE.BackSide} />
          </mesh>

          <group visible={globeOpacity > 0.2}>
            <CountryLandmass />
            <CountryBorders />
            <ParcelHighlight state={state} currentPlayer={currentPlayer} zoom={zoom} />
            <GlobeBuildings state={state} zoom={zoom} />
          </group>
        </group>

        {myParcel && parcelCenter && (
          <TownScene
            parcel={myParcel}
            state={state}
            zoom={zoom}
            position={parcelCenter}
            up={parcelCenter.clone().normalize()}
            playerColor={currentPlayer?.color || '#ffd166'}
            onSelectTile={handleSelect}
            selectedTileId={selectedTileId}
          />
        )}

        {Object.values(state.parcels)
          .filter(p => p.ownerId !== currentPlayer?.id)
          .map(p => {
            const center = latLngToVec3(p.centerLat, p.centerLng, RADIUS * 1.002);
            return (
              <TownScene
                key={p.id}
                parcel={p}
                state={state}
                zoom={zoom}
                position={center}
                up={center.clone().normalize()}
                playerColor={state.players[p.ownerId]?.color || '#888'}
                selectedTileId={null}
              />
            );
          })}

        <ZoomTracker onZoom={setZoom} />
        <CameraFocus target={focusTarget} controlsRef={controlsRef} />
        <OrbitControls
          ref={controlsRef}
          enablePan={zoom > 5}
          minDistance={RADIUS * 0.06}
          maxDistance={RADIUS * 8}
          rotateSpeed={0.5}
          zoomSpeed={1.2}
          enableDamping
          dampingFactor={0.06}
        />
      </Canvas>

      <div style={{ position: 'absolute', right: 16, bottom: 80, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 10 }}>
        <button className="ctrl-btn" title="Zoom in" onClick={() => {
          const ctrl = controlsRef.current;
          if (ctrl) {
            const dir = ctrl.object.position.clone().sub(ctrl.target).normalize();
            ctrl.object.position.addScaledVector(dir, -RADIUS * 0.15);
            ctrl.update();
          }
        }}>+</button>
        <button className="ctrl-btn" title="Zoom out" onClick={() => {
          const ctrl = controlsRef.current;
          if (ctrl) {
            const dir = ctrl.object.position.clone().sub(ctrl.target).normalize();
            ctrl.object.position.addScaledVector(dir, RADIUS * 0.15);
            ctrl.update();
          }
        }}>-</button>
        {myParcel && (
          <button className="ctrl-btn" title="Focus my land" style={{ fontSize: 11 }} onClick={() => {
            if (controlsRef.current && myParcel) {
              const pos = latLngToVec3(myParcel.centerLat, myParcel.centerLng, RADIUS);
              controlsRef.current.object.position.copy(pos.clone().normalize().multiplyScalar(RADIUS * 0.15));
              controlsRef.current.target.copy(pos.clone().normalize().multiplyScalar(RADIUS * 0.5));
              controlsRef.current.update();
            }
          }}>Home</button>
        )}
      </div>

      <div className="zoom-indicator">
        {zoom < 2 ? 'World' : zoom < 4 ? 'Region' : zoom < 6 ? 'Town' : 'Street'}
      </div>
    </div>
  );
}
