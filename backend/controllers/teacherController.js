const fs = require('fs');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const Teacher = require('../models/Teacher');
const stream = require('stream');

/* ======================================================
   HELPER FUNCTIONS
====================================================== */

/**
 * Process CSV/Excel Data
 */
const processFile = async (filePath, fileType) => {
  const teachers = [];
  const errors = [];
  let processedCount = 0;

  if (fileType === 'csv') {
    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          processedCount++;
          const teacher = mapRowToTeacher(row);
          if (teacher) {
            teachers.push(teacher);
          } else {
            errors.push({ row: processedCount, message: 'Invalid data', data: row });
          }
        })
        .on('end', () => resolve({ teachers, errors }))
        .on('error', (err) => reject(err));
    });
  } else if (fileType === 'excel') {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    data.forEach((row, index) => {
      processedCount++;
      const teacher = mapRowToTeacher(row);
      if (teacher) {
        teachers.push(teacher);
      } else {
        errors.push({ row: index + 1, message: 'Invalid data', data: row });
      }
    });
    return { teachers, errors };
  }

  return { teachers: [], errors: ['Unsupported file type'] };
};

/**
 * Map Row to Teacher Object
 * Handles variations in column names
 */
const mapRowToTeacher = (row) => {
  // Normalize keys to lowercase for flexible matching
  const normalizedRow = {};
  Object.keys(row).forEach(key => {
    normalizedRow[key.trim().toLowerCase()] = row[key];
  });

  let id = normalizedRow['teacherid'] || normalizedRow['id'] || normalizedRow['emp_id'] || normalizedRow['employee id'] || normalizedRow['emp id'];
  const name = normalizedRow['name'] || normalizedRow['teacher name'] || normalizedRow['faculty name'] || normalizedRow['fullname'];
  const dept = normalizedRow['department'] || normalizedRow['dept'] || normalizedRow['school'] || normalizedRow['dept.'];

  // If no ID, but we have a name, we can generate a temporary ID or just use Name as key
  // However, teacherId is required in the Schema. For mapping authors, we can use a placeholder
  if (!name || !dept) return null;
  if (!id) id = `AUTO_${name.replace(/\s+/g, '_')}`;

  return {
    teacherId: String(id).trim(),
    name: String(name).trim(),
    department: String(dept).trim(),
    email: normalizedRow['email'] ? String(normalizedRow['email']).trim() : undefined,
    designation: normalizedRow['designation'] || normalizedRow['role'] ? String(normalizedRow['designation'] || normalizedRow['role']).trim() : undefined
  };
};

/* ======================================================
   CONTROLLER FUNCTIONS
====================================================== */

module.exports = {

  /**
   * Bulk Upload Teachers via CSV/Excel
   */
  uploadBulk: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }

      const filePath = req.file.path;
      const ext = req.file.originalname.split('.').pop().toLowerCase();
      let fileType = 'unknown';

      if (ext === 'csv') fileType = 'csv';
      else if (['xlsx', 'xls'].includes(ext)) fileType = 'excel';
      else if (ext === 'pdf') {
        // PDF parsing is complex and often requires specific libraries/OCR. 
        // For now, we return a message that PDF parsing is not fully implemented 
        // or handle it if there's a specific requirement/library available.
        fs.unlinkSync(filePath);
        return res.status(400).json({ success: false, message: 'PDF parsing not yet implemented. Please convert to CSV/Excel.' });
      }

      const { teachers, errors } = await processFile(filePath, fileType);

      // Bulk Upsert Operations
      const operations = teachers.map(teacher => ({
        updateOne: {
          filter: { teacherId: teacher.teacherId },
          update: { $set: teacher },
          upsert: true
        }
      }));

      if (operations.length > 0) {
        await Teacher.bulkWrite(operations);
      }

      fs.unlinkSync(filePath); // Cleanup

      res.json({
        success: true,
        message: `Processed ${teachers.length} records.`,
        added: teachers.length,
        errors: errors.length > 0 ? errors : undefined
      });

    } catch (err) {
      console.error('Error in uploadBulk:', err);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * Add or Update Single Teacher (Manual Entry)
   */
  addManual: async (req, res) => {
    try {
      const { teacherId, name, department, designation, email } = req.body;

      if (!teacherId || !name || !department) {
        return res.status(400).json({ success: false, message: 'Missing required fields: teacherId, name, department' });
      }

      const updatedTeacher = await Teacher.findOneAndUpdate(
        { teacherId },
        { name, department, designation, email },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      res.json({
        success: true,
        message: 'Teacher details saved successfully',
        data: updatedTeacher
      });

    } catch (err) {
      console.error('Error in addManual:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * Get All Teachers (with optional filters)
   */
  getAllTeachers: async (req, res) => {
    try {
      const { department, search } = req.query;
      const query = {};

      if (department && department !== 'All') {
        query.department = department;
      }

      if (search) {
        query.$text = { $search: search };
      }

      const teachers = await Teacher.find(query).sort({ name: 1 }).limit(100); // Limit to avoid massive payloads
      res.json({ success: true, count: teachers.length, data: teachers });

    } catch (err) {
      console.error('Error in getAllTeachers:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
    * Get Unique Departments
    */
  getDepartments: async (req, res) => {
    try {
      const departments = await Teacher.distinct('department');
      res.json({ success: true, data: departments });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
};
