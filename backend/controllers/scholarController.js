const SerpApi = require('google-search-results-nodejs');
const User = require('../models/User');

// Extract author_id from a Google Scholar profile URL
function extractScholarId(url) {
    if (!url) return '';
    try {
        const u = new URL(url);
        return u.searchParams.get('user') || '';
    } catch {
        return '';
    }
}

// Call SerpAPI and return { totalPapers, citations, hIndex }
// Paginates through ALL pages to get the real total paper count.
async function fetchFromSerpApi(scholarId) {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) throw new Error('SERPAPI_KEY not set in .env');

    const { SerpApiSearch } = require('google-search-results-nodejs');
    const PAGE_SIZE = 20;

    // Helper: fetch one page as a Promise
    const fetchPage = (start) => new Promise((resolve, reject) => {
        const client = new SerpApiSearch(apiKey);
        client.json(
            {
                engine: 'google_scholar_author',
                author_id: scholarId,
                api_key: apiKey,
                start,
                num: PAGE_SIZE
            },
            (data) => {
                if (data.error) return reject(new Error(data.error));
                resolve(data);
            }
        );
    });

    // --- Fetch page 0 first to get citations/hIndex + article count ---
    const firstPage = await fetchPage(0);

    const cited = firstPage.cited_by || {};
    const citedTable = cited.table || [];
    const allCitations = citedTable.find(r => r.citations)?.citations?.all ?? null;
    const hIndex = citedTable.find(r => r.h_index)?.h_index?.all ?? null;

    const firstArticles = firstPage.articles || [];
    let totalPapers = firstArticles.length;

    // --- Paginate until we get a page with fewer than PAGE_SIZE articles ---
    if (firstArticles.length === PAGE_SIZE) {
        let start = PAGE_SIZE;
        while (true) {
            const page = await fetchPage(start);
            const articles = page.articles || [];
            totalPapers += articles.length;

            if (articles.length < PAGE_SIZE) break; // last page
            start += PAGE_SIZE;
        }
    }

    return { totalPapers, citations: allCitations, hIndex };
}


// GET /api/papers/scholar/me
async function getMyScholarData(req, res) {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        if (!user.scholarId) {
            return res.json({ success: true, data: null, message: 'No Google Scholar profile linked.' });
        }

        const cache = user.scholarCache?.toObject ? user.scholarCache.toObject() : user.scholarCache;
        res.json({ success: true, data: { scholarUrl: user.scholarUrl, scholarId: user.scholarId, ...cache } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}

// POST /api/papers/scholar/refresh — max 2 refreshes per 24h
async function refreshScholarData(req, res) {
    try {
        const user = await User.findById(req.user.id);
        if (!user || !user.scholarId) {
            return res.status(400).json({ success: false, error: 'No Google Scholar profile linked.' });
        }

        // --- Rate limit: 2 refreshes per 24h window ---
        const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
        const MAX_REFRESHES = 2;
        const cache = user.scholarCache || {};
        const windowStart = cache.refreshWindowStart ? new Date(cache.refreshWindowStart).getTime() : 0;
        const now = Date.now();

        let refreshCount = cache.refreshCount || 0;

        if (now - windowStart < WINDOW_MS) {
            // Still within the same 24h window
            if (refreshCount >= MAX_REFRESHES) {
                const resetInMs = WINDOW_MS - (now - windowStart);
                const resetInHrs = Math.ceil(resetInMs / 3600000);
                return res.status(429).json({
                    success: false,
                    error: `Refresh limit reached (${MAX_REFRESHES}/24h). Try again in ${resetInHrs}h.`
                });
            }
            refreshCount += 1;
        } else {
            // New 24h window — reset counter
            refreshCount = 1;
        }
        // --------------------------------------------------

        const result = await fetchFromSerpApi(user.scholarId);
        user.scholarCache = {
            ...result,
            fetchedAt: new Date(),
            refreshCount,
            refreshWindowStart: windowStart && (now - windowStart < WINDOW_MS) ? new Date(windowStart) : new Date()
        };
        await user.save();

        res.json({
            success: true,
            data: { scholarUrl: user.scholarUrl, ...user.scholarCache },
            refreshesRemaining: MAX_REFRESHES - refreshCount
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}

// POST /api/papers/scholar/link — link or update scholar URL
async function linkScholarUrl(req, res) {
    try {
        const { scholarUrl } = req.body;
        const scholarId = extractScholarId(scholarUrl);

        if (!scholarId) {
            return res.status(400).json({ success: false, error: 'Invalid URL. Must contain ?user=XXXX' });
        }

        const user = await User.findById(req.user.id);
        user.scholarUrl = scholarUrl;
        user.scholarId = scholarId;
        user.scholarCache = { totalPapers: null, citations: null, hIndex: null, fetchedAt: null };
        await user.save();

        // Background fetch — don't block the response
        fetchFromSerpApi(scholarId)
            .then(result => User.findByIdAndUpdate(user._id, { scholarCache: { ...result, fetchedAt: new Date() } }).exec())
            .catch(err => console.error('[Scholar] Background fetch failed:', err.message));

        res.json({ success: true, message: 'Profile linked. Stats are being fetched in the background.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}

// Paginated fetch collecting ALL article objects (title, link, citedBy, year)
async function fetchAllArticles(scholarId) {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) throw new Error('SERPAPI_KEY not set in .env');

    const { SerpApiSearch } = require('google-search-results-nodejs');
    const PAGE_SIZE = 20;

    const fetchPage = (start) => new Promise((resolve, reject) => {
        const client = new SerpApiSearch(apiKey);
        client.json(
            { engine: 'google_scholar_author', author_id: scholarId, api_key: apiKey, start, num: PAGE_SIZE },
            (data) => {
                if (data.error) return reject(new Error(data.error));
                resolve(data);
            }
        );
    });

    const allArticles = [];
    let start = 0;
    while (true) {
        const page = await fetchPage(start);
        const articles = page.articles || [];
        articles.forEach(a => {
            allArticles.push({
                title: a.title || '',
                link: a.link || '',
                citedBy: a.cited_by?.value ?? 0,
                year: a.year || null
            });
        });
        if (articles.length < PAGE_SIZE) break;
        start += PAGE_SIZE;
    }
    return allArticles;
}

// GET /api/papers/scholar/articles — returns all Scholar articles for logged-in user
async function getScholarArticles(req, res) {
    try {
        const user = await User.findById(req.user.id);
        if (!user || !user.scholarId) {
            return res.status(400).json({ success: false, error: 'No Google Scholar profile linked.' });
        }
        const articles = await fetchAllArticles(user.scholarId);
        res.json({ success: true, data: articles, total: articles.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = { getMyScholarData, refreshScholarData, linkScholarUrl, extractScholarId, fetchFromSerpApi, getScholarArticles };
