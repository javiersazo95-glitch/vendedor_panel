import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useFocusTrap } from './useFocusTrap';

function TestDialog({ active }: { active: boolean }) {
  const ref = useFocusTrap(active);
  return (
    <div>
      <button>outside-before</button>
      {active && (
        <div ref={ref} role="dialog" aria-modal="true">
          <button>first</button>
          <button>last</button>
        </div>
      )}
      <button>outside-after</button>
    </div>
  );
}

describe('useFocusTrap (UX-SRC-005)', () => {
  it('keeps Tab from the last focusable element cycling back to the first, not escaping to the page', () => {
    render(<TestDialog active />);
    const last = screen.getByText('last');
    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('keeps Shift+Tab from the first focusable element cycling back to the last', () => {
    render(<TestDialog active />);
    const first = screen.getByText('first');
    first.focus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(screen.getByText('last'));
  });

  it('returns focus to the element that was focused before the dialog opened, once it closes', () => {
    const outsideBefore = { current: null as HTMLElement | null };
    function Wrapper() {
      const [active, setActive] = useState(false);
      return (
        <div>
          <button
            ref={(el: HTMLElement | null) => {
              outsideBefore.current = el;
            }}
            onClick={() => setActive(true)}
          >
            opener
          </button>
          <TestDialog active={active} />
          <button onClick={() => setActive(false)}>close</button>
        </div>
      );
    }
    render(<Wrapper />);

    const opener = screen.getByText('opener');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByText('close'));

    expect(document.activeElement).toBe(opener);
  });
});
