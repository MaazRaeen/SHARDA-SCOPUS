const mongoose = require('mongoose');

const systemStatSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

module.exports = mongoose.models.SystemStat || mongoose.model('SystemStat', systemStatSchema);
