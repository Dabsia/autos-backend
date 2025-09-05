const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const serverless = require("@vendia/serverless-express");
const connectDB = require("./db");
connectDB();

// Load environment variables
dotenv.config();

// Initialize Stripe
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

// Add this near the top of your file, after the imports
const activeRequests = new Map();

// MIDDLEWARE - MUST COME BEFORE ROUTES
app.use(morgan("dev"));
app.use(express.json()); // This MUST come before preventDuplicateProcessing
app.use(cors());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/", (req, res) => {
  res.json({ message: "Stripe Payment Server is running!" });
});

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: false,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  stripeCustomerId: {
    type: String,
    required: false,
    default: "unknown",
  },
  subscriptionId: {
    type: String,
    default: null,
  },
  subscriptionStatus: {
    type: String,
    enum: [
      "active",
      "inactive",
      "canceled",
      "past_due",
      "unpaid",
      "incomplete",
    ],
    default: "inactive",
  },
  paymentHistory: [
    {
      sessionId: String,
      amount: Number,
      currency: String,
      status: String,
      payerName: String,
      planId: String,
      planName: String,
      planPrice: Number,
      isActive: {
        type: Boolean,
        default: true,
      },
      paymentDate: {
        type: Date,
        default: Date.now,
      },
      expiresAt: {
        type: Date,
        default: function () {
          return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        },
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  // Add these new fields to store current payment info
  currentPaymentAmount: {
    type: Number,
    default: 0,
  },
  currentPlan: {
    type: String,
    default: "None",
  },
  currentPaymentDate: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastPaymentDate: {
    type: Date,
    default: null,
  },
  hasActiveSubscription: {
    type: Boolean,
    default: false,
  },
  subscriptionExpiresAt: {
    type: Date,
    default: null,
  },
});

// Add this after your userSchema definition
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ "paymentHistory.sessionId": 1 }, { sparse: true });

// Add this virtual property to your userSchema
userSchema.virtual("totalSpent").get(function () {
  if (!this.paymentHistory || this.paymentHistory.length === 0) return 0;
  return this.paymentHistory.reduce(
    (total, payment) => total + payment.amount,
    0
  );
});

// Also add a virtual for the last payment date
userSchema.virtual("lastPaymentDateFormatted").get(function () {
  if (!this.paymentHistory || this.paymentHistory.length === 0) return null;

  const sortedPayments = [...this.paymentHistory].sort(
    (a, b) => new Date(b.paymentDate) - new Date(a.paymentDate)
  );

  return sortedPayments[0].paymentDate;
});

// Middleware to ensure currentPaymentAmount is set for existing users
userSchema.pre("save", function (next) {
  if (this.isModified("paymentHistory") && this.paymentHistory.length > 0) {
    // Get the most recent payment
    const sortedPayments = [...this.paymentHistory].sort(
      (a, b) => new Date(b.paymentDate) - new Date(a.paymentDate)
    );
    const latestPayment = sortedPayments[0];

    // Update current payment info if not set or if this is a newer payment
    if (
      !this.currentPaymentDate ||
      new Date(latestPayment.paymentDate) > new Date(this.currentPaymentDate)
    ) {
      this.currentPaymentAmount = latestPayment.amount;
      this.currentPlan = latestPayment.planName;
      this.currentPaymentDate = latestPayment.paymentDate;
    }
  }
  next();
});

const User = mongoose.model("User", userSchema);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_CONNECTION_STRING, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Available plans
const plans = [
  {
    id: "super-deluxe",
    name: "Super Deluxe",
    price: 69.99,
    description: "Super Deluxe Plan",
  },
  {
    id: "ultraluxe",
    name: "Ultraluxe",
    price: 99.99,
    description: "Ultraluxe Premium Plan",
  },
];

// Get all available plans
app.get("/plans", (req, res) => {
  res.json({ plans });
});

