const https = require('https');

const doi = '10.1007/978-981-96-3460-6_9';
const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;

https.get(url, { headers: { 'User-Agent': 'ShardaResearchPortal/1.0 (mailto:research@sharda.ac.in)' } }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log(JSON.stringify(json, null, 2));
        } catch (e) {
            console.error('Error parsing response:', e.message);
            console.log('Raw Data:', data);
        }
    });
}).on('error', (e) => {
    console.error('HTTP Error:', e.message);
});
