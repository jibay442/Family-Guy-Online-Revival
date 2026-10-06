import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const $ = (id) => document.getElementById(id);
const assetUrl = (file) => '/assets/' + file.split('/').map(encodeURIComponent).join('/');

const EMOTES = {
  Digit1: 'AudioClip/aud_gui_misc_giggity.ogg',
  Digit2: 'AudioClip/aud_dialog_peter_hurtKnee.ogg',
  Digit3: 'AudioClip/aud_dialog_peter_trashmanIntro.ogg',
  Digit4: 'AudioClip/aud_dialogue_cheerleaderHi.ogg',
};
const WALK_SPEED = 7;
const RUN_SPEED = 14;
const GRAVITY = 30;
const JUMP_SPEED = 11;
const PLAYER_RADIUS = 0.6;
const NET_RATE = 1 / 15;

// --- Renderer & scene --------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8e8);
scene.fog = new THREE.Fog(0x87b8e8, 180, 520);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- Assets -----------------------------------------------------------------

const objLoader = new OBJLoader();
const texLoader = new THREE.TextureLoader();
const textureCache = new Map();
const modelCache = new Map();

function texture(file) {
  if (!textureCache.has(file)) {
    const tex = texLoader.load(assetUrl(file));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    textureCache.set(file, tex);
  }
  return textureCache.get(file);
}

// The game is cel-shaded with lighting baked into palette textures, so unlit
// materials match the original look.
function materialFor(part) {
  const map = part.texture ? texture(part.texture) : null;
  switch (part.kind) {
    case 'shadow':
      return new THREE.MeshBasicMaterial({
        map, transparent: true, depthWrite: false, opacity: 0.8,
        polygonOffset: true, polygonOffsetFactor: -2,
      });
    case 'cutout':
      return new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
    default:
      return new THREE.MeshBasicMaterial({ map, color: map ? 0xffffff : 0xcccccc, side: THREE.DoubleSide });
  }
}

async function loadObj(file) {
  const group = await objLoader.loadAsync(assetUrl(file));
  group.traverse((o) => o.isMesh && o.geometry.computeBoundingBox());
  return group;
}

async function inBatches(items, size, fn) {
  let done = 0;
  const queue = [...items];
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      try { await fn(item); } catch (err) { console.warn('Failed to load', item, err); }
      onProgress(++done / items.length);
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
}

let onProgress = () => {};

// --- World ------------------------------------------------------------------

const world = { root: null, ground: [], walls: [], occluders: [], bounds: new THREE.Box3() };

async function loadWorld(map) {
  if (world.root) scene.remove(world.root);
  world.root = new THREE.Group();
  world.ground = [];
  world.walls = [];
  world.occluders = [];
  world.bounds.makeEmpty();
  scene.add(world.root);

  await inBatches(map.parts, 12, async (part) => {
    const group = await loadObj(part.mesh);
    const isCollision = part.kind === 'collision';
    const hidden = isCollision || part.kind === 'ground' || part.kind === 'ceiling';
    const mat = materialFor(part);
    group.traverse((o) => {
      if (!o.isMesh) return;
      o.material = mat;
      o.name = part.name;
      if (part.kind === 'shadow') o.renderOrder = 1;
      const box = o.geometry.boundingBox;
      if (part.walkable) { world.ground.push({ mesh: o, box }); world.bounds.union(box); }
      if (isCollision) world.walls.push({ mesh: o, box });
      // Hidden ceilings and floors still stop the camera from leaving the room.
      if (['solid', 'ceiling', 'ground'].includes(part.kind) || part.walkable) world.occluders.push({ mesh: o, box });
    });
    // Collision hulls and walkable surfaces duplicate the visible geometry; they stay
    // in the scene graph (hidden) so raycasts can still hit them.
    group.visible = !hidden;
    world.root.add(group);
  });
  world.root.updateMatrixWorld(true);
}

const raycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

function near(list, x, z, margin) {
  return list.filter(({ box }) =>
    x >= box.min.x - margin && x <= box.max.x + margin && z >= box.min.z - margin && z <= box.max.z + margin,
  ).map((e) => e.mesh);
}

// Highest ground surface below `fromY` at (x, z), or null if there is none.
function groundHeight(x, z, fromY) {
  const meshes = near(world.ground, x, z, 0);
  if (!meshes.length) return null;
  raycaster.set(new THREE.Vector3(x, fromY, z), DOWN);
  raycaster.far = fromY + 200;
  const hit = raycaster.intersectObjects(meshes, false)[0];
  return hit ? hit.point.y : null;
}

const tmpDir = new THREE.Vector3();
// Moves (x, z) by `delta`, sliding along collision hulls instead of entering them.
function moveWithCollisions(pos, delta) {
  const len = Math.hypot(delta.x, delta.z);
  if (len < 1e-6) return;
  const meshes = near(world.walls, pos.x, pos.z, len + 2);
  if (meshes.length) {
    tmpDir.set(delta.x / len, 0, delta.z / len);
    for (const h of [0.5, 1.4]) {
      raycaster.set(new THREE.Vector3(pos.x, pos.y + h, pos.z), tmpDir);
      raycaster.far = len + PLAYER_RADIUS;
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (!hit?.face) continue;
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      n.y = 0;
      if (n.lengthSq() < 1e-6) continue;
      n.normalize();
      if (n.dot(tmpDir) > 0) n.negate();
      // Remove the component pushing into the wall.
      const into = delta.x * n.x + delta.z * n.z;
      delta.x -= into * n.x;
      delta.z -= into * n.z;
      break;
    }
  }
  pos.x += delta.x;
  pos.z += delta.z;
}

// --- Characters -------------------------------------------------------------

async function characterModel(npc) {
  if (!modelCache.has(npc.id)) {
    modelCache.set(npc.id, loadObj(npc.mesh).then((group) => {
      const mat = new THREE.MeshBasicMaterial({
        map: npc.texture ? texture(npc.texture) : null,
        color: npc.texture ? 0xffffff : 0xffd9a0,
        side: THREE.DoubleSide,
      });
      group.traverse((o) => { if (o.isMesh) o.material = mat; });
      return group;
    }));
  }
  return (await modelCache.get(npc.id)).clone();
}

function nameplate(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 48;
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(text, 128, 34);
  ctx.fillStyle = '#ffe680';
  ctx.fillText(text, 128, 34);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true,
  }));
  sprite.scale.set(2.4, 0.45, 1);
  sprite.renderOrder = 10;
  return sprite;
}

class Avatar {
  constructor(npc, name) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.label = nameplate(name);
    this.root.add(this.label);
    this.speed = 0;
    this.phase = 0;
    this.ready = characterModel(npc).then((model) => {
      const box = new THREE.Box3().setFromObject(model);
      this.height = box.max.y - box.min.y;
      this.body.add(model);
      this.label.position.y = this.height + 0.4;
    });
    scene.add(this.root);
  }

  // The extracted meshes have no skeleton, so walking is a bob and a sway.
  animate(dt) {
    this.phase += dt * (4 + this.speed * 0.9);
    const amount = Math.min(this.speed / RUN_SPEED, 1);
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.18 * amount;
    this.body.rotation.z = Math.sin(this.phase) * 0.08 * amount;
  }

  dispose() {
    scene.remove(this.root);
  }
}

// --- Input ------------------------------------------------------------------

const keys = new Set();
const view = { yaw: Math.PI, pitch: 0.35, distance: 7 };
let chatting = false;

