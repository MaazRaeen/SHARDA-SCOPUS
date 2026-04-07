const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');
const Teacher = require('./models/Teacher');
const { matchNames } = require('./utils/nameMatcher');

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    const namesRaw = "Azmat Ali Khan, Bhuvan Unhelker, Biplab Loho Choudhury, C. Kalaiarasan, Chakridhar Reddy Lokireddy, Dan J. Stein, Debadrita Mukherjee, Dehyu C. Zangar, Devanshi Malik, Emmanuel Innocent Umoh, Esubalew Moges Melese, Gopal Dass, Haider Ali, Idriss Dagal, Joseph Atta-Woode, Kavita Goyal, Khushboo Juneja, Komal Kapoor, Kuldeep Pal, Lassana P Dukuly, Lav Upadhyay, Laxmi Mishra, Lokireddy Chakridhar Reddy, Maaz Ul Hasan, Mahak Lamba, Mahak Malviya, Mamta Chauhan, Manish Baboo Agarwal, Mansi Jitendra Dave, Md Daniyal, Md Hammad Neyaz, Mehak Fayaz Khan, Monica Bhutani, Nripesh Solanki, Nsom Karlson Nsom, Otabek Puldajoov, Palak Saini, Pulle Thirupathi, Raghu Ram Achar, Ramanarayana Boyapati, Ritika Arora, Roshni Afshan, S. M. Gomha, Sadaf Waseem, Sadaf Zahra, Sadhana Jadaun, Sahil Lal, Sajda Khan Gajdhar, Sajid Ali, Salabh Rai, Samadesh Poudel, Samir Agarwal, Sanki John Theodore, Saquib Ahmed, Sarita K. Pandey, Saundarya Yadav, Sheikh Shoib, Sonia Arora, Sonia Yadav, Suebha Khatoon, Sujoy Mondol, Tanabalou Jayachitra, Tejaswi Pratap, Tummenye Amos, Veeragoni Chandu Goud, Vishal Yadav, Y. H. Gangadharaiah, null Hamzah, null Princi, null Yash";
    const names = namesRaw.split(',').map(n => n.trim()).filter(n => n);

    const report = [];

    for (const name of names) {
        let status = "Not Found";
        let dept = "-";
        let source = "None";

        // 1. Check ShardaAuthor
        const author = await ShardaAuthor.findOne({ authorName: name }).lean();
        if (author) {
            status = "Found in Papers";
            dept = author.department || "NA";
            source = "ShardaAuthor";
        } else {
            const authors = await ShardaAuthor.find({ authorName: new RegExp('^' + (name[0] || ''), 'i') }).lean();
            const fuzzyAuthor = authors.find(a => matchNames(name, a.authorName));
            if (fuzzyAuthor) {
                status = `Found in Papers (as ${fuzzyAuthor.authorName})`;
                dept = fuzzyAuthor.department || "NA";
                source = "ShardaAuthor";
            }
        }

        // 2. Check Teacher List (Official)
        const teacher = await Teacher.findOne({ name: name }).lean();
        if (teacher) {
            dept = teacher.department;
            source = source === "None" ? "Teacher List" : source + " + Teacher List";
        } else {
            const teachers = await Teacher.find({ name: new RegExp('^' + (name[0] || ''), 'i') }).lean();
            const fuzzyTeacher = teachers.find(t => matchNames(name, t.name));
            if (fuzzyTeacher) {
                dept = fuzzyTeacher.department;
                source = source === "None" ? `Teacher List (as ${fuzzyTeacher.name})` : source + ` + Teacher List (as ${fuzzyTeacher.name})`;
            }
        }

        report.push({ name, status, dept, source });
    }

    console.log('| Name | Paper Status | Department | Source |');
    console.log('| --- | --- | --- | --- |');
    report.forEach(r => {
        console.log(`| ${r.name} | ${r.status} | ${r.dept} | ${r.source} |`);
    });

    process.exit(0);
}

run();
