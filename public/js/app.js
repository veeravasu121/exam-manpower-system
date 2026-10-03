let CURRENT_USER = null;
let TOKEN = localStorage.getItem('EMMS_TOKEN') || null;
let USER_ASSIGNMENT = null;
let currentLoginType = 'STAFF';
let rawDeployments = [];
let videoStream = null;
let donutChartInstance = null;
let barChartInstance = null;
let currentInspectingAttendanceId = null;
let cachedSheets = [];
let cachedStaff = [];
let cachedPayments = [];
let fullReportsCache = [];

const ALL_ROLES = [
    'Invigilator', 'Registration Staff', 'Support Staff', 'Lab Supervisor',
    'Security', 'CCTV Operator', 'Jammer Operator', 'Technical Staff',
    'Centre Head', 'Exam Coordinator'
];

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('agencyClock').innerText = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    generateDynamicShiftInputs(3, 'shiftTimingContainer');
    if (TOKEN) {
        try {
            CURRENT_USER = JSON.parse(localStorage.getItem('EMMS_USER'));
            initSession();
        } catch (e) { logout(); }
    } else {
        document.getElementById('authView').style.display = 'flex';
        document.getElementById('appShell').style.display = 'none';
    }
});

function showToast(message, isSuccess = true) {
    const toast = document.getElementById('toastPopup');
    document.getElementById('toastText').innerText = message;
    document.getElementById('toastIcon').innerText = isSuccess ? '✓' : '⚠';
    toast.style.borderLeftColor = isSuccess ? '#22c55e' : '#ef4444';
    toast.style.display = 'flex';
    setTimeout(() => { toast.style.display = 'none'; }, 3200);
}

function setLoginType(type) {
    currentLoginType = type;
    const tabStaff = document.getElementById('tabStaff');
    const tabAdmin = document.getElementById('tabAdmin');
    const lblId = document.getElementById('lblIdentifier');
    const lblPass = document.getElementById('lblPassword');
    const inpId = document.getElementById('loginIdentifier');
    const inpPass = document.getElementById('loginPassword');
    const signUpPrompt = document.getElementById('staffSignUpPrompt');
    const cardTitle = document.getElementById('authCardTitle');
    const cardSub = document.getElementById('authCardSub');

    if (type === 'STAFF') {
        tabStaff.className = 'btn btn-primary'; tabAdmin.className = 'btn btn-outline';
        lblId.innerText = 'Staff ID'; inpId.placeholder = 'e.g. CCTRI001';
        lblPass.innerText = 'Password / Date of Birth'; inpPass.placeholder = 'DDMMYYYY or YYYY-MM-DD';
        signUpPrompt.style.display = 'block';
        cardTitle.innerText = 'Staff Portal Sign In';
        cardSub.innerText = 'Examination Personnel Active Session Access';
    } else {
        tabAdmin.className = 'btn btn-primary'; tabStaff.className = 'btn btn-outline';
        lblId.innerText = 'Admin Email Address'; inpId.placeholder = 'shankaranv161@gmail.com';
        lblPass.innerText = 'Admin Password'; inpPass.placeholder = '••••••••';
        signUpPrompt.style.display = 'none';
        cardTitle.innerText = 'Central Admin Desk';
        cardSub.innerText = 'Authorized Examination Control & Treasury Access';
    }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = document.getElementById('loginIdentifier').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const alertBox = document.getElementById('loginAlert');

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password, expected_type: currentLoginType })
        });
        const data = await res.json();
        if (!res.ok) {
            alertBox.innerText = data.error || 'Authentication failure.';
            alertBox.style.display = 'block';
            return;
        }
        TOKEN = data.token; CURRENT_USER = data.user;
        localStorage.setItem('EMMS_TOKEN', TOKEN);
        localStorage.setItem('EMMS_USER', JSON.stringify(CURRENT_USER));
        initSession();
    } catch (err) {
        alertBox.innerText = 'Connection error.'; alertBox.style.display = 'block';
    }
});

