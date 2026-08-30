import express from "express";
import {
  receiveSubmission,
  ingestionHealth,
} from "../controllers/ingestionController.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Health check (no auth required)
router.get("/health", ingestionHealth);

// All other routes require authentication
router.use(requireAuth);

// Receive submission from extension
router.post("/submission", receiveSubmission);

export default router;
