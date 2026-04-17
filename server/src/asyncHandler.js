// Wrap an async Express handler so a rejected promise flows into the Express
// error middleware (next(err)) instead of becoming an unhandled rejection and
// crashing the Node process. Without this, a single DB error takes the whole
// server down and Railway reports 502 until the service restarts.
export const handle = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