addEventListener('keydown', (e) => {
  if (!state.playing) return;
  if (chatting) {
    if (e.key === 'Enter') sendChat();
    if (e.key === 'Escape') closeChat();
    return;
  }
  if (e.key === 'Enter') { openChat(); e.preventDefault(); return; }
  if (e.code === 'Escape') { showMenu(); return; }
  if (e.code === 'KeyM') toggleMusic();
  if (EMOTES[e.code] && !e.repeat) emote(EMOTES[e.code]);
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

$('view').addEventListener('click', () => {
  if (state.playing && !chatting) $('view').requestPointerLock?.();
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== $('view')) return;
  view.yaw -= e.movementX * 0.0025;
  view.pitch = THREE.MathUtils.clamp(view.pitch + e.movementY * 0.0025, -0.2, 1.3);
});
addEventListener('wheel', (e) => {
  view.distance = THREE.MathUtils.clamp(view.distance * (e.deltaY > 0 ? 1.1 : 0.9), 2.5, 40);
}, { passive: true });

// --- Network ----------------------------------------------------------------

const net = { ws: null, id: null, others: new Map(), lastSend: 0 };

function connect(profile) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    net.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', ...profile }));
    ws.onerror = () => reject(new Error('Could not reach the co-op server'));
    ws.onclose = () => {
      if (net.ws !== ws) return;
      for (const o of net.others.values()) o.avatar.dispose();
      net.others.clear();
      if (state.playing) addChat('Server', 'Connection lost — playing solo.');
      updatePlayerList();
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.t) {
        case 'welcome':
          net.id = msg.id;
          msg.players.forEach(addOther);
          updatePlayerList();
          resolve();
          break;
        case 'error':
          reject(new Error(msg.message));
          break;
        case 'join':
          addOther(msg);
          addChat('Server', `${msg.name} joined the game.`);
          updatePlayerList();
          break;
        case 'leave': {
          const o = net.others.get(msg.id);
          if (!o) break;
          o.avatar.dispose();
          net.others.delete(msg.id);
          addChat('Server', `${o.name} left.`);
          updatePlayerList();
          break;
        }
        case 'state': {
          const o = net.others.get(msg.id);
          if (o) o.target = msg.s;
          break;
        }
        case 'chat':
          addChat(msg.name, msg.text);
          break;
        case 'emote': {
          const o = net.others.get(msg.id);
          if (o && msg.sound in REVERSE_EMOTES) playSound(msg.sound, o.avatar.root.position);
          break;
        }
      }
    };
  });
}

const REVERSE_EMOTES = Object.fromEntries(Object.values(EMOTES).map((s) => [s, true]));

function addOther(info) {
  const npc = state.manifest.npcs.find((n) => n.id === info.character) ?? state.manifest.npcs[0];
  const avatar = new Avatar(npc, info.name);
  const o = { name: info.name, avatar, target: info.state };
  if (info.state) {
    avatar.root.position.set(info.state[0], info.state[1], info.state[2]);
    avatar.root.rotation.y = info.state[3];
  }
  net.others.set(info.id, o);
}

function netSend(msg) {
  if (net.ws?.readyState === WebSocket.OPEN) net.ws.send(JSON.stringify(msg));
}

function updatePlayerList() {
  const names = [state.profile?.name, ...[...net.others.values()].map((o) => o.name)].filter(Boolean);
  const online = net.ws?.readyState === WebSocket.OPEN;
  $('players').innerHTML = `<b>${online ? 'Online' : 'Solo'}</b> — ${names.length} player(s)<br>` +
    names.map(escapeHtml).join('<br>');
}

// --- Chat, sound, music -----------------------------------------------------

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function addChat(name, text) {
  const li = document.createElement('li');
  li.innerHTML = `<b>${escapeHtml(name)}</b>: ${escapeHtml(text)}`;
  $('chat-log').append(li);
  while ($('chat-log').children.length > 8) $('chat-log').firstChild.remove();
}

function openChat() {
  chatting = true;
  keys.clear();
  document.exitPointerLock?.();
  $('chat-input').classList.remove('hidden');
  $('chat-input').focus();
}

