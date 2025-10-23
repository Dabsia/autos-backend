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

// Configure mongoose
mongoose.set("bufferCommands", false);

// **IMPROVED CORS CONFIGURATION**
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // List of allowed origins
    const allowedOrigins = [
      "http://localhost:5173",
      "http://localhost:3000",
      "https://autos-backend-2h3h.onrender.com",
      "auto-spa-club.vercel.app",
      // Add your production frontend URL here when deployed
    ];

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  optionsSuccessStatus: 200,
};

// Apply CORS middleware BEFORE routes
app.use(cors(corsOptions));

// Handle preflight requests
app.options("*", cors(corsOptions));

// Middleware
app.use(express.json());
app.use(morgan("dev"));

// Routes
app.use("/api/v1/", authRoutes);
// Simple test endpoint

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "AutoSpare Backend API",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
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
      console.log(
        `🌐 CORS enabled for: http://localhost:5173, https://autos-backend-2h3h.onrender.com`
      );
    });
  } catch (error) {
    console.error("💥 Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
