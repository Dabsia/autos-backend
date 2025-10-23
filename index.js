import express from "express";
import { connectToDatabase } from "./db.js";
import authRoutes from "./routes.js";
import morgan from "morgan";
import dotenv from "dotenv";
import cors from "cors";
import mongoose from "mongoose";

const app = express();

// Load environment variables
dotenv.config();

// Debug environment variables
console.log("🔍 Environment Variables Check:");
console.log("   PORT:", process.env.PORT);
console.log(
  "   DB_CONNECTION_STRING:",
  process.env.DB_CONNECTION_STRING ? "✅ Present" : "❌ MISSING"
);
console.log(
  "   MONGODB_CONNECTION_STRING:",
  process.env.MONGODB_CONNECTION_STRING ? "✅ Present" : "❌ MISSING"
);

const PORT = process.env.PORT || 3000;

// Configure mongoose (remove deprecated options)
mongoose.set("bufferCommands", false);

// Middleware
app.use(express.json());
app.use(morgan("dev"));
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Routes
app.use("/api/v1/", authRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  const dbState = mongoose.connection.readyState;
  const states = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  res.json({
    status: dbState === 1 ? "healthy" : "unhealthy",
    database: states[dbState],
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Simple test endpoint
app.get("/test", (req, res) => {
  res.json({
    message: "Server is running!",
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

// Start server
const startServer = async () => {
  try {
    console.log("🚀 Starting server...");

    // Check for connection string (support both names)
    const connectionString =
      process.env.DB_CONNECTION_STRING || process.env.MONGODB_CONNECTION_STRING;

    if (!connectionString) {
      console.error("❌ Database connection string is missing!");
      console.log("💡 Please add DB_CONNECTION_STRING to your .env file");
      console.log(
        "💡 Example: DB_CONNECTION_STRING=mongodb+srv://username:password@cluster.mongodb.net/database"
      );
      process.exit(1);
    }

    console.log("📡 Found connection string, connecting to database...");
    await connectToDatabase();

    console.log("✅ Database connected, starting HTTP server...");
    app.listen(PORT, () => {
      console.log(`🎉 Server running on port ${PORT}`);
      console.log(`📍 Health check: http://localhost:${PORT}/health`);
      console.log(`📍 Test endpoint: http://localhost:${PORT}/test`);
      console.log(`📍 API base: http://localhost:${PORT}/api/v1/`);
    });
  } catch (error) {
    console.error("💥 Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
