import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type RevenueChartPoint = {
  label: string;
  value: number;
};

type RevenueChartProps = {
  data: RevenueChartPoint[];
  /** Formats the raw value for the Y axis and tooltip, e.g. currency. */
  formatValue?: (value: number) => string;
  height?: number;
};

/** Area chart wired to the --chart-1 design token — reused for revenue, order-count, and any other single-series trend. */
export function RevenueChart({
  data,
  formatValue = (v) => String(v),
  height = 260,
}: RevenueChartProps) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--brand-soft)" strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--ink-soft)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--brand-soft)" }}
          />
          <YAxis
            tick={{ fill: "var(--ink-soft)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={formatValue}
          />
          <Tooltip
            formatter={(value) => formatValue(Number(value))}
            contentStyle={{
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--brand-soft)",
              boxShadow: "0 8px 24px rgba(194,90,5,0.10)",
              fontSize: 13,
            }}
            labelStyle={{ color: "var(--ink)", fontWeight: 600 }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            fill="url(#revenueFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
