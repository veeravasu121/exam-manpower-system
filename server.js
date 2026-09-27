require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'EMMS_GOVT_SECURE_TOKEN_2026';
const GOOGLE_SHEET_WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || '';

// Email Transporter (Gmail / SMTP)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_EMAIL || process.env.ADMIN_EMAIL,
        pass: process.env.SMTP_PASSWORD // Google App Password (16 characters)
    }
});

// Helper to send registration email
async function sendWelcomeEmail(toEmail, staffName, staffId, dobPassword) {
    if (!process.env.SMTP_PASSWORD) return;
    const mailOptions = {
        from: `"Exam Manpower Administration" <${process.env.SMTP_EMAIL || process.env.ADMIN_EMAIL}>`,
        to: toEmail,
        subject: 'Official Examination Staff Portal Credentials',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px;">
                <div style="background: #0f2a59; color: white; padding: 15px; border-radius: 6px; text-align: center;">
                    <h2 style="margin: 0;">EXAM MANPOWER MANAGEMENT SYSTEM</h2>
                    <p style="margin: 5px 0 0 0; font-size: 13px;">Government Examination Staff Portal</p>
                </div>
                <div style="padding: 20px 0;">
                    <p>Dear <strong>${staffName}</strong>,</p>
                    <p>You have been successfully registered into the Examination Staff database. Here are your credentials to log in to the staff portal:</p>
                    <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 15px; margin: 15px 0;">
                        <p style="margin: 5px 0;"><strong>Staff ID (Username):</strong> <code style="font-size: 15px; color: #1e40af;">${staffId}</code></p>
                        <p style="margin: 5px 0;"><strong>Password (DOB):</strong> <code>${dobPassword}</code></p>
                    </div>
                    <p>Please use these credentials to log in, view examination duty assignments, record photo attendance, and submit attendance sheets.</p>
                </div>
                <div style="border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 11px; color: #64748b;">
                    This is an automated notification. Please do not reply to this email.
                </div>
            </div>
        `
    };
    try {
        await transporter.sendMail(mailOptions);
        console.log(`Welcome email sent to: ${toEmail}`);
    } catch (err) {
        console.error('Email error:', err.message);
    }
}

// Helper to send assignment email
async function sendAssignmentEmail(toEmail, staffName, details) {
    if (!process.env.SMTP_PASSWORD) return;
    const mailOptions = {
        from: `"Exam Manpower Administration" <${process.env.SMTP_EMAIL || process.env.ADMIN_EMAIL}>`,
        to: toEmail,
        subject: `Duty Assignment Notification: ${details.exam_name}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px;">
                <div style="background: #0f2a59; color: white; padding: 15px; border-radius: 6px; text-align: center;">
                    <h2 style="margin: 0;">EXAMINATION DUTY ASSIGNMENT</h2>
                    <p style="margin: 5px 0 0 0; font-size: 13px;">Official Deployment Order</p>
                </div>
                <div style="padding: 20px 0;">
                    <p>Dear <strong>${staffName}</strong>,</p>
                    <p>You have been assigned to examination duty. Please find the venue and timing details below:</p>
                    <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 15px; margin: 15px 0;">
                        <p style="margin: 6px 0;"><strong>Examination:</strong> ${details.exam_name}</p>
                        <p style="margin: 6px 0;"><strong>Assigned Role:</strong> ${details.assigned_role}</p>
                        <p style="margin: 6px 0;"><strong>Duty Date:</strong> ${details.duty_date}</p>
                        <p style="margin: 6px 0;"><strong>Assigned Shift:</strong> ${details.shift}</p>
                        <p style="margin: 6px 0;"><strong>Centre Venue:</strong> ${details.centre_name} (${details.city})</p>
                        ${details.full_address ? `<p style="margin: 6px 0;"><strong>Address:</strong> ${details.full_address}</p>` : ''}
                        ${details.map_location ? `<p style="margin: 6px 0;"><strong>Map Location:</strong> <a href="${details.map_location}" target="_blank">Open in Google Maps</a></p>` : ''}
                    </div>
                    <p style="color: #dc2626; font-size: 13px;"><strong>Notice:</strong> Please arrive at the centre strictly according to reporting time and complete your photo punch-in.</p>
                </div>
            </div>
        `
    };
    try {
        await transporter.sendMail(mailOptions);
        console.log(`Assignment email sent to: ${toEmail}`);
    } catch (err) {
        console.error('Assignment Email error:', err.message);
    }
}

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
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

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('DB Error:', err);
    else console.log('Database connected.');
});

// Database Schema
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        email TEXT UNIQUE,
        password TEXT NOT NULL,
        user_type TEXT CHECK(user_type IN ('ADMIN', 'STAFF')) NOT NULL,
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS exams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exam_name TEXT NOT NULL,
        exam_authority TEXT NOT NULL,
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

    db.run(`CREATE TABLE IF NOT EXISTS centres (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        centre_name TEXT NOT NULL,
        city TEXT NOT NULL,
        full_address TEXT,
        map_location TEXT,
        status TEXT DEFAULT 'Ready'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS deployments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exam_id INTEGER,
        centre_id INTEGER,
        staff_id INTEGER,
        assigned_role TEXT NOT NULL,
        duty_date DATE NOT NULL,
        shift TEXT NOT NULL,
        duty_amount REAL DEFAULT 1200.0,
        travel_allowance REAL DEFAULT 500.0,
        other_allowance REAL DEFAULT 200.0,
        FOREIGN KEY(exam_id) REFERENCES exams(id),
        FOREIGN KEY(centre_id) REFERENCES centres(id),
        FOREIGN KEY(staff_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        sheet_verification_status TEXT DEFAULT 'Pending',
        FOREIGN KEY(deployment_id) REFERENCES deployments(id),
        FOREIGN KEY(staff_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attendance_id INTEGER UNIQUE,
        staff_id INTEGER NOT NULL,
        duty_amount REAL NOT NULL,
        travel_allowance REAL NOT NULL,
        other_allowance REAL NOT NULL,
        total_payable REAL NOT NULL,
        payment_status TEXT DEFAULT 'Pending',
        reference_no TEXT,
        FOREIGN KEY(attendance_id) REFERENCES attendance(id),
        FOREIGN KEY(staff_id) REFERENCES users(id)
    )`);

    // Master Admin Auto-Setup
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@gmail.com').trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@12345';

    bcrypt.hash(adminPassword, 10, (err, hash) => {
        db.run("DELETE FROM users WHERE user_type = 'ADMIN'", [], () => {
            db.run(
                `INSERT INTO users (staff_id, name, role, email, password, user_type, ef_city)
                 VALUES ('ADMIN_HQ', 'Chief Administrator', 'Exam Coordinator', ?, ?, 'ADMIN', 'Chennai')`,
                [adminEmail, hash]
            );
        });
    });
});

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

function generateStaffId(role, city, callback) {
    const rolePrefix = ROLE_CODES[role] || 'ST';
    const cleanCity = (city || 'Chennai').trim();
    const cityKey = Object.keys(CITY_CODES).find(k => k.toLowerCase() === cleanCity.toLowerCase());
    const cityCode = cityKey ? CITY_CODES[cityKey] : cleanCity.substring(0, 3).toUpperCase();
    const pattern = `${rolePrefix}${cityCode}%`;

    db.get("SELECT COUNT(*) as count FROM users WHERE staff_id LIKE ?", [pattern], (err, row) => {
        const nextNum = (row ? row.count : 0) + 1;
        const formattedId = `${rolePrefix}${cityCode}${String(nextNum).padStart(3, '0')}`;
        callback(formattedId);
    });
}

async function syncToGoogleSheet(data) {
    if (!GOOGLE_SHEET_WEBHOOK_URL) return;
    try {
        await fetch(GOOGLE_SHEET_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch (err) {
        console.error('Google Sheet Sync Error:', err.message);
    }
}

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token expired or invalid' });
        req.user = user;
        next();
    });
};

// ======================== API ROUTES ========================

// 1. Dual Login
app.post('/api/auth/login', (req, res) => {
    const { identifier, password } = req.body;
    const cleanId = (identifier || '').trim();

    db.get(
        "SELECT * FROM users WHERE staff_id = ? OR LOWER(email) = LOWER(?)",
        [cleanId, cleanId],
        (err, user) => {
            if (err || !user) return res.status(401).json({ error: 'Invalid Credentials' });

            if (user.user_type === 'STAFF') {
                const cleanInputDob = (password || '').replace(/[-/]/g, '').trim();
                const cleanUserDob = (user.ef_dob || '').replace(/[-/]/g, '').trim();

                if (cleanInputDob !== cleanUserDob) {
                    return res.status(401).json({ error: 'Invalid Staff ID or Date of Birth' });
                }

                const token = jwt.sign(
                    { id: user.id, staff_id: user.staff_id, role: user.role, user_type: user.user_type, name: user.name },
                    JWT_SECRET,
                    { expiresIn: '12h' }
                );
                return res.json({ token, user });
            }

            bcrypt.compare(password, user.password, (err, isMatch) => {
                if (!isMatch) return res.status(401).json({ error: 'Invalid Admin Email or Password' });

                const token = jwt.sign(
                    { id: user.id, staff_id: user.staff_id, role: user.role, user_type: user.user_type, name: user.name },
                    JWT_SECRET,
                    { expiresIn: '12h' }
                );
                res.json({ token, user });
            });
        }
    );
});

// 2. Dashboard
app.get('/api/admin/dashboard', authenticateToken, (req, res) => {
    const today = new Date().toISOString().split('T')[0];

    const queries = {
        totalStaff: "SELECT COUNT(*) as count FROM users WHERE user_type = 'STAFF'",
        todayDeployments: "SELECT COUNT(*) as count FROM deployments WHERE duty_date = ?",
        presentToday: "SELECT COUNT(*) as count FROM attendance WHERE duty_date = ? AND punch_in_time IS NOT NULL",
        absentToday: "SELECT COUNT(*) as count FROM deployments d WHERE duty_date = ? AND d.id NOT IN (SELECT deployment_id FROM attendance WHERE duty_date = ?)",
        punchOutPending: "SELECT COUNT(*) as count FROM attendance WHERE duty_date = ? AND punch_in_time IS NOT NULL AND punch_out_time IS NULL",
        sheetPending: "SELECT COUNT(*) as count FROM attendance WHERE duty_date = ? AND sheet_verification_status = 'Pending' AND punch_out_time IS NOT NULL",
        paymentPendingAmount: "SELECT COALESCE(SUM(total_payable), 0) as sum FROM payments WHERE payment_status = 'Pending'",
        paymentPaidAmount: "SELECT COALESCE(SUM(total_payable), 0) as sum FROM payments WHERE payment_status = 'Paid'",
        centres: `SELECT c.centre_name, 
                         COUNT(d.id) as assigned,
                         SUM(CASE WHEN a.punch_in_time IS NOT NULL THEN 1 ELSE 0 END) as present
                  FROM centres c
                  LEFT JOIN deployments d ON c.id = d.centre_id AND d.duty_date = ?
                  LEFT JOIN attendance a ON d.id = a.deployment_id
                  GROUP BY c.id`
    };

    db.get(queries.totalStaff, [], (e1, r1) => {
        db.get(queries.todayDeployments, [today], (e2, r2) => {
            db.get(queries.presentToday, [today], (e3, r3) => {
                db.get(queries.absentToday, [today, today], (e4, r4) => {
                    db.get(queries.punchOutPending, [today], (e5, r5) => {
                        db.get(queries.sheetPending, [today], (e6, r6) => {
                            db.get(queries.paymentPendingAmount, [], (e7, r7) => {
                                db.get(queries.paymentPaidAmount, [], (e8, r8) => {
                                    db.all(queries.centres, [today], (e9, centresList) => {
                                        res.json({
                                            todayDate: today,
                                            totalStaff: r1 ? r1.count : 0,
                                            todayStaff: r2 ? r2.count : 0,
                                            present: r3 ? r3.count : 0,
                                            absent: r4 ? r4.count : 0,
                                            punchOutPending: r5 ? r5.count : 0,
                                            sheetPending: r6 ? r6.count : 0,
                                            paymentPending: r7 ? r7.sum : 0,
                                            paymentPaid: r8 ? r8.sum : 0,
                                            centreStatus: centresList || []
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

// 3. Staff CRUD
app.get('/api/staff', authenticateToken, (req, res) => {
    db.all("SELECT * FROM users WHERE user_type = 'STAFF' ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/staff', authenticateToken, (req, res) => {
    const {
        role, email_address, venue_region, venue_state, ef_city,
        ef_first_name, ef_middle_name, ef_last_name, ef_dob, ef_gender,
        ef_mobile_number, ef_aadhar_number, ef_father_name, ef_mother_name,
        ef_email_id, ef_qualification, ef_present_address, ef_permanent_address
    } = req.body;

    const fullName = [ef_first_name, ef_middle_name, ef_last_name].filter(Boolean).join(' ');
    const officialEmail = ef_email_id || email_address;

    generateStaffId(role, ef_city, (assignedStaffId) => {
        bcrypt.hash(ef_dob, 10, (err, hash) => {
            const sql = `INSERT INTO users (
                staff_id, name, role, email, password, user_type,
                venue_region, venue_state, ef_city, ef_first_name, ef_middle_name, ef_last_name,
                ef_dob, ef_gender, ef_mobile_number, ef_aadhar_number, ef_father_name, ef_mother_name,
                ef_email_id, ef_qualification, ef_present_address, ef_permanent_address
            ) VALUES (?, ?, ?, ?, ?, 'STAFF', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            const params = [
                assignedStaffId, fullName, role, officialEmail, hash,
                venue_region, venue_state, ef_city, ef_first_name, ef_middle_name, ef_last_name,
                ef_dob, ef_gender, ef_mobile_number, ef_aadhar_number, ef_father_name, ef_mother_name,
                officialEmail, ef_qualification, ef_present_address, ef_permanent_address
            ];

            db.run(sql, params, function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Mobile number or Email already exists.' });
                    return res.status(500).json({ error: err.message });
                }

                // 1. Send Login Credentials Email
                sendWelcomeEmail(officialEmail, fullName, assignedStaffId, ef_dob);

                // 2. Sync to Google Sheet Webhook
                syncToGoogleSheet({
                    staff_id: assignedStaffId, role, email: officialEmail,
                    venue_region, venue_state, ef_city, ef_first_name, ef_middle_name, ef_last_name,
                    ef_dob, ef_gender, ef_mobile_number, ef_aadhar_number, ef_father_name, ef_mother_name,
                    ef_email_id: officialEmail, ef_qualification, ef_present_address, ef_permanent_address
                });

                res.json({ message: 'Staff registered successfully', staff_id: assignedStaffId, id: this.lastID });
            });
        });
    });
});

