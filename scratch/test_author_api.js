const https = require('https');
require('dotenv').config({ path: '../backend/.env' });
const apiKey = process.env.SCOPUS_API_KEY;
const authorId = '57170217300';
const url = `https://api.elsevier.com/content/author/author_id/${authorId}?view=ENHANCED`;

https.get(url, { headers: { 'X-ELS-APIKey': apiKey, 'Accept': 'application/json' } }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
        try {
            const parsed = JSON.parse(data);
            const response = parsed['author-retrieval-response']?.[0];
            if (!response) {
                console.log('No response content');
                console.log(parsed);
                return;
            }
            console.log('Coredata keys:', Object.keys(response['coredata'] || {}));
            console.log('Coredata values of interest:');
            console.log('document-count:', response['coredata']?.[ 'document-count']);
            console.log('cited-by-count:', response['coredata']?.[ 'cited-by-count']);
            console.log('citation-count:', response['coredata']?.[ 'citation-count']);
            console.log('h-index:', response['coredata']?.[ 'h-index']);
            console.log('coauthor-count:', response['coredata']?.[ 'coauthor-count']);
            console.log('author-profile keys:', Object.keys(response['author-profile'] || {}));
            console.log('subject-areas:', response['subject-areas']);
        } catch (e) {
            console.error(e);
        }
    });
});
