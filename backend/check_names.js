const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');
const Teacher = require('./models/Teacher');
const { matchNames } = require('./utils/nameMatcher');

const namesToCheck = [
    "Azmat Ali Khan", "Bhuvan Unhelker", "Biplab Loho Choudhury", "C. Kalaiarasan",
    "Chakridhar Reddy Lokireddy", "Dan J. Stein", "Debadrita Mukherjee", "Dehyu C. Zangar",
    "Devanshi Malik", "Emmanuel Innocent Umoh", "Esubalew Moges Melese", "Gopal Dass",
    "Haider Ali", "Idriss Dagal", "Joseph Atta-Woode", "Kavita Goyal", "Khushboo Juneja",
    "Komal Kapoor", "Kuldeep Pal", "Lassana P Dukuly", "Lav Upadhyay", "Laxmi Mishra",
    "Lokireddy Chakridhar Reddy", "Maaz Ul Hasan", "Mahak Lamba", "Mahak Malviya",
    "Mamta Chauhan", "Manish Baboo Agarwal", "Mansi Jitendra Dave", "Md Daniyal",
    "Md Hammad Neyaz", "Mehak Fayaz Khan", "Monica Bhutani", "Nripesh Solanki",
    "Nsom Karlson Nsom", "Otabek Puldajoov", "Palak Saini", "Pulle Thirupathi",
    "Raghu Ram Achar", "Ramanarayana Boyapati", "Ritika Arora", "Roshni Afshan",
    "S. M. Gomha", "Sadaf Waseem", "Sadaf Zahra", "Sadhana Jadaun", "Sahil Lal",
    "Sajda Khan Gajdhar", "Sajid Ali", "Salabh Rai", "Samadesh Poudel", "Samir Agarwal",
    "Sanki John Theodore", "Saquib Ahmed", "Sarita K. Pandey", "Saundarya Yadav",
    "Sheikh Shoib", "Sonia Arora", "Sonia Yadav", "Suebha Khatoon", "Sujoy Mondol",
    "Tanabalou Jayachitra", "Tejaswi Pratap", "Tummenye Amos", "Veeragoni Chandu Goud",
    "Vishal Yadav", "Y. H. Gangadharaiah", "null Hamzah", "null Princi", "null Yash"
];

async function check() {
    await mongoose.connect(process.env.MONGODB_URI);
    const teachers = await Teacher.find({}).lean();
    const authors = await ShardaAuthor.find({}).lean();

    console.log('| Name | Found in Teacher List? | Found in Sharda Authors? | Department Found? |');
    console.log('| --- | --- | --- | --- |');

    for (const name of namesToCheck) {
        const cleanedName = name.replace(/^null\s+/i, ''); // Handle the "null Name" entries

        const matchedTeacher = teachers.find(t => matchNames(t.name, cleanedName));
        const matchedAuthor = authors.find(a => matchNames(a.authorName, cleanedName));

        const inTeacherList = matchedTeacher ? `Yes (${matchedTeacher.name})` : 'No';
        const inAuthorList = matchedAuthor ? `Yes (${matchedAuthor.authorName})` : 'No';
        const dept = matchedAuthor?.department || matchedTeacher?.department || 'NA';

        console.log(`| ${name} | ${inTeacherList} | ${inAuthorList} | ${dept} |`);
    }

    process.exit(0);
}

check();