// Create payment session
app.post("/create-payment", async (req, res) => {
  try {
    const { plan_id } = req.body;

    // Validate input
    if (!plan_id) {
      return res.status(400).json({
        error: "Missing plan_id in request body",
        example: { plan_id: "super-deluxe" },
      });
    }

    // Find the plan by ID
    const plan = plans.find((p) => p.id === plan_id);

    console.log("Found plan:", plan);

    if (!plan) {
      return res.status(400).json({
        error: "Invalid plan_id",
        available_plans: plans.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
        })),
      });
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: plan.name,
              description: plan.description,
            },
            unit_amount: Math.round(plan.price * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `http://localhost:5173/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://localhost:5173/canceled`,
      billing_address_collection: "auto",
      custom_fields: [
        {
          key: "name_on_card",
          label: {
            type: "custom",
            custom: "Name on card",
          },
          type: "text",
          optional: false,
        },
      ],
      metadata: {
        plan_id: plan.id,
        plan_name: plan.name,
      },
    });

    console.log("Stripe session created:", session.id);

    res.json({
      success: true,
      session_id: session.id,
      url: session.url,
      session: session,
    });
  } catch (error) {
    console.error("Error details:", error);

    res.status(500).json({
      error: "Failed to create payment session",
      message: error.message,
      type: error.type || "unknown_error",
    });
  }
});

// Improved middleware to prevent duplicate session processing
const preventDuplicateProcessing = async (req, res, next) => {
  const { session_id } = req.body;

  if (!session_id) {
    return next();
  }

  try {
    // First check if already processed in database
    const existingUser = await User.findOne({
      "paymentHistory.sessionId": session_id,
    });

    if (existingUser) {
      const existingPayment = existingUser.paymentHistory.find(
        (p) => p.sessionId === session_id
      );

      console.log(
        `✅ Session ${session_id} already processed in database for ${existingUser.email}`
      );

      return res.status(200).json({
        success: true,
        message: "Session already processed",
        already_processed: true,
        session: {
          id: session_id,
          payment_status: "paid",
          amount_total: existingPayment.amount * 100,
          processed_at: existingPayment.paymentDate,
        },
        user: {
          email: existingUser.email,
          name: existingUser.name,
          totalSpent: existingUser.totalSpent,
          currentPaymentAmount: existingUser.currentPaymentAmount,
          currentPlan: existingUser.currentPlan,
          has_active_subscription: existingUser.hasActiveSubscription,
          subscription_expires_at: existingUser.subscriptionExpiresAt,
        },
      });
    }

    // Then check in-memory processing - but be less restrictive
    const now = Date.now();
    const existingRequest = activeRequests.get(session_id);

    if (existingRequest) {
      const timeElapsed = now - existingRequest.timestamp;

      // Reduced timeout to 15 seconds instead of 30
      if (timeElapsed > 15000) {
        console.log(
          `In-memory request for session ${session_id} is stale, allowing new request`
        );
        activeRequests.delete(session_id);
      } else {
        console.log(
          `Session ${session_id} is currently being processed in memory (${Math.floor(
            timeElapsed / 1000
          )}s ago)`
        );
        return res.status(202).json({
          // Changed from 409 to 202 (Accepted)
          success: false,
          message: "Request currently being processed",
          processing: true,
          session_id: session_id,
          retry_after: Math.max(1000, 15000 - timeElapsed), // Suggest retry time
        });
      }
    }

    // Mark as processing
    activeRequests.set(session_id, { timestamp: now });
    console.log(`🔄 Starting to process new session: ${session_id}`);

    const cleanup = () => {
      const deleted = activeRequests.delete(session_id);
      console.log(`🧹 Cleaned up session ${session_id} (deleted: ${deleted})`);
    };

    res.on("finish", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);

    // Reduced cleanup timeout to 20 seconds
    setTimeout(() => activeRequests.delete(session_id), 20000);

    next();
  } catch (error) {
    console.error("Error in duplicate prevention middleware:", error);
    // If there's an error, don't block the request
    next();
  }
};

// New endpoint for checking session status without processing
app.get("/check-session/:session_id", async (req, res) => {
  const { session_id } = req.params;

  try {
    // Quick check if already in database
    const existingUser = await User.findOne({
      "paymentHistory.sessionId": session_id,
    });

    if (existingUser) {
      const existingPayment = existingUser.paymentHistory.find(
        (p) => p.sessionId === session_id
      );

      return res.json({
        success: true,
        processed: true,
        user: {
          email: existingUser.email,
          name: existingUser.name,
          totalSpent: existingUser.totalSpent,
          currentPaymentAmount: existingUser.currentPaymentAmount,
          currentPlan: existingUser.currentPlan,
          has_active_subscription: existingUser.hasActiveSubscription,
        },
        payment: {
          amount: existingPayment.amount,
          plan: existingPayment.planName,
          date: existingPayment.paymentDate,
        },
      });
    }

    // Check Stripe session status
    const session = await stripe.checkout.sessions.retrieve(session_id);

    return res.json({
      success: session.payment_status === "paid",
      processed: false,
      payment_status: session.payment_status,
      ready_for_processing: session.payment_status === "paid",
    });
  } catch (error) {
    console.error(`Error checking session ${session_id}:`, error);
    return res.status(500).json({
      success: false,
      error: "Failed to check session status",
      message: error.message,
    });
  }
});

