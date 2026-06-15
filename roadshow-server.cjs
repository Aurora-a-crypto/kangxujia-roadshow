const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { URL } = require('node:url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8766);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = path.join(ROOT, 'shared-patients.json');

function localIPv4() {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal && !/^169\.254\./.test(net.address)) return net.address;
    }
  }
  return '127.0.0.1';
}

const mime = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml',
  '.wasm':'application/wasm',
  '.data':'application/octet-stream',
  '.binarypb':'application/octet-stream'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
    'Cache-Control':'no-store',
    ...headers
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 10_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function gfTables() {
  const exp = new Array(512);
  const log = new Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  return { exp, log };
}
const GF = gfTables();
function gfMul(a, b) {
  return a && b ? GF.exp[GF.log[a] + GF.log[b]] : 0;
}
function polyMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] ^= gfMul(a[i], b[j]);
  }
  return out;
}
function rsGenerator(degree) {
  let gen = [1];
  for (let i = 0; i < degree; i++) gen = polyMul(gen, [1, GF.exp[i]]);
  return gen;
}
function rsRemainder(data, degree) {
  const gen = rsGenerator(degree);
  const msg = data.concat(new Array(degree).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef) {
      for (let j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return msg.slice(data.length);
}
function bitsToBytes(bits, totalBytes) {
  while (bits.length < Math.min(totalBytes * 8, bits.length + 4)) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    out.push(b);
  }
  for (let pad = 0; out.length < totalBytes; pad ^= 1) out.push(pad ? 0x11 : 0xec);
  return out.slice(0, totalBytes);
}
function formatBits(mask) {
  const ecLevelL = 1;
  const data = (ecLevelL << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) ? 0x537 : 0);
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}
function makeQrSvg(text) {
  const payload = Buffer.from(text, 'utf8');
  const version = payload.length <= 32 ? 2 : payload.length <= 53 ? 3 : 4;
  const size = 21 + (version - 1) * 4;
  const dataBytes = version === 2 ? 34 : version === 3 ? 55 : 80;
  const ecBytes = version === 2 ? 10 : version === 3 ? 15 : 20;
  const base = Array.from({ length:size }, () => Array(size).fill(false));
  const reserved = Array.from({ length:size }, () => Array(size).fill(false));
  const setFunc = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    base[y][x] = !!dark;
    reserved[y][x] = true;
  };
  const finder = (x, y) => {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const xx = x + dx, yy = y + dy;
      const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const dark = inside && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setFunc(xx, yy, dark);
    }
  };
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
  for (let i = 8; i < size - 8; i++) {
    setFunc(i, 6, i % 2 === 0);
    setFunc(6, i, i % 2 === 0);
  }
  const align = (cx, cy) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      setFunc(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  };
  align(version === 2 ? 18 : version === 3 ? 22 : 26, version === 2 ? 18 : version === 3 ? 22 : 26);
  setFunc(8, 4 * version + 9, true);
  const reserveFormat = [
    [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8],
    [size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8],[size-8,8],[8,size-7],[8,size-6],[8,size-5],[8,size-4],[8,size-3],[8,size-2],[8,size-1]
  ];
  for (const [x,y] of reserveFormat) reserved[y][x] = true;

  if (payload.length > 78) throw new Error('QR data is too long for the local roadshow code');
  const bits = [0,1,0,0];
  for (let i = 7; i >= 0; i--) bits.push((payload.length >>> i) & 1);
  for (const b of payload) for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1);
  const data = bitsToBytes(bits, dataBytes);
  const codewords = data.concat(rsRemainder(data, ecBytes));
  const dataBits = [];
  for (const b of codewords) for (let i = 7; i >= 0; i--) dataBits.push((b >>> i) & 1);

  const maskBit = (mask, x, y) => {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };
  const withData = mask => {
    const modules = base.map(row => row.slice());
    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right--;
      for (let vert = 0; vert < size; vert++) {
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (reserved[y][x]) continue;
          let bit = !!dataBits[bitIndex++];
          if (maskBit(mask, x, y)) bit = !bit;
          modules[y][x] = bit;
        }
      }
    }
    return modules;
  };
  const penalty = modules => {
    let score = 0;
    for (let y = 0; y < size; y++) {
      let color = modules[y][0], run = 1;
      for (let x = 1; x < size; x++) {
        if (modules[y][x] === color) run++;
        else { if (run >= 5) score += run - 2; color = modules[y][x]; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
    for (let x = 0; x < size; x++) {
      let color = modules[0][x], run = 1;
      for (let y = 1; y < size; y++) {
        if (modules[y][x] === color) run++;
        else { if (run >= 5) score += run - 2; color = modules[y][x]; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
    }
    const patternPenalty = line => {
      let s = 0;
      for (let i = 0; i <= line.length - 11; i++) {
        const a = line.slice(i, i + 11).map(v => v ? '1' : '0').join('');
        if (a === '10111010000' || a === '00001011101') s += 40;
      }
      return s;
    };
    for (let y = 0; y < size; y++) score += patternPenalty(modules[y]);
    for (let x = 0; x < size; x++) score += patternPenalty(modules.map(row => row[x]));
    const dark = modules.flat().filter(Boolean).length;
    score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return score;
  };
  let bestMask = 0, bestModules = withData(0), bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = withData(mask);
    const score = penalty(candidate);
    if (score < bestScore) { bestMask = mask; bestModules = candidate; bestScore = score; }
  }
  const fb = formatBits(bestMask);
  const place = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
  for (let i = 0; i < 15; i++) bestModules[place[i][1]][place[i][0]] = ((fb >>> i) & 1) !== 0;
  const place2 = [[size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8],[size-8,8],[8,size-7],[8,size-6],[8,size-5],[8,size-4],[8,size-3],[8,size-2],[8,size-1]];
  for (let i = 0; i < 15; i++) bestModules[place2[i][1]][place2[i][0]] = ((fb >>> i) & 1) !== 0;
  bestModules[size - 8][8] = true;
  const scale = 8, quiet = 4, full = (size + quiet * 2) * scale;
  let rects = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (bestModules[y][x]) rects += `<rect x="${(x + quiet) * scale}" y="${(y + quiet) * scale}" width="${scale}" height="${scale}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${full}" height="${full}"><rect width="100%" height="100%" fill="#fff"/><g fill="#0f172a">${rects}</g></svg>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (url.pathname === '/api/patients') {
    if (req.method === 'GET') {
      if (!fs.existsSync(DATA_FILE)) return send(res, 200, JSON.stringify({ patients:null, updatedAt:null }), { 'Content-Type':mime['.json'] });
      return send(res, 200, fs.readFileSync(DATA_FILE), { 'Content-Type':mime['.json'] });
    }
    if (req.method === 'POST') {
      try {
        const payload = await readJson(req);
        if (!Array.isArray(payload.patients)) return send(res, 400, JSON.stringify({ error:'patients must be an array' }), { 'Content-Type':mime['.json'] });
        fs.writeFileSync(DATA_FILE, JSON.stringify({ patients:payload.patients, updatedAt:payload.updatedAt || new Date().toISOString() }, null, 2));
        return send(res, 200, JSON.stringify({ ok:true }), { 'Content-Type':mime['.json'] });
      } catch (error) {
        return send(res, 400, JSON.stringify({ error:error.message }), { 'Content-Type':mime['.json'] });
      }
    }
    return send(res, 405, 'Method Not Allowed');
  }

  if (url.pathname === '/qr.svg') {
    const data = url.searchParams.get('data') || `http://${req.headers.host || '127.0.0.1:8766'}/site.html`;
    try {
      return send(res, 200, makeQrSvg(data), { 'Content-Type':mime['.svg'] });
    } catch (error) {
      return send(res, 400, `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180"><rect width="100%" height="100%" fill="#fff"/><text x="20" y="80" font-size="16" fill="#dc2626">QR failed: ${String(error.message).replace(/[<>&]/g, '')}</text></svg>`, { 'Content-Type':mime['.svg'] });
    }
  }

  if (url.pathname === '/roadshow-config.js') {
    const ip = localIPv4();
    const publicUrl = process.env.PUBLIC_URL || '';
    const body = `window.KANGXUJIA_ROADSHOW=${JSON.stringify({
      host:ip,
      port:PORT,
      localUrl:`http://${ip}:${PORT}/s`,
      publicUrl
    })};`;
    return send(res, 200, body, { 'Content-Type':mime['.js'] });
  }

  const posePrefix = '/vendor/mediapipe/pose/';
  const isPoseAsset = url.pathname.startsWith(posePrefix);
  const staticRoot = isPoseAsset ? path.join(ROOT, 'node_modules', '@mediapipe', 'pose') : ROOT;
  const requestedPath = isPoseAsset
    ? url.pathname.slice(posePrefix.length)
    : (url.pathname === '/' || url.pathname === '/s' ? 'site.html' : url.pathname.replace(/^\/+/, ''));
  const filePath = path.normalize(path.join(staticRoot, decodeURIComponent(requestedPath)));
  if (!filePath.startsWith(staticRoot)) return send(res, 403, 'Forbidden');
  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, 'Not Found');
    send(res, 200, data, { 'Content-Type':mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
  });
});

server.listen(PORT, HOST, () => {
  const ip = localIPv4();
  console.log(`康续家路演服务已启动: http://127.0.0.1:${PORT}/site.html`);
  console.log(`局域网访问地址: http://${ip}:${PORT}/s`);
});
