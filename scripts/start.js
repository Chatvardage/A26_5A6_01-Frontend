'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');

const projectRoot = path.resolve(__dirname, '..');
const DEV_PORT = 5173;
const isDev = process.env.NODE_ENV === 'development';

function commandFor(bin) {
  return process.platform === 'win32' ? `${bin}.cmd` : bin;
}

function spawnProcess(bin, args) {
  return spawn(commandFor(bin), args, {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: 'inherit',
    windowsHide: false,
  });
}

function stopProcess(child) {
  if (!child || child.killed) return;

  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGTERM');
  }
}

function waitForPort(port, timeoutMs = 30000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({
        host: '127.0.0.1',
        port,
      });

      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });

      socket.once('error', () => {
        socket.destroy();

        if (Date.now() - startedAt >= timeoutMs) {
          reject(
            new Error(
              `Vite n'a pas démarré sur le port ${port} dans les ${timeoutMs / 1000}s.`
            )
          );
          return;
        }

        setTimeout(tryConnect, 100);
      });
    };

    tryConnect();
  });
}

function runProduction() {
  const loginBuild = path.join(projectRoot, 'dist', 'login', 'index.html');

  if (!fs.existsSync(loginBuild)) {
    console.error(
      '\nLe build de connexion est absent. Lance d’abord : npm run build\n'
    );
    process.exit(1);
  }

  const electron = spawnProcess('electron', ['.']);

  electron.once('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });

  electron.once('exit', (code) => {
    process.exit(code ?? 0);
  });
}

async function runDevelopment() {
  const vite = spawnProcess('vite', []);

  let electron = null;
  let shuttingDown = false;

  const shutdown = (code = 0) => {
    if (shuttingDown) return;

    shuttingDown = true;

    stopProcess(electron);
    stopProcess(vite);

    setTimeout(() => process.exit(code ?? 0), 50);
  };

  process.once('SIGINT', () => shutdown(0));
  process.once('SIGTERM', () => shutdown(0));

  vite.once('error', (error) => {
    console.error(error);
    shutdown(1);
  });

  vite.once('exit', (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 1);
    }
  });

  try {
    await waitForPort(DEV_PORT);

    if (shuttingDown) return;

    electron = spawnProcess('electron', ['.']);

    electron.once('error', (error) => {
      console.error(error);
      shutdown(1);
    });

    electron.once('exit', (code) => {
      if (!shuttingDown) {
        shutdown(code ?? 0);
      }
    });
  } catch (error) {
    console.error(error);
    shutdown(1);
  }
}

if (isDev) {
  runDevelopment();
} else {
  runProduction();
}
