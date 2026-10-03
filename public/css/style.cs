:root {
    --navy: #0b1f3a;
    --blue: #133b68;
    --accent: #2563eb;
    --border: #e2e8f0;
    --bg: #f8fafc;
    --surface: #ffffff;
    --text: #0f172a;
    --muted: #64748b;
    --green: #16a34a;
    --red: #dc2626;
    --sidebar-w: 260px;
}

* { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
body { background-color: var(--bg); color: var(--text); font-size: 13.5px; line-height: 1.5; }

.portal-header {
    background: #ffffff; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between;
    border-bottom: 2px solid var(--navy); box-shadow: 0 1px 3px rgba(0,0,0,0.05); position: sticky; top: 0; z-index: 100;
}
.portal-title h1 { font-size: 17.5px; font-weight: 800; color: var(--navy); letter-spacing: 0.5px; }
.portal-title p { font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; }

.toast-popup {
    position: fixed; top: 20px; right: 20px; background: #0f172a; color: #fff; padding: 12px 20px;
    border-radius: 6px; box-shadow: 0 10px 25px rgba(0,0,0,0.25); z-index: 99999; display: none;
    align-items: center; gap: 10px; font-weight: 600; font-size: 13px; border-left: 4px solid #22c55e;
}

.auth-wrapper { min-height: 85vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.auth-card { background: #fff; width: 100%; max-width: 440px; border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border-top: 4px solid var(--navy); padding: 26px; }
.auth-header h2 { font-size: 18px; font-weight: 800; color: var(--navy); margin-bottom: 4px; }
.auth-header p { font-size: 11.5px; color: var(--muted); margin-bottom: 16px; }

.app-container { display: flex; min-height: calc(100vh - 65px); }
.sidebar { width: var(--sidebar-w); background: var(--navy); color: #fff; display: flex; flex-direction: column; flex-shrink: 0; }
.sidebar-user { padding: 16px; background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.08); }
.sidebar-nav { flex: 1; overflow-y: auto; padding: 10px 0; }
.nav-category { font-size: 10px; text-transform: uppercase; color: #94a3b8; padding: 12px 18px 4px; font-weight: 700; letter-spacing: 0.6px; }
.nav-link { display: flex; align-items: center; padding: 9px 18px; color: #cbd5e1; text-decoration: none; cursor: pointer; gap: 10px; font-size: 12.5px; border-left: 3px solid transparent; }
.nav-link:hover, .nav-link.active { background: rgba(255,255,255,0.08); color: #fff; border-left-color: #38bdf8; }

.main-content { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.content-area { padding: 20px; flex: 1; overflow-y: auto; }

.charts-grid { display: grid; grid-template-columns: 1fr 1.6fr; gap: 16px; margin-bottom: 20px; }
.chart-box { background: #fff; border: 1px solid var(--border); border-radius: 6px; padding: 16px; height: 300px; }

.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px; }
.stat-card { background: #fff; border: 1px solid var(--border); border-radius: 6px; padding: 14px; cursor: pointer; transition: transform 0.15s ease; }
.stat-card:hover { transform: translateY(-2px); border-color: var(--accent); }
.stat-label { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; display: flex; justify-content: space-between; }
.stat-value { font-size: 22px; font-weight: 800; margin-top: 4px; color: var(--navy); }

.card { background: #fff; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 20px; }
.card-header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: #fafafa; }
.table-responsive { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 9px 12px; border-bottom: 1px solid var(--border); text-align: left; }
th { background: #f8fafc; font-size: 11px; color: #334155; text-transform: uppercase; font-weight: 700; }

.badge { padding: 3px 8px; border-radius: 4px; font-size: 10.5px; font-weight: 700; display: inline-block; }
.badge-present, .badge-active, .badge-ready, .badge-paid { background: #dcfce7; color: var(--green); }
.badge-absent, .badge-rejected { background: #fee2e2; color: var(--red); }
.badge-pending { background: #fef3c7; color: #b45309; }

.btn { padding: 7px 12px; border-radius: 4px; font-weight: 600; font-size: 12px; cursor: pointer; border: none; display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
.btn-sm { padding: 4px 8px; font-size: 11px; border-radius: 3px; }
.btn-primary { background: var(--accent); color: #fff; }
.btn-success { background: var(--green); color: #fff; }
.btn-danger { background: var(--red); color: #fff; }
.btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }

.form-group { margin-bottom: 12px; }
label { display: block; font-size: 11px; font-weight: 700; margin-bottom: 4px; color: #334155; text-transform: uppercase; }
input, select, textarea { width: 100%; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12.5px; }

.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(11, 31, 58, 0.65); display: none; align-items: center; justify-content: center; z-index: 9999; padding: 14px; }
.modal-content { background: #fff; border-radius: 6px; max-width: 840px; width: 100%; max-height: 90vh; overflow-y: auto; }
.modal-header { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
.modal-body { padding: 18px; }
.modal-footer { padding: 12px 18px; background: #f8fafc; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }

.shift-timing-box { background: #f8fafc; border: 1px solid var(--border); padding: 10px; border-radius: 4px; margin-bottom: 8px; }
.role-form-card { background: #f8fafc; border: 1px solid var(--border); border-radius: 4px; padding: 16px; margin-top: 14px; }

.printable-pass { border: 2px solid var(--navy); padding: 24px; background: #fff; position: relative; }
.printable-pass h3 { font-size: 15px; color: var(--navy); text-align: center; border-bottom: 2px solid var(--navy); padding-bottom: 8px; margin-bottom: 14px; }
.pass-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; margin-bottom: 14px; }

@media print {
    body * { visibility: hidden; }
    #dutyPassModal, #dutyPassModal * { visibility: visible; }
    #dutyPassModal { position: absolute; left: 0; top: 0; width: 100%; background: transparent !important; }
    .modal-content { box-shadow: none; border: none; max-width: 100%; }
    .modal-footer, .modal-header button { display: none !important; }
}
