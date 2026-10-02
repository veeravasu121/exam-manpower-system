TEXT,
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
        exam_conducting_agency TEXT NOT NULL,
        vendor_name TEXT DEFAULT 'Govt Examination Board',
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
        vendor_name TEXT,
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

// 1. Dual Login (Admin with Email, Staff with StaffID + DOB)
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
                    { expiresIn: '24h' }
                );
                return res.json({ token, user });
            }

            bcrypt.compare(password, user.password, (err, isMatch) => {
                if (!isMatch) return res.status(401).json({ error: 'Invalid Admin Email or Password' });

                const token = jwt.sign(
                    { id: user.id, staff_id: user.staff_id, role: user.role, user_type: user.user_type, name: user.name },
                    JWT_SECRET,
                    { expiresIn: '24h' }
                );
                res.json({ token, user });
            });
        }
    );
});

// 2. Admin Dashboard Feed
app.get('/api/admin/dashboard', authenticateToken, (req, res) => {
    const today = new Date().toISOString().split('T')[0];

    const sqlDeployments = `
        SELECT d.id as deployment_id, d.duty_date, d.shift, d.assigned_role, 
               COALESCE(d.vendor_name, u.vendor_name, 'Direct') as vendor_name,
               u.id as staff_user_id, u.staff_id, u.name as staff_name, u.ef_mobile_number,
               e.id as exam_id, e.exam_name, e.exam_conducting_agency,
               c.id as centre_id, c.centre_name, c.city as centre_city,
               a.id as attendance_id, a.punch_in_time, a.punch_in_photo,
               a.punch_out_time, a.punch_out_photo, a.working_hours,
               a.sheet_file, a.sheet_verification_status, a.is_late_submission, a.late_reason,
               p.id as payment_id, p.duty_amount, p.travel_allowance, p.other_allowance,
               p.total_payable, p.payment_status, p.reference_no,
               CASE WHEN a.punch_in_time IS NOT NULL THEN 'Present' ELSE 'Absent' END as attendance_status
        FROM deployments d
        JOIN users u ON d.staff_id = u.id
        JOIN exams e ON d.exam_id = e.id
        JOIN centres c ON d.centre_id = c.id
        LEFT JOIN attendance a ON d.id = a.deployment_id
        LEFT JOIN payments p ON a.id = p.attendance_id
        ORDER BY d.duty_date DESC
    `;

    db.all(sqlDeployments, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        db.get("SELECT COUNT(*) as count FROM users WHERE user_type = 'STAFF'", [], (e1, rStaff) => {
            db.get("SELECT COALESCE(SUM(total_payable), 0) as pending_pay FROM payments WHERE payment_status = 'Pending'", [], (e2, rPayPending) => {
                db.get("SELECT COALESCE(SUM(total_payable), 0) as paid_pay FROM payments WHERE payment_status = 'Paid'", [], (e3, rPayPaid) => {
                    res.json({
                        todayDate: today,
                        totalStaffCount: rStaff ? rStaff.count : 0,
                        totalPaymentPending: rPayPending ? rPayPending.pending_pay : 0,
                        totalPaymentPaid: rPayPaid ? rPayPaid.paid_pay : 0,
                        allDeployments: rows || []
                    });
                });
            });
        });
    });
});

// 3. Staff Registry
app.get('/api/staff', authenticateToken, (req, res) => {
    db.all("SELECT * FROM users WHERE user_type = 'STAFF' ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/staff', authenticateToken, (req, res) => {
    const {
        role, vendor_name, email_address, venue_region, venue_state, ef_city,
        ef_first_name, ef_middle_name, ef_last_name, ef_dob, ef_gender,
        ef_mobile_number, ef_aadhar_number, ef_father_name, ef_mother_name,
        ef_email_id, ef_qualification, ef_present_address, ef_permanent_address
    } = req.body;

    const fullName = [ef_first_name, ef_middle_name, ef_last_name].filter(Boolean).join(' ');
    const officialEmail = (ef_email_id || email_address || '').trim();
    const assignedVendor = vendor_name || 'Direct / In-House';

    generateStaffId(role, ef_city, (assignedStaffId) => {
        bcrypt.hash(ef_dob, 10, (err, hash) => {
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

            db.run(sql, params, function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Mobile number or Email already exists.' });
                    return res.status(500).json({ error: err.message });
                }

                // Cloud Sync + Auto-Email
                dispatchGoogleWebhook({
                    action: 'REGISTER_STAFF',
                    staff_id: assignedStaffId, role, vendor_name: assignedVendor, email: officialEmail,
                    venue_region, venue_state, ef_city, ef_first_name, ef_middle_name, ef_last_name,
                    ef_dob, ef_gender, ef_mobile_number, ef_aadhar_number: ef_aadhar_number ? '[Aadhaar Redacted]' : '', ef_father_name, ef_mother_name,
                    ef_email_id: officialEmail, ef_qualification, ef_present_address, ef_permanent_address
                });

                res.json({ message: 'Staff registered successfully', staff_id: assignedStaffId, id: this.lastID });
            });
        });
    });
});