function initSession() {
    document.getElementById('authView').style.display = 'none';
    document.getElementById('appShell').style.display = 'flex';
    document.getElementById('sessionUserDisplay').innerText = CURRENT_USER.name || 'User';
    document.getElementById('sessionRoleBadge').innerText = (CURRENT_USER.role || 'STAFF').toUpperCase();

    if (CURRENT_USER.user_type === 'ADMIN') {
        document.getElementById('adminNav').style.display = 'block';
        document.getElementById('staffNav').style.display = 'none';
        switchRoute('admin-dashboard');
    } else {
        document.getElementById('adminNav').style.display = 'none';
        document.getElementById('staffNav').style.display = 'block';
        switchRoute('staff-duty');
        loadStaffPortalData();
        startCamera();
    }
}

function logout() {
    localStorage.removeItem('EMMS_TOKEN');
    localStorage.removeItem('EMMS_USER');
    TOKEN = null; CURRENT_USER = null;
    if (videoStream) { videoStream.getTracks().forEach(t => t.stop()); }
    location.reload();
}

function switchRoute(route) {
    document.querySelectorAll('.page-view').forEach(v => v.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const target = document.getElementById(`view-${route}`);
    if (target) target.style.display = 'block';

    if (route === 'admin-dashboard') loadDashboardData();
    else if (route === 'admin-analytics') renderAnalyticsHub();
    else if (route === 'admin-staff') loadStaffList();
    else if (route === 'admin-exams') loadExamsList();
    else if (route === 'admin-centres') loadCentresList();
    else if (route === 'admin-deployments') loadDeploymentsList();
    else if (route === 'admin-attendance') loadAttendanceSheets();
    else if (route === 'admin-payments') loadPaymentsList();
    else if (route === 'admin-reports') loadReportsData();
    else if (route === 'staff-duty' || route === 'staff-history') loadStaffPortalData();
}

async function api(url, options = {}) {
    options.headers = options.headers || {};
    options.headers['Authorization'] = `Bearer ${TOKEN}`;
    const res = await fetch(url, options);
    if (res.status === 401 || res.status === 403) { logout(); return null; }
    return await res.json();
}

function generateDynamicShiftInputs(count, containerId) {
    const container = document.getElementById(containerId);
    let html = '';
    for (let i = 1; i <= count; i++) {
        html += `
            <div class="shift-timing-box">
                <strong style="color:var(--navy); font-size:12px;">Shift ${i} Timing Configuration</strong>
                <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; margin-top:4px;">
                    <div class="form-group"><label>Candidate Reporting</label><input type="time" name="s${i}_reporting" value="${i === 1 ? '07:30' : i === 2 ? '11:30' : '15:00'}"></div>
                    <div class="form-group"><label>Exam Start</label><input type="time" name="s${i}_start" value="${i === 1 ? '09:00' : i === 2 ? '12:30' : '16:00'}"></div>
                    <div class="form-group"><label>Exam End</label><input type="time" name="s${i}_end" value="${i === 1 ? '11:00' : i === 2 ? '14:30' : '18:00'}"></div>
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
}

// 100% FREE NATIVE CELLULAR SMS DISPATCH & CLIPBOARD ROSTER
function triggerSmsDispatch(mobile, text) {
    const cleanPhone = (mobile || '').replace(/[^0-9]/g, '');
    const encoded = encodeURIComponent(text);
    window.location.href = `sms:${cleanPhone}?body=${encoded}`;
    showToast(`SMS dispatch opened for ${cleanPhone}!`);
}

function copyRosterToClipboard(text) {
    navigator.clipboard.writeText(text);
    showToast('✓ Credentials copied to clipboard!');
}

// DASHBOARD & INTERACTIVE ROLE MATRIX
async function loadDashboardData() {
    const data = await api('/api/admin/dashboard');
    if (!data) return;
    rawDeployments = data.allDeployments || [];
    document.getElementById('dashTotalStaff').innerText = data.totalStaffCount;
    document.getElementById('dashPendingApproval').innerText = data.pendingApprovalCount || 0;
    document.getElementById('dashPaymentPending').innerText = `₹${(data.totalPaymentPending || 0).toLocaleString()}`;

    const total = rawDeployments.length;
    const present = rawDeployments.filter(d => d.attendance_status === 'Present').length;
    const absent = rawDeployments.filter(d => d.attendance_status === 'Absent').length;
    const pendingOut = rawDeployments.filter(d => d.punch_in_time && !d.punch_out_time).length;

    document.getElementById('dashPresent').innerText = present;
    document.getElementById('dashAbsent').innerText = absent;
    document.getElementById('dashPunchOutPending').innerText = pendingOut;

    // Render Role Matrix
    const tbodyRole = document.getElementById('roleMatrixTableBody');
    tbodyRole.innerHTML = ALL_ROLES.map(role => {
        const roleList = rawDeployments.filter(d => (d.assigned_role || '').toLowerCase() === role.toLowerCase());
        const assigned = roleList.length;
        const pCount = roleList.filter(d => d.attendance_status === 'Present').length;
        const aCount = assigned - pCount;
        return `
            <tr style="cursor: pointer;" onclick="openDrilldownModal('ROLE', '${role}', '${role}')">
                <td><strong>${role}</strong></td>
                <td>${assigned}</td>
                <td style="color:var(--green); font-weight:700;">${pCount}</td>
                <td style="color:var(--red); font-weight:700;">${aCount}</td>
                <td style="color:${aCount > 0 ? '#ea580c' : 'var(--green)'}; font-weight:800;">${aCount}</td>
                <td><button class="btn btn-outline btn-sm">Inspect Role</button></td>
            </tr>
        `;
    }).join('');

    // Render Centre Matrix
    const tbodyCentre = document.getElementById('centreStatusTableBody');
    const uniqueCentres = [...new Set(rawDeployments.map(d => d.centre_name).filter(Boolean))];
    tbodyCentre.innerHTML = (uniqueCentres.length === 0) ? `<tr><td colspan="6" style="text-align:center; color:#94a3b8;">No venues active today.</td></tr>` : uniqueCentres.map(cName => {
        const cList = rawDeployments.filter(d => d.centre_name === cName);
        const assigned = cList.length;
        const pCount = cList.filter(d => d.attendance_status === 'Present').length;
        const deficit = assigned - pCount;
        return `<tr><td><strong>${cName}</strong></td><td>${cList[0]?.centre_city || 'N/A'}</td><td>${assigned}</td><td style="color:var(--green); font-weight:700;">${pCount}</td><td style="color:var(--red); font-weight:700;">${deficit}</td><td><span class="badge badge-${deficit > 0 ? 'absent' : 'present'}">${deficit > 0 ? 'Deficit' : 'Ready'}</span></td></tr>`;
    }).join('');
}

async function renderAnalyticsHub() {
    const data = await api('/api/admin/dashboard');
    if (!data) return;
    const deployments = data.allDeployments || [];
    const present = deployments.filter(d => d.attendance_status === 'Present').length;
    const absent = deployments.filter(d => d.attendance_status === 'Absent').length;
    const pendingOut = deployments.filter(d => d.punch_in_time && !d.punch_out_time).length;

    const ctxDonut = document.getElementById('chartAttendanceDonut').getContext('2d');
    if (donutChartInstance) donutChartInstance.destroy();
    donutChartInstance = new Chart(ctxDonut, {
        type: 'doughnut',
        data: {
            labels: ['Present', 'Absent / Deficit', 'On-Duty Active'],
            datasets: [{
                data: [present || 1, absent || 0, pendingOut || 0],
                backgroundColor: ['#16a34a', '#dc2626', '#d97706'],
                borderWidth: 2
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    const roleCounts = {};
    deployments.forEach(d => { roleCounts[d.assigned_role] = (roleCounts[d.assigned_role] || 0) + 1; });
    const ctxBar = document.getElementById('chartRoleBars').getContext('2d');
    if (barChartInstance) barChartInstance.destroy();
    barChartInstance = new Chart(ctxBar, {
        type: 'bar',
        data: {
            labels: Object.keys(roleCounts).length ? Object.keys(roleCounts) : ALL_ROLES.slice(0, 5),
            datasets: [{
                label: 'Staff Count',
                data: Object.values(roleCounts).length ? Object.values(roleCounts) : [0, 0, 0, 0, 0],
                backgroundColor: '#2563eb'
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
    });
}

function openDrilldownModal(type, title, filterValue) {
    document.getElementById('drilldownTitle').innerText = `Drilldown: ${title}`;
    let list = [];
    if (type === 'ALL') list = rawDeployments;
    else if (type === 'PRESENT') list = rawDeployments.filter(d => d.attendance_status === 'Present');
    else if (type === 'ABSENT') list = rawDeployments.filter(d => d.attendance_status === 'Absent');
    else if (type === 'PUNCHOUT_PENDING') list = rawDeployments.filter(d => d.punch_in_time && !d.punch_out_time);
    else if (type === 'ROLE') list = rawDeployments.filter(d => (d.assigned_role || '').toLowerCase() === filterValue.toLowerCase());

    const tbody = document.getElementById('drilldownTbody');
    tbody.innerHTML = (list.length === 0) ? `<tr><td colspan="9" style="text-align: center; color: #94a3b8;">No records located.</td></tr>` : list.map(s => `
        <tr>
            <td><strong>${s.staff_id}</strong></td>
            <td>${s.staff_name}</td>
            <td>${s.assigned_role}</td>
            <td>${s.centre_name}</td>
            <td>${s.exam_name}</td>
            <td>${s.shift}</td>
            <td>${s.punch_in_time || '--'}</td>
            <td>${s.punch_out_time || '--'}</td>
            <td><span class="badge badge-${s.attendance_status.toLowerCase()}">${s.attendance_status}</span></td>
        </tr>
    `).join('');
    openModal('drilldownModal');
}

// STAFF DIRECTORY & APPROVAL ACTIONS
async function loadStaffList() {
    cachedStaff = await api('/api/staff') || [];
    const tbody = document.getElementById('staffTableBody');
    tbody.innerHTML = (cachedStaff.length === 0) ? `<tr><td colspan="10" style="text-align:center; color:#94a3b8;">No staff records found.</td></tr>` : cachedStaff.map((s, idx) => {
        const isPending = s.status === 'Pending Approval';
        const statusBadge = isPending 
            ? `<span class="badge badge-pending">Pending Approval</span>`
            : `<span class="badge badge-active">${s.status}</span>`;

        const actionButtons = isPending ? `
            <button class="btn btn-success btn-sm" onclick="setStaffApproval(${s.id}, 'Active')">✓ Approve</button>
            <button class="btn btn-danger btn-sm" onclick="setStaffApproval(${s.id}, 'Rejected')">✕ Reject</button>
        ` : `<span style="color:var(--green); font-weight:700;">Approved</span>`;

        return `
            <tr>
                <td><strong>${s.staff_id}</strong></td>
                <td>${s.name}</td>
                <td>${s.role}</td>
                <td>${s.ef_city}</td>
                <td>${s.ef_mobile_number || 'N/A'}</td>
                <td>${statusBadge}</td>
                <td>${actionButtons}</td>
                <td><button class="btn btn-outline btn-sm" onclick="openEditStaff(${idx})">✏️ Edit</button></td>
                <td><button class="btn btn-outline btn-sm" onclick="openDutyPassModal('${s.staff_id}', '${s.name}', '${s.role}', '${s.ef_mobile_number}', 'General Deployment', 'All Shifts', '${s.ef_city} Exam Centre', 'Current Season')">🪪 Pass</button></td>
                <td>
                    <button class="btn btn-primary btn-sm" onclick="triggerSmsDispatch('${s.ef_mobile_number}', 'EXAM AGENCY: Hello ${s.name}, your Staff ID is ${s.staff_id} and Password (DOB) is ${s.ef_dob}.')">✉️ SMS</button>
                    <button class="btn btn-outline btn-sm" onclick="copyRosterToClipboard('ID: ${s.staff_id} | Pass: ${s.ef_dob}')">📋 Copy</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function setStaffApproval(dbId, newStatus) {
    const res = await api('/api/admin/verify-staff-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_db_id: dbId, new_status: newStatus })
    });
    if (res) {
        showToast(`Staff marked as ${newStatus}!`);
        loadStaffList();
        loadDashboardData();
    }
}

function openDutyPassModal(id, name, role, mobile, exam, shift, venue, period) {
    document.getElementById('passStaffId').innerText = id;
    document.getElementById('passStaffName').innerText = name;
    document.getElementById('passRole').innerText = role;
    document.getElementById('passMobile').innerText = mobile;
    document.getElementById('passExam').innerText = exam;
    document.getElementById('passShift').innerText = shift;
    document.getElementById('passVenue').innerText = venue;
    document.getElementById('passPeriod').innerText = period;
    openModal('dutyPassModal');
}

function openEditStaff(idx) {
    const s = cachedStaff[idx];
    if (!s) return;
    document.getElementById('editStaffId').value = s.id;
    document.getElementById('editStaffName').value = s.name || '';
    document.getElementById('editStaffMobile').value = s.ef_mobile_number || '';
    document.getElementById('editStaffRole').value = s.role || 'Invigilator';
    document.getElementById('editStaffVendor').value = s.vendor_name || 'Direct';
    document.getElementById('editStaffCity').value = s.ef_city || 'Chennai';
    document.getElementById('editStaffFather').value = s.ef_father_name || '';
    document.getElementById('editStaffMother').value = s.ef_mother_name || '';
    document.getElementById('editStaffQual').value = s.ef_qualification || '';
    document.getElementById('editStaffPresent').value = s.ef_present_address || '';
    document.getElementById('editStaffPermanent').value = s.ef_permanent_address || '';
    document.getElementById('editStaffStatus').value = s.status || 'Active';
    openModal('editStaffModal');
}

// EXAMINATIONS, CENTRES & DEPLOYMENTS
async function loadExamsList() {
    const exams = await api('/api/exams') || [];
    const tbody = document.getElementById('examsTableBody');
    tbody.innerHTML = (exams.length === 0) ? `<tr><td colspan="5" style="text-align:center; color:#94a3b8;">No exams scheduled.</td></tr>` : exams.map(e => `
        <tr>
            <td><strong>${e.exam_name}</strong></td>
            <td>${e.exam_conducting_agency}</td>
            <td>${e.date_from} to ${e.date_to}</td>
            <td><span class="badge badge-ready">${e.shift_mode}</span></td>
            <td><small>Custom Cutoffs Saved</small></td>
        </tr>
    `).join('');
}

async function loadCentresList() {
    const centres = await api('/api/centres') || [];
    const tbody = document.getElementById('centresTableBody');
    tbody.innerHTML = (centres.length === 0) ? `<tr><td colspan="4" style="text-align:center; color:#94a3b8;">No centres added.</td></tr>` : centres.map(c => `
        <tr>
            <td><strong>${c.centre_name}</strong></td>
            <td>${c.city}</td>
            <td>${c.full_address || 'N/A'}</td>
            <td>${c.map_location ? `<a href="${c.map_location}" target="_blank" style="color:var(--accent);">View Map</a>` : 'N/A'}</td>
        </tr>
    `).join('');
}

async function loadDeploymentsList() {
    const deps = await api('/api/deployments') || [];
    const tbody = docume
