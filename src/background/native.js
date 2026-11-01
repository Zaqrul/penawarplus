/**
 * Talks to the optional native helper (native-host/) which runs `git pull`.
 * Always resolves – never rejects – with {ok:boolean, ...}.
 */
export const HOST_NAME = 'com.penawarplus.updater';

export function nativeRequest(message, timeoutMs = 70_000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs);
    try {
      chrome.runtime.sendNativeMessage(HOST_NAME, message, (response) => {
        if (chrome.runtime.lastError) {
          finish({ ok: false, error: 'host-unavailable', detail: chrome.runtime.lastError.message });
        } else {
          finish(response && typeof response === 'object' ? response : { ok: false, error: 'empty-response' });
        }
      });
    } catch (e) {
      finish({ ok: false, error: 'host-unavailable', detail: String(e && e.message ? e.message : e) });
    }
  });
}
