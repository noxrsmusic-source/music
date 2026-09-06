const CryptoJS = require("crypto-js");

function decryptSaavnMediaUrl(encryptedUrl) {
  try {
    if (!encryptedUrl) return "";
    const key = CryptoJS.enc.Utf8.parse("38346591");
    const decrypted = CryptoJS.DES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(encryptedUrl) },
      key,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
    let decUrl = decrypted.toString(CryptoJS.enc.Utf8);
    return decUrl.replace("_96.mp4", "_320.mp4").replace("_160.mp4", "_320.mp4");
  } catch (err) {
    return "";
  }
}

function parseAccurateSingers(item) {
  let accurateArtist = "";
  const mi = item.more_info;

  if (mi) {
    if (mi.artistMap && Array.isArray(mi.artistMap.artists)) {
      const singersOnly = mi.artistMap.artists
        .filter((a) => a.role && a.role.toLowerCase().includes("singer"))
        .map((a) => a.name);
      if (singersOnly.length > 0) accurateArtist = singersOnly.join(", ");
    }
    if (!accurateArtist && mi.artistMap && Array.isArray(mi.artistMap.primary_artists) && mi.artistMap.primary_artists.length > 0) {
      accurateArtist = mi.artistMap.primary_artists.map((a) => a.name).join(", ");
    }
    if (!accurateArtist && item.subtitle && typeof item.subtitle === "string") {
      accurateArtist = item.subtitle;
    }
    if (!accurateArtist && mi.singers && typeof mi.singers === "string") {
      accurateArtist = mi.singers;
    }
  }

  if (!accurateArtist) accurateArtist = item.subtitle || item.singers || "Bollywood Artist";

  return accurateArtist
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const query = req.query.query || req.query.q;
  if (!query) {
    return res.status(400).json({ error: "Query parameter required" });
  }

  const cleanQuery = encodeURIComponent(query.trim());
  
  // High-reliability search API endpoints
  const targetUrl = `https://www.jiosaavn.com/api.php?__call=search.getMoreResults&q=${cleanQuery}&_format=json&_marker=0&ctx=web60&p=1&n=20`;

  try {
    const apiRes = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*"
      },
    });

    const raw = await apiRes.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      data = eval("(" + raw + ")");
    }

    let rawList = [];
    if (data && Array.isArray(data.results)) {
      rawList = data.results;
    } else if (data && data.songs && Array.isArray(data.songs.data)) {
      rawList = data.songs.data;
    } else if (Array.isArray(data)) {
      rawList = data;
    }

    const results = rawList
      .map((item) => {
        let streamUrl = "";
        if (item.more_info && item.more_info.encrypted_media_url) {
          streamUrl = decryptSaavnMediaUrl(item.more_info.encrypted_media_url);
        } else if (item.encrypted_media_url) {
          streamUrl = decryptSaavnMediaUrl(item.encrypted_media_url);
        }

        let coverImg = (item.image || "").replace("150x150", "500x500");
        if (!coverImg) coverImg = "https://placehold.co/300x300/161622/ffffff?text=Music";

        const cleanTitle = (item.title || item.song || "Untitled")
          .replace(/&quot;/g, '"')
          .replace(/&#039;/g, "'")
          .replace(/&amp;/g, "&");

        const durationSec = item.more_info ? parseInt(item.more_info.duration || 210) : 210;

        return {
          id: item.id || Math.random().toString(),
          title: cleanTitle,
          artist: parseAccurateSingers(item),
          genre: item.language ? item.language : "Hindi",
          coverUrl: coverImg,
          audioUrl: streamUrl,
          duration: durationSec,
        };
      })
      .filter((s) => s.audioUrl && s.audioUrl.startsWith("http"));

    return res.status(200).json({ results });
  } catch (error) {
    return res.status(500).json({ error: "Backend fetch failed", details: error.message });
  }
};
