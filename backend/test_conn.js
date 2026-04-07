const mongoose = require('mongoose');
require('dotenv').config();

async function testConnection() {
  console.log("Attempting to connect to:", process.env.MONGODB_URI);
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000 // Timeout after 5s instead of 10s or 30s
    });
    console.log("Connected successfully to host:", conn.connection.host);
    const count = await mongoose.connection.db.collection('shardaauthors').countDocuments();
    console.log("Found", count, "records in shardaauthors.");
    process.exit(0);
  } catch (err) {
    console.error("Connection failed:", err.message);
    process.exit(1);
  }
}

testConnection();
