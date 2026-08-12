export async function runReferenceBrowserLifecycle(resources, disposeTrace, body) {
  let bodyFailed = false;
  let bodyError;
  let result;
  try {
    result = await body();
  } catch (error) {
    bodyFailed = true;
    bodyError = error;
  }
  const cleanupErrors = [];
  try {
    if (resources.cdp) await resources.cdp.detach();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    if (resources.frozen) await disposeTrace(resources.frozen);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (bodyFailed && cleanupErrors.length) throw new AggregateError([bodyError, ...cleanupErrors], "REFERENCE_BODY_AND_CLEANUP_FAILED");
  if (bodyFailed) throw bodyError;
  if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "REFERENCE_CLEANUP_FAILED");
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  return result;
}
