
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  authorName: String,
  department: String
}, { collection: 'shardaauthors' });

const Author = mongoose.model('ShardaAuthor', schema);

mongoose.connect('mongodb://localhost:27017/sharda_research').then(async () => {
  const matches = await Author.find({ authorName: { $regex: /sudeep/i } });
  const uniqueNames = [...new Set(matches.map(m => m.authorName))];
  console.log('Unique sudeep matches:', uniqueNames);
  process.exit(0);
}).catch(console.error);

