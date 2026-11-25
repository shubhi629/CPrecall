import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import LibraryCompletionModal from '../components/common/LibraryCompletionModal';
import api from '../services/api';

vi.mock('../services/api', () => ({
  default: {
    resetProgress: vi.fn(),
    dismissCompletion: vi.fn(),
    clearCache: vi.fn(),
  }
}));

describe('Question Library Completion & Two-Step Reset Modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Step 1 congratulatory message and action buttons', () => {
    const handleClose = vi.fn();
    const handleResetComplete = vi.fn();

    render(
      <LibraryCompletionModal
        isOpen={true}
        onClose={handleClose}
        onResetComplete={handleResetComplete}
      />
    );

    // Exact congratulatory text required by specifications
    expect(screen.getByText(/Congratulations! You've completed the entire question library/i)).toBeInTheDocument();
    expect(screen.getByText(/Would you like to reset your progress and start again\?/i)).toBeInTheDocument();

    // Required button labels
    expect(screen.getByRole('button', { name: /Reset Progress/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Keep My Progress/i })).toBeInTheDocument();
  });

  it('clicking "Keep My Progress" calls dismiss API and closes modal', async () => {
    api.dismissCompletion.mockResolvedValueOnce({ success: true, dismissal: { completionCycle: 1 } });
    const handleClose = vi.fn();
    const handleResetComplete = vi.fn();

    render(
      <LibraryCompletionModal
        isOpen={true}
        onClose={handleClose}
        onResetComplete={handleResetComplete}
      />
    );

    const keepBtn = screen.getByRole('button', { name: /Keep My Progress/i });
    fireEvent.click(keepBtn);

    await waitFor(() => {
      expect(api.dismissCompletion).toHaveBeenCalledTimes(1);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
    expect(handleResetComplete).not.toHaveBeenCalled();
  });

  it('clicking "Reset Progress" advances to Step 2 confirmation with destructive warning', async () => {
    render(
      <LibraryCompletionModal
        isOpen={true}
        onClose={vi.fn()}
        onResetComplete={vi.fn()}
      />
    );

    const resetBtn = screen.getByRole('button', { name: /Reset Progress/i });
    fireEvent.click(resetBtn);

    // Exact destructive confirmation text required by specifications
    expect(screen.getByText(/Are you absolutely sure\? This will reset your question-solving progress\./i)).toBeInTheDocument();
    expect(screen.getByText(/All questions will become incomplete, and your learning progress will start from zero\./i)).toBeInTheDocument();
    expect(screen.getByText(/This action cannot be undone\./i)).toBeInTheDocument();

    // Required Step 2 buttons
    expect(screen.getByRole('button', { name: /Yes, Reset Everything/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  it('clicking "Cancel" in Step 2 returns to Step 1 without executing reset', () => {
    render(
      <LibraryCompletionModal
        isOpen={true}
        onClose={vi.fn()}
        onResetComplete={vi.fn()}
      />
    );

    // Advance to Step 2
    fireEvent.click(screen.getByRole('button', { name: /Reset Progress/i }));
    expect(screen.getByRole('button', { name: /Yes, Reset Everything/i })).toBeInTheDocument();

    // Click Cancel
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    // Back to Step 1
    expect(screen.getByRole('button', { name: /Keep My Progress/i })).toBeInTheDocument();
    expect(api.resetProgress).not.toHaveBeenCalled();
  });

  it('clicking "Yes, Reset Everything" calls reset API and triggers onResetComplete', async () => {
    api.resetProgress.mockResolvedValueOnce({
      success: true,
      message: 'All progress has been safely reset.',
      resetVersion: 2
    });
    const handleClose = vi.fn();
    const handleResetComplete = vi.fn();

    render(
      <LibraryCompletionModal
        isOpen={true}
        onClose={handleClose}
        onResetComplete={handleResetComplete}
      />
    );

    // Advance to Step 2
    fireEvent.click(screen.getByRole('button', { name: /Reset Progress/i }));

    // Confirm destructive reset
    const confirmBtn = screen.getByRole('button', { name: /Yes, Reset Everything/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(api.resetProgress).toHaveBeenCalledTimes(1);
      expect(handleResetComplete).toHaveBeenCalledTimes(1);
    }, { timeout: 2000 });
  });

  it('displays error and allows retry if reset API fails', async () => {
    api.resetProgress.mockRejectedValueOnce(new Error('Network connection interrupted during batch deletion'));
    const handleResetComplete = vi.fn();

    render(
      <LibraryCompletionModal
        isOpen={true}
        onClose={vi.fn()}
        onResetComplete={handleResetComplete}
      />
    );

    // Advance and confirm
    fireEvent.click(screen.getByRole('button', { name: /Reset Progress/i }));
    fireEvent.click(screen.getByRole('button', { name: /Yes, Reset Everything/i }));

    await waitFor(() => {
      expect(screen.getByText(/Network connection interrupted during batch deletion/i)).toBeInTheDocument();
      // On error, the user can retry via 'Yes, Reset Everything'
      expect(screen.getByRole('button', { name: /Yes, Reset Everything/i })).toBeInTheDocument();
    });

    expect(handleResetComplete).not.toHaveBeenCalled();
  });
});
