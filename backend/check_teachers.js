require('dotenv').config();
const mongoose = require('mongoose');
const Teacher = require('./models/Teacher');

async function checkTeachers() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const names = [
            "Sudeep Varshney",
            "T.P. Singh",
            "Amit Singh",
            "Pushpendra K. Rajput",
            "Amit Singhal",
            "Gunjan Varshney"
        ];

        for (const name of names) {
            const pattern = name.split(' ').map(p => `(?=.*${p})`).join('');
            const teacher = await Teacher.findOne({ name: { $regex: new RegExp(pattern, 'i') } });
            if (teacher) {
                console.log(`FOUND: ${name} -> ${teacher.name} (${teacher.department})`);
            } else {
                console.log(`NOT FOUND: ${name}`);
            }
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkTeachers();
