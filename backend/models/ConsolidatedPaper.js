const mongoose = require('mongoose');

const authorSchema = new mongoose.Schema({
    authorName: String,
    department: String,
    isSharda: Boolean,
    email: String,
    scopusId: String
}, { _id: false });

const consolidatedPaperSchema = new mongoose.Schema({
    _id: String, // String ID mapping to eid|... or doi|... or title|year
    paperTitle: String,
    year: Number,
    sourcePaper: String,
    publisher: String,
    doi: String,
    paperType: String,
    link: String,
    quartile: String,
    citedBy: Number,
    publicationDate: Date,
    countries: [String],
    keywords: [String],
    authors: [authorSchema]
}, { timestamps: false, strict: false });

// For very fast regex and string searches
consolidatedPaperSchema.index({ paperTitle: 'text', sourcePaper: 'text' });
consolidatedPaperSchema.index({ year: -1 });

module.exports = mongoose.models.ConsolidatedPaper || mongoose.model('ConsolidatedPaper', consolidatedPaperSchema, 'consolidatedpapers');