app.put('/api/staff/:id', authenticateToken, (req, res) => {
    const { name, role, vendor_name, ef_city, ef_mobile_number, ef_qualification, ef_present_address, ef_permanent_address, status } = req.body;
    const sql = `UPDATE users SET name = ?, role = ?, vendor_name = ?, ef_city = ?, ef_mobile_number = ?,
                 ef_qualification = ?, ef_present_address = ?, ef_permanent_address = ?, status = ?
                 WHERE id = ? AND user_type = 'STAFF'`;
    db.run(sql, [name, role, vendor_name || 'Direct', ef_city, ef_mobile_number, ef_qualification, ef_present_address, ef_permanent_address, status, req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Staff details updated successfully' });
    });
});

// 4. Exams Management
app.get('/api/exams', authenticateToken, (req, res) => {
    db.all("SELECT * FROM exams ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/exams', authenticateToken, (req, res) => {
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

    db.run(sql, [
        exam_name, exam_conducting_agency, vendor_name || 'Direct Agency', date_from, date_to, shift_mode,
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
        exam_name, exam_conducting_agency, vendor_name, date_from, date_to, shift_mode,
        s1_reporting_time, s1_start_time, s1_end_time,
        s2_reporting_time, s2_start_time, s2_end_time,
        s3_reporting_time, s3_start_time, s3_end_time
    } = req.body;

    const sql = `UPDATE exams SET
        exam_name = ?, exam_conducting_agency = ?, vendor_name = ?, date_from = ?, date_to = ?, shift_mode = ?,
        s1_reporting_time = ?, s1_start_time = ?, s1_end_time = ?,
        s2_reporting_time = ?, s2_start_time = ?, s2_end_time = ?,
        s3_reporting_time = ?, s3_start_time = ?, s3_end_time = ?
        WHERE id = ?`;

    db.run(sql, [
        exam_name, exam_conducting_agency, vendor_name, date_from, date_to, shift_mode,
        s1_reporting_time, s1_start_time, s1_end_time,
        s2_reporting_time, s2_start_time, s2_end_time,
        s3_reporting_time, s3_start_time, s3_end_time,
        req.params.id
    ], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Examination updated successfully' });
    });
});

// 5. Centres Management
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

// 6. Multi-Day Deployments Engine (Assign from date_from to date_to)
app.get('/api/deployments', authenticateToken, (req, res) => {
    const sql = `SELECT d.*, u.name as staff_name, u.staff_id, u.email as staff_email,
                        e.exam_name, e.exam_conducting_agency, c.centre_name, c.city, c.full_address, c.map_location
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
    const { exam_id, centre_id, staff_id, assigned_role, vendor_name, duty_date_from, duty_date_to, shift } = req.body;

    const startDate = new Date(duty_date_from);
    const endDate = new Date(duty_date_to || duty_date_from);

    db.get("SELECT vendor_name, email, name FROM users WHERE id = ?", [staff_id], (err, u) => {
        const resolvedVendor = vendor_name || (u ? u.vendor_name : 'Direct');

        const insertStmt = db.prepare(`INSERT INTO deployments (exam_id, centre_id, staff_id, assigned_role, vendor_name, duty_date, shift)
                                       VALUES (?, ?, ?, ?, ?, ?, ?)`);

        let currentDate = new Date(startDate);
        let daysCount = 0;

        while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            insertStmt.run([exam_id, centre_id, staff_id, assigned_role, resolvedVendor, dateStr, shift]);
            currentDate.setDate(currentDate.getDate() + 1);
            daysCount++;
        }
        insertStmt.finalize();

        // Email Notification for Full Multi-Day Period
        const queryDetails = `SELECT e.exam_name, c.centre_name, c.city, c.full_address, c.map_location FROM exams e, centres c WHERE e.id = ? AND c.id = ?`;
        db.get(queryDetails, [exam_id, centre_id], (err, row) => {
            if (row && u && u.email) {
                dispatchGoogleWebhook({
                    action: 'SEND_ASSIGNMENT_EMAIL',
                    to_email: u.email,
                    staff_name: u.name,
                    exam_name: row.exam_name,
                    assigned_role,
                    duty_date_from,
                    duty_date_to: duty_date_to || duty_date_from,
                    total_days: daysCount,
                    shift,
                    centre_name: row.centre_name,
                    city: row.city,
                    full_address: row.full_address,
                    map_location: row.map_location
                });
            }
        });

        res.json({ message: `Successfully assigned ${daysCount} day(s) of examination duty!` });
    });
});

app.put('/api/deployments/:id', authenticateToken, (req, res) => {
    const { exam_id, centre_id, staff_id, assigned_role, vendor_name, duty_date, shift } = req.body;
    const sql = `UPDATE deployments SET exam_id = ?, centre_id = ?, staff_id = ?, assigned_role = ?, vendor_name = ?, duty_date = ?, shift = ?
                 WHERE id = ?`;
    db.run(sql, [exam_id, centre_id, staff_id, assigned_role, vendor_name, duty_date, shift, req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Deployment updated successfully' });
    });
});

// 7. Staff Portal: All Duty Assignments & Complete Salary Ledger
app.get('/api/staff/my-portal-data', authenticateToken, (req, res) => {
    const today = new Date().toISOString().split('T')[0];

    const sqlDuties = `
        SELECT d.id as deployment_id, d.duty_date, d.shift, d.assigned_role,
               d.duty_amount, d.travel_allowance, d.other_allowance,
               (d.duty_amount + d.travel_allowance + d.other_allowance) as total_payable,
               e.exam_name, e.exam_conducting_agency,
               e.s1_reporting_time, e.s1_start_time, e.s1_end_time,
               e.s2_reporting_time, e.s2_start_time, e.s2_end_time,
               e.s3_reporting_time, e.s3_start_time, e.s3_end_time,
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

    db.all(sqlDuties, [today, req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Calculate Salary Aggregations
        let totalWorkedDays = 0;
        let totalEarned = 0;
        let totalReceived = 0;
        let totalPending = 0;

        (rows || []).forEach(r => {
            const amount = r.total_payable || 1900;
            if (r.punch_in_time) totalWorkedDays++;
            totalEarned += amount;

            if (r.payment_status === 'Paid') {
                totalReceived += amount;
            } else {
                totalPending += amount;
            }
        });

        res.json({
            summary: {
                totalWorkedDays,
                totalEarned,
                totalReceived,
                totalPending
            },
            history: rows || []
        });
    });
});

// 8. Staff Attendance & Uploads
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

// 9. Verification & Payment Ledger Actions
app.get('/api/admin/attendance-sheets', authenticateToken, (req, res) => {
    const sql = `SELECT a.*, u.name as staff_name, u.role, u.staff_id, u.vendor_name,
                        c.centre_name, e.exam_name
                 FROM attendance a
                 JOIN users u ON a.staff_id = u.id
                 JOIN deployments d ON a.deployment_id = d.id
                 JOIN exams e ON d.exam_id = e.id
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
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/update-payment', authenticateToken, (req, res) => {
    const { payment_id, status } = req.body;
    const ref = status === 'Paid' ? 'TXN-GOV-' + Math.floor(10000000 + Math.random() * 90000000) : null;
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
    console.log(`EMMS Server running on port ${PORT}`);
});
Step 3: Complete Frontend (public/index.html)
Open public/index.html in your GitHub repository and replace it with this all-in-one code:

HTML
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EXAM MANPOWER MANAGEMENT SYSTEM</title>
    <style>
        :root {
            --primary: #0f2a59;
            --primary-light: #1e40af;
            --accent: #2563eb;
            --surface: #ffffff;
            --bg: #f8fafc;
            --border: #e2e8f0;
            --text-main: #0f172a;
