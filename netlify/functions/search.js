const fetch = require('node-fetch');

exports.handler = async function(event) {
  const query = event.queryStringParameters.query || 'Trending';

  try {
    const saavnUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_marker=0&q=${encodeURIComponent(query)}&p=1&n=25&_format=json&ctx=web6dot0`;

    const response = await fetch(saavnUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://www.jiosaavn.com/'
      }
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET"
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
