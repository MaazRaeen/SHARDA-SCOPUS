const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Parser } = require('json2csv');
const stream = require('stream');
const https = require('https');
const ShardaAuthor = require('../models/ShardaAuthor');
const Teacher = require('../models/Teacher');
const JournalQuartile = require('../models/JournalQuartile');
const { matchNames, matchNamesStrict, standardizeDepartment } = require('../utils/nameMatcher');
const { resolveAuthorDepartment, manualOverrides } = require('../utils/departmentUtils');

const ConsolidatedPaper = require('../models/ConsolidatedPaper');
const SystemStat = require('../models/SystemStat');
const supabase = require('../config/db_supabase');

/**
 * Sync department aggregated data to Supabase/PostgreSQL
 * Creates table if not exists and upserts data
 * @param {Array} data - Aggregated department data
 */
async function syncToPostgres(data, syncPapers = false, institutionalTotal = 0) {
  try {
    const supabase = require('../config/db_supabase');
    const { apiKey } = process.env; 

    // 1. Sync Aggregated Stats
    const upsertData = data.map(dept => {
      const topAuthor = dept.authors?.[0] || { name: 'N/A', paperCount: 0 };
      return {
        department: dept.department,
        author_count: parseInt(dept.authorCount || 0),
        total_papers: parseInt(dept.totalPapers || 0),
        top_author_name: topAuthor.name || 'Unknown',
        top_author_papers: parseInt(topAuthor.paperCount || 0),
        last_updated: new Date().toISOString()
      };
    });

    // Add a special institutional total row
    if (institutionalTotal > 0) {
      upsertData.push({
        department: '[INSTITUTIONAL_CORE]',
        author_count: 0,
        total_papers: institutionalTotal,
        top_author_name: 'N/A',
        top_author_papers: 0,
        last_updated: new Date().toISOString()
      });
    }

    await supabase.from('department_api_stats').upsert(upsertData, { onConflict: 'department' });

    // 2. Sync Authors and Papers
    for (const dept of data) {
      if (!dept.authors || dept.authors.length === 0) continue;
      
      const authorData = dept.authors.map(a => ({
        department: dept.department,
        name: a.name,
        scopus_id: a.scopusId,
        paper_count: a.paperCount,
        last_updated: new Date().toISOString()
      }));

      await supabase.from('department_authors').delete().eq('department', dept.department);
      await supabase.from('department_authors').insert(authorData);

      // 3. Optional: Sync Top 100 Papers for this department (only if syncPapers is true)
      if (syncPapers) {
        console.log(`[POSTGRES] Syncing papers for ${dept.department}...`);
        const scopusIds = dept.authors.slice(0, 50).map(a => a.scopusId).filter(id => !!id);
        if (scopusIds.length > 0) {
          const queryIds = scopusIds.map(id => `AU-ID(${id})`).join(' OR ');
          const url = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent(`(${queryIds})`)}&count=100&sort=coverDate`;
          
          const paperResponse = await new Promise((resolve) => {
            https.get(url, { headers: { "X-ELS-APIKey": process.env.SCOPUS_API_KEY, "Accept": "application/json" } }, (res) => {
              let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(JSON.parse(d)));
            }).on("error", () => resolve({}));
          });

          const entries = paperResponse["search-results"]?.entry || [];
          const paperData = entries.map(e => ({
            department: dept.department,
            title: e["dc:title"] || 'Untitled',
            authors: e["dc:creator"] || 'Unknown',
            journal: e["prism:publicationName"] || 'N/A',
            year: e["prism:coverDate"] ? e["prism:coverDate"].substring(0, 4) : 'N/A',
            scopus_id: e["dc:identifier"]?.replace("SCOPUS_ID:", ""),
            last_updated: new Date().toISOString()
          }));

          await supabase.from('department_papers').delete().eq('department', dept.department);
          if (paperData.length > 0) {
            await supabase.from('department_papers').insert(paperData);
          }
        }
      }
    }
    return true;
  } catch (err) {
    console.error('[SUPABASE] Sync Logic Error:', err.message);
    throw err;
  }
}

// Global RAM Buffer to bypass Mongoose M0 2-minute fetch bandwidth limit on 9,000 docs
let globalPapersRAMBuffer = null;
let globalPapersRAMPromise = null;
let ramFetchGeneration = 0; // Tracks the current active fetch

const resetRAMBuffer = () => {
  globalPapersRAMBuffer = null;
  globalPapersRAMPromise = null;
  ramFetchGeneration++;
};

const getRAMBuffer = () => {
  // Return the existing buffer immediately if already loaded
  if (globalPapersRAMBuffer) {
    return Promise.resolve(globalPapersRAMBuffer);
  }

  // If a fetch is already in progress, wait for it
  if (globalPapersRAMPromise) {
    return globalPapersRAMPromise;
  }

  // Otherwise, start a new fetch and store the promise
  console.log('[CACHE] Starting load of ConsolidatedPapers into Node.js RAM Buffer...');
  const currentGen = ++ramFetchGeneration;

  globalPapersRAMPromise = (async () => {
    try {
      console.time('ramBufferLoad');
      const data = await ConsolidatedPaper.find({}).lean();

      // Only cache if a reset hasn't occurred while we were fetching
      if (currentGen === ramFetchGeneration) {
        globalPapersRAMBuffer = data;  // Cache the resolved array
        console.timeEnd('ramBufferLoad');
        console.log(`[CACHE] RAM Buffer loaded successfully with ${data.length} records.`);
      } else {
        console.log(`[CACHE] Discarding stale RAM buffer fetch (Gen ${currentGen} superseded by ${ramFetchGeneration}).`);
      }
      return data;
    } catch (err) {
      console.error('[CACHE] RAM Buffer load failed:', err);
      if (currentGen === ramFetchGeneration) {
        globalPapersRAMPromise = null; // Reset so next call tries again
      }
      return [];
    }
  })();

  return globalPapersRAMPromise;
};

// Multi-query cache for analytics with 5-minute TTL
const analyticsCacheMap = new Map();
const ANALYTICS_CACHE_TTL = 300000; // 5 minutes

// Live API Department Cache (1 hour TTL)
const deptApiCacheMap = new Map();
const DEPT_API_CACHE_TTL = 3600000;

// Helper to clean up expired cache entries
const cleanExpiredCache = () => {
  const now = Date.now();
  for (const [key, entry] of analyticsCacheMap.entries()) {
    if (now - entry.timestamp > ANALYTICS_CACHE_TTL) {
      analyticsCacheMap.delete(key);
    }
  }
};

/**
 * Sync the ConsolidatedPapers materialized view inside MongoDB
 * This condenses 117,000 author rows into ~9,000 paper rows in < 1 second on Atlas M0.
 */
const syncConsolidatedPapers = async () => {
  console.log('[SYNC] Starting fast Node.js Materialized View grouping for Consolidated Papers...');
  try {
    const authors = await ShardaAuthor.find({}).lean();
    console.log(`[SYNC] Loaded ${authors.length} authors for consolidation.`);
    
    const paperMap = new Map();

    for (const a of authors) {
      // Replicate the pipeline ID logic: EID > DOI > Title|Year
      let paperId = null;
      const link = a.link || '';
      const eidMatch = link.match(/eid=([^&]+)/);
      if (eidMatch) {
        paperId = `eid|${eidMatch[1]}`;
      } else if (a.doi && a.doi.trim()) {
        paperId = `doi|${a.doi.trim().toLowerCase()}`;
      } else {
        paperId = `${(a.paperTitle || '').trim().toLowerCase()}|${a.year || ''}`;
      }

      if (!paperMap.has(paperId)) {
        paperMap.set(paperId, {
          _id: paperId,
          paperTitle: a.paperTitle,
          year: a.year,
          sourcePaper: a.sourcePaper,
          publisher: a.publisher,
          doi: a.doi,
          paperType: a.paperType,
          link: a.link,
          quartile: a.quartile,
          citedBy: a.citedBy || 0,
          publicationDate: a.publicationDate,
          countries: a.countries,
          keywords: a.keywords,
          authors: []
        });
      }

      const p = paperMap.get(paperId);
      p.citedBy = Math.max(p.citedBy, a.citedBy || 0);
      p.authors.push({
        authorName: a.authorName,
        department: a.department,
        isSharda: a.isSharda,
        email: a.email,
        scopusId: a.scopusId
      });
    }

    const consolidated = Array.from(paperMap.values());
    console.log(`[SYNC] Grouped into ${consolidated.length} consolidated papers.`);

    // Clear and Replace
    await ConsolidatedPaper.deleteMany({});
    
    // Insert in chunks of 1000 to be safe
    const chunkSize = 1000;
    for (let i = 0; i < consolidated.length; i += chunkSize) {
      await ConsolidatedPaper.insertMany(consolidated.slice(i, i + chunkSize), { ordered: false });
    }

    console.log('[SYNC] Completed Materialized View grouping successfully.');
    resetRAMBuffer();
    await getRAMBuffer();
  } catch (err) {
    console.error('[SYNC] Error syncing ConsolidatedPapers:', err);
  }
};

/**
 * Clear all cached analytics data.
 * Should be called whenever the underlying ShardaAuthor data changes.
 */
const clearAnalyticsCache = () => {
  console.log('[CACHE] Clearing all analytics cache due to data modification.');
  analyticsCacheMap.clear();
};

// Load Department Map once or on demand
let cachedDeptMap = null;
const loadDeptMap = () => {
  if (cachedDeptMap) return cachedDeptMap;
  try {
    const mappingPath = path.join(__dirname, '../dept_map.json');
    if (fs.existsSync(mappingPath)) {
      cachedDeptMap = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
      return cachedDeptMap;
    }
  } catch (err) {
    console.error('Error loading dept_map.json:', err);
  }
  return {};
};

// Get all known variations for a canonical department name
const getDepartmentVariations = (canonicalName) => {
  if (!canonicalName) return [];
  const map = loadDeptMap();
  const variations = new Set();
  variations.add(canonicalName); // Include the name itself

  const target = canonicalName.toLowerCase().trim();

  // Add from map
  for (const [variant, canonical] of Object.entries(map)) {
    if (canonical.toLowerCase().trim() === target) {
      variations.add(variant);
    }
  }

  // Add common prefix variations manually if not in map
  const prefix = target.replace('department of ', '').trim();
  if (prefix && prefix.length > 3) {
    variations.add(prefix);
  }

  return Array.from(variations);
};

// List of canonical departments to always allow (Formal Names)
const canonicalDepts = [
  "Department of Dental Science",
  "Department of Medical Sciences",
  "Department of Education",
  "Department of Pharmacy",
  "Department of Allied Health Science",
  "Department of Agricultural Science",
  "Department of Business and Commerce",
  "Department of Management",
  "Department of Chemistry and Biochemistry",
  "Department of Environmental Science",
  "Department of Life Sciences",
  "Department of Mathematics",
  "Department of Physics",
  "Department of Architecture",
  "Department of Art and Science",
  "Department of Biotechnology",
  "Department of Civil Engineering",
  "Department of Computer Science & Applications",
  "Department of Computer Science & Engineering",
  "Department of Electrical Electronics & Communication Engineering",
  "Department of Mechanical Engineering",
  "Department of Humanities & Social Sciences",
  "Department of Mass Communication",
  "Department of Nursing Sciences",
  "Department of Law"
];

// Robust normalization using the map
const normalizeDept = (dept) => {
  if (!dept || dept.trim().toLowerCase() === 'na' || dept.trim().toLowerCase() === 'unspecified') return 'NA';
  const trimmed = dept.trim();
  const map = loadDeptMap();

  // 1. Direct check or map lookup
  let normalized = map[trimmed];

  // 2. Case-insensitive lookup if direct fails
  if (!normalized) {
    const lower = trimmed.toLowerCase();
    for (const [variant, canonical] of Object.entries(map)) {
      if (variant.toLowerCase() === lower) {
        normalized = canonical;
        break;
      }
    }
  }

  // 3. Fallback to robust standardizeDepartment utility
  if (!normalized) {
    normalized = standardizeDepartment(trimmed);
  }

  // 4. Final Case-Insensitive Canonical Check
  // Ensures that even if the map or utility returns a lowercase version, 
  // we return the exact Title Case string from canonicalDepts.
  const target = (normalized && normalized !== 'NA' ? normalized : trimmed).toLowerCase().trim();
  for (const canon of canonicalDepts) {
    if (canon.toLowerCase().trim() === target) return canon;
  }

  // FORCE ALL UNRECOGNIZED TO NA
  return 'NA';
};

const isShardaDepartment = (deptName) => {
  if (!deptName || !deptName.trim()) return false;
  const lowerDept = deptName.toLowerCase();

  // 0. Always allow canonical departments (case-insensitive check)
  if (canonicalDepts.some(d => d.toLowerCase() === lowerDept)) return true;

  // 1. Explicit Sharda check
  if (lowerDept.includes('sharda')) return true;

  return false;
};

/**
 * Generate a unified key for authors to collapse name variations (abbreviated vs full).
 * Prioritizes email, then uses surname + initials + department.
 */
const getUnifiedAuthorKey = (name, dept, email = null, isSharda = false) => {
  if (email && email.trim()) return email.toLowerCase().trim();
  if (!name) return `unknown|${dept}`;

  const cleanName = name.toLowerCase().replace(/[.\s]+/g, ' ').trim();
  const parts = cleanName.split(' ').filter(p => p.length > 0);
  if (parts.length === 0) return `${name}|${dept}`;

  // If we have a full name (more than 1 part) and it's a Sharda author, 
  // we can be slightly more aggressive in grouping by surname + initials.
  // BUT if it's an external author, we stick to the Name + Dept to be safe.
  if (!isSharda) {
    const cleanDept = (dept || 'External').toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${cleanName}_${cleanDept}`;
  }

  let surname, initials;
  if (name.includes(',')) {
    const sParts = name.split(',');
    surname = sParts[0].trim().toLowerCase();
    initials = sParts[1].trim().toLowerCase().split(/[.\s]+/).filter(i => i.length > 0).map(i => i[0]).join('');
  } else {
    surname = parts[parts.length - 1];
    initials = parts.slice(0, -1).map(p => p[0]).join('');
  }

  if (isSharda) {
    // For Sharda authors, drop the department from the key to collapse cross-department
    // variations and prevent inflated counts (target ~4500-4700 authors).
    // Given previous teacher DB enrichment, cleanName is strictly unique and safe from abbreviations.
    return cleanName;
  }

  const cleanDept = (dept || 'NA').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${surname}_${initials}_${cleanDept}`;
};

const simplifyDept = (name) => {
  if (!name) return 'Unspecified';
  return name
    .replace(/Department of\s+/gi, '')
    .replace(/School of\s+/gi, '')
    .replace(/Faculty of\s+/gi, '')
    .replace(/Centre for\s+/gi, '')
    .replace(/Center for\s+/gi, '')
    .replace(/, Sharda University/gi, '')
    .replace(/Sharda University/gi, '')
    .replace(/,/g, '')
    .trim();
};

/* ======================================================
   QUARTILE FETCHING HELPER
====================================================== */

/**
 * Fetch the best quartile for a journal from Scopus API.
 * Uses CiteScore percentiles to determine Q1-Q4.
 */
const fetchQuartile = (journalTitle, issn, apiKey) => {
  return new Promise((resolve) => {
    if (!apiKey) return resolve('');

    // Use CITESCORE view for detailed rankings
    let url = 'https://api.elsevier.com/content/serial/title';
    if (issn) {
      // Handle multiple ISSNs (e.g., "0003-4878; 1937-2345") - Take the first one
      const singleIssn = String(issn).split(/[;,\s]/).find(part => part.trim().length > 0);
      const cleanIssn = String(singleIssn || '').replace(/[^\dxX]/g, '');

      if (cleanIssn) {
        url += `/issn/${cleanIssn}?apiKey=${apiKey}&view=CITESCORE`;
      } else if (journalTitle) {
        url += `?title=${encodeURIComponent(journalTitle)}&apiKey=${apiKey}&view=CITESCORE`;
      } else {
        return resolve('');
      }
    } else if (journalTitle) {
      url += `?title=${encodeURIComponent(journalTitle)}&apiKey=${apiKey}&view=CITESCORE`;
    } else {
      return resolve('');
    }

    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const entries = json['serial-metadata-response']?.entry;
          const entry = Array.isArray(entries) ? entries[0] : entries;

          if (!entry) return resolve('');

          // The detailed rankings are in citeScoreYearInfoList.citeScoreYearInfo
          // We look at the most recent year (usually index 0)
          const yearInfo = entry.citeScoreYearInfoList?.citeScoreYearInfo?.[0];
          if (!yearInfo) return resolve('');

          // Rankings are further nested: citeScoreInformationList -> citeScoreInfo -> citeScoreSubjectRank
          const infoList = yearInfo.citeScoreInformationList?.[0];
          const citeScoreInfo = infoList?.citeScoreInfo?.find(i => i.docType === 'all') || infoList?.citeScoreInfo?.[0];
          const rankings = citeScoreInfo?.citeScoreSubjectRank;

          if (rankings) {
            const results = Array.isArray(rankings) ? rankings : [rankings];
            let maxPercentile = -1;

            results.forEach(r => {
              const perc = parseFloat(r.percentile);
              if (!isNaN(perc) && perc > maxPercentile) {
                maxPercentile = perc;
              }
            });

            if (maxPercentile >= 0) {
              if (maxPercentile >= 75) return resolve('Q1');
              if (maxPercentile >= 50) return resolve('Q2');
              if (maxPercentile >= 25) return resolve('Q3');
              return resolve('Q4');
            }
          }

          resolve('');
        } catch (e) {
          console.error('Error parsing Scopus Serial Title response:', e.message);
          resolve('');
        }
      });
    }).on('error', (e) => {
      console.error('HTTP Error in fetchQuartile:', e.message);
      resolve('');
    });
  });
};

/**
 * Fetch exact publication dates for a batch of DOIs from Scopus API.
 * Uses DOI(...) OR DOI(...) search to retrieve multiple dates in one call.
 */
const fetchPublicationDates = (dois, apiKey) => {
  return new Promise((resolve) => {
    if (!apiKey || !dois || dois.length === 0) return resolve({});

    const query = dois.map(d => `DOI("${d}")`).join(' OR ');
    const url = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent(query)}&count=25&apiKey=${apiKey}`;

    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const entries = json['search-results']?.entry || [];
          const dateMap = {};

          if (entries.length > 0 && !entries[0].error) {
            entries.forEach(entry => {
              const doi = entry['prism:doi'];
              const date = entry['prism:coverDate'];
              if (doi && date) {
                dateMap[doi.toLowerCase()] = date;
              }
            });
          }
          resolve(dateMap);
        } catch (e) {
          console.error('Error parsing Scopus Search response:', e.message);
          resolve({});
        }
      });
    }).on('error', (e) => {
      console.error('HTTP Error in fetchPublicationDates:', e.message);
      resolve({});
    });
  });
};

