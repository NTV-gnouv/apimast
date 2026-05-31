const cheerio = require('cheerio');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const BASE_URL = 'https://masothue.com';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const STRONG_MATCH_THRESHOLD = Number(process.env.STRONG_MATCH_THRESHOLD || 85);
const BROWSER_EXECUTABLE_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  process.env.CHROMIUM_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium'
].filter(Boolean);

const WINDOWS_BROWSER_EXECUTABLE_CANDIDATES = process.platform === 'win32'
  ? [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Chromium', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Chromium', 'Application', 'chrome.exe'),
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ]
  : [];

const ALL_BROWSER_EXECUTABLE_CANDIDATES = [
  ...BROWSER_EXECUTABLE_CANDIDATES,
  ...WINDOWS_BROWSER_EXECUTABLE_CANDIDATES
];

const SEARCH_TYPE_MAP = {
  auto: 'auto',
  enterpriseTax: 'enterpriseTax',
  personalTax: 'personalTax',
  identity: 'identity',
  enterpriseName: 'enterpriseName',
  legalName: 'legalName'
};

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function collapseText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function resolveBrowserExecutablePath() {
  for (const candidate of ALL_BROWSER_EXECUTABLE_CANDIDATES) {
    if (typeof candidate !== 'string' || !candidate.trim()) {
      continue;
    }

    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return '';
}

async function withBrowserPage(callback) {
  const executablePath = resolveBrowserExecutablePath();
  if (!executablePath) {
    const error = new Error(
      'Không tìm thấy Chrome/Chromium trên VPS. Hãy cài chromium hoặc đặt CHROME_PATH/PUPPETEER_EXECUTABLE_PATH trỏ tới binary trình duyệt.'
    );
    error.status = 500;
    throw error;
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({
    'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8'
  });
  page.setDefaultNavigationTimeout(REQUEST_TIMEOUT_MS);

  try {
    return await callback(page);
  } finally {
    try {
      await page.close();
    } catch (error) {
      // ignore browser cleanup errors
    }

    try {
      await browser.close();
    } catch (error) {
      // ignore browser cleanup errors
    }
  }
}

async function fetchPageHtmlWithBrowser(url) {
  const result = await withBrowserPage(async (page) => {
    await page.goto(url, { waitUntil: 'networkidle2' });
    return {
      html: await page.content(),
      finalUrl: page.url(),
      headers: {
        'content-type': 'text/html; charset=utf-8'
      }
    };
  });

  if (/challenge-error-text|Enable JavaScript and cookies to continue/i.test(result.html)) {
    const error = new Error('masothue.com đang chặn request tự động bằng challenge của Cloudflare');
    error.status = 403;
    error.html = result.html.slice(0, 1024);
    throw error;
  }

  return result;
}

function extractJsonLdObjects($) {
  const objects = [];

  $('script[type="application/ld+json"]').each((_, script) => {
    const raw = collapseText($(script).text());
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        objects.push(...parsed);
      } else if (parsed && typeof parsed === 'object') {
        objects.push(parsed);
      }
    } catch (error) {
      // Ignore malformed JSON-LD blocks.
    }
  });

  return objects;
}

function extractMetaContent($, selector) {
  return collapseText($(selector).attr('content') || '');
}

function extractTitleData($) {
  const title = collapseText($('title').first().text());
  const match = title.match(/^(\d[\d-]*)\s*-\s*(.+?)(?:\s*-\s*MaSoThue)?$/i);

  return {
    title,
    ma_so_thue: match ? match[1] : '',
    ten: match ? match[2] : ''
  };
}

function extractAddressFromDescription(description) {
  const normalized = collapseText(description);
  if (!normalized) {
    return '';
  }

  const match = normalized.match(/tra cứu mã số thuế\s+[\d-]+\s*-\s*(.+)$/i);
  return match ? collapseText(match[1]) : '';
}

function isLikelyTaxCodeQuery(query) {
  return /^\d[\d-]*$/.test(normalizeText(query));
}

function isGenericStructuredName(name) {
  const normalized = normalizeText(name);
  return !normalized || /mã số thuế|tra cứu|masothue/i.test(normalized);
}

function extractStructuredDetailFromHtml(html) {
  const $ = cheerio.load(html);
  const titleData = extractTitleData($);
  const description = extractMetaContent($, 'meta[name="description"]');
  const canonical = extractMetaContent($, 'link[rel="canonical"]');
  const jsonLdObjects = extractJsonLdObjects($);

  const jsonLdCompany = jsonLdObjects.find((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const typeValue = item['@type'];
    const types = Array.isArray(typeValue) ? typeValue : [typeValue];
    return types.some((type) => /organization|corporation|localbusiness|business/i.test(String(type || '')));
  }) || null;

  const structuredNameCandidate = collapseText(jsonLdCompany && (jsonLdCompany.name || jsonLdCompany.headline || jsonLdCompany.alternateName));
  const structuredName = isGenericStructuredName(structuredNameCandidate) ? '' : structuredNameCandidate;
  const structuredAddress = jsonLdCompany && jsonLdCompany.address;
  const addressFromJsonLd = collapseText(
    structuredAddress && typeof structuredAddress === 'object'
      ? structuredAddress.streetAddress || structuredAddress.addressLocality || structuredAddress.addressRegion || structuredAddress.addressCountry
      : structuredAddress
  );
  const descriptionAddress = extractAddressFromDescription(description);

  const result = {
    ten: structuredName || titleData.ten || '',
    ma_so_thue: titleData.ma_so_thue || '',
    nguoi_dai_dien: '',
    tinh_trang: '',
    quan_ly_boi: '',
    dia_chi: addressFromJsonLd || descriptionAddress || ''
  };

  if (!result.ma_so_thue && canonical) {
    const canonicalMatch = canonical.match(/\/(\d[\d-]*)-/);
    if (canonicalMatch) {
      result.ma_so_thue = canonicalMatch[1];
    }
  }

  return { $, result };
}

function encodeQuery(value) {
  return encodeURIComponent(String(value || '').trim());
}

function isDetailPath(pathname) {
  return /^\/\d[\d-]*-.+/.test(pathname);
}

function buildSearchUrl(query, type = 'auto') {
  const safeType = SEARCH_TYPE_MAP[type] ? type : 'auto';
  return `${BASE_URL}/Search/?q=${encodeQuery(query)}&type=${safeType}`;
}

function buildAjaxTokenUrl() {
  return `${BASE_URL}/Ajax/Token`;
}

function buildAjaxSearchUrl() {
  return `${BASE_URL}/Ajax/Search`;
}

async function fetchPageHtml(url, requestOptions = {}) {
  const parsedUrl = new URL(url);
  if (parsedUrl.hostname === 'masothue.com' || parsedUrl.hostname.endsWith('.masothue.com')) {
    return fetchPageHtmlWithBrowser(url, requestOptions);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    ...(requestOptions.headers || {})
  };

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      ...requestOptions,
      headers
    });

    if (!response.ok) {
      const error = new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }

    const html = await response.text();
    const finalUrl = response.url || url;
    const responseHeaders = {};
    try {
      responseHeaders['content-type'] = response.headers.get('content-type') || '';
      responseHeaders['set-cookie'] = response.headers.get('set-cookie') || '';
    } catch (e) {
      // ignore header inspect errors
    }

    if (/challenge-error-text|Enable JavaScript and cookies to continue/i.test(html)) {
      const error = new Error('masothue.com đang chặn request tự động bằng challenge của Cloudflare');
      error.status = 403;
      error.headers = responseHeaders;
      error.html = html.slice(0, 1024);
      throw error;
    }

    return { html, finalUrl, headers: responseHeaders };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      const timeoutError = new Error(`Timed out fetching ${url} after ${REQUEST_TIMEOUT_MS}ms`);
      timeoutError.status = 504;
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchHtml(url) {
  return fetchPageHtml(url);
}

async function fetchSearchHtml(query, type = 'auto') {
  try {
    const searchResult = await searchViaAjax(query, type, '1');
    if (searchResult && searchResult.url) {
      const detailUrl = searchResult.url.startsWith('http') ? searchResult.url : `${BASE_URL}${searchResult.url}`;
      return fetchPageHtml(detailUrl);
    }
  } catch (error) {
    // Fall back to the search URL when the browser-backed AJAX flow fails.
  }

  return fetchPageHtml(buildSearchUrl(query, type));
}

async function fetchAjaxJson(url, options = {}) {
  const { html, finalUrl, headers } = await fetchPageHtml(url, options);
  let data;

  const contentType = String((headers && headers['content-type']) || '').toLowerCase();
  if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
    const err = new Error(`Expected JSON but got ${contentType || 'unknown'} from ${finalUrl}`);
    err.status = 502;
    err.contentType = contentType;
    err.htmlSnippet = String(html || '').slice(0, 800);
    // include headers for easier debugging
    err.headers = headers || {};
    throw err;
  }

  try {
    data = JSON.parse(html);
  } catch (error) {
    const parseError = new Error(`Invalid JSON from ${finalUrl}`);
    parseError.status = 502;
    parseError.cause = error;
    parseError.htmlSnippet = String(html || '').slice(0, 800);
    parseError.headers = headers || {};
    throw parseError;
  }

  return { data, finalUrl, headers };
}