// Updated verify session endpoint with proper timing and duplicate handling
app.post("/verify-session", preventDuplicateProcessing, async (req, res) => {
  const { session_id } = req.body;

  if (!session_id) {
    return res.status(400).json({
      error: "Missing session_id in request body",
    });
  }

  try {
    console.log(`🔄 Processing session: ${session_id}`);

    // Add a small delay to ensure Stripe has fully processed the session
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["customer", "payment_intent"],
    });

    console.log(
      `Session status: ${session.payment_status}, amount: ${session.amount_total}`
    );

    // Handle different payment statuses more comprehensively
    if (session.payment_status === "paid") {
      // Payment is successful, proceed with user creation/update

      // Get subscription if it exists
      let subscription = null;
      if (session.subscription) {
        try {
          subscription = await stripe.subscriptions.retrieve(
            session.subscription
          );
        } catch (subError) {
          console.error("Error retrieving subscription:", subError);
        }
      }

      // Save to database with transaction protection
      const savedUser = await saveUserToDatabase(session, subscription);

      console.log(
        `✅ Successfully processed session ${session_id} for user ${savedUser.email}`
      );

      return res.status(200).json({
        success: true,
        session,
        subscription,
        newly_processed: true,
        payment_details: {
          amount: session.amount_total ? session.amount_total / 100 : 0,
          currency: session.currency || "gbp",
          plan: session.metadata?.plan_name || "Unknown Plan",
        },
        user: {
          email: savedUser.email,
          name: savedUser.name,
          totalSpent: savedUser.totalSpent,
          currentPaymentAmount: savedUser.currentPaymentAmount,
          currentPlan: savedUser.currentPlan,
          has_active_subscription: savedUser.hasActiveSubscription,
          subscription_expires_at: savedUser.subscriptionExpiresAt,
        },
      });
    } else if (
      session.payment_status === "unpaid" ||
      session.payment_status === "no_payment_required"
    ) {
      // Payment is still processing or failed
      return res.status(200).json({
        success: false,
        message: `Payment status: ${session.payment_status}`,
        payment_processing: session.payment_status === "unpaid",
        session: {
          id: session.id,
          payment_status: session.payment_status,
          payment_intent_status: session.payment_intent?.status,
        },
        retry_after: 2000, // Tell frontend to retry after 2 seconds
      });
    } else {
      // Other statuses (e.g., requires_action, requires_payment_method)
      return res.status(200).json({
        success: false,
        message: `Payment requires attention: ${session.payment_status}`,
        requires_action: true,
        session: {
          id: session.id,
          payment_status: session.payment_status,
          url: session.url, // In case they need to complete payment
        },
      });
    }
  } catch (error) {
    console.error(`❌ Error processing session ${session_id}:`, error);

    // If it's a Stripe error about the session not being found, handle gracefully
    if (
      error.type === "StripeInvalidRequestError" &&
      error.code === "resource_missing"
    ) {
      return res.status(404).json({
        success: false,
        error: "Session not found",
        message: "The payment session could not be found. It may have expired.",
        session_id: session_id,
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to process payment session",
      message: error.message,
      session_id: session_id,
      retry_after: 3000, // Tell frontend to retry after 3 seconds
    });
  }
});

