const https = require('https');

const fetchDateFromCrossref = (doi) => {
    return new Promise((resolve) => {
        if (!doi) return resolve(null);
        const cleanDoi = String(doi).trim();
        const url = `https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`;

        console.log(`Fetching from: ${url}`);

        https.get(url, { headers: { 'User-Agent': 'ShardaResearchPortal/1.0 (mailto:research@sharda.ac.in)' } }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const message = json.message;
                    if (!message) {
                        console.log('No message in response');
                        return resolve(null);
                    }

                    console.log('Message received. Checking date fields...');

                    // --- Helper: format [Y, M, D] array to YYYY-MM-DD ---
                    const fmtParts = (parts) => {
                        if (!parts || parts.length === 0) return null;
                        const y = parts[0];
                        if (y <= 1900 || y >= 2100) return null;
                        const m = parts[1] || 1;
                        const d = parts[2] || 1;
                        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    };

                    // --- 1. Check assertions for "first_online" ---
                    if (Array.isArray(message.assertion)) {
                        const firstOnline = message.assertion.find(a => a.name === 'first_online');
                        if (firstOnline && firstOnline.value) {
                            console.log(`Found first_online assertion: ${firstOnline.value}`);
                            const parsed = new Date(firstOnline.value);
                            if (!isNaN(parsed.getTime())) {
                                const y = parsed.getFullYear();
                                const m = parsed.getMonth() + 1;
                                const d = parsed.getDate();
                                const result = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                                console.log(`Parsed result from assertion: ${result}`);
                                return resolve(result);
                            }
                        }
                    }

                    // --- 2. Collect all date-parts candidates ---
                    const candidates = [
                        { src: 'published-print', parts: message['published-print']?.['date-parts']?.[0] },
                        { src: 'published-online', parts: message['published-online']?.['date-parts']?.[0] },
                        { src: 'deposited', parts: message['deposited']?.['date-parts']?.[0] },
                        { src: 'issued', parts: message['issued']?.['date-parts']?.[0] },
                        { src: 'created', parts: message['created']?.['date-parts']?.[0] },
                    ].filter(c => c.parts && c.parts.length > 0);

                    console.log('Candidates found:', candidates.map(c => `${c.src}: [${c.parts}]`));

                    if (candidates.length > 0) {
                        candidates.sort((a, b) => b.parts.length - a.parts.length);
                        const best = fmtParts(candidates[0].parts);
                        if (best) {
                            console.log(`Best date found: ${best} from ${candidates[0].src}`);
                            return resolve(best);
                        }
                    }

                    resolve(null);
                } catch (e) {
                    console.error('Error parsing response:', e.message);
                    resolve(null);
                }
            });
        }).on('error', (e) => {
            console.error(`[CROSSREF] HTTP Error for DOI ${doi}:`, e.message);
            resolve(null);
        });
    });
};

const doi = "10.1016/j.matpr.2021.05.470";
fetchDateFromCrossref(doi).then(date => {
    console.log(`Final Result for ${doi}: ${date}`);
});
