const express = require('express');
const router = express.Router();
const teacherController = require('../controllers/teacherController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure Multer for file upload
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `teachers-${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const filetypes = /csv|xlsx|xls|pdf/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype) ||
            file.mimetype === 'application/vnd.ms-excel' ||
            file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.mimetype === 'text/csv' ||
            file.mimetype === 'application/pdf';

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only CSV, Excel, and PDF files are allowed!'));
        }
    }
});

// Routes
router.post('/upload', upload.single('file'), teacherController.uploadBulk);
router.post('/manual', teacherController.addManual);
router.get('/', teacherController.getAllTeachers);
router.get('/departments', teacherController.getDepartments);

module.exports = router;
