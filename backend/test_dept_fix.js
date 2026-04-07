const { standardizeDepartment, matchNamesStrict } = require('./utils/nameMatcher');

const mockTeachers = [
    { name: 'SWETA SINGH', department: 'Humanities & Social Sciences' }
];

const mockEntry = 'Singh, Shweta, Department of CSE, Sharda University, India';

const isValidDept = (d) => {
    if (!d) return false;
    const lower = d.toLowerCase().trim();
    return lower !== 'na' && lower !== 'unspecified' && lower !== 'null' && lower !== '';
};

function resolveDept(authorName, csvDept, matchedTeacherStrict) {
    let finalDepartment = '';

    // OLD PRIORITY:
    // 1. Teacher Excel
    if (matchedTeacherStrict && isValidDept(matchedTeacherStrict.department)) {
        finalDepartment = standardizeDepartment(matchedTeacherStrict.department);
    }
    // 2. CSV
    if (!isValidDept(finalDepartment) && isValidDept(csvDept)) {
        finalDepartment = csvDept;
    }

    const oldResult = isValidDept(finalDepartment) ? standardizeDepartment(finalDepartment) : 'NA';

    // NEW PRIORITY:
    finalDepartment = '';
    // 1. CSV
    if (isValidDept(csvDept)) {
        finalDepartment = csvDept;
    }
    // 2. Teacher Excel
    if (!isValidDept(finalDepartment) && matchedTeacherStrict && isValidDept(matchedTeacherStrict.department)) {
        finalDepartment = standardizeDepartment(matchedTeacherStrict.department);
    }

    const newResult = isValidDept(finalDepartment) ? standardizeDepartment(finalDepartment) : 'NA';

    return { oldResult, newResult };
}

console.log('--- Test 1: Sweta Singh with Teacher in Humanities and CSV as CSE ---');
const res1 = resolveDept('Shweta Singh', 'Department of CSE', mockTeachers[0]);
console.log('Result:', res1);

console.log('\n--- Test 2: Unknown Author with CSV as CSE ---');
const res2 = resolveDept('Unknown Author', 'Department of CSE', null);
console.log('Result:', res2);

console.log('\n--- Test 3: Author with no CSV dept, matching Teacher in Humanities ---');
const res3 = resolveDept('Sweta Singh', '', mockTeachers[0]);
console.log('Result:', res3);
