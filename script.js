let guests = JSON.parse(localStorage.getItem('eventGuests')) || [
    { id: "GUEST-001", name: "Davy Jones", status: "Absent", lastAction: "N/A"},
    { id: "GUEST-002", name: "Margarett Diaz", status: "Absent", lastAction: "N/A"},
    { id: "GUEST-003", name: "Cercii Gonzales", status: "Absent", lastAction: "N/A"},
    { id: "GUEST-004", name: "Paris Hilton", status: "Absent", lastAction: "N/A"}
];

const successSound = new Audio('success.mp3');
const errorSound = new Audio('error.mp3');

successSound.preload = 'auto';
errorSound.preload = 'auto';

function saveToLocalStorage() {
    localStorage.setItem('eventGuests', JSON.stringify(guests));
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function generateNextGuestId() {
    let maxNum = 0;
    guests.forEach(g => {
        const match = /^GUEST-(\d+)$/.exec(g.id);
        if (match) {
            maxNum = Math.max(maxNum, parseInt(match[1], 10));
        }
    });
    const next = maxNum + 1;
    return `GUEST-${String(next).padStart(3, '0')}`;
}

function addGuest(name, customId) {
    const errorE1 = document.getElementById('add-guest-error');
    const trimmedName = name.trim();

    if (errorE1) errorE1.textContent = '';

    if (!trimmedName) {
        if (errorE1) errorE1.textContent = 'Guest name is required.';
        return false;
    }

    let id = customId && customId.trim() ? customId.trim() : generateNextGuestId();

    if (guests.some(g => g.id.toLowerCase() === id.toLowerCase())) {
        if (errorE1) errorE1.textContent = `Guest ID "${id}" is already in use.`;
        return false;
    }

    guests.push({
        id: id,
        name: trimmedName,
        status: 'Absent',
        lastAction: 'N/A'
    });

    saveToLocalStorage();
    renderGuestTable();
    return true;
}

function deleteGuest(guestId) {
    const guest = guests.find(g => g.id === guestId);
    if (!guest) return;

    if (!confirm(`Remove ${guest.name} (${guest.id}) from the guest directory? This cannot be undone.`)) {
        return;
    }

    guests = guests.filter(g => g.id !== guestId);
    saveToLocalStorage();
    renderGuestTable();
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

    guests.forEach(guest => {
        const row = document.createElement('tr');

        let statusClass = 'status-absent';
        if (guest.status === 'Inside') statusClass = 'status-inside';
        if (guest.status === 'Checked Out') statusClass = 'status-checkedout';

        row.innerHTML = `
            <td><strong>${escapeHTML(guest.id)}</strong></td>
            <td>${escapeHTML(guest.name)}</td>
            <td><span class="status-pill ${statusClass}">${guest.status}</span></td>
            <td>${escapeHTML(guest.lastAction)}</td>
            <td>
                <button class="override-btn" data-id="${escapeHTML(guest.id)}">
                    🔄 Toggle
                </button>
            </td>
            <td>
                <button class="remove-btn" data-id="${escapeHTML(guest.id)}">
                    X Remove
                </button>
            </td>    
        `;
        tableBody.appendChild(row);
    });

    setupOverrideButtons();
    setupRemoveButtons();
}

function setupOverrideButtons() {
    const buttons = document.querySelectorAll('.override-btn');
    buttons.forEach(button => {
        button.onclick = function() {
            const guestId = this.getAttribute('data-id');
            toggleGuestStatusManual(guestId);
        };
    });
}

function setupRemoveButtons() {
    const buttons = document.querySelectorAll('.remove-btn');
    buttons.forEach(button => {
        button.onclick = function() {
            const guestId = this.getAttribute('data-id');
            deleteGuest(guestId);
        };
    });
}

function toggleGuestStatusManual(guestId) {
    const guest = guests.find(g => g.id === guestId);
    if (!guest) return;

    const timeStamp = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    let action = '';

    if (guest.status === 'Absent' || guest.status === 'Checked Out') {
        guest.status = 'Inside';
        action = 'ENTRY';
    } else if (guest.status === 'Inside') {
        guest.status = 'Checked Out';
        action = 'EXIT';
    }

    guest.lastAction = `MANUAL ${action} at ${timeStamp}`;

    if (typeof successSound !== 'undefined') {
        successSound.currentTime = 0;
        successSound.play().catch(err => console.log("Audio play deferred:", err));
    }

    saveToLocalStorage();
    updateActivityLog(guest, action);
    renderGuestTable();
}

function updateActivityLog(guest, action) {
    const card = document.getElementById('status-card');
    const nameDisplay = document.getElementById('log-guest-name');
    const idDisplay = document.getElementById('log-guest-id');
    const badge = document.getElementById('log-badge');
    const timeDisplay = document.getElementById('log-time');

    if (!card || !nameDisplay || !idDisplay || !badge || !timeDisplay) return;

    const timeStamp = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
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

function onScanSuccess(decodedText) {
    const guestId = decodedText.trim();
    const guest = guests.find(g => g.id === guestId);
    const timeStamp = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    if (guest) {
        let action = '';

        if (guest.status === 'Absent' || guest.status === 'Checked Out') {
            guest.status = 'Inside';
            action = 'ENTRY';
        } else if (guest.status === 'Inside') {
            guest.status = 'Checked Out';
            action = 'EXIT';
        }

        guest.lastAction = `${action} at ${timeStamp}`;

        successSound.currentTime = 0;
        successSound.play().catch(err => console.log("Audio play blocked by browser:", err));

        saveToLocalStorage();
        updateActivityLog(guest, action);
        renderGuestTable();
    } else {
        handleInvalidScan(decodedText);
    }
}

function onScanFailure(error) {
}

document.addEventListener("DOMContentLoaded", () => {
    renderGuestTable();

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
    addGuestForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const nameInput = document.getElementById("new-guest-name");
        const idInput = document.getElementById("new-guest-id");

        const added = addGuest(nameInput.value, idInput.value);
        if (added) {
            nameInput.value = '';
            idInput.value = '';
            nameInput.focus();
        }
    });
});

function exportToCSV() {
    let csvContent = "data:text/csv;charset=utf-8,Guest ID,Full Name,Current Status,Last Activity\n";

    guests.forEach(guest => {
        let row = `"${guest.id}","${guest.name}","${guest.status}","${guest.lastAction}"`;
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

function resetEventSession() {
    if (!confirm("Are you absolutely sure you want to reset the current session? This will wipe out all tracking timestamps.")) {
        return;
    }

    guests.forEach(guest => {
        guest.status = "Absent";
        guest.lastAction = "N/A";
    });

    saveToLocalStorage();
    renderGuestTable();

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
