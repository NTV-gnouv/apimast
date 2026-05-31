require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { lookupMasothue, buildSearchUrl } = require('./masothue');

const app = express();
const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_FILE = path.join(ROOT_DIR, 'index.html');
const API_GUIDE_FILE = path.join(ROOT_DIR, 'api-guide.html');
const HOST = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';

function parseAllowedOrigins(value) {
  return String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

app.use(
  cors({
    origin: ALLOWED_ORIGIN ? parseAllowedOrigins(ALLOWED_ORIGIN) : true
  })
);

app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.sendFile(INDEX_FILE);
});

app.get('/index.html', (_req, res) => {
  res.sendFile(INDEX_FILE);
});

app.get('/api-guide', (_req, res) => {
  res.sendFile(API_GUIDE_FILE);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api', (_req, res) => {
  res.json({
    ok: true,
    name: 'Masothue API Proxy',
    guide: '/api-guide',
    endpoints: [
      {
        method: 'GET',
        path: '/api/lookup',
        query: ['q or query', 'type'],
        description: 'Tra cứu theo từ khóa linh hoạt.'
      },
      {
        method: 'GET',
        path: '/api/company/:taxCode',
        query: [],
        description: 'Tra cứu nhanh theo mã số thuế.'
      },
      {
        method: 'GET',
        path: '/api/debug-lookup',
        query: ['q or query', 'type'],
        description: 'Trả dữ liệu debug chi tiết khi cần chẩn đoán.'
      }
    ]
  });
});

app.get('/api/lookup', async (req, res) => {
  try {
    const query = req.query.q || req.query.query;
    const type = req.query.type || 'auto';
    const result = await lookupMasothue(query, type);

    if (!result.ok) {
      const status = result.code === 'NOT_FOUND' ? 404 : 200;
      return res.status(status).json({
        ok: false,
        code: result.code || 'NOT_FOUND',
        error: result.reason || 'Không tìm thấy kết quả',
        reason: result.reason || 'Không tìm thấy kết quả',
        query: String(query || ''),
        type: String(type || 'auto'),
        searchUrl: buildSearchUrl(query, type),
        source: result.source || ''
      });
    }

    res.json({
      ok: true,
      code: result.code || 'OK',
      query: String(query || ''),
      type: String(type || 'auto'),
      searchUrl: buildSearchUrl(query, type),
      ...result
    });
  } catch (error) {
    const status = Number(error.status || 500);
    res.status(status).json({
      ok: false,
      error: error.message || 'Unknown error'
    });
  }
});

// Debug endpoint: returns detailed response/error info from lookup (for debugging on deployments)
app.get('/api/debug-lookup', async (req, res) => {
  try {
    const query = req.query.q || req.query.query;
    const type = req.query.type || 'auto';
    const result = await lookupMasothue(query, type);

    res.json({
      ok: true,
      debug: true,
      query: String(query || ''),
      type: String(type || 'auto'),
      result
    });
  } catch (error) {
    // include any debug fields our lookup throws (contentType, htmlSnippet, headers)
    const status = Number(error.status || 500);
    const payload = {
      ok: false,
      error: error.message || 'Unknown error',
      status,
      debug: true
    };
    if (error.contentType) payload.contentType = error.contentType;
    if (error.htmlSnippet) payload.htmlSnippet = String(error.htmlSnippet).slice(0, 2000);
    if (error.headers) payload.headers = error.headers;
    if (error.cause && error.cause.message) payload.cause = error.cause.message;

    res.status(status).json(payload);
  }
});

app.get('/api/company/:taxCode', async (req, res) => {
  try {
    const result = await lookupMasothue(req.params.taxCode, 'auto');

    if (!result.ok) {
      const status = result.code === 'NOT_FOUND' ? 404 : 200;
      return res.status(status).json({
        ok: false,
        code: result.code || 'NOT_FOUND',
        error: result.reason || 'Không tìm thấy kết quả',
        reason: result.reason || 'Không tìm thấy kết quả',
        query: String(req.params.taxCode),
        type: 'auto',
        searchUrl: buildSearchUrl(req.params.taxCode, 'auto'),
        source: result.source || ''
      });
    }

    res.json({
      ok: true,
      code: result.code || 'OK',
      query: req.params.taxCode,
      type: 'auto',
      searchUrl: buildSearchUrl(req.params.taxCode, 'auto'),
      ...result
    });
  } catch (error) {
    const status = Number(error.status || 500);
    res.status(status).json({
      ok: false,
      error: error.message || 'Unknown error'
    });
  }
});

app.listen(port, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  process.stdout.write(`Masothue API running on http://${displayHost}:${port}\n`);
  if (ALLOWED_ORIGIN) {
    process.stdout.write(`CORS allowed origins: ${ALLOWED_ORIGIN}\n`);
  }
});