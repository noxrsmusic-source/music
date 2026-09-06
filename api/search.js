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

function parseSingers(item) {
  if (item.artists && item.artists.primary && Array.isArray(item.artists.primary)) {
    return item.artists.primary.map(a => a.name).join(", ");
  }
  if (item.primaryArtists) return item.primaryArtists;
  if (item.singers) return item.singers;
  if (item.subtitle) return item.subtitle;
  return "Bollywood Artist";
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

  // Multi-tier fetch: Tier 1 Public Unofficial API -> Tier 2 JioSaavn Web Core
  const endpoints = [
    `https://saavn.dev/api/search/songs?query=${cleanQuery}&limit=20`,
    `https://jiosaavn-api-private-production.up.railway.app/search/songs?query=${cleanQuery}`,
    `https://www.jiosaavn.com/api.php?__call=search.getResults&q=${cleanQuery}&_format=json&_marker=0&api_version=4&ctx=web60&n=20&p=1`
  ];

  let rawList = [];

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*"
        }
      });

      if (response.ok) {
        const json = await response.json();
        
        if (json.data && Array.isArray(json.data.results) && json.data.results.length > 0) {
          rawList = json.data.results;
          break;
        } else if (json.data && Array.isArray(json.data) && json.data.length > 0) {
          rawList = json.data;
          break;
        } else if (json.results && Array.isArray(json.results) && json.results.length > 0) {
          rawList = json.results;
          break;
        }
      }
    } catch (err) {
      continue;
    }
  }

  const results = rawList.map((item) => {
    let streamUrl = "";
    
    // Check decrypted downloadUrl array first
    if (item.downloadUrl && Array.isArray(item.downloadUrl)) {
      const high = item.downloadUrl.find(d => d.quality === "320kbps") || item.downloadUrl[item.downloadUrl.length - 1];
      if (high) streamUrl = high.url || high.link;
    } else if (item.more_info && item.more_info.encrypted_media_url) {
      streamUrl = decryptSaavnMediaUrl(item.more_info.encrypted_media_url);
    } else if (item.encrypted_media_url) {
      streamUrl = decryptSaavnMediaUrl(item.encrypted_media_url);
    }

    let coverImg = "";
    if (item.image && Array.isArray(item.image)) {
      const best = item.image.find(i => i.quality === "500x500") || item.image[item.image.length - 1];
      coverImg = best ? (best.url || best.link) : "";
    } else if (typeof item.image === "string") {
      coverImg = item.image.replace("150x150", "500x500");
    }
    if (!coverImg) coverImg = "https://placehold.co/300x300/161622/ffffff?text=Music";

    const cleanTitle = (item.name || item.title || item.song || "Untitled")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, "&");

    const durationSec = item.duration ? parseInt(item.duration) : (item.more_info ? parseInt(item.more_info.duration || 210) : 210);

    return {
      id: item.id || Math.random().toString(),
      title: cleanTitle,
      artist: parseSingers(item),
      genre: item.language || "Hindi",
      coverUrl: coverImg,
      audioUrl: streamUrl,
      duration: durationSec
    };
  }).filter(s => s.audioUrl && s.audioUrl.startsWith("http"));

  return res.status(200).json({ results });
};
