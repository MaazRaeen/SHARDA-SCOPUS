require('dotenv').config();
const mongoose = require('mongoose');
const Teacher = require('./models/Teacher');
const ShardaAuthor = require('./models/ShardaAuthor');

async function run() {
   await mongoose.connect(process.env.MONGODB_URI);

   try {
      const teacherWithScopusId = await mongoose.connection.collection('teachers').findOne({ scopusId: { $exists: true } });

      if (teacherWithScopusId) {
         console.log("SUCCESS: Found a teacher with scopusId:");
         console.log(teacherWithScopusId);
      } else {
         console.log("FAILURE: No teacher found with scopusId.");
      }

   } catch (e) {
      console.log("Error:", e.message);
   }

   process.exit(0);
}
run();
