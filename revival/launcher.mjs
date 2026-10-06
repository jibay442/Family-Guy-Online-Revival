#!/usr/bin/env node
// Launcher: prepares the asset manifest, starts the co-op server and opens the
// game in the browser. `--join <host>` skips the server and opens a friend's game.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', short: 'p', default: process.env.PORT ?? '8642' },
    join: { type: 'string', short: 'j' },
    'no-browser': { type: 'boolean', default: false },
    rebuild: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opts.help) {
  console.log(`Family Guy Online — Revival

  npm start                      host a game and open it
  npm start -- --join 192.168.1.20   join a friend's game
  npm start -- --port 9000       change the port (default 8642)
  npm start -- --no-browser      server only (dedicated)
  npm start -- --rebuild         regenerate the asset manifest`);
  process.exit(0);
}

function openBrowser(url) {
  if (opts['no-browser']) return;
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {
    console.log(`Open this link in your browser: ${url}`);
  }).unref();
}

if (opts.join) {
  const target = /^https?:\/\//.test(opts.join) ? opts.join
    : opts.join.includes(':') ? `http://${opts.join}` : `http://${opts.join}:${opts.port}`;
  console.log(`Connecting to ${target}`);
  openBrowser(target);
  process.exit(0);
}

const manifest = path.join(HERE, 'public/manifest.json');
if (opts.rebuild || !fs.existsSync(manifest)) {
  console.log('Building the asset manifest…');
  execFileSync(process.execPath, [path.join(HERE, 'tools/build-manifest.mjs')], { stdio: 'inherit' });
}

if (!fs.existsSync(path.join(HERE, 'node_modules/three')) || !fs.existsSync(path.join(HERE, 'node_modules/ws'))) {
  console.error('Missing dependencies: run `npm install` in the revival/ folder and try again.');
  process.exit(1);
}

const { startServer, lanAddresses } = await import('./server.mjs');
const port = Number(opts.port);
try {
  await startServer({ port });
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use (is a server already running?). Try --port ${port + 1}.`);
    process.exit(1);
  }
  throw err;
}

const local = `http://localhost:${port}`;
console.log(`\n  Family Guy Online — Revival`);
console.log(`  Game: ${local}`);
for (const ip of lanAddresses()) console.log(`  Friends (local network): http://${ip}:${port}   (or launch with --join ${ip})`);
console.log(`  Press Ctrl+C to stop the server.\n`);
openBrowser(local);

process.on('SIGINT', () => {
  console.log('\nServer stopped.');
  process.exit(0);
});
