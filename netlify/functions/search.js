// Built-in HTTPS module (No npm install required, 100% crash-proof on Netlify)
const https = require('https');

exports.handler = async function(event) {
  const query = (event.queryStringParameters && event.queryStringParameters.query) 
    ? event.queryStringParameters.query 
    : 'Trending';

  const saavnUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_marker=0&q=${encodeURIComponent(query)}&p=1&n=25&_format=json&ctx=web6dot0`;

  return new Promise((resolve) => {
    https.get(saavnUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.jiosaavn.com/'
      }
    }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve({
          statusCode: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET",
            "Content-Type": "application/json"
          },
          body: data
        });
      });
    }).on('error', (err) => {
      resolve({
        statusCode: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ error: err.message })
      });
    });
  });
};
