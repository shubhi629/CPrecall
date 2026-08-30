import express from "express";
import { analyzeCode } from "../controllers/analyzeController.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/**
 * POST /api/analyze
 * Analyze accepted code using Gemini LLM.
 * Called by Tampermonkey extension after getting Accepted.
 * Auth required so only logged-in CPRecal users can call it.
 */
router.post("/", requireAuth, analyzeCode);

export default router;
