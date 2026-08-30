import mongoose from "mongoose";

const problemMasterySchema = new mongoose.Schema(
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
    // Raw observations (never change after creation)
    solvingSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SolvingSession",
      required: [true, "Solving session ID is required"],
    },
    acceptedSubmissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Submission",
      required: [true, "Accepted submission ID is required"],
    },
    totalSubmissions: {
      type: Number,
      required: [true, "Total submissions is required"],
    },
    solvedAt: {
      type: Date,
      required: [true, "Solved at timestamp is required"],
    },
    // Mastery components (0-100 each)
    components: {
      solutionEfficiency: {
        type: Number,
        required: true,
        min: 0,
        max: 100,
      },
      timeComplexity: {
        type: Number,
        required: true,
        min: 0,
        max: 100,
      },
      submissionsUntilSuccess: {
        type: Number,
        required: true,
        min: 0,
        max: 100,
      },
      timeTaken: {
        type: Number,
        required: true,
        min: 0,
        max: 100,
      },
      hintsUsed: {
        type: Number,
        required: true,
        min: 0,
        max: 100,
      },
    },
    // Final weighted mastery (0-100)
    mastery: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    // Supporting metrics
    hintsUsedCount: {
      type: Number,
      default: 0,
    },
    totalTimeSeconds: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Unique compound index: one mastery per user per problem
problemMasterySchema.index({ userId: 1, problemId: 1 }, { unique: true });
problemMasterySchema.index({ userId: 1, mastery: -1 });
problemMasterySchema.index({ userId: 1 });

export const ProblemMastery = mongoose.model(
  "ProblemMastery",
  problemMasterySchema,
);
export default ProblemMastery;
