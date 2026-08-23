/**
 * Store-validity rules for the production Chrome package.
 * Imported by the CLI and unit tests. Keep this file free of a shebang so
 * Windows CRLF checkouts still parse under Vitest/esbuild.
 */

export function hostnameFromMatchPattern(pattern) {
  if (typeof pattern !== 'string') return '';
  const match = /^([a-z*]+):\/\/([^/]+)/i.exec(pattern.trim());
  if (!match) return '';
  let host = match[2];
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return (end === -1 ? host.slice(1) : host.slice(1, end)).toLowerCase();
  }
  host = host.replace(/^\*\./, '');
  return host.split(':')[0].toLowerCase();
}

export function isLoopbackHostname(hostname) {
  if (!hostname || hostname === '*') return false;
  if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::1') {
    return true;
  }
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string[]} runtimeTexts
 * @returns {string[]}
 */
export function evaluateManifest(manifest, runtimeTexts = []) {
  const errors = [];
  const permissions = [
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest.optional_permissions)
      ? manifest.optional_permissions
      : []),
  ];
  const hostPermissions = [
    ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
    ...(Array.isArray(manifest.optional_host_permissions)
      ? manifest.optional_host_permissions
      : []),
  ];

  if (permissions.includes('microphone')) {
    errors.push(
      'named permission "microphone" is not a valid MV3 permission; capture mic via offscreen getUserMedia with USER_MEDIA',
    );
  }

  if (!permissions.includes('offscreen')) {
    errors.push(
      'missing "offscreen" permission required for getUserMedia in an offscreen document',
    );
  }

  for (const pattern of hostPermissions) {
    const hostname = hostnameFromMatchPattern(pattern);
    if (isLoopbackHostname(hostname)) {
      errors.push(`loopback production host permission is not allowed: ${pattern}`);
    }
  }

  const hasUserMedia = runtimeTexts.some((text) => text.includes('USER_MEDIA'));
  if (!hasUserMedia) {
    errors.push('USER_MEDIA offscreen reason is missing from runtime code');
  }

  return errors;
}
