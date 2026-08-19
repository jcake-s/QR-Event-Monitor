let guests = [];
let authToken = sessionStorage.getItem('staffToken') || null;

const successSound = new Audio('success.mp3');
const errorSound = new Audio('error.mp3');
successSound.preload = 'auto';
errorSound.preload = 'auto';

const GUEST_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

let isOnline = true;

function setConnectionStatus(connected) {
    const el = document.getElementById('connection-status');
    const wasOnline = isOnline;
    isOnline = connected;

    if (el) {
        el.textContent = connected ? 'Connected' : 'Connection lost';
        el.className = connected ? 'connection-badge connection-ok' : 'connection-badge connection-down';
    }

    if (connected && !wasOnline) {
        loadGuest();
    }
}

async function checkConnection() {
    try {
        const response = await fetch('/api/ping');
        setConnectionStatus(response.ok);
    } catch (err) {
        setConnectionStatus(false);
    }
}
 
function startConnectionMonitor() {
    checkConnection();
    setInterval(checkConnection, 5000);
}
 
async function apiRequest(url, options = {}) {
    const headers = Object.assign({}, options.headers);
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
 
    let response;
    try {
        response = await fetch(url, { ...options, headers });
    } catch (networkErr) {
        setConnectionStatus(false);
        throw new Error('Could not reach the server. Check your connection.');
    }
 
    setConnectionStatus(true);
 
    let data = null;
    const text = await response.text();
    if (text) {
        try { data = JSON.parse(text); } catch (parseErr) { /* non-JSON body */ }
    }
 
    if (response.status === 401) {
        setAuthenticated(false);
    }
 
    if (!response.ok) {
        const message = (data && data.error) ? data.error : `Request failed (${response.status})`;
        throw new Error(message);
    }
 
    return data;
}
 
async function loadGuests() {
    try {
        guests = await apiRequest('/api/guests');
        renderGuestTable();
    } catch (err) {
        console.error('Failed to load guests:', err.message);
    }
}

function setAuthenticated(isAuthenticated) {
    if (isAuthenticated) {
        document.body.classList.add('staff-authenticated');
    } else {
        document.body.classList.remove('staff-authenticated');
        authToken = null;
        sessionStorage.removeItem('staffToken');
    }
 
    const loginBtn = document.getElementById('staff-login-btn');
    if (loginBtn) {
        loginBtn.textContent = isAuthenticated ? 'Staff Logout' : 'Staff Login';
    }
 
    renderGuestTable();
}
 
async function login(pin) {
    const errorEl = document.getElementById('login-error');
    if (errorEl) errorEl.textContent = '';
 
    try {
        const result = await apiRequest('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
        });
        authToken = result.token;
        sessionStorage.setItem('staffToken', authToken);
        setAuthenticated(true);
        await loadGuests();
        return true;
    } catch (err) {
        if (errorEl) errorEl.textContent = err.message;
        return false;
    }
}
 
async function logout() {
    try {
        await apiRequest('/api/logout', { method: 'POST' });
    } catch (err) {
    
    }
    setAuthenticated(false);
}
 
function openLoginModal() {
    const overlay = document.getElementById('login-overlay');
    const pinInput = document.getElementById('pin-input');
    const errorEl = document.getElementById('login-error');
    if (errorEl) errorEl.textContent = '';
    if (pinInput) pinInput.value = '';
    overlay.classList.remove('hidden');
    pinInput.focus();
}
 
function closeLoginModal() {
    document.getElementById('login-overlay').classList.add('hidden');
}

async function addGuest(name, customId) {
    const errorEl = document.getElementById('add-guest-error');
    const trimmedName = name.trim();
 
    if (errorEl) errorEl.textContent = '';
 
    if (!trimmedName) {
        if (errorEl) errorEl.textContent = 'Guest name is required.';
        return false;
    }
 
    const trimmedId = customId ? customId.trim() : '';
    if (trimmedId && !GUEST_ID_PATTERN.test(trimmedId)) {
        if (errorEl) errorEl.textContent = 'Guest ID can only contain letters, numbers, hyphens, and underscores.';
        return false;
    }
 
    try {
        await apiRequest('/api/guests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: trimmedName, id: trimmedId })
        });
        await loadGuests();
        return true;
    } catch (err) {
        if (errorEl) errorEl.textContent = err.message;
        return false;
    }
}
 
