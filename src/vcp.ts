import WebSocket, { WebSocketServer } from "ws";
import util from "util";

import { logger } from "./logger";
import { call } from "./messageFactory";
import { OcppCall, OcppCallError, OcppCallResult } from "./ocppMessage";
import {
  OcppMessageHandler,
  resolveMessageHandler,
} from "./ocppMessageHandler";
import { ocppOutbox } from "./ocppOutbox";
import { OcppVersion, toProtocolVersion } from "./ocppVersion";
import {
  validateOcppRequest,
  validateOcppResponse,
} from "./jsonSchemaValidator";

interface VCPOptions {
  ocppVersion: OcppVersion;
  endpoint: string;
  chargePointId: string;
  basicAuthPassword?: string;
  adminWsPort?: number;
  adminHttpPort?: number;
}

export class VCP {
  private ws?: WebSocket;
  private adminWs?: WebSocketServer;
  private messageHandler: OcppMessageHandler;

  private isFinishing: boolean = false;

  constructor(private vcpOptions: VCPOptions) {
    this.messageHandler = resolveMessageHandler(vcpOptions.ocppVersion);
    if (vcpOptions.adminWsPort) {
      this.adminWs = new WebSocketServer({
        port: vcpOptions.adminWsPort,
      });
      this.adminWs.on("connection", (_ws) => {
        logger.info("Admin WebSocket client connected");
        // Send initial connection info
        this.broadcastToAdminClients({
          type: "connection_info",
          data: {
            chargePointId: vcpOptions.chargePointId,
            ocppVersion: vcpOptions.ocppVersion,
            endpoint: vcpOptions.endpoint,
            status: "connected"
          }
        });
        
        _ws.on("message", (data: string) => {
          this.send(JSON.parse(data));
        });
        
        _ws.on("close", () => {
          logger.info("Admin WebSocket client disconnected");
        });
      });
    }
    
    // Add HTTP server for frontend if adminHttpPort is specified
    if (vcpOptions.adminHttpPort) {
      const http = require("http");
      const fs = require("fs");
      const path = require("path");
      
      const httpServer = http.createServer((req: any, res: any) => {
        const frontendPath = path.join(__dirname, "..", "frontend");
        let filePath = path.join(frontendPath, req.url === "/" ? "index.html" : req.url);
        
        const extname = path.extname(filePath);
        const contentTypes: any = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
        };
        const contentType = contentTypes[extname] || "text/plain";
        
        fs.readFile(filePath, (err: any, content: any) => {
          if (err) {
            res.writeHead(404);
            res.end("File not found");
          } else {
            res.writeHead(200, { "Content-Type": contentType });
            res.end(content);
          }
        });
      });
      
      httpServer.listen(vcpOptions.adminHttpPort, () => {
        logger.info(`Frontend HTTP server running on http://localhost:${vcpOptions.adminHttpPort}`);
      });
    }
  }
  
  private broadcastToAdminClients(message: any) {
    if (!this.adminWs) return;
    
    const messageStr = JSON.stringify(message);
    this.adminWs.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }

  async connect(): Promise<void> {
    logger.info(`Connecting... | ${util.inspect(this.vcpOptions)}`);
    this.isFinishing = false;
    return new Promise((resolve) => {
      const websocketUrl =
        `${this.vcpOptions.endpoint}/${this.vcpOptions.chargePointId}`;
      const protocol = toProtocolVersion(this.vcpOptions.ocppVersion);
      this.ws = new WebSocket(websocketUrl, [protocol], {
        rejectUnauthorized: false,
        auth: this.vcpOptions.basicAuthPassword
          ? `${this.vcpOptions.chargePointId}:${this.vcpOptions.basicAuthPassword}`
          : undefined,
        followRedirects: true,
      });

      this.ws.on("open", () => resolve());
      this.ws.on("message", (message: string) => this._onMessage(message));
      this.ws.on("ping", () => {
        logger.info("Received PING");
      });
      this.ws.on("pong", () => {
        logger.info("Received PONG");
      });
      this.ws.on(
        "close",
        (code: number, reason: string) => this._onClose(code, reason),
      );
    });
  }

  send(ocppCall: OcppCall<any>) {
    if (!this.ws) {
      throw new Error("Websocket not initialized. Call connect() first");
    }
    ocppOutbox.enqueue(ocppCall);
    const jsonMessage = JSON.stringify([
      2,
      ocppCall.messageId,
      ocppCall.action,
      ocppCall.payload,
    ]);
    logger.info(`Sending message ➡️  ${jsonMessage}`);
    validateOcppRequest(
      this.vcpOptions.ocppVersion,
      ocppCall.action,
      JSON.parse(JSON.stringify(ocppCall.payload)),
    );
    this.ws.send(jsonMessage);
    
    // Broadcast to admin clients
    this.broadcastToAdminClients({
      type: "ocpp_message_sent",
      direction: "outgoing",
      data: {
        messageId: ocppCall.messageId,
        action: ocppCall.action,
        payload: ocppCall.payload,
        timestamp: new Date().toISOString()
      }
    });
  }

  respond(result: OcppCallResult<any>) {
    if (!this.ws) {
      throw new Error("Websocket not initialized. Call connect() first");
    }
    const jsonMessage = JSON.stringify([3, result.messageId, result.payload]);
    logger.info(`Responding with ➡️  ${jsonMessage}`);
    validateOcppResponse(
      this.vcpOptions.ocppVersion,
      result.action,
      JSON.parse(JSON.stringify(result.payload)),
    );
    this.ws.send(jsonMessage);
  }

  respondError(error: OcppCallError<any>) {
    if (!this.ws) {
      throw new Error("Websocket not initialized. Call connect() first");
    }
    const jsonMessage = JSON.stringify([
      4,
      error.messageId,
      error.errorCode,
      error.errorDescription,
      error.errorDetails,
    ]);
    logger.info(`Responding with ➡️  ${jsonMessage}`);
    this.ws.send(jsonMessage);
  }

  configureHeartbeat(interval: number) {
    setInterval(() => {
      this.send(call("Heartbeat"));
    }, interval);
  }

  close() {
    if (!this.ws) {
      throw new Error(
        "Trying to close a Websocket that was not opened. Call connect() first",
      );
    }
    this.isFinishing = true;
    this.ws.close();
    this.adminWs?.close();
    delete this.ws;
    delete this.adminWs;
    process.exit(1);
  }

  private _onMessage(message: string) {
    logger.info(`Receive message ⬅️  ${message}`);
    const data = JSON.parse(message);
    const [type, ...rest] = data;
    
    if (type === 2) {
      const [messageId, action, payload] = rest;
      // Broadcast incoming call
      this.broadcastToAdminClients({
        type: "ocpp_message_received",
        direction: "incoming",
        data: {
          messageId,
          action,
          payload,
          timestamp: new Date().toISOString()
        }
      });
      validateOcppRequest(this.vcpOptions.ocppVersion, action, payload);
      this.messageHandler.handleCall(this, { messageId, action, payload });
    } else if (type === 3) {
      const [messageId, payload] = rest;
      const enqueuedCall = ocppOutbox.get(messageId);
      if (!enqueuedCall) {
        throw new Error(
          `Received CallResult for unknown messageId=${messageId}`,
        );
      }
      // Broadcast call result
      this.broadcastToAdminClients({
        type: "ocpp_call_result",
        direction: "incoming",
        data: {
          messageId,
          action: enqueuedCall.action,
          payload,
          timestamp: new Date().toISOString()
        }
      });
      validateOcppResponse(
        this.vcpOptions.ocppVersion,
        enqueuedCall.action,
        payload,
      );
      this.messageHandler.handleCallResult(this, enqueuedCall, {
        messageId,
        payload,
        action: enqueuedCall.action,
      });
    } else if (type === 4) {
      const [messageId, errorCode, errorDescription, errorDetails] = rest;
      this.messageHandler.handleCallError(this, {
        messageId,
        errorCode,
        errorDescription,
        errorDetails,
      });
    } else {
      throw new Error(`Unrecognized message type ${type}`);
    }
  }

  private _onClose(code: number, reason: string) {
    if (this.isFinishing) {
      return;
    }
    logger.info(`Connection closed. code=${code}, reason=${reason}`);
    process.exit();
  }
}