function closeChat() {
  chatting = false;
  $('chat-input').value = '';
  $('chat-input').classList.add('hidden');
  $('chat-input').blur();
}

function sendChat() {
  const text = $('chat-input').value.trim();
  if (text) {
    if (net.ws?.readyState === WebSocket.OPEN) netSend({ t: 'chat', text });
    else addChat(state.profile.name, text);
  }
  closeChat();
}

function playSound(file, at) {
  const audio = new Audio(assetUrl(file));
  const d = at ? at.distanceTo(player.pos) : 0;
  audio.volume = Math.max(0, 1 - d / 60) * 0.9;
  if (audio.volume > 0) audio.play().catch(() => {});
}

function emote(file) {
  playSound(file);
  netSend({ t: 'emote', sound: file });
}

const music = new Audio();
music.volume = 0.35;
let musicOn = true;
let musicTracks = [];
music.addEventListener('ended', nextTrack);

function nextTrack() {
  if (!musicOn || !musicTracks.length) return;
  const name = musicTracks[Math.floor(Math.random() * musicTracks.length)];
  const clip = state.manifest.audio.find((a) => a.name === name);
  if (!clip) return;
  music.src = assetUrl(clip.file);
  music.play().catch(() => {});
}

function toggleMusic() {
  musicOn = !musicOn;
  if (musicOn) nextTrack(); else music.pause();
}

// --- Player -----------------------------------------------------------------

const player = { pos: new THREE.Vector3(), velY: 0, yaw: 0, onGround: false, avatar: null, speed: 0 };

// Samples the walkable area and returns the spot farthest from any wall, so the
// camera has room behind the player. Used for interiors, whose spawns are unknown.
function openSpot(height) {
  const { min, max } = world.bounds;
  const blockers = [...world.occluders, ...world.walls].map((e) => e.mesh);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
  let best = null;
  let bestScore = 0;
  for (let i = 1; i < 12; i++) {
    for (let j = 1; j < 12; j++) {
      const x = min.x + ((max.x - min.x) * i) / 12;
      const z = min.z + ((max.z - min.z) * j) / 12;
      const g = groundHeight(x, z, height + 1);
      if (g === null || g > height) continue;
      let score = Infinity;
      for (const [dx, dz] of dirs) {
        raycaster.set(new THREE.Vector3(x, g + 1.2, z), new THREE.Vector3(dx, 0, dz));
        raycaster.far = 20;
        score = Math.min(score, raycaster.intersectObjects(blockers, false)[0]?.distance ?? 20);
      }
      if (score > bestScore) { bestScore = score; best = new THREE.Vector3(x, g + 0.05, z); }
    }
  }
  return best;
}

function spawnPoint(map) {
  if (map.autoSpawn) {
    const spot = openSpot(map.spawn[1]);
    if (spot) return spot;
  }
  // Cast from just above the spawn height so multi-storey floors land on the right level.
  const [x, y, z] = map.spawn;
  const g = groundHeight(x, z, y + 1) ?? groundHeight(x, z, 200);
  if (g !== null) return new THREE.Vector3(x, g + 0.05, z);
  // Fall back to the middle of the walkable area.
  const c = world.bounds.getCenter(new THREE.Vector3());
  return new THREE.Vector3(c.x, (groundHeight(c.x, c.z, y + 1) ?? groundHeight(c.x, c.z, 200) ?? y) + 0.05, c.z);
}

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();

