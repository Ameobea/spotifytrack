/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');

const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const sass = require('node-sass');
const sassUtils = require('node-sass-utils')(sass);
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const { RetryChunkLoadPlugin } = require('webpack-retry-chunk-load-plugin');

const styles = require('./src/_style');

/**
 * @returns {webpack.Configuration}
 */
const buildConfig = () => ({
  entry: {
    index: './src/index.tsx',
    graph: './src/graphStandalone.tsx',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/',
    filename: 'itallhappened.[name].[contenthash].js',
  },
  resolve: {
    fallback: { path: false, fs: false },
  },
  optimization: {},
  mode: 'development',
  devtool: 'eval-cheap-module-source-map',
  experiments: {
    asyncWebAssembly: true,
    // importAsync: true,
  },
  module: {
    rules: [
      {
        test: /\.(tsx?)|(js)$/,
        exclude: /node_modules/,
        loader: 'babel-loader',
      },
      {
        test: /\.hbs$/,
        use: 'handlebars-loader',
      },
      {
        test: /\.css$/,
        use: ['style-loader', { loader: 'css-loader', options: { sourceMap: false } }],
      },
      {
        test: /\.scss$/,
        use: [
          {
            loader: 'style-loader',
          },
          {
            loader: 'css-loader',
          },
          {
            loader: 'sass-loader',
            options: {
              sassOptions: {
                functions: {
                  'jsStyles()': () => sassUtils.castToSass(styles),
                },
                includePaths: ['src/'],
              },
            },
          },
        ],
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.tsx', '.js', '.jsx', '.wasm'],
    modules: [path.resolve('./node_modules'), path.resolve('.')],
  },
  plugins: [
    new HtmlWebpackPlugin({
      alwaysWriteToDisk: true,
      title: 'Spotifytrack - Personal Spotify Stats + History',
      minify: true,
      template: 'index.hbs',
      filename: 'index.html',
      inject: true,
      chunks: ['index'],
    }),
    new HtmlWebpackPlugin({
      alwaysWriteToDisk: true,
      title: 'Spotify Artist Relationship Graph',
      minify: true,
      template: 'graph-standalone.hbs',
      filename: 'graph.html',
      inject: true,
      chunks: ['graph'],
    }),
    new webpack.EnvironmentPlugin(['REACT_APP_API_BASE_URL', 'REACT_APP_SITE_URL']),
    // new BundleAnalyzerPlugin(),
    new RetryChunkLoadPlugin({
      // optional stringified function to get the cache busting query string appended to the script src
      // if not set will default to appending the string `?cache-bust=true`
      cacheBust: `function() {
        return Date.now();
      }`,
      // optional value to set the amount of time in milliseconds before trying to load the chunk again. Default is 0
      retryDelay: 300,
      // optional value to set the maximum number of retries to load the chunk. Default is 1
      maxRetries: 5,
      // optional list of chunks to which retry script should be injected
      // if not set will add retry script to all chunks that have webpack script loading
      // chunks: ['chunkName'],
      // optional code to be executed in the browser context if after all retries chunk is not loaded.
      // if not set - nothing will happen and error will be returned to the chunk loader.
      lastResortScript: 'window.location.reload()',
    }),
  ],
  devServer: {
    historyApiFallback: true,
    port: 9000,
    contentBase: path.join(__dirname, 'public'),
    disableHostCheck: true,
  },
});

module.exports = buildConfig();