/**
 * Fetch exact publication date for a single DOI from Crossref API.
 * Checks multiple fields in priority order for the most accurate date:
 *   1. assertion "first_online" (e.g. "30 May 2025")
 *   2. published-print  date-parts
 *   3. published-online date-parts
 *   4. deposited        date-parts  (usually has full Y-M-D)
 *   5. issued           date-parts  (often only year)
 * Among date-parts candidates, the one with the most components wins.
 * Falls back to month name or year if full date isn't available.
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

          // --- Helper: format [Y, M, D] array ---
          const fmtParts = (parts) => {
            if (!parts || parts.length === 0) return null;
            const y = parts[0];
            if (y <= 1900 || y >= 2100) return null;
            let res = `${y}`;
            if (parts.length > 1) {
              res += `-${String(parts[1]).padStart(2, '0')}`;
              if (parts.length > 2) {
                res += `-${String(parts[2]).padStart(2, '0')}`;
              }
            }
            return res;
          };

          // --- 1. Check assertions for "first_online" (high priority) ---
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

          // --- 2. Collect candidates ---
          const allCandidates = [
            { src: 'published-online', parts: message['published-online']?.['date-parts']?.[0], priority: 1 },
            { src: 'published-print', parts: message['published-print']?.['date-parts']?.[0], priority: 2 },
            { src: 'issued', parts: message['issued']?.['date-parts']?.[0], priority: 3 },
            { src: 'created', parts: message['created']?.['date-parts']?.[0], priority: 4 },
            { src: 'deposited', parts: message['deposited']?.['date-parts']?.[0], priority: 5 },
          ].filter(c => c.parts && c.parts.length > 0);

          if (allCandidates.length > 0) {
            let officialYear = 9999;
            for (const c of allCandidates) {
              if ((c.src === 'issued' || c.src === 'published-print' || c.src === 'published-online') && c.parts[0] < officialYear) {
                officialYear = c.parts[0];
              }
            }

            const validCandidates = allCandidates.filter(c => {
              if (c.src === 'created' || c.src === 'deposited') {
                if (officialYear !== 9999 && c.parts[0] > officialYear + 1) return false;
              }
              return true;
            });

            validCandidates.sort((a, b) => {
              if (a.parts.length !== b.parts.length) {
                return b.parts.length - a.parts.length;
              }
              return a.priority - b.priority;
            });

            if (validCandidates.length > 0) {
              const bestParts = validCandidates[0].parts;
              const bestDate = fmtParts(bestParts);
              if (bestDate) {
                return resolve({
                  date: bestDate,
                  title: message.title ? message.title[0] : null,
                  year: bestParts[0]
                });
              }
            }
          }

          resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', (e) => {
      console.error(`[CROSSREF] HTTP Error for DOI ${doi}:`, e.message);
      resolve(null);
    });
  });
};

/**
 * Background worker to enrich ShardaAuthor records with exact publication dates.
 * Uses Crossref to get high-precision dates from DOIs.
 * 
 * @param {string[]} doiList - Array of DOIs to enrich
 * @param {string} apiKey - Scopus API Key
 * @param {boolean} force - If true, overwrite existing dates (like Jan 1 fallbacks)
 */
