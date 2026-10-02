module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const title = (req.query.title || "").trim();
  const artist = (req.query.artist || "").trim();

  if (!title || !artist) {
    return res.status(400).json({
      error: "title and artist are required"
    });
  }

  try {
    const params = new URLSearchParams({
      track_name: title,
      artist_name: artist
    });

    const response = await fetch(
      `https://lrclib.net/api/get?${params.toString()}`,
      {
        headers: {
          "User-Agent": "RX-Player/1.0"
        }
      }
    );

    if (!response.ok) {
      return res.status(404).json({
        found: false,
        syncedLyrics: null
      });
    }

    const data = await response.json();

    // We ONLY want synced lyrics
    if (!data.syncedLyrics) {
      return res.status(404).json({
        found: false,
        syncedLyrics: null
      });
    }

    return res.status(200).json({
      found: true,
      title: data.trackName || title,
      artist: data.artistName || artist,
      album: data.albumName || "",
      duration: data.duration || null,
      syncedLyrics: data.syncedLyrics
    });

  } catch (error) {
    console.error("Lyrics error:", error);

    return res.status(500).json({
      error: "Lyrics service unavailable"
    });
  }
};
