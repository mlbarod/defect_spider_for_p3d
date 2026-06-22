import { spawn } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const loaderPath = fileURLToPath(new URL('./scripts/data_loader.py', import.meta.url));

function runLoader(args, res) {
  const child = spawn('python3', [loaderPath, ...args], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.on('close', (code) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (stdout.trim()) {
      res.end(stdout);
      return;
    }

    res.statusCode = 500;
    res.end(
      JSON.stringify({
        ok: false,
        error: stderr.trim() || `data loader exited with code ${code}`,
      }),
    );
  });
}

function installApiHandlers(middlewares) {
  middlewares.use('/api', (req, res) => {
    const url = new URL(req.url ?? '', 'http://localhost');

    if (url.pathname === '/summary') {
      runLoader(['summary'], res);
      return;
    }

    if (url.pathname === '/fcc-summary') {
      runLoader(['fcc-summary'], res);
      return;
    }

    if (url.pathname === '/chamber-lines') {
      runLoader(['chamber-lines'], res);
      return;
    }

    if (url.pathname === '/chart') {
      const mainStep = url.searchParams.get('mainStep');
      const chartMetStep = url.searchParams.get('chartMetStep');
      const eqpId = url.searchParams.get('eqpId');

      if (!mainStep || !chartMetStep || !eqpId) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: 'mainStep, chartMetStep, eqpId가 필요합니다.' }));
        return;
      }

      runLoader(['chart', '--main-step', mainStep, '--chart-met-step', chartMetStep, '--eqp-id', eqpId], res);
      return;
    }

    if (url.pathname === '/fcc-chart') {
      const mainStep = url.searchParams.get('mainStep');
      const chartMetStep = url.searchParams.get('chartMetStep');
      const eqpId = url.searchParams.get('eqpId');
      const chartRoot = url.searchParams.get('chartRoot') || 'step';

      if (!mainStep || !chartMetStep || !eqpId) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: 'mainStep, chartMetStep, eqpId가 필요합니다.' }));
        return;
      }

      runLoader(['fcc-chart', '--main-step', mainStep, '--chart-met-step', chartMetStep, '--eqp-id', eqpId, '--chart-root', chartRoot], res);
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: `알 수 없는 API 경로입니다: /api${url.pathname}` }));
  });
}

function dataApiPlugin() {
  return {
    name: 'defect-spider-data-api',
    configureServer(server) {
      installApiHandlers(server.middlewares);
    },
    configurePreviewServer(server) {
      installApiHandlers(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), dataApiPlugin()],
});
