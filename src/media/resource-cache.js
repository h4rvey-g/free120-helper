import { SCRIPT } from '../core/constants.js';
import { isPlainObject, normalizeString, uniqueNormalizedStrings } from '../core/data.js';

const DEFAULT_MAX_RESOURCE_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 48 * 1024 * 1024;
const RESOURCE_URL_PATTERN = /(?:^|\/)api\/Resource\?/i;

function getDefaultBaseUrl(adapterWindow = null) {
  const href = normalizeString(adapterWindow && adapterWindow.location && adapterWindow.location.href, '');
  return href || `${SCRIPT.ORIGIN}/webfred/`;
}

function normalizeResourceUrl(url, baseUrl = `${SCRIPT.ORIGIN}/webfred/`) {
  const value = normalizeString(url, '');
  if (!value || /^(?:data|blob):/i.test(value)) {
    return value;
  }
  try {
    return new URL(value, baseUrl).href;
  } catch (_error) {
    return value;
  }
}

function isCacheableResourceUrl(url) {
  const value = normalizeString(url, '');
  if (!value || /^(?:data|blob|javascript):/i.test(value)) {
    return false;
  }
  return RESOURCE_URL_PATTERN.test(value) || RESOURCE_URL_PATTERN.test(normalizeResourceUrl(value));
}

function inferContentTypeFromUrl(url) {
  const value = normalizeString(url, '').toLowerCase();
  if (/\.(?:png)(?:\?|$)/.test(value)) return 'image/png';
  if (/\.(?:jpe?g)(?:\?|$)/.test(value)) return 'image/jpeg';
  if (/\.(?:gif)(?:\?|$)/.test(value)) return 'image/gif';
  if (/\.(?:webp)(?:\?|$)/.test(value)) return 'image/webp';
  if (/\.(?:svg)(?:\?|$)/.test(value)) return 'image/svg+xml';
  if (/(?:\?|&)name=[^&]*\.webm(?:&|$)/.test(value)) return 'video/webm';
  if (/\.(?:webm)(?:\?|$)/.test(value)) return 'video/webm';
  if (/\.(?:mp4)(?:\?|$)/.test(value)) return 'video/mp4';
  if (/\.(?:mp3)(?:\?|$)/.test(value)) return 'audio/mpeg';
  if (/\.(?:wav)(?:\?|$)/.test(value)) return 'audio/wav';
  if (/\.(?:ogg|oga)(?:\?|$)/.test(value)) return 'audio/ogg';
  return 'application/octet-stream';
}

function arrayBufferToBase64(adapterWindow, buffer) {
  const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  const btoaFn = adapterWindow && typeof adapterWindow.btoa === 'function' ? adapterWindow.btoa.bind(adapterWindow) : (typeof btoa === 'function' ? btoa : null);
  if (!btoaFn) {
    throw new Error('Base64 encoder unavailable.');
  }
  return btoaFn(binary);
}

function getCookieValue(adapterDocument, name) {
  const cookieText = normalizeString(adapterDocument && adapterDocument.cookie, '');
  if (!cookieText || !name) {
    return '';
  }
  const prefix = `${encodeURIComponent(name)}=`;
  const rawPrefix = `${name}=`;
  return cookieText.split(';').map((part) => part.trim()).reduce((found, part) => {
    if (found) return found;
    if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
    if (part.startsWith(rawPrefix)) return decodeURIComponent(part.slice(rawPrefix.length));
    return '';
  }, '');
}

function setCookieValue(adapterDocument, name, value, options = {}) {
  if (!adapterDocument || !name) {
    return false;
  }
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(normalizeString(value, ''))}`];
  parts.push(`path=${normalizeString(options.path, '/webfred') || '/webfred'}`);
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Number(options.maxAge) || 0}`);
  adapterDocument.cookie = parts.join('; ');
  return true;
}

