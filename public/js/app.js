let CURRENT_USER = null;
let TOKEN = localStorage.getItem('EMMS_TOKEN') || null;
let USER_ASSIGNMENT = null;
let currentLoginType = 'STAFF'; // 'STAFF' or 'ADMIN'
let videoStream = null;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('liveClock').innerText = new Date().toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
    });

    if (TOKEN) {
        try {
            CURRENT_USER = JSON.parse(localStorage.getItem('EMMS_USER'));
            initSession();
        } catch (e) {
            logout();
        }
    } else {
        document.getElementById('authView').style.display = 'flex';
        document.getElementById('appShell').style.display = 'none';
    }
});

function setLoginType(type) {
    currentLoginType = type;
    const tabStaff = document.getElementById('tabStaff');
    const tabAdmin = document.getElementById('tabAdmin');
    const lblIdentifier = document.getElementById('lblIdentifier');
    const lblPassword = document.getElementById('lblPassword');
    const loginIdentifier = document.getElementById('loginIdentifier');
    const loginPassword = document.getElementById('loginPassword');

    if (type === 'STAFF') {
        tabStaff.className = 'btn btn-primary';
        tabAdmin.className = 'btn btn-outline';
        lblIdentifier.innerText = 'Staff ID';
        loginIdentifier.placeholder = 'e.g. LSTRI001';
        lblPassword.innerText = 'Date of Birth (Password)';
        loginPassword.placeholder = 'DDMMYYYY or YYYY-MM-DD';
    } else {
        tabAdmin.className = 'btn btn-primary';
        tabStaff.className = 'btn btn-outline';
        lblIdentifier.innerText = 'Admin Email Address';
        loginIdentifier.placeholder = 'e.g. admin@gmail.com';
        lblPassword.innerText = 'Admin Password';
        loginPassword.placeholder = '••••••••';
    }
}

// Login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = document.getElementById('loginIdentifier').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const alertBox = document.getElementById('loginAlert');

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password })
        });
        const data = await res.json();

        if (!res.ok) {
            alertBox.innerText = data.error || 'Authentication failed';
            alertBox.style.display = 'block';
            return;
        }

        TOKEN = data.token;
        CURRENT_USER = data.user;
        localStorage.setItem('EMMS_TOKEN', TOKEN);
        localStorage.setItem('EMMS_USER', JSON.stringify(CURRENT_USER));
        initSession();
    } catch (err) {
        alertBox.innerText = 'Unable to connect to server';
        alertBox.style.display = 'block';
    }
});

function initSession() {
    document.getElementById('authView').style.display = 'none';
    document.getElementById('appShell').style.display = 'flex';
    document.getElementById('sessionUserDisplay').innerText = CURRENT_USER.name;
    document.getElementById('sessionRoleBadge').innerText = CURRENT_USER.role;

    if (CURRENT_USER.user_type === 'ADMIN') {
        document.getElementById('adminNav').style.display = 'block';
        document.getElementById('staffNav').style.display = 'none';
        switchRoute('admin-dashboard');
    } else {
        document.getElementById('adminNav').style.display = 'none';
        document.getElementById('staffNav').style.display = 'block';
        switchRoute('staff-duty');
        startCamera();
    }
}

function logout() {
    localStorage.removeItem('EMMS_TOKEN');
    localStorage.removeItem('EMMS_USER');
    TOKEN = null;
    CURRENT_USER = null;
    if (videoStream) {
        videoStream.getTracks().forEach(t => t.stop());
    }
    location.reload();
}

