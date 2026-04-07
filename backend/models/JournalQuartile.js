const mongoose = require('mongoose');

const journalQuartileSchema = new mongoose.Schema({
    journalKey: {
        type: String,
        required: true,
        unique: true, // ISSN or Normalized Journal Title
        index: true
    },
    quartile: {
        type: String,
        default: ''
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

module.exports = mongoose.models.JournalQuartile || mongoose.model('JournalQuartile', journalQuartileSchema);
