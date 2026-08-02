const NodeCache = require('node-cache');

function createCache(options = {}) {
  const cache = new NodeCache({
    stdTTL: 120,
    checkperiod: 130,
    maxKeys: 500,
    useClones: false,
    ...options,
  });

  cache._wrap = function (value, ttl, asClone = true) {
    if (!this.options.useClones) {
      asClone = false;
    }
    const livetime = ttl === 0 ? 0 : Math.ceil((Date.now() + ttl * 1000) / 1000);
    return {
      t: livetime,
      v: asClone ? require('clone')(value) : value,
    };
  };

  return cache;
}

module.exports = {
  createCache,
};
