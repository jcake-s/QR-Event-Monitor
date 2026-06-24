let guests = JSON.parse(localStorage.getItem('eventGuests')) || [
    { id: "GUEST-001", name: "Davy Jones", status: "Absent", lastAction: "N/A"},
    { id: "GUEST-002", name: "Margarett Diaz", status: "Absent", lastAction: "N/A"},
    { id: "GUEST-003", name: "Cercii Gonzales", status: "Absent", lastAction: "N/A"},
    { id: "GUEST-004", name: "Paris Hilton", status: "Absent", lastAction: "N/A"}
];

function saveToLocalStorage() {
    localStorage.setItem('eventGuests', JSON.stringify(guests));
}

function renderGuestTable() {
    const tableBody = document.getElementById('guest-table-body');
    tableBody.innerHTML = '';
    
    guests.forEach(guest => {
        const row = document.createElement('tr');

        let statusClass = 'status-absent';
        if (guest.status === 'Inside') statusClass = 'status-inside';
        if (guest.status === 'Checked Out') statusClass = 'status-checkedout';

        row.innerHTML = `
            <td><strong>${guest.id}</strong></td>
            <td>${guest.name}</td>
            <td><span class="status-pill ${statusClass}">${guest.status}</span></td>
            <td>${guest.lastAction}</td>
            `;
        tableBody.appendChild(row);
    });
}

function updateActivityLog(guest, actionType) {
    const card = document.getElementById('status-card');
    const nameDisplay = document.getElementById('log-guest-name');
    const idDisplay = document.getElementById('log-guest-id');
    const badge = document.getElementById('log-badge');
    const timeDisplay = document.getElementById('log-time');

    const currentTime = new Date().toLocaleTimeString();


    card.className = '';

    if (actionType === 'ENTRY') {
        card.classList.add('card-entry');
        badge.textContent = '📥 ENTRY ALLOWED';
    } else {
        card.classList.add('card-exit');
        badge.textContent = '📤 EXIT RECORDED';
    }

    nameDisplay.textContent = guest.name;
    idDisplay.textContent = `ID: ${guest.id} | System Match Confirmed`;
    timeDisplay.textContent = `Timestamp: ${currentTime}`;
}

function handleInvalidScan(scannedText) {
    const card = document.getElementById('status-card');
    const nameDisplay = document.getElementById('log-guest-name');
    const idDisplay = document.getElementById('log-guest-id');
    const badge = document.getElementById('log-badge');
    const timeDisplay = document.getElementById('log-time');

    card.className = 'card-exit';
    nameDisplay.textContent = "Unknown QR Code";
    idDisplay.textContent = `Data Read: "${scannedText}"`;
    badge.textContent = "⚠️ ACCESS DENIED";
    timeDisplay.textContent = `Timestamp: ${new Date().toLocaleTimeString()}`;
}

function onScanSuccess(decodedText, decodedResult) {
    const guest = guests.find(g => g.id === decodedText.trim());
    const timestamp = new Date().toLocaleTimeString();

    if (guest) {
        let action = '';
        if (guest.status === 'Absent' || guest.status === 'Checked Out') {
            guest.status = 'Inside';
            action = 'ENTRY';
        } else if (guest.status === 'Inside') {
            guest.status = 'Checked Out';
            action = 'EXIT';
        }

        guest.lastAction = `${action} at ${timestamp}`;

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
    const html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: {width: 250, height: 250}}, false);

    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
});