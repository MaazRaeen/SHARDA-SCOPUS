const mongoose = require('mongoose');

let connPromise = null;

const connectDB = async () => {
  // If already connected, return the connection
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  // If a connection attempt is in progress, return the existing promise
  if (connPromise) {
    return connPromise;
  }

  console.log('Connecting to MongoDB...');
  connPromise = (async () => {
    try {
      const conn = await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 15000, // 15 seconds
        connectTimeoutMS: 15000,
      });
      
      console.log(`MongoDB Connected: ${conn.connection.host}`);
      
      mongoose.connection.on('error', (err) => {
        console.error('MongoDB connection error:', err);
      });
      
      mongoose.connection.on('disconnected', () => {
        console.warn('MongoDB disconnected. Attempting to reconnect...');
        connPromise = null; // Allow a new connection attempt
      });
      
      mongoose.connection.on('reconnected', () => {
        console.log('MongoDB reconnected');
      });
      
      return conn;
    } catch (error) {
      console.error('Error connecting to MongoDB:', error.message);
      connPromise = null; // Allow retry on next call
      // Re-throw so the caller knows the initial connection failed
      throw error;
    }
  })();

  return connPromise;
};

module.exports = connectDB;

