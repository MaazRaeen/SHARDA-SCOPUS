// update_specific_date.js
require('dotenv').config();
const mongoose = require('mongoose');
const https = require('https');
const ShardaAuthor = require('./models/ShardaAuthor');

const TARGET_DOI = '10.1007/978-3-030-66218-9_26';

const fetchDateFromCrossref = (doi) => {
    return new Promise((resolve) => {
        const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
        https.get(url, { headers: { 'User-Agent': 'ShardaResearchPortal/1.0 (mailto:research@sharda.ac.in)' } }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const message = JSON.parse(data).message;
                    // Prefer first_online assertion
                    if (Array.isArray(message.assertion)) {
                        const firstOnline = message.assertion.find(a => a.name === 'first_online');
                        if (firstOnline && firstOnline.value) {
                            const parsed = new Date(firstOnline.value);
                            if (!isNaN(parsed.getTime())) {
                                const y = parsed.getFullYear();
                                const m = String(parsed.getMonth() + 1).padStart(2, '0');
                                const d = String(parsed.getDate()).padStart(2, '0');
                                return resolve(`${y}-${m}-${d}`);
                            }
                        }
                    }
                    // Fallback to published-online or published-print
                    if (message['published-online'] && message['published-online']['date-parts']) {
                        const parts = message['published-online']['date-parts'][0];
                        const y = parts[0];
                        const m = String(parts[1] || 1).padStart(2, '0');
                        const d = String(parts[2] || 1).padStart(2, '0');
                        return resolve(`${y}-${m}-${d}`);
                    }
                    if (message['published-print'] && message['published-print']['date-parts']) {
                        const parts = message['published-print']['date-parts'][0];
                        const y = parts[0];
                        const m = String(parts[1] || 1).padStart(2, '0');
                        const d = String(parts[2] || 1).padStart(2, '0');
                        return resolve(`${y}-${m}-${d}`);
                    }
                    resolve(null);
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
};

(async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const author = await ShardaAuthor.findOne({ doi: TARGET_DOI });
        if (!author) {
            console.log('No record found for DOI', TARGET_DOI);
            process.exit(0);
        }
        const pubDate = await fetchDateFromCrossref(TARGET_DOI);
        if (pubDate) {
            author.publicationDate = pubDate;
            await author.save();
            console.log('Updated publicationDate to', pubDate);
        } else {
            console.log('Could not fetch date for DOI', TARGET_DOI);
        }
    } catch (err) {
        console.error('Error:', err);
    } finally {
        mongoose.disconnect();
    }
})();
