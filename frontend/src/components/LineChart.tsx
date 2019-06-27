import React from 'react';
import ReactDOMServer from 'react-dom/server';
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
import dayjs from 'dayjs';

import { monochromeChartColors } from 'src/style';

interface Series {
  seriesName: string;
  value: [Date, number | null];
}

const splitLineStyle = {
  lineStyle: { color: '#383838' },
} as const;

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
        smooth: 0.3,
        name,
        data,
        lineStyle: { color: monochromeChartColors[i] },
        itemStyle: { color: monochromeChartColors[i] },
      })),
      dataZoom: undefined,
      backgroundColor: '#111',
      xAxis: {
        splitNumber: 10,
        axisLabel: {
          color: '#ccc',
          showMinLabel: false,
          showMaxLabel: false,
          formatter: (value: string | number) => {
            // Formatted to be month/day; display year only in the first label
            const date = new Date(value);
            return `${date.getMonth() + 1}/${date.getDate()}`;
          },
        },
        splitLine: splitLineStyle,
      },
      yAxis: {
        axisLabel: {
          color: '#ccc',
        },
        splitLine: splitLineStyle,
      },
      tooltip: {
        formatter: (series: Series[]) =>
          ReactDOMServer.renderToString(
            <>
              {series.map(({ seriesName, value: [x, y] }: Series, i) => (
                <>
                  {i === 0 ? (
                    <>
                      {dayjs(x).format('YYYY-MM-DD h:MMA')}
                      <br />
                    </>
                  ) : null}
                  <span style={{ color: monochromeChartColors[i] }}>{seriesName}</span>:{' '}
                  {R.isNil(y) ? '-' : <strong>{`#${y + 1}`}</strong>}
                  <br />
                </>
              ))}
            </>
          ),
        backgroundColor: '#232323',
      },
    },
    otherConfig
  );

  return <ReactEchartsCore echarts={echarts} option={chartConfig} />;
};

const EnhancedLineChart = withMobileProp({ maxWidth: 400 })(LineChart);

export default EnhancedLineChart;
