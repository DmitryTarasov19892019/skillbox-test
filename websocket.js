const WebSocket = require("ws");
const cookie = require("cookie");
const { getUserFromSession } = require("./auth");
const { db } = require("./database");

class WebSocketManager {
  constructor(server) {
    this.wss = new WebSocket.Server({ server });
    this.clients = new Map();
    this.timerIntervals = new Map();
    this.setupWebSocket();
  }

  setupWebSocket() {
    this.wss.on("connection", async (ws, req) => {
      try {
        ws.isAuthenticated = false;

        const cookies = cookie.parse(req.headers.cookie || "");
        const sessionId = cookies.sessionId;

        if (!sessionId) {
          ws.send(JSON.stringify({ type: "auth_error", error: "No session provided" }));
          ws.close(1008, "No session provided");
          return;
        }

        const user = await getUserFromSession(sessionId);

        if (!user) {
          ws.send(JSON.stringify({ type: "auth_error", error: "Invalid session" }));
          ws.close(1008, "Invalid session");
          return;
        }

        ws.isAuthenticated = true;
        ws.userId = user.id;
        ws.username = user.username;
        ws.isAlive = true;

        if (!this.clients.has(user.id)) {
          this.clients.set(user.id, new Set());
          this.startTimerInterval(user.id);
        }
        this.clients.get(user.id).add(ws);

        ws.send(JSON.stringify({ type: "auth_success", message: "Authentication successful" }));

        await this.sendAllTimers(user.id);

        ws.on("message", (message) => this.handleMessage(ws, message));
        ws.on("pong", () => {
          ws.isAlive = true;
        });
        ws.on("close", () => this.handleDisconnect(ws));
        ws.on("error", (error) => console.error(`WebSocket error: ${error.message}`));
      } catch (error) {
        console.error("WebSocket connection error:", error);
        ws.send(JSON.stringify({ type: "auth_error", error: "Internal server error" }));
        ws.close(1011, "Internal server error");
      }
    });

    this.startPingInterval();
  }

  handleMessage(ws, message) {
    try {
      const data = JSON.parse(message);

      if (!ws.isAuthenticated) {
        ws.send(JSON.stringify({ type: "error", error: "Not authenticated" }));
        return;
      }

      switch (data.type) {
        case "ping":
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          break;
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
    }
  }

  handleDisconnect(ws) {
    if (ws.userId && this.clients.has(ws.userId)) {
      this.clients.get(ws.userId).delete(ws);

      if (this.clients.get(ws.userId).size === 0) {
        this.clients.delete(ws.userId);
        this.stopTimerInterval(ws.userId);
      }

      console.log(`WebSocket disconnected: ${ws.username || ws.userId}`);
    }
  }

  async sendAllTimers(userId) {
    try {
      const activeTimers = await db.getTimers(userId, "true");
      const stoppedTimers = await db.getTimers(userId, "false");
      const allTimers = [...activeTimers, ...stoppedTimers];

      if (this.clients.has(userId)) {
        const message = JSON.stringify({
          type: "all_timers",
          data: allTimers,
          timestamp: Date.now(),
        });

        this.clients.get(userId).forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      }
    } catch (error) {
      console.error(`Error sending all timers:`, error);
    }
  }

  async sendActiveTimers(userId) {
    try {
      const activeTimers = await db.getTimers(userId, "true");
      const now = Date.now();
      const timersWithProgress = activeTimers.map((timer) => ({
        ...timer,
        progress: now - timer.start,
        currentTime: now,
      }));

      if (this.clients.has(userId)) {
        const message = JSON.stringify({
          type: "active_timers",
          data: timersWithProgress,
          timestamp: now,
        });

        this.clients.get(userId).forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      }
    } catch (error) {
      console.error(`Error sending active timers:`, error);
    }
  }

  startTimerInterval(userId) {
    if (this.timerIntervals.has(userId)) return;
    const intervalId = setInterval(() => {
      this.sendActiveTimers(userId);
    }, 1000);
    this.timerIntervals.set(userId, intervalId);
  }

  stopTimerInterval(userId) {
    if (this.timerIntervals.has(userId)) {
      clearInterval(this.timerIntervals.get(userId));
      this.timerIntervals.delete(userId);
    }
  }

  startPingInterval() {
    setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          ws.terminate();
          return;
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  async notifyTimerCreated(userId) {
    await this.sendAllTimers(userId);
  }

  async notifyTimerStopped(userId) {
    await this.sendAllTimers(userId);
  }

  getStats() {
    return {
      totalConnections: this.wss.clients.size,
      uniqueUsers: this.clients.size,
      users: Array.from(this.clients.keys()),
    };
  }

  shutdown() {
    this.timerIntervals.forEach((intervalId) => clearInterval(intervalId));
    this.timerIntervals.clear();
    this.wss.close();
  }
}

module.exports = WebSocketManager;
