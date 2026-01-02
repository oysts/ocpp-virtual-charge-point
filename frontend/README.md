# Web Interface for OCPP Virtual Charge Point

This folder contains the web-based control panel for the OCPP VCP.

## Files

- **index.html** - Main UI with control panels for connector status, authorization, and transactions
- **app.js** - WebSocket client and UI logic
- **styles.css** - Styling and layout

## How It Works

The web interface connects directly to the VCP's admin WebSocket interface:

1. **HTTP Server**: The VCP (`src/vcp.ts`) includes a built-in HTTP server that serves these static files
2. **WebSocket Connection**: The browser connects to the same admin WebSocket port used by CLI tools
3. **Bidirectional Communication**: 
   - Browser → VCP: Send OCPP commands (StatusNotification, Authorize, StartTransaction, etc.)
   - VCP → Browser: Receive real-time updates of all OCPP messages

## Configuration

The web interface reads the WebSocket port from URL parameters or defaults to port 9999:

```
http://localhost:8080          # Uses default port 9999
http://localhost:8080?port=9998  # Uses custom port 9998
```

## Features

- 🔋 **Connector Status Control** - Change connector states with one click
- 🔐 **Authorization** - Send Authorize requests with custom RFID tags
- ⚡ **Transaction Management** - Start and stop charging transactions
- 📝 **Live Message Log** - See all OCPP communications in real-time
- 📊 **State Tracking** - Current status, active transactions, and connection info

## No Build Required

This is intentionally kept simple with vanilla JavaScript - no build process, no frameworks, no dependencies. Just open in a browser and it works.
