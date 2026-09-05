const https = require('https');

exports.handler = async (event) => {
  // CORS Headers har haal mein return honge
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };

  // Browser preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  const query = (event.queryStringParameters && event.queryStringParameters.query)
    ? event.queryStringParameters.query
    : 'Kesariya';

  const saavnUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_marker=0&q=${encodeURIComponent(query)}&p=1&n=25&_format=json&ctx=web6dot0`;

  return new Promise((resolve) => {
    const req = https.get(saavnUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.jiosaavn.com/'
      }
    }, (res) => {
      let rawData = '';
      res.on('data', chunk => { rawData += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: 200,
          headers,
          body: rawData
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: err.message })
      });
    });

    req.setTimeout(8000, () => {
      req.abort();
      resolve({
        statusCode: 504,
        headers,
        body: JSON.stringify({ error: 'Request timeout' })
      });
    });
  });
};
