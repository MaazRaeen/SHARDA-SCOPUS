require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/db');
const paperRoutes = require('./routes/paperRoutes');
const authRoutes = require('./routes/authRoutes');

const app = express();

// Connect to MongoDB
connectDB().catch(err => {
  console.error('[CRITICAL] Initial MongoDB connection failed:', err.message);
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve uploaded files temporarily
app.use('/uploads', express.static(uploadsDir));

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Scopus CSV Processor API',
    version: '1.0.0',
    endpoints: {
      upload: 'POST /api/papers/upload',
      getPapers: 'GET /api/papers',
      downloadCSV: 'GET /api/papers/download',
      clearPapers: 'DELETE /api/papers'
    }
  });
});

// Mount paper routes
app.use('/api/papers', paperRoutes);
app.use('/api/auth', authRoutes);

// Error handling middleware for multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }
    return res.status(400).json({ error: err.message });
  }

  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!', message: err.message });
});

const PORT = process.env.PORT || 3000;

console.log(`Starting server on port ${PORT}...`);
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}`);

  // Await the connection established by the top-level connectDB() call
  try {
    await connectDB();
    
    // Automatically check and enrich missing DOI dates on startup
    const paperController = require('./controllers/paperController');
    if (paperController.syncConsolidatedPapers) {
      console.log('[STARTUP] Starting initial paper synchronization...');
      await paperController.syncConsolidatedPapers();
    }
    if (paperController.autoEnrichMissingDates) {
      paperController.autoEnrichMissingDates();
    }
  } catch (err) {
    console.error('[STARTUP] Database connection failed. Background tasks skipped:', err.message);
  }
}).on('error', (err) => {
  console.error('[CRITICAL] Server failed to start:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please kill the process using it.`);
  }
});