function updatePlayer(dt) {
  forward.set(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
  right.set(-forward.z, 0, forward.x);
  move.set(0, 0, 0);
  if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(forward);
  if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(forward);
  if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right);

  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed * dt);
    const targetYaw = Math.atan2(move.x, move.z);
    let d = targetYaw - player.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    player.yaw += d * Math.min(1, dt * 12);
    moveWithCollisions(player.pos, move);
    player.speed = speed;
  } else {
    player.speed = 0;
  }

  if (keys.has('Space') && player.onGround) {
    player.velY = JUMP_SPEED;
    player.onGround = false;
  }
  player.velY -= GRAVITY * dt;
  player.pos.y += player.velY * dt;

  const g = groundHeight(player.pos.x, player.pos.z, player.pos.y + 1.2);
  if (g !== null && player.pos.y <= g) {
    player.pos.y = g;
    player.velY = 0;
    player.onGround = true;
  } else {
    player.onGround = false;
  }
  if (player.pos.y < -60) player.pos.copy(spawnPoint(state.map));

  const a = player.avatar;
  a.root.position.copy(player.pos);
  a.root.rotation.y = player.yaw;
  a.speed = player.onGround ? player.speed : 0;
  a.animate(dt);
}

function updateCamera() {
  const target = player.pos.clone().add(new THREE.Vector3(0, (player.avatar.height ?? 2) * 0.8, 0));
  const offset = new THREE.Vector3(
    Math.sin(view.yaw) * Math.cos(view.pitch),
    Math.sin(view.pitch),
    Math.cos(view.yaw) * Math.cos(view.pitch),
  ).multiplyScalar(view.distance);
  // Pull the camera in front of any wall between it and the player.
  const len = offset.length();
  const dir = offset.clone().divideScalar(len);
  const mid = target.clone().addScaledVector(dir, len / 2);
  raycaster.set(target, dir);
  raycaster.far = len;
  const hit = raycaster.intersectObjects(near(world.occluders, mid.x, mid.z, len / 2 + 1), false)[0];
  camera.position.copy(target).addScaledVector(dir, hit ? Math.max(0.6, hit.distance - 0.3) : len);
  // Cast from the player's height, not above the camera, or an upper storey counts as floor.
  const floor = groundHeight(camera.position.x, camera.position.z, Math.min(camera.position.y, target.y) + 0.5);
  if (floor !== null && camera.position.y < floor + 0.5) camera.position.y = floor + 0.5;
  camera.lookAt(target);
}

function updateOthers(dt) {
  const k = Math.min(1, dt * 10);
  for (const o of net.others.values()) {
    const a = o.avatar;
    if (o.target) {
      const [x, y, z, yaw, speed] = o.target;
      a.root.position.lerp(new THREE.Vector3(x, y, z), k);
      let d = yaw - a.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.root.rotation.y += d * k;
      a.speed = speed;
    }
    a.animate(dt);
  }
}

function sendState(now) {
  if (now - net.lastSend < NET_RATE) return;
  net.lastSend = now;
  const p = player.pos;
  const r = (v) => Math.round(v * 100) / 100;
  netSend({ t: 'state', s: [r(p.x), r(p.y), r(p.z), r(player.yaw), player.speed] });
}

const COLS = 'EDCBA';
function cellName(p) {
  // Columns run E..A from -x to +x, rows 1..5 from -z to +z, 130 units each, C3 centred on 0.
  const col = COLS[Math.floor((p.x + 325) / 130)];
  const row = Math.floor((p.z + 325) / 130) + 1;
  return col && row >= 1 && row <= 5 ? `${col}${row}` : '—';
}

// --- Game flow --------------------------------------------------------------

const state = { manifest: null, map: null, profile: null, playing: false, loadedMap: null };

