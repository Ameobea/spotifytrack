// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require('./webpack.config');

module.exports = {
  ...config,
  output: { ...config.output, publicPath: 'https://spotifytrack.b-cdn.net/' },
  mode: 'production',
  devtool: 'source-map',
};