async function fetchResourceDataUrl(adapterWindow, url, options = {}) {
  const fetchFn = adapterWindow && typeof adapterWindow.fetch === 'function' ? adapterWindow.fetch.bind(adapterWindow) : (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) {
    return null;
  }
  const sourceUrl = normalizeString(url, '');
  if (!isCacheableResourceUrl(sourceUrl)) {
    return null;
  }
  const absoluteUrl = normalizeResourceUrl(sourceUrl, normalizeString(options.baseUrl, getDefaultBaseUrl(adapterWindow)));
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_RESOURCE_BYTES) || DEFAULT_MAX_RESOURCE_BYTES;
  const fetchOptions = { credentials: 'include' };
  if (options.cache) {
    fetchOptions.cache = options.cache;
  }
  const response = await withTemporaryWebfredSessionCookie(adapterWindow, options, async () => {
    let firstResponse = await fetchFn(absoluteUrl, fetchOptions);
    if (firstResponse && firstResponse.status === 404 && options.cache && options.cache !== 'reload') {
      firstResponse = await fetchFn(absoluteUrl, { credentials: 'include', cache: 'reload' });
    }
    return firstResponse;
  });
  if (!response || !response.ok) {
    return null;
  }
  const declaredLength = Number(response.headers && response.headers.get && response.headers.get('content-length') || 0) || 0;
  if (declaredLength > maxBytes) {
    return null;
  }
  const buffer = await response.arrayBuffer();
  const byteLength = buffer && Number(buffer.byteLength || 0) || 0;
  if (!byteLength || byteLength > maxBytes) {
    return null;
  }
  const declaredContentType = normalizeString(response.headers && response.headers.get && response.headers.get('content-type'), '').split(';')[0];
  const inferredContentType = inferContentTypeFromUrl(absoluteUrl);
  const contentType = (!declaredContentType || declaredContentType === 'application/octet-stream') ? inferredContentType : declaredContentType;
  return Object.freeze({
    url: sourceUrl,
    absoluteUrl,
    dataUrl: `data:${contentType};base64,${arrayBufferToBase64(adapterWindow, buffer)}`,
    byteLength,
    contentType,
    status: Number(response.status || 0) || 0,
  });
}

async function fetchResourceDataByUrl(adapterWindow, urls, options = {}) {
  const maxTotalBytes = Number(options.maxTotalBytes || DEFAULT_MAX_TOTAL_BYTES) || DEFAULT_MAX_TOTAL_BYTES;
  let totalBytes = 0;
  const entries = [];
  const normalizedUrls = uniqueNormalizedStrings((Array.isArray(urls) ? urls : []).filter(isCacheableResourceUrl));
  for (const url of normalizedUrls) {
    if (totalBytes >= maxTotalBytes) {
      break;
    }
    try {
      const result = await fetchResourceDataUrl(adapterWindow, url, options);
      if (!result || !result.dataUrl || totalBytes + result.byteLength > maxTotalBytes) {
        continue;
      }
      totalBytes += result.byteLength;
      uniqueNormalizedStrings([result.url, result.absoluteUrl]).forEach((key) => {
        entries.push([key, result.dataUrl]);
      });
    } catch (_error) {}
  }
  return Object.freeze(Object.fromEntries(entries));
}

