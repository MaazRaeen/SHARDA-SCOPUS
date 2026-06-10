const https = require('https');
require('dotenv').config();
const apiKey = process.env.SCOPUS_API_KEY;
const authorId = '57170217300';
const url = `https://api.elsevier.com/content/author/author_id/${authorId}?view=ENHANCED`;

https.get(url, { headers: { 'X-ELS-APIKey': apiKey, 'Accept': 'application/json' } }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
        try {
            const parsed = JSON.parse(data);
            const str = JSON.stringify(parsed, null, 2);
            
            // Search for case-insensitive h-index or hindex
            const hIndexMatches = str.match(/"h-index".*|.*hindex.*/gi);
            console.log('H-Index Matches in JSON:', hIndexMatches);

            // Search for coauthor
            const coauthorMatches = str.match(/.*coauthor.*/gi);
            console.log('Coauthor Matches in JSON:', coauthorMatches);

            // Print the first 200 lines of JSON to see structure
            const lines = str.split('\n');
            console.log('--- Top of JSON structure ---');
            console.log(lines.slice(0, 150).join('\n'));
        } catch (e) {
            console.error(e);
        }
    });
});
