import type { CDPSession, Page } from '@playwright/test';

const HOST = '#studypilot-extension-root';

type ShadowQuery = {
  session: CDPSession;
  nodeId: number;
};

async function documentNodeId(session: CDPSession): Promise<number> {
  const { root } = await session.send('DOM.getDocument', { depth: 0, pierce: false });
  return root.nodeId;
}

async function shadowRootNodeId(page: Page, session: CDPSession): Promise<number> {
  const docId = await documentNodeId(session);
  const host = await session.send('DOM.querySelector', {
    nodeId: docId,
    selector: HOST,
  });
  if (!host.nodeId) {
    throw new Error('StudyPilot host #studypilot-extension-root was not found');
  }

  const described = await session.send('DOM.describeNode', {
    nodeId: host.nodeId,
    depth: 0,
    pierce: true,
  });
  const backendId = described.node.shadowRoots?.[0]?.backendNodeId;
  if (!backendId) {
    throw new Error('StudyPilot closed shadow root was not exposed over CDP');
  }

  const pushed = await session.send('DOM.pushNodesByBackendIdsToFrontend', {
    backendNodeIds: [backendId],
  });
  const nodeId = pushed.nodeIds[0];
  if (!nodeId) {
    throw new Error('Could not adopt the StudyPilot shadow root');
  }
  return nodeId;
}

export async function queryShadow(page: Page, selector: string): Promise<ShadowQuery | null> {
  const session = await page.context().newCDPSession(page);
  await session.send('DOM.enable');
  await session.send('Runtime.enable');
  const rootId = await shadowRootNodeId(page, session);
  const found = await session.send('DOM.querySelector', {
    nodeId: rootId,
    selector,
  });
  if (!found.nodeId) {
    await session.detach().catch(() => undefined);
    return null;
  }
  return { session, nodeId: found.nodeId };
}

export async function waitForShadow(page: Page, selector: string, timeoutMs = 15_000): Promise<ShadowQuery> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const found = await queryShadow(page, selector);
      if (found) return found;
    } catch (error) {
      lastError = error;
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`Timed out waiting for shadow selector ${selector}${lastError ? `: ${String(lastError)}` : ''}`);
}

export async function clickShadow(page: Page, selector: string): Promise<void> {
  const handle = await waitForShadow(page, selector);
  try {
    const resolved = await handle.session.send('DOM.resolveNode', { nodeId: handle.nodeId });
    const objectId = resolved.object.objectId;
    if (!objectId) throw new Error(`No remote object for ${selector}`);
    await handle.session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function() { this.click(); }',
      returnByValue: true,
    });
  } finally {
    await handle.session.detach().catch(() => undefined);
  }
}

export async function shadowExists(page: Page, selector: string): Promise<boolean> {
  const found = await queryShadow(page, selector);
  if (!found) return false;
  await found.session.detach().catch(() => undefined);
  return true;
}

export async function shadowChecked(page: Page, selector: string): Promise<boolean> {
  const found = await waitForShadow(page, selector);
  try {
    const resolved = await found.session.send('DOM.resolveNode', { nodeId: found.nodeId });
    const objectId = resolved.object.objectId;
    if (!objectId) throw new Error(`No remote object for ${selector}`);
    const result = await found.session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function() { return Boolean(this.checked); }',
      returnByValue: true,
    });
    return Boolean(result.result.value);
  } finally {
    await found.session.detach().catch(() => undefined);
  }
}

export async function shadowText(page: Page, selector: string): Promise<string> {
  const found = await waitForShadow(page, selector);
  try {
    const resolved = await found.session.send('DOM.resolveNode', { nodeId: found.nodeId });
    const objectId = resolved.object.objectId;
    if (!objectId) throw new Error(`No remote object for ${selector}`);
    const result = await found.session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function() { return (this.innerText || this.textContent || "").trim(); }',
      returnByValue: true,
    });
    return String(result.result.value ?? '');
  } finally {
    await found.session.detach().catch(() => undefined);
  }
}

export async function focusShadow(page: Page, selector: string): Promise<void> {
  const handle = await waitForShadow(page, selector);
  try {
    const resolved = await handle.session.send('DOM.resolveNode', { nodeId: handle.nodeId });
    const objectId = resolved.object.objectId;
    if (!objectId) throw new Error(`No remote object for ${selector}`);
    await handle.session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function() { this.focus(); }',
      returnByValue: true,
    });
  } finally {
    await handle.session.detach().catch(() => undefined);
  }
}

