const axios = require('axios');
require('dotenv').config();
const apiKey = process.env.SCOPUS_API_KEY;
const authorId = '57170217300';
const url = `https://api.elsevier.com/content/search/scopus?query=AU-ID(${authorId})&count=20`;

axios.get(url, { headers: { 'X-ELS-APIKey': apiKey, 'Accept': 'application/json' } })
    .then(res => {
        const results = res.data['search-results'];
        const entries = results?.entry || [];
        if (entries.length > 0) {
            console.log('Link structure:', JSON.stringify(entries[0]['link'], null, 2));
            console.log('Unique subtype descriptions in top 20:');
            const subtypes = new Set();
            entries.forEach(e => {
                subtypes.add(`${e.subtype} - ${e.subtypeDescription}`);
            });
            console.log(Array.from(subtypes));
        }
    })
    .catch(console.error);
