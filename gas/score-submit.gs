/**
 * Minimal Google Apps Script alternative score endpoint.
 * Deploy as a Web App and set access to "Anyone" for anonymous submissions.
 */
function doPost(e) {
  var payload = {};
  try {
    payload = JSON.parse(e.postData.contents || '{}');
  } catch (error) {
    return json_({ ok: false, error: 'invalid_json' });
  }

  if (payload.version !== 1 || typeof payload.seed !== 'string') {
    return json_({ ok: false, error: 'invalid_replay' });
  }

  return json_({
    ok: true,
    acceptedAt: new Date().toISOString(),
    score: Number(payload.score || 0),
    survivalMs: Number(payload.survivalMs || 0)
  });
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON
  );
}
