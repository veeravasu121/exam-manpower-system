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
const JWT_SECRET = process.env.JWT_SECRET || 'EMMS_CONFIDENTIAL_KEY_2026';

// Database Engine Selection (Neon Cloud Postgres or SQLite fallback)
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
app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));
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

// Database Initializer & Guaranteed Admin Provisioner
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
        status TEXT DEFAULT 'Pending Approval',
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
        shift_timings_json TEXT,
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
        other_allowance REAL DEFAULT 200.0,
        total_payable REAL DEFAULT 1900.0
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

    // GUARANTEED ADMIN PROVISIONING
    const adminEmail = (process.env.ADMIN_EMAIL || 'shankaranv161@gmail.com').trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin@123';
    const hash = await bcrypt.hash(adminPassword, 10);

    const existingAdmin = await runQuery(
        "SELECT * FROM users WHERE staff_id = 'ADMIN_HQ' OR LOWER(email) = ?", 
        [adminEmail]
    );

    if (existingAdmin && existingAdmin.length > 0) {
        await runExec(
            `UPDATE users 
             SET user_type = 'ADMIN', password = ?, role = 'Exam Coordinator', status = 'Active', email = ? 
             WHERE id = ?`,
            [hash, adminEmail, existingAdmin[0].id]
        );
        console.log(`[AUTH] Admin synchronized -> Email: ${adminEmail} | Role: ADMIN`);
    } else {
        await runExec(
            `INSERT INTO users (staff_id, name, role, email, password, user_type, ef_city, status)
             VALUES ('ADMIN_HQ', 'Chief Examination Administrator', 'Exam Coordinator', ?, ?, 'ADMIN', 'Chennai', 'Active')`,
            [adminEmail, hash]
        );
        console.log(`[AUTH] Admin created -> Email: ${adminEmail} | Staff ID: ADMIN_HQ`);
    }
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
        if (err) return res.status(403).json({ error: 'Session expired. Please log in again.' });
        req.user = user;
        next();
    });
};

// ======================== API ROUTES ========================

// 1. Dual Sign In with Approval Check
app.post('/api/auth/login', async (req, res) => {
    try {
        const { identifier, password, expected_type } = req.body;
        const cleanId = (identifier || '').trim();
        const configuredAdminEmail = (process.env.ADMIN_EMAIL || 'shankaranv161@gmail.com').trim().toLowerCase();

        const rows = await runQuery(
            "SELECT * FROM users WHERE staff_id = ? OR LOWER(email) = LOWER(?)", 
            [cleanId, cleanId]
        );
        let user = rows[0];

        if (!user) {
            return res.status(401).json({ error: 'Invalid ID or Credentials.' });
        }

        // Auto-heal admin role if identifier matches configured admin email or ADMIN_HQ
        if (cleanId.toLowerCase() === configuredAdminEmail || cleanId.toUpperCase() === 'ADMIN_HQ') {
            user.user_type = 'ADMIN';
            user.status = 'Active';
            await runExec("UPDATE users SET user_type = 'ADMIN', status = 'Active' WHERE id = ?", [user.id]);
        }

        // Enforce Login Tab Separation
        if (expected_type === 'STAFF' && user.user_type === 'ADMIN') {
            return res.status(403).json({ error: 'Access Denied: This is an Administrator account. Please use the Admin Login tab.' });
        }

        if (expected_type === 'ADMIN' && user.user_type !== 'ADMIN') {
            return res.status(403).json({ error: 'Access Denied: Staff accounts cannot access the Central Admin Desk.' });
        }

        // Verification Check for Staff
        if (user.user_type === 'STAFF') {
            if (user.status !== 'Active') {
                return res.status(403).json({ 
                    error: 'Account Pending Verification: Your registration is currently under review by the Administrator. You can sign in once your account has been approved.' 
                });
            }

            const cleanInputDob = (password || '').replace(/[-/]/g, '').trim();
            const cleanUserDob = (user.ef_dob || '').replace(/[-/]/g, '').trim();

            if (cleanInputDob !== cleanUserDob) {
                return res.status(401).json({ error: 'Invalid Staff ID or Date of Birth.' });
            }

            const token = jwt.sign(
                { id: user.id, staff_id: user.staff_id, role: user.role, user_type: user.user_type, name: user.name },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            return res.json({ token, user });
        }

        // Admin Password Validation
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid Admin Credentials.' });
        }

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

// 2. Staff Self-Service Registration (Sign Up)
app.post('/api/auth/register-staff', async (req, res) => {
    try {
        const {
            role, vendor_name, ef_city, ef_first_name, ef_middle_name, ef_last_name,
            ef_dob, ef_gender, ef_mobile_number, ef_aadhar_number, ef_father_name,
            ef_mother_name, ef_email_id, ef_qualification, ef_present_address, ef_permanent_address
        } = req.body;

        const fullName = [ef_first_name, ef_middle_name, ef_last_name].filter(Boolean).join(' ');
        const officialEmail = (ef_email_id || '').trim();
        const assignedStaffId = await generateStaffId(role, ef_city);
        const hash = await bcrypt.hash(ef_dob, 10);

        const sql = `INSERT INTO users (
            staff_id, name, role, vendor_name, email, password, user_type,
            venue_region, venue_state, ef_city, ef_first_name, ef_middle_name, ef_last_name,
            ef_dob, ef_gender, ef_mobile_number, ef_aadhar_number, ef_father_name, ef_mother_name,
            ef_email_id, ef_qualification, ef_present_address, ef_permanent_address, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'STAFF', 'South Zone', 'Tamil Nadu', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Approval')`;

        const params = [
            assignedStaffId, fullName, role, vendor_name || 'Direct / Candidate', officialEmail, hash,
            ef_city, ef_first_name, ef_middle_name, ef_last_name,
            ef_dob, ef_gender, ef_mobile_number, ef_aadhar_number, ef_father_name, ef_mother_name,
            officialEmail, ef_qualification, ef_present_address, ef_permanent_address
        ];

        const result = await runExec(sql, params);

        res.json({
            message: 'Application submitted successfully! Your Staff ID has been reserved. Please wait for Administrator approval before signing in.',
            staff_id: assignedStaffId,
            name: fullName,
            dob: ef_dob,
            mobile: ef_mobile_number,
            id: result.lastID
        });
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'This Mobile number or Email address is already registered in the system.' });
        }
        res.status(500).json({ error: err.message });
    }
});

