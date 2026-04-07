const mongoose = require('mongoose');
const Teacher = require('./models/Teacher');
const ShardaAuthor = require('./models/ShardaAuthor');
require('dotenv').config();

async function fix() {
    await mongoose.connect(process.env.MONGODB_URI);

    // 1. Fix Teacher record
    const teacherUpdate = await Teacher.updateMany(
        { name: /Sweta Singh/i },
        { $set: { department: 'Department of Computer Science & Engineering' } }
    );
    console.log('Fixed Teachers:', teacherUpdate.modifiedCount);

    // 2. Fix ShardaAuthor records
    const authorUpdate = await ShardaAuthor.updateMany(
        { authorName: /S[hw]*eta Singh/i },
        { $set: { department: 'Department of Computer Science & Engineering' } }
    );
    console.log('Fixed Authors:', authorUpdate.modifiedCount);

    process.exit(0);
}
fix().catch(err => {
    console.error(err);
    process.exit(1);
});
