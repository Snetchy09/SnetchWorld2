// Preprocess Natural Earth GeoJSON into tile grid, country list, and country polygon outlines.
// Run: node scripts/preprocess.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const geo = JSON.parse(fs.readFileSync(join(root, 'public/countries.geo.json'), 'utf8'));

const PALETTE = [
  '#e63946','#457b9d','#2a9d8f','#e9c46a','#f4a261','#e76f51',
  '#588157','#a98467','#6d6875','#b56576','#52796f','#bc6c25',
  '#3a86ff','#06d6a0','#ffb703','#fb5607','#118ab2','#ef476f',
  '#ffd166','#06aed5','#4d908e','#577590','#8cb369','#c44536',
  '#197278','#283d3b','#f3a712','#e76f51','#264653','#2b2d42',
];

// --- helpers ---
const bboxOf = (poly) => {
  let minLng=180,minLat=90,maxLng=-180,maxLat=-90;
  for (const [lng,lat] of poly) {
    if(lat<minLat)minLat=lat; if(lat>maxLat)maxLat=lat;
    if(lng<minLng)minLng=lng; if(lng>maxLng)maxLng=lng;
  }
  return {minLng,minLat,maxLng,maxLat};
};
const polysOf = (geom) => {
  const out=[];
  if(geom.type==='Polygon'){ out.push(geom.coordinates[0]); }
  else if(geom.type==='MultiPolygon'){ for(const p of geom.coordinates) out.push(p[0]); }
  return out;
};
const pointInPoly = (lng,lat,poly) => {
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i][0], yi=poly[i][1], xj=poly[j][0], yj=poly[j][1];
    const intersect = ((yi>lat)!==(yj>lat)) && (lng < (xj-xi)*(lat-yi)/(yj-yi)+xi);
    if(intersect) inside=!inside;
  }
  return inside;
};
// Simplify a polygon ring by dropping points that are nearly collinear
const simplify = (ring, tolerance = 0.5) => {
  if (ring.length <= 4) return ring;
  const out = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    const [px,py] = out[out.length-1];
    const [x,y] = ring[i];
    const [nx,ny] = ring[i+1];
    // cross product of vectors (prev->cur) x (cur->next)
    const cross = (x-px)*(ny-y) - (y-py)*(nx-x);
    const dist = Math.hypot(x-px, y-py);
    if (Math.abs(cross) > tolerance * dist || dist > tolerance) {
      out.push(ring[i]);
    }
  }
  out.push(ring[ring.length-1]);
  return out;
};

// --- Pass 1: extract countries ---
const countries = [];
const countryShapes = [];
for (let i = 0; i < geo.features.length; i++) {
  const f = geo.features[i];
  const name = f.properties.NAME || f.properties.ADMIN || f.properties.NAME_LONG;
  if (!name) continue;
  const color = PALETTE[i % PALETTE.length];
  countries.push({ id: name, name, color, idx: i });
  countryShapes.push({ name, geom: f.geometry });
}

// --- Pass 2: build tile grid ---
const STEP = 2.5;
const tiles = [];
const isAntarctica = (lat) => lat < -60;

const precomputed = countryShapes.map(c => {
  const polys = polysOf(c.geom);
  const boxes = polys.map(bboxOf);
  return { name:c.name, polys, boxes };
});

let id = 0;
for (let lat = -90 + STEP/2; lat < 90; lat += STEP) {
  for (let lng = -180 + STEP/2; lng < 180; lng += STEP) {
    if (isAntarctica(lat)) continue;
    let owner = null;
    for (const c of precomputed) {
      let inBox=false;
      for(const b of c.boxes){ if(lng>=b.minLng&&lng<=b.maxLng&&lat>=b.minLat&&lat<=b.maxLat){inBox=true;break;} }
      if(!inBox) continue;
      for (const poly of c.polys) { if (pointInPoly(lng,lat,poly)) { owner=c.name; break; } }
      if (owner) break;
    }
    if (owner) tiles.push({ id: id++, lat, lng, country: owner });
  }
}

// --- Pass 3: country centers + tile counts ---
const stats = {};
for (const t of tiles) {
  if(!stats[t.country]) stats[t.country]={sumLat:0,sumLng:0,count:0};
  stats[t.country].sumLat+=t.lat; stats[t.country].sumLng+=t.lng; stats[t.country].count++;
}
const countryOut = countries.map(c => {
  const s = stats[c.id] || {sumLat:0,sumLng:0,count:0};
  return {
    id: c.id, name: c.name, color: c.color,
    centerLat: s.count ? s.sumLat/s.count : 0,
    centerLng: s.count ? s.sumLng/s.count : 0,
    tileCount: s.count,
  };
}).filter(c => c.tileCount > 0);

// --- Pass 4: simplified polygon outlines for rendering ---
const outlines = [];
for (const c of countryShapes) {
  if (!stats[c.name] || stats[c.name].count === 0) continue;
  const polys = polysOf(c.geom);
  const simplified = polys.map(p => simplify(p, 0.8).map(([lng,lat]) => [lat, lng]));
  // Only keep the largest 3 polygons per country to keep data small
  simplified.sort((a,b) => b.length - a.length);
  outlines.push({ id: c.name, polys: simplified.slice(0, 3) });
}

// --- Write output ---
fs.mkdirSync(join(root,'src','data'),{recursive:true});
fs.writeFileSync(join(root,'src/data/tiles.json'), JSON.stringify(tiles));
fs.writeFileSync(join(root,'src/data/countries.json'), JSON.stringify(countryOut));
fs.writeFileSync(join(root,'src/data/outlines.json'), JSON.stringify(outlines));
console.log('tiles:', tiles.length, 'countries:', countryOut.length, 'outlines:', outlines.length);
