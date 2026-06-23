import { createHmac, randomBytes, timingSafeEqual, webcrypto } from 'node:crypto';

const encoder = new TextEncoder();

const SESSION_COOKIE = 'defect_spider_session';
const TRANSIENT_COOKIE = 'defect_spider_oidc';
const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 30;
const DISCOVERY_CACHE_MS = 10 * 60 * 1000;
const JWKS_CACHE_MS = 10 * 60 * 1000;

let discoveryCache = null;
let jwksCache = null;

function firstEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function authSettings() {
  const issuer = firstEnv('OIDC_ISSUER', 'OPENID_ISSUER');
  const clientId = firstEnv('OIDC_CLIENT_ID', 'OPENID_CLIENT_ID');
  const clientSecret = firstEnv('OIDC_CLIENT_SECRET', 'OPENID_CLIENT_SECRET');
  const explicitRedirectUri = firstEnv('OIDC_REDIRECT_URI', 'OPENID_REDIRECT_URI');
  const sessionSecret = firstEnv('SESSION_SECRET', 'AUTH_SESSION_SECRET') || clientSecret || 'defect-spider-dev-session-secret';
  const sessionMaxAgeSeconds = Number(firstEnv('OIDC_SESSION_MAX_AGE_SECONDS', 'AUTH_SESSION_MAX_AGE_SECONDS')) || DEFAULT_SESSION_MAX_AGE_SECONDS;
  const scope = firstEnv('OIDC_SCOPE', 'OPENID_SCOPE') || 'openid profile email';
  const clientAuthMethod = firstEnv('OIDC_CLIENT_AUTH_METHOD', 'OPENID_CLIENT_AUTH_METHOD') || (clientSecret ? 'client_secret_post' : 'none');
  const frontendRedirect = firstEnv('FRONTEND_URL', 'PUBLIC_BASE_URL', 'APP_BASE_URL');
  const authRequired = firstEnv('AUTH_REQUIRED', 'OIDC_AUTH_REQUIRED');

  return {
    issuer: issuer.replace(/\/+$/, ''),
    clientId,
    clientSecret,
    explicitRedirectUri,
    sessionSecret,
    sessionMaxAgeSeconds,
    scope,
    clientAuthMethod,
    frontendRedirect,
    providerConfigured: Boolean(issuer && clientId),
    authRequired: authRequired ? authRequired !== '0' && authRequired.toLowerCase() !== 'false' : Boolean(issuer && clientId),
  };
}

export function shouldRequireAuth() {
  return authSettings().authRequired;
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

function requestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const proto = forwardedProto || (process.env.HTTPS === '1' ? 'https' : 'http');
  const host = forwardedHost || req.headers.host || `localhost:${process.env.PORT || 5173}`;
  return `${proto}://${host}`;
}

function redirectUriFor(req, settings = authSettings()) {
  return settings.explicitRedirectUri || `${requestOrigin(req)}/api/v1/auth/callback`;
}

function frontendRedirectFor(req, settings = authSettings()) {
  return settings.frontendRedirect || requestOrigin(req);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
  });
  res.end();
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function base64urlJson(value) {
  return base64url(JSON.stringify(value));
}