async function saveUserToDatabase(session, subscription = null) {
  const mongoSession = await mongoose.startSession();

  try {
    return await mongoSession.withTransaction(async () => {
      const existingUserWithSession = await User.findOne({
        "paymentHistory.sessionId": session.id,
      }).session(mongoSession);

      if (existingUserWithSession) {
        console.log(
          `Session ${session.id} already processed globally for user ${existingUserWithSession.email}`
        );
        return existingUserWithSession;
      }

      const email =
        session.customer_details?.email ||
        session.customer?.email ||
        "unknown@example.com";
      let name = session.customer_details?.name || "Unknown Customer";

      if (session.payment_intent) {
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(
            session.payment_intent,
            {
              expand: ["payment_method"],
            }
          );

          if (paymentIntent.payment_method?.card?.name) {
            name = paymentIntent.payment_method.card.name;
          } else if (paymentIntent.payment_method?.billing_details?.name) {
            name = paymentIntent.payment_method.billing_details.name;
          }
        } catch (paymentError) {
          console.error("Error retrieving payment intent:", paymentError);
        }
      }

      const planId = session.metadata?.plan_id || "unknown";
      const planName = session.metadata?.plan_name || "Unknown Plan";
      const plan = plans.find((p) => p.id === planId);
      const planPrice = plan
        ? plan.price
        : session.amount_total
        ? session.amount_total / 100
        : 0;
      const currentPaymentAmount = session.amount_total
        ? session.amount_total / 100
        : 0;

      if (!email || !email.includes("@")) {
        throw new Error(`Invalid email address: ${email}`);
      }

      const paymentDate = new Date();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const paymentData = {
        sessionId: session.id,
        amount: currentPaymentAmount,
        currency: session.currency || "gbp",
        status: session.payment_status || "unknown",
        payerName: name,
        planId: planId,
        planName: planName,
        planPrice: planPrice,
        isActive: true,
        paymentDate: paymentDate,
        expiresAt: expiresAt,
        createdAt: new Date(),
      };

      let user = await User.findOne({
        email: email.toLowerCase(),
      }).session(mongoSession);

      if (user) {
        console.log(`Found existing user: ${user.email}`);

        const existingPayment = user.paymentHistory.find(
          (payment) => payment.sessionId === session.id
        );

        if (existingPayment) {
          console.log(
            `Payment for session ${session.id} already exists for user ${user.email}, returning existing user...`
          );
          return user;
        }

        user.paymentHistory.push(paymentData);
        user.lastPaymentDate = new Date();
        user.currentPaymentAmount = currentPaymentAmount;
        user.currentPlan = planName;
        user.currentPaymentDate = paymentDate;
        user.hasActiveSubscription = true;
        user.subscriptionExpiresAt = expiresAt;

        if (name !== "Unknown Customer") {
          user.name = name;
        }

        if (session.customer && session.customer !== "unknown") {
          user.stripeCustomerId = session.customer;
        }

        if (subscription) {
          user.subscriptionId = subscription.id;
          user.subscriptionStatus = subscription.status;
        }

        await user.save({ session: mongoSession });
        console.log(
          `Updated existing user ${email} with payment amount: $${currentPaymentAmount}`
        );
      } else {
        console.log(`Creating new user for: ${email}`);

        user = new User({
          name: name,
          email: email.toLowerCase(),
          stripeCustomerId: session.customer || "unknown",
          paymentHistory: [paymentData],
          lastPaymentDate: new Date(),
          currentPaymentAmount: currentPaymentAmount,
          currentPlan: planName,
          currentPaymentDate: paymentDate,
          hasActiveSubscription: true,
          subscriptionExpiresAt: expiresAt,
        });

        await user.save({ session: mongoSession });
        console.log(
          `Created new user ${email} with payment amount: $${currentPaymentAmount}`
        );
      }

      return user;
    });
  } catch (error) {
    console.error("Error saving user to database:", error);
    throw error;
  } finally {
    await mongoSession.endSession();
  }
}