export async function fillShadow(page: Page, selector: string, value: string): Promise<void> {
  const handle = await waitForShadow(page, selector);
  try {
    const resolved = await handle.session.send('DOM.resolveNode', { nodeId: handle.nodeId });
    const objectId = resolved.object.objectId;
    if (!objectId) throw new Error(`No remote object for ${selector}`);
    await handle.session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function(nextValue) {
        const prototype = this instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        setter?.call(this, nextValue);
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`,
      arguments: [{ value }],
      returnByValue: true,
    });
  } finally {
    await handle.session.detach().catch(() => undefined);
  }
}

export async function shadowBoundingBox(
  page: Page,
  selector: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await waitForShadow(page, selector);
  try {
    const resolved = await found.session.send('DOM.resolveNode', { nodeId: found.nodeId });
    const objectId = resolved.object.objectId;
    if (!objectId) throw new Error(`No remote object for ${selector}`);
    const result = await found.session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        const rect = this.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }`,
      returnByValue: true,
    });
    return result.result.value as { x: number; y: number; width: number; height: number };
  } finally {
    await found.session.detach().catch(() => undefined);
  }
}

export async function shadowLayoutMetrics(
  page: Page,
  selector: string,
): Promise<{ clientWidth: number; scrollWidth: number; clientHeight: number; scrollHeight: number }> {
  const found = await waitForShadow(page, selector);
  try {
    const resolved = await found.session.send('DOM.resolveNode', { nodeId: found.nodeId });
    const objectId = resolved.object.objectId;
    if (!objectId) throw new Error(`No remote object for ${selector}`);
    const result = await found.session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        return {
          clientWidth: this.clientWidth,
          scrollWidth: this.scrollWidth,
          clientHeight: this.clientHeight,
          scrollHeight: this.scrollHeight,
        };
      }`,
      returnByValue: true,
    });
    return result.result.value as {
      clientWidth: number;
      scrollWidth: number;
      clientHeight: number;
      scrollHeight: number;
    };
  } finally {
    await found.session.detach().catch(() => undefined);
  }
}

export type ShadowInteractiveAudit = {
  tagName: string;
  role: string;
  label: string;
  tabIndex: number;
  disabled: boolean;
  visible: boolean;
  clipped: boolean;
};

/**
 * Inspect the visible native controls inside the closed extension shadow root.
 * This keeps accessibility characterization in the same CDP boundary as the
 * other shadow-root helpers instead of weakening the production encapsulation.
 */
export async function shadowInteractiveAudit(page: Page): Promise<ShadowInteractiveAudit[]> {
  const session = await page.context().newCDPSession(page);
  await session.send('DOM.enable');
  await session.send('Runtime.enable');
  try {
    const rootId = await shadowRootNodeId(page, session);
    const resolved = await session.send('DOM.resolveNode', { nodeId: rootId });
    const objectId = resolved.object.objectId;
    if (!objectId) throw new Error('No remote object for the StudyPilot shadow root');
    const result = await session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        const controls = this.querySelectorAll(
          'button, select, textarea, input:not([type="checkbox"]), [role="button"], [role="menuitem"]',
        );
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const labelFor = (element) => {
          const ariaLabel = element.getAttribute('aria-label')?.trim();
          if (ariaLabel) return ariaLabel;
          const labelledBy = element.getAttribute('aria-labelledby')
            ?.split(/\\s+/)
            .map((id) => this.getElementById(id)?.textContent?.trim())
            .filter(Boolean)
            .join(' ');
          if (labelledBy) return labelledBy;
          const title = element.getAttribute('title')?.trim();
          if (title) return title;
          return (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim();
        };
        return Array.from(controls).map((element) => {
          const isVisible = visible(element);
          const visibleText = (element.innerText || '').replace(/\\s+/g, ' ').trim();
          return {
            tagName: element.tagName.toLowerCase(),
            role: element.getAttribute('role') || '',
            label: labelFor(element),
            tabIndex: element.tabIndex,
            disabled: Boolean(element.disabled),
            visible: isVisible,
            // Icon-only controls use their aria-label as the accessible name,
            // so their SVG box can legitimately exceed the text box metrics.
            clipped: isVisible && visibleText.length > 0 && element.scrollWidth > element.clientWidth + 1,
          };
        });
      }`,
      returnByValue: true,
    });
    return (result.result.value ?? []) as ShadowInteractiveAudit[];
  } finally {
    await session.detach().catch(() => undefined);
  }
}