const enrichAuthorsWithDatesInBackground = async (doiList, apiKey, force = false) => {
  if (!doiList || doiList.length === 0) return;

  console.log(`\n[BACKGROUND] Starting date enrichment for ${doiList.length} unique DOIs via Crossref...`);
  const CROSSREF_CONCURRENCY = 50;

  let successCount = 0;
  // Crossref Primary Fetch
  for (let i = 0; i < doiList.length; i += CROSSREF_CONCURRENCY) {
    const batch = doiList.slice(i, i + CROSSREF_CONCURRENCY);

    if (i % (CROSSREF_CONCURRENCY * 2) === 0 || i + CROSSREF_CONCURRENCY >= doiList.length) {
      console.log(`    [BACKGROUND] Crossref: ${i}/${doiList.length} processed... (Successes: ${successCount})`);
    }

    const results = await Promise.all(batch.map(d => fetchDateFromCrossref(d)));

    for (let idx = 0; idx < batch.length; idx++) {
      const doi = batch[idx];
      const crossrefData = results[idx];
      if (crossrefData && crossrefData.date) {
        successCount++;

        const updateData = {
          publicationDate: crossrefData.date
        };

        // Sync year if available
        if (crossrefData.year) {
          updateData.year = crossrefData.year;
        }

        // Sync title if significantly more complete (e.g. current title is truncated)
        // For now, we only update if the title seems valid
        if (crossrefData.title && crossrefData.title.length > 10) {
          updateData.paperTitle = crossrefData.title;
        }

        // Update DB immediately for this DOI
        // Use direct equality match for performance as DOIs are pre-extracted
        const updateResult = await ShardaAuthor.updateMany(
          { doi: doi.trim() }, // USE DIRECT MATCH, Case-insensitivity should be handled by normalization elsewhere
          { $set: updateData }
        );
        if (updateResult.modifiedCount > 0) {
          successCount++;
          console.log(`    [BACKGROUND] Success: ${doi} -> ${crossrefData.date}`);
        }
      }
    }

    // Add a small delay between batches to respect rate limits if list is large
    if (doiList.length > CROSSREF_CONCURRENCY) {
      console.log(`    [BACKGROUND] Batch complete. Waiting for rate limits...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`[BACKGROUND] DOI-based precise date enrichment complete. Total successes: ${successCount}`);

  // Fallback Phase
  try {
    console.log(`[BACKGROUND] Applying fallback years to papers without precise dates...`);
    const papersWithoutDates = await ShardaAuthor.find({
      $or: [
        { publicationDate: { $exists: false } },
        { publicationDate: null }
      ],
      year: { $exists: true, $ne: null }
    }).lean();

    let fallbackCount = 0;
    const fallbackOps = [];
    const processedTitles = new Set();

    for (const p of papersWithoutDates) {
      const key = `${(p.paperTitle || '').toLowerCase().trim()}|${p.year}`;
      if (p.year && !processedTitles.has(key)) {
        fallbackOps.push({
          updateMany: {
            filter: {
              paperTitle: p.paperTitle,
              year: p.year,
              $or: [
                { publicationDate: { $exists: false } },
                { publicationDate: null }
              ]
            },
            update: { $set: { publicationDate: String(p.year) } }
          }
        });
        processedTitles.add(key);
        fallbackCount++;
      }
    }

    if (fallbackOps.length > 0) {
      const result = await ShardaAuthor.bulkWrite(fallbackOps, { ordered: false });
      const updatedCount = result.modifiedCount;
      clearAnalyticsCache();
      if (updatedCount > 0) {
        await syncConsolidatedPapers();
      }

      console.log(`[BACKGROUND] Fallback complete: Updated ${updatedCount} paper groups to use their Year as publicationDate.`);
    } else {
      console.log(`[BACKGROUND] Fallback complete: No papers needed fallback dates.`);
    }
  } catch (err) {
    console.error('[BACKGROUND] Fallback phase failed:', err.message);
  }
};
const SHARDA_KEYWORD = 'sharda';
const SHARDA_GROUP_EXCLUDE = 'sharda group';

/* ======================================================
   AUTHOR-AFFILIATION PARSER - OPTIMIZED
====================================================== */

/**
 * Parse semicolon-separated author entries.
 * Optimized with single pass.
 *
 * @param {string} field - Raw CSV field with semicolon-separated entries
 * @returns {string[]} - Array of individual author entries
 */
const parseAuthorEntries = (field) => {
  if (!field || typeof field !== 'string') return [];

  const result = [];
  const parts = field.split(';');
  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i].trim();
    if (trimmed) result.push(trimmed);
  }
  return result;
};

/**
 * Format author name from "Last, First" to "First Last"
 * @param {string} name - The name string to format
 * @returns {string} - Formatted name
 */
const formatAuthorName = (name) => {
  if (!name || typeof name !== 'string') return '';
  if (!name.includes(',')) return name.trim();

  const parts = name.split(',');
  if (parts.length < 2) return name.trim();

  // "Last, First" -> "First Last"
  return `${parts[1].trim()} ${parts[0].trim()}`;
};

const extractCountries = (field) => {
  if (!field || typeof field !== 'string') return [];

  const countries = new Set();
  const commonCountries = [
    'USA', 'United States', 'UK', 'United Kingdom', 'China', 'Germany', 'Japan', 'France', 'Canada', 'Italy',
    'Australia', 'South Korea', 'Brazil', 'Russia', 'Spain', 'India', 'Egypt', 'Malaysia', 'Singapore',
    'South Africa', 'Belgium', 'Netherlands', 'Sweden', 'Switzerland', 'Austria', 'Denmark', 'Finland',
    'Norway', 'Portugal', 'Greece', 'Ireland', 'Israel', 'New Zealand', 'Turkey', 'Saudi Arabia', 'UAE',
    'United Arab Emirates', 'Iran', 'Iraq', 'Pakistan', 'Bangladesh', 'Viet Nam', 'Vietnam', 'Thailand',
    'Indonesia', 'Philippines', 'Mexico', 'Argentina', 'Chile', 'Colombia', 'Peru', 'Kazakhstan', 'Nigeria',
    'Ethiopia', 'Kenya', 'Morocco', 'Tunisia', 'Jordan', 'Oman', 'Qatar', 'Kuwait'
  ];

  const parts = field.split(';');
  parts.forEach(part => {
    const subParts = part.split(',');
    const lastPart = subParts[subParts.length - 1].trim();

    // Check if the last part is a known country
    const found = commonCountries.find(c =>
      lastPart.toLowerCase() === c.toLowerCase() ||
      lastPart.toLowerCase().includes(c.toLowerCase())
    );

    if (found) {
      countries.add(found === 'USA' ? 'United States' : (found === 'UK' ? 'United Kingdom' : found));
    }
  });

  return Array.from(countries);
};

/**
 * Extract keywords from paper title by filtering out common stop words.
 * @param {string} title - The paper title
 * @returns {string[]} - Extracted keywords
 */
const extractKeywordsFromTitle = (title) => {
  if (!title || typeof title !== 'string') return [];

  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'from', 'by', 'for', 'with', 'in', 'on', 'to', 'of',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'should', 'would',
    'may', 'might', 'must', 'will', 'shall', 'not', 'no', 'yes', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'any',
    'as', 'because', 'before', 'below', 'between', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'than', 'too', 'very',
    's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'using', 'based', 'approach', 'study', 'analysis', 'research', 'results',
    'model', 'system', 'method', 'methods', 'review', 'case', 'performance', 'development', 'new', 'multi', 'smart', 'using'
  ]);

  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word))
    .slice(0, 8); // Limit to top 8 words
};

/* ======================================================
   SHARDA EXTRACTOR - OPTIMIZED
====================================================== */

/**
 * Extract Sharda authors and their departments from author entries.
 * Optimized version with Surname Indexing for O(1) matching.
 *
 * @param {string[]} entries - Array of author entries
 * @param {string[]} authorIds - Array of Scopus Author IDs
 * @param {Object} paperData - Paper metadata
 * @param {Object} teacherIndex - { surnameMap, normalizedMap, emailMap }
 * @param {Object} globalDeptMap - Map of author names to departments
 * @param {string} correspondenceEmail - Optional email extracted from Correspondence Address
 * @returns {Promise<Object[]>} - Array of ShardaAuthor objects
 */
const extractShardaAuthors = (entries, authorIds, paperData, teacherIndex, globalDeptMap = {}, correspondenceEmail = null) => {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const results = [];
  const seenPairs = new Set();
  const { paperTitle, year, citedBy, link, doi, countries: paperCountries, keywords, quartile, publicationDate, sourcePaper, publisher, paperType } = paperData;
  const { surnameMap, normalizedMap, emailMap, abbreviationMap } = teacherIndex;

  const cleanEmail = correspondenceEmail ? correspondenceEmail.toLowerCase().trim() : null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry !== 'string') continue;

    const scopusId = Array.isArray(authorIds) && authorIds[i] ? authorIds[i].trim() : null;
    const lowerEntry = entry.toLowerCase();

    // 1. AFFILIATION CHECK
    const hasShardaAffiliation = lowerEntry.includes("sharda university") || lowerEntry.includes("sharda hospital");

    // 2. NAME EXTRACTION & CLEANING
    const firstCommaIndex = entry.indexOf(',');
    let rawName = firstCommaIndex !== -1 ? entry.substring(0, firstCommaIndex).trim() : entry.trim();
    
    // Remove department prefixes from the name
    let cleanExtractedName = rawName.replace(/^(?:Department|School|Centre|Institute|Center|Faculty|Dept|School|College)\s+of\s+.*?(?=[A-Z][a-z]+|\b[A-Z]\.|\b[A-Z][A-Z]\b)/i, '').trim();
    
    // 3. TEACHER MATCHING
    let matchedTeacher = null;

    // A. Match by Correspondence Email
    if (cleanEmail && emailMap[cleanEmail]) {
      const t = emailMap[cleanEmail];
      if (matchNames(t.name, cleanExtractedName)) {
        matchedTeacher = t;
      }
    }

    // B. Match by Name (Normalized or Abbreviation)
    if (!matchedTeacher) {
      const lookupName = cleanExtractedName.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
      
      if (normalizedMap[lookupName]) {
        matchedTeacher = normalizedMap[lookupName];
      } 
      else if (abbreviationMap[lookupName]) {
        const candidates = abbreviationMap[lookupName];
        if (candidates.length === 1) {
          matchedTeacher = candidates[0];
        } else if (candidates.length > 1) {
          const entryDept = standardizeDepartment(entry);
          matchedTeacher = candidates.find(c => c.department === entryDept) || candidates[0];
        }
      }
    }

    // 4. DECIDE IF IS_SHARDA
    const isShardaMatch = !!matchedTeacher || hasShardaAffiliation;
    if (!isShardaMatch) continue;

    const finalAuthorName = matchedTeacher ? matchedTeacher.name : cleanExtractedName;
    const finalDept = matchedTeacher ? matchedTeacher.department : standardizeDepartment(entry);

    const pairKey = `${finalAuthorName.toLowerCase()}|${finalDept.toLowerCase()}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    results.push({
      authorName: finalAuthorName,
      scopusId,
      department: finalDept,
      sourcePaper: sourcePaper || publisher || '',
      publisher: publisher || '',
      paperTitle: paperTitle || '',
      year: year || null,
      paperType: paperType || '',
      citedBy: citedBy ?? 0,
      link: link || '',
      doi: doi || '',
      countries: paperCountries || [],
      keywords: keywords || [],
      quartile: quartile || '',
      publicationDate: publicationDate || null,
      email: matchedTeacher ? matchedTeacher.email : (cleanEmail ? cleanEmail : null),
      isSharda: true
    });
  }

  return results;
};

/* ======================================================
   CSV PROCESSOR - OPTIMIZED
====================================================== */

// Column index cache to avoid repeated find() calls
let columnIndices = null;

/**
 * Process CSV file with optimized performance.
 * Caches column indices after first row for O(1) access.
 */
const processCSV = async (fileBuffer, apiKey) => {
  // Pre-load all teachers for fast matching
  const teachers = await Teacher.find({}).lean();
  console.log(`Loaded ${teachers.length} teachers for matching...`);

  // --- Build Indices for O(1) matching ---
  const surnameMap = {};
  const normalizedMap = {};
  const emailMap = {};
  const abbreviationMap = {}; // "s varshney" or "varshney s" -> [Teachers]

  for (const t of teachers) {
    if (!t.name) continue;

    // Index by email if available
    if (t.email) {
      emailMap[t.email.toLowerCase().trim()] = t;
    }

    const cleanName = t.name.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    normalizedMap[cleanName] = t;

    const parts = cleanName.split(/\s+/);
    const surname = parts[parts.length - 1];
    
    // Surname Index
    if (!surnameMap[surname]) surnameMap[surname] = [];
    surnameMap[surname].push(t);

    // Abbreviation Index: "s varshney"
    if (parts.length > 1) {
      const initials = parts.slice(0, -1).map(p => p[0]).join(' ');
      const abbr1 = (initials + ' ' + surname).trim();
      const abbr2 = (surname + ' ' + initials).trim();
      
      if (!abbreviationMap[abbr1]) abbreviationMap[abbr1] = [];
      abbreviationMap[abbr1].push(t);
      if (!abbreviationMap[abbr2]) abbreviationMap[abbr2] = [];
      abbreviationMap[abbr2].push(t);
    }
    
    // Also index by any provided alternateNames
    if (Array.isArray(t.alternateNames)) {
      t.alternateNames.forEach(alt => {
        const altClean = alt.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!normalizedMap[altClean]) normalizedMap[altClean] = t;
      });
    }
  }
  const teacherIndex = { surnameMap, normalizedMap, emailMap, abbreviationMap };
  // ----------------------------------------

  // Build global author-to-department map for "Cross-Paper Recovery" using Aggregation
  // This drastically reduces data transferred from MongoDB to Node.js
  const existingAuthors = await ShardaAuthor.find({ 
    department: { $nin: ['NA', 'Unspecified', '', null] } 
  }).select('authorName department').lean();

  const globalDeptMap = {};
  for (const doc of existingAuthors) {
    if (doc.authorName && doc.department) {
      const currentDept = globalDeptMap[doc.authorName];
      if (!currentDept || doc.department.length > currentDept.length) {
        globalDeptMap[doc.authorName] = doc.department;
      }
    }
  }
  console.log(`Loaded ${Object.keys(globalDeptMap).length} unique author departments via Node.js for cross-paper recovery.`);

  return new Promise((resolve, reject) => {
    const rows = [];
    const bufferStream = new stream.PassThrough();
    bufferStream.end(fileBuffer);

    bufferStream
      .pipe(csv({
        mapHeaders: ({ header }) => {
          return header.trim()
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/[-\s]+/g, '_');
        },
        skipLines: 0,
        strict: false
      }))
      .on('data', (row) => rows.push(row))
      .on('end', async () => {
        try {
          const results = [];
          const errors = [];
          const quartilesCache = new Map();
          const datesCache = new Map();
          const apiKey = process.env.SCOPUS_API_KEY;

          // Cache column indices on first row
          if (rows.length > 0) {
            const keys = Object.keys(rows[0]);
            columnIndices = {
              title: keys.findIndex(k => k === 'title' || k.includes('title')),
              authors: keys.findIndex(k => k.includes('author') && k.includes('affiliation')),
              year: keys.findIndex(k => k === 'year'),
              source: keys.findIndex(k => k.includes('source') || k.includes('journal')),
              publisher: keys.findIndex(k => k.includes('publisher')),
              paperType: keys.findIndex(k => k.includes('type')),
              citedBy: keys.findIndex(k => k.includes('cited') || k.includes('citation')),
              link: keys.findIndex(k => k.includes('link') || k.includes('url')),
              doi: keys.findIndex(k => k === 'doi'),
              issn: keys.findIndex(k => k === 'issn' || k.includes('issn')),
              allAffilliations: keys.findIndex(k => k.includes('author') && k.includes('affiliation')),
              authorsId: keys.findIndex(k => k === 'authors_id' || (k.includes('author') && k.includes('id'))),
              keywords: keys.findIndex(k => k.includes('keyword')),
              correspondence: keys.findIndex(k => k.includes('correspondence') && k.includes('address'))
            };

            console.log(`Analyzing ${rows.length} papers for quartiles...`);

            // 1. Pre-identify unique journals/ISSNs to minimize API calls
            const uniqueJournals = new Map();
            rows.forEach((row, idx) => {
              const values = Object.values(row);
              const source = columnIndices.source >= 0 ? values[columnIndices.source] : null;
              const issn = columnIndices.issn >= 0 ? values[columnIndices.issn] : null;
              const title = columnIndices.title >= 0 ? values[columnIndices.title] : null;

              if (source || issn) {
                // Normalize key: Use first ISSN if multi-ISSN string
                let key = issn;
                if (issn && typeof issn === 'string') {
                  key = issn.split(/[;,\s]/).find(part => part.trim().length > 0) || issn;
                }
                key = key || source;

                if (!uniqueJournals.has(key)) {
                  uniqueJournals.set(key, { source, issn });
                }
              }
            });

            console.log(`Fetching quartiles for ${uniqueJournals.size} unique journals...`);

            // 1a. Check DB for existing quartiles first
            const existingInDb = await JournalQuartile.find({
              journalKey: { $in: Array.from(uniqueJournals.keys()) }
            }).lean();

            existingInDb.forEach(item => {
              quartilesCache.set(item.journalKey, item.quartile);
            });
            console.log(`  - Found ${existingInDb.length} journals in DB cache.`);

            // 1b. Filter journals that still need fetching
            const missingJournals = [];
            for (const [key, info] of uniqueJournals.entries()) {
              if (!quartilesCache.has(key)) {
                missingJournals.push({ key, ...info });
              }
            }

            if (missingJournals.length > 0) {
              console.log(`  - ${missingJournals.length} journals to fetch from Scopus API...`);

              // 2. Fetch quartiles in parallel batches
              const BATCH_SIZE = 5;
              const delay = (ms) => new Promise(res => setTimeout(res, ms));

              for (let i = 0; i < missingJournals.length; i += BATCH_SIZE) {
                const batch = missingJournals.slice(i, i + BATCH_SIZE);
                console.log(`    Fetching batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(missingJournals.length / BATCH_SIZE)}...`);

                const batchPromises = batch.map(async (info) => {
                  try {
                    const Q = await fetchQuartile(info.source, info.issn, apiKey);
                    quartilesCache.set(info.key, Q);

                    // Update DB for future use
                    await JournalQuartile.updateOne(
                      { journalKey: info.key },
                      {
                        $set: {
                          quartile: Q,
                          lastUpdated: new Date()
                        }
                      },
                      { upsert: true }
                    );
                    return Q;
                  } catch (err) {
                    console.error(`Error processing quartile for ${info.key}:`, err.message);
                    return '';
                  }
                });

                await Promise.all(batchPromises);

                // Add a delay between batches to respect rate limits
                if (i + BATCH_SIZE < missingJournals.length) {
                  await delay(500);
                }
              }
              console.log(`  - Finished fetching from Scopus.`);
            }
          }

          let papersWithSharda = 0;
          let shardaAuthorCount = 0;
          let totalCsvCitations = 0;
          const uniqueCsvDoiTitle = new Set();

          for (const row of rows) {
            try {
              const values = Object.values(row);
              const title = columnIndices.title >= 0 ? values[columnIndices.title] : null;
              if (!title) continue;

              const authorsRaw = columnIndices.authors >= 0 ? values[columnIndices.authors] : null;
              const authorsIdRaw = columnIndices.authorsId >= 0 ? values[columnIndices.authorsId] : null;
              const yearRaw = columnIndices.year >= 0 ? values[columnIndices.year] : null;
              const sourceRaw = columnIndices.source >= 0 ? values[columnIndices.source] : null;
              const publisherRaw = columnIndices.publisher >= 0 ? values[columnIndices.publisher] : null;
              const paperTypeRaw = columnIndices.paperType >= 0 ? values[columnIndices.paperType] : null;
              const citedByRaw = columnIndices.citedBy >= 0 ? values[columnIndices.citedBy] : null;
              const linkRaw = columnIndices.link >= 0 ? values[columnIndices.link] : null;
              const doiRaw = columnIndices.doi >= 0 ? values[columnIndices.doi] : null;
              const issnRaw = columnIndices.issn >= 0 ? values[columnIndices.issn] : null;
              const keywordsRaw = columnIndices.keywords >= 0 ? values[columnIndices.keywords] : null;
              const correspondenceRaw = columnIndices.correspondence >= 0 ? values[columnIndices.correspondence] : null;

              // Helper: Extraction email from Correspondence Address
              const extractEmail = (text) => {
                if (!text || typeof text !== 'string') return null;
                const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;
                const matches = text.match(emailRegex);
                return matches ? matches[0] : null;
              };

              const correspondenceEmail = extractEmail(correspondenceRaw);

              let keywords = keywordsRaw ?
                keywordsRaw.split(/[|;]|\s*,\s*/).map(k => k.trim()).filter(k => k.length > 2) :
                [];

              if (keywords.length === 0 && title) {
                keywords = extractKeywordsFromTitle(title);
              }

              let finalLink = linkRaw || '';
              if (!finalLink && doiRaw) {
                const cleanDoi = String(doiRaw).trim();
                finalLink = cleanDoi.startsWith('10.') ? `https://doi.org/${cleanDoi}` : (cleanDoi ? `https://doi.org/${cleanDoi}` : '');
              }

              const year = yearRaw ? parseInt(String(yearRaw).trim(), 10) : null;
              let citedBy = 0;
              if (citedByRaw) {
                const parsed = parseInt(String(citedByRaw).trim(), 10);
                if (!isNaN(parsed)) citedBy = parsed;
              }

              const uniquenessKey = finalLink || title;
              if (uniquenessKey && !uniqueCsvDoiTitle.has(uniquenessKey)) {
                uniqueCsvDoiTitle.add(uniquenessKey);
                totalCsvCitations += citedBy;
              }

              const authorEntries = authorsRaw ? parseAuthorEntries(authorsRaw) : [];
              const authorIds = authorsIdRaw ? authorsIdRaw.split(';').map(id => id.trim()) : [];

              // Get quartile from cache
              let journalKey = issnRaw;
              if (issnRaw && typeof issnRaw === 'string') {
                journalKey = issnRaw.split(/[;,\s]/).find(part => part.trim().length > 0) || issnRaw;
              }
              journalKey = journalKey || sourceRaw;

              const quartile = quartilesCache.get(journalKey) || '';

              const shardaAuthors = extractShardaAuthors(authorEntries, authorIds, {
                sourcePaper: sourceRaw || '',
                publisher: publisherRaw || '',
                paperTitle: title,
                year,
                paperType: paperTypeRaw || '',
                citedBy,
                link: finalLink,
                doi: doiRaw || '',
                countries: extractCountries(authorsRaw || ''),
                keywords: keywords,
                quartile: quartile,
                publicationDate: null // To be filled in background
              }, teacherIndex, globalDeptMap, correspondenceEmail);

              if (shardaAuthors.length > 0) {
                papersWithSharda++;
                shardaAuthors.forEach(a => {
                  results.push(a);
                  shardaAuthorCount++;
                });
              }
            } catch (err) {
              errors.push({ row, error: err.message });
            }
          }

          console.log(`Processing complete:`);
          console.log(`  - Total papers: ${rows.length}`);
          console.log(`  - Papers with Sharda authors: ${papersWithSharda}`);
          console.log(`  - Total Sharda authors extracted: ${shardaAuthorCount}`);

          resolve({
            authors: results,
            errors,
            totalProcessed: rows.length,
            papersWithSharda,
            shardaAuthorCount,
            totalCsvCitations
          });
        } catch (err) {
          reject(err);
        }
      })
      .on('error', reject);
  });
};

