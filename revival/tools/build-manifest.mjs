// Scans the extracted asset folders and writes revival/public/manifest.json:
// which meshes make up each map, which texture goes on each mesh, the NPC
// roster and the object archetypes declared in world_objects.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'revival/public/manifest.json');

// "foo #1234.obj" and "foo.obj" come from different asset bundles that reused a name.
// Usually identical, but not always, so every variant is kept (plain name first).
function assetVariants(dir, ext) {
  const byName = new Map();
  for (const file of fs.readdirSync(path.join(ROOT, dir)).sort()) {
    if (!file.endsWith(ext)) continue;
    const name = file.slice(0, -ext.length).replace(/ #\d+$/, '');
    const list = byName.get(name) ?? [];
    if (file.includes(' #')) list.push(`${dir}/${file}`); else list.unshift(`${dir}/${file}`);
    byName.set(name, list);
  }
  return byName;
}

function uniqueAssets(dir, ext) {
  return new Map([...assetVariants(dir, ext)].map(([name, files]) => [name, files[0]]));
}

const meshVariants = assetVariants('Mesh', '.obj');
const meshes = uniqueAssets('Mesh', '.obj');
const textures = uniqueAssets('Texture2D', '.png');

// Material name -> texture, following the naming conventions of the original build.
const TEXTURE_ALIASES = {
  colourPaletteOutline: 'colourPaletteSuburbs_col',
  colourPaletteOutlineSuburbs: 'colourPaletteSuburbs_col',
  colourPaletteSuburbsOutline: 'colourPaletteSuburbs_col',
  colourPaletteSubrubs: 'colourPaletteSuburbs_col',
  shadowPine: 'shadowCircle_col',
  shadowTree: 'shadowCircle_col',
  delorian: 'delorean_col',
  fences: 'fence01_col',
  paths: 'path01_col',
  detailGarbage: 'detailGarbagecan_dtl',
  collection01: 'collectables01_col',
  Clouds1: 'backdropClouds_col',
  Clouds2: 'backdropClouds_col',
  detailRoofingSuburbs: 'detailRoofing_dtl',
  detailSidingSuburbs: 'detailSiding_dtl',
  detailBush01: 'bush01_col',
  billboardBush: 'billboardTree_col',
  mayorStand_mayorWestHere: 'mayorWestHere_col',
  mayorStand_podium: 'podiumSkirt_col',
  mayorStand_shadowCircle: 'shadowCircle_col',
  mayorStand_flower: 'colourPaletteSuburbs_col',
  mayorStand_townhallOfficeSign: 'colourPaletteSuburbs_col',
  curtain: 'interiorCurtain_col',
};

const ucfirst = (s) => s[0].toUpperCase() + s.slice(1);

// `prefix` names the per-map texture family ("griffinHouse" -> griffinHouseDen_col);
// `fallback` is the shared palette most props of a map are painted with.
function findTexture(material, { prefix, fallback } = {}) {
  const base = material.replace(/_geo\d*$/, '').replace(/^_/, '');
  const candidates = [
    TEXTURE_ALIASES[base],
    prefix && `${prefix}${ucfirst(base.replace(/Outline$/, ''))}_col`,
    `${base}_col`, `${base}_dtl`, base,
    `${base.replace(/\d+$/, '')}_col`,
    `${base.replace(/Outline/, '')}_col`,
  ];
  if (/colourPalette/i.test(base)) candidates.push('colourPaletteSuburbs_col', 'colourPalette_col');
  for (const c of candidates) if (c && textures.has(c)) return textures.get(c);
  // Fall back to a case-insensitive prefix match ("vehicles" -> "vehicles01_col").
  const lower = base.toLowerCase();
  for (const [name, file] of textures) {
    if (name.toLowerCase().startsWith(lower) && name.endsWith('_col')) return file;
  }
  return fallback ? textures.get(fallback) : null;
}

function classify(material) {
  if (/collisionGround/.test(material)) return 'ground';
  if (/collision/i.test(material)) return 'collision';
  // Hidden so the third-person camera can see into rooms from above.
  if (/ceiling/i.test(material)) return 'ceiling';
  if (/^shadow/.test(material)) return 'shadow';
  if (/window|screens|chainlink|foliage|bush|tree|billboard/i.test(material)) return 'cutout';
  return 'solid';
}

function boundingBox(file) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const line of fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')) {
    if (!line.startsWith('v ')) continue;
    const v = line.split(/\s+/).slice(1, 4).map(Number);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]); }
  }
  return { min, max };
}

// Some props were exported in local space (their transform lived in the lost scene),
// so they pile up around the origin. Outside the centre cell C3 that means unplaced.
function isPlaced(cell, file) {
  if (cell === 'C3') return true;
  const { min, max } = boundingBox(file);
  return Math.hypot((min[0] + max[0]) / 2, (min[2] + max[2]) / 2) > 8;
}

