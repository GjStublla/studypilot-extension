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

export async function waitForShadow(
  page: Page,
  selector: string,
  timeoutMs = 15_000,
): Promise<ShadowQuery> {
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
  throw new Error(
    `Timed out waiting for shadow selector ${selector}${lastError ? `: ${String(lastError)}` : ''}`,
  );
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
