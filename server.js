require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'EMMS_SECURE_TOKEN_2026';
const GOOGLE_SHEET_WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || '';

// Database Engine Selection (Neon Postgres or Local SQLite)
const usePostgres = !!process.env.DATABASE_URL;
let pgPool = null;
let sqliteDb = null;

if (usePostgres) {
    pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    console.log('Connected to Permanent Cloud PostgreSQL Database (Neon).');
} else {
    sqliteDb = new sqlite3.Database('./database.sqlite', (err) => {
        if (err) console.error('SQLite Error:', err);
        else console.log('Connected to local SQLite database.');
    });
}

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (usePostgres) {
            let paramIndex = 1;
            const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
            pgPool.query(pgSql, params, (err, res) => {
                if (err) reject(err);
                else resolve(res.rows);
            });
        } else {
            sqliteDb.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        }
    });
}

function runExec(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (usePostgres) {
            let paramIndex = 1;
            const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
            pgPool.query(pgSql, params, (err, res) => {
                if (err) reject(err);
                else resolve({ lastID: res.rowCount });
            });
        } else {
            sqliteDb.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID });
            });
        }
    });
}

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + unique + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Database Table Setup
async function initDatabase() {
    const autoId = usePostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';

    await runExec(`CREATE TABLE IF NOT EXISTS users (
        id ${autoId},
        staff_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        vendor_name TEXT DEFAULT 'Direct / In-House',
        email TEXT UNIQUE,
        password TEXT NOT NULL,
        user_type TEXT NOT NULL,
        venue_region TEXT,
        venue_state TEXT,
        ef_city TEXT,
        ef_first_name TEXT,
        ef_middle_name TEXT,
        ef_last_name TEXT,
        ef_dob TEXT,
        ef_gender TEXT,
        ef_mobile_number TEXT UNIQUE,
        ef_aadhar_number TEXT,
        ef_father_name TEXT,
        ef_mother_name TEXT,
        ef_email_id TEXT,
        ef_qualification TEXT,
        ef_present_address TEXT,
        ef_permanent_address TEXT,
        status TEXT DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await runExec(`CREATE TABLE IF NOT EXISTS exams (
        id ${autoId},
        exam_name TEXT NOT NULL,
        exam_conducting_agency TEXT NOT NULL,
        vendor_name TEXT DEFAULT 'Agency Board',
        date_from DATE NOT NULL,
        date_to DATE NOT NULL,
        shift_mode TEXT NOT NULL,
        s1_reporting_time TEXT,
        s1_start_time TEXT,
        s1_end_time TEXT,
        s2_reporting_time TEXT,
        s2_start_time TEXT,
        s2_end_time TEXT,
        s3_reporting_time TEXT,
        s3_start_time TEXT,
        s3_end_time TEXT,
        status TEXT DEFAULT 'Active'
    )`);

    await runExec(`CREATE TABLE IF NOT EXISTS centres (
        id ${autoId},
        centre_name TEXT NOT NULL,
        city TEXT NOT NULL,
        full_address TEXT,
        map_location TEXT,
        status TEXT DEFAULT 'Ready'
    )`);

    await runExec(`CREATE TABLE IF NOT EXISTS deployments (
        id ${autoId},
        exam_id INTEGER,
        centre_id INTEGER,
        staff_id INTEGER,
        assigned_role TEXT NOT NULL,
        vendor_name TEXT,
        duty_date DATE NOT NULL,
        shift TEXT NOT NULL,
        duty_amount REAL DEFAULT 1200.0,
        travel_allowance REAL DEFAULT 500.0,
        other_allowance REAL DEFAULT 200.0
    )`);

    await runExec(`CREATE TABLE IF NOT EXISTS attendance (
        id ${autoId},
        deployment_id INTEGER UNIQUE,
        staff_id INTEGER NOT NULL,
        duty_date DATE NOT NULL,
        punch_in_time TEXT,
        punch_in_photo TEXT,
        punch_out_time TEXT,
        punch_out_photo TEXT,
        working_hours TEXT,
        sheet_file TEXT,
        sheet_submission_time TEXT,
        is_late_submission INTEGER DEFAULT 0,
        late_reason TEXT,
        sheet_verification_status TEXT DEFAULT 'Pending'
    )`);

    await runExec(`CREATE TABLE IF NOT EXISTS payments (
        id ${autoId},
        attendance_id INTEGER UNIQUE,
        staff_id INTEGER NOT NULL,
        duty_amount REAL NOT NULL,
        travel_allowance REAL NOT NULL,
        other_allowance REAL NOT NULL,
        total_payable REAL NOT NULL,
        payment_status TEXT DEFAULT 'Pending',
        reference_no TEXT
    )`);

    // Operational Role Checklist & Equipment Table
    await runExec(`CREATE TABLE IF NOT EXISTS operational_forms (
        id ${autoId},
        deployment_id INTEGER,
        staff_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        duty_date DATE NOT NULL,
        form_data_json TEXT NOT NULL,
        photo_proof_path TEXT,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Admin Account Auto-Provision
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@gmail.com').trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@12345';
    const hash = await bcrypt.hash(adminPassword, 10);

    await runExec("DELETE FROM users WHERE user_type = 'ADMIN'");
    await runExec(
        `INSERT INTO users (staff_id, name, role, email, password, user_type, ef_city)
         VALUES ('ADMIN_HQ', 'Agency Chief Administrator', 'Exam Coordinator', ?, ?, 'ADMIN', 'Chennai')`,
        [adminEmail, hash]
    );
}

initDatabase().catch(console.error);

const ROLE_CODES = {
    'Invigilator': 'IN', 'Registration Staff': 'RE', 'Support Staff': 'SU',
    'Lab Supervisor': 'LS', 'Security': 'SE', 'CCTV Operator': 'CC',
    'Jammer Operator': 'JA', 'Technical Staff': 'TE', 'Centre Head': 'CH',
    'Exam Coordinator': 'EC'
};

const CITY_CODES = {
    'Chennai': 'CHE', 'Trichy': 'TRI', 'Tiruchirappalli': 'TRI',
    'Vellore': 'VEL', 'Salem': 'SAL', 'Krishnagiri': 'KRI',
    'Coimbatore': 'COI', 'Madurai': 'MAD', 'Theni': 'THE', 'Tirunelveli': 'TIN'
};

async function generateStaffId(role, city) {
    const rolePrefix = ROLE_CODES[role] || 'ST';
    const cleanCity = (city || 'Chennai').trim();
    const cityKey = Object.keys(CITY_CODES).find(k => k.toLowerCase() === cleanCity.toLowerCase());
    const cityCode = cityKey ? CITY_CODES[cityKey] : cleanCity.substring(0, 3).toUpperCase();
    const pattern = `${rolePrefix}${cityCode}%`;

    const rows = await runQuery("SELECT COUNT(*) as count FROM users WHERE staff_id LIKE ?", [pattern]);
    const nextNum = parseInt(rows[0]?.count || 0) + 1;
    return `${rolePrefix}${cityCode}${String(nextNum).padStart(3, '0')}`;
}

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Session invalid or expired' });
        req.user = user;
        next();
    });
};