app.put('/api/staff/:id', authenticateToken, (req, res) => {
    const {
        name, role, ef_city, ef_mobile_number, ef_qualification,
        ef_present_address, ef_permanent_address, status
    } = req.body;

    const sql = `UPDATE users SET name = ?, role = ?, ef_city = ?, ef_mobile_number = ?,
                 ef_qualification = ?, ef_present_address = ?, ef_permanent_address = ?, status = ?
                 WHERE id = ? AND user_type = 'STAFF'`;
    db.run(sql, [name, role, ef_city, ef_mobile_number, ef_qualification, ef_present_address, ef_permanent_address, status, req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Staff details updated successfully' });
    });
});

// 4. Exams CRUD
app.get('/api/exams', authenticateToken, (req, res) => {
    db.all("SELECT * FROM exams ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/exams', authenticateToken, (req, res) => {
    const {
        exam_name, exam_authority, date_from, date_to, shift_mode,
        s1_reporting_time, s1_start_time, s1_end_time,
        s2_reporting_time, s2_start_time, s2_end_time,
        s3_reporting_time, s3_start_time, s3_end_time
    } = req.body;

    const sql = `INSERT INTO exams (
        exam_name, exam_authority, date_from, date_to, shift_mode,
        s1_reporting_time, s1_start_time, s1_end_time,
        s2_reporting_time, s2_start_time, s2_end_time,
        s3_reporting_time, s3_start_time, s3_end_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(sql, [
        exam_name, exam_authority, date_from, date_to, shift_mode,
        s1_reporting_time || null, s1_start_time || null, s1_end_time || null,
        s2_reporting_time || null, s2_start_time || null, s2_end_time || null,
        s3_reporting_time || null, s3_start_time || null, s3_end_time || null
    ], function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: 'Exam created successfully', id: this.lastID });
    });
});

app.put('/api/exams/:id', authenticateToken, (req, res) => {
    const {
        exam_name, exam_authority, date_from, date_to, shift_mode,
        s1_reporting_time, s1_start_time, s1_end_time,
        s2_reporting_time, s2_start_time, s2_end_time,
        s3_reporting_time, s3_start_time, s3_end_time
    } = req.body;

    const sql = `UPDATE exams SET
        exam_name = ?, exam_authority = ?, date_from = ?, date_to = ?, shift_mode = ?,
        s1_reporting_time = ?, s1_start_time = ?, s1_end_time = ?,
        s2_reporting_time = ?, s2_start_time = ?, s2_end_time = ?,
        s3_reporting_time = ?, s3_start_time = ?, s3_end_time = ?
        WHERE id = ?`;

    db.run(sql, [
        exam_name, exam_authority, date_from, date_to, shift_mode,
        s1_reporting_time, s1_start_time, s1_end_time,
        s2_reporting_time, s2_start_time, s2_end_time,
        s3_reporting_time, s3_start_time, s3_end_time,
        req.params.id
    ], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Examination updated successfully' });
    });
});

// 5. Centres CRUD
app.get('/api/centres', authenticateToken, (req, res) => {
    db.all("SELECT * FROM centres ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/centres', authenticateToken, (req, res) => {
    const { centre_name, city, full_address, map_location } = req.body;
    const sql = `INSERT INTO centres (centre_name, city, full_address, map_location) VALUES (?, ?, ?, ?)`;
    db.run(sql, [centre_name, city, full_address || '', map_location || ''], function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: 'Centre created successfully', id: this.lastID });
    });
});

app.put('/api/centres/:id', authenticateToken, (req, res) => {
    const { centre_name, city, full_address, map_location } = req.body;
    const sql = `UPDATE centres SET centre_name = ?, city = ?, full_address = ?, map_location = ? WHERE id = ?`;
    db.run(sql, [centre_name, city, full_address || '', map_location || '', req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Centre updated successfully' });
    });
});

// 6. Deployments CRUD
app.get('/api/deployments', authenticateToken, (req, res) => {
    const sql = `SELECT d.*, u.name as staff_name, u.staff_id, u.email as staff_email,
                        e.exam_name, c.centre_name, c.city, c.full_address, c.map_location
                 FROM deployments d
                 JOIN users u ON d.staff_id = u.id
                 JOIN exams e ON d.exam_id = e.id
                 JOIN centres c ON d.centre_id = c.id
                 ORDER BY d.duty_date DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/deployments', authenticateToken, (req, res) => {
    const { exam_id, centre_id, staff_id, assigned_role, duty_date, shift } = req.body;
    const sql = `INSERT INTO deployments (exam_id, centre_id, staff_id, assigned_role, duty_date, shift)
                 VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(sql, [exam_id, centre_id, staff_id, assigned_role, duty_date, shift], function (err) {
        if (err) return res.status(400).json({ error: err.message });

        // Retrieve deployment details and email the assigned staff member
        const queryDetails = `
            SELECT u.name, u.email, e.exam_name, c.centre_name, c.city, c.full_address, c.map_location
            FROM users u, exams e, centres c
            WHERE u.id = ? AND e.id = ? AND c.id = ?
        `;
        db.get(queryDetails, [staff_id, exam_id, centre_id], (err, row) => {
            if (row && row.email) {
                sendAssignmentEmail(row.email, row.name, {
                    exam_name: row.exam_name,
                    assigned_role,
                    duty_date,
                    shift,
                    centre_name: row.centre_name,
                    city: row.city,
                    full_address: row.full_address,
                    map_location: row.map_location
                });
            }
        });

        res.json({ message: 'Staff deployed successfully', id: this.lastID });
    });
});

app.put('/api/deployments/:id', authenticateToken, (req, res) => {
    const { exam_id, centre_id, staff_id, assigned_role, duty_date, shift } = req.body;
    const sql = `UPDATE deployments SET exam_id = ?, centre_id = ?, staff_id = ?, assigned_role = ?, duty_date = ?, shift = ?
                 WHERE id = ?`;
    db.run(sql, [exam_id, centre_id, staff_id, assigned_role, duty_date, shift, req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Deployment updated successfully' });
    });
});

// 7. Full Reports APIs
app.get('/api/admin/reports/attendance', authenticateToken, (req, res) => {
    const sql = `SELECT a.id, a.duty_date, a.punch_in_time, a.punch_out_time, a.working_hours, 
                        a.sheet_verification_status, a.is_late_submission,
                        u.staff_id, u.name as staff_name, u.role, u.ef_city,
                        e.exam_name, c.centre_name
                 FROM attendance a
                 JOIN users u ON a.staff_id = u.id
                 JOIN deployments d ON a.deployment_id = d.id
                 JOIN exams e ON d.exam_id = e.id
                 JOIN centres c ON d.centre_id = c.id
                 ORDER BY a.duty_date DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/admin/reports/payments', authenticateToken, (req, res) => {
    const sql = `SELECT p.id, p.duty_amount, p.travel_allowance, p.other_allowance, p.total_payable,
                        p.payment_status, p.reference_no,
                        u.staff_id, u.name as staff_name, u.role, u.ef_city,
                        a.duty_date, c.centre_name
                 FROM payments p
                 JOIN users u ON p.staff_id = u.id
                 JOIN attendance a ON p.attendance_id = a.id
                 JOIN deployments d ON a.deployment_id = d.id
                 JOIN centres c ON d.centre_id = c.id
                 ORDER BY a.duty_date DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 8. Staff Portal APIs
app.get('/api/staff/my-assignment', authenticateToken, (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const sql = `SELECT d.id as deployment_id, d.duty_date, d.shift, d.assigned_role, d.duty_amount, d.travel_allowance, d.other_allowance,
                        e.exam_name, e.shift_mode,
                        e.s1_reporting_time, e.s1_start_time, e.s1_end_time,
                        e.s2_reporting_time, e.s2_start_time, e.s2_end_time,
                        e.s3_reporting_time, e.s3_start_time, e.s3_end_time,
                        c.centre_name, c.city, c.full_address, c.map_location,
                        a.id as attendance_id, a.punch_in_time, a.punch_out_time, a.sheet_verification_status, a.sheet_file,
                        p.payment_status, p.total_payable
                 FROM deployments d
                 JOIN exams e ON d.exam_id = e.id
                 JOIN centres c ON d.centre_id = c.id
                 LEFT JOIN attendance a ON d.id = a.deployment_id
                 LEFT JOIN payments p ON a.id = p.attendance_id
                 WHERE d.staff_id = ? AND d.duty_date = ?
                 LIMIT 1`;
    db.get(sql, [req.user.id, today], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || null);
    });
});

app.post('/api/attendance/punch-in', authenticateToken, (req, res) => {
    const { deployment_id, photo_base64 } = req.body;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
    const today = now.toISOString().split('T')[0];

    const filename = `punchin-${req.user.id}-${Date.now()}.jpg`;
    const filepath = path.join(uploadDir, filename);
    const base64Data = photo_base64.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filepath, base64Data, 'base64');

    const sql = `INSERT INTO attendance (deployment_id, staff_id, duty_date, punch_in_time, punch_in_photo)
                 VALUES (?, ?, ?, ?, ?)`;
    db.run(sql, [deployment_id, req.user.id, today, timeStr, `/uploads/${filename}`], function (err) {
        if (err) return res.status(400).json({ error: 'Punch-in already recorded.' });
        res.json({ message: 'Punch-in registered', punch_in_time: timeStr });
    });
});

app.post('/api/attendance/punch-out', authenticateToken, (req, res) => {
    const { deployment_id, photo_base64 } = req.body;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false });

    const filename = `punchout-${req.user.id}-${Date.now()}.jpg`;
    const filepath = path.join(uploadDir, filename);
    const base64Data = photo_base64.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filepath, base64Data, 'base64');

    db.get("SELECT * FROM attendance WHERE deployment_id = ?", [deployment_id], (err, record) => {
        if (err || !record) return res.status(400).json({ error: 'No punch-in recorded' });

        const [h1, m1] = record.punch_in_time.split(':').map(Number);
        const [h2, m2] = timeStr.split(':').map(Number);
        const diffMinutes = (h2 * 60 + m2) - (h1 * 60 + m1);
        const workingHours = `${Math.floor(diffMinutes / 60)}h ${diffMinutes % 60}m`;

        const sql = `UPDATE attendance SET punch_out_time = ?, punch_out_photo = ?, working_hours = ? WHERE deployment_id = ?`;
        db.run(sql, [timeStr, `/uploads/${filename}`, workingHours, deployment_id], function (err) {
            if (err) return res.status(500).json({ error: err.message });

            db.get("SELECT duty_amount, travel_allowance, other_allowance FROM deployments WHERE id = ?", [deployment_id], (err, dep) => {
                if (dep) {
                    const total = dep.duty_amount + dep.travel_allowance + dep.other_allowance;
                    db.run(
                        `INSERT OR IGNORE INTO payments (attendance_id, staff_id, duty_amount, travel_allowance, other_allowance, total_payable, payment_status)
                         VALUES (?, ?, ?, ?, ?, ?, 'Pending')`,
                        [record.id, req.user.id, dep.duty_amount, dep.travel_allowance, dep.other_allowance, total]
                    );
                }
            });

            res.json({ message: 'Punch-out recorded', punch_out_time: timeStr, working_hours: workingHours });
        });
    });
});

app.post('/api/attendance/upload-sheet', authenticateToken, upload.single('attendance_sheet'), (req, res) => {
    const { deployment_id, is_late, late_reason } = req.body;
    if (!req.file) return res.status(400).json({ error: 'File upload missing' });

    const submissionTime = new Date().toLocaleTimeString('en-US', { hour12: false });
    const sheetFilePath = `/uploads/${req.file.filename}`;

    const sql = `UPDATE attendance 
                 SET sheet_file = ?, sheet_submission_time = ?, is_late_submission = ?, late_reason = ?, sheet_verification_status = 'Submitted'
                 WHERE deployment_id = ?`;
    db.run(sql, [sheetFilePath, submissionTime, is_late === 'true' ? 1 : 0, late_reason || null, deployment_id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Sheet submitted successfully', file: sheetFilePath });
    });
});

app.get('/api/admin/attendance-sheets', authenticateToken, (req, res) => {
    const sql = `SELECT a.*, u.name as staff_name, u.role, u.staff_id, c.centre_name
                 FROM attendance a
                 JOIN users u ON a.staff_id = u.id
                 JOIN deployments d ON a.deployment_id = d.id
                 JOIN centres c ON d.centre_id = c.id
                 ORDER BY a.id DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/verify-sheet', authenticateToken, (req, res) => {
    const { attendance_id, status } = req.body;
    db.run("UPDATE attendance SET sheet_verification_status = ? WHERE id = ?", [status, attendance_id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `Sheet ${status}` });
    });
});

app.get('/api/admin/payments', authenticateToken, (req, res) => {
    const sql = `SELECT p.*, u.name as staff_name, u.staff_id, u.role, a.duty_date, a.sheet_verification_status, c.centre_name
                 FROM payments p
                 JOIN users u ON p.staff_id = u.id
                 JOIN attendance a ON p.attendance_id = a.id
                 JOIN deployments d ON a.deployment_id = d.id
                 JOIN centres c ON d.centre_id = c.id
                 ORDER BY p.id DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/update-payment', authenticateToken, (req, res) => {
    const { payment_id, status } = req.body;
    const ref = status === 'Paid' ? 'TXN' + Math.floor(10000000 + Math.random() * 90000000) : null;
    const sql = `UPDATE payments SET payment_status = ?, reference_no = COALESCE(?, reference_no) WHERE id = ?`;
    db.run(sql, [status, ref, payment_id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `Payment marked as ${status}` });
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`EMMS Running on port ${PORT}`);
});
