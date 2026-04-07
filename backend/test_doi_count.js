const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        const ShardaAuthor = require('./models/ShardaAuthor');

        const totalWithDates = await ShardaAuthor.distinct('doi', { publicationDate: { $type: 'string', $ne: null } });
        console.log('Unique DOIs WITH dates:', totalWithDates.length);

        const totalDois = await ShardaAuthor.distinct('doi', { doi: { $ne: null, $ne: '' } });
        console.log('Total unique DOIs in DB:', totalDois.length);

        mongoose.disconnect();
    })
    .catch(console.error);