/**
 * Post-import validation: Propagates specific departments to papers with 
 * generic 'School' or 'NA' affiliations based on the author's Scopus ID.
 */
const propagateDepartments = async () => {
  try {
    const allAuthors = await ShardaAuthor.find({
      department: { $nin: ['NA', 'Unspecified', '', null] },
      scopusId: { $exists: true, $ne: null }
    }).select('scopusId department').lean();

    const deptMap = {};
    for (const a of allAuthors) {
      // Filter out generic school names
      if (/school of|sset|smsr|shss|saps|sahs|snrs|snsr|sbss/i.test(a.department)) continue;
      
      if (a.scopusId && a.department) {
        // Just take the first valid department found for this scopusId
        if (!deptMap[a.scopusId]) deptMap[a.scopusId] = a.department;
      }
    }

    const bulkOps = [];
    // 2. Propagate to NA or generic school papers by the same author
    for (const [scopusId, targetDept] of Object.entries(deptMap)) {
      bulkOps.push({
        updateMany: {
          filter: {
            scopusId: scopusId,
            $or: [
              { department: { $in: ['NA', 'Unspecified', '', null] } },
              { department: /school of|sset|smsr|shss|saps|sahs|snrs|snsr|sbss/i }
            ]
          },
          update: { $set: { department: targetDept } }
        }
      });
    }

    if (bulkOps.length > 0) {
      const result = await ShardaAuthor.bulkWrite(bulkOps, { ordered: false });
      console.log(`Propagated specific departments to ${result.modifiedCount} generic/NA papers.`);
      return result.modifiedCount;
    }
    return 0;
  } catch (err) {
    console.error('Error in propagateDepartments:', err.message);
    return 0;
  }
};

/* ======================================================
   CONTROLLER EXPORTS
====================================================== */