// 3. Admin: Approve or Reject Staff Member
app.post('/api/admin/verify-staff-status', authenticateToken, async (req, res) => {
    try {
        const { staff_db_id, new_status } = req.body; // 'Active' or 'Rejected'
        await runExec("UPDATE users SET status = ? WHERE id = ? AND user_type = 'STAFF'", [new_status, staff_db_id]);
        res.json({ message: `Staff account status updated to: ${new_status}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Admin Dashboard Live Data Feed
app.get('/api/admin/dashboard', authenticateToken, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const sqlDeployments = `
            SELECT d.id as deployment_id, d.duty_date, d.shift, d.assigned_role, 
                   COALESCE(d.vendor_name, u.vendor_name, 'Direct') as vendor_name,
                   d.duty_amount, d.travel_allowance, d.other_allowance, d.total_payable,
                   u.id as staff_user_id, u.staff_id, u.name as staff_name, u.ef_mobile_number, u.ef_city,
                   e.id as exam_id, e.exam_name, e.exam_conducting_agency,
                   c.id as centre_id, c.centre_name, c.city as centre_city,
                   a.id as attendance_id, a.punch_in_time, a.punch_in_photo,
                   a.punch_out_time, a.punch_out_photo, a.working_hours,
                   a.sheet_file, a.sheet_verification_status,
                   p.id as payment_id, p.payment_status, p.reference_no,
                   CASE WHEN a.punch_in_time IS NOT NULL THEN 'Present' ELSE 'Absent' END as attendance_status
            FROM deployments d
            JOIN users u ON d.staff_id = u.id
            JOIN exams e ON d.exam_id = e.id
            JOIN centres c ON d.centre_id = c.id
            LEFT JOIN attendance a ON d.id = a.deployment_id
            LEFT JOIN payments p ON a.id = p.attendance_id
            ORDER BY d.duty_date DESC
        `;

        const [rows, staffCount, pendingApprovalCount, payPending, payPaid] = await Promise.all([
            runQuery(sqlDeployments),
            runQuery("SELECT COUNT(*) as count FROM users WHERE user_type = 'STAFF' AND status = 'Active'"),
            runQuery("SELECT COUNT(*) as count FROM users WHERE user_type = 'STAFF' AND status = 'Pending Approval'"),
            runQuery("SELECT COALESCE(SUM(total_payable), 0) as pending_pay FROM payments WHERE payment_status = 'Pending'"),
            runQuery("SELECT COALESCE(SUM(total_payable), 0) as paid_pay FROM payments WHERE payment_status = 'Paid'")
        ]);

        res.json({
            todayDate: today,
            totalStaffCount: staffCount[0]?.count || 0,
            pendingApprovalCount: pendingApprovalCount[0]?.count || 0,
            totalPaymentPending: payPending[0]?.pending_pay || 0,
            totalPaymentPaid: payPaid[0]?.paid_pay || 0,
            allDeployments: rows || []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Staff Directory
app.get('/api/staff', authenticateToken, async (req, res) => {
    try {
        const rows = await runQuery("SELECT * FROM users WHERE user_type = 'STAFF' ORDER BY id DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/staff/:id', authenticateToken, async (req, res) => {
    try {
        const {
            name, role, vendor_name, ef_city, ef_mobile_number,
            ef_qualification, ef_father_name, ef_mother_name,
            ef_present_address, ef_permanent_address, status
        } = req.body;

        const sql = `UPDATE users SET name = ?, role = ?, vendor_name = ?, ef_city = ?, ef_mobile_number = ?,
                     ef_qualification = ?, ef_father_name = ?, ef_mother_name = ?,
                     ef_present_address = ?, ef_permanent_address = ?, status = ?
                     WHERE id = ? AND user_type = 'STAFF'`;
        await runExec(sql, [
            name, role, vendor_name || 'Direct', ef_city, ef_mobile_number,
            ef_qualification, ef_father_name, ef_mother_name,
            ef_present_address, ef_permanent_address, status, req.params.id
        ]);
        res.json({ message: 'Staff profile updated successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Examinations Master
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
        const { exam_name, exam_conducting_agency, vendor_name, date_from, date_to, shift_mode, shift_timings } = req.body;
        const sql = `INSERT INTO exams (exam_name, exam_conducting_agency, vendor_name, date_from, date_to, shift_mode, shift_timings_json)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const result = await runExec(sql, [
            exam_name, exam_conducting_agency, vendor_name || 'Agency Board',
            date_from, date_to, shift_mode, JSON.stringify(shift_timings || {})
        ]);
        res.json({ message: 'Exam scheduled successfully', id: result.lastID });
    } catch (err) {
        res.status(500).json({ error: err.messag
