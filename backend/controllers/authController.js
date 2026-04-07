const User = require('../models/User');
const jwt = require('jsonwebtoken');

const signToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET || 'your-secret-key', {
        expiresIn: '90d'
    });
};

const createSendToken = (user, statusCode, res) => {
    const token = signToken(user._id);

    // Remove password from output
    user.password = undefined;

    res.status(statusCode).json({
        success: true,
        token,
        data: {
            user
        }
    });
};

const protect = async (req, res, next) => {
    try {
        // 1) Getting token and check of it's there
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'You are not logged in! Please log in to get access.'
            });
        }

        // 2) Verification token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

        // 3) Check if user still exists
        const currentUser = await User.findById(decoded.id);
        if (!currentUser) {
            return res.status(401).json({
                success: false,
                error: 'The user belonging to this token no longer exists.'
            });
        }

        // GRANT ACCESS TO PROTECTED ROUTE
        req.user = currentUser;
        next();
    } catch (err) {
        res.status(401).json({
            success: false,
            error: 'Invalid token or session expired'
        });
    }
};

const authController = {
    signup: async (req, res) => {
        try {
            const { name, email, password, role, designation, school, department, scholarUrl } = req.body;
            const { extractScholarId, fetchFromSerpApi } = require('./scholarController');

            const scholarId = extractScholarId(scholarUrl || '');

            const newUser = await User.create({
                name,
                email,
                password,
                role,
                designation: designation || '',
                school: school || '',
                department: department || '',
                scholarUrl: scholarUrl || '',
                scholarId
            });

            // If Professor/Other with a scholar URL, fetch stats in the background
            if (scholarId && role === 'Professor' && designation === 'Other') {
                fetchFromSerpApi(scholarId)
                    .then(result => {
                        User.findByIdAndUpdate(newUser._id, {
                            scholarCache: { ...result, fetchedAt: new Date() }
                        }).exec();
                    })
                    .catch(err => console.error('[Scholar] Signup fetch failed:', err.message));
            }

            createSendToken(newUser, 201, res);
        } catch (err) {
            console.error('Signup error:', err);
            // Handle duplicate email (MongoDB E11000)
            if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
                return res.status(409).json({
                    success: false,
                    error: 'An account with this email already exists. Please log in instead.'
                });
            }
            res.status(400).json({
                success: false,
                error: err.message
            });
        }
    },

    login: async (req, res) => {
        try {
            const { email, password } = req.body;

            // 1) Check if email and password exist
            if (!email || !password) {
                return res.status(400).json({
                    success: false,
                    error: 'Please provide email and password'
                });
            }

            // 2) Check if user exists && password is correct
            const user = await User.findOne({ email }).select('+password');

            if (!user || !(await user.comparePassword(password, user.password))) {
                return res.status(401).json({
                    success: false,
                    error: 'Incorrect email or password'
                });
            }

            // 3) If everything ok, send token to client
            createSendToken(user, 200, res);
        } catch (err) {
            console.error('Login error:', err);
            res.status(500).json({
                success: false,
                error: err.message
            });
        }
    },

    updatePassword: async (req, res) => {
        try {
            // 1) Get user from collection
            const user = await User.findById(req.user.id).select('+password');

            // 2) Check if posted current password is correct
            if (!(await user.comparePassword(req.body.currentPassword, user.password))) {
                return res.status(401).json({
                    success: false,
                    error: 'Your current password is wrong'
                });
            }

            // 3) If so, update password
            user.password = req.body.password;
            await user.save();

            // 4) Log user in, send JWT
            createSendToken(user, 200, res);
        } catch (err) {
            console.error('Update password error:', err);
            res.status(500).json({
                success: false,
                error: err.message
            });
        }
    },

    protect
};

module.exports = authController;
