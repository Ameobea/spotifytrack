import React from 'react';
import ReactEchartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/lib/echarts';
import 'echarts/lib/chart/line';
import 'echarts/lib/component/tooltip';
import 'echarts/lib/component/legend';
import 'echarts/lib/component/dataZoom';
import { EChartOption } from 'echarts';

import { chartColors } from 'src/style';

const LineChart: React.FC<{
  series: { data: any[]; name: string }[];
  otherConfig?: Partial<EChartOption>;
}> = ({ series, otherConfig = {} }) => {
  const chartConfig: EChartOption = {
    series: series.map(({ data, name }, i) => ({
      name,
      type: 'line',
      data,
      lineStyle: { color: chartColors[i] },
    })),
    ...otherConfig,
  };

  return <ReactEchartsCore echarts={echarts} option={chartConfig} />;
};

export default LineChart;
