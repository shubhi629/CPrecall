import mongoose from "mongoose";

const submissionSchema = new mongoose.Schema(
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
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SolvingSession",
      required: [true, "Session ID is required"],
    },
    submissionId: {
      type: String,
      required: [true, "Submission ID is required"],
    },
    status: {
      type: String,
      enum: [
        "Accepted",
        "Wrong Answer",
        "Time Limit Exceeded",
        "Runtime Error",
        "Compile Error",
        "Memory Limit Exceeded",
      ],
      required: [true, "Status is required"],
    },
    runtime: {
      type: Number, // milliseconds
      default: null,
    },
    memory: {
      type: Number, // KB
      default: null,
    },
    language: {
      type: String,
      required: [true, "Language is required"],
    },
    timestamp: {
      type: Date,
      required: [true, "Timestamp is required"],
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
submissionSchema.index({ userId: 1, problemId: 1 });
submissionSchema.index({ sessionId: 1 });
submissionSchema.index({ userId: 1 });

export const Submission = mongoose.model("Submission", submissionSchema);
export default Submission;
