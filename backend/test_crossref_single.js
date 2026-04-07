const https = require('https');

const fetchDateFromCrossref = (doi) => {
    return new Promise((resolve) => {
        const cleanDoi = String(doi).trim();
        const url = `https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`;

        https.get(url, { headers: { 'User-Agent': 'ShardaResearchPortal/1.0 (mailto:research@sharda.ac.in)' } }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const message = json.message;
                    if (!message) return resolve(null);

                    console.log("Crossref Data for DOI", doi);
                    console.log("first_online assertion:", JSON.stringify(message.assertion?.filter(a => a.name === 'first_online'), null, 2));
                    console.log("published-online:", JSON.stringify(message['published-online'], null, 2));
                    console.log("published-print:", JSON.stringify(message['published-print'], null, 2));
                    console.log("issued:", JSON.stringify(message['issued'], null, 2));
                    console.log("created:", JSON.stringify(message['created'], null, 2));
                    console.log("deposited:", JSON.stringify(message['deposited'], null, 2));

                    resolve(json);
                } catch (e) {
                    console.error(e);
                    resolve(null);
                }
            });
        }).on('error', () => {
            resolve(null);
        });
    });
};

fetchDateFromCrossref('10.1007/s42979-025-04152-5');