async function deleteGuest(guestId) {
    const guest = guests.find(g => g.id === guestId);
    if (!guest) return;
 
    if (!confirm(`Remove ${guest.name} (${guest.id}) from the guest directory? This cannot be undone.`)) {
        return;
    }
 
    try {
        await apiRequest(`/api/guests/${encodeURIComponent(guestId)}`, { method: 'DELETE' });
        await loadGuests();
    } catch (err) {
        alert(`Could not remove guest: ${err.message}`);
    }
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
 
    while (i < text.length) {
        const char = text[i];
 
        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                inQuotes = false; i++; continue;
            }
            field += char; i++; continue;
        }
 
        if (char === '"') { inQuotes = true; i++; continue; }
        if (char === ',') { row.push(field); field = ''; i++; continue; }
        if (char === '\r') { i++; continue; }
        if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
        field += char; i++;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
 
    return rows;
}
 
function csvRowsToGuestObjects(rows) {
    if (rows.length === 0) return [];
    const header = rows[0].map(h => h.trim().toLowerCase());
    const nameIdx = header.indexOf('name');
    const idIdx = header.indexOf('id');
 
    if (nameIdx === -1) {
        throw new Error('CSV must have a "name" column header.');
    }
 
    const guestsToImport = [];
    for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        if (cols.length === 1 && cols[0].trim() === '') continue;
        guestsToImport.push({
            name: (cols[nameIdx] || '').trim(),
            id: idIdx !== -1 ? (cols[idIdx] || '').trim() : ''
        });
    }
    return guestsToImport;
}
 
async function importGuestsFromCsv(file) {
    let text;
    try {
        text = await file.text();
    } catch (err) {
        alert('Could not read the file.');
        return;
    }
 
    let guestsToImport;
    try {
        guestsToImport = csvRowsToGuestObjects(parseCsv(text));
    } catch (err) {
        alert(err.message);
        return;
    }
 
    if (guestsToImport.length === 0) {
        alert('No guest rows found in that file.');
        return;
    }
 
    let result;
    try {
        result = await apiRequest('/api/guests/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guests: guestsToImport })
        });
    } catch (err) {
        alert(`Import failed: ${err.message}`);
        return;
    }
 
    await loadGuests();
 
    let summary = `Imported ${result.added} guest${result.added === 1 ? '' : 's'}.`;
    if (result.skipped.length > 0) {
        const shown = result.skipped.slice(0, 10)
            .map(s => `Row ${s.row}: ${s.reason}`)
            .join('\n');
        const more = result.skipped.length > 10 ? `\n...and ${result.skipped.length - 10} more` : '';
        summary += `\n\nSkipped ${result.skipped.length}:\n${shown}${more}`;
    }
    alert(summary);
}
 
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
 
