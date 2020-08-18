/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');

const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const sass = require('node-sass');
const sassUtils = require('node-sass-utils')(sass);

const styles = require('./src/_style');

module.exports = {
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/',
    filename: 'itallhappened.[name].[contenthash].js',
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
      title: 'Personal Spotify Stats',
      minify: true,
      template: 'index.hbs',
      inject: true,
    }),
    new webpack.EnvironmentPlugin(['REACT_APP_API_BASE_URL']),
  ],
  devServer: {
    historyApiFallback: true,
    port: 9000,
    contentBase: path.join(__dirname, 'public'),
  },
};
