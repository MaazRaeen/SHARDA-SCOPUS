require('dotenv').config();
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');
// Import the modified controller functions (simulated here for direct test)
const https = require('https');

const fetchDateFromCrossref = (doi) => {
    return new Promise((resolve) => {
        if (!doi) return resolve(null);
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

                    const fmtParts = (parts) => {
                        if (!parts || parts.length === 0) return null;
                        const y = parts[0];
                        if (y <= 1900 || y >= 2100) return null;
                        const m = parts[1] || 1;
                        const d = parts[2] || 1;
                        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    };

                    if (Array.isArray(message.assertion)) {
                        const firstOnline = message.assertion.find(a => a.name === 'first_online');
                        if (firstOnline && firstOnline.value) {
                            const parsed = new Date(firstOnline.value);
                            if (!isNaN(parsed.getTime())) {
                                const y = parsed.getFullYear();
                                const m = parsed.getMonth() + 1;
                                const d = parsed.getDate();
                                return resolve({
                                    date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
                                    title: message.title ? message.title[0] : null,
                                    year: y
                                });
                            }
                        }
                    }

                    const candidates = [
                        { src: 'published-print', parts: message['published-print']?.['date-parts']?.[0], priority: 1 },
                        { src: 'published-online', parts: message['published-online']?.['date-parts']?.[0], priority: 2 },
                        { src: 'issued', parts: message['issued']?.['date-parts']?.[0], priority: 3 },
                        { src: 'created', parts: message['created']?.['date-parts']?.[0], priority: 4 },
                        { src: 'deposited', parts: message['deposited']?.['date-parts']?.[0], priority: 5 },
                    ].filter(c => c.parts && c.parts.length > 0);

                    if (candidates.length > 0) {
                        candidates.sort((a, b) => {
                            if (a.priority !== b.priority) return a.priority - b.priority;
                            return b.parts.length - a.parts.length;
                        });

                        const bestParts = candidates[0].parts;
                        const bestDate = fmtParts(bestParts);
                        if (bestDate) {
                            return resolve({
                                date: bestDate,
                                title: message.title ? message.title[0] : null,
                                year: bestParts[0]
                            });
                        }
                    }
                    resolve(null);
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', (e) => {
            resolve(null);
        });
    });
};

async function verifyFix() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const doi = "10.1016/j.matpr.2021.05.470";
        console.log(`Enriching DOI: ${doi}...`);

        const crossrefData = await fetchDateFromCrossref(doi);

        if (crossrefData) {
            console.log('Fetched Crossref Data:', crossrefData);

            const updateData = {
                publicationDate: crossrefData.date
            };
            if (crossrefData.year) updateData.year = crossrefData.year;
            if (crossrefData.title) updateData.paperTitle = crossrefData.title;

            await ShardaAuthor.updateMany(
                { doi: { $regex: new RegExp(`^${doi.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
                { $set: updateData }
            );
            console.log('Database updated.');

            const updatedPaper = await ShardaAuthor.findOne({ doi: { $regex: new RegExp(`^${doi.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
            console.log('Updated Record in DB:');
            console.log(JSON.stringify(updatedPaper, null, 2));
        } else {
            console.log('No data found from Crossref.');
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

verifyFix();
