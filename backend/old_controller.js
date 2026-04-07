const fs = require('fs');
const csv = require('csv-parser');
const { Parser } = require('json2csv');
const stream = require('stream');
const ShardaAuthor = require('../models/ShardaAuthor');

// Pre-compiled lowercase string for faster checking
const SHARDA_UNIVERSITY = 'sharda university';

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

/* ======================================================
   SHARDA EXTRACTOR - OPTIMIZED
====================================================== */

/**
 * Extract Sharda authors and their departments from author entries.
 * Optimized version with Set for O(1) duplicate checking.
 *
 * @param {string[]} entries - Array of author entries
 * @param {Object} paperData - Paper metadata (sourcePaper, publisher, paperTitle, year, paperType, citedBy)
 * @returns {Object[]} - Array of { authorName, department, sourcePaper, publisher, paperTitle, year, paperType, citedBy }
 */
const extractShardaAuthors = (entries, paperData) => {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const results = [];
  const seenPairs = new Set(); // O(1) duplicate checking
  const { sourcePaper, publisher, paperTitle, year, paperType, citedBy, link } = paperData;

  // Pre-compute defaults
  const finalSource = sourcePaper || publisher || '';
  const finalTitle = paperTitle || '';
  const finalLink = link || '';

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry !== 'string') continue;

    const lowerEntry = entry.toLowerCase();
    if (!lowerEntry.includes(SHARDA_UNIVERSITY)) continue;

    // Find "Sharda University" position
    const shardaPos = lowerEntry.indexOf(SHARDA_UNIVERSITY);
    const beforeSharda = entry.substring(0, shardaPos).trim();
    if (!beforeSharda) continue;

    const parts = beforeSharda.split(',');
    const len = parts.length;

    let authorName = '';
    let department = '';

    if (len >= 2) {
      authorName = `${parts[len - 2].trim()}, ${parts[len - 1].trim()}`;
      // Build department from remaining parts
      for (let j = 0; j < len - 2; j++) {
        const trimmed = parts[j].trim();
        if (trimmed) {
          department += (department ? ', ' : '') + trimmed;
        }
      }
    } else if (len === 1) {
      authorName = parts[0].trim();
    }

    if (!authorName) continue;
    if (!department) department = 'General';

    const pairKey = `${authorName.toLowerCase()}|${department.toLowerCase()}`;
    if (seenPairs.has(pairKey)) continue;

    seenPairs.add(pairKey);
    results.push({
      authorName,
      department,
      sourcePaper: finalSource,
      publisher: publisher || '',
      paperTitle: finalTitle,
      year: year || null,
      paperType: paperType || '',
      citedBy: citedBy ?? 0,
      link: finalLink
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
const processCSV = (fileBuffer) => {
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    let processedCount = 0;
    let shardaAuthorCount = 0;
    let papersWithSharda = 0;

    // Reset column cache for each file
    columnIndices = null;

    const bufferStream = new stream.PassThrough();
    bufferStream.end(fileBuffer);

    bufferStream
      .pipe(csv({
        mapHeaders: ({ header }) => header.trim().toLowerCase().replace(/["']/g, '').replace(/\s+/g, '_'),
        skipLines: 0,
        strict: false,
        maxRowBytes: 10 * 1024 * 1024 // 10MB max row size
      }))
      .on('data', (row) => {
        try {
          processedCount++;

          // Cache column indices on first row
          if (processedCount === 1) {
            const keys = Object.keys(row);
            columnIndices = {
              title: keys.findIndex(k => k.toLowerCase() === 'title'),
              authors: keys.findIndex(k =>
                k.toLowerCase().includes('author') &&
                k.toLowerCase().includes('affiliation')
              ),
              year: keys.findIndex(k => k.toLowerCase() === 'year'),
              source: keys.findIndex(k =>
                k.toLowerCase() === 'source_title' ||
                k.toLowerCase() === 'source' ||
                k.toLowerCase() === 'journal'
              ),
              publisher: keys.findIndex(k =>
                k.toLowerCase() === 'publisher' ||
                k.toLowerCase().includes('publisher')
              ),
              paperType: keys.findIndex(k =>
                k.toLowerCase() === 'document_type' ||
                k.toLowerCase() === 'type' ||
                k.toLowerCase().includes('paper_type')
              ),
              citedBy: keys.findIndex(k => {
                const lower = k.toLowerCase();
                return lower === 'cited_by' ||
                       lower === 'citedby' ||
                       lower === 'cited-by' ||
                       lower === 'cited by' ||
                       lower === 'cited' ||
                       lower === 'citations' ||
                       lower === 'citation_count' ||
                       lower === 'citation count' ||
                       lower === 'citation' ||
                       lower === 'cite_count' ||
                       lower === 'cite count' ||
                       lower === 'num_citations' ||
                       lower === 'times_cited';
              }),
              link: keys.findIndex(k => {
                const lower = k.toLowerCase();
                return lower === 'link' ||
                       lower === 'url' ||
                       lower === 'paper_link' ||
                       lower === 'paper url' ||
                       lower === 'doi_url' ||
                       lower.includes('link') ||
                       lower.includes('url');
              }),
              doi: keys.findIndex(k => {
                const lower = k.toLowerCase();
                return lower === 'doi' ||
                       lower === 'doi_id' ||
                       lower.includes('doi');
              })
            };
            console.log(`First row headers: ${JSON.stringify(Object.keys(row))}`);
            console.log(`Column indices - link: ${columnIndices.link}, doi: ${columnIndices.doi}`);
            if (columnIndices.link >= 0) {
              console.log(`Link column found! Column name: "${keys[columnIndices.link]}"`);
            } else {
              console.log(`Link column NOT found.`);
            }
          }

          // Fast field extraction using cached indices
          const values = Object.values(row);
          const title = columnIndices.title >= 0 ? values[columnIndices.title] : null;
          if (!title) return;

          const authorsRaw = columnIndices.authors >= 0 ? values[columnIndices.authors] : null;
          const yearRaw = columnIndices.year >= 0 ? values[columnIndices.year] : null;
          const sourceRaw = columnIndices.source >= 0 ? values[columnIndices.source] : null;
          const publisherRaw = columnIndices.publisher >= 0 ? values[columnIndices.publisher] : null;
          const paperTypeRaw = columnIndices.paperType >= 0 ? values[columnIndices.paperType] : null;
          const citedByRaw = columnIndices.citedBy >= 0 ? values[columnIndices.citedBy] : null;
          const linkRaw = columnIndices.link >= 0 ? values[columnIndices.link] : null;
          const doiRaw = columnIndices.doi >= 0 ? values[columnIndices.doi] : null;

          // If no direct link, try to generate from DOI
          let finalLink = linkRaw || '';
          if (!finalLink && doiRaw) {
            // Clean DOI and create link
            const cleanDoi = String(doiRaw).trim();
            if (cleanDoi.startsWith('10.')) {
              finalLink = `https://doi.org/${cleanDoi}`;
            } else if (cleanDoi) {
              finalLink = `https://doi.org/${cleanDoi}`;
            }
          }

          // Log link extraction for first few papers
          if (processedCount <= 3) {
            console.log(`Paper ${processedCount}: title="${title}", linkRaw="${linkRaw}", doiRaw="${doiRaw}", finalLink="${finalLink}"`);
          }

          // Parse year
          const year = yearRaw ? parseInt(String(yearRaw).trim(), 10) : null;

          // Parse citedBy
          let citedBy = 0;
          if (citedByRaw) {
            const parsed = parseInt(String(citedByRaw).trim(), 10);
            if (!isNaN(parsed)) citedBy = parsed;
          }

          // Parse authors (semicolon-separated)
          const authorEntries = authorsRaw ? parseAuthorEntries(authorsRaw) : [];

          // Extract Sharda authors
          const shardaAuthors = extractShardaAuthors(authorEntries, {
            sourcePaper: sourceRaw || '',
            publisher: publisherRaw || '',
            paperTitle: title,
            year,
            paperType: paperTypeRaw || '',
            citedBy,
            link: finalLink
          });

          if (shardaAuthors.length > 0) {
            papersWithSharda++;
          }

          // Add to results
          for (let i = 0; i < shardaAuthors.length; i++) {
            results.push(shardaAuthors[i]);
            shardaAuthorCount++;
          }

        } catch (err) {
          errors.push({ row, error: err.message });
        }
      })
      .on('end', () => {
        console.log(`Processing complete:`);
        console.log(`  - Total papers: ${processedCount}`);
        console.log(`  - Papers with Sharda authors: ${papersWithSharda}`);
        console.log(`  - Total Sharda authors extracted: ${shardaAuthorCount}`);

        resolve({
          authors: results,
          errors,
          totalProcessed: processedCount,
          papersWithSharda,
          shardaAuthorCount
        });
      })
      .on('error', reject);
  });
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

      const buffer = fs.readFileSync(req.file.path);
      const { authors, errors, totalProcessed, papersWithSharda, shardaAuthorCount } =
        await processCSV(buffer);

      // Clear existing Sharda authors
      await ShardaAuthor.deleteMany({});

      // Insert new Sharda authors (bulk insert is faster)
      const saved = await ShardaAuthor.insertMany(authors);

      fs.unlinkSync(req.file.path);

      res.json({
        success: true,
        message: `Processed ${totalProcessed} papers, found ${papersWithSharda} papers with Sharda authors`,
        count: saved.length,
        papersWithSharda,
        errors: errors.length ? errors : undefined
      });

    } catch (err) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: err.message });
    }
  },

  getAllShardaAuthors: async (req, res) => {
    const { department, search } = req.query;

    let matchQuery = {};

    // Filter by department
    if (department && department !== 'All') {
      matchQuery.department = department;
    }

    // Search by author name
    if (search) {
      matchQuery.authorName = { $regex: search, $options: 'i' };
    }

    const authors = await ShardaAuthor.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { authorName: "$authorName", department: "$department" },
          records: {
            $push: {
              _id: "$_id",
              authorName: "$authorName",
              department: "$department",
              sourcePaper: "$sourcePaper",
              publisher: "$publisher",
              paperTitle: "$paperTitle",
              year: "$year",
              paperType: "$paperType",
              createdAt: "$createdAt",
              updatedAt: "$updatedAt"
            }
          },
          allPaperTitles: { $push: "$paperTitle" },
          allPaperNames: { $push: "$sourcePaper" },
          allPaperTypes: { $push: "$paperType" }
        }
      },
      { $unwind: "$records" },
      {
        $project: {
          _id: "$records._id",
          authorName: "$records.authorName",
          department: "$records.department",
          sourcePaper: "$records.sourcePaper",
          publisher: "$records.publisher",
          paperTitle: "$records.paperTitle",
          year: "$records.year",
          paperType: "$records.paperType",
          allPaperTitles: 1,
          allPaperNames: 1,
          allPaperTypes: 1,
          createdAt: "$records.createdAt",
          updatedAt: "$records.updatedAt"
        }
      },
      { $sort: { authorName: 1 } }
    ]);

    // Get unique departments for dropdown
    const departments = await ShardaAuthor.distinct('department');

    res.json({
      success: true,
      count: authors.length,
      data: authors,
      departments
    });
  },

  getDepartments: async (req, res) => {
    const departments = await ShardaAuthor.distinct('department');
    res.json({ success: true, count: departments.length, data: departments });
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
      authors.map(a => `"${a.authorName}","${a.department}","${a.paperTitle || ''}","${a.sourcePaper || ''}",${a.year || ''},"${a.paperType || ''}"`).join('\n');

    res.send(csvData);
  },

  clearAuthors: async (req, res) => {
    await ShardaAuthor.deleteMany({});
    res.json({ success: true, message: 'All Sharda authors cleared' });
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
   * @desc    Get all papers with consolidated author columns (Author 1, 2, 3)
   * @access  Public
   */
  getConsolidatedPapers: async (req, res) => {
    try {
      const { department, year, paperType, search } = req.query;

      // Build match conditions for filtering (before grouping)
      const matchConditions = {};

      // Filter by department (match if any author has the specified department)
      if (department && department !== 'All') {
        matchConditions.department = department;
      }

      // Filter by year
      if (year) {
        matchConditions.year = parseInt(year, 10);
      }

      // Filter by paper type
      if (paperType && paperType !== 'All') {
        matchConditions.paperType = paperType;
      }

      // First aggregation: group papers and consolidate authors
      let papers = await ShardaAuthor.aggregate([
        // Apply pre-group filters
        ...(Object.keys(matchConditions).length > 0 ? [{ $match: matchConditions }] : []),
        // Group by paper
        {
          $group: {
            _id: {
              paperTitle: "$paperTitle",
              year: "$year",
              sourcePaper: "$sourcePaper",
              publisher: "$publisher",
              doi: "$doi",
              paperType: "$paperType",
              link: "$link"
            },
            citedBy: { $max: "$citedBy" },
            authors: {
              $push: {
                authorName: "$authorName",
                department: "$department"
              }
            },
            authorCount: { $sum: 1 },
            // Collect all author names for searching
            allAuthorNames: { $push: "$authorName" }
          }
        },
        {
          $project: {
            _id: 0,
            paperTitle: "$_id.paperTitle",
            year: "$_id.year",
            sourcePaper: "$_id.sourcePaper",
            publisher: "$_id.publisher",
            doi: "$_id.doi",
            paperType: "$_id.paperType",
            link: "$_id.link",
            citedBy: 1,
            authorCount: 1,
            authors: 1,
            allAuthorNames: 1
          }
        },
        {
          $addFields: {
            author1: { $arrayElemAt: ["$authors", 0] },
            author2: { $arrayElemAt: ["$authors", 1] },
            author3: { $arrayElemAt: ["$authors", 2] }
          }
        },
        {
          $project: {
            paperTitle: 1,
            year: 1,
            sourcePaper: 1,
            publisher: 1,
            doi: 1,
            paperType: 1,
            link: 1,
            citedBy: 1,
            authorCount: 1,
            authors: 1,
            "author1.authorName": 1,
            "author1.department": 1,
            "author2.authorName": 1,
            "author2.department": 1,
            "author3.authorName": 1,
            "author3.department": 1,
            allAuthorNames: 1
          }
        }
      ]);

      // Apply search filter in JavaScript (after grouping)
      if (search) {
        const searchLower = search.toLowerCase();
        papers = papers.filter(paper => {
          // Check paper title
          if (paper.paperTitle && paper.paperTitle.toLowerCase().includes(searchLower)) {
            return true;
          }
          // Check source/publisher
          if (paper.sourcePaper && paper.sourcePaper.toLowerCase().includes(searchLower)) {
            return true;
          }
          if (paper.publisher && paper.publisher.toLowerCase().includes(searchLower)) {
            return true;
          }
          // Check author names
          if (paper.allAuthorNames) {
            for (const authorName of paper.allAuthorNames) {
              if (authorName && authorName.toLowerCase().includes(searchLower)) {
                return true;
              }
            }
          }
          return false;
        });
      }

      // Sort by paper title
      papers.sort((a, b) => {
        const titleA = a.paperTitle || '';
        const titleB = b.paperTitle || '';
        return titleA.localeCompare(titleB);
      });

      // Get unique values for filter dropdowns
      const departments = await ShardaAuthor.distinct('department');
      const years = await ShardaAuthor.distinct('year').then(docs =>
        docs.filter(y => y != null).sort((a, b) => b - a)
      );
      const paperTypes = await ShardaAuthor.distinct('paperType').then(docs =>
        docs.filter(t => t != null && t.trim() !== '')
      );

      res.json({
        success: true,
        count: papers.length,
        data: papers,
        filters: {
          departments,
          years,
          paperTypes
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
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

      const searchLower = q.toLowerCase().trim();

      // Get all papers grouped by title
      const allPapers = await ShardaAuthor.aggregate([
        {
          $group: {
            _id: {
              paperTitle: "$paperTitle",
              year: "$year",
              sourcePaper: "$sourcePaper",
              publisher: "$publisher",
              doi: "$doi",
              paperType: "$paperType",
              link: "$link"
            },
            citedBy: { $max: "$citedBy" },
            authors: {
              $push: {
                authorName: "$authorName",
                department: "$department"
              }
            },
            authorCount: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            paperTitle: "$_id.paperTitle",
            year: "$_id.year",
            sourcePaper: "$_id.sourcePaper",
            publisher: "$_id.publisher",
            doi: "$_id.doi",
            paperType: "$_id.paperType",
            link: "$_id.link",
            citedBy: 1,
            authorCount: 1,
            authors: 1
          }
        },
        {
          $addFields: {
            author1: { $arrayElemAt: ["$authors", 0] },
            author2: { $arrayElemAt: ["$authors", 1] },
            author3: { $arrayElemAt: ["$authors", 2] }
          }
        },
        {
          $project: {
            paperTitle: 1,
            year: 1,
            sourcePaper: 1,
            publisher: 1,
            doi: 1,
            paperType: 1,
            link: 1,
            citedBy: 1,
            authorCount: 1,
            "author1.authorName": 1,
            "author1.department": 1,
            "author2.authorName": 1,
            "author2.department": 1,
            "author3.authorName": 1,
            "author3.department": 1
          }
        }
      ]);

      // Filter papers that match the search query
      const matchedPapers = allPapers.filter(paper => {
        // Check paper title
        if (paper.paperTitle && paper.paperTitle.toLowerCase().includes(searchLower)) {
          return true;
        }
        // Check source/publisher
        if (paper.sourcePaper && paper.sourcePaper.toLowerCase().includes(searchLower)) {
          return true;
        }
        if (paper.publisher && paper.publisher.toLowerCase().includes(searchLower)) {
          return true;
        }
        // Check author names
        for (const author of paper.authors || []) {
          if (author.authorName && author.authorName.toLowerCase().includes(searchLower)) {
            return true;
          }
        }
        return false;
      });

      // Sort by paper title
      matchedPapers.sort((a, b) => {
        const titleA = a.paperTitle || '';
        const titleB = b.paperTitle || '';
        return titleA.localeCompare(titleB);
      });

      // Limit to 10 results
      const limitedResults = matchedPapers.slice(0, 10);

      console.log(`Search query: "${q}" - Found ${matchedPapers.length} papers, returning ${limitedResults.length}`);

      res.json({
        success: true,
        count: limitedResults.length,
        total: matchedPapers.length,
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
      const papers = await ShardaAuthor.aggregate([
        {
          $group: {
            _id: {
              paperTitle: "$paperTitle",
              year: "$year",
              sourcePaper: "$sourcePaper",
              publisher: "$publisher",
              doi: "$doi",
              paperType: "$paperType",
              link: "$link"
            },
            citedBy: { $max: "$citedBy" },
            authors: {
              $push: {
                authorName: "$authorName",
                department: "$department"
              }
            }
          }
        },
        {
          $project: {
            _id: 0,
            paperTitle: "$_id.paperTitle",
            year: "$_id.year",
            sourcePaper: "$_id.sourcePaper",
            publisher: "$_id.publisher",
            doi: "$_id.doi",
            paperType: "$_id.paperType",
            link: "$_id.link",
            citedBy: 1,
            authors: 1
          }
        },
        {
          $addFields: {
            author1: { $arrayElemAt: ["$authors", 0] },
            author2: { $arrayElemAt: ["$authors", 1] },
            author3: { $arrayElemAt: ["$authors", 2] }
          }
        },
        {
          $project: {
            paperTitle: 1,
            year: 1,
            sourcePaper: 1,
            publisher: 1,
            doi: 1,
            paperType: 1,
            citedBy: 1,
            "author1.authorName": 1,
            "author1.department": 1,
            "author2.authorName": 1,
            "author2.department": 1,
            "author3.authorName": 1,
            "author3.department": 1
          }
        },
        { $sort: { paperTitle: 1 } }
      ]);

      // Create CSV with consolidated author columns
      const csvRows = papers.map(p => ({
        paperTitle: p.paperTitle || '',
        year: p.year || '',
        source: p.sourcePaper || p.publisher || '',
        publisher: p.publisher || '',
        doi: p.doi || '',
        link: p.link || '',
        paperType: p.paperType || '',
        citedBy: p.citedBy || 0,
        author1: p.author1?.authorName || '',
        department1: p.author1?.department || '',
        author2: p.author2?.authorName || '',
        department2: p.author2?.department || '',
        author3: p.author3?.authorName || '',
        department3: p.author3?.department || ''
      }));

      // Generate CSV manually for better control
      const headers = [
        'Paper Title',
        'Year',
        'Source',
        'Publisher',
        'DOI',
        'Link',
        'Paper Type',
        'Cited By',
        'Author 1',
        'Department 1',
        'Author 2',
        'Department 2',
        'Author 3',
        'Department 3'
      ];

      const csvContent = [
        headers.join(','),
        ...csvRows.map(row => [
          `"${(row.paperTitle || '').replace(/"/g, '""')}"`,
          row.year || '',
          `"${(row.source || '').replace(/"/g, '""')}"`,
          `"${(row.publisher || '').replace(/"/g, '""')}"`,
          `"${(row.doi || '').replace(/"/g, '""')}"`,
          `"${(row.paperType || '').replace(/"/g, '""')}"`,
          row.citedBy || 0,
          `"${(row.author1 || '').replace(/"/g, '""')}"`,
          `"${(row.department1 || '').replace(/"/g, '""')}"`,
          `"${(row.author2 || '').replace(/"/g, '""')}"`,
          `"${(row.department2 || '').replace(/"/g, '""')}"`,
          `"${(row.author3 || '').replace(/"/g, '""')}"`,
          `"${(row.department3 || '').replace(/"/g, '""')}"`
        ].join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=sharda_papers_consolidated.csv');
      res.send(csvContent);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
};

