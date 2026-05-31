require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { lookupMasothue, buildSearchUrl } = require('./masothue');

const app = express();
const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_FILE = path.join(ROOT_DIR, 'index.html');
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

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/lookup', async (req, res) => {
  try {
    const query = req.query.q || req.query.query;
    const type = req.query.type || 'auto';
    const result = await lookupMasothue(query, type);

    res.json({
      ok: true,
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

app.get('/api/company/:taxCode', async (req, res) => {
  try {
    const result = await lookupMasothue(req.params.taxCode, 'auto');
    res.json({
      ok: true,
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