async function fetchAjaxToken(initialCookie = '') {
  const headers = {
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'x-requested-with': 'XMLHttpRequest',
    accept: 'application/json, text/javascript, */*; q=0.01',
    referer: `${BASE_URL}/`,
    origin: BASE_URL
  };
  if (initialCookie) headers.cookie = initialCookie;

  const response = await fetchAjaxJson(buildAjaxTokenUrl(), {
    method: 'POST',
    headers,
    body: `r=${encodeQuery(Math.random().toString(36).slice(2))}`
  }).catch((err) => {
    throw new Error(`fetchAjaxToken failed: ${err && err.message ? err.message : err}`);
  });

  if (!response.data || response.data.success !== 1 || !response.data.token) {
    const error = new Error('Không lấy được token tra cứu từ masothue.com');
    error.status = 502;
    throw error;
  }

  // parse set-cookie into a Cookie header string: "key=value; key2=value2"
  const setCookieRaw = response.headers && response.headers['set-cookie'] ? response.headers['set-cookie'] : '';
  let cookie = '';
  if (setCookieRaw) {
    const matches = [...String(setCookieRaw).matchAll(/(?:^|,\s*)([^=;,\s]+=[^;,\s]+)/g)];
    cookie = matches.map((m) => m[1]).join('; ');
  }

  // Merge with initialCookie if provided (avoid duplicate keys by simple concatenation)
  if (initialCookie && cookie) cookie = `${initialCookie}; ${cookie}`;
  else if (initialCookie && !cookie) cookie = initialCookie;

  return { token: response.data.token, cookie };
}

async function searchViaAjax(query, type = 'auto', forceSearch = '1') {
  const safeQuery = String(query || '').trim();

  const result = await withBrowserPage(async (page) => {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });

    const payload = await page.evaluate(async ({ safeQuery, type, forceSearch }) => {
      const postJson = async (path, body, referer) => {
        const response = await fetch(path, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest',
            accept: 'application/json, text/javascript, */*; q=0.01',
            origin: location.origin,
            referer
          },
          body
        });

        return {
          status: response.status,
          text: await response.text()
        };
      };

      const tokenResponse = await postJson('/Ajax/Token', 'r=test', `${location.origin}/`);
      const tokenData = JSON.parse(tokenResponse.text);
      const searchBody = new URLSearchParams({
        q: safeQuery,
        type,
        token: tokenData.token,
        'force-search': String(forceSearch)
      }).toString();
      const searchResponse = await postJson('/Ajax/Search', searchBody, `${location.origin}/Search/?q=${encodeURIComponent(safeQuery)}&type=${type}`);
      const searchData = JSON.parse(searchResponse.text);

      return {
        tokenData,
        searchData,
        searchStatus: searchResponse.status
      };
    }, { safeQuery, type, forceSearch });

    return {
      data: payload.searchData,
      finalUrl: payload.searchData && payload.searchData.url ? new URL(payload.searchData.url, BASE_URL).href : `${BASE_URL}/Search/`,
      headers: {}
    };
  });

  return result.data;
}

async function lookupViaSearchHtml(query, type = 'auto') {
  const searchResponse = await fetchSearchHtml(query, type);
  const finalPath = new URL(searchResponse.finalUrl).pathname;

  if (isDetailPath(finalPath)) {
    const detail = extractDetailFromHtml(searchResponse.html);

    if (isLikelyTaxCodeQuery(query) && normalizeText(detail.ma_so_thue) !== normalizeText(query)) {
      const candidates = extractCandidatesFromSearchHtml(searchResponse.html);
      const exactCandidate = candidates.find((candidate) => normalizeText(candidate.ma_so_thue) === normalizeText(query));

      if (exactCandidate) {
        const detailResponse = await fetchHtml(exactCandidate.href);
        return {
          source: detailResponse.finalUrl,
          detail: extractDetailFromHtml(detailResponse.html),
          searchHtml: searchResponse.html,
          candidates: candidates.map((candidate) => ({
            candidate,
            score: scoreCandidate(candidate, query)
          })).sort((left, right) => right.score - left.score)
        };
      }
    }

    return {
      source: searchResponse.finalUrl,
      detail,
      searchHtml: searchResponse.html,
      candidates: []
    };
  }

  const candidates = extractCandidatesFromSearchHtml(searchResponse.html);
  if (!candidates.length) {
    return {
      source: searchResponse.finalUrl,
      detail: null,
      searchHtml: searchResponse.html,
      candidates: []
    };
  }

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, query)
    }))
    .sort((left, right) => right.score - left.score);

  const topCandidate = ranked[0] && ranked[0].score > 0 ? ranked[0].candidate : null;
  if (!topCandidate) {
    return {
      source: searchResponse.finalUrl,
      detail: null,
      searchHtml: searchResponse.html,
      candidates: ranked
    };
  }

  const detailResponse = await fetchHtml(topCandidate.href);
  return {
    source: detailResponse.finalUrl,
    detail: extractDetailFromHtml(detailResponse.html),
    searchHtml: searchResponse.html,
    candidates: ranked
  };
}

