// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require('./webpack.config');

const rawSiteUrl = (process.env.REACT_APP_SITE_URL || '').trim();
// If REACT_APP_SITE_URL provided, ensure it ends with a trailing slash; otherwise use root '/'
const normalizedSiteUrl = rawSiteUrl ? (rawSiteUrl.endsWith('/') ? rawSiteUrl : `${rawSiteUrl}/`) : '/';

module.exports = {
  ...config,
  output: { ...config.output, publicPath: normalizedSiteUrl },
  mode: 'production',
  devtool: 'source-map',
};
