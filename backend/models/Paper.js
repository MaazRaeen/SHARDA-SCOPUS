const mongoose = require('mongoose');

const paperSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        unique: true // Prevent duplicate papers
    },
    year: {
        type: Number,
        required: true
    },
    abstract: {
        type: String,
        default: ''
    },
    authors: [{
        type: String // We'll store author names for simple querying 
    }],
    department: {
        type: String,
        default: 'Unspecified' // Primary department (derived from first Sharda author or generic)
    },
    source: {
        type: String,
        default: ''
    },
    citations: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

paperSchema.index({ department: 1 });

module.exports = mongoose.models.Paper || mongoose.model('Paper', paperSchema);