function switchRoute(route) {
    document.querySelectorAll('.page-view').forEach(v => v.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

    const target = document.getElementById(`view-${route}`);
    if (target) target.style.display = 'block';

    if (route === 'admin-dashboard') loadAdminDashboard();
    if (route === 'admin-staff') loadStaffList();
    if (route === 'admin-exams') loadExamsList();
    if (route === 'admin-centres') loadCentresList();
    if (route === 'admin-deployments') loadDeploymentsList();
    if (route === 'admin-attendance') loadAttendanceSheets();
    if (route === 'admin-payments') loadPaymentsList();
    if (route === 'staff-duty') loadStaffAssignment();
}

async function api(url, options = {}) {
    options.headers = options.headers || {};
    options.headers['Authorization'] = `Bearer ${TOKEN}`;
    const res = await fetch(url, options);
    if (res.status === 401 || res.status === 403) {
        logout();
        return null;
    }
    return res.json();
}

// Admin API Loaders
async function loadAdminDashboard() {
    const data = await api('/api/admin/dashboard');
    if (!data) return;

    document.getElementById('dashTotalStaff').innerText = data.totalStaff;
    document.getElementById('dashTodayStaff').innerText = data.todayStaff;
    document.getElementById('dashPresent').innerText = data.present;
    document.getElementById('dashAbsent').innerText = data.absent;
    document.getElementById('dashPunchOutPending').innerText = data.punchOutPending;
    document.getElementById('dashPaymentPending').innerText = `₹${data.paymentPending.toLocaleString()}`;

    const tbody = document.getElementById('centreStatusTableBody');
    if (data.centreStatus.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8;">No active exam venues today.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.centreStatus.map(c => {
        const shortage = c.assigned - c.present;
        const statusBadge = shortage > 0 
            ? `<span class="badge badge-shortage">Shortage (${shortage})</span>`
            : `<span class="badge badge-present">Completed</span>`;
        return `
            <tr>
                <td><strong>${c.centre_name}</strong></td>
                <td>${c.assigned}</td>
                <td>${c.present}</td>
                <td style="color: ${shortage > 0 ? '#ea580c' : '#16a34a'}; font-weight: 600;">${shortage}</td>
                <td>${statusBadge}</td>
            </tr>
        `;
    }).join('');
}

async function loadStaffList() {
    const staff = await api('/api/staff');
    const tbody = document.getElementById('staffTableBody');
    if (!staff || staff.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#94a3b8;">No staff registered yet.</td></tr>`;
        return;
    }
    tbody.innerHTML = staff.map(s => `
        <tr>
            <td><strong>${s.staff_id}</strong></td>
            <td>${s.name}</td>
            <td>${s.role}</td>
            <td>${s.ef_city}</td>
            <td>${s.ef_mobile_number || 'N/A'}</td>
            <td><code>${s.ef_dob || 'N/A'}</code></td>
            <td><span class="badge badge-active">${s.status}</span></td>
        </tr>
    `).join('');
}

async function loadExamsList() {
    const exams = await api('/api/exams');
    const tbody = document.getElementById('examsTableBody');
    if (!exams || exams.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#94a3b8;">No exams scheduled.</td></tr>`;
        return;
    }
    tbody.innerHTML = exams.map(e => `
        <tr>
            <td><strong>${e.exam_name}</strong></td>
            <td>${e.exam_authority}</td>
            <td>${e.exam_date}</td>
            <td><span class="badge badge-ready">${e.shift}</span></td>
            <td>${e.reporting_time}</td>
            <td>${e.start_time} - ${e.end_time}</td>
        </tr>
    `).join('');
}

async function loadCentresList() {
    const centres = await api('/api/centres');
    const tbody = document.getElementById('centresTableBody');
    if (!centres || centres.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94a3b8;">No centres registered.</td></tr>`;
        return;
    }
    tbody.innerHTML = centres.map(c => `
        <tr>
            <td><strong>${c.centre_name}</strong></td>
            <td>${c.location}</td>
            <td>${c.labs_count}</td>
            <td>${c.systems_count}</td>
            <td><span class="badge badge-ready">${c.status}</span></td>
        </tr>
    `).join('');
}

async function loadDeploymentsList() {
    const deployments = await api('/api/deployments');
    const tbody = document.getElementById('deploymentsTableBody');
    if (!deployments || deployments.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#94a3b8;">No staff deployments created.</td></tr>`;
        return;
    }
    tbody.innerHTML = deployments.map(d => `
        <tr>
            <td><strong>${d.staff_id}</strong></td>
            <td>${d.staff_name}</td>
            <td>${d.assigned_role}</td>
            <td>${d.exam_name}</td>
            <td>${d.centre_name} (${d.location})</td>
            <td>${d.duty_date}</td>
        </tr>
    `).join('');
}

