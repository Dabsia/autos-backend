import mongoose from "mongoose";

const reviewsSchema = new mongoose.Schema({
  fullname: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  rating: {
    type: Number,
    required: true,
  },
});

export const Reviews = mongoose.model("Review", reviewsSchema);
