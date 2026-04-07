const https = require('https');

/**
 * Updated fetchDateFromCrossref — matches paperController.js
 */
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

                    // 1. Check assertions for "first_online"
                    if (Array.isArray(message.assertion)) {
                        const firstOnline = message.assertion.find(a => a.name === 'first_online');
                        if (firstOnline && firstOnline.value) {
                            const parsed = new Date(firstOnline.value);
                            if (!isNaN(parsed.getTime())) {
                                const y = parsed.getFullYear();
                                const m = parsed.getMonth() + 1;
                                const d = parsed.getDate();
                                return resolve(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
                            }
                        }
                    }

                    // 2. Collect candidates
                    const allCandidates = [
                        { src: 'published-online', parts: message['published-online']?.['date-parts']?.[0], priority: 1 },
                        { src: 'published-print', parts: message['published-print']?.['date-parts']?.[0], priority: 2 },
                        { src: 'issued', parts: message['issued']?.['date-parts']?.[0], priority: 3 },
                        { src: 'created', parts: message['created']?.['date-parts']?.[0], priority: 4 },
                        { src: 'deposited', parts: message['deposited']?.['date-parts']?.[0], priority: 5 },
                    ].filter(c => c.parts && c.parts.length > 0);

                    if (allCandidates.length > 0) {
                        // Find the earliest official publication year to guard against retro-digitization metadata dates
                        let officialYear = 9999;
                        for (const c of allCandidates) {
                            if ((c.src === 'issued' || c.src === 'published-print' || c.src === 'published-online') && c.parts[0] < officialYear) {
                                officialYear = c.parts[0];
                            }
                        }

                        // Filter out 'created' and 'deposited' if they are clearly administrative dates way after publication
                        const validCandidates = allCandidates.filter(c => {
                            if (c.src === 'created' || c.src === 'deposited') {
                                if (officialYear !== 9999 && c.parts[0] > officialYear + 1) return false;
                            }
                            return true;
                        });

                        validCandidates.sort((a, b) => {
                            // 1. Prefer higher precision (Y-M-D > Y-M > Y)
                            if (a.parts.length !== b.parts.length) {
                                return b.parts.length - a.parts.length;
                            }
                            // 2. If same precision, prefer higher priority (online > print > issued)
                            return a.priority - b.priority;
                        });

                        if (validCandidates.length > 0) {
                            const best = fmtParts(validCandidates[0].parts);
                            if (best) return resolve(best);
                        }
                    }

                    resolve(null);
                } catch (e) {
                    console.error(`Error parsing response for ${doi}:`, e.message);
                    resolve(null);
                }
            });
        }).on('error', (e) => {
            console.error(`HTTP error for ${doi}:`, e.message);
            resolve(null);
        });
    });
};

async function runTests() {
    const testDois = [
        '10.1007/978-981-96-3460-6_9',  // Was returning 2025-01-01, should now get 2025-05-30
        '10.1007/978-981-96-3460-6_12', // Same book, should also get assertion date
        '10.1101/2020.04.14.040626',
        '10.1016/j.matpr.2021.05.470',
        '10.1109/ICDT61202.2024.10488968',   // Known to work (full date in issued)
    ];

    console.log('--- Testing IMPROVED Crossref Date Fetching ---\n');
    for (const doi of testDois) {
        console.log(`DOI: ${doi}`);
        const date = await fetchDateFromCrossref(doi);
        console.log(`  => Date: ${date}`);
        console.log('');
    }
}

runTests();
