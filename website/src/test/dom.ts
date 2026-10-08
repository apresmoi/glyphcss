// Match the browser exception name used by the Dock's idempotent teardown.
const removeChild = window.Node.prototype.removeChild;
window.Node.prototype.removeChild = function<T extends Node>(child: T): T {
  try { return removeChild.call(this, child) as T; }
  catch (error) {
    if (error instanceof window.DOMException && error.message.includes('removeChild')) {
      throw new window.DOMException(error.message, 'NotFoundError');
    }
    throw error;
  }
};
