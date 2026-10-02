/* ============================================================
 *  /api/lyrics — Simple, no-Firebase version
 *  Only uses LRCLIB. Never crashes. Always sets CORS.
 * ============================================================ */

function normalizeStr(s){
  return String(s || '').toLowerCase()
    .replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '')
    .replace(/\s*[-–|]\s*(from|feat\.?|ft\.?).*$/i, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function isPlaceholderArtist(name){
  if (!name) return true;
  const n = String(name).toLowerCase().trim();
  const bad = ['bollywood artist','unknown artist','artist','various artists',
               'hindi artist','punjabi artist','unknown','dj','remix',
               'music','song','audio','bollywood','hindi','punjabi'];
  return bad.includes(n) || n.length < 3;
}

function hasValidLyrics(lrc){
  if (!lrc || typeof lrc !== 'string') return false;
  const m = lrc.match(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/g);
  return !!m && m.length >= 2;
}

async function lrclibSearch(params){
  try {
    const url = 'https://lrclib.net/api/search?' + new URLSearchParams(params).toString();
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'RXPlayer/1.0 (https://music-psi-sand.vercel.app)',
        'Accept': 'application/json'
      }
    });
    if (!r.ok) return [];
    const arr = await r.json();
    return Array.isArray(arr) ? arr : [];
  } catch (e){
    console.error('[lrclib] error:', e.message);
    return [];
  }
}

function pickBest(results, targetTitle, targetArtist){
  if (!Array.isArray(results) || !results.length) return null;
  const nT = normalizeStr(targetTitle);
  const nA = normalizeStr(targetArtist);
  const placeholder = isPlaceholderArtist(targetArtist);

  let best = null, bestScore = 0;
  for (const c of results){
    if (!c || !c.syncedLyrics || !hasValidLyrics(c.syncedLyrics)) continue;
    const cT = normalizeStr(c.trackName || c.name || '');
    const cA = normalizeStr(c.artistName || '');
    let score = 0;
    if (cT === nT) score += 50;
    else if (cT && nT && (cT.includes(nT) || nT.includes(cT))) score += 25;
    if (!placeholder){
      if (cA === nA) score += 50;
      else if (cA && nA && (cA.includes(nA) || nA.includes(cA))) score += 25;
    }
    if (score > bestScore){ bestScore = score; best = c; }
  }
  const min = placeholder ? 20 : 30;
  return bestScore >= min ? best : null;
}

module.exports = async (req, res) => {
  /* CORS headers FIRST */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(200).json({ found: false, syncedLyrics: null });
  }

  try {
    const { title, artist } = req.query || {};
    if (!title || !String(title).trim()) {
      return res.status(200).json({ found: false, syncedLyrics: null, reason: 'NO_TITLE' });
    }

    const safeTitle = String(title).trim().slice(0, 300);
    const safeArtist = String(artist || '').trim().slice(0, 300);
    const placeholder = isPlaceholderArtist(safeArtist);

    let best = null;

    /* Attempt 1: real artist + title */
    if (!placeholder && safeArtist) {
      const r = await lrclibSearch({ track_name: safeTitle, artist_name: safeArtist });
      best = pickBest(r, safeTitle, safeArtist);
    }

    /* Attempt 2: title only */
    if (!best) {
      const r = await lrclibSearch({ track_name: safeTitle });
      best = pickBest(r, safeTitle, '');
    }

    /* Attempt 3: cleaned title */
    if (!best) {
      const cleaned = safeTitle.replace(/\s*[|]\s*.*$/, '').trim();
      if (cleaned && cleaned !== safeTitle) {
        const r = await lrclibSearch({ track_name: cleaned });
        best = pickBest(r, cleaned, safeArtist);
      }
    }

    /* Attempt 4: free-text q= */
    if (!best) {
      const q = safeArtist && !placeholder ? `${safeTitle} ${safeArtist}` : safeTitle;
      const r = await lrclibSearch({ q });
      best = pickBest(r, safeTitle, safeArtist);
    }

    if (!best || !hasValidLyrics(best.syncedLyrics)) {
      return res.status(200).json({
        found: false, syncedLyrics: null, reason: 'SYNCED_LYRICS_UNAVAILABLE'
      });
    }

    return res.status(200).json({
      found: true,
      source: 'lrclib',
      title: best.trackName || safeTitle,
      artist: best.artistName || safeArtist,
      album: best.albumName || '',
      duration: best.duration || 0,
      syncedLyrics: best.syncedLyrics
    });

  } catch (e) {
    console.error('[lyrics] FATAL:', e);
    return res.status(200).json({
      found: false, syncedLyrics: null, reason: 'INTERNAL_ERROR', error: e.message
    });
  }
};
