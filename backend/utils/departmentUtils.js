const Teacher = require('../models/Teacher');

/**
 * Manual override map for specific authors who might be missing 
 * from the faculty list or have incorrect associations in Scopus.
 */
const manualOverrides = {
    "Manmeet Kaur Arora": "Department of Computer Science & Engineering",
    "MANMEET KAUR ARORA": "Department of Computer Science & Engineering",
    "Sahil Lal": "Department of Law",
    "SAHIL LAL": "Department of Law"
};

/**
 * List of canonical departments (matching chatController.js and canonical list)
 */
const canonicalDepts = [
    "Department of Dental Science",
    "Department of Medical Sciences",
    "Department of Education",
    "Department of Pharmacy",
    "Department of Allied Health Science",
    "Department of Agricultural Science",
    "Department of Business and Commerce",
    "Department of Management",
    "Department of Chemistry and Biochemistry",
    "Department of Environmental Science",
    "Department of Life Sciences",
    "Department of Mathematics",
    "Department of Physics",
    "Department of Architecture",
    "Department of Art and Science",
    "Department of Biotechnology",
    "Department of Civil Engineering",
    "Department of Computer Science & Applications",
    "Department of Computer Science & Engineering",
    "Department of Electrical Electronics & Communication Engineering",
    "Department of Mechanical Engineering",
    "Department of Humanities & Social Sciences",
    "Department of Mass Communication",
    "Department of Nursing Sciences",
    "Department of Law"
];

/**
 * Maps a raw department string to one of the 25 canonical departments.
 */
function mapToCanonical(deptName) {
    if (!deptName) return 'NA';

    const lower = deptName.toLowerCase();

    // Direct matches first
    for (const canonical of canonicalDepts) {
        if (canonical.toLowerCase() === lower) return canonical;
    }

    // Specific check for Computer Science & Applications (CSA)
    if (lower.includes('application') || lower.includes('csa')) {
        return "Department of Computer Science & Applications";
    }

    // Specific check for Computer Science & Engineering (CSE)
    if (lower.includes('computer science') || lower.includes('cse')) {
        return "Department of Computer Science & Engineering";
    }

    // Medical Sciences
    if (lower.includes('medical science') || lower.includes('smsr') || lower.includes('medicine')) {
        return "Department of Medical Sciences";
    }

    // Business/Management
    if (lower.includes('business') || lower.includes('commerce')) return "Department of Business and Commerce";
    if (lower.includes('management')) return "Department of Management";

    // STEM
    if (lower.includes('biotechnology')) return "Department of Biotechnology";
    if (lower.includes('chemistry') || lower.includes('biochemistry')) return "Department of Chemistry and Biochemistry";
    if (lower.includes('physics')) return "Department of Physics";
    if (lower.includes('mathematics')) return "Department of Mathematics";
    if (lower.includes('civil engineering')) return "Department of Civil Engineering";
    if (lower.includes('mechanical engineering')) return "Department of Mechanical Engineering";
    if (lower.includes('electrical') || lower.includes('eece')) return "Department of Electrical Electronics & Communication Engineering";
    if (lower.includes('life science')) return "Department of Life Sciences";
    if (lower.includes('environmental science')) return "Department of Environmental Science";

    // Others
    if (lower.includes('architecture')) return "Department of Architecture";
    if (lower.includes('pharmacy')) return "Department of Pharmacy";
    if (lower.includes('nursing')) return "Department of Nursing Sciences";
    if (lower.includes('dental')) return "Department of Dental Science";
    if (lower.includes('education')) return "Department of Education";
    if (lower.includes('law')) return "Department of Law";
    if (lower.includes('humanities') || lower.includes('social science')) return "Department of Humanities & Social Sciences";
    if (lower.includes('mass communication')) return "Department of Mass Communication";
    if (lower.includes('art') || lower.includes('design')) return "Department of Art and Science";
    if (lower.includes('allied health')) return "Department of Allied Health Science";
    if (lower.includes('agricultural')) return "Department of Agricultural Science";

    return 'NA'; // Default to NA if no mapping possible
}

/**
 * Checks if a department string represents a broad School-level affiliation.
 */
function isSchoolName(deptName) {
    if (!deptName) return false;
    const lower = deptName.toLowerCase();

    // Check for "School of" or "Sharda School"
    if (lower.includes('school of')) return true;

    // Common abbreviations for Schools at Sharda University
    const schoolAbbrs = [
        'set', 'sset', 'susmr', 'smsr', 'saps', 'sap', 'sahs', 'snrs', 'snsr',
        'shss', 'saas', 'sbss', 'sbsr', 'sbs&r', 'smfe', 'sop', 'sol'
    ];

    // Split by non-alphanumeric characters to find exact abbreviation matches
    const tokens = lower.split(/[^a-z0-9]/);
    return schoolAbbrs.some(abbr => tokens.includes(abbr));
}

/**
 * Resolves an author's department using manual overrides and the Teacher model.
 */
async function resolveAuthorDepartment(authorName, currentDept) {
    const trimmedName = authorName ? authorName.trim() : "";

    // 1. Check for manual overrides first
    if (manualOverrides[trimmedName]) {
        return manualOverrides[trimmedName];
    }

    // 2. Priority: If it's a School name, prioritize Teacher lookup to get the specific Department
    const isSchool = isSchoolName(currentDept);

    if (isSchool) {
        try {
            const teacher = await Teacher.findOne({
                name: { $regex: new RegExp('^' + trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
            }).lean();

            if (teacher && teacher.department) {
                const canonical = mapToCanonical(teacher.department);
                if (canonical !== 'NA') return canonical;
            }
        } catch (err) {
            console.error(`Error resolving department for ${authorName} (priority lookup):`, err.message);
        }
    }

    // 3. Map existing department if it's already specific (and not a school we just failed to resolve)
    if (currentDept && currentDept !== 'NA' && currentDept !== 'Unspecified' && currentDept.trim() !== '') {
        const canonical = mapToCanonical(currentDept);
        if (canonical !== 'NA') return canonical;
    }

    // 4. Fallback to Teacher (Faculty) list for missing/generic departments (if not already tried)
    if (!isSchool) {
        try {
            const teacher = await Teacher.findOne({
                name: { $regex: new RegExp('^' + trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
            }).lean();

            if (teacher && teacher.department) {
                return mapToCanonical(teacher.department);
            }
        } catch (err) {
            console.error(`Error resolving department for ${authorName}:`, err.message);
        }
    }

    // Final fallback: Use whatever was provided or 'NA'
    return mapToCanonical(currentDept) || 'NA';
}

module.exports = {
    resolveAuthorDepartment,
    mapToCanonical,
    manualOverrides,
    canonicalDepts
};
