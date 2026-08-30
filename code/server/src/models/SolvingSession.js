import mongoose from "mongoose";

const solvingSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    problemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Problem",
      required: [true, "Problem ID is required"],
    },
    startTime: {
      type: Date,
      required: [true, "Start time is required"],
    },
    endTime: {
      type: Date,
      required: [true, "End time is required"],
    },
    totalTimeSeconds: {
      type: Number,
      required: [true, "Total time is required"],
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for common queries
solvingSessionSchema.index({ userId: 1, problemId: 1, startTime: -1 });
solvingSessionSchema.index({ userId: 1 });
solvingSessionSchema.index({ problemId: 1 });

export const SolvingSession = mongoose.model(
  "SolvingSession",
  solvingSessionSchema,
);
export default SolvingSession;