function base64urlDecode(value) {
  return Buffer.from(String(value), 'base64url');
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

async function pkceChallenge(verifier) {
  const digest = await webcrypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return Buffer.from(digest).toString('base64url');
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function encodeSignedPayload(payload, secret) {
  const body = base64urlJson(payload);
  return `${body}.${sign(body, secret)}`;
}

function decodeSignedPayload(value, secret) {
  const [body, signature] = String(value || '').split('.');
  if (!body || !signature) return null;

  const expected = sign(body, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    return JSON.parse(base64urlDecode(body).toString('utf8'));
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function serializeCookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options.path || '/'}`);
  segments.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.httpOnly !== false) segments.push('HttpOnly');
  if (options.secure) segments.push('Secure');
  if (Number.isFinite(options.maxAge)) segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  return segments.join('; ');
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader?.('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', cookie);
  } else if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, cookie]);
  } else {
    res.setHeader('Set-Cookie', [current, cookie]);
  }
}

function cookieSecure(req) {
  return requestOrigin(req).startsWith('https://') || firstEnv('COOKIE_SECURE', 'AUTH_COOKIE_SECURE') === '1';
}

function clearCookie(res, name, req) {
  appendSetCookie(
    res,
    serializeCookie(name, '', {
      maxAge: 0,
      secure: cookieSecure(req),
    }),
  );
}

function setSignedCookie(res, req, name, payload, maxAgeSeconds) {
  const settings = authSettings();
  appendSetCookie(
    res,
    serializeCookie(name, encodeSignedPayload(payload, settings.sessionSecret), {
      maxAge: maxAgeSeconds,
      secure: cookieSecure(req),
    }),
  );
}

function readSignedCookie(req, name) {
  const settings = authSettings();
  return decodeSignedPayload(parseCookies(req)[name], settings.sessionSecret);
}

export function readAuthSession(req) {
  const session = readSignedCookie(req, SESSION_COOKIE);
  if (!session?.user || !session?.exp) return null;
  if (Number(session.exp) <= Math.floor(Date.now() / 1000)) return null;
  return session;
}

async function getDiscovery(settings) {
  if (!settings.providerConfigured) return null;
  if (discoveryCache && discoveryCache.issuer === settings.issuer && Date.now() - discoveryCache.loadedAt < DISCOVERY_CACHE_MS) {
    return discoveryCache.document;
  }

  const response = await fetch(`${settings.issuer}/.well-known/openid-configuration`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`OpenID discovery 실패: ${response.status}`);
  const document = await response.json();
  discoveryCache = { issuer: settings.issuer, loadedAt: Date.now(), document };
  return document;
}

async function getJwks(discovery) {
  if (!discovery?.jwks_uri) throw new Error('OpenID jwks_uri를 찾지 못했습니다.');
  if (jwksCache && jwksCache.uri === discovery.jwks_uri && Date.now() - jwksCache.loadedAt < JWKS_CACHE_MS) {
    return jwksCache.document;
  }

  const response = await fetch(discovery.jwks_uri, { cache: 'no-store' });
  if (!response.ok) throw new Error(`OpenID JWKS 읽기 실패: ${response.status}`);
  const document = await response.json();
  jwksCache = { uri: discovery.jwks_uri, loadedAt: Date.now(), document };
  return document;
}

function jwtParts(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('id_token 형식이 올바르지 않습니다.');
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = JSON.parse(base64urlDecode(headerPart).toString('utf8'));
  const payload = JSON.parse(base64urlDecode(payloadPart).toString('utf8'));
  return { header, payload, signingInput: `${headerPart}.${payloadPart}`, signature: base64urlDecode(signaturePart) };
}

function joseAlgorithm(alg) {
  const algorithms = {
    RS256: { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: { name: 'RSASSA-PKCS1-v1_5' } },
    RS384: { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' }, verify: { name: 'RSASSA-PKCS1-v1_5' } },
    RS512: { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }, verify: { name: 'RSASSA-PKCS1-v1_5' } },
    PS256: { import: { name: 'RSA-PSS', hash: 'SHA-256' }, verify: { name: 'RSA-PSS', saltLength: 32 } },
    PS384: { import: { name: 'RSA-PSS', hash: 'SHA-384' }, verify: { name: 'RSA-PSS', saltLength: 48 } },
    PS512: { import: { name: 'RSA-PSS', hash: 'SHA-512' }, verify: { name: 'RSA-PSS', saltLength: 64 } },
    ES256: { import: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } },
    ES384: { import: { name: 'ECDSA', namedCurve: 'P-384' }, verify: { name: 'ECDSA', hash: 'SHA-384' } },
  };
  return algorithms[alg] || null;
}

async function verifyJwtSignature(token, discovery) {
  const { header, payload, signingInput, signature } = jwtParts(token);
  if (header.alg === 'none') throw new Error('서명 없는 id_token은 허용하지 않습니다.');
  const algorithm = joseAlgorithm(header.alg);
  if (!algorithm) throw new Error(`지원하지 않는 id_token 서명 알고리즘입니다: ${header.alg}`);

  const jwks = await getJwks(discovery);
  const jwk = (jwks.keys || []).find((key) => (header.kid ? key.kid === header.kid : key.use === 'sig'));
  if (!jwk) throw new Error('id_token 서명 키를 찾지 못했습니다.');

  const key = await webcrypto.subtle.importKey('jwk', jwk, algorithm.import, false, ['verify']);
  const ok = await webcrypto.subtle.verify(algorithm.verify, key, signature, encoder.encode(signingInput));
  if (!ok) throw new Error('id_token 서명 검증에 실패했습니다.');
  return payload;
}

function validateClaims(claims, settings, nonce) {
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== settings.issuer) throw new Error('id_token issuer가 일치하지 않습니다.');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(settings.clientId)) throw new Error('id_token audience가 일치하지 않습니다.');
  if (Number(claims.exp || 0) <= now) throw new Error('id_token이 만료되었습니다.');
  if (claims.nonce && nonce && claims.nonce !== nonce) throw new Error('id_token nonce가 일치하지 않습니다.');
}

function normalizeUser(idClaims, userInfo = {}) {
  const claims = { ...idClaims, ...userInfo };
  const roles = [
    ...(Array.isArray(claims.roles) ? claims.roles : []),
    ...(Array.isArray(claims.groups) ? claims.groups : []),
    ...(Array.isArray(claims.realm_access?.roles) ? claims.realm_access.roles : []),
  ];
  const email = claims.email || claims.upn || claims.preferred_username || '';
  const username = claims.preferred_username || claims.username || (email ? String(email).split('@')[0] : '') || claims.name || claims.sub;

  return {
    id: String(claims.sub || username || ''),
    email: email || '',
    username: username || '',
    name: claims.name || username || '',
    roles: Array.from(new Set(roles.map(String))),
    is_staff: Boolean(claims.is_staff || roles.some((role) => ['staff', 'admin', 'administrator'].includes(String(role).toLowerCase()))),
    is_superuser: Boolean(claims.is_superuser || roles.some((role) => ['admin', 'administrator', 'superuser'].includes(String(role).toLowerCase()))),
  };
}

async function exchangeCode(req, code, transient, settings, discovery) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUriFor(req, settings),
    code_verifier: transient.codeVerifier,
    client_id: settings.clientId,
  });

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  if (settings.clientSecret && settings.clientAuthMethod === 'client_secret_basic') {
    headers.Authorization = `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64')}`;
  } else if (settings.clientSecret && settings.clientAuthMethod !== 'none') {
    body.set('client_secret', settings.clientSecret);
  }

  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers,
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error_description || payload.error || `OpenID token 교환 실패: ${response.status}`);
  return payload;
}

