const https = require('https');
require('dotenv').config();
const apiKey = process.env.SCOPUS_API_KEY;
const authorId = '57170217300';
const url = `https://api.elsevier.com/content/author/author_id/${authorId}?view=ENHANCED`;

https.get(url, { headers: { 'X-ELS-APIKey': apiKey, 'Accept': 'application/json' } }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
        console.log(JSON.stringify(JSON.parse(data), null, 2));
    });
});
