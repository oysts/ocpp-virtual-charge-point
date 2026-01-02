// WebSocket connection to VCP admin interface
let ws = null;
let isConnected = false;
let currentTransactionId = null;
let messageCount = 0;

// Configuration - read from URL or map HTTP port to WebSocket port
const params = new URLSearchParams(window.location.search);
const httpPort = window.location.port || '8080';

// Map HTTP ports to WebSocket ports (or use URL param)
const portMapping = {
    '8080': '9999',  // .env.test
    '8081': '9998',  // .env.emabler.test
};

const wsPort = params.get('port') || portMapping[httpPort] || '9999';
const wsUrl = `ws://localhost:${wsPort}`;

// Initialize WebSocket connection
function connectWebSocket() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        isConnected = true;
        updateConnectionStatus(true);
        addLogMessage('system', 'Connected to VCP admin interface');
    };

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleIncomingMessage(message);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        addLogMessage('error', 'WebSocket error occurred');
    };

    ws.onclose = () => {
        isConnected = false;
        updateConnectionStatus(false);
        addLogMessage('system', 'Disconnected from VCP. Reconnecting in 3s...');
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
    };
}

// Handle incoming messages from VCP
function handleIncomingMessage(message) {
    switch (message.type) {
        case 'connection_info':
            updateConnectionInfo(message.data);
            break;
        case 'ocpp_message_sent':
            handleOcppMessage(message, 'outgoing');
            break;
        case 'ocpp_message_received':
            handleOcppMessage(message, 'incoming');
            break;
        case 'ocpp_call_result':
            handleOcppCallResult(message);
            break;
        default:
            console.log('Unknown message type:', message.type);
    }
}

// Toggle connection info expansion
function toggleConnectionInfo() {
    const container = document.getElementById('cpIdContainer');
    const expanded = document.getElementById('connectionInfoExpanded');
    container.classList.toggle('expanded');
    expanded.classList.toggle('show');
}

// Update connection info panel
function updateConnectionInfo(data) {
    document.getElementById('chargePointId').textContent = data.chargePointId || '-';
    document.getElementById('ocppVersion').textContent = data.ocppVersion || '-';
    document.getElementById('endpoint').textContent = data.endpoint || '-';
    document.getElementById('connectionStatus').textContent = data.status || '-';
}

// Handle OCPP messages
function handleOcppMessage(message, direction) {
    const { action, payload, timestamp, messageId } = message.data;
    
    // Update last action
    document.getElementById('lastAction').textContent = `${action} (${direction})`;
    
    // Log the message
    addLogMessage(direction, action, payload, messageId);
    
    // Track specific actions
    if (action === 'StatusNotification' && direction === 'outgoing') {
        updateCurrentStatus(payload.status);
    } else if (action === 'StartTransaction' && direction === 'outgoing') {
        // Transaction started - wait for response with transaction ID
        addLogMessage('system', 'Transaction start requested...');
    } else if (action === 'StopTransaction' && direction === 'outgoing') {
        currentTransactionId = null;
        updateActiveTransactionId(null);
    }
}

// Handle OCPP call results (responses)
function handleOcppCallResult(message) {
    const { action, payload, timestamp, messageId } = message.data;
    
    addLogMessage('incoming', `${action} Response`, payload, messageId);
    
    // Capture transaction ID from StartTransaction response
    if (action === 'StartTransaction' && payload.transactionId) {
        currentTransactionId = payload.transactionId;
        updateActiveTransactionId(payload.transactionId);
        document.getElementById('transactionId').value = payload.transactionId;
        addLogMessage('system', `Transaction started with ID: ${payload.transactionId}`);
    }
}

// Update UI elements
function updateConnectionStatus(connected) {
    const indicator = document.getElementById('wsStatus');
    const statusText = document.getElementById('statusText');
    
    if (connected) {
        indicator.className = 'status-indicator status-connected';
        statusText.textContent = 'Connected';
    } else {
        indicator.className = 'status-indicator status-disconnected';
        statusText.textContent = 'Disconnected';
    }
}