// Function to find and merge duplicate users by email
async function mergeDuplicateUsers() {
  try {
    const users = await User.find({});
    const emailMap = new Map();
    const duplicates = [];

    for (const user of users) {
      const normalizedEmail = user.email.toLowerCase().trim();
      if (emailMap.has(normalizedEmail)) {
        duplicates.push({
          original: emailMap.get(normalizedEmail),
          duplicate: user,
        });
      } else {
        emailMap.set(normalizedEmail, user);
      }
    }

    for (const { original, duplicate } of duplicates) {
      console.log(
        `Merging duplicate user: ${duplicate.email} into ${original.email}`
      );

      original.paymentHistory.push(...duplicate.paymentHistory);

      if (
        new Date(duplicate.currentPaymentDate) >
        new Date(original.currentPaymentDate)
      ) {
        original.currentPaymentAmount = duplicate.currentPaymentAmount;
        original.currentPlan = duplicate.currentPlan;
        original.currentPaymentDate = duplicate.currentPaymentDate;
      }

      if (
        new Date(duplicate.subscriptionExpiresAt) >
        new Date(original.subscriptionExpiresAt)
      ) {
        original.hasActiveSubscription = duplicate.hasActiveSubscription;
        original.subscriptionExpiresAt = duplicate.subscriptionExpiresAt;
      }

      if (
        duplicate.stripeCustomerId !== "unknown" &&
        original.stripeCustomerId === "unknown"
      ) {
        original.stripeCustomerId = duplicate.stripeCustomerId;
      }

      await original.save();
      await User.deleteOne({ _id: duplicate._id });
      console.log(`Deleted duplicate user: ${duplicate.email}`);
    }

    console.log(`Merged ${duplicates.length} duplicate users`);
  } catch (error) {
    console.error("Error merging duplicate users:", error);
  }
}

// // Run this once to clean up existing duplicates
// mergeDuplicateUsers();

// Function to check and update expired subscriptions
async function checkExpiredSubscriptions() {
  try {
    const now = new Date();
    const expiredUsers = await User.updateMany(
      {
        hasActiveSubscription: true,
        subscriptionExpiresAt: { $lt: now },
      },
      {
        $set: {
          hasActiveSubscription: false,
          subscriptionStatus: "inactive",
        },
      }
    );

    await User.updateMany(
      {
        "paymentHistory.expiresAt": { $lt: now },
        "paymentHistory.isActive": true,
      },
      {
        $set: {
          "paymentHistory.$[elem].isActive": false,
        },
      },
      {
        arrayFilters: [{ "elem.expiresAt": { $lt: now } }],
      }
    );

    console.log(`Updated ${expiredUsers.modifiedCount} expired subscriptions`);
  } catch (error) {
    console.error("Error checking expired subscriptions:", error);
  }
}

// Run the check every hour
// setInterval(checkExpiredSubscriptions, 60 * 60 * 1000);
// Also run on startup
// checkExpiredSubscriptions();

// Get all payments for admin dashboard
app.get("/admin/payments", async (req, res) => {
  try {
    const users = await User.find({});

    let allPayments = [];
    users.forEach((user) => {
      user.paymentHistory.forEach((payment) => {
        allPayments.push({
          customer_name: user.name,
          customer_email: user.email,
          session_id: payment.sessionId,
          amount: payment.amount,
          amount_paid: payment.amount,
          currency: payment.currency,
          status: payment.status,
          plan_id: payment.planId,
          plan_name: payment.planName,
          plan_price: payment.planPrice,
          payment_date: payment.paymentDate,
          expires_at: payment.expiresAt,
          is_active: payment.isActive,
          payer_name: payment.payerName,
          user_has_active_subscription: user.hasActiveSubscription,
          user_subscription_expires: user.subscriptionExpiresAt,
          user_total_spent: user.totalSpent,
        });
      });
    });

    const totalRevenue = allPayments.reduce(
      (sum, payment) => sum + payment.amount,
      0
    );

    res.json({
      success: true,
      payments: allPayments,
      total_count: allPayments.length,
      total_revenue: totalRevenue,
      active_subscriptions: users.filter((user) => user.hasActiveSubscription)
        .length,
    });
  } catch (error) {
    console.error("Error fetching admin payments:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch payment data",
      message: error.message,
    });
  }
});

// Check user subscription status
app.get("/user/:email/subscription-status", async (req, res) => {
  try {
    const { email } = req.params;

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const isCurrentlyActive =
      user.hasActiveSubscription && user.subscriptionExpiresAt > new Date();

    if (
      user.hasActiveSubscription &&
      user.subscriptionExpiresAt <= new Date()
    ) {
      user.hasActiveSubscription = false;
      user.subscriptionStatus = "inactive";
      await user.save();
    }

    res.json({
      success: true,
      has_active_subscription: isCurrentlyActive,
      subscription_expires_at: user.subscriptionExpiresAt,
      days_remaining: isCurrentlyActive
        ? Math.ceil(
            (user.subscriptionExpiresAt - new Date()) / (1000 * 60 * 60 * 24)
          )
        : 0,
      last_payment_date: user.lastPaymentDate,
      current_payment_amount: user.currentPaymentAmount,
      current_plan: user.currentPlan,
      total_amount_paid: user.totalSpent,
    });
  } catch (error) {
    console.error("Error checking subscription status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to check subscription status",
      message: error.message,
    });
  }
});