function renderGuestTable() {
    const tableBody = document.getElementById('guest-table-body');
    if (!tableBody) return;
 
    tableBody.innerHTML = '';
 
    const total = guests.length;
    const inside = guests.filter(g => g.status === 'Inside').length;
    const outside = total - inside;
 
    document.getElementById('total-guests').textContent = total;
    document.getElementById('inside-count').textContent = inside;
    document.getElementById('outside-count').textContent = outside;
 
    const isStaff = document.body.classList.contains('staff-authenticated');

    if (!isStaff) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="locked-table-message"> Log in as staff to view the guest directory.</td>
            <tr>
        `;
        return;
    }
 
    guests.forEach(guest => {
        const row = document.createElement('tr');
 
        let statusClass = 'status-absent';
        if (guest.status === 'Inside') statusClass = 'status-inside';
        if (guest.status === 'Checked Out') statusClass = 'status-checkedout';
 
        row.innerHTML = `
            <td><strong>${escapeHtml(guest.id)}</strong></td>
            <td>${escapeHtml(guest.name)}</td>
            <td><span class="status-pill ${statusClass}">${escapeHtml(guest.status)}</span></td>
            <td>${escapeHtml(guest.lastAction)}</td>
            <td>
                <button class="override-btn" data-id="${escapeHtml(guest.id)}">
                    Toggle
                </button>
            </td>
            <td>
                ${isStaff ? `<button class="qr-btn" data-id="${escapeHtml(guest.id)}"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg> QR</button>` : '<span class="locked-hint">staff only</span>'}
            </td>
            <td>
                ${isStaff ? `<button class="remove-btn" data-id="${escapeHtml(guest.id)}"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg> Remove</button>` : '<span class="locked-hint">staff only</span>'}
            </td>
        `;
        tableBody.appendChild(row);
    });
 
    setupOverrideButtons();
    setupQrButtons();
    setupRemoveButtons();
}
 
function setupOverrideButtons() {
    document.querySelectorAll('.override-btn').forEach(button => {
        button.onclick = function() {
            toggleGuestStatusManual(this.getAttribute('data-id'));
        };
    });
}
 
function setupQrButtons() {
    document.querySelectorAll('.qr-btn').forEach(button => {
        button.onclick = function() {
            openQrModal(this.getAttribute('data-id'));
        };
    });
}
 
function setupRemoveButtons() {
    document.querySelectorAll('.remove-btn').forEach(button => {
        button.onclick = function() {
            deleteGuest(this.getAttribute('data-id'));
        };
    });
}
 
async function toggleGuestStatusManual(guestId) {
    try {
        const updated = await apiRequest(`/api/guests/${encodeURIComponent(guestId)}/toggle`, {
            method: 'POST'
        });
 
        successSound.currentTime = 0;
        successSound.play().catch(err => console.log("Audio play deferred:", err));
 
        await loadGuests();
    } catch (err) {
        alert(`Could not update guest: ${err.message}`);
    }
}
 
function qrImageUrl(data, size) {
    const px = size || 220;
    return `https://api.qrserver.com/v1/create-qr-code/?size=${px}x${px}&data=${encodeURIComponent(data)}`;
}
 
function openQrModal(guestId) {
    const guest = guests.find(g => g.id === guestId);
    if (!guest) return;
 
    const overlay = document.getElementById('qr-overlay');
    const label = document.getElementById('qr-guest-label');
    const image = document.getElementById('qr-image');
 
    label.textContent = `${guest.name} — ${guest.id}`;
    image.src = qrImageUrl(guest.id, 220);
    image.dataset.guestId = guest.id;
    image.dataset.guestName = guest.name;
 
    overlay.classList.remove('hidden');
}
 
function closeQrModal() {
    document.getElementById('qr-overlay').classList.add('hidden');
}
 
function printSingleQr() {
    const image = document.getElementById('qr-image');
    const guestId = image.dataset.guestId || '';
    const guestName = image.dataset.guestName || '';
    openPrintWindow([{ id: guestId, name: guestName }]);
}
 
function openPrintWindow(guestList) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Your browser blocked the print window. Please allow pop-ups for this site and try again.');
        return;
    }
 
    const cards = guestList.map(g => `
        <div class="qr-print-card">
            <img src="${qrImageUrl(g.id, 200)}" width="200" height="200" alt="QR code for ${escapeHtml(g.id)}">
            <div class="qr-print-name">${escapeHtml(g.name)}</div>
            <div class="qr-print-id">${escapeHtml(g.id)}</div>
        </div>
    `).join('');
 
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Guest QR Codes</title>
            <style>
                body { font-family: sans-serif; margin: 20px; }
                .qr-print-grid { display: flex; flex-wrap: wrap; gap: 24px; }
                .qr-print-card {
                    text-align: center; padding: 12px;
                    border: 1px solid #ccc; border-radius: 8px;
                    width: 220px; page-break-inside: avoid;
                }
                .qr-print-name { font-weight: bold; margin-top: 8px; }
                .qr-print-id { font-family: monospace; color: #555; font-size: 0.85em; }
            </style>
        </head>
        <body>
            <div class="qr-print-grid">${cards}</div>
            <script>
                let loaded = 0;
                const imgs = document.querySelectorAll('img');
                if (imgs.length === 0) { window.print(); }
                imgs.forEach(img => {
                    img.addEventListener('load', () => { loaded++; if (loaded === imgs.length) window.print(); });
                    img.addEventListener('error', () => { loaded++; if (loaded === imgs.length) window.print(); });
                });
            <\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
}
 
