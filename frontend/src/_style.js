const colors = {
  pink: '#fd44d5',
  green: '#27b14c',
  purple: '#944bb1',
  limeGreen: '#bcd42a',
  orange: '#ff5d38',
};

const chartColors = [
  colors.limeGreen,
  colors.pink,
  colors.orange,
  colors.green,
  colors.purple,
  '#26a6a6',
  '#b5dce7',
  '#ae6cc9',
  '#27b14c',
];

const categoryChartColors = [
  '#003f5c',
  '#2f4b7c',
  '#665191',
  '#a05195',
  '#d45087',
  '#f95d6a',
  '#ff7c43',
  '#ffa600',
];

const monochromeChartColors = ['#71ff33', '#3ecc00', '#1f6600'];

// Necessary because of the weird Sass imports we do or something, I forget
module.exports = { colors, chartColors, categoryChartColors, monochromeChartColors };
