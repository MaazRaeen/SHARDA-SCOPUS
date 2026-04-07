/**
 * Name Matching Utility
 * Handles matching between Full Names and Scopus-style "Surname, I." formats
 */

/**
 * Normalize name for comparison: lowercase, remove punctuation except comma
 * @param {string} name 
 * @returns {string}
 */
const normalize = (name) => {
    if (!name) return '';
    return name.toLowerCase().replace(/[.\s]+/g, ' ').trim();
};

/**
 * Generate Scopus-style Sname from a full name
 * Example: "Arvind Kumar Pandey" -> ["pandey", "a", "k"]
 * @param {string} fullName 
 * @returns {Object} { surname, initials }
 */
const getSnameParts = (fullName) => {
    if (!fullName) return null;
    const parts = fullName.toLowerCase().split(' ').filter(p => p.length > 0);
    if (parts.length < 1) return null;

    // Scopus sometimes uses "Surname I" without a comma
    // If the last part is 1-2 chars, it might be an initial
    let surname, initials;
    if (parts.length > 1 && parts[parts.length - 1].length <= 2 && parts[0].length > 2) {
        // Looks like "Surname I"
        surname = parts[0];
        initials = parts.slice(1); // Keep full parts
    } else {
        // Looks like "First Middle Last"
        surname = parts[parts.length - 1];
        initials = parts.slice(0, -1); // Keep full parts
    }

    return { surname, initials };
};

/**
 * Parse a Scopus sname "Surname, I.J."
 * Example: "Pandey, A.K." -> { surname: "pandey", initials: ["a", "k"] }
 * @param {string} sname 
 * @returns {Object}
 */
const parseScopusSname = (sname) => {
    if (!sname || !sname.includes(',')) return null;
    const [surnamePart, initialPart] = sname.split(',');
    const surname = normalize(surnamePart);
    const initials = normalize(initialPart).split(' ').filter(i => i.length > 0);

    return { surname, initials };
};

/**
 * Robustly match two names
 * @param {string} name1 - Can be full name or sname
 * @param {string} name2 - Can be full name or sname
 * @returns {boolean}
 */
const matchNames = (name1, name2) => {
    const n1 = normalize(name1).replace(',', '').trim();
    const n2 = normalize(name2).replace(',', '').trim();

    if (!n1 || !n2) return false;
    if (n1 === n2) return true;

    const parts1 = n1.split(' ').filter(p => p.length > 0);
    const parts2 = n2.split(' ').filter(p => p.length > 0);

    // --- OPTIMIZED FUZZY MATCH ---
    // Memoization cache to avoid extreme CPU usage from repeated regex execution
    const fuzzyCache = new Map();
    const normalizeSpelling = (s) => {
        if (!s) return '';
        const lowerS = s.toLowerCase();
        if (fuzzyCache.has(lowerS)) return fuzzyCache.get(lowerS);

        let res = lowerS
            .replace(/agrawal/g, 'agarwal').replace(/aggarwal/g, 'agarwal')
            .replace(/choudhary/g, 'chaudhary').replace(/chowdhury/g, 'chaudhary').replace(/chowdhary/g, 'chaudhary')
            .replace(/mittal/g, 'mital').replace(/googal/g, 'goyal')
            .replace(/gg/g, 'g').replace(/w/g, 'v').replace(/aa/g, 'a').replace(/ee/g, 'i')
            .replace(/oo/g, 'u').replace(/sh/g, 's').replace(/y/g, 'i');

        fuzzyCache.set(lowerS, res);
        return res;
    };

    const isFuzzyMatch = (s1, s2) => {
        if (s1 === s2) return true;
        const r1 = normalizeSpelling(s1);
        const r2 = normalizeSpelling(s2);
        if (r1 === r2) return true;
        if (r1.length > 3 && r2.length > 3) {
            if (r1.startsWith(r2) || r2.startsWith(r1)) return true;
        }
        return false;
    };

    const words1 = parts1.filter(p => p.length > 1);
    const words2 = parts2.filter(p => p.length > 1);

    // Case 1: Word-Set Matching (Handles reordering + middle names)
    if (words1.length > 0 && words2.length > 0) {
        const shorter = words1.length <= words2.length ? words1 : words2;
        const longer = words1.length <= words2.length ? words2 : words1;
        const allMatched = shorter.every(w1 => longer.some(w2 => isFuzzyMatch(w1, w2)));
        if (allMatched) {
            const in1 = parts1.filter(p => p.length === 1);
            const in2 = parts2.filter(p => p.length === 1);
            if (in1.length > 0 && in2.length > 0) {
                if (in1[0] !== in2[0]) return false;
            }
            return true;
        }
    }

    // Case 2: Scopus Sname Match (Handles "Pandey, A.K.")
    const trySnameMatch = (list1, list2) => {
        const surname = list1.find(w => w.length >= 4);
        if (!surname) return false;
        const matchedSurname = list2.find(w => isFuzzyMatch(w, surname));
        if (matchedSurname) {
            const initials = list1.filter(p => p !== surname).map(p => p[0]);
            const targets = list2.filter(p => p !== matchedSurname);
            if (initials.length === 0) return true;
            return initials.every(i => targets.some(t => t.startsWith(i)));
        }
        return false;
    };
    if (trySnameMatch(parts1, parts2) || trySnameMatch(parts2, parts1)) return true;

    // Case 3: Fragmentation (Nikhil Raj P R vs Nikhil Rajput)
    // NOTE: Only prefix-based check retained. The Jaccard character-set intersection
    // was removed because it produced too many false positives (e.g. "Shajee Mohan"
    // matching a completely different teacher), leading to wrong department assignments.
    const tight1 = parts1.join('');
    const tight2 = parts2.join('');
    const normalizeFuzzy = s => s.toLowerCase().replace(/agrawal/g, 'agarwal').replace(/aggarwal/g, 'agarwal').replace(/gg/g, 'g').replace(/w/g, 'v').replace(/aa/g, 'a').replace(/ee/g, 'i');
    const f1 = normalizeFuzzy(tight1);
    const f2 = normalizeFuzzy(tight2);
    if (f1 === f2) return true;
    if (f1.length > 5 && f2.length > 5) {
        if (f1.startsWith(f2) || f2.startsWith(f1)) {
            const longer = f1.length > f2.length ? f1 : f2;
            const shorter = f1.length > f2.length ? f2 : f1;
            // Raised threshold from 0.7 → 0.85 to reduce false positives
            if (shorter.length >= longer.length * 0.85) return true;
        }
    }

    return false;
};

const strictMatchCache = new Map();

/**
 * High-confidence name match — only returns true for exact or near-exact matches.
 * Used when we need to be SURE about a teacher match before trusting their department.
 * Does NOT include the loose fragmentation/prefix heuristics.
 *
 * @param {string} name1
 * @param {string} name2
 * @returns {boolean}
 */
const matchNamesStrict = (name1, name2) => {
    const n1 = normalize(name1).replace(',', '').trim();
    const n2 = normalize(name2).replace(',', '').trim();

    if (!n1 || !n2) return false;
    if (n1 === n2) return true;

    // Top-level memoization for O(1) repeated matching
    const cacheKey = n1 < n2 ? `${n1}|${n2}` : `${n2}|${n1}`;
    if (strictMatchCache.has(cacheKey)) return strictMatchCache.get(cacheKey);

    const evaluateMatch = () => {

        const parts1 = n1.split(' ').filter(p => p.length > 0);
        const parts2 = n2.split(' ').filter(p => p.length > 0);

        // --- OPTIMIZED FUZZY MATCH (STRICT) ---
        // Memoization cache to avoid extreme CPU usage from repeated regex execution
        const fuzzyCacheStrict = new Map();
        const normalizeSpellingStrict = (s) => {
            if (!s) return '';
            const lowerS = s.toLowerCase();
            if (fuzzyCacheStrict.has(lowerS)) return fuzzyCacheStrict.get(lowerS);

            let res = lowerS
                .replace(/agrawal/g, 'agarwal').replace(/aggarwal/g, 'agarwal')
                .replace(/choudhary/g, 'chaudhary').replace(/chowdhury/g, 'chaudhary').replace(/chowdhary/g, 'chaudhary')
                .replace(/mittal/g, 'mital').replace(/googal/g, 'goyal')
                .replace(/gg/g, 'g').replace(/w/g, 'v').replace(/aa/g, 'a').replace(/ee/g, 'i')
                .replace(/oo/g, 'u').replace(/sh/g, 's').replace(/y/g, 'i');

            fuzzyCacheStrict.set(lowerS, res);
            return res;
        };

        const isFuzzyMatch = (s1, s2) => {
            if (s1 === s2) return true;
            return normalizeSpellingStrict(s1) === normalizeSpellingStrict(s2);
            // NOTE: No prefix/startsWith — strict equality only
        };

        // Case 1: All non-initial words must match (same as matchNames Case 1)
        const words1 = parts1.filter(p => p.length > 1);
        const words2 = parts2.filter(p => p.length > 1);
        if (words1.length > 0 && words2.length > 0) {
            const shorter = words1.length <= words2.length ? words1 : words2;
            const longer = words1.length <= words2.length ? words2 : words1;
            const allMatched = shorter.every(w1 => longer.some(w2 => isFuzzyMatch(w1, w2)));
            if (allMatched) {
                const in1 = parts1.filter(p => p.length === 1);
                const in2 = parts2.filter(p => p.length === 1);
                if (in1.length > 0 && in2.length > 0) {
                    if (in1[0] !== in2[0]) return false;
                }
                return true;
            }
        }

        // Case 2: Scopus Sname match ("Pandey, A.K." vs "Arvind Kumar Pandey")
        const trySnameMatch = (list1, list2) => {
            const surname = list1.find(w => w.length >= 4);
            if (!surname) return false;
            const matchedSurname = list2.find(w => isFuzzyMatch(w, surname));
            if (matchedSurname) {
                const initials = list1.filter(p => p !== surname).map(p => p[0]);
                const targets = list2.filter(p => p !== matchedSurname);
                if (initials.length === 0) return true;
                return initials.every(i => targets.some(t => t.startsWith(i)));
            }
            return false;
        };
        if (trySnameMatch(parts1, parts2) || trySnameMatch(parts2, parts1)) return true;

        return false;
    };

    const result = evaluateMatch();
    strictMatchCache.set(cacheKey, result);
    return result;
};

/**
 * Format author name from "Last, First" to "First Last"
 * @param {string} name - The name string to format
 * @returns {string} - Formatted name
 */
const formatAuthorName = (name) => {
    if (!name || typeof name !== 'string') return '';
    if (!name.includes(',')) return name.trim();

    const parts = name.split(',');
    if (parts.length < 2) return name.trim();

    // "Last, First" -> "First Last"
    return `${parts[1].trim()} ${parts[0].trim()}`;
};

const standardizeDepartment = (dept) => {
    if (!dept || dept === 'NA') return 'NA';

    // Normalize input string for comparison
    const d = dept.toLowerCase().trim()
        .replace(/&/g, ' and ')
        .replace(/\s+/g, ' ')
        .replace('department of ', '')
        .replace('departmemnt of ', '') // handle user typo
        .replace('departnemnt of ', '') // handle another user typo
        .replace('deptt. of ', '') // handle deptt abbr
        .replace('dept. of ', '')
        .trim();

    // Official 25 Target Departments (Formal Names)
    const targets = [
        "Department of Agricultural Science", "Department of Allied Health Science", "Department of Architecture", "Department of Art and Science",
        "Department of Biotechnology", "Department of Business and Commerce", "Department of Chemistry and Biochemistry", "Department of Civil Engineering",
        "Department of Computer Science & Applications", "Department of Computer Science & Engineering",
        "Department of Electrical Electronics & Communication Engineering", "Department of Environmental Science",
        "Department of Humanities & Social Sciences", "Department of Law", "Department of Life Sciences", "Department of Management",
        "Department of Mass Communication", "Department of Mathematics", "Department of Mechanical Engineering", "Department of Medical Sciences",
        "Department of Nursing Sciences", "Department of Pharmacy", "Department of Physics", "Department of Education", "Department of Dental Science"
    ];

    // 1. Exact Normal Match (against the category without prefix)
    for (const target of targets) {
        // Strip "Department of " from target for comparison
        const category = target.replace('Department of ', '');
        const normalizedCategory = category.toLowerCase().replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
        if (d === normalizedCategory) return target;
    }

    // 2. Specific Keyword Priority Map (Longer/More specific first)
    const priorityMap = [
        { key: 'computer science and applications', target: 'Department of Computer Science & Applications' },
        { key: 'computer science and application', target: 'Department of Computer Science & Applications' },
        { key: 'computer applications', target: 'Department of Computer Science & Applications' },
        { key: 'computer application', target: 'Department of Computer Science & Applications' },
        { key: 'mass communication', target: 'Department of Mass Communication' },
        { key: 'mass comm', target: 'Department of Mass Communication' },
        { key: 'journalism', target: 'Department of Mass Communication' },
        { key: 'computer science', target: 'Department of Computer Science & Engineering' },
        { key: 'cse', target: 'Department of Computer Science & Engineering' },
        { key: 'csa', target: 'Department of Computer Science & Applications' },
        { key: 'information technology', target: 'Department of Computer Science & Engineering' },
        { key: 'electrical', target: 'Department of Electrical Electronics & Communication Engineering' },
        { key: 'electronics', target: 'Department of Electrical Electronics & Communication Engineering' },
        { key: 'eece', target: 'Department of Electrical Electronics & Communication Engineering' },
        // Removed aggressive 'medical'/'medicine' keywords to prevent false positives
        { key: 'school of medical', target: 'Department of Medical Sciences' },
        { key: 'school of medicine', target: 'Department of Medical Sciences' },
        { key: 'smsr', target: 'Department of Medical Sciences' },
        { key: 'sharda hospital', target: 'Department of Medical Sciences' },
        { key: 'dental', target: 'Department of Dental Science' },
        { key: 'dentistry', target: 'Department of Dental Science' },
        { key: 'oral', target: 'Department of Dental Science' },
        { key: 'maxillofacial', target: 'Department of Dental Science' },
        { key: 'orthodontics', target: 'Department of Dental Science' },
        { key: 'prosthodontics', target: 'Department of Dental Science' },
        { key: 'periodontology', target: 'Department of Dental Science' },
        { key: 'endodontics', target: 'Department of Dental Science' },
        { key: 'pharmacy', target: 'Department of Pharmacy' },
        { key: 'pharmaceutical', target: 'Department of Pharmacy' },
        { key: 'physiotherapy', target: 'Department of Allied Health Science' },
        { key: 'allied health', target: 'Department of Allied Health Science' },
        { key: 'management', target: 'Department of Management' },
        { key: 'business', target: 'Department of Business and Commerce' },
        { key: 'commerce', target: 'Department of Business and Commerce' },
        { key: 'commerse', target: 'Department of Business and Commerce' }, // handle user typo
        { key: 'art', target: 'Department of Art and Science' },
        { key: 'design', target: 'Department of Art and Science' },
        { key: 'humanities', target: 'Department of Humanities & Social Sciences' },
        { key: 'social science', target: 'Department of Humanities & Social Sciences' },
        { key: 'life science', target: 'Department of Life Sciences' },
        { key: 'biology', target: 'Department of Life Sciences' },
        { key: 'biotech', target: 'Department of Biotechnology' },
        { key: 'chemistry', target: 'Department of Chemistry and Biochemistry' },
        { key: 'biochemistry', target: 'Department of Chemistry and Biochemistry' },
        { key: 'physics', target: 'Department of Physics' },
        { key: 'mathematics', target: 'Department of Mathematics' },
        { key: 'civil', target: 'Department of Civil Engineering' },
        { key: 'mechanical', target: 'Department of Mechanical Engineering' },
        { key: 'architecture', target: 'Department of Architecture' },
        { key: 'nursing', target: 'Department of Nursing Sciences' },
        { key: 'law', target: 'Department of Law' },
        { key: 'legal', target: 'Department of Law' },
        { key: 'education', target: 'Department of Education' },
        { key: 'agricultural', target: 'Department of Agricultural Science' },
        { key: 'environmental', target: 'Department of Environmental Science' },
        { key: 'department of physics', target: 'Department of Physics' }, // More specific mapping
        { key: 'department of mathematics', target: 'Department of Mathematics' },
        { key: 'department of chemistry', target: 'Department of Chemistry and Biochemistry' },

        // --- NEW MEDICAL MAPPINGS ---
        { key: 'medicine', target: 'Department of Medical Sciences' },
        { key: 'medical', target: 'Department of Medical Sciences' },
        { key: 'surgery', target: 'Department of Medical Sciences' }, // General surgery (Oral/Maxillo handled above by priority or order if needed)
        { key: 'anatomy', target: 'Department of Medical Sciences' },
        { key: 'physiology', target: 'Department of Medical Sciences' },
        { key: 'pathology', target: 'Department of Medical Sciences' },
        { key: 'anesthesiology', target: 'Department of Medical Sciences' },
        { key: 'community medicine', target: 'Department of Medical Sciences' },
        { key: 'forensic', target: 'Department of Medical Sciences' },
        { key: 'microbiology', target: 'Department of Medical Sciences' },
        { key: 'pharmacology', target: 'Department of Medical Sciences' },
        { key: 'pediatrics', target: 'Department of Medical Sciences' },
        { key: 'obs & gynae', target: 'Department of Medical Sciences' },
        { key: 'obstetrics', target: 'Department of Medical Sciences' },
        { key: 'gynaecology', target: 'Department of Medical Sciences' },
        { key: 'ophthalmology', target: 'Department of Medical Sciences' },
        { key: 'ent', target: 'Department of Medical Sciences' },
        { key: 'radiology', target: 'Department of Medical Sciences' },
        { key: 'dermatology', target: 'Department of Medical Sciences' },
        { key: 'psychiatry', target: 'Department of Medical Sciences' },
        { key: 'orthopedics', target: 'Department of Medical Sciences' },
        { key: 'pharmaceutics', target: 'Department of Pharmacy' },
        { key: 'anaesthesia', target: 'Department of Medical Sciences' },
        { key: 'anesthesia', target: 'Department of Medical Sciences' },
        { key: 'orthopaedics', target: 'Department of Medical Sciences' },
        { key: 'fmt', target: 'Department of Medical Sciences' },
        { key: 'forensic medicine', target: 'Department of Medical Sciences' }, // Explicit full match
        { key: 'cs and it', target: 'Department of Computer Science & Engineering' },
        { key: 'applied sciences', target: 'Department of Physics' }, // Heuristic
        { key: 'materials research', target: 'Department of Physics' },
        { key: 'periodontics', target: 'Department of Dental Science' },
        { key: 'chest', target: 'Department of Medical Sciences' },
        { key: 'tb', target: 'Department of Medical Sciences' },
        { key: 't.b.', target: 'Department of Medical Sciences' },
        { key: 'tuberculosis', target: 'Department of Medical Sciences' },
        { key: 'respiratory', target: 'Department of Medical Sciences' },
        { key: 'pulmonary', target: 'Department of Medical Sciences' },
        { key: 'basic science', target: 'Department of Physics' }, // Heuristic
        { key: 'applied science', target: 'Department of Physics' }, // Heuristic
        { key: 'school of basic sciences', target: 'Department of Physics' },
        // removed 'sbsr' -> 'Physics' broad mapping to prevent misassignment for non-physics authors
    ];

    for (const entry of priorityMap) {
        if (d.includes(entry.key)) return entry.target;
    }

    // 3. Fallback to plural match on targets
    for (const target of targets) {
        const category = target.replace('Department of ', '');
        const normalizedCategory = category.toLowerCase().replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
        if (d.includes(normalizedCategory) || normalizedCategory.includes(d) || d === normalizedCategory + 's' || d + 's' === normalizedCategory) {
            return target;
        }
    }

    return 'NA'; // Final fallback
};

module.exports = {
    matchNames,
    matchNamesStrict,
    normalize,
    getSnameParts,
    parseScopusSname,
    formatAuthorName,
    standardizeDepartment
};
