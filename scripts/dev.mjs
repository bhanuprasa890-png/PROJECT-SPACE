/**
 * Zero-dependency dev runner: starts the API and Vite together, prefixes their
 * output, and shuts both down on Ctrl-C / when either dies.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const jobs = [
  { name: 'api  ', color: '\x1b[38;5;215m', cmd: process.execPath, args: ['--disable-warning=ExperimentalWarning', 'server/src/index.mjs'] },
  { name: 'web  ', color: '\x1b[38;5;120m', cmd: npm, args: ['run', 'dev', '-w', 'client'] },
];

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 400).unref();
}

for (const job of jobs) {
  const child = spawn(job.cmd, job.args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);

  const pipe = (stream, target) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) target.write(`${job.color}${job.name}\x1b[0m ${line}\n`);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      process.stdout.write(`${job.color}${job.name}\x1b[0m exited (${signal ?? code}) — stopping the pair.\n`);
      shutdown(code ?? 0);
    }
  });
}

process.stdout.write(
  '\n\x1b[1mMise dev\x1b[0m → web http://localhost:5173  ·  api http://localhost:8787 (Vite proxies /api)\n\n'
);

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));
