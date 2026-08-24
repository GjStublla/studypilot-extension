import { beforeEach, describe, expect, it, vi } from 'vitest';

const render = vi.fn();

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({ render })),
}));

import { mountStudyPilot } from './mount';

describe('mountStudyPilot', () => {
  beforeEach(() => {
    render.mockClear();
  });

  it('mounts the extension inside a closed shadow root', () => {
    const shadowRoot = { append: vi.fn() };
    const host = {
      id: '',
      attachShadow: vi.fn(() => shadowRoot),
    };
    const style = { textContent: '' };
    const mount = { className: '' };
    let divCount = 0;

    vi.stubGlobal('document', {
      getElementById: vi.fn((id: string) => (id === 'studypilot-extension-fonts' ? {} : null)),
      createElement: vi.fn((tagName: string) => {
        if (tagName === 'style') return style;
        divCount += 1;
        return divCount === 1 ? host : mount;
      }),
      documentElement: { appendChild: vi.fn() },
    });

    mountStudyPilot();

    expect(host.attachShadow).toHaveBeenCalledWith({ mode: 'closed' });
    expect(shadowRoot.append).toHaveBeenCalledWith(style, mount);
    expect(render).toHaveBeenCalledOnce();
  });
});
