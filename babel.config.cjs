module.exports = function (api) {
  api.cache(true);

  return require('@willbooster/babel-configs/babel.corejs.config.cjs');
};