function parseLabelValueTable($) {
  const data = {};

  $('tr').each((_, row) => {
    const cells = $(row)
      .find('th, td')
      .map((__, cell) => collapseText($(cell).text()))
      .get()
      .filter(Boolean);

    if (cells.length >= 2) {
      data[cells[0]] = cells.slice(1).join(' ').trim();
    }
  });

  return data;
}

function extractDetailFromHtml(html) {
  const { $, result } = extractStructuredDetailFromHtml(html);
  const tableData = parseLabelValueTable($);

  if (!result.ma_so_thue) {
    const rowText = collapseText($('body').text());
    const codeMatch = rowText.match(/Mã số thuế\s+([\d-]+)/i);
    if (codeMatch) {
      result.ma_so_thue = codeMatch[1];
    }
  }

  if (!result.ten) {
    const heading = collapseText($('h1').first().text());
    const titleMatch = heading.match(/^(\d[\d-]*)\s*-\s*(.+)$/);
    result.ten = titleMatch ? titleMatch[2] : result.ten;
    if (!result.ma_so_thue && titleMatch) {
      result.ma_so_thue = titleMatch[1];
    }
  }

  result.nguoi_dai_dien = result.nguoi_dai_dien || tableData['Người đại diện'] || '';
  result.tinh_trang = result.tinh_trang || tableData['Tình trạng'] || '';
  result.quan_ly_boi = result.quan_ly_boi || tableData['Quản lý bởi'] || '';
  result.dia_chi = result.dia_chi || tableData['Địa chỉ'] || tableData['Địa chỉ Thuế'] || '';

  return result;
}

function scoreCandidate(candidate, query) {
  const normalizedQuery = normalizeText(query);
  const normalizedName = normalizeText(candidate.ten);
  const normalizedDirector = normalizeText(candidate.nguoi_dai_dien);
  const normalizedTax = normalizeText(candidate.ma_so_thue);
  const normalizedHref = normalizeText(candidate.href);

  if (!candidate.ma_so_thue && !candidate.ten) {
    return 0;
  }

  if (normalizedHref.includes(`/${normalizedQuery}-`)) {
    return 120;
  }

  if (normalizedTax === normalizedQuery) {
    return 100;
  }

  if (normalizedName === normalizedQuery) {
    return 95;
  }

  if (normalizedDirector === normalizedQuery) {
    return 90;
  }

  if (normalizedTax.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedTax)) {
    return 80;
  }

  if (normalizedName.includes(normalizedQuery) || normalizedDirector.includes(normalizedQuery)) {
    return 70;
  }

  return 10;
}

function computeConfidence({ query, type, ajaxResult, detail }) {
  const normalizedQuery = normalizeText(query);
  const normalizedType = String(type || 'auto');
  const detailName = normalizeText(detail && detail.ten);
  const detailTaxCode = normalizeText(detail && detail.ma_so_thue);
  const detailDirector = normalizeText(detail && detail.nguoi_dai_dien);
  const ajaxUrl = normalizeText(ajaxResult && ajaxResult.url);
  const ajaxRows = Number(ajaxResult && ajaxResult.numRows);

  if (!normalizedQuery || !detail) {
    return 0;
  }

  if (detailTaxCode === normalizedQuery) {
    return 100;
  }

  if (normalizedType === 'legalName' && detailDirector === normalizedQuery) {
    return 96;
  }

  if (normalizedType === 'enterpriseName' && detailName === normalizedQuery) {
    return 96;
  }

  if (normalizedType === 'auto' && (detailTaxCode === normalizedQuery || detailName === normalizedQuery || detailDirector === normalizedQuery)) {
    return 95;
  }

  if (ajaxRows === 1 && ajaxUrl.includes(normalizedQuery.replace(/\s+/g, '-'))) {
    return 90;
  }

  if (ajaxRows === 1) {
    return 86;
  }

  if (detailTaxCode.includes(normalizedQuery) || detailName.includes(normalizedQuery) || detailDirector.includes(normalizedQuery)) {
    return 72;
  }

  return 40;
}

