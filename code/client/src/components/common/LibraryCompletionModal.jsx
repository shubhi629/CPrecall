import React, { useState } from 'react';
import { Trophy, AlertTriangle, RefreshCw, X, CheckCircle2, RotateCcw } from 'lucide-react';
import api from '../../services/api';

/**
 * LibraryCompletionModal
 * Two-step confirmation flow shown when the user completes every available question in the library.
 * Allows safely resetting all active progress or preserving it across the current completion cycle.
 */
export default function LibraryCompletionModal({ isOpen, onClose, onResetComplete }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  if (!isOpen) return null;

  const handleKeepProgress = async () => {
    try {
      await api.dismissCompletion();
    } catch (err) {
      console.warn('Failed to record completion dismissal on backend:', err);
    }
    onClose();
  };

  const handleProceedToStep2 = () => {
    setError(null);
    setStep(2);
  };

  const handleCancelStep2 = () => {
    setError(null);
    setStep(1);
  };

  const handleExecuteReset = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.resetProgress();
      if (typeof api.clearCache === 'function') {
        api.clearCache();
      }
      setSuccessMessage(response.message || 'Progress reset successfully! Starting a fresh run.');
      setTimeout(() => {
        setSuccessMessage(null);
        setStep(1);
        if (onResetComplete) {
          onResetComplete(response);
        }
        onClose();
      }, 500);
    } catch (err) {
      console.error('Failed to reset progress:', err);
      setError(err.message || 'Failed to reset progress. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="completion-modal-title"
    >
      <div 
        className="bg-[var(--bg-card)] border border-[var(--border-subtle)] w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden relative transition-all"
        style={{
          boxShadow: step === 2 
            ? '0 20px 40px -15px rgba(239, 68, 68, 0.25), 0 0 0 1px rgba(239, 68, 68, 0.2)' 
            : '0 20px 40px -15px rgba(99, 102, 241, 0.25), 0 0 0 1px rgba(99, 102, 241, 0.2)'
        }}
      >
        {/* Ambient Top Glow Bar */}
        <div 
          className={`h-1.5 w-full ${step === 2 ? 'bg-gradient-to-r from-amber-500 via-rose-500 to-red-600' : 'bg-gradient-to-r from-amber-400 via-indigo-500 to-emerald-400'}`} 
        />

        <div className="p-6 sm:p-8">
          {successMessage ? (
            <div className="flex flex-col items-center text-center py-6 animate-scale-up">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4 border border-emerald-500/20">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">Progress Reset</h3>
              <p className="text-sm text-[var(--text-secondary)]">{successMessage}</p>
            </div>
          ) : step === 1 ? (
            /* STEP 1: CONGRATULATORY COMPLETION PROMPT */
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20 shadow-inner">
                    <Trophy className="w-6 h-6 animate-bounce-subtle" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold tracking-widest text-amber-400 uppercase font-mono">Milestone Reached</span>
                    <h2 id="completion-modal-title" className="text-xl font-bold text-[var(--text-primary)]">
                      Library Mastered!
                    </h2>
                  </div>
                </div>
                <button
                  onClick={handleKeepProgress}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="rounded-xl bg-[var(--bg-base)] p-4 border border-[var(--border-subtle)] text-sm leading-relaxed text-[var(--text-secondary)]">
                Congratulations! You've completed the entire question library. Would you like to reset your progress and start again?
              </div>

              <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleKeepProgress}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-[var(--border-subtle)] text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
                >
                  Keep My Progress
                </button>
                <button
                  type="button"
                  onClick={handleProceedToStep2}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white text-sm font-bold shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset Progress
                </button>
              </div>
            </div>
          ) : (
            /* STEP 2: TWO-STEP DESTRUCTIVE CONFIRMATION */
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-red-500/10 text-red-400 flex items-center justify-center border border-red-500/20 shadow-inner">
                  <AlertTriangle className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <span className="text-[10px] font-bold tracking-widest text-red-400 uppercase font-mono">Action Required</span>
                  <h2 id="completion-modal-title" className="text-xl font-bold text-[var(--text-primary)]">
                    Are you absolutely sure?
                  </h2>
                </div>
              </div>

              <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4 text-sm leading-relaxed text-[var(--text-primary)]">
                Are you absolutely sure? This will reset your question-solving progress. All questions will become incomplete, and your learning progress will start from zero. This action cannot be undone.
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 font-medium">
                  {error}
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleCancelStep2}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-[var(--border-subtle)] text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleExecuteReset}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white text-sm font-bold shadow-lg shadow-red-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Resetting Progress...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4" />
                      Yes, Reset Everything
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
