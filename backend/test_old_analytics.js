require('dotenv').config();
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');

async function run() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        const papers = await ShardaAuthor.aggregate([
            {
                $group: {
                    _id: {
                        paperTitle: "$paperTitle",
                        year: "$year"
                    },
                    departments: { $addToSet: "$department" }
                }
            }
        ]);

        const departmentStats = {};
        const allDepartments = await ShardaAuthor.distinct('department');
        allDepartments.forEach(dept => {
            if (dept && dept.trim()) {
                departmentStats[dept] = { department: dept, paperCount: 0 };
            }
        });

        papers.forEach(paper => {
            const depts = paper.departments || [];
            depts.forEach(dept => {
                if (dept && dept.trim() && departmentStats[dept]) {
                    departmentStats[dept].paperCount++;
                }
            });
        });

        const departmentArray = Object.values(departmentStats)
            .filter(dept => dept.paperCount > 0)
            .sort((a, b) => b.paperCount - a.paperCount);

        console.log("Department stats from old getAnalytics:");
        departmentArray.forEach(d => {
            if (d.department.toLowerCase().includes('computer science')) {
                console.log(d.department, ":", d.paperCount);
            }
        });

    } catch (err) {
        console.error(err);
    } finally {
        mongoose.disconnect();
    }
}
run();
