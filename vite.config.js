import { spawn } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const loaderPath = fileURLToPath(new URL('./scripts/data_loader.py', import.meta.url));

function normalizeRemoteIp(value) {
  const ip = String(value ?? '').split(',')[0].trim();
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function getRemoteIp(req) {
  return normalizeRemoteIp(req.headers['x-forwarded-for'] ?? req.headers['x-real-ip'] ?? req.socket?.remoteAddress ?? '');
}

function runLoader(args, res, options = {}) {
  const child = spawn('python3', [loaderPath, ...args], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    env: {
      ...process.env,
      ...(options.remoteIp ? { REMOTE_ADDR: options.remoteIp } : {}),
    },
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

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function normalizeApiPath(pathname) {
  if (pathname === '/api') return '/';
  if (!pathname.startsWith('/api/')) return null;

  let apiPath = pathname.slice(4) || '/';
  while (apiPath.startsWith('/api/')) {
    apiPath = apiPath.slice(4) || '/';
  }
  return apiPath.length > 1 ? apiPath.replace(/\/+$/, '') : apiPath;
}

function installApiHandlers(middlewares) {
  middlewares.use((req, res, next) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const apiPath = normalizeApiPath(url.pathname);

    if (!apiPath) {
      next();
      return;
    }

    if (apiPath === '/summary') {
      runLoader(['summary'], res);
      return;
    }

    if (apiPath === '/fcc-summary') {
      runLoader(['fcc-summary'], res);
      return;
    }

    if (apiPath === '/chamber-lines') {
      runLoader(['chamber-lines'], res);
      return;
    }

    if (apiPath === '/client-ip') {
      sendJson(res, 200, { ok: true, ip: getRemoteIp(req) });
      return;
    }

    if (apiPath === '/click-history') {
      const lineName = url.searchParams.get('lineName');
      const selectStep = url.searchParams.get('selectStep');

      if (!lineName || !selectStep) {
        sendJson(res, 400, { ok: false, error: 'lineName, selectStep이 필요합니다.' });
        return;
      }

      runLoader(['click-history', '--line-name', lineName, '--select-step', selectStep], res, {
        remoteIp: getRemoteIp(req),
      });
      return;
    }

    if (apiPath === '/chamber-summary') {
      const lineCode = url.searchParams.get('lineCode');
      const device = url.searchParams.get('device');

      if (!lineCode || !device) {
        sendJson(res, 400, { ok: false, error: 'lineCode, device가 필요합니다.' });
        return;
      }

      runLoader(['chamber-summary', '--line-code', lineCode, '--device', device], res);
      return;
    }

    if (apiPath === '/chart') {
      const mainStep = url.searchParams.get('mainStep');
      const chartMetStep = url.searchParams.get('chartMetStep');
      const eqpId = url.searchParams.get('eqpId');

      if (!mainStep || !chartMetStep || !eqpId) {
        sendJson(res, 400, { ok: false, error: 'mainStep, chartMetStep, eqpId가 필요합니다.' });
        return;
      }

      runLoader(['chart', '--main-step', mainStep, '--chart-met-step', chartMetStep, '--eqp-id', eqpId], res);
      return;
    }

    if (apiPath === '/chamber-chart') {
      const lineCode = url.searchParams.get('lineCode');
      const device = url.searchParams.get('device');
      const mainStep = url.searchParams.get('mainStep');
      const chartMetStep = url.searchParams.get('chartMetStep');
      const eqpId = url.searchParams.get('eqpId');

      if (!lineCode || !device || !mainStep || !chartMetStep || !eqpId) {
        sendJson(res, 400, { ok: false, error: 'lineCode, device, mainStep, chartMetStep, eqpId가 필요합니다.' });
        return;
      }

      runLoader(['chamber-chart', '--line-code', lineCode, '--device', device, '--main-step', mainStep, '--chart-met-step', chartMetStep, '--eqp-id', eqpId], res);
      return;
    }

    if (apiPath === '/fcc-chart') {
      const mainStep = url.searchParams.get('mainStep');
      const chartMetStep = url.searchParams.get('chartMetStep');
      const eqpId = url.searchParams.get('eqpId');
      const chartRoot = url.searchParams.get('chartRoot') || 'step';

      if (!mainStep || !chartMetStep || !eqpId) {
        sendJson(res, 400, { ok: false, error: 'mainStep, chartMetStep, eqpId가 필요합니다.' });
        return;
      }

      runLoader(['fcc-chart', '--main-step', mainStep, '--chart-met-step', chartMetStep, '--eqp-id', eqpId, '--chart-root', chartRoot], res);
      return;
    }

    sendJson(res, 404, { ok: false, error: `알 수 없는 API 경로입니다: ${url.pathname}`, apiPath });
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
