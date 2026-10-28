// Runs the economic engine server and the Vite dev server together: `npm run dev:all`
import { spawn } from 'node:child_process';
const run = (name, cmd, args, env = {}) => { const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } }); p.on('exit', (c) => { console.log(`[${name}] exited (${c})`); process.exit(c ?? 0); }); return p; };
run('server', 'npx', ['tsx', 'server/node.ts'], { PENNY_TICK_MS: process.env.PENNY_TICK_MS ?? '60000' });
run('web', 'npx', ['vite']);
