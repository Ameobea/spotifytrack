// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require('./webpack.config');

const siteUrlEnv = process.env.REACT_APP_SITE_URL || '';
// Ensure trailing slash when an absolute URL is provided, otherwise use root '/'
const publicPath = siteUrlEnv ? `${siteUrlEnv.replace(/\/$/, '')}/` : '/';

module.exports = {
  ...config,
  output: { ...config.output, publicPath },
  mode: 'production',
  devtool: 'source-map',
};