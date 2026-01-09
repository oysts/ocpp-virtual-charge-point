// WebSocket connection to VCP admin interface
let ws = null;
let isConnected = false;
let currentTransactionId = null;
let sessionStartTime = null;
let timerInterval = null;
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
        case 'initial_state':
            restoreState(message.data);
            break;
        case 'state_update':
            restoreState(message.data);
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

// Theme management
function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    updateThemeButton(newTheme);
}

function updateThemeButton(theme) {
    const icon = document.getElementById('themeIcon');
    const text = document.getElementById('themeText');
    
    if (theme === 'dark') {
        icon.textContent = '🌙';
        text.textContent = 'Dark';
    } else {
        icon.textContent = '☀️';
        text.textContent = 'Light';
    }
}

function initTheme() {
    // Check for saved theme preference, otherwise detect system preference
    let theme = localStorage.getItem('theme');
    
    if (!theme) {
        // Detect system preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        theme = prefersDark ? 'dark' : 'light';
    }
    
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeButton(theme);
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        // Only auto-switch if user hasn't manually set a preference
        if (!localStorage.getItem('theme')) {
            const newTheme = e.matches ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            updateThemeButton(newTheme);
        }
    });
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

// Restore state from backend
function restoreState(state) {
    console.log('Restoring state:', state);
    
    // Restore current status
    if (state.currentStatus) {
        updateCurrentStatus(state.currentStatus);
    }
    
    // Restore transaction ID
    currentTransactionId = state.activeTransactionId;
    updateActiveTransactionId(state.activeTransactionId);
    if (state.activeTransactionId) {
        document.getElementById('transactionId').value = state.activeTransactionId;
    }
    
    // Restore meter value
    updateMeterValue(state.meterValue || 0);
    
    // Restore last action
    if (state.lastAction) {
        document.getElementById('lastAction').textContent = state.lastAction;
    }
    
    // Restore session timer
    if (state.sessionStartTime) {
        sessionStartTime = new Date(state.sessionStartTime);
        startSessionTimer();
    } else {
        stopSessionTimer();
    }
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
        sessionStartTime = null;
        updateActiveTransactionId(null);
        updateMeterValue(0);
        stopSessionTimer();
    } else if (action === 'MeterValues' && direction === 'outgoing') {
        // Extract meter value from MeterValues message
        if (payload.meterValue && payload.meterValue.length > 0) {
            const sampledValue = payload.meterValue[0].sampledValue;
            if (sampledValue && sampledValue.length > 0) {
                const value = parseFloat(sampledValue[0].value) || 0;
                const unit = sampledValue[0].unit || sampledValue[0].unitOfMeasure?.unit || 'Wh';
                
                // Convert to Wh if needed
                const wh = unit === 'kWh' ? Math.round(value * 1000) : Math.round(value);
                updateMeterValue(wh);
            }
        }
    }
}

// Handle OCPP call results (responses)
function handleOcppCallResult(message) {
    const { action, payload, timestamp, messageId } = message.data;
    
    addLogMessage('incoming', `${action} Response`, payload, messageId);
    
    // Capture transaction ID from StartTransaction response
    if (action === 'StartTransaction' && payload.transactionId) {
        currentTransactionId = payload.transactionId;
        sessionStartTime = new Date();
        updateActiveTransactionId(payload.transactionId);
        document.getElementById('transactionId').value = payload.transactionId;
        addLogMessage('system', `Transaction started with ID: ${payload.transactionId}`);
        startSessionTimer();
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

function updateMeterValue(value) {
    const element = document.getElementById('meterValue');
    const wh = parseInt(value) || 0;
    const kwh = (wh / 1000).toFixed(2);
    element.textContent = wh >= 1000 ? `${kwh} kWh` : `${(wh / 1000).toFixed(2)} kWh`;
}

function startSessionTimer() {
    console.log('Starting session timer, sessionStartTime:', sessionStartTime);
    stopSessionTimer(); // Clear any existing timer
    updateSessionDuration();
    timerInterval = setInterval(updateSessionDuration, 1000);
}

function stopSessionTimer() {
    console.log('Stopping session timer');
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    document.getElementById('sessionDuration').textContent = '--:--:--';
}

function updateSessionDuration() {
    if (!sessionStartTime) {
        console.log('updateSessionDuration: no sessionStartTime');
        return;
    }
    
    const now = new Date();
    const diff = Math.floor((now - sessionStartTime) / 1000); // seconds
    
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;
    
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    document.getElementById('sessionDuration').textContent = timeStr;
    console.log('Session duration updated:', timeStr);
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
    initTheme();
    connectWebSocket();
    
    // Show connection URL in console
    console.log(`Connecting to VCP admin WebSocket: ${wsUrl}`);
    console.log('To use a different port, add ?port=XXXX to the URL');
});