function extractResourceUrlsFromCssText(value) {
  const text = normalizeString(value, '');
  const urls = [];
  text.replace(/url\((['"]?)([^'")]+)\1\)/gi, (_match, _quote, resourceUrl) => {
    urls.push(resourceUrl);
    return _match;
  });
  return urls;
}

function extractResourceUrlsFromHtml(html) {
  const text = normalizeString(html, '');
  const urls = [];
  text.replace(/\b(?:src|href|poster|data-ng-src|ng-src|data-src)\s*=\s*(['"])(.*?)\1/gi, (_match, _quote, resourceUrl) => {
    urls.push(resourceUrl);
    return _match;
  });
  urls.push(...extractResourceUrlsFromCssText(text));
  return uniqueNormalizedStrings(urls.filter(isCacheableResourceUrl));
}

function extractMediaMetadataIdsFromHtml(html) {
  const text = normalizeString(html, '');
  const ids = [];
  text.replace(/\bdata-media-id\s*=\s*(["'])(.*?)\1/gi, (_match, _quote, mediaId) => {
    ids.push(mediaId);
    return _match;
  });
  text.replace(/\bfilename\s*=\s*(["'])(\d+)\.mediaGallery\1/gi, (_match, _quote, mediaId) => {
    ids.push(mediaId);
    return _match;
  });
  return uniqueNormalizedStrings(ids);
}

function withTemporaryWebfredSessionCookie(adapterWindow, options, callback) {
  const adapterDocument = options.document || (adapterWindow && adapterWindow.document) || null;
  const sessionCookieName = normalizeString(options.sessionCookieName, 'nbme.webfred.exam.session');
  const explicitSessionId = normalizeString(options.sessionId, '');
  const previousSessionCookie = explicitSessionId && adapterDocument ? getCookieValue(adapterDocument, sessionCookieName) : '';
  const shouldSetSessionCookie = Boolean(explicitSessionId && adapterDocument && previousSessionCookie !== explicitSessionId);
  if (shouldSetSessionCookie) {
    setCookieValue(adapterDocument, sessionCookieName, explicitSessionId, { path: '/webfred', sameSite: 'Lax' });
  }
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (shouldSetSessionCookie) {
        if (previousSessionCookie) {
          setCookieValue(adapterDocument, sessionCookieName, previousSessionCookie, { path: '/webfred', sameSite: 'Lax' });
        } else {
          setCookieValue(adapterDocument, sessionCookieName, '', { path: '/webfred', maxAge: 0 });
        }
      }
    });
}

async function fetchMediaMetadata(adapterWindow, mediaId, options = {}) {
  const fetchFn = adapterWindow && typeof adapterWindow.fetch === 'function' ? adapterWindow.fetch.bind(adapterWindow) : (typeof fetch === 'function' ? fetch : null);
  const normalizedMediaId = normalizeString(mediaId, '');
  if (!fetchFn || !normalizedMediaId) {
    return null;
  }
  const requestUrl = `/webfred/api/metadata/${encodeURIComponent(normalizedMediaId)}?deliveryType=eng`;
  const fetchOptions = { credentials: 'include' };
  if (options.cache) {
    fetchOptions.cache = options.cache;
  }
  const response = await withTemporaryWebfredSessionCookie(adapterWindow, options, async () => {
    let firstResponse = await fetchFn(requestUrl, fetchOptions);
    if (firstResponse && firstResponse.status === 404 && options.cache && options.cache !== 'reload') {
      firstResponse = await fetchFn(requestUrl, { credentials: 'include', cache: 'reload' });
    }
    return firstResponse;
  });
  if (!response || !response.ok) {
    return null;
  }
  return response.json();
}

function extractMediaInteractionsFromMetadata(metadata) {
  const directInteractions = [];
  const hotspotInteractions = [];
  const mediaById = new Map();

  function registerMedia(value, depth = 0) {
    if (depth > 8 || value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => registerMedia(item, depth + 1));
      return;
    }
    if (!isPlainObject(value)) {
      return;
    }
    const src = normalizeString(
      value.src || value.url || value.href || value.path || value.file || value.fileName || value.filename || value.resourceUrl || value.resource,
      ''
    );
    const id = normalizeString(value.id || value.mediaId || value.mediaID || value.assetId || value.assetID || value.contentId || value.contentID, '');
    if (src && isCacheableResourceUrl(src)) {
      if (id) {
        mediaById.set(id, src);
      }
      directInteractions.push(Object.freeze({ src, id, label: normalizeString(value.label || value.name || value.title || value.description, '') }));
    }
    Object.values(value).forEach((child) => registerMedia(child, depth + 1));
  }

  function mediaSrcFor(value) {
    if (typeof value === 'string') {
      return isCacheableResourceUrl(value) ? value : (mediaById.get(value) || '');
    }
    if (!isPlainObject(value)) {
      return '';
    }
    const direct = normalizeString(value.src || value.url || value.href || value.path || value.file || value.fileName || value.filename || value.resourceUrl || value.resource, '');
    if (direct && isCacheableResourceUrl(direct)) {
      return direct;
    }
    const id = normalizeString(value.id || value.mediaId || value.mediaID || value.assetId || value.assetID || value.contentId || value.contentID, '');
    return id ? (mediaById.get(id) || '') : '';
  }

  function visitHotspot(value, depth = 0) {
    if (depth > 10 || value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visitHotspot(item, depth + 1));
      return;
    }
    if (!isPlainObject(value)) {
      return;
    }
    const shape = normalizeString(value.shape || value.areaShape || value.type, '');
    const coords = normalizeString(value.coords || value.coordinates || value.areaCoords, '');
    const label = normalizeString(value.label || value.name || value.title || value.description || value.caption, '');
    const image = mediaSrcFor(value.diagramMedia || value.imageMedia || value.posterMedia || value.image || value.diagram || value.poster || value.background);
    const media = mediaSrcFor(value.contentMedia || value.audioMedia || value.videoMedia || value.soundMedia || value.media || value.content || value.video || value.audio || value.sound);
    if (media || image || coords) {
      hotspotInteractions.push(Object.freeze({ src: media, image, shape, coords, label }));
    }
    Object.values(value).forEach((child) => visitHotspot(child, depth + 1));
  }

  registerMedia(metadata);
  visitHotspot(metadata);
  const preferred = hotspotInteractions.length ? hotspotInteractions : directInteractions;
  return preferred.filter((interaction) => interaction.src || interaction.image || interaction.coords || interaction.shape || interaction.label);
}

function extractResourceUrlsFromMediaMetadata(metadata) {
  const urls = [];
  const seen = [];
  function visit(value, depth = 0) {
    if (depth > 12 || value === null || value === undefined) {
      return;
    }
    if (typeof value === 'string') {
      if (isCacheableResourceUrl(value)) {
        urls.push(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (!isPlainObject(value) || seen.includes(value)) {
      return;
    }
    seen.push(value);
    Object.entries(value).forEach(([key, child]) => {
      if (/^(?:src|url|href|poster)$/i.test(key) && typeof child === 'string' && isCacheableResourceUrl(child)) {
        urls.push(child);
        return;
      }
      visit(child, depth + 1);
    });
  }
  visit(metadata);
  return uniqueNormalizedStrings(urls);
}

async function extractMediaResourceUrlsForHtml(adapterWindow, html, options = {}) {
  const urls = [];
  const mediaIds = extractMediaMetadataIdsFromHtml(html);
  for (const mediaId of mediaIds) {
    try {
      const metadata = await fetchMediaMetadata(adapterWindow, mediaId, options);
      urls.push(...extractResourceUrlsFromMediaMetadata(metadata));
    } catch (_error) {}
  }
  return uniqueNormalizedStrings(urls);
}

async function extractMediaInteractionsForHtml(adapterWindow, html, options = {}) {
  const entries = [];
  const mediaIds = extractMediaMetadataIdsFromHtml(html);
  for (const mediaId of mediaIds) {
    try {
      const metadata = await fetchMediaMetadata(adapterWindow, mediaId, options);
      const interactions = extractMediaInteractionsFromMetadata(metadata).map((interaction, index) => Object.freeze({
        mediaId,
        index: index + 1,
        ...interaction,
      }));
      entries.push(...interactions);
    } catch (_error) {}
  }
  return Object.freeze(entries);
}

export {
  DEFAULT_MAX_RESOURCE_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
  normalizeResourceUrl,
  isCacheableResourceUrl,
  inferContentTypeFromUrl,
  fetchResourceDataUrl,
  fetchResourceDataByUrl,
  extractResourceUrlsFromCssText,
  extractResourceUrlsFromHtml,
  extractMediaMetadataIdsFromHtml,
  fetchMediaMetadata,
  extractMediaInteractionsFromMetadata,
  extractResourceUrlsFromMediaMetadata,
  extractMediaResourceUrlsForHtml,
  extractMediaInteractionsForHtml,
};
