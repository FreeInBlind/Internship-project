/* Local Mammoth worker; the bundle is pinned to the installed package. */
importScripts('/vendor/mammoth/mammoth.browser.js');
self.onmessage = async (event) => {
  const id = event.data?.id;
  try {
    const result = await self.mammoth.extractRawText({ arrayBuffer: event.data.buffer });
    self.postMessage({ id, ok: true, text: result.value });
  } catch {
    self.postMessage({ id, ok: false, code: 'DOCX_EXTRACTION_FAILED' });
  }
};