const clock = new THREE.Timer();
let fpsAcc = 0, fpsFrames = 0, fps = 0;
function frame(time) {
  clock.update(time);
  const real = clock.getDelta();
  const dt = Math.min(real, 0.25);
  if (state.playing) {
    // Fixed-ish substeps keep movement speed right on slow machines.
    const steps = Math.ceil(dt / 0.05);
    for (let i = 0; i < steps; i++) updatePlayer(dt / steps);
    updateOthers(dt);
    updateCamera();
    sendState(clock.getElapsed());
    fpsAcc += real; fpsFrames++;
    if (fpsAcc > 0.5) { fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    const p = player.pos;
    $('info').textContent = `${state.map.title}  ·  cell ${state.loadedMap === 'suburbs' ? cellName(p) : '—'}  ·  ` +
      `x ${p.x.toFixed(1)} y ${p.y.toFixed(1)} z ${p.z.toFixed(1)}  ·  ${fps} fps`;
  } else if (world.root) {
    // Slow fly-around behind the menu.
    const t = clock.getElapsed() * 0.05;
    camera.position.set(Math.cos(t) * 160, 70, Math.sin(t) * 160);
    camera.lookAt(0, 0, 0);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function showMenu() {
  state.playing = false;
  document.exitPointerLock?.();
  closeChat();
  keys.clear();
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('play').textContent = 'Resume';
}

async function play() {
  const profile = {
    name: $('name').value.trim() || 'Peter',
    character: $('character').value,
    map: $('map').value,
  };
  try { localStorage.setItem('fgo-profile', JSON.stringify(profile)); } catch {}

  const sameSession = state.profile && state.profile.map === profile.map &&
    state.profile.character === profile.character && state.profile.name === profile.name;
  if (sameSession) {
    resume();
    return;
  }

  $('menu').classList.add('hidden');
  $('loading').classList.remove('hidden');
  state.map = state.manifest.maps[profile.map];

  if (state.loadedMap !== profile.map) {
    $('loading-text').textContent = `Loading ${state.map.title}…`;
    onProgress = (f) => { $('loading-bar').style.width = `${Math.round(f * 100)}%`; };
    await loadWorld(state.map);
    state.loadedMap = profile.map;
  }

  if (player.avatar) player.avatar.dispose();
  const npc = state.manifest.npcs.find((n) => n.id === profile.character);
  player.avatar = new Avatar(npc, profile.name);
  await player.avatar.ready;
  player.pos.copy(spawnPoint(state.map));
  player.velY = 0;
  view.distance = state.map.camera ?? 7;

  if (net.ws) { const old = net.ws; net.ws = null; old.close(); }
  for (const o of net.others.values()) o.avatar.dispose();
  net.others.clear();
  state.profile = profile;
  $('loading-text').textContent = 'Connecting to the co-op server…';
  try {
    await connect(profile);
  } catch (err) {
    addChat('Server', `${err.message} — playing solo.`);
  }

  musicTracks = state.map.music;
  nextTrack();
  resume();
}

function resume() {
  $('loading').classList.add('hidden');
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  state.playing = true;
  updatePlayerList();
  if (musicOn && music.paused && music.src) music.play().catch(() => {});
}

async function init() {
  $('invite-url').textContent = `${location.protocol}//${location.host}`;
  state.manifest = await (await fetch('/manifest.json')).json();

  const npcs = [...state.manifest.npcs].sort((a, b) => a.id.localeCompare(b.id));
  for (const n of npcs) $('character').add(new Option(n.id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), n.id));
  for (const [id, m] of Object.entries(state.manifest.maps)) $('map').add(new Option(m.title, id));

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('fgo-profile') ?? '{}'); } catch {}
  $('name').value = saved.name ?? '';
  $('character').value = npcs.some((n) => n.id === saved.character) ? saved.character : 'peterLongJohn';
  $('map').value = saved.map in state.manifest.maps ? saved.map : 'suburbs';

  for (const id of ['name', 'character', 'map']) $(id).addEventListener('change', () => { $('play').textContent = 'Play'; });
  $('play').disabled = false;
  $('play').textContent = 'Play';
  $('play').addEventListener('click', play);
  frame();
}

// Handy from the devtools console when working on maps: fgo.player.pos, fgo.world…
window.fgo = { scene, world, player, net, state, camera };

init().catch((err) => {
  $('play').textContent = 'Error: ' + err.message;
  console.error(err);
});
