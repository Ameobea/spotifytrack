import React, { useMemo } from 'react';
import ReactDOMServer from 'react-dom/server';
import ReactEchartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/lib/echarts';
import 'echarts/lib/chart/line';
import 'echarts/lib/chart/bar';
import 'echarts/lib/chart/treemap';
import 'echarts/lib/component/tooltip';
import 'echarts/lib/component/legend';
import 'echarts/lib/component/dataZoom';
import { GridComponent, TitleComponent } from 'echarts/components';
import { EChartOption } from 'echarts';
import * as R from 'ramda';
import { seriesDefaults, getBaseConfigDefaults } from 'ameo-utils/dist/echarts';
import { withMobileProp } from 'ameo-utils/dist/responsive';
import dayjs from 'dayjs';

import { monochromeChartColors, colors } from 'src/style';
import { categoryChartColors } from 'src/_style';

interface Series {
  seriesName: string;
  value: [Date, number | null];
}

const splitLineStyle = {
  show: true,
  lineStyle: { color: '#383838' },
} as const;

echarts.use([GridComponent, TitleComponent]);

interface InnerLineChartProps {
  series: { data: any[]; name: string }[];
  otherConfig?: Partial<EChartOption>;
  mobile: boolean;
  style?: React.CSSProperties;
}

const InnerLineChart: React.FC<InnerLineChartProps> = ({
  series,
  otherConfig = {},
  mobile,
  style,
}) => {
  const chartConfig: any = R.mergeDeepRight(
    {
      ...getBaseConfigDefaults(mobile),
      grid: { bottom: mobile ? 48 : 40, top: 50 } as EChartOption['grid'],
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
        axisTick: {
          show: false,
        },
        axisLine: {
          lineStyle: {
            color: '#383838',
          },
        },
        axisLabel: {
          color: '#ccc',
          showMinLabel: false,
          showMaxLabel: false,
          formatter: (value: string | number) => {
            // Formatted to be month/day; display year only in the first label
            const date = new Date(value);
            return `${date.getMonth() + 1}/${date.getDate()}\n${date.getFullYear()}`;
          },
          fontSize: mobile ? 10 : 12,
        },
        splitLine: splitLineStyle,
      },
      yAxis: {
        axisLabel: {
          color: '#ccc',
          fontSize: mobile ? 9 : 12,
          margin: mobile ? 2 : 8,
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

  return <ReactEchartsCore style={style} echarts={echarts} option={chartConfig} />;
};

interface BarChartProps {
  style?: React.CSSProperties;
  data: number[];
  categories: string[];
  otherConfig?: Partial<EChartOption>;
  mobile: boolean;
}

export const BarChart: React.FC<BarChartProps> = ({
  mobile,
  data,
  categories,
  style,
  otherConfig = {},
}) => {
  if (data.length !== categories.length) {
    throw new Error('The number of supplied data points and categories must be the same');
  }

  const chartConfig = useMemo(
    () =>
      R.mergeDeepRight(
        {
          ...getBaseConfigDefaults(false), // TODO
          grid: { top: 10, left: mobile ? 30 : 56, right: 10, bottom: 30 },
          dataZoom: undefined,
          xAxis: {
            type: 'category',
            data: categories,
            axisLabel: {
              color: '#ccc',
              fontSize: mobile ? 9.5 : 12,
            },
            axisLine: {
              show: true,
              lineStyle: {
                color: '#383838',
              },
            },
            axisTick: {
              show: false,
            },
          },
          backgroundColor: '#111', // TODO: Dedup these things with the line chart
          yAxis: {
            axisLabel: {
              color: '#ccc',
              fontSize: mobile ? 9 : 12,
              margin: mobile ? 2 : 8,
            },
            axisLine: {
              show: true,
              lineStyle: {
                color: '#383838',
              },
            },
            splitLine: splitLineStyle,
          },
          series: [
            {
              data,
              type: 'bar',
              itemStyle: {
                color: colors.green,
              },
            },
          ],
        },
        otherConfig
      ),
    [data, otherConfig, categories]
  );

  return <ReactEchartsCore style={style} echarts={echarts} option={chartConfig as any} />;
};

interface TreemapDatum {
  name: string;
  value?: number | null;
  children?: TreemapDatum[];
  itemStyle?: React.CSSProperties;
}

export const Treemap: React.FC<{
  otherConfig?: Partial<EChartOption>;
  style?: React.CSSProperties;
  data: TreemapDatum[];
  mobile: boolean;
}> = ({ data, style, otherConfig = {}, mobile }) => {
  const chartConfig: any = useMemo(
    () =>
      R.mergeDeepRight(
        {
          series: [
            {
              type: 'treemap',
              data,
              roam: false,
              width: '100%',
              squareRatio: 0.9,
              label: {
                padding: 1,
                fontSize: mobile ? 10 : 12,
              },
              ...(mobile ? {} : { left: -30, right: -30, top: -30, bottom: 30 }),
            },
          ],
          color: categoryChartColors,
        } as echarts.EChartOption,
        otherConfig
      ),
    [otherConfig, mobile, data]
  );

  return <ReactEchartsCore style={style} echarts={echarts} option={chartConfig} />;
};

export const LineChart = withMobileProp({ maxWidth: 400 })(InnerLineChart);