async function openDeployModal() {
    const [exams, centres, staff] = await Promise.all([
        api('/api/exams'),
        api('/api/centres'),
        api('/api/staff')
    ]);

    const examSelect = document.getElementById('deployExamSelect');
    const centreSelect = document.getElementById('deployCentreSelect');
    const staffSelect = document.getElementById('deployStaffSelect');

    examSelect.innerHTML = exams.map(e => `<option value="${e.id}">${e.exam_name}</option>`).join('');
    centreSelect.innerHTML = centres.map(c => `<option value="${c.id}">${c.centre_name} (${c.location})</option>`).join('');
    staffSelect.innerHTML = staff.map(s => `<option value="${s.id}">${s.staff_id} - ${s.name} (${s.role})</option>`).join('');

    document.getElementById('deployDutyDate').value = new Date().toISOString().split('T')[0];
    openModal('deployStaffModal');
}

async function loadAttendanceSheets() {
    const sheets = await api('/api/admin/attendance-sheets');
    const tbody = document.getElementById('attendanceVerificationTableBody');
    if (!sheets || sheets.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#94a3b8;">No attendance sheets submitted yet.</td></tr>`;
        return;
    }
    tbody.innerHTML = sheets.map(s => `
        <tr>
            <td><strong>${s.staff_id}</strong></td>
            <td>${s.staff_name}</td>
            <td>${s.role}</td>
            <td>${s.punch_in_time || '--'}</td>
            <td>${s.punch_out_time || '--'}</td>
            <td>
                ${s.sheet_file ? `<a href="${s.sheet_file}" target="_blank" class="btn btn-outline" style="padding: 2px 8px; font-size:11px;">View Sheet</a>` : 'Not Uploaded'}
            </td>
            <td><span class="badge badge-${s.sheet_verification_status.toLowerCase()}">${s.sheet_verification_status}</span></td>
            <td>
                ${s.sheet_verification_status === 'Submitted' ? `
                    <button class="btn btn-success" style="padding: 3px 8px; font-size: 11px;" onclick="verifySheet(${s.id}, 'Approved')">Approve</button>
                    <button class="btn btn-danger" style="padding: 3px 8px; font-size: 11px;" onclick="verifySheet(${s.id}, 'Rejected')">Reject</button>
                ` : 'Verified'}
            </td>
        </tr>
    `).join('');
}

async function verifySheet(id, status) {
    await api('/api/admin/verify-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance_id: id, status })
    });
    loadAttendanceSheets();
}

async function loadPaymentsList() {
    const payments = await api('/api/admin/payments');
    const tbody = document.getElementById('paymentsTableBody');
    if (!payments || payments.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#94a3b8;">No payment line items yet.</td></tr>`;
        return;
    }
    tbody.innerHTML = payments.map(p => `
        <tr>
            <td><strong>${p.staff_id}</strong></td>
            <td>${p.staff_name}</td>
            <td>${p.role}</td>
            <td>${p.duty_date}</td>
            <td><strong>₹${p.total_payable.toLocaleString()}</strong></td>
            <td><span class="badge badge-${p.payment_status.toLowerCase()}">${p.payment_status}</span></td>
            <td>
                ${p.payment_status === 'Pending' ? `
                    <button class="btn btn-success" style="padding: 3px 8px; font-size: 11px;" onclick="updatePaymentStatus(${p.id}, 'Approved')">Approve</button>
                ` : p.payment_status === 'Approved' ? `
                    <button class="btn btn-primary" style="padding: 3px 8px; font-size: 11px;" onclick="updatePaymentStatus(${p.id}, 'Paid')">Mark Paid</button>
                ` : 'Completed'}
            </td>
        </tr>
    `).join('');
}

async function updatePaymentStatus(payment_id, status) {
    await api('/api/admin/update-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id, status })
    });
    loadPaymentsList();
}

// Modal Handlers
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// Registration Form Submission (With Direct Google Sheet Auto-Sync)
document.getElementById('addStaffForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const payload = Object.fromEntries(formData.entries());

    const res = await api('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (res && res.staff_id) {
        alert(`Staff registered and synced to Google Sheet!\nAssigned Staff ID: ${res.staff_id}\nPassword: ${payload.ef_dob}`);
        closeModal('addStaffModal');
        e.target.reset();
        loadStaffList();
    }
});

document.getElementById('addExamForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const res = await api('/api/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (res && res.id) {
        alert('Examination created');
        closeModal('addExamModal');
        e.target.reset();
        loadExamsList();
    }
});

