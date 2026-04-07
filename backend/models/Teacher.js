const mongoose = require('mongoose');

/**
 * Teacher Schema
 * Stores teacher details for manual entry and bulk upload
 */
const teacherSchema = new mongoose.Schema({
    teacherId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    department: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    email: {
        type: String,
        trim: true,
        lowercase: true
    },
    designation: {
        type: String,
        trim: true
    },
    joiningDate: {
        type: Date
    },
    scopusId: {
        type: String,
        trim: true,
        index: true
    },
    alternateNames: {
        type: [String],
        default: []
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true,
    versionKey: false
});

// Compound index for name searches within departments
teacherSchema.index({ name: 'text', department: 1 });

const Teacher = mongoose.models.Teacher || mongoose.model('Teacher', teacherSchema);

module.exports = Teacher;
