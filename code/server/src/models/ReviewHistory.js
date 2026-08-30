import mongoose from "mongoose";

const reviewHistorySchema = new mongoose.Schema(
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
    reviewedAt: {
      type: Date,
      required: [true, "Review date is required"],
      default: Date.now,
    },
    previousMastery: {
      type: Number,
      default: null,
    },
    newMastery: {
      type: Number,
      required: [true, "New mastery is required"],
    },
    fsrsRating: {
      type: Number,
      enum: [1, 2, 3, 4],
      required: [true, "FSRS rating is required"],
    },
    status: {
      type: String,
      enum: ["completed", "skipped", "failed"],
      default: "completed",
    },
    satisfiedByProblemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Problem",
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for common queries
reviewHistorySchema.index({ userId: 1, reviewedAt: -1 });
reviewHistorySchema.index({ userId: 1, problemId: 1 });
reviewHistorySchema.index({ userId: 1 });

export const ReviewHistory = mongoose.model(
  "ReviewHistory",
  reviewHistorySchema,
);
export default ReviewHistory;
