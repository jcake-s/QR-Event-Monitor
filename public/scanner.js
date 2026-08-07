let lastScanCode = null;
let lastScanTime = 0;
let SCAN_COOLDOWN_MS = 3000;

const successSound = new Audio('success.mp3');
const errorSound = new Audio('error.mp3');

successSound.preload = 'auto';
errorSound.preload = 'auto';

let isOnline = true;

function setConnectionStatus(connected) {
    const el = document.getElementById('connection-status');
    isOnline = connected;

    if (el) {
        el.textContent = connected ? 'Connected' : 'Connection Lost';
        el.className = connected ? 'connection-badge connection-ok' : 'connection-badge connection-down';
    }
}

async function checkConnection() {
    try {
        const response = await fetch('/api/ping');
        setConnectionStatus(response.ok);
    } catch (error) {
        setConnectionStatus(false);
    }
}

function startConnectionMonitor() {
    checkConnection();
    setInterval(checkConnection, 5000);
}

async function apiRequest(url, options = {}) {
    let response;
    try {
        response = await fetch(url, options);
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
        try { data = JSON.parse(text); } catch (parseErr) { }
    }

    if (!response.ok) {
        const message = (data && data.error) ? data.error : `Request failed (${response.status})`;
        throw new Error(message);
    }

    return data;
}

function updateActivityLog(guest, action) {
    const card = document.getElementById('status-card');
    const nameDisplay = document.getElementById('log-guest-name');
    const idDisplay = document.getElementById('log-guest-id');
    const badge = document.getElementById('log-badge');
    const timeDisplay = document.getElementById('log-time');

    if (!card || !nameDisplay || !idDisplay || !badge || !timeDisplay) return;

    const timeStamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (action === 'ENTRY') {
        card.className = 'card-entry';
        badge.textContent = 'Checked In';
    } else {
        card.className = 'card-exit';
        badge.textContent = 'Checked Out';
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
        errorSound.play().catch(errr => console.log("Audio play deferred:", err));
    }

    if (card) card.className = 'card-exit';
    if (nameDisplay) nameDisplay.textContent = "Unknown QR Code";
    if (idDisplay) idDisplay.textContent = `Data Read: "${scannedText}"`;
    if (badge) badge.textContent = 'ACCESS DENIED';
    if (timeDisplay) timeDisplay.textContent = `Timestamp: ${new Date().toLocaleTimeString()}`;
}

function handleOfflineScan(scannedText) {
    const card = document.getElementById('status-card');
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
    if (badge) badge.textContent = "OFFLINE";
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
        const updated  = await apiRequest('/api/scan', {
            method: 'POST',
            headers: { 'Content-type': 'application/json' },
            body: JSON.stringify({ code })
        });

        successSound.currentTime = 0;
        successSound.play().catch(err => console.log("Audio play blocked by browser:", err));

        updateActivityLog(updated, updated.action);
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

document.addEventListener('DOMContentLoaded', () => {
    startConnectionMonitor();

    const html5QrcodeScanner = new Html5QrcodeScanner("reader", {
        fps: 10,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const qrboxSize = Math.floor(minEdge * 0.7);
            return { width: qrboxSize, height: qrboxSize};
        }
    });
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
});