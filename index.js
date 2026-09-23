/**
 * Static-asset Worker. No backend — every request is served from ./public.
 */
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
