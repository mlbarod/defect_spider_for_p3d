import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const distDir = join(rootDir, 'dist');
const loaderPath = join(rootDir, 'scripts', 'data_loader.py');
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? '0.0.0.0';
const buildOnStart = process.env.BUILD_ON_START !== '0';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function runLoader(args, res) {
  const child = spawn('python3', [loaderPath, ...args], {
    cwd: rootDir,
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

function handleApi(req, res, url) {
  if (url.pathname === '/api/summary') {
    runLoader(['summary'], res);
    return true;
  }

  if (url.pathname === '/api/fcc-summary') {
    runLoader(['fcc-summary'], res);
    return true;
  }

  if (url.pathname === '/api/chart') {
    const mainStep = url.searchParams.get('mainStep');
    const chartMetStep = url.searchParams.get('chartMetStep');
    const eqpId = url.searchParams.get('eqpId');

    if (!mainStep || !chartMetStep || !eqpId) {
      sendJson(res, 400, { ok: false, error: 'mainStep, chartMetStep, eqpId가 필요합니다.' });
      return true;
    }

    runLoader(['chart', '--main-step', mainStep, '--chart-met-step', chartMetStep, '--eqp-id', eqpId], res);
    return true;
  }

  if (url.pathname === '/api/fcc-chart') {
    const chartMetStep = url.searchParams.get('chartMetStep');
    const eqpId = url.searchParams.get('eqpId');

    if (!chartMetStep || !eqpId) {
      sendJson(res, 400, { ok: false, error: 'chartMetStep, eqpId가 필요합니다.' });
      return true;
    }

    runLoader(['fcc-chart', '--chart-met-step', chartMetStep, '--eqp-id', eqpId], res);
    return true;
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { ok: false, error: `알 수 없는 API 경로입니다: ${url.pathname}` });
    return true;
  }

  return false;
}

async function serveStatic(req, res, url) {
  const requestedPath = decodeURIComponent(url.pathname);
  const normalizedPath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(distDir, normalizedPath);

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, 'index.html');
  }

  if (!existsSync(filePath)) {
    sendJson(res, 500, { ok: false, error: 'dist/index.html이 없습니다. 먼저 npm run build를 실행하세요.' });
    return;
  }

  const contentType = mimeTypes[extname(filePath)] ?? 'application/octet-stream';
  const cacheControl = extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
  createReadStream(filePath).pipe(res);
}

async function assertDistExists() {
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error('dist/index.html이 없습니다. npm run build 후 npm start를 실행하세요.');
  }

  await readFile(join(distDir, 'index.html'), 'utf8');
}

function buildClient() {
  if (!buildOnStart) return;

  console.log('Building client before starting server...');
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, BUILD_ON_START: '0' },
  });

  if (result.status !== 0) {
    throw new Error(`client build failed with code ${result.status}`);
  }
}

buildClient();
await assertDistExists();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (handleApi(req, res, url)) return;

  serveStatic(req, res, url).catch((error) => {
    sendJson(res, 500, { ok: false, error: error.message });
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. 다른 포트를 쓰려면 PORT=5174 npm start처럼 실행하세요.`);
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Defect Spider server listening on http://${host}:${port}`);
});
