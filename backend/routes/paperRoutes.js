const express = require('express');
const multer = require('multer');
const path = require('path');
const controller = require('../controllers/paperController');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Accept various CSV MIME types and extensions
  const isCSV = file.mimetype === 'text/csv' ||
    file.mimetype === 'application/vnd.ms-excel' ||
    file.mimetype === 'application/csv' ||
    file.mimetype === 'text/plain' ||
    file.mimetype === 'application/octet-stream' ||
    file.originalname.toLowerCase().endsWith('.csv');

  if (isCSV) {
    cb(null, true);
  } else {
    cb(new Error('Only CSV files are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

/**
 * @route   GET /api/papers/analytics
 * @desc    Get full analytics data for dashboard (departments, papers, authors, trends)
 * @access  Public
 * @query   department - Optional department name filter
 * @query   startDate - Optional start date (YYYY-MM-DD)
 * @query   endDate - Optional end date (YYYY-MM-DD)
 */
router.get('/analytics', controller.getAnalytics);

/**
 * @route   POST /api/papers/upload
 * @desc    Upload and process CSV to extract Sharda authors with departments
 * @access  Public
 */
router.post('/upload', upload.single('file'), controller.uploadCSV);

/**
 * @route   GET /api/papers
 * @desc    Get all Sharda authors with their departments
 * @access  Public
 * @query   department - Filter by department
 * @query   search - Search author names
 */
router.get('/', controller.getAllShardaAuthors);

/**
 * @route   GET /api/papers/authors-api
 * @desc    Get authors directly from Scopus API
 * @access  Public
 */
router.get('/authors-api', controller.getAuthorsFromApi);
router.get('/department-api-counts', controller.getDepartmentApiCounts);
router.get('/author-papers/:scopusId', controller.getAuthorPapersFromApi);
router.post('/department-papers-api', controller.getDepartmentPapersFromApi);
router.get('/department-details-db/:department', controller.getDepartmentDetailsFromDb);

/**
 * @route   GET /api/papers/departments
 * @desc    Get list of unique departments
 * @access  Public
 */
router.get('/departments', controller.getDepartments);

/**
 * @route   GET /api/papers/download
 * @desc    Download Sharda authors as CSV (Author_Name, Department)
 * @access  Public
 */
router.get('/download', controller.downloadCSV);

/**
 * @route   DELETE /api/papers
 * @desc    Clear all Sharda authors from database
 * @access  Public
 */
router.delete('/', controller.clearAuthors);

/**
 * @route   GET /api/papers/consolidated
 * @desc    Get all papers with consolidated author columns (Author 1, 2, 3)
 * @access  Public
 */
router.get('/consolidated', controller.getConsolidatedPapers);

/**
 * @route   GET /api/papers/search
 * @desc    Search papers by query string
 * @access  Public
 * @query   q - Search query
 */
router.get('/search', controller.searchPapers);

/**
 * @route   GET /api/papers/download/consolidated
 * @desc    Download consolidated papers CSV with author columns
 * @access  Public
 */
router.get('/download/consolidated', controller.downloadConsolidatedCSV);

/**
 * @route   GET /api/papers/download/quartiles
 * @desc    Download department-wise quartile distribution as CSV
 * @access  Public
 */
router.get('/download/quartiles', controller.downloadQuartileStats);


/**
 * @route   POST /api/papers/scopus
 * @desc    Save papers fetched from Scopus API to database
 * @access  Public
 * @body    papers - Array of papers to save
 */
router.post('/scopus', controller.saveScopusPapers);

/**
 * @route   GET /api/papers/scopus-key
 * @desc    Get Scopus API key from environment
 * @access  Public
 */
router.get('/scopus-key', controller.getScopusApiKey);

/**
 * @route   POST /api/papers/authors/batch
 * @desc    Get departments for a list of author names
 * @access  Public
 * @body    authors - Array of author names to look up
 */
router.post('/authors/batch', controller.getAuthorDepartments);

/**
 * @route   POST /api/papers/map-departments
 * @desc    Re-sync all ShardaAuthor records against the Teacher directory
 * @access  Public
 */
router.post('/map-departments', controller.mapDepartmentsToAuthors);

/**
 * @route   POST /api/papers/chat
 * @desc    Get AI-generated answer based on research data (RAG)
 * @access  Public
 * @body    query - User question
 */
router.post('/chat', require('../controllers/chatController').getChatResponse);

/**
 * @route   GET /api/papers/authors/search
 * @desc    Search authors by name
 * @access  Public
 * @query   q - Search query
 */
router.get('/authors/search', controller.searchAuthors);

/**
 * @route   GET /api/papers/authors/:name/stats
 * @desc    Get detailed stats for an author
 * @access  Public
 */
router.get('/authors/:name/stats', controller.getAuthorStats);

/**
 * @route   POST /api/papers/enrich-dates
 * @desc    Manually trigger background publication date enrichment for all DOIs
 * @access  Public
 */
router.post('/enrich-dates', controller.enrichAllDates);

// ── Google Scholar Routes (protected) ──
const { protect } = require('../controllers/authController');
const scholar = require('../controllers/scholarController');

router.get('/scholar/me', protect, scholar.getMyScholarData);
router.post('/scholar/refresh', protect, scholar.refreshScholarData);
router.post('/scholar/link', protect, scholar.linkScholarUrl);
router.get('/scholar/articles', protect, scholar.getScholarArticles);

module.exports = router;