async function fetchUserInfo(discovery, accessToken) {
  if (!discovery.userinfo_endpoint || !accessToken) return {};
  const response = await fetch(discovery.userinfo_endpoint, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) return {};
  return response.json().catch(() => ({}));
}

function safeNextUrl(rawNext, req) {
  const origin = requestOrigin(req);
  if (!rawNext) return `${origin}/`;

  try {
    const nextUrl = new URL(rawNext, origin);
    if (nextUrl.origin !== origin) return `${origin}/`;
    return nextUrl.toString();
  } catch {
    return `${origin}/`;
  }
}

async function handleConfig(req, res) {
  const settings = authSettings();
  sendJson(res, 200, {
    ok: true,
    data: {
      loginUrl: '/api/v1/auth/login',
      logoutUrl: '/api/v1/auth/logout',
      frontendRedirect: frontendRedirectFor(req, settings),
      sessionMaxAgeSeconds: settings.sessionMaxAgeSeconds,
      providerConfigured: settings.providerConfigured,
    },
  });
}

async function handleMe(req, res) {
  const session = readAuthSession(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  sendJson(res, 200, { ok: true, data: session.user });
}

async function handleLogin(req, res, url) {
  const settings = authSettings();
  if (!settings.providerConfigured) {
    sendJson(res, 503, { ok: false, error: 'OpenID 설정이 없습니다.' });
    return;
  }

  const discovery = await getDiscovery(settings);
  if (!discovery.authorization_endpoint || !discovery.token_endpoint) {
    throw new Error('OpenID authorization_endpoint 또는 token_endpoint를 찾지 못했습니다.');
  }

  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken(48);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const next = safeNextUrl(url.searchParams.get('next'), req);
  const transient = {
    state,
    nonce,
    codeVerifier,
    next,
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  };

  setSignedCookie(res, req, TRANSIENT_COOKIE, transient, 10 * 60);

  const authUrl = new URL(discovery.authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', settings.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUriFor(req, settings));
  authUrl.searchParams.set('scope', settings.scope);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  redirect(res, authUrl.toString());
}

async function handleCallback(req, res, url) {
  const settings = authSettings();
  const transient = readSignedCookie(req, TRANSIENT_COOKIE);
  clearCookie(res, TRANSIENT_COOKIE, req);

  if (!settings.providerConfigured) {
    sendJson(res, 503, { ok: false, error: 'OpenID 설정이 없습니다.' });
    return;
  }
  if (!transient || Number(transient.exp || 0) <= Math.floor(Date.now() / 1000)) {
    sendJson(res, 400, { ok: false, error: 'OpenID 로그인 상태값이 만료되었거나 없습니다.' });
    return;
  }
  if (url.searchParams.get('state') !== transient.state) {
    sendJson(res, 400, { ok: false, error: 'OpenID state가 일치하지 않습니다.' });
    return;
  }
  if (url.searchParams.get('error')) {
    const message = url.searchParams.get('error_description') || url.searchParams.get('error');
    sendJson(res, 400, { ok: false, error: `OpenID 로그인 실패: ${message}` });
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    sendJson(res, 400, { ok: false, error: 'OpenID callback code가 없습니다.' });
    return;
  }

  const discovery = await getDiscovery(settings);
  const tokenSet = await exchangeCode(req, code, transient, settings, discovery);
  if (!tokenSet.id_token) throw new Error('OpenID token 응답에 id_token이 없습니다.');

  const idClaims = await verifyJwtSignature(tokenSet.id_token, discovery);
  validateClaims(idClaims, settings, transient.nonce);
  const userInfo = await fetchUserInfo(discovery, tokenSet.access_token);
  const user = normalizeUser(idClaims, userInfo);
  const now = Math.floor(Date.now() / 1000);
  setSignedCookie(
    res,
    req,
    SESSION_COOKIE,
    {
      user,
      exp: now + settings.sessionMaxAgeSeconds,
    },
    settings.sessionMaxAgeSeconds,
  );

  redirect(res, safeNextUrl(transient.next, req));
}

async function handleLogout(req, res) {
  const settings = authSettings();
  clearCookie(res, SESSION_COOKIE, req);
  clearCookie(res, TRANSIENT_COOKIE, req);

  let logoutUrl = `${requestOrigin(req)}/`;
  if (settings.providerConfigured) {
    try {
      const discovery = await getDiscovery(settings);
      if (discovery.end_session_endpoint) {
        const url = new URL(discovery.end_session_endpoint);
        url.searchParams.set('post_logout_redirect_uri', logoutUrl);
        logoutUrl = url.toString();
      }
    } catch {
      logoutUrl = `${requestOrigin(req)}/`;
    }
  }

  sendJson(res, 200, { ok: true, data: { logoutUrl } });
}

export function handleAuthApi(req, res, url) {
  const apiPath = normalizeApiPath(url.pathname);
  if (!apiPath || !apiPath.startsWith('/v1/auth')) return false;

  (async () => {
    try {
      if (apiPath === '/v1/auth/config') {
        await handleConfig(req, res);
        return;
      }
      if (apiPath === '/v1/auth/me') {
        await handleMe(req, res);
        return;
      }
      if (apiPath === '/v1/auth/login') {
        await handleLogin(req, res, url);
        return;
      }
      if (apiPath === '/v1/auth/callback') {
        await handleCallback(req, res, url);
        return;
      }
      if (apiPath === '/v1/auth/logout') {
        await handleLogout(req, res);
        return;
      }

      sendJson(res, 404, { ok: false, error: `알 수 없는 인증 API 경로입니다: ${url.pathname}` });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || 'OpenID 처리 중 오류가 발생했습니다.' });
    }
  })();

  return true;
}
