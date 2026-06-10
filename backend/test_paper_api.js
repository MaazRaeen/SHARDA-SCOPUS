const axios = require('axios');
require('dotenv').config();
const apiKey = process.env.SCOPUS_API_KEY;
const authorId = '57170217300';
const url = `https://api.elsevier.com/content/search/scopus?query=AU-ID(${authorId})&count=5`;

axios.get(url, { headers: { 'X-ELS-APIKey': apiKey, 'Accept': 'application/json' } })
    .then(res => {
        const results = res.data['search-results'];
        const entries = results?.entry || [];
        console.log('Number of entries:', entries.length);
        if (entries.length > 0) {
            console.log('Sample entry keys:', Object.keys(entries[0]));
            console.log('Sample entry fields:');
            console.log('title:', entries[0]['dc:title']);
            console.log('creator:', entries[0]['dc:creator']);
            console.log('publicationName:', entries[0]['prism:publicationName']);
            console.log('issn:', entries[0]['prism:issn']);
            console.log('eissn:', entries[0]['prism:eissn']);
            console.log('coverDate:', entries[0]['prism:coverDate']);
            console.log('subtypeDescription:', entries[0]['subtypeDescription']);
            console.log('subtype:', entries[0]['subtype']);
            console.log('citedby-count:', entries[0]['citedby-count']);
            console.log('doi:', entries[0]['prism:doi']);
            console.log('eid:', entries[0]['eid']);
            console.log('dc:identifier:', entries[0]['dc:identifier']);
            console.log('author:', entries[0]['author']);
        }
    })
    .catch(console.error);