function isStrongMatch(match) {
  return Number(match && match.confidence) >= STRONG_MATCH_THRESHOLD;
}

function extractCandidatesFromSearchHtml(html) {
  const $ = cheerio.load(html);
  const candidates = [];

  $('a[href]').each((_, anchor) => {
    const href = $(anchor).attr('href') || '';
    if (!/^\/\d[\d-]*-.+/.test(href)) {
      return;
    }

    const linkText = collapseText($(anchor).text());
    const container = $(anchor).closest('article, section, li, div');
    const containerText = collapseText(container.text());
    const hrefPath = href.replace(/^https?:\/\/[^/]+/i, '');

    const taxMatch = containerText.match(/Mã số thuế\s+([\d-]+)/i) || linkText.match(/^(\d[\d-]*)$/);
    const directorMatch = containerText.match(/Người đại diện\s+([^|\n]+?)(?:\s+[]|$)/i);
    const addressMatch = containerText.match(/(?:Địa chỉ(?: Thuế)?|)\s+([^|\n]+?)(?:\s+[]|$)/i);
    const hrefTaxMatch = hrefPath.match(/^\/(\d[\d-]*)-/);

    candidates.push({
      ten: linkText,
      ma_so_thue: taxMatch ? taxMatch[1] : (hrefTaxMatch ? hrefTaxMatch[1] : ''),
      nguoi_dai_dien: directorMatch ? collapseText(directorMatch[1]) : '',
      dia_chi: addressMatch ? collapseText(addressMatch[1]) : '',
      href: href.startsWith('http') ? href : `${BASE_URL}${href}`
    });
  });

  return candidates;
}

async function lookupMasothue(query, type = 'auto') {
  const safeQuery = String(query || '').trim();
  const safeType = SEARCH_TYPE_MAP[type] ? type : 'auto';
  const effectiveType = isLikelyTaxCodeQuery(safeQuery) ? 'auto' : safeType;

  if (!safeQuery) {
    const error = new Error('Thiếu tham số query');
    error.status = 400;
    throw error;
  }

  let ajaxResult = null;
  let source = `${BASE_URL}/Ajax/Search`;
  let parsedDetail = null;
  let ajaxUrl = '';

  try {
    ajaxResult = await searchViaAjax(safeQuery, effectiveType, '1');
    ajaxUrl = String(ajaxResult && ajaxResult.url ? ajaxResult.url : '').trim();

    if (ajaxResult && ajaxResult.success === 1 && ajaxUrl && ajaxUrl !== '/') {
      source = ajaxUrl.startsWith('http') ? ajaxUrl : `${BASE_URL}${ajaxUrl}`;
      const detailResponse = await fetchHtml(source);
      parsedDetail = extractDetailFromHtml(detailResponse.html);
      source = detailResponse.finalUrl;

      if (isLikelyTaxCodeQuery(safeQuery) && normalizeText(parsedDetail && parsedDetail.ma_so_thue) !== normalizeText(safeQuery)) {
        parsedDetail = null;
      }
    }
  } catch (error) {
    ajaxResult = ajaxResult || null;
  }

  if (!parsedDetail) {
    const fallback = await lookupViaSearchHtml(safeQuery, effectiveType);
    source = fallback.source;
    parsedDetail = fallback.detail;
  }

  if (!parsedDetail) {
    return {
      source,
      ok: false,
      data: null,
      confidence: 0,
      strongMatch: false,
      uncertain: true,
      reason: 'masothue.com không trả về kết quả đủ tin cậy',
      ajax: ajaxResult || null
    };
  }

  const confidence = computeConfidence({
    query: safeQuery,
    type: effectiveType,
    ajaxResult,
    detail: parsedDetail
  });
  const strongMatch = confidence >= STRONG_MATCH_THRESHOLD;

  return {
    source,
    ok: true,
    confidence,
    strongMatch,
    uncertain: !strongMatch,
    data: strongMatch ? parsedDetail : null,
    matched: strongMatch ? {
      query: safeQuery,
      type: safeType,
      url: ajaxUrl,
      numRows: Number(ajaxResult && ajaxResult.numRows ? ajaxResult.numRows : 0)
    } : null,
    reason: strongMatch ? '' : 'Kết quả khớp chưa đủ mạnh để trả dữ liệu'
  };
}

module.exports = {
  lookupMasothue,
  buildSearchUrl,
  extractDetailFromHtml,
  extractCandidatesFromSearchHtml,
  searchViaAjax,
  fetchAjaxToken,
  computeConfidence,
  isStrongMatch
};