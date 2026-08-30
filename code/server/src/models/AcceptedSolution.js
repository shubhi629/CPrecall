import mongoose from "mongoose";

const acceptedSolutionSchema = new mongoose.Schema(
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
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Submission",
      required: [true, "Submission ID is required"],
    },
    code: {
      type: String,
      required: [true, "Code is required"],
    },
    language: {
      type: String,
      required: [true, "Language is required"],
    },
    runtime: {
      type: Number, // milliseconds
      required: [true, "Runtime is required"],
    },
    memory: {
      type: Number, // KB
      required: [true, "Memory is required"],
    },
    analysisResult: {
      actualTimeComplexity: {
        type: String,
        default: null,
      },
      actualSpaceComplexity: {
        type: String,
        default: null,
      },
      optimalTimeComplexity: {
        type: String,
        default: null,
      },
      optimalSpaceComplexity: {
        type: String,
        default: null,
      },
      explanation: {
        type: String,
        default: "",
      },
      richAnalysis: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  },
);

// Unique compound index: one solution per user per problem
acceptedSolutionSchema.index({ userId: 1, problemId: 1 }, { unique: true });
acceptedSolutionSchema.index({ userId: 1 });

export const AcceptedSolution = mongoose.model(
  "AcceptedSolution",
  acceptedSolutionSchema,
);
export default AcceptedSolution;