const skipped = [];

function mapParts(filter, hints) {
  const parts = [];
  for (const [name, variants] of meshVariants) {
    const m = filter(name);
    if (!m) continue;
    const file = hints?.grid ? variants.find((f) => isPlaced(m, f)) : variants[0];
    if (!file) {
      skipped.push(name);
      continue;
    }
    const material = name.slice(m.length + 1);
    const kind = classify(material);
    let texture = ['ground', 'collision', 'ceiling'].includes(kind) ? null : findTexture(material, hints);
    // "FG Flat (with detail)" paints these from the palette through UV0 and blends the
    // *_dtl pattern through UV1. The OBJ exports only carry UV0, so keep the palette.
    let detail;
    const palette = hints?.detailPalette ?? hints?.fallback;
    if (texture?.endsWith('_dtl.png') && palette) {
      detail = texture;
      texture = textures.get(palette);
    }
    // Interiors have no collisionGround: their visible floors are what you walk on.
    const walkable = kind === 'ground' || (!hints?.grid && kind !== 'ceiling' && /^f[il]oor/i.test(material));
    parts.push({ name, cell: m, kind, mesh: file, texture, walkable, ...(detail && { detail }) });
  }
  return parts;
}

// Suburbs is a 5x5 grid (A-E x 1-5, 130 units per cell) whose meshes are already
// in world space. A1/Z1/Z9 hold interiors exported at the origin.
const SUBURBS = { grid: true, fallback: 'colourPaletteSuburbs_col', detailPalette: 'colourPalette_col' };
const INTERIOR = { fallback: 'interiorColourPalette_col' };
const cellOf = (re) => (name) => name.match(re)?.[1];
const maps = {
  suburbs: {
    title: 'Quahog — Suburbs',
    music: ['aud_music_loop_spoonerStreet1', 'aud_music_loop_spoonerStreet2', 'aud_music_loop_spoonerStreet3'],
    spawn: [0, 5, 0],
    parts: [
      ...mapParts(cellOf(/^([B-E][1-5])_/), SUBURBS),
      ...mapParts(cellOf(/^(backdrop)_/), { ...SUBURBS, grid: false }),
    ],
  },
  griffinHouse: {
    title: 'Griffin House',
    music: ['aud_music_loop_fe'],
    spawn: [0, 2, 0],
    autoSpawn: true,
    camera: 4,
    parts: mapParts(cellOf(/^(Z1)_/), { prefix: 'griffinHouse', ...INTERIOR }),
  },
  interiorZ9: {
    title: 'House Z9',
    music: ['aud_music_loop_xxx'],
    spawn: [0, 2, 0],
    autoSpawn: true,
    camera: 4,
    parts: mapParts(cellOf(/^(Z9)_/), INTERIOR),
  },
  interiorA1: {
    title: 'Interior A1',
    music: ['aud_music_loop_church'],
    spawn: [0, 2, 0],
    autoSpawn: true,
    camera: 4,
    parts: mapParts(cellOf(/^(A1)_/), INTERIOR),
  },
};

const npcs = [];
for (const [name, file] of meshes) {
  const m = name.match(/^npc_(.+?)_geo\d*$/);
  if (!m) continue;
  const tex = textures.get(`npc_custom_${m[1]}_col`) ?? textures.get(`npc_iconic_${m[1]}_col`) ?? null;
  npcs.push({ id: m[1], mesh: file, texture: tex });
}

// Archetypes from world_objects (no positions there: placement lived server-side).
function archetypes(file) {
  const xml = fs.readFileSync(path.join(ROOT, 'TextAsset', file), 'utf8');
  const out = {};
  for (const m of xml.matchAll(/<object name="([^"]*)"(?: type="([^"]*)")?/g)) {
    const type = m[2] ?? '(untyped)';
    (out[type] ??= []).push(m[1]);
  }
  return out;
}

const audio = [...uniqueAssets('AudioClip', '.ogg').entries()].map(([name, file]) => ({ name, file }));

const manifest = {
  generated: new Date().toISOString(),
  maps,
  npcs,
  audio,
  archetypes: { suburbs: archetypes('world_objects'), kylesHouse: archetypes('world_objects #198419') },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(manifest));

const stats = Object.entries(maps).map(([id, m]) => {
  const textured = m.parts.filter((p) => p.texture).length;
  const visual = m.parts.filter((p) => !['ground', 'collision', 'ceiling'].includes(p.kind)).length;
  return `${id}: ${m.parts.length} meshes, ${textured}/${visual} visible meshes textured`;
});
console.log(stats.join('\n'));
console.log(`Skipped unplaced props (${skipped.length}): ${skipped.join(', ')}`);
console.log(`NPCs: ${npcs.length} (${npcs.filter((n) => n.texture).length} textured), sounds: ${audio.length}`);
console.log(`-> ${path.relative(ROOT, OUT)}`);
