import express from "express";
import { getPatterns, getPattern } from "../controllers/patternController.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// Get all patterns with mastery
router.get("/", getPatterns);

// Get single pattern details
router.get("/:patternName", getPattern);

export default router;
