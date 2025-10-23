import express from "express";
import { getReviews, registerReview } from "./controller.js";
const router = express.Router();

router.post("/reviews", registerReview);
router.get("/reviews", getReviews);

export default router;
