const mongoose = require('mongoose');

/**
 * Sharda Author-Department Schema
 * Stores extracted Sharda authors with their departments
 */
const shardaAuthorSchema = new mongoose.Schema({
  authorName: {
    type: String,
    required: true,
    trim: true
  },
  department: {
    type: String,
    required: false,  // Made optional since some authors may not have department info
    trim: true,
    default: ''  // Default to empty string if not provided
  },
  sourcePaper: {
    type: String,
    trim: true
  },
  publisher: {
    type: String,
    trim: true
  },
  paperTitle: {
    type: String,
    trim: true
  },
  year: {
    type: Number
  },
  paperType: {
    type: String,
    trim: true
  },
  doi: {
    type: String,
    trim: true
  },
  link: {
    type: String,
    trim: true
  },
  citedBy: {
    type: Number,
    default: 0
  },
  countries: {
    type: [String],
    default: []
  },
  keywords: {
    type: [String],
    default: []
  },
  quartile: {
    type: String,
    trim: true,
    default: ''
  },
  publicationDate: {
    type: Date,
    required: false
  },
  scopusId: {
    type: String,
    trim: true,
    index: true
  },
  email: {
    type: String,
    trim: true,
    index: true,
    required: false
  },
  isSharda: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true,
  versionKey: false
});

// Index for faster queries
shardaAuthorSchema.index({ authorName: 1 });
shardaAuthorSchema.index({ department: 1 });
shardaAuthorSchema.index({ year: -1, authorName: 1 });
shardaAuthorSchema.index({ paperTitle: 'text' });
shardaAuthorSchema.index({ doi: 1 });
shardaAuthorSchema.index({ link: 1 });
shardaAuthorSchema.index({ paperTitle: 1, authorName: 1 });

const ShardaAuthor = mongoose.models.ShardaAuthor || mongoose.model('ShardaAuthor', shardaAuthorSchema);

module.exports = ShardaAuthor;

