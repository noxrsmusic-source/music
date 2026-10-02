/* ============================================================
 *  VERCEL SERVERLESS API — /api/lyrics
 *  Architecture: Firebase → LRCLIB → Firebase (cache)
 *  ONLY synced lyrics accepted. Plain lyrics never stored.
 *  Supports title-only fallback for placeholder artists.
 * ============================================================ */

const admin = require('firebase-admin');

/* ---- Firebase Admin init (only once) ---- */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    })
  });
}
const db = admin.firestore();

/* ============================================================
 *  HELPERS
 * ============================================================ */

/* Normalize a string for key generation */
function normalizeStr(s){
  return String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s*[-–|]\s*(from|feat\.?|ft\.?).*$/i, '')
    .replace(/&quot;/g, '')
    .replace(/&#039;/g, '')
    .replace(/&amp;/g, 'and')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Deterministic Firestore doc ID from artist + title */
function makeSongKey(artist, title){
  const a = normalizeStr(artist).replace(/\s+/g, '_') || 'unknown';
  const t = normalizeStr(title).replace(/\s+/g, '_') || 'untitled';
  return `${a}__${t}`.slice(0, 240);
}

/* Validate LRC — must have at least 2 timestamps */
function hasValidSyncedLyrics(lrc){
  if (!lrc || typeof lrc !== 'string') return false;
  const matches = lrc.match(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/g);
  return !!matches && matches.length >= 2;
}

/* Detect placeholder artist names (JioSaavn uses these) */
function isPlaceholderArtist(name){
  if (!name) return true;
  const n = String(name).toLowerCase().trim();
  const bad = [
    'bollywood artist', 'unknown artist', 'artist', 'various artists',
    'hindi artist', 'punjabi artist', 'unknown', 'dj', 'remix',
    'music', 'song', 'audio', 'bollywood', 'hindi', 'punjabi'
  ];
  if (bad.includes(n)) return true;
  if (n.length < 3) return true;
  return false;
}

/* Duration similarity 0..1 */
function durationScore(a, b){
  if (!a || !b) return 0;
  const diff = Math.abs(a - b);
  if (diff <= 2) return 1;
  if (diff <= 5) return 0.8;
  if (diff <= 10) return 0.5;
  if (diff <= 20) return 0.2;
  return 0;
}

/* ============================================================
 *  LRCLIB SEARCH
 * ============================================================ */
async function searchLRCLIB({ track_name, artist_name, q }){
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (track_name) params.set('track_name', track_name);
  if (artist_name) params.set('artist_name', artist_name);

  const url = 'https://lrclib.net/api/search?' + params.toString();
  try {
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
    console.error('[LRCLIB] search failed:', url, e);
    return [];
  }
}

/* Pick the best matching track from LRCLIB results */
function pickBestMatch(results, targetTitle, targetArtist, targetDuration){
  if (!Array.isArray(results) || !results.length) return null;

  const normTitle = normalizeStr(targetTitle);
  const normArtist = normalizeStr(targetArtist);
  const artistIsPlaceholder = isPlaceholderArtist(targetArtist);

  let best = null;
  let bestScore = 0;

  for (const c of results){
    if (!c || !c.syncedLyrics || !hasValidSyncedLyrics(c.syncedLyrics)) continue;

    const cTitle = normalizeStr(c.trackName || c.name || '');
    const cArtist = normalizeStr(c.artistName || '');
    const cDuration = c.duration || 0;

    let score = 0;

    /* Title similarity */
    if (cTitle === normTitle) score += 50;
    else if (cTitle && normTitle && (cTitle.includes(normTitle) || normTitle.includes(cTitle))) score += 25;

    /* Artist similarity — less weight if placeholder */
    if (!artistIsPlaceholder){
      if (cArtist === normArtist) score += 50;
      else if (cArtist && normArtist && (cArtist.includes(normArtist) || normArtist.includes(cArtist))) score += 25;
    }

    /* Duration bonus */
    if (targetDuration && cDuration){
      score += durationScore(targetDuration, cDuration) * 30;
    }

    if (score > bestScore){
      bestScore = score;
      best = c;
    }
  }

  /* Reject clearly unrelated matches (unless we searched title-only) */
  const minScore = artistIsPlaceholder ? 30 : 40;
  if (!best || bestScore < minScore) return null;
  return best;
}

/* ============================================================
 *  MAIN HANDLER
 * ============================================================ */
module.exports = async (req, res) => {
  /* ---- CORS headers ---- */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET'){
    return res.status(405).json({ found: false, syncedLyrics: null, error: 'METHOD_NOT_ALLOWED' });
  }

  const { title, artist, duration } = req.query || {};

  /* Validate */
  if (!title || String(title).trim().length === 0){
    return res.status(400).json({ found: false, syncedLyrics: null, error: 'MISSING_TITLE' });
  }
  if (String(title).length > 300 || String(artist || '').length > 300){
    return res.status(400).json({ found: false, syncedLyrics: null, error: 'PARAMS_TOO_LONG' });
  }

  const safeTitle = String(title).trim();
  const safeArtist = String(artist || '').trim();
  const dur = parseInt(duration, 10) || 0;

  const artistIsPlaceholder = isPlaceholderArtist(safeArtist);
  const cacheKey = makeSongKey(safeArtist || 'unknown', safeTitle);

  /* ---------- 1. Firebase cache lookup ---------- */
  try {
    const doc = await db.collection('lyrics').doc(cacheKey).get();
    if (doc.exists){
      const data = doc.data() || {};
      if (data.syncedLyrics && hasValidSyncedLyrics(data.syncedLyrics)){
        return res.status(200).json({
          found: true,
          cached: true,
          source: 'firebase',
          title: data.title || safeTitle,
          artist: data.artist || safeArtist,
          album: data.album || '',
          duration: data.duration || dur,
          syncedLyrics: data.syncedLyrics
        });
      }
    }
  } catch (e){
    console.error('[lyrics] Firebase read error:', e);
  }

  /* ---------- 2. LRCLIB search attempts ---------- */

  let best = null;

  /* Attempt 1: search by real artist (if not placeholder) */
  if (!artistIsPlaceholder && safeArtist){
    const results = await searchLRCLIB({ track_name: safeTitle, artist_name: safeArtist });
    best = pickBestMatch(results, safeTitle, safeArtist, dur);
  }

  /* Attempt 2: title-only search (works when LRCLIB has unique title) */
  if (!best){
    console.log('[lyrics] Trying title-only search:', safeTitle);
    const results = await searchLRCLIB({ track_name: safeTitle });
    best = pickBestMatch(results, safeTitle, '', dur);
  }

  /* Attempt 3: free-text q= search (broader) */
  if (!best){
    const q = safeArtist && !artistIsPlaceholder ? `${safeTitle} ${safeArtist}` : safeTitle;
    console.log('[lyrics] Trying free-text q search:', q);
    const results = await searchLRCLIB({ q });
    best = pickBestMatch(results, safeTitle, safeArtist, dur);
  }

  /* Attempt 4: cleaned title (strip "| Coke Studio" etc.) */
  if (!best){
    const cleanedTitle = safeTitle.replace(/\s*\|\s*.*$/, '').trim();
    if (cleanedTitle && cleanedTitle !== safeTitle){
      console.log('[lyrics] Trying cleaned title:', cleanedTitle);
      const results = await searchLRCLIB({ track_name: cleanedTitle });
      best = pickBestMatch(results, cleanedTitle, safeArtist, dur);
    }
  }

  /* ---------- 3. Nothing found ---------- */
  if (!best || !hasValidSyncedLyrics(best.syncedLyrics)){
    return res.status(200).json({
      found: false,
      syncedLyrics: null,
      reason: 'SYNCED_LYRICS_UNAVAILABLE'
    });
  }

  /* ---------- 4. Save to Firebase ---------- */
  try {
    await db.collection('lyrics').doc(cacheKey).set({
      title: best.trackName || safeTitle,
      artist: best.artistName || safeArtist,
      album: best.albumName || '',
      duration: best.duration || dur,
      syncedLyrics: best.syncedLyrics,
      source: 'lrclib',
      sourceId: String(best.id || ''),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e){
    console.error('[lyrics] Firebase write error:', e);
  }

  /* ---------- 5. Return synced lyrics ---------- */
  return res.status(200).json({
    found: true,
    cached: false,
    source: 'lrclib',
    title: best.trackName || safeTitle,
    artist: best.artistName || safeArtist,
    album: best.albumName || '',
    duration: best.duration || dur,
    syncedLyrics: best.syncedLyrics
  });
};
