const path = require('path');

const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

// Taken from https://stackoverflow.com/a/36644440/3833068
var buildEntryPoint = function(entryPoint) {
  return [
    'webpack-dev-server/client?http://localhost:3000',
    'webpack/hot/only-dev-server',
    entryPoint,
  ];
};

module.exports = {
  entry: {
    home: buildEntryPoint('./src/pages/home.tsx'),
    stats: buildEntryPoint('./src/pages/stats.tsx'),
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
  },
  mode: 'development',
  devtool: 'inline-source-map',
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
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.tsx', '.js', '.jsx', '.wasm'],
    modules: [path.resolve('./node_modules'), path.resolve('.')],
    alias: {
      Tone: path.resolve('./node_modules/tone/Tone'),
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      alwaysWriteToDisk: true,
      title: 'Personal Spotify Stats',
      minify: true,
      template: 'static/index.hbs',
      chunks: ['home'],
      options: {
        srcFilename: 'home.js',
      },
      filename: 'index.html',
    }),
    new HtmlWebpackPlugin({
      alwaysWriteToDisk: true,
      title: 'Personal Spotify Stats',
      minify: true,
      template: 'static/index.hbs',
      chunks: ['stats'],
      options: {
        srcFilename: 'stats.js',
      },
      filename: 'stats/index.html',
    }),
    new webpack.HotModuleReplacementPlugin(),
    new CopyPlugin([{ from: './static/index.css', to: './index.css' }]),
  ],
  optimization: {
    splitChunks: {
      automaticNameDelimiter: '__',
      chunks: 'all',
    },
  },
};
