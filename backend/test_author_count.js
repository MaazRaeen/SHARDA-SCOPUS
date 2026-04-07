const https = require('https');
require('dotenv').config();

const apiKey = process.env.SCOPUS_API_KEY;
const affilId = "60108680";
const url = `https://api.elsevier.com/content/search/author?query=AF-ID(${affilId})&count=1&apiKey=${apiKey}`;

https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            console.log("Raw Response Data:", data);
            const json = JSON.parse(data);
            if (json['search-results']) {
                console.log("Total Results (Authors):", json['search-results']['opensearch:totalResults']);
            } else {
                console.log("No search-results found", json);
            }
        } catch (e) {
            console.error("Parse Error:", e.message);
        }
    });
}).on('error', (e) => {
    console.error("HTTP Error:", e.message);
});