module.exports = {

  uploadCSV: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No CSV uploaded' });
      }

      const apiKey = process.env.SCOPUS_API_KEY;
      const buffer = fs.readFileSync(req.file.path);
      const { authors, errors, totalProcessed, papersWithSharda, shardaAuthorCount, totalCsvCitations } =
        await processCSV(buffer, apiKey);

      // Upsert new Sharda authors (bulk operation is fast and preserves existing data)
      const bulkOps = authors.map(author => {
        // Uniquely identify a record by all fields that constitute a unique paper + author
        // This ensures the dashboard paper count uniquely matches the CSV

        // Remove publicationDate from the update payload so we don't accidentally overwrite existing precise dates with null
        const updatePayload = { ...author };
        delete updatePayload.publicationDate;

        return {
          updateOne: {
            filter: {
              authorName: author.authorName,
              department: author.department || '',
              paperTitle: author.paperTitle || '',
              year: author.year,
              sourcePaper: author.sourcePaper || '',
              publisher: author.publisher || '',
              doi: author.doi || '',
              link: author.link || '',
              paperType: author.paperType || ''
            },
            update: { $set: updatePayload },
            upsert: true
          }
        };
      });

      let savedCount = 0;
      if (bulkOps.length > 0) {
        const result = await ShardaAuthor.bulkWrite(bulkOps, { ordered: false });
        savedCount = result.upsertedCount + result.modifiedCount;
      }

      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      // Clear analytics cache so dashboard reflects new data (FAST)
      clearAnalyticsCache();

      // Send response immediately to prevent REDIRECTION HANG
      res.json({
        success: true,
        message: `Upload complete! Processed ${totalProcessed} papers. Data synchronization and date enrichment are running in the background.`,
        count: savedCount,
        papersWithSharda,
        backgroundProcessing: true,
        errors: errors.length ? errors : undefined
      });

      // --- ASYNC BACKGROUND WORK (Run everything heavy after response) ---
      (async () => {
        try {
          console.log('[BACKGROUND] Starting post-upload processing (Propagation + Sync)...');

          // 1. Perform Global Refinement / Propagation
          const propagatedCount = await propagateDepartments();
          console.log(`[BACKGROUND] Propagated true department logic to ${propagatedCount} papers.`);

          // 2. Materialized View Sync (Heavy)
          await syncConsolidatedPapers();
          console.log('[BACKGROUND] Post-upload synchronization complete.');

          // 3. DOI Enrichment (Already backgrounded, but chained here for clarity)
          const uniqueDoisFromCsv = Array.from(new Set(authors.map(a => a.doi).filter(doi => doi && doi.trim())));
          if (uniqueDoisFromCsv.length > 0) {
            const existingDocsWithDates = await ShardaAuthor.find({
              doi: { $in: uniqueDoisFromCsv },
              publicationDate: { $ne: null }
            }).select('doi').lean();

            const doisWithDates = new Set(existingDocsWithDates.map(d => (d.doi || '').toLowerCase()));
            const doisToEnrich = uniqueDoisFromCsv.filter(doi => !doisWithDates.has(doi.toLowerCase()));

            if (doisToEnrich.length > 0) {
              await enrichAuthorsWithDatesInBackground(doisToEnrich, apiKey);
            }
          }
        } catch (bgErr) {
          console.error('[BACKGROUND] Critical failure in post-upload processing:', bgErr.message);
        }
      })();

    } catch (err) {
      console.error('Error in uploadCSV:', err.message);
      console.error('Stack trace:', err.stack);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: err.message });
    }
  },

  enrichAllDates: async (req, res) => {
    try {
      const apiKey = process.env.SCOPUS_API_KEY;
      const force = req.query.force === 'true';

      const filter = {
        doi: { $ne: null, $ne: '' }
      };

      if (!force) {
        // Only get ones missing a precise date (null or Jan 1/year fallback)
        filter.$or = [
          { publicationDate: { $exists: false } },
          { publicationDate: null }
        ];
      }

      const uniqueDois = await ShardaAuthor.distinct('doi', filter);

      if (uniqueDois.length === 0) {
        return res.json({ success: true, message: 'No DOIs found to enrich.' });
      }

      console.log(`[MANUAL] Triggering background enrichment for ${uniqueDois.length} unique DOIs (force=${force})...`);

      // Start enrichment in background (do not await)
      enrichAuthorsWithDatesInBackground(uniqueDois, apiKey, force).catch(err => {
        console.error('[MANUAL] Background enrichment failed:', err.message);
      });

      res.json({
        success: true,
        message: `Background enrichment started for ${uniqueDois.length} unique DOIs. High-precision dates are being fetched from Crossref.`,
        doiCount: uniqueDois.length
      });

    } catch (err) {
      console.error('Error in enrichAllDates:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  /**
   * Automatically triggered check for missing dates
   * Finds all DOIs with missing or invalid publication dates and starts background enrichment
   */
  autoEnrichMissingDates: async () => {
    try {
      const apiKey = process.env.SCOPUS_API_KEY;
      if (!apiKey) return;

      const filter = {
        doi: { $ne: null, $ne: '' },
        $or: [
          { publicationDate: { $exists: false } },
          { publicationDate: null },
          // Use an aggregation or $expr to find January 1st if possible, 
          // but for the bulk trigger, just finding null/missing covers most fresh cases.
          // To catch ALL imprecise ones, we can use an aggregate pipeline instead of simple find.
        ]
      };

      // Find DOIs that have NO precise date (count occurrences where month/day != 1-1)
      const pipeline = [
        { $match: { doi: { $ne: null, $ne: "" } } },
        {
          $group: {
            _id: "$doi",
            hasPrecise: {
              $max: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$publicationDate", null] },
                      { $ne: [{ $type: "$publicationDate" }, "missing"] },
                      {
                        $or: [
                          { $ne: [{ $month: "$publicationDate" }, 1] },
                          { $ne: [{ $dayOfMonth: "$publicationDate" }, 1] }
                        ]
                      }
                    ]
                  },
                  1, 0
                ]
              }
            }
          }
        },
        { $match: { hasPrecise: 0 } }
      ];

      const impreciseDoisResults = await ShardaAuthor.aggregate(pipeline).allowDiskUse(true);
      const uniqueDois = impreciseDoisResults.map(r => r._id);

      if (uniqueDois.length > 0) {
        console.log(`[AUTO] Found ${uniqueDois.length} unique DOIs needing precise date enrichment. Starting background worker...`);
        // Trigger worker in background
        enrichAuthorsWithDatesInBackground(uniqueDois, apiKey).catch(err => {
          console.error('[AUTO] Background enrichment failed:', err.message);
        });
      } else {
        console.log(`[AUTO] No DOIs found needing enrichment.`);
      }
    } catch (err) {
      console.error('[AUTO] DOI date check failed:', err.message);
    }
  },

  searchAuthors: async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.json([]);

      // Aggregate designed to find unique authors matching the query
      // and sort them by total paper count descending
      const authors = await ShardaAuthor.aggregate([
        {
          $match: {
            authorName: { $regex: q, $options: 'i' }
          }
        },
        {
          $group: {
            _id: { $toLower: "$authorName" },
            displayId: { $first: "$authorName" },
            department: { $first: "$department" },
            paperCount: { $sum: 1 },
            citationCount: { $sum: "$citedBy" }
          }
        },
        {
          $project: {
            _id: "$displayId",
            department: 1,
            paperCount: 1,
            citationCount: 1
          }
        },
        { $sort: { paperCount: -1 } },
        { $limit: 20 }
      ]).allowDiskUse(true);

      res.json(authors);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  getAuthorStats: async (req, res) => {
    try {
      const { name } = req.params;
      if (!name) return res.status(400).json({ error: 'Author name is required' });

      // 1. Resolve canonical name if it's a teacher
      const teachers = await Teacher.find({}).lean();
      let searchName = name;
      let matchedTeacher = teachers.find(t => t.email && name.toLowerCase().includes(t.email.toLowerCase()));
      
      if (!matchedTeacher) {
        // Try exact name match
        matchedTeacher = teachers.find(t => t.name.toLowerCase() === name.toLowerCase());
      }
      
      if (!matchedTeacher) {
        // Try loose match using matchNames utility
        const { matchNames } = require('../utils/nameMatcher');
        matchedTeacher = teachers.find(t => matchNames(t.name, name));
      }

      let searchRegex;
      if (matchedTeacher) {
        searchName = matchedTeacher.name;
        // If we matched a teacher, we want ALL variants of their name that we might have in ShardaAuthor
        // But since our new extraction uses the canonical name, we mainly search for that.
        // For backwards compatibility with old data (if any), we keep a flexible search.
        const parts = searchName.split(' ');
        const pattern = parts.map(p => `(?=.*${p})`).join('');
        searchRegex = new RegExp(`^${pattern}.*$`, 'i');
      } else if (name.includes(' ')) {
        const parts = name.split(' ');
        const pattern = parts.map(p => `(?=.*${p})`).join('');
        searchRegex = new RegExp(`^${pattern}.*$`, 'i');
      } else {
        searchRegex = new RegExp(name, 'i');
      }

      const papers = await ShardaAuthor.find({ authorName: searchRegex }).sort({ year: -1 });

      if (!papers.length) {
        return res.status(404).json({ error: 'Author not found' });
      }

      // 2. Calculate basic stats
      const totalPapers = papers.length;
      const totalCitations = papers.reduce((sum, p) => sum + (p.citedBy || 0), 0);
      const department = papers[0].department || 'NA';

      // 3. Calculate H-Index
      const citations = papers.map(p => p.citedBy || 0).sort((a, b) => b - a);
      let hIndex = 0;
      for (let i = 0; i < citations.length; i++) {
        if (citations[i] >= i + 1) {
          hIndex = i + 1;
        } else {
          break;
        }
      }

      // 4. Yearly Distribution
      const yearlyStats = {};
      papers.forEach(p => {
        const y = p.year || 'Unknown';
        yearlyStats[y] = (yearlyStats[y] || 0) + 1;
      });

      // 5. Quartile Distribution (Enrich with JournalQuartile cache)
      const JournalQuartile = require('../models/JournalQuartile');
      // Fetch all cached quartiles and build a case-insensitive map (only ~3500 records)
      const jqs = await JournalQuartile.find({}).lean();
      const qCache = new Map();
      jqs.forEach(q => qCache.set((q.journalKey || '').toLowerCase().trim(), q.quartile));

      const quartiles = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, NA: 0 };
      papers.forEach(p => {
        const sourceKey = (p.sourcePaper || '').toLowerCase().trim();
        const bestQuartile = p.quartile || qCache.get(sourceKey);

        if (bestQuartile) {
          let q = bestQuartile.toUpperCase().trim();
          if (['Q1', 'Q2', 'Q3', 'Q4'].includes(q)) {
            quartiles[q]++;
          } else {
            quartiles.NA++;
          }
        } else {
          quartiles.NA++;
        }
      });

      // 6. Collaboration Network (Synergy Map) - Chord Diagram Data
      const paperTitles = papers.map(p => p.paperTitle).filter(t => t);

      // Step A: Find top 10 unique Sharda co-authors
      const topCollaborators = await ShardaAuthor.aggregate([
        {
          $match: {
            paperTitle: { $in: paperTitles },
            authorName: { $not: searchRegex } // Exclude the main author flexibly
          }
        },
        {
          $group: {
            _id: { $toLower: "$authorName" }, // Normalize matching casing
            originalNames: { $addToSet: "$authorName" }, // Keep variants to query efficiently later
            department: { $first: "$department" },
            jointWithTarget: { $sum: 1 }
          }
        },
        { $sort: { jointWithTarget: -1 } },
        { $limit: 10 }
      ]).allowDiskUse(true);

      const normalizedMainAuthor = name.toLowerCase();
      // Collect all exact casing variants for efficient indexed querying in Step B
      const mainAuthorOriginalNames = [...new Set(papers.map(p => p.authorName))];
      let allOriginalMemberNames = [...mainAuthorOriginalNames];

      const nodes = [
        { id: normalizedMainAuthor, name: name.toUpperCase(), department: department, isTarget: true, weight: totalPapers }
      ];

      topCollaborators.forEach(c => {
        allOriginalMemberNames.push(...c.originalNames);
        nodes.push({ id: c._id, name: c.originalNames[0], department: c.department || 'NA', weight: c.jointWithTarget });
      });

      // Step B: Find all connections between ANY of these members
      const interConnections = await ShardaAuthor.aggregate([
        {
          $match: {
            authorName: { $in: allOriginalMemberNames }
          }
        },
        {
          $group: {
            _id: "$paperTitle",
            authors: { $addToSet: { $toLower: "$authorName" } } // Map variants to lowercase for connection matrix
          }
        }
      ]).allowDiskUse(true);

      const links = [];
      const linkMap = {};

      interConnections.forEach(paper => {
        const authors = paper.authors;
        for (let i = 0; i < authors.length; i++) {
          for (let j = i + 1; j < authors.length; j++) {
            const pair = [authors[i], authors[j]].sort().join('|');
            linkMap[pair] = (linkMap[pair] || 0) + 1;
          }
        }
      });

      Object.keys(linkMap).forEach(pair => {
        const [a1, a2] = pair.split('|');
        links.push({ source: a1, target: a2, value: linkMap[pair] });
      });

      res.json({
        name,
        department,
        totalPapers,
        totalCitations,
        hIndex,
        yearlyStats,
        quartiles,
        collaborationNetwork: { nodes, links },
        papers
      });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  getAllShardaAuthors: async (req, res) => {
    try {
      console.log('getAllShardaAuthors: Request received for', req.query);
      const { department, search } = req.query;

      const queryKey = `AUTHORS_${department || 'All'}_${search || ''}`;
      cleanExpiredCache();
      if (analyticsCacheMap.has(queryKey)) {
        const cached = analyticsCacheMap.get(queryKey).data;
        return res.json({ success: true, ...cached, fromCache: true });
      }

      // 1. Get base data from RAM Buffer (awaits promise if loading)
      console.log('getAllShardaAuthors: Waiting for RAM Buffer...');
      const sourceData = await getRAMBuffer();
      console.log(`getAllShardaAuthors: RAM Buffer fetched, length=${sourceData.length}`);

      // 2. Filter papers in memory
      let filteredPapers = sourceData;

      let deptFuzzyPattern = null;
      if (department && department !== 'All') {
        const cleanFilter = department.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        deptFuzzyPattern = new RegExp(cleanFilter.replace(/department of /i, '').replace(/ & /g, '.*').replace(/ and /g, '.*').trim(), 'i');
      }

      // 3. Extract matching unique authors and map their papers
      console.log('getAllShardaAuthors: Starting author extraction...');
      console.time('getAllShardaAuthors_Map');
      const authorMap = new Map();

      filteredPapers.forEach(paper => {
        paper.authors.forEach(author => {
          // If searching, skip non-matching names
          if (search) {
            const lowerName = (author.authorName || '').toLowerCase();
            if (!lowerName.includes(search.toLowerCase())) return;
          }

          // Force Sharda check: skip any external co-authors
          // We MUST use strict boolean to prevent external "Department of Computer Science" from being flagged
          if (author.isSharda !== true) return;

          // If filtering by dept, only include authors from that dept
          if (deptFuzzyPattern) {

            if (!author.department || !deptFuzzyPattern.test(author.department)) {
              return;
            }
          }

          const normDept = normalizeDept(author.department) || 'NA';
          const key = author.scopusId 
            ? `SID_${author.scopusId}` 
            : getUnifiedAuthorKey(author.authorName, normDept, author.email, true);

          if (!authorMap.has(key)) {
            authorMap.set(key, {
              authorName: author.authorName,
              department: normDept,
              scopusId: author.scopusId,
              year: paper.year, // latest year approximation
              allPaperTitles: new Set(),
              allPaperNames: new Set(),
              allPaperTypes: new Set()
            });
          }

          const group = authorMap.get(key);
          
          // If this entry has a longer name, use it as the representative name
          if (author.authorName && author.authorName.length > (group.authorName || '').length) {
            group.authorName = author.authorName;
          }

          if (!group.scopusId && author.scopusId) group.scopusId = author.scopusId;
          if (paper.paperTitle) group.allPaperTitles.add(paper.paperTitle);
          if (paper.sourcePaper || paper.publisher) group.allPaperNames.add(paper.sourcePaper || paper.publisher);
          if (paper.paperType) group.allPaperTypes.add(paper.paperType);

          if (paper.year > group.year) group.year = paper.year; // Keep latest
        });
      });
      console.timeEnd('getAllShardaAuthors_Map');

      // 4. Transform Sets to Arrays
      console.log(`getAllShardaAuthors: Map complete, size=${authorMap.size}. Transforming sets to arrays...`);
      console.time('getAllShardaAuthors_Transform');
      const processedAuthors = Array.from(authorMap.values()).map(group => ({
        ...group,
        allPaperTitles: Array.from(group.allPaperTitles),
        allPaperNames: Array.from(group.allPaperNames),
        allPaperTypes: Array.from(group.allPaperTypes)
      }));
      console.timeEnd('getAllShardaAuthors_Transform');

      // 5. Sort by year desc, then name asc
      console.log('getAllShardaAuthors: Sorting processed authors...');
      console.time('getAllShardaAuthors_Sort');
      processedAuthors.sort((a, b) => {
        if (b.year !== a.year) return b.year - a.year;
        return (a.authorName || '').localeCompare(b.authorName || '');
      });
      console.timeEnd('getAllShardaAuthors_Sort');

      // 6. Fast department list extraction
      console.log('getAllShardaAuthors: Extracting departments...');
      const deptSet = new Set();
      sourceData.forEach(p => p.authors.forEach(a => {
        if (a.department) deptSet.add(a.department);
      }));
      const departments = Array.from(deptSet).sort();

      const responsePayload = {
        count: processedAuthors.length,
        data: processedAuthors,
        departments
      };

      analyticsCacheMap.set(queryKey, { timestamp: Date.now(), data: responsePayload });

      console.log('getAllShardaAuthors: Done! Sending response...');
      res.json({
        success: true,
        ...responsePayload
      });
    } catch (err) {
      console.error('Error in getAllShardaAuthors:', err);
      res.status(500).json({ success: false, error: 'Failed to fetch authors' });
    }
  },

  getAuthorsFromApi: async (req, res) => {
    try {
      const { start = 0, count = 100, search = '' } = req.query;
      const apiKey = process.env.SCOPUS_API_KEY;
      const affilId = "60108680";
      
      let query = '';
      const trimmedSearch = search.trim();
      
      if (trimmedSearch) {
        // 1. Check if it's a numeric Scopus ID (5-15 digits)
        const isScopusId = /^\d{5,15}$/.test(trimmedSearch);
        
        if (isScopusId) {
          query = `AU-ID(${trimmedSearch})`;
        } else {
          // 2. Name-based search with optimized syntax
          // Using AUTHLAST and AUTHFIRST with broad AFFIL(Sharda) filter
          const parts = trimmedSearch.split(/\s+/).filter(p => !!p);
          if (parts.length >= 2) {
            // "Sudeep Varshney" -> AUTHLAST(Varshney) AND AUTHFIRST(Sudeep) AND AFFIL(Sharda)
            const surname = parts[parts.length - 1];
            const givenName = parts.slice(0, -1).join(' ');
            query = `AUTHLAST(${surname}) AND AUTHFIRST(${givenName}) AND AFFIL(Sharda)`;
          } else {
            // "Varshney" or "Sudeep" alone
            query = `(AUTHLAST(${trimmedSearch}) OR AUTHFIRST(${trimmedSearch})) AND AFFIL(Sharda)`;
          }
        }
      } else {
        // Default: use the main University ID for the base list of 3,442 authors
        query = `AF-ID(${affilId})`;
      }
      
      const url = `https://api.elsevier.com/content/search/author?query=${encodeURIComponent(query)}&start=${start}&count=${count}`;
      
      https.get(url, {
        headers: { 
          "X-ELS-APIKey": apiKey, 
          "Accept": "application/json" 
        }
      }, (apiRes) => {
        let data = "";
        apiRes.on("data", c => data += c);
        apiRes.on("end", async () => {
          try {
            const parsed = JSON.parse(data);
            const searchResults = parsed["search-results"];
            const authors = searchResults?.entry || [];
            
            // Extract all scopusIds to perform a bulk lookup in our DB
            const scopusIds = authors.map(a => a['dc:identifier']?.replace('AUTHOR_ID:', '')).filter(id => !!id);
            
            // Perform bulk query in ShardaAuthor collection (populated from CSVs)
            let matchedDeptMap = {};
            if (scopusIds.length > 0) {
              const matches = await ShardaAuthor.find({
                scopusId: { $in: scopusIds }
              }).select('scopusId department').lean();
              
              // Map: scopusId -> normalizedDepartment
              matches.forEach(m => {
                if (!m.scopusId || !m.department || m.department === 'NA') return;
                // If we haven't found a valid department for this ID yet, or current one is better
                if (!matchedDeptMap[m.scopusId]) {
                  const canonical = normalizeDept(m.department);
                  if (canonical !== 'NA') matchedDeptMap[m.scopusId] = canonical;
                }
              });
            }

            // Inject the matched department into the API author records
            const enrichedAuthors = authors.map(a => {
              const sid = a['dc:identifier']?.replace('AUTHOR_ID:', '');
              const normDept = matchedDeptMap[sid] || 'NA';
              
              return {
                ...a,
                shardaDepartment: normDept,
                // Ensure document-count is easily accessible as the source of truth for counts
                paperCount: parseInt(a['document-count'] || 0)
              };
            });

            res.json({
              success: true,
              data: enrichedAuthors,
              totalResults: parseInt(searchResults?.["opensearch:totalResults"] || 0),
              startIndex: parseInt(searchResults?.["opensearch:startIndex"] || 0),
              itemsPerPage: parseInt(searchResults?.["opensearch:itemsPerPage"] || 0)
            });
          } catch (e) {
            console.error("Error parsing Scopus API response:", e.message);
            res.status(500).json({ success: false, error: "Failed to parse Scopus API response" });
          }
        });
      }).on("error", (err) => {
        console.error("Scopus API Request Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
      });
    } catch (err) {
      console.error("Error in getAuthorsFromApi:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  /**
   * Aggregate data for all authors by department using live Scopus API paper counts
   * Caches results for 1 hour
   */
  getDepartmentApiCounts: async (req, res) => {
    try {
      const apiKey = process.env.SCOPUS_API_KEY;
      const affilId = "60108680";
      const { force = false } = req.query;

      // 1. Try DB first (Directly return if not forcing)
      if (force !== 'true' && force !== true) {
        const { data: dbData, error: dbError } = await supabase
          .from('department_api_stats')
          .select('*')
          .order('total_papers', { ascending: false });

        if (!dbError && dbData && dbData.length > 0) {
          console.log(`[DEPT-DB] Loaded ${dbData.length} records from Supabase.`);
          
          const formatted = dbData.map(d => ({
            department: d.department,
            authorCount: d.author_count,
            totalPapers: d.total_papers,
            authors: [] 
          }));

          return res.json({ success: true, fromDb: true, data: formatted });
        } else if (dbError) {
          console.error("[DEPT-DB] Error querying Supabase:", dbError.message);
        } else {
          // DB is empty and not forcing
          return res.json({ 
            success: true, 
            fromDb: true, 
            data: [], 
            message: "Database is currently empty. Please click 'Update Paper' to synchronize with Scopus." 
          });
        }
      }

      // 2. Only if force is true, we proceed to Scopus API
      console.log("[DEPT-API] Manual Update Triggered: Fetching from Scopus...");
      
      // 2a. Fetch the true unique institutional total from Scopus
      const searchUrl = `https://api.elsevier.com/content/search/scopus?query=AF-ID(${affilId})&count=0`;
      const institutionalStats = await new Promise((resolve) => {
        https.get(searchUrl, { headers: { "X-ELS-APIKey": apiKey, "Accept": "application/json" } }, (res) => {
          let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(JSON.parse(d)));
        }).on("error", () => resolve({}));
      });
      const uniqueInstitutionalTotal = parseInt(institutionalStats?.["search-results"]?.["opensearch:totalResults"] || 9641);
      console.log(`[DEPT-API] Unique Institutional Total Detected: ${uniqueInstitutionalTotal}`);

      // 2b. Load CSV for Scopus ID -> Department mapping
      console.log("[DEPT-API] Loading reference CSV for department matching...");
      const csvSidToDept = {};
      const uploadsDir = path.join(__dirname, '../uploads');
      const csvFiles = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.csv')).map(f => path.join(uploadsDir, f));
      
      // Use the most recent large CSV as the reference
      const referenceCsv = csvFiles.sort((a,b) => fs.statSync(b).mtime - fs.statSync(a).mtime)[0];
      
      if (referenceCsv) {
        console.log(`[DEPT-API] Using reference CSV: ${path.basename(referenceCsv)}`);
        await new Promise((resolve) => {
          fs.createReadStream(referenceCsv)
            .pipe(csv())
            .on('data', (row) => {
              const sidStr = row['Author(s) ID'] || '';
              const affilStr = row['Affiliations'] || row['Authors with affiliations'] || '';
              
              if (sidStr) {
                const sids = sidStr.split(';').map(id => id.trim());
                sids.forEach(sid => {
                  if (!csvSidToDept[sid] && affilStr.toLowerCase().includes('sharda university')) {
                    // Extract department from affiliations
                    const dept = standardizeDepartment(affilStr); 
                    if (dept && dept !== 'NA') {
                      csvSidToDept[sid] = normalizeDept(dept);
                    }
                  }
                });
              }
            })
            .on('end', resolve);
        });
        console.log(`[DEPT-API] Loaded ${Object.keys(csvSidToDept).length} Scopus ID mappings from CSV.`);
      }

      let allAuthors = [];
      let start = 0;
      let count = 200; // Max authors per request
      let totalResults = 1; // dummy start

      // 2c. Fetch ALL authors in batches (targeting 3444)
      while (start < totalResults && allAuthors.length < 5000) {
        const url = `https://api.elsevier.com/content/search/author?query=AF-ID(${affilId})&start=${start}&count=${count}`;
        
        const responseData = await new Promise((resolve, reject) => {
          https.get(url, {
            headers: { "X-ELS-APIKey": apiKey, "Accept": "application/json" }
          }, (apiRes) => {
            let data = "";
            apiRes.on("data", c => data += c);
            apiRes.on("end", () => resolve(JSON.parse(data)));
          }).on("error", reject);
        });

        const results = responseData["search-results"];
        const entries = results?.entry || [];
        allAuthors = allAuthors.concat(entries);
        totalResults = parseInt(results?.["opensearch:totalResults"] || 3444);
        start += count;
        
        console.log(`[DEPT-API] Downloaded ${allAuthors.length}/${totalResults} authors...`);
        // Small delay to respect rate limits
        if (start < totalResults) await new Promise(r => setTimeout(r, 200));
      }

      console.log(`[DEPT-API] Completed fetching ${allAuthors.length} authors. Enrichment starting...`);

      // 3. Map to departments using CSV + DB fallback
      const scopusIds = allAuthors.map(a => a['dc:identifier']?.replace('AUTHOR_ID:', '')).filter(id => !!id);
      const dbMatches = await ShardaAuthor.find({ scopusId: { $in: scopusIds } }).select('scopusId department').lean();
      
      const dbSidToDept = {};
      dbMatches.forEach(m => {
        if (!m.scopusId || !m.department || m.department === 'NA') return;
        const canonical = normalizeDept(m.department);
        if (canonical !== 'NA') dbSidToDept[m.scopusId] = canonical;
      });

      // 4. Aggregate
      const departmentGroups = {};
      
      allAuthors.forEach(a => {
        const sid = a['dc:identifier']?.replace('AUTHOR_ID:', '');
        // Priority: 1. CSV Mapping, 2. DB Mapping, 3. NA
        const deptName = csvSidToDept[sid] || dbSidToDept[sid] || 'NA';
        const docCount = parseInt(a['document-count'] || 0);
        
        if (!departmentGroups[deptName]) {
          departmentGroups[deptName] = {
            department: deptName,
            authorCount: 0,
            totalPapers: 0,
            authors: []
          };
        }
        
        const name = (a['preferred-name']?.['given-name'] || '') + ' ' + (a['preferred-name']?.['surname'] || '');
        departmentGroups[deptName].authorCount++;
        departmentGroups[deptName].totalPapers += docCount;
        departmentGroups[deptName].authors.push({
          name: name.trim() || 'Unknown',
          scopusId: sid,
          paperCount: docCount
        });
      });

      // Sort authors by paper count within each department
      Object.values(departmentGroups).forEach(group => {
        group.authors.sort((a, b) => b.paperCount - a.paperCount);
      });

      // Sort departments by total papers
      const resultData = Object.values(departmentGroups).sort((a, b) => b.totalPapers - a.totalPapers);

      // 5. Update Cache
      deptApiCacheMap.set('all_depts', {
        timestamp: Date.now(),
        data: resultData
      });

      res.json({ success: true, fromCache: false, data: resultData });

      // 6. Sync to PostgreSQL in background
      (async () => {
        try {
          // Pass the unique institutional total to syncToPostgres
          await syncToPostgres(resultData, force, uniqueInstitutionalTotal);
          console.log(`[POSTGRES] Successfully synced ${resultData.length} departments to Supabase.`);
        } catch (err) {
          console.error('[POSTGRES] Background sync failed:', err.message);
        }
      })();

    } catch (err) {
      console.error("Error in getDepartmentApiCounts:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  /**
   * Fetch all papers for a specific Scopus Author ID
   * @route GET /api/papers/author-papers/:scopusId
   */
  getAuthorPapersFromApi: async (req, res) => {
    try {
      const { scopusId } = req.params;
      const { start = 0, count = 100 } = req.query;
      const apiKey = process.env.SCOPUS_API_KEY;
      
      if (!scopusId) {
        return res.status(400).json({ success: false, message: "Scopus Author ID is required" });
      }

      // Query for papers where AU-ID matches
      const query = `AU-ID(${scopusId})`;
      const url = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent(query)}&start=${start}&count=${count}&sort=coverDate`;

      https.get(url, {
        headers: { 
          "X-ELS-APIKey": apiKey, 
          "Accept": "application/json" 
        }
      }, (apiRes) => {
        let data = "";
        apiRes.on("data", c => data += c);
        apiRes.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const searchResults = parsed["search-results"];
            const papers = searchResults?.entry || [];
            
            res.json({
              success: true,
              data: papers,
              totalResults: parseInt(searchResults?.["opensearch:totalResults"] || "0")
            });
          } catch (e) {
            console.error("Error parsing Scopus papers response:", e);
            res.status(500).json({ success: false, message: "Error parsing Scopus response" });
          }
        });
      }).on("error", (err) => {
        console.error("Scopus papers API request error:", err);
        res.status(500).json({ success: false, message: "Scopus API request failed" });
      });
    } catch (error) {
      console.error("Internal server error in getAuthorPapersFromApi:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Fetch papers for a list of Scopus Author IDs (for a department)
   * @route POST /api/papers/department-papers-api
   */
  getDepartmentPapersFromApi: async (req, res) => {
    try {
      const { scopusIds, start = 0, count = 100 } = req.body;
      const apiKey = process.env.SCOPUS_API_KEY;

      if (!scopusIds || !Array.isArray(scopusIds) || scopusIds.length === 0) {
        return res.status(400).json({ success: false, message: "Scopus IDs array is required" });
      }

      // 1. Build AU-ID query (batching up to 50 authors)
      const queryIds = scopusIds.slice(0, 50).map(id => `AU-ID(${id})`).join(' OR ');
      const query = `(${queryIds})`;
      
      const url = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent(query)}&start=${start}&count=${count}&sort=coverDate`;

      https.get(url, {
        headers: { "X-ELS-APIKey": apiKey, "Accept": "application/json" }
      }, (apiRes) => {
        let data = "";
        apiRes.on("data", c => data += c);
        apiRes.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const results = parsed["search-results"];
            const entries = results?.entry || [];
            
            const papers = entries.map(e => ({
              title: e["dc:title"] || 'Untitled',
              authors: e["dc:creator"] || 'Unknown',
              journal: e["prism:publicationName"] || 'N/A',
              date: e["prism:coverDate"] || 'N/A',
              year: e["prism:coverDate"] ? e["prism:coverDate"].substring(0, 4) : 'N/A',
              scopusId: e["dc:identifier"]?.replace("SCOPUS_ID:", "")
            }));

            res.json({
              success: true,
              total: parseInt(results?.["opensearch:totalResults"] || 0),
              data: papers
            });
          } catch (err) {
            console.error("Scopus parse error:", err.message);
            res.status(500).json({ success: false, error: "Failed to parse Scopus response" });
          }
        });
      }).on("error", (err) => {
        res.status(500).json({ success: false, error: err.message });
      });

    } catch (err) {
      console.error("Error in getDepartmentPapersFromApi:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  getDepartments: async (req, res) => {
    const departments = await ShardaAuthor.distinct('department');
    res.json({ success: true, count: departments.length, data: departments });
  },

  /**
   * Get department details (authors and papers) from PostgreSQL/Supabase
   * @route GET /api/papers/department-details-db/:department
   */
  getDepartmentDetailsFromDb: async (req, res) => {
    try {
      const { department } = req.params;
      if (!department) return res.status(400).json({ success: false, message: "Department name missing" });

      // Fetch Authors
      const { data: authors, error: authError } = await supabase
        .from('department_authors')
        .select('*')
        .eq('department', department)
        .order('paper_count', { ascending: false });

      // Fetch Papers
      const { data: papers, error: paperError } = await supabase
        .from('department_papers')
        .select('*')
        .eq('department', department)
        .order('year', { ascending: false })
        .limit(100);

      if (authError || paperError) throw (authError || paperError);

      res.json({
        success: true,
        data: {
          authors: authors.map(a => ({ name: a.name, scopusId: a.scopus_id, paperCount: a.paper_count })),
          papers: papers.map(p => ({ title: p.title, authors: p.authors, journal: p.journal, year: p.year, scopusId: p.scopus_id }))
        }
      });

    } catch (err) {
      console.error('[SUPABASE] Fetch Details Error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  downloadCSV: async (req, res) => {
    const authors = await ShardaAuthor.find().sort({ authorName: 1 });
    const fields = ['authorName', 'department', 'paperTitle', 'sourcePaper', 'year', 'paperType'];
    const fieldNames = ['Author Name', 'Department', 'Paper Title', 'Source', 'Year', 'Paper Type'];
    const parser = new Parser({ fields, header: true, fields: fields, defaultValue: '' });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=sharda_authors_departments.csv');

    // Create custom CSV with proper headers
    const csvData = 'Author Name,Department,Paper Title,Source,Year,Paper Type\n' +
      authors.map(a => `"${formatAuthorName(a.authorName)}","${a.department}","${(a.paperTitle || '').replace(/"/g, '""')}","${(a.sourcePaper || '').replace(/"/g, '""')}",${a.year || ''},"${(a.paperType || '').replace(/"/g, '""')}"`).join('\n');

    res.send(csvData);
  },

  downloadQuartileStats: async (req, res) => {
    try {
      const { department, startDate, endDate } = req.query;
      const allPapersMemory = await getRAMBuffer();
      
      const JournalQuartile = require('../models/JournalQuartile');
      const jqs = await JournalQuartile.find({}).lean();
      const qCache = new Map();
      jqs.forEach(q => qCache.set((q.journalKey || '').toLowerCase().trim(), q.quartile));

      // ── Apply Filtering Logic (mirrors getAnalytics) ──
      const hasDateFilter = !!(startDate || endDate);
      const sDate = startDate ? new Date(startDate) : null;
      const eDate = endDate ? new Date(endDate) : null;
      const yStart = sDate ? sDate.getFullYear() : 0;
      const yEnd = eDate ? eDate.getFullYear() : 9999;

      const hasDeptFilter = !!(department && department !== 'All');
      let deptFuzzyPattern = null;
      if (hasDeptFilter) {
        const cleanFilter = department.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        deptFuzzyPattern = new RegExp(cleanFilter.replace(/department of /i, '').replace(/ & /g, '.*').replace(/ and /g, '.*').trim(), 'i');
      }

      const papers = allPapersMemory.filter(p => {
        // Date Filter
        if (hasDateFilter) {
          const pDate = p.publicationDate ? new Date(p.publicationDate) : null;
          const pYear = p.year || 0;
          let dateMatch = false;
          if (pDate) {
            if ((!sDate || pDate >= sDate) && (!eDate || pDate <= eDate)) dateMatch = true;
          } else if (p.year) {
            if (pYear >= yStart && pYear <= yEnd) dateMatch = true;
          }
          if (!dateMatch) return false;
        }

        // Department Filter
        if (hasDeptFilter) {
          let deptMatch = false;
          if (p.authors && p.authors.length) {
            for (const a of p.authors) {
              if (a.department && deptFuzzyPattern.test(a.department)) { deptMatch = true; break; }
            }
          }
          if (!deptMatch) return false;
        }
        return true;
      });

      const departmentStats = {};

      papers.forEach(p => {
        const source = p.sourcePaper || p.publisher || 'Unknown';
        const sourceKey = source.toLowerCase().trim();
        const q = (p.quartile || qCache.get(sourceKey) || 'NA').toUpperCase().trim();

        const paperDepts = new Set();
        (p.authors || []).forEach(a => {
          if (!a.authorName || !a.isSharda) return;
          const normDept = normalizeDept(a.department) || 'NA';
          paperDepts.add(normDept);
        });

        paperDepts.forEach(dept => {
          if (!departmentStats[dept]) {
            departmentStats[dept] = { department: dept, paperCount: 0, quartiles: { Q1: 0, Q2: 0, Q3: 0, Q4: 0, NA: 0 } };
          }
          departmentStats[dept].paperCount++;
          departmentStats[dept].quartiles[q] = (departmentStats[dept].quartiles[q] || 0) + 1;
        });
      });


      const csvRows = [
        'Department,Total Papers,Q1,Q2,Q3,Q4,Others,Q1 %,Q2 %,Q3 %,Q4 %'
      ];

      Object.values(departmentStats)
        .sort((a, b) => b.paperCount - a.paperCount)
        .forEach(d => {
          const total = d.paperCount;
          const q = d.quartiles;
          const q1p = total > 0 ? ((q.Q1 / total) * 100).toFixed(1) : '0.0';
          const q2p = total > 0 ? ((q.Q2 / total) * 100).toFixed(1) : '0.0';
          const q3p = total > 0 ? ((q.Q3 / total) * 100).toFixed(1) : '0.0';
          const q4p = total > 0 ? ((q.Q4 / total) * 100).toFixed(1) : '0.0';

          csvRows.push(`"${d.department}",${total},${q.Q1},${q.Q2},${q.Q3},${q.Q4},${q.NA},${q1p}%,${q2p}%,${q3p}%,${q4p}%`);
        });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=sharda_department_quartiles.csv');
      res.send(csvRows.join('\n'));
    } catch (err) {
      console.error('Error in downloadQuartileStats:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },


  clearAuthors: async (req, res) => {
    try {
      console.log('Exhaustively clearing all paper and author data...');

      // 1. Clear all database collections
      await ShardaAuthor.deleteMany({});
      await ConsolidatedPaper.deleteMany({});
      await SystemStat.deleteMany({});

      // 2. Reset In-Memory RAM Buffer (The "fast" dashboard cache)
      resetRAMBuffer();

      // 3. Clear Analytics Cache Map
      clearAnalyticsCache();

      // 4. Force a sync (even though we cleared, to ensure collections exist)
      await syncConsolidatedPapers();

      res.json({
        success: true,
        message: 'All paper data, author records, and statistics have been completely cleared.'
      });
    } catch (err) {
      console.error('Error during Clear Data:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  /* ======================================================
     CONSOLIDATED PAPERS ENDPOINT
  ======================================================= */

  /**
   * Get consolidated papers with authors grouped by paper
   * Each paper has up to 3 authors with their departments
   * Supports filtering by department, year, and paper type
   *
   * @route   GET /api/papers/consolidated
   * @query   department - Filter by department (optional)
   * @query   year - Filter by publication year (optional)
   * @query   paperType - Filter by paper type (optional)
   * @query   search - Search in paper title (optional)
   * @query   startDate - Filter by publication start date (optional)
   * @query   endDate - Filter by publication end date (optional)
   * @desc    Get all papers with consolidated author columns (Author 1, 2, 3)
   * @access  Public
   */
  getConsolidatedPapers: async (req, res) => {
    try {
      const { department, year, paperType, search, startDate, endDate, page = 1, limit = 50 } = req.query;
      const pPage = parseInt(page, 10);
      const pLimit = parseInt(limit, 10);

      // Build match conditions for filtering
      const matchConditions = {};

      if (department && department !== 'All') {
        const cleanFilter = department.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let fuzzyPattern = cleanFilter.replace(/department of /i, '').replace(/ & /g, '.*').replace(/ and /g, '.*').trim();
        matchConditions['authors.department'] = { $regex: new RegExp(fuzzyPattern, 'i') };
      }

      if (year) matchConditions.year = parseInt(year, 10);
      if (paperType && paperType !== 'All') matchConditions.paperType = paperType;

      if (startDate || endDate) {
        const dateQuery = {};
        const startD = startDate ? new Date(startDate) : null;
        const endD = endDate ? new Date(endDate) : null;

        if (startD) dateQuery.$gte = startD;
        if (endD) dateQuery.$lte = endD;

        if (startD || endD) {
          const startYear = (startD || endD).getFullYear();
          const endYear = (endD || startD).getFullYear();

          matchConditions.$or = [
            { publicationDate: dateQuery },
            {
              publicationDate: { $in: [null, undefined] },
              year: { $gte: startYear, $lte: endYear }
            }
          ];
        }
      }

      if (search) {
        const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const searchOr = [
          { paperTitle: { $regex: searchRegex } },
          { sourcePaper: { $regex: searchRegex } },
          { publisher: { $regex: searchRegex } },
          { 'authors.authorName': { $regex: searchRegex } }
        ];

        if (matchConditions.$or) {
          matchConditions.$and = [{ $or: matchConditions.$or }, { $or: searchOr }];
          delete matchConditions.$or;
        } else {
          matchConditions.$or = searchOr;
        }
      }

      // Fast native MongoDB querying against the materialized view
      const totalCount = await ConsolidatedPaper.countDocuments(matchConditions);
      const startIndex = (pPage - 1) * pLimit;

      const results = await ConsolidatedPaper.find(matchConditions)
        .sort({ year: -1, paperTitle: 1 })
        .skip(startIndex)
        .limit(pLimit)
        .lean();

      // Transform exactly to the format frontend expects
      const paginatedPapers = results.map(paper => {
        // De-duplicate authors within the same paper (they are collected by $push which includes dupes if ShardaAuthor had multiple same-author rows)
        const uniqueAuthors = [];
        const seenAuthorNames = new Set();
        for (const a of (paper.authors || [])) {
          if (!seenAuthorNames.has(a.authorName)) {
            seenAuthorNames.add(a.authorName);
            uniqueAuthors.push(a);
          }
        }

        return {
          paperTitle: paper.paperTitle,
          year: paper.year,
          sourcePaper: paper.sourcePaper,
          publisher: paper.publisher,
          doi: paper.doi,
          paperType: paper.paperType,
          link: paper.link,
          quartile: paper.quartile,
          citedBy: paper.citedBy,
          publicationDate: paper.publicationDate,
          authors: uniqueAuthors,
          authorCount: uniqueAuthors.length,
          author1: uniqueAuthors[0] || null,
          author2: uniqueAuthors[1] || null,
          author3: uniqueAuthors[2] || null
        };
      });

      // To keep filters fully accurate but ultra fast, we can aggregate metadata from ConsolidatedPaper
      // However doing it for every page request is slow. We can just pull basic distinct ranges if needed.
      const uniqueYearsResp = await ConsolidatedPaper.distinct('year');
      const uniqueTypesResp = await ConsolidatedPaper.distinct('paperType');

      const uniqueYears = uniqueYearsResp.filter(y => y != null).sort((a, b) => b - a);
      const uniqueTypes = uniqueTypesResp.filter(t => t != null && t.trim() !== '').sort();

      res.json({
        success: true,
        count: totalCount,
        page: pPage,
        limit: pLimit,
        totalPages: Math.ceil(totalCount / pLimit),
        data: paginatedPapers,
        filters: {
          years: uniqueYears,
          paperTypes: uniqueTypes
        }
      });
    } catch (err) {
      console.error('getConsolidatedPapers Error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  /**
   * Dedicated search endpoint for searching papers
   * Returns only matched papers (first 10) for the popup
   *
   * @route   GET /api/papers/search
   * @query   q - Search query
   * @desc    Search papers by query string
   * @access  Public
   */
  searchPapers: async (req, res) => {
    try {
      const { q } = req.query;

      if (!q || !q.trim()) {
        return res.json({ success: true, data: [], count: 0 });
      }

      const searchRegex = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

      const searchOr = [
        { paperTitle: { $regex: searchRegex } },
        { sourcePaper: { $regex: searchRegex } },
        { publisher: { $regex: searchRegex } },
        { 'authors.authorName': { $regex: searchRegex } }
      ];

      const rawResults = await ConsolidatedPaper.find({ $or: searchOr })
        .sort({ paperTitle: 1 })
        .limit(10)
        .lean();

      const limitedResults = rawResults.map(paper => {
        const uniqueAuthors = [];
        const seenAuthorNames = new Set();
        for (const a of (paper.authors || [])) {
          if (!seenAuthorNames.has(a.authorName)) {
            seenAuthorNames.add(a.authorName);
            uniqueAuthors.push(a);
          }
        }
        return {
          ...paper,
          authors: uniqueAuthors,
          author1: uniqueAuthors[0] || null,
          author2: uniqueAuthors[1] || null,
          author3: uniqueAuthors[2] || null
        };
      });

      console.log(`Search query: "${q}" - Found ${limitedResults.length} initial limits`);

      res.json({
        success: true,
        count: limitedResults.length,
        total: await ConsolidatedPaper.countDocuments({ $or: searchOr }),
        data: limitedResults
      });
    } catch (err) {
      console.error('Search error:', err);
      res.status(500).json({ error: err.message });
    }
  },

  /**
   * Download consolidated papers as CSV
   * Columns: Paper Title, Year, Source, Publisher, DOI, Paper Type,
   *          Author 1, Department 1, Author 2, Department 2, Author 3, Department 3
   *
   * @route   GET /api/papers/download/consolidated
   * @desc    Download consolidated papers CSV with author columns
   * @access  Public
   */
  downloadConsolidatedCSV: async (req, res) => {
    try {
      // Use .find().lean() instead of .aggregate() to bypass Atlas M0 memory limits
      const rawRecords = await ShardaAuthor.find({}).lean();

      // Group papers and consolidate authors in Node.js
      const paperMap = new Map();

      rawRecords.forEach(record => {
        const key = `${record.paperTitle}|${record.year}|${record.sourcePaper}|${record.publisher}|${record.doi}|${record.paperType}|${record.link}|${record.quartile}`;

        if (!paperMap.has(key)) {
          paperMap.set(key, {
            paperTitle: record.paperTitle,
            year: record.year,
            sourcePaper: record.sourcePaper,
            publisher: record.publisher,
            doi: record.doi,
            paperType: record.paperType,
            link: record.link,
            quartile: record.quartile,
            citedBy: 0,
            authors: []
          });
        }

        const paper = paperMap.get(key);
        if ((record.citedBy || 0) > paper.citedBy) {
          paper.citedBy = record.citedBy || 0;
        }

        paper.authors.push({
          authorName: record.authorName,
          department: record.department
        });
      });

      // Transform to array and sort by paper title
      const papers = Array.from(paperMap.values()).sort((a, b) => {
        const titleA = a.paperTitle || '';
        const titleB = b.paperTitle || '';
        return titleA.localeCompare(titleB);
      });

      // 1. Calculate max authors to determine how many columns we need
      let maxAuthors = 0;
      papers.forEach(p => {
        if (p.authors && p.authors.length > maxAuthors) {
          maxAuthors = p.authors.length;
        }
      });

      // Ensure at least 1 set of columns if no authors found (unlikely but safe)
      if (maxAuthors === 0) maxAuthors = 1;

      // 2. Generate dynamic headers
      const headers = [
        'Paper Title',
        'Year',
        'Source',
        'Publisher',
        'DOI',
        'Link',
        'Paper Type',
        'Quartile',
        'Cited By'
      ];

      for (let i = 1; i <= maxAuthors; i++) {
        headers.push(`Author ${i}`);
        headers.push(`Department ${i}`);
      }

      // 3. Generate CSV content
      const csvContent = [
        headers.join(','),
        ...papers.map(p => {
          // Base columns
          const row = [
            `"${(p.paperTitle || '').replace(/"/g, '""')}"`,
            p.year || '',
            `"${(p.sourcePaper || p.publisher || '').replace(/"/g, '""')}"`,
            `"${(p.publisher || '').replace(/"/g, '""')}"`,
            `"${(p.doi || '').replace(/"/g, '""')}"`,
            `"${(p.link || '').replace(/"/g, '""')}"`,
            `"${(p.paperType || '').replace(/"/g, '""')}"`,
            `"${p.quartile || ''}"`,
            p.citedBy || 0
          ];

          // Dynamic author columns
          for (let i = 0; i < maxAuthors; i++) {
            const author = p.authors && p.authors[i];
            if (author) {
              row.push(`"${(formatAuthorName(author.authorName) || '').replace(/"/g, '""')}"`);
              row.push(`"${(author.department || '').replace(/"/g, '""')}"`);
            } else {
              row.push('""'); // Empty Author Name
              row.push('""'); // Empty Department
            }
          }

          return row.join(',');
        })
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=sharda_papers_consolidated.csv');
      res.send(csvContent);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  /**
   * Save papers fetched from Scopus API to database
   * Converts Scopus paper format to ShardaAuthor documents
   *
   * @route   POST /api/papers/scopus
   * @body    papers - Array of papers from Scopus
   * @desc    Save Scopus papers to database
   * @access  Public
   */
  saveScopusPapers: async (req, res) => {
    try {
      const { papers } = req.body;

      if (!papers || !Array.isArray(papers) || papers.length === 0) {
        return res.status(400).json({ success: false, error: 'No papers provided' });
      }

      // Convert Scopus papers to ShardaAuthor format
      const shardaAuthors = [];
      const seenPairs = new Set();

      for (const paper of papers) {
        const authors = paper.authors || [];

        for (const author of authors) {
          if (!author.authorName) continue;

          const authorName = author.authorName.trim();
          const department = author.department || '';
          const pairKey = `${authorName.toLowerCase()}|${department.toLowerCase()}`;

          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);

          shardaAuthors.push({
            authorName,
            department,
            sourcePaper: paper.sourcePaper || '',
            publisher: paper.publisher || '',
            paperTitle: paper.paperTitle || '',
            year: paper.year || null,
            paperType: paper.paperType || '',
            citedBy: paper.citedBy || 0,
            link: paper.link || paper.doi ? `https://doi.org/${paper.doi}` : '',
            doi: paper.doi || ''
          });
        }
      }

      // Clear existing authors and insert new ones
      await ShardaAuthor.deleteMany({});
      const saved = await ShardaAuthor.insertMany(shardaAuthors);

      console.log(`Saved ${saved.length} Scopus papers to database`);
      await syncConsolidatedPapers();

      res.json({
        success: true,
        message: `Saved ${saved.length} papers to database`,
        count: saved.length
      });
    } catch (err) {
      console.error('Error saving Scopus papers:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  /**
   * Get Scopus API key from environment variables
   *
   * @route   GET /api/papers/scopus-key
   * @desc    Get Scopus API key from environment
   * @access  Public
   */
  getScopusApiKey: async (req, res) => {
    try {
      const apiKey = process.env.SCOPUS_API_KEY;

      if (!apiKey) {
        return res.status(404).json({
          success: false,
          error: 'Scopus API key not found in environment variables'
        });
      }

      res.json({
        success: true,
        apiKey: apiKey
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  /**
   * Look up author departments by name
   * Used by Scopus fetch to match authors with their departments from database
   *
   * @route   POST /api/papers/authors/batch
   * @desc    Get departments for a list of author names
   * @access  Public
   * @body    authors - Array of author names to look up
   */
  getAuthorDepartments: async (req, res) => {
    try {
      const { authors } = req.body;

      if (!authors || !Array.isArray(authors) || authors.length === 0) {
        return res.json({ success: true, data: {} });
      }

      // Get unique author names (trimmed and non-empty)
      const uniqueNames = [...new Set(authors.filter(name => name && name.trim()))];

      if (uniqueNames.length === 0) {
        return res.json({ success: true, data: {} });
      }

      console.log(`Looking up departments for ${uniqueNames.length} unique authors`);

      // Query database for these authors using case-insensitive regex for each name
      // Try exact match first, then partial match
      const authorRecords = await ShardaAuthor.find({
        authorName: { $in: uniqueNames.map(name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) }
      }).select('authorName department -_id').lean();

      // If no exact matches found, try partial matching (first name or last name)
      let result = {};
      for (const record of authorRecords) {
        if (record.authorName) {
          const lowerName = record.authorName.toLowerCase().trim();
          result[lowerName] = record.department || '';
        }
      }

      // If we didn't find all authors, try partial matching
      if (authorRecords.length < uniqueNames.length) {
        console.log('Partial matching needed - fetching all authors from database');
        const allDbAuthors = await ShardaAuthor.find({}).select('authorName department -_id').lean();

        for (const queryName of uniqueNames) {
          const queryNameLower = queryName.toLowerCase().trim();

          // Skip if already found
          if (result[queryNameLower]) continue;

          // Try to find partial match
          for (const dbAuthor of allDbAuthors) {
            if (dbAuthor.authorName) {
              const dbNameLower = dbAuthor.authorName.toLowerCase();

              // Check if query name contains db name or vice versa (partial match)
              if (queryNameLower.includes(dbNameLower) ||
                dbNameLower.includes(queryNameLower) ||
                // Also try matching by splitting into parts
                queryNameLower.split(' ').some(part =>
                  part.length > 2 && dbNameLower.includes(part)
                )) {
                result[queryNameLower] = dbAuthor.department || '';
                console.log(`Partial match: "${queryName}" matched with "${dbAuthor.authorName}" -> "${dbAuthor.department}"`);
                break;
              }
            }
          }
        }
      }

      console.log(`Found ${authorRecords.length} author matches out of ${uniqueNames.length} queries`);
      console.log('Sample matches:', authorRecords.slice(0, 3).map(a => ({ name: a.authorName, dept: a.department })));

      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      console.error('Error looking up author departments:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  mapDepartmentsToAuthors: async (req, res) => {
    try {
      const teachers = await Teacher.find({}).lean();
      const authors = await ShardaAuthor.find({});

      console.log(`Re-mapping ${authors.length} authors against ${teachers.length} teachers...`);

      let updateCount = 0;
      const operations = [];

      for (const author of authors) {
        const matchedTeacher = teachers.find(t => matchNames(t.name, author.authorName));
        if (matchedTeacher && matchedTeacher.department !== author.department) {
          operations.push({
            updateOne: {
              filter: { _id: author._id },
              update: { $set: { department: matchedTeacher.department } }
            }
          });
          updateCount++;
        }
      }

      if (operations.length > 0) {
        await ShardaAuthor.bulkWrite(operations);
      }

      // Clear cache and trigger sync in background
      clearAnalyticsCache();

      res.json({
        success: true,
        message: `Department mapping update initiated. Updates are being processed and propagated in the background.`,
        updateCount
      });

      // BACKGROUND WORK
      (async () => {
        try {
          const propagatedCount = await propagateDepartments();
          await syncConsolidatedPapers();
          console.log(`[BACKGROUND-MAP] Propagated to ${propagatedCount} papers and synced consolidated view.`);
        } catch (err) {
          console.error('[BACKGROUND-MAP] Sync failed:', err.message);
        }
      })();
    } catch (err) {
      console.error('Error in mapDepartmentsToAuthors:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  }
};

// Export individual functions for startup use
module.exports.autoEnrichMissingDates = module.exports.autoEnrichMissingDates;
module.exports.enrichAuthorsWithDatesInBackground = enrichAuthorsWithDatesInBackground;
module.exports.syncConsolidatedPapers = syncConsolidatedPapers;

module.exports.getAnalytics = module.exports.getAnalytics || {}; // Assuming defined previously in file via module.exports.getAnalytics = 
module.exports.clearAnalyticsCache = clearAnalyticsCache;
module.exports.propagateDepartments = propagateDepartments;
module.exports.processCSV = async (req, res) => { /* internal logic defined in file */ }; 
module.exports.ShardaAuthor = ShardaAuthor;


