import { ensureConnection } from "./db.js";
import { Reviews } from "./model.js";

export const getReviews = async (req, res) => {
  try {
    // Ensure connection before query
    await ensureConnection();

    console.log("🔍 Executing Reviews.find() query...");
    const reviews = await Reviews.find({}).maxTimeMS(30000).exec();

    console.log(`✅ Found ${reviews.length} reviews`);

    return res.status(200).json({
      status: true,
      message: "Reviews fetched successfully",
      count: reviews.length,
      data: reviews,
    });
  } catch (error) {
    if (
      error.name === "MongoServerSelectionError" ||
      error.name === "MongoNetworkError"
    ) {
      return res.status(503).json({
        status: false,
        message: "Database service unavailable. Please try again later.",
      });
    }

    return res.status(500).json({
      status: false,
      message: "Internal server error: " + error.message,
    });
  }
};

export const registerReview = async (req, res) => {
  const { fullname, message, rating } = req.body;

  try {
    // Ensure connection before query
    await ensureConnection();

    if (!fullname || !message || !rating) {
      return res.status(400).json({
        status: false,
        message: "All fields are required",
      });
    }

    const reviewAlreadyExists = await Reviews.findOne({ fullname })
      .maxTimeMS(15000)
      .exec();

    if (reviewAlreadyExists) {
      return res.status(400).json({
        status: false,
        message: `${fullname} has already been registered`,
      });
    }

    const review = new Reviews({
      fullname,
      message,
      rating,
    });

    await review.save();

    return res.status(201).json({
      status: true,
      message: "Review sent Successfully.",
    });
  } catch (error) {
    console.error("Review creation error:", error);
    return res.status(500).json({
      status: false,
      message: "Internal server error",
    });
  }
};