// Export payments data as CSV
app.get("/admin/export-payments", async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const startDate = Math.floor(
      (Date.now() - days * 24 * 60 * 60 * 1000) / 1000
    );

    const sessions = await stripe.checkout.sessions.list({
      created: { gte: startDate },
      limit: 100,
    });

    const csvHeader =
      "Session ID,Customer Email,Customer Name,Plan,Amount,Currency,Date,Status\n";
    const csvRows = sessions.data
      .filter((session) => session.payment_status === "paid")
      .map((session) => {
        const date = new Date(session.created * 1000)
          .toISOString()
          .split("T")[0];
        const amount = (session.amount_total / 100).toFixed(2);
        return `${session.id},${session.customer_details?.email || ""},${
          session.customer_details?.name || ""
        },${
          session.metadata?.plan_name || ""
        },${amount},${session.currency.toUpperCase()},${date},${
          session.payment_status
        }`;
      })
      .join("\n");

    const csvContent = csvHeader + csvRows;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="payments-${
        new Date().toISOString().split("T")[0]
      }.csv"`
    );
    res.send(csvContent);
  } catch (error) {
    console.error("Error exporting payments:", error);
    res.status(500).json({
      error: "Failed to export payment data",
      message: error.message,
    });
  }
});

// Get payment history for a specific user
app.get("/user/:email/payments", async (req, res) => {
  try {
    const { email } = req.params;

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const sortedPayments = user.paymentHistory.sort(
      (a, b) => new Date(b.paymentDate) - new Date(a.paymentDate)
    );

    res.json({
      success: true,
      user: {
        name: user.name,
        email: user.email,
        total_spent: user.totalSpent,
        current_payment_amount: user.currentPaymentAmount,
        last_payment_date: user.lastPaymentDateFormatted,
        has_active_subscription: user.hasActiveSubscription,
        subscription_expires_at: user.subscriptionExpiresAt,
      },
      payments: sortedPayments.map((payment) => ({
        session_id: payment.sessionId,
        amount: payment.amount,
        amount_paid: payment.amount,
        currency: payment.currency,
        status: payment.status,
        plan_name: payment.planName,
        plan_price: payment.planPrice,
        payment_date: payment.paymentDate,
        expires_at: payment.expiresAt,
        is_active: payment.isActive,
        payer_name: payment.payerName,
      })),
      total_payments: user.paymentHistory.length,
    });
  } catch (error) {
    console.error("Error fetching user payments:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch user payment data",
      message: error.message,
    });
  }
});

// Admin endpoint to clear stuck sessions manually
app.post("/admin/clear-session", (req, res) => {
  const { session_id } = req.body;

  if (!session_id) {
    return res.status(400).json({ error: "Missing session_id" });
  }

  const wasActive = activeRequests.delete(session_id);

  res.json({
    success: true,
    message: `Session ${session_id} ${
      wasActive ? "was cleared" : "was not in active requests"
    }`,
    session_id: session_id,
    was_active: wasActive,
  });
});

// Admin endpoint to view currently processing sessions
app.get("/admin/active-sessions", (req, res) => {
  const now = Date.now();
  const activeSessions = Array.from(activeRequests.entries()).map(
    ([sessionId, data]) => ({
      session_id: sessionId,
      timestamp: data.timestamp,
      age_seconds: Math.floor((now - data.timestamp) / 1000),
      is_stale: now - data.timestamp > 15000, // Updated to 15 seconds
    })
  );

  res.json({
    success: true,
    active_sessions: activeSessions,
    total_active: activeSessions.length,
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({
    error: "Internal server error",
    message: error.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    available_endpoints: [
      "GET /",
      "GET /plans",
      "POST /create-payment",
      "GET /check-session/:session_id",
      "POST /verify-session",
      "GET /admin/payments",
      "GET /admin/active-sessions",
      "POST /admin/clear-session",
      "GET /user/:email/subscription-status",
      "GET /user/:email/payments",
      "GET /admin/export-payments",
    ],
  });
});

app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});

// Export as serverless function
module.exports = (req, res) => {
  return app(req, res);
};
