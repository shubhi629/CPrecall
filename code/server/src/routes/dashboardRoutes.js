import express from "express";
import {
  getDashboard,
  getDashboardStatsOnly,
} from "../controllers/dashboardController.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// Get full dashboard
router.get("/", getDashboard);

// Get stats only (lightweight)
router.get("/stats", getDashboardStatsOnly);

export default router;
