import mongoose from "mongoose";

mongoose.set("bufferCommands", false);
// Remove the deprecated bufferTimeoutMS
// mongoose.set('bufferTimeoutMS', 30000);

let isConnected = false;

export const connectToDatabase = async () => {
  if (isConnected) {
    console.log("✅ Using existing database connection");
    return;
  }

  try {
    console.log("🔌 Connecting to MongoDB Atlas...");

    // Use the correct environment variable name
    const connectionString =
      process.env.MONGODB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;

    if (!connectionString) {
      throw new Error(
        "Database connection string is missing. Please set MONGODB_CONNECTION_STRING or DB_CONNECTION_STRING in your .env file"
      );
    }

    console.log("📡 Connection string found, establishing connection...");

    // Updated connection options (remove deprecated options)
    const connectionOptions = {
      serverSelectionTimeoutMS: 30000, // 30 seconds to select server
      socketTimeoutMS: 45000, // 45 seconds socket timeout
      maxPoolSize: 10, // Maximum connections in pool
      minPoolSize: 1, // Minimum connections in pool
      maxIdleTimeMS: 30000, // Close idle connections after 30s
      retryWrites: true,
      retryReads: true,
      // Remove bufferMaxEntries as it's deprecated
    };

    await mongoose.connect(connectionString, connectionOptions);

    isConnected = true;
    console.log(`✅ MongoDB Atlas connected successfully!`);
    console.log(`📍 Host: ${mongoose.connection.host}`);
    console.log(`📊 Database: ${mongoose.connection.name}`);
    console.log(
      `🔗 Connection state: ${
        mongoose.connection.readyState === 1 ? "Connected" : "Disconnected"
      }`
    );

    // Event handlers for better debugging
    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB connection error:", err);
      isConnected = false;
    });

    mongoose.connection.on("disconnected", () => {
      console.log("⚠️ MongoDB disconnected");
      isConnected = false;
    });

    mongoose.connection.on("reconnected", () => {
      console.log("✅ MongoDB reconnected");
      isConnected = true;
    });

    mongoose.connection.on("connected", () => {
      console.log("✅ MongoDB connected");
      isConnected = true;
    });
  } catch (error) {
    console.error(`❌ Database connection FAILED: ${error.message}`);

    // Specific error messages for MongoDB Atlas
    if (error.message.includes("ENOTFOUND")) {
      console.log("💡 DNS lookup failed. Check your internet connection.");
    } else if (error.message.includes("ETIMEDOUT")) {
      console.log("💡 Connection timeout. Check your network or try again.");
    } else if (
      error.message.includes("auth failed") ||
      error.message.includes("Authentication failed")
    ) {
      console.log(
        "💡 Authentication failed. Check your MongoDB Atlas username and password."
      );
      console.log("💡 Make sure your IP is whitelisted in MongoDB Atlas.");
    } else if (error.message.includes("bad auth")) {
      console.log(
        "💡 Authentication failed. Verify your MongoDB Atlas credentials."
      );
    } else if (error.message.includes("querySrv ENOTFOUND")) {
      console.log(
        "💡 DNS SRV record not found. Check your connection string format."
      );
    }

    throw error;
  }
};

export const ensureConnection = async () => {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  await connectToDatabase();
  return true;
};
