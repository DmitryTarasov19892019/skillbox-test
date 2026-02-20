const { db } = require("./database");

let isShuttingDown = false;

const getUserFromSession = async (sessionId) => {
  if (!sessionId || isShuttingDown) {
    return null;
  }

  try {
    const session = await db.findSession(sessionId);

    if (!session) {
      return null;
    }

    const newExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
    await db.updateSessionExpiry(sessionId, newExpiresAt);

    return {
      id: session.userId,
      username: session.username,
    };
  } catch (error) {
    if (!isShuttingDown && !error.message.includes("pool after calling end")) {
      console.error("Error getting user from session:", error.message);
    }
    return null;
  }
};

const loadUserFromSession = async (req, res, next) => {
  const sessionId = req.cookies.sessionId;

  try {
    const user = await getUserFromSession(sessionId);
    if (user) {
      res.locals.user = {
        id: user.id,
        username: user.username,
      };
      req.user = user;
      console.log(`User loaded: ${user.username}`);
    } else {
      res.locals.user = null;
    }
  } catch (error) {
    console.error("Error loading user:", error);
    res.locals.user = null;
  }

  next();
};

const requireAuthForAPI = async (req, res, next) => {
  const sessionId = req.cookies.sessionId;

  try {
    const user = await getUserFromSession(sessionId);

    if (!user) {
      return res.status(401).json({
        error: "Authentication required",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

const setShuttingDown = (value) => {
  isShuttingDown = value;
};

module.exports = {
  getUserFromSession,
  loadUserFromSession,
  requireAuthForAPI,
  setShuttingDown,
};
