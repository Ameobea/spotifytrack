import React from 'react';
import ReactEchartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/lib/echarts';
import 'echarts/lib/chart/line';
import 'echarts/lib/component/tooltip';
import 'echarts/lib/component/legend';
import 'echarts/lib/component/dataZoom';
import { EChartOption } from 'echarts';
import * as R from 'ramda';
import { seriesDefaults, getBaseConfigDefaults } from 'ameo-utils/dist/echarts';
import { withMobileProp } from 'ameo-utils/dist/responsive';

import { chartColors } from 'src/style';

const LineChart: React.FC<{
  series: { data: any[]; name: string }[];
  otherConfig?: Partial<EChartOption>;
  mobile: boolean;
}> = ({ series, otherConfig = {}, mobile }) => {
  const chartConfig: EChartOption = R.mergeDeepRight(
    {
      ...getBaseConfigDefaults(mobile),
      series: series.map(({ data, name }, i) => ({
        ...seriesDefaults,
        name,
        data,
        lineStyle: { color: chartColors[i] },
        itemStyle: { color: chartColors[i] },
      })),
      dataZoom: undefined,
      backgroundColor: '#111',
      xAxis: {
        splitNumber: 10,
        axisLabel: {
          color: '#ccc',
          showMinLabel: false,
          showMaxLabel: false,
          formatter: (value: string | number, index: number) => {
            // Formatted to be month/day; display year only in the first label
            const date = new Date(value);
            return `${date.getMonth() + 1}/${date.getDate()}`;
          },
        },
      },
      yAxis: {
        axisLabel: {
          color: '#ccc',
        },
      },
    },
    otherConfig
  );

  return <ReactEchartsCore echarts={echarts} option={chartConfig} />;
};

const EnhancedLineChart = withMobileProp({ maxWidth: 400 })(LineChart);

export default EnhancedLineChart;
