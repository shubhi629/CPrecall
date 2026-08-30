import express from "express";
import { getProblems, getProblem } from "../controllers/problemController.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// Get problems with filters
router.get("/", getProblems);

// Get single problem details
router.get("/:id", getProblem);

export default router;