function updateCurrentStatus(status) {
    const element = document.getElementById('currentStatus');
    element.textContent = status;
    element.className = `badge badge-${status.toLowerCase()}`;
}

function updateActiveTransactionId(txId) {
    const element = document.getElementById('activeTransactionId');
    element.textContent = txId || 'None';
    element.className = txId ? 'badge badge-success' : 'badge badge-info';
}

// Send commands to VCP
function sendCommand(action, payload) {
    if (!isConnected) {
        alert('Not connected to VCP admin interface!');
        return;
    }

    const message = {
        action: action,
        messageId: generateUUID(),
        payload: payload
    };

    ws.send(JSON.stringify(message));
}

// Command functions
function setStatus(status) {
    const connectorId = parseInt(document.getElementById('connectorId').value);
    sendCommand('StatusNotification', {
        connectorId: connectorId,
        errorCode: 'NoError',
        status: status
    });
}

function authorize() {
    const idTag = document.getElementById('idTag').value;
    if (!idTag) {
        alert('Please enter an RFID tag');
        return;
    }
    sendCommand('Authorize', {
        idTag: idTag
    });
}

function startTransaction() {
    const connectorId = parseInt(document.getElementById('txConnectorId').value);
    const idTag = document.getElementById('txIdTag').value;
    
    if (!idTag) {
        alert('Please enter an RFID tag');
        return;
    }
    
    sendCommand('StartTransaction', {
        connectorId: connectorId,
        idTag: idTag,
        meterStart: 0,
        timestamp: new Date().toISOString()
    });
}

function stopTransaction() {
    const transactionId = parseInt(document.getElementById('transactionId').value);
    
    if (!transactionId) {
        alert('Please enter a transaction ID');
        return;
    }
    
    sendCommand('StopTransaction', {
        transactionId: transactionId,
        timestamp: new Date().toISOString(),
        meterStop: Math.floor(Math.random() * 10000) // Random meter value for demo
    });
}

// Logging functions
function addLogMessage(type, action, payload = null, messageId = null) {
    const logContainer = document.getElementById('messageLog');
    const empty = logContainer.querySelector('.log-empty');
    if (empty) empty.remove();
    
    messageCount++;
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    const arrow = type === 'outgoing' ? '➡️' : type === 'incoming' ? '⬅️' : 'ℹ️';
    
    let content = `<div class="log-header">
        <span class="log-time">${timestamp}</span>
        <span class="log-arrow">${arrow}</span>
        <span class="log-action">${action}</span>
    </div>`;
    
    if (payload) {
        content += `<div class="log-payload">${JSON.stringify(payload, null, 2)}</div>`;
    }
    
    if (messageId) {
        content += `<div class="log-id">ID: ${messageId}</div>`;
    }
    
    entry.innerHTML = content;
    
    // Make entry clickable to expand/collapse payload
    if (payload) {
        entry.addEventListener('click', () => {
            entry.classList.toggle('expanded');
        });
    }
    
    // Insert at the top instead of bottom (newest first)
    if (logContainer.firstChild) {
        logContainer.insertBefore(entry, logContainer.firstChild);
    } else {
        logContainer.appendChild(entry);
    }
    
    // Limit log entries to 100
    const entries = logContainer.querySelectorAll('.log-entry');
    if (entries.length > 100) {
        entries[entries.length - 1].remove();
    }
}

function clearLog() {
    const logContainer = document.getElementById('messageLog');
    logContainer.innerHTML = '<div class="log-empty">Log cleared</div>';
    messageCount = 0;
}

// Utility functions
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
    
    // Show connection URL in console
    console.log(`Connecting to VCP admin WebSocket: ${wsUrl}`);
    console.log('To use a different port, add ?port=XXXX to the URL');
});
