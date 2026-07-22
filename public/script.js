let guests = [];
let authToken = sessionStorage.getItem('staffToken') || null;

let lastScanCode = null;
let lastScanTime = 0;
const SCAN_COOLDOWN_MS = 3000;

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
        loadGuests();
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
        headers['Authorization'] =`Bearer ${authToken}`;
    }

    let response;
    try {
        response = await fetch(url, { ...options, headers});
    } catch (networkErr) {
        setConnectionStatus(false);
        const offlineError = new Error('Could not reach the server. Check your connection.');
        offlineError.isNetworkError = true;
        throw offlineError;
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
        loginBtn.textContent = isAuthenticated ? '🔓 Staff Logout' : '🔒 Staff Login';
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
                    🔄 Toggle
                </button>
            </td>
            <td>
                ${isStaff ? `<button class="remove-btn" data-id="${escapeHtml(guest.id)}">✕ Remove</button>` : '<span class="locked-hint">🔒 staff only</span>'}
            </td>
        `;
        tableBody.appendChild(row);
    });

    setupOverrideButtons();
    setupRemoveButtons();
}

function setupOverrideButtons() {
    document.querySelectorAll('.override-btn').forEach(button => {
        button.onclick = function() {
            toggleGuestStatusManual(this.getAttribute('data-id'));
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

        updateActivityLog(updated, updated.action);
        await loadGuests();
    } catch (err) {
        alert(`Could not update guest: ${err.message}`);
    }
}

function updateActivityLog(guest, action) {
    const card = document.getElementById('status-card');
    const nameDisplay = document.getElementById('log-guest-name');
    const idDisplay = document.getElementById('log-guest-id');
    const badge = document.getElementById('log-badge');
    const timeDisplay = document.getElementById('log-time');

    if (!card || !nameDisplay || !idDisplay || !badge || !timeDisplay) return;

    const timeStamp = new Date().toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    if (action === 'ENTRY') {
        card.className = 'card-entry';
        badge.textContent = '✅ Checked In';
    } else {
        card.className = 'card-exit';
        badge.textContent = '❌ Checked Out';
    }

    nameDisplay.textContent = guest.name;
    idDisplay.textContent = `ID: ${guest.id}`;
    timeDisplay.textContent = `Timestamp: ${timeStamp}`;
}

function handleInvalidScan(scannedText) {
    const card = document.getElementById('status-card');
    const nameDisplay = document.getElementById('log-guest-name');
    const idDisplay = document.getElementById('log-guest-id');
    const badge = document.getElementById('log-badge');
    const timeDisplay = document.getElementById('log-time');

    if (typeof errorSound !== 'undefined') {
        errorSound.currentTime = 0;
        errorSound.play().catch(err => console.log("Audio play deferred:", err));
    }

    if (card) card.className = 'card-exit';
    if (nameDisplay) nameDisplay.textContent = "Unknown QR Code";
    if (idDisplay) idDisplay.textContent = `Data Read: "${scannedText}"`;
    if (badge) badge.textContent = "⚠️ ACCESS DENIED";
    if (timeDisplay) timeDisplay.textContent = `Timestamp: ${new Date().toLocaleTimeString()}`;
}

function handleOfflineScan(scannedText) {
    const card =  document.getElementById('status-card');
    const nameDisplay = document.getElementById('log-guest-name');
    const idDisplay = document.getElementById('log-guest-id');
    const badge = document.getElementById('log-badge');
    const timeDisplay = document.getElementById('log-time');

    if (typeof errorSound !== 'undefined') {
        errorSound.currentTime = 0;
        errorSound.play().catch(err => console.log("Audio play deferred:", err));
    }

    if (card) card.className = 'card-offline';
    if (nameDisplay) nameDisplay.textContent = "Connection Lost";
    if (idDisplay) idDisplay.textContent = `Scan not recorded - please try again once reconnected.`;
    if (badge) badge.textContent = "📡 OFFlINE";
    if (timeDisplay) timeDisplay.textContent = `Timestamp: ${new Date().toLocaleTimeString()}`;
}

async function onScanSuccess(decodedText) {
    const code = decodedText.trim();
    const now = Date.now();

    if (code === lastScanCode && (now - lastScanTime) < SCAN_COOLDOWN_MS) {
        return;
    }
    lastScanCode = code;
    lastScanTime = now;

    try {
        const updated = await apiRequest('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });

        successSound.currentTime = 0;
        successSound.play().catch(err => console.log("Audio play blocked by browser:", err));

        updateActivityLog(updated, updated.action);
        await loadGuests();
    } catch (err) {
        if (err.isNetworkError) {
            handleOfflineScan(decodedText);
        } else {
            handleInvalidScan(decodedText);
        }
        
    }
}

function onScanFailure(error) {
}

document.addEventListener("DOMContentLoaded", () => {
    setAuthenticated(!!authToken);

    startConnectionMonitor();
    loadGuests();

    const html5QrcodeScanner = new Html5QrcodeScanner("reader", {
        fps: 10,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const qrboxSize = Math.floor(minEdge * 0.7);
            return { width: qrboxSize, height: qrboxSize };
        }
    });
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);

    document.getElementById("export-csv-btn").addEventListener("click", exportToCSV);
    document.getElementById("reset-session-btn").addEventListener("click", resetEventSession);

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
        return;
    }

    const card = document.getElementById('status-card');
    const nameDisplay = document.getElementById('log-guest-name');
    const idDisplay = document.getElementById('log-guest-id');
    const badge = document.getElementById('log-badge');
    const timeDisplay = document.getElementById('log-time');

    if (card) card.className = 'card-neutral';
    if (nameDisplay) nameDisplay.textContent = "No Scan Detected";
    if (idDisplay) idDisplay.textContent = "Scan a guest QR code to begin tracking.";
    if (badge) badge.textContent = "Awaiting Scan";
    if (timeDisplay) timeDisplay.textContent = "";
}