// ======================== API ROUTES ========================

// 1. Dual Sign In
app.post('/api/auth/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        const cleanId = (identifier || '').trim();

        const rows = await runQuery("SELECT * FROM users WHERE staff_id = ? OR LOWER(email) = LOWER(?)", [cleanId, cleanId]);
        const user = rows[0];
        if (!user) return res.status(401).json({ error: 'Invalid Staff ID or Password' });

        if (user.user_type === 'STAFF') {
            const cleanInputDob = (password || '').replace(/[-/]/g, '').trim();
            const cleanUserDob = (user.ef_dob || '').replace(/[-/]/g, '').trim();

            if (cleanInputDob !== cleanUserDob) {
                return res.status(401).json({ error: 'Invalid Staff ID or Date of Birth' });
            }

            const token = jwt.sign(
                { id: user.id, staff_id: user.staff_id, role: user.role, user_type: user.user_type, name: user.name },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            return res.json({ token, user });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Invalid Admin Credentials' });

        const token = jwt.sign(
            { id: user.id, staff_id: user.staff_id, role: user.role, user_type: user.user_type, name: user.name },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.json({ token, user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Admin Dashboard Live Stats
app.get('/api/admin/dashboard', authenticateToken, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const sqlDeployments = `
            SELECT d.id as deployment_id, d.duty_date, d.shift, d.assigned_role, 
                   COALESCE(d.vendor_name, u.vendor_name, 'Direct') as vendor_name,
                   u.id as staff_user_id, u.staff_id, u.name as staff_name, u.ef_mobile_number,
                   e.id as exam_id, e.exam_name, e.exam_conducting_agency,
                   c.id as centre_id, c.centre_name, c.city as centre_city,
                   a.id as attendance_id, a.punch_in_time, a.punch_in_photo,
                   a.punch_out_time, a.punch_out_photo, a.working_hours,
                   a.sheet_file, a.sheet_verification_status,
                   p.id as payment_id, p.total_payable, p.payment_status, p.reference_no,
                   CASE WHEN a.punch_in_time IS NOT NULL THEN 'Present' ELSE 'Absent' END as attendance_status
            FROM deployments d
            JOIN users u ON d.staff_id = u.id
            JOIN exams e ON d.exam_id = e.id
            JOIN centres c ON d.centre_id = c.id
            LEFT JOIN attendance a ON d.id = a.deployment_id
            LEFT JOIN payments p ON a.id = p.attendance_id
            ORDER BY d.duty_date DESC
        `;

        const [rows, staffCount, payPending, payPaid] = await Promise.all([
            runQuery(sqlDeployments),
            runQuery("SELECT COUNT(*) as count FROM users WHERE user_type = 'STAFF'"),
            runQuery("SELECT COALESCE(SUM(total_payable), 0) as pending_pay FROM payments WHERE payment_status = 'Pending'"),
            runQuery("SELECT COALESCE(SUM(total_payable), 0) as paid_pay FROM payments WHERE payment_status = 'Paid'")
        ]);

        res.json({
            todayDate: today,
            totalStaffCount: staffCount[0]?.count || 0,
            totalPaymentPending: payPending[0]?.pending_pay || 0,
            totalPaymentPaid: payPaid[0]?.paid_pay || 0,
            allDeployments: rows || []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Staff Registry
app.get('/api/staff', authenticateToken, async (req, res) => {
    try {
        const rows = await runQuery("SELECT * FROM users WHERE user_type = 'STAFF' ORDER BY id DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/staff', authenticateToken, async (req, res) => {
    try {
        const {
            role, vendor_name, email_address, venue_region, venue_state, ef_city,
            ef_first_name, ef_middle_name, ef_last_name, ef_dob, ef_gender,
            ef_mobile_number, ef_aadhar_number, ef_father_name, ef_mother_name,
            ef_email_id, ef_qualification, ef_present_address, ef_permanent_address
        } = req.body;

        const fullName = [ef_first_name, ef_middle_name, ef_last_name].filter(Boolean).join(' ');
        const officialEmail = (ef_email_id || email_address || '').trim();
        const assignedVendor = vendor_name || 'Direct / In-House';

        const assignedStaffId = await generateStaffId(role, ef_city);
        const hash = await bcrypt.hash(ef_dob, 10);

        const sql = `INSERT INTO users (
            staff_id, name, role, vendor_name, email, password, user_type,
            venue_region, venue_state, ef_city, ef_first_name, ef_middle_name, ef_last_name,
            ef_dob, ef_gender, ef_mobile_number, ef_aadhar_number, ef_father_name, ef_mother_name,
            ef_email_id, ef_qualification, ef_present_address, ef_permanent_address
        ) VALUES (?, ?, ?, ?, ?, ?, 'STAFF', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const params = [
            assignedStaffId, fullName, role, assignedVendor, officialEmail, hash,
            venue_region, venue_state, ef_city, ef_first_name, ef_middle_name, ef_last_name,
            ef_dob, ef_gender, ef_mobile_number, ef_aadhar_number, ef_father_name, ef_mother_name,
            officialEmail, ef_qualification, ef_present_address, ef_permanent_address
        ];

        const result = await runExec(sql, params);
        res.json({
            message: 'Staff registered successfully',
            staff_id: assignedStaffId,
            dob: ef_dob,
            name: fullName,
            mobile: ef_mobile_number,
            id: result.lastID
        });
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Mobile number or Email ID already registered.' });
        }
        res.status(500).json({ error: err.message });
    }
});

// 4. Exams Management
app.get('/api/exams', authenticateToken, async (req, res) => {
    try {
        const rows = await runQuery("SELECT * FROM exams ORDER BY id DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/exams', authenticateToken, async (req, res) => {
    try {
        const {
            exam_name, exam_conducting_agency, vendor_name, date_from, date_to, shift_mode,
            s1_reporting_time, s1_start_time, s1_end_time,
            s2_reporting_time, s2_start_time, s2_end_time,
            s3_reporting_time, s3_start_time, s3_end_time
        } = req.body;

        const sql = `INSERT INTO exams (
            exam_name, exam_conducting_agency, vendor_name, date_from, date_to, shift_mode,
            s1_reporting_time, s1_start_time, s1_end_time,
            s2_reporting_time, s2_start_time, s2_end_time,
            s3_reporting_time, s3_start_time, s3_end_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const result = await runExec(sql, [
            exam_name, exam_conducting_agency, vendor_name || 'Agency Board', date_from, date_to, shift_mode,
            s1_reporting_time || null, s1_start_time || null, s1_end_time || null,
            s2_reporting_time || null, s2_start_time || null, s2_end_time || null,
            s3_reporting_time || null, s3_start_time || null, s3_end_time || null
        ]);
        res.json({ message: 'Exam scheduled successfully', id: result.lastID });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Centres Management
app.get('/api/centres', authenticateToken, async (req, res) => {
    try {
        const rows = await runQuery("SELECT * FROM centres ORDER BY id DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/centres', authenticateToken, async (req, res) => {
    try {
        const { centre_name, city, full_address, map_location } = req.body;
        const sql = `INSERT INTO centres (centre_name, city, full_address, map_location) VALUES (?, ?, ?, ?)`;
        const result = await runExec(sql, [centre_name, city, full_address || '', map_location || '']);
        res.json({ message: 'Centre saved successfully', id: result.lastID });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Deployments: Date Range Engine
app.get('/api/deployments', authenticateToken, async (req, res) => {
    try {
        const sql = `SELECT d.*, u.name as staff_name, u.staff_id, u.ef_mobile_number,
                            e.exam_name, e.exam_conducting_agency, c.centre_name, c.city, c.full_address, c.map_location
                     FROM deployments d
                     JOIN users u ON d.staff_id = u.id
                     JOIN exams e ON d.exam_id = e.id
                     JOIN centres c ON d.centre_id = c.id
                     ORDER BY d.duty_date DESC`;
        const rows = await runQuery(sql);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/deployments', authenticateToken, async (req, res) => {
    try {
        const { exam_id, centre_id, staff_id, assigned_role, vendor_name, duty_date_from, duty_date_to, shift } = req.body;
        const startDate = new Date(duty_date_from);
        const endDate = new Date(duty_date_to || duty_date_from);

        const users = await runQuery("SELECT vendor_name, ef_mobile_number, name, staff_id FROM users WHERE id = ?", [staff_id]);
        const u = users[0];
        const resolvedVendor = vendor_name || (u ? u.vendor_name : 'Direct');

        let currentDate = new Date(startDate);
        let daysCount = 0;

        while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            await runExec(
                `INSERT INTO deployments (exam_id, centre_id, staff_id, assigned_role, vendor_name, duty_date, shift)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [exam_id, centre_id, staff_id, assigned_role, resolvedVendor, dateStr, shift]
            );
            currentDate.setDate(currentDate.getDate() + 1);
            daysCount++;
        }

        const details = await runQuery("SELECT exam_name FROM exams WHERE id = ?", [exam_id]);
        const centre = await runQuery("SELECT centre_name, city FROM centres WHERE id = ?", [centre_id]);

        res.json({
            message: `Deployed for ${daysCount} day(s)!`,
            staff_name: u?.name,
            staff_id: u?.staff_id,
            mobile: u?.ef_mobile_number,
            exam_name: details[0]?.exam_name,
            centre_name: `${centre[0]?.centre_name} (${centre[0]?.city})`,
            period: `${duty_date_from} to ${duty_date_to || duty_date_from}`,
            shift
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. Staff Desk: Duties, Ledger & Role Forms
app.get('/api/staff/my-portal-data', authenticateToken, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const sqlDuties = `
            SELECT d.id as deployment_id, d.duty_date, d.shift, d.assigned_role,
                   (d.duty_amount + d.travel_allowance + d.other_allowance) as total_payable,
                   e.exam_name, e.exam_conducting_agency,
                   e.s1_reporting_time, e.s1_start_time, e.s1_end_time,
                   c.centre_name, c.city, c.full_address, c.map_location,
                   a.id as attendance_id, a.punch_in_time, a.punch_out_time,
                   a.working_hours, a.sheet_verification_status, a.sheet_file,
                   COALESCE(p.payment_status, 'Pending') as payment_status,
                   p.reference_no,
                   CASE WHEN d.duty_date = ? THEN 1 ELSE 0 END as is_today
            FROM deployments d
            JOIN exams e ON d.exam_id = e.id
            JOIN centres c ON d.centre_id = c.id
            LEFT JOIN attendance a ON d.id = a.deployment_id
            LEFT JOIN payments p ON a.id = p.attendance_id
            WHERE d.staff_id = ?
            ORDER BY d.duty_date DESC
        `;

        const rows = await runQuery(sqlDuties, [today, req.user.id]);
        let totalWorkedDays = 0, totalEarned = 0, totalReceived = 0, totalPending = 0;

        (rows || []).forEach(r => {
            const amount = parseFloat(r.total_payable) || 1900;
            if (r.punch_in_time) totalWorkedDays++;
            totalEarned += amount;
            if (r.payment_status === 'Paid') totalReceived += amount;
            else totalPending += amount;
        });

        // Check if an operational form has already been submitted for today's deployment
        const todayDep = rows.find(r => r.is_today === 1);
        let formSubmission = null;
        if (todayDep) {
            const formRows = await runQuery(
                "SELECT * FROM operational_forms WHERE deployment_id = ? ORDER BY id DESC LIMIT 1",
                [todayDep.deployment_id]
            );
            formSubmission = formRows[0] || null;
        }

        res.json({
            summary: { totalWorkedDays, totalEarned, totalReceived, totalPending },
            history: rows || [],
            roleFormSubmitted: !!formSubmission,
            formData: formSubmission ? JSON.parse(formSubmission.form_data_json) : null
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 8. Submit Operational Role Form (CCTV / Lab Supervisor / Jammer / Security)
app.post('/api/staff/submit-operational-form', authenticateToken, upload.single('photo_proof'), async (req, res) => {
    try {
        const { deployment_id, role, duty_date, form_fields } = req.body;
        const photoPath = req.file ? `/uploads/${req.file.filename}` : null;

        await runExec(
            `INSERT INTO operational_forms (deployment_id, staff_id, role, duty_date, form_data_json, photo_proof_path)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [deployment_id, req.user.id, role, duty_date, form_fields, photoPath]
        );

        res.json({ message: `${role} Operational Form successfully logged & verified!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 9. Fetch Submitted Role Forms (For Admin Review)
app.get('/api/admin/operational-forms', authenticateToken, async (req, res) => {
    try {
        const sql = `
            SELECT f.*, u.name as staff_name, u.staff_id, c.centre_name, e.exam_name
            FROM operational_forms f
            JOIN users u ON f.staff_id = u.id
            JOIN deployments d ON f.deployment_id = d.id
            JOIN centres c ON d.centre_id = c.id
            JOIN exams e ON d.exam_id = e.id
            ORDER BY f.id DESC
        `;
        const rows = await runQuery(sql);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 10. Attendance Photo Punch & Sheet Upload
app.post('/api/attendance/punch-in', authenticateToken, async (req, res) => {
    try {
        const { deployment_id, photo_base64 } = req.body;
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
        const today = now.toISOString().split('T')[0];

        const filename = `punchin-${req.user.id}-${Date.now()}.jpg`;
        const filepath = path.join(uploadDir, filename);
        const base64Data = photo_base64.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(filepath, base64Data, 'base64');

        await runExec(
            `INSERT INTO attendance (deployment_id, staff_id, duty_date, punch_in_time, punch_in_photo) VALUES (?, ?, ?, ?, ?)`,
            [deployment_id, req.user.id, today, timeStr, `/uploads/${filename}`]
        );
        res.json({ message: 'Punch-in recorded', punch_in_time: timeStr });
    } catch (err) {
        res.status(400).json({ error: 'Punch-in already registered.' });
    }
});

app.post('/api/attendance/punch-out', authenticateToken, async (req, res) => {
    try {
        const { deployment_id, photo_base64 } = req.body;
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour12: false });

        const filename = `punchout-${req.user.id}-${Date.now()}.jpg`;
        const filepath = path.join(uploadDir, filename);
        const base64Data = photo_base64.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(filepath, base64Data, 'base64');

        const records = await runQuery("SELECT * FROM attendance WHERE deployment_id = ?", [deployment_id]);
        const record = records[0];
        if (!record) return res.status(400).json({ error: 'No punch-in found' });

        const [h1, m1] = record.punch_in_time.split(':').map(Number);
        const [h2, m2] = timeStr.split(':').map(Number);
        const diffMinutes = (h2 * 60 + m2) - (h1 * 60 + m1);
        const workingHours = `${Math.floor(diffMinutes / 60)}h ${diffMinutes % 60}m`;

        await runExec(
            `UPDATE attendance SET punch_out_time = ?, punch_out_photo = ?, working_hours = ? WHERE deployment_id = ?`,
            [timeStr, `/uploads/${filename}`, workingHours, deployment_id]
        );

        const deps = await runQuery("SELECT duty_amount, travel_allowance, other_allowance FROM deployments WHERE id = ?", [deployment_id]);
        const dep = deps[0];
        if (dep) {
            const total = (parseFloat(dep.duty_amount) || 1200) + (parseFloat(dep.travel_allowance) || 500) + (parseFloat(dep.other_allowance) || 200);
            const existingPayment = await runQuery("SELECT id FROM payments WHERE attendance_id = ?", [record.id]);
            if (!existingPayment || existingPayment.length === 0) {
                await runExec(
                    `INSERT INTO payments (attendance_id, staff_id, duty_amount, travel_allowance, other_allowance, total_payable, payment_status)
                     VALUES (?, ?, ?, ?, ?, ?, 'Pending')`,
                    [record.id, req.user.id, dep.duty_amount, dep.travel_allowance, dep.other_allowance, total]
                );
            }
        }

        res.json({ message: 'Punch-out recorded', punch_out_time: timeStr, working_hours: workingHours });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/attendance/upload-sheet', authenticateToken, upload.single('attendance_sheet'), async (req, res) => {
    try {
        const { deployment_id, is_late, late_reason } = req.body;
        if (!req.file) return res.status(400).json({ error: 'File upload missing' });

        const submissionTime = new Date().toLocaleTimeString('en-US', { hour12: false });
        const sheetFilePath = `/uploads/${req.file.filename}`;

        await runExec(
            `UPDATE attendance SET sheet_file = ?, sheet_submission_time = ?, is_late_submission = ?, late_reason = ?, sheet_verification_status = 'Submitted' WHERE deployment_id = ?`,
            [sheetFilePath, submissionTime, is_late === 'true' ? 1 : 0, late_reason || null, deployment_id]
        );
        res.json({ message: 'Sheet submitted successfully', file: sheetFilePath });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 11. Verification & Payment Ledger Approvals
app.get('/api/admin/attendance-sheets', authenticateToken, async (req, res) => {
    try {
        const sql = `SELECT a.*, u.name as staff_name, u.role, u.staff_id, u.vendor_name, c.centre_name, e.exam_name
                     FROM attendance a
                     JOIN users u ON a.staff_id = u.id
                     JOIN deployments d ON a.deployment_id = d.id
                     JOIN exams e ON d.exam_id = e.id
                     JOIN centres c ON d.centre_id = c.id
                     ORDER BY a.id DESC`;
        const rows = await runQuery(sql);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/verify-sheet', authenticateToken, async (req, res) => {
    try {
        const { attendance_id, status } = req.body;
        await runExec("UPDATE attendance SET sheet_verification_status = ? WHERE id = ?", [status, attendance_id]);
        res.json({ message: `Sheet ${status}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/payments', authenticateToken, async (req, res) => {
    try {
        const sql = `SELECT p.*, u.name as staff_name, u.staff_id, u.role, u.vendor_name,
                            a.duty_date, a.punch_in_time, a.punch_out_time, a.sheet_verification_status,
                            c.centre_name, e.exam_name, e.exam_conducting_agency
                     FROM payments p
                     JOIN users u ON p.staff_id = u.id
                     JOIN attendance a ON p.attendance_id = a.id
                     JOIN deployments d ON a.deployment_id = d.id
                     JOIN exams e ON d.exam_id = e.id
                     JOIN centres c ON d.centre_id = c.id
                     ORDER BY p.id DESC`;
        const rows = await runQuery(sql);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/update-payment', authenticateToken, async (req, res) => {
    try {
        const { payment_id, status } = req.body;
        const ref = status === 'Paid' ? 'TXN-DISB-' + Math.floor(10000000 + Math.random() * 90000000) : null;
        await runExec(`UPDATE payments SET payment_status = ?, reference_no = COALESCE(?, reference_no) WHERE id = ?`, [status, ref, payment_id]);
        res.json({ message: `Payment marked as ${status}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`EMMS Running on port ${PORT}`);
});
