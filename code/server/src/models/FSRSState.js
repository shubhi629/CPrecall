import mongoose from "mongoose";

const fsrsStateSchema = new mongoose.Schema(
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
    // FSRS rating (1-4)
    rating: {
      type: Number,
      enum: [1, 2, 3, 4],
      required: [true, "Rating is required"],
    },
    // Next review date
    nextReviewDate: {
      type: Date,
      required: [true, "Next review date is required"],
    },
    // Days between current and next review
    intervalDays: {
      type: Number,
      required: [true, "Interval days is required"],
    },
    // FSRS ease factor
    easeFactor: {
      type: Number,
      default: 2.5,
      min: 1.3,
    },
    // Review history (for recalculation)
    reviewHistory: [
      {
        reviewedAt: Date,
        rating: Number,
        intervalBefore: Number,
      },
    ],
  },
  {
    timestamps: true,
  },
);

// Unique compound index: one FSRS state per user per problem
fsrsStateSchema.index({ userId: 1, problemId: 1 }, { unique: true });
fsrsStateSchema.index({ userId: 1, nextReviewDate: 1 });
fsrsStateSchema.index({ userId: 1 });

export const FSRSState = mongoose.model("FSRSState", fsrsStateSchema);
export default FSRSState;
