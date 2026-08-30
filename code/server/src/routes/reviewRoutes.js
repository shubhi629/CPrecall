import express from "express";
import {
  submitReview,
  getReviewsDue,
} from "../controllers/reviewController.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// Submit a review
router.post("/", submitReview);

// Get reviews due today
router.get("/due", getReviewsDue);

export default router;
