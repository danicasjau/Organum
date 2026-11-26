import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReviewSection } from '../../../gallery/GalleryV1';
import { TooltipProvider } from '../Overlays/Overlays';

function setup() {
  render(
    <TooltipProvider>
      <ReviewSection />
    </TooltipProvider>,
  );
  const notes = screen.getByLabelText('Review notes') as HTMLTextAreaElement;
  const send = screen.getByRole('button', { name: 'Send' });
  const comment = screen.getByRole('button', { name: 'Comment' });
  const thread = screen.getByRole('list', { name: 'Review thread' });
  return { notes, send, comment, thread };
}

describe('ReviewPanel (v2 review behaviour)', () => {
  it('disables Send and Comment while the notes field is empty', () => {
    const { notes, send, comment } = setup();
    expect(send).toBeDisabled();
    expect(comment).toBeDisabled();
    fireEvent.change(notes, { target: { value: 'Tighten the settle' } });
    expect(send).toBeEnabled();
    expect(comment).toBeEnabled();
  });

  it('Send appends a "Sent" entry and Comment a "Comment" entry, both clearing the field', () => {
    const { notes, send, comment, thread } = setup();
    fireEvent.change(notes, { target: { value: 'Note A' } });
    fireEvent.click(send);
    expect(notes.value).toBe('');
    const items = within(thread).getAllByRole('listitem');
    const last = items[items.length - 1]!;
    expect(last).toHaveTextContent('Note A');
    expect(last).toHaveTextContent('Sent');

    fireEvent.change(notes, { target: { value: 'Note B' } });
    fireEvent.click(comment);
    const items2 = within(thread).getAllByRole('listitem');
    const last2 = items2[items2.length - 1]!;
    expect(last2).toHaveTextContent('Note B');
    expect(last2).toHaveTextContent('Comment');
    expect(notes.value).toBe('');
  });

  it('status keys set the review chip', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByText('Approved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(screen.getByText('Changes requested')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }));
    expect(screen.getByText('On hold')).toBeInTheDocument();
  });

  it('title and subtitle entries update the info label live', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Title entry'), { target: { value: 'SH0999' } });
    expect(screen.getAllByText('SH0999').length).toBeGreaterThan(0);
  });
});
