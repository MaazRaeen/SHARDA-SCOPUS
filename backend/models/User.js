const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please provide your name'],
        trim: true
    },
    email: {
        type: String,
        required: [true, 'Please provide your email'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
    },
    password: {
        type: String,
        required: [true, 'Please provide a password'],
        minlength: 6,
        select: false
    },
    role: {
        type: String,
        enum: ['Researcher', 'Professor', 'Administrator'],
        default: 'Researcher'
    },
    designation: {
        type: String,
        default: ''
    },
    school: {
        type: String,
        default: ''
    },
    department: {
        type: String,
        default: ''
    },
    scholarUrl: {
        type: String,
        default: ''
    },
    scholarId: {
        type: String,
        default: ''
    },
    scholarCache: {
        totalPapers: { type: Number, default: null },
        citations: { type: Number, default: null },
        hIndex: { type: Number, default: null },
        fetchedAt: { type: Date, default: null }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 12);
});

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword, userPassword) {
    return await bcrypt.compare(candidatePassword, userPassword);
};

const User = mongoose.models.User || mongoose.model('User', userSchema);

module.exports = User;