function printAllQrCodes() {
    if (guests.length === 0) {
        alert('No guests to print.');
        return;
    }
    openPrintWindow(guests.map(g => ({ id: g.id, name: g.name })));
}
 

function csvSafeField(value) {
    let str = String(value);
    if (/^[=+\-@]/.test(str)) {
        str = '\t' + str;
    }
    return `"${str.replace(/"/g, '""')}"`;
}
 
function exportToCSV() {
    if (!document.body.classList.contains('staff-authenticated')) {
        alert('Staff login required to export.');
        return;
    }
 
    let csvContent = "data:text/csv;charset=utf-8,Guest ID,Full Name,Current Status,Last Activity\n";
 
    guests.forEach(guest => {
        let row = [guest.id, guest.name, guest.status, guest.lastAction]
            .map(csvSafeField)
            .join(',');
        csvContent += row + "\n";
    });
 
    const encodedUri = encodeURI(csvContent);
    const downloadLink = document.createElement("a");
    downloadLink.setAttribute("href", encodedUri);
    downloadLink.setAttribute("download", `event_attendance_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}
 
async function resetEventSession() {
    if (!document.body.classList.contains('staff-authenticated')) {
        alert('Staff login required to reset the session.');
        return;
    }
 
    if (!confirm("Are you absolutely sure you want to reset the current session? This will wipe out all tracking timestamps.")) {
        return;
    }
 
    try {
        await apiRequest('/api/reset', { method: 'POST' });
        await loadGuests();
    } catch (err) {
        alert(`Could not reset session: ${err.message}`);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    setAuthenticated(!!authToken);
    startConnectionMonitor();
    loadGuests();
 
    document.getElementById("export-csv-btn").addEventListener("click", exportToCSV);
    document.getElementById("reset-session-btn").addEventListener("click", resetEventSession);
    document.getElementById("print-all-qr-btn").addEventListener("click", printAllQrCodes);
 
    const importInput = document.getElementById("import-csv-input");
    importInput.addEventListener("change", async () => {
        const file = importInput.files[0];
        if (!file) return;
        await importGuestsFromCsv(file);
        importInput.value = '';
    });
 
    document.getElementById("qr-print-btn").addEventListener("click", printSingleQr);
    document.getElementById("qr-close-btn").addEventListener("click", closeQrModal);
 
    const addGuestForm = document.getElementById("add-guest-form");
    addGuestForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById("new-guest-name");
        const idInput = document.getElementById("new-guest-id");
        const submitBtn = addGuestForm.querySelector('button[type="submit"]');
 
        submitBtn.disabled = true;
        const added = await addGuest(nameInput.value, idInput.value);
        submitBtn.disabled = false;
 
        if (added) {
            nameInput.value = '';
            idInput.value = '';
            nameInput.focus();
        }
    });
 
    const loginBtn = document.getElementById('staff-login-btn');
    const loginForm = document.getElementById('login-form');
    const cancelBtn = document.getElementById('login-cancel-btn');
 
    loginBtn.addEventListener('click', () => {
        if (document.body.classList.contains('staff-authenticated')) {
            logout();
        } else {
            openLoginModal();
        }
    });
 
    cancelBtn.addEventListener('click', closeLoginModal);
 
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pinInput = document.getElementById('pin-input');
        const success = await login(pinInput.value);
        if (success) closeLoginModal();
    });
});
 