document.getElementById('addCentreForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const res = await api('/api/centres', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (res && res.id) {
        alert('Centre venue added');
        closeModal('addCentreModal');
        e.target.reset();
        loadCentresList();
    }
});

document.getElementById('deployStaffForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const res = await api('/api/deployments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (res && res.id) {
        alert('Staff deployment saved');
        closeModal('deployStaffModal');
        loadDeploymentsList();
    }
});

// Staff Operations
async function loadStaffAssignment() {
    const duty = await api('/api/staff/my-assignment');
    USER_ASSIGNMENT = duty;
    const container = document.getElementById('dutyDetailsContainer');

    if (!duty) {
        container.innerHTML = `<div class="card" style="padding: 24px; text-align:center; color:#94a3b8;">No examination duty assigned to you for today.</div>`;
        return;
    }

    container.innerHTML = `
        <div class="card" style="padding: 24px;">
            <h2 style="font-size: 18px; color: #0f2a59; margin-bottom: 8px;">${duty.exam_name}</h2>
            <p style="color: #64748b; font-size: 13px; margin-bottom: 16px;">Venue: <strong>${duty.centre_name} (${duty.location})</strong> | Shift: <strong>${duty.shift}</strong></p>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 16px;">
                <div><label>Assigned Role</label><p><strong>${duty.assigned_role}</strong></p></div>
                <div><label>Reporting Time</label><p><strong>${duty.reporting_time}</strong></p></div>
                <div><label>Duty Honorarium</label><p><strong>₹${(duty.duty_amount + duty.travel_allowance + duty.other_allowance).toLocaleString()}</strong></p></div>
            </div>
            <div style="background: #f8fafc; padding: 12px; border: 1px solid #e2e8f0; border-radius: 4px;">
                <span>Punch In: <strong>${duty.punch_in_time || '--:--'}</strong></span> | 
                <span>Punch Out: <strong>${duty.punch_out_time || '--:--'}</strong></span>
            </div>
        </div>
    `;
}

// Live Camera
async function startCamera() {
    try {
        const video = document.getElementById('webcam');
        if (!video) return;
        videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
        video.srcObject = videoStream;
    } catch (e) {
        console.warn('Camera inaccessible');
    }
}

async function executePunch(type) {
    if (!USER_ASSIGNMENT) {
        alert('No active assignment for today');
        return;
    }

    const video = document.getElementById('webcam');
    const canvas = document.getElementById('snapshotCanvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, 640, 480);
    const photoBase64 = canvas.toDataURL('image/jpeg');

    const endpoint = type === 'in' ? '/api/attendance/punch-in' : '/api/attendance/punch-out';
    const res = await api(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            deployment_id: USER_ASSIGNMENT.deployment_id,
            photo_base64: photoBase64
        })
    });

    const msg = document.getElementById('punchMessage');
    if (res && !res.error) {
        msg.style.color = '#16a34a';
        msg.innerText = `${type === 'in' ? 'Punch In' : 'Punch Out'} registered successfully!`;
        loadStaffAssignment();
    } else {
        msg.style.color = '#dc2626';
        msg.innerText = res.error || 'Failed to record attendance';
    }
}

function showSelectedFileName(input) {
    const notice = document.getElementById('selectedFileNotice');
    if (input.files && input.files[0]) {
        notice.innerText = `Selected: ${input.files[0].name}`;
    }
}

document.getElementById('sheetUploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!USER_ASSIGNMENT) {
        alert('No duty assignment found');
        return;
    }

    const fileInput = document.getElementById('sheetFileInput');
    if (!fileInput.files[0]) {
        alert('Please attach the attendance sheet first');
        return;
    }

    const formData = new FormData();
    formData.append('deployment_id', USER_ASSIGNMENT.deployment_id);
    formData.append('attendance_sheet', fileInput.files[0]);
    formData.append('is_late', 'false');

    const res = await fetch('/api/attendance/upload-sheet', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TOKEN}` },
        body: formData
    });
    const data = await res.json();

    if (res.ok) {
        alert('Attendance sheet submitted for Admin verification!');
        switchRoute('staff-duty');
    } else {
        alert(data.error || 'Upload error');
    }
});
