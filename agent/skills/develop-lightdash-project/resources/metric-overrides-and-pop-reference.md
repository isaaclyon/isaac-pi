# Metric Overrides & Period-over-Period Reference

## metricOverrides

Use `metricOverrides` in a chart's `metricQuery` to customize how metrics appear in tooltips, legends, and axes **without changing the underlying dbt metric definition**. This is chart-scoped.

### Supported properties

- `label` — override the display name (affects legend and tooltip)
- `formatOptions` — override number formatting (affects tooltip values)

### formatOptions types

| type | Properties | Example |
|------|-----------|---------|
| `currency` | `round`, `currency` (e.g., `USD`), `separator` | `$1,234` |
| `number` | `round`, `separator` | `1,234.00` |
| `percent` | `round`, `separator` | `75.2%` |

`separator` is typically `default`.

### Example

```yaml
metricQuery:
  metricOverrides:
    fct_shopify_orders_total_net_revenue:
      label: TY
      formatOptions:
        type: currency
        round: 0
        currency: USD
        separator: default
    fct_shopify_orders_total_net_revenue__pop__day_365__abc:
      label: LY
      formatOptions:
        type: currency
        round: 0
        currency: USD
        separator: default
```

### Key gotchas

- **The `format` field on `additionalMetrics` (dbt-style format strings like `'[$$]#,##0'`) does NOT control tooltip formatting.** Use `metricOverrides` with `formatOptions` instead.
- The override key must match the full metric field ID (e.g., `fct_shopify_orders_total_net_revenue__pop__day_365__abc`).
- Without `metricOverrides`, PoP metrics show raw unformatted numbers in tooltips even when the base metric is formatted.

---

## Period-over-Period (PoP) via additionalMetrics

Add a year-over-year (or other offset) comparison series to any chart using `additionalMetrics` with `generationType: periodOverPeriod`.

### Structure

```yaml
metricQuery:
  metrics:
    - fct_shopify_orders_total_net_revenue
    - fct_shopify_orders_total_net_revenue__pop__day_365__suffix
  additionalMetrics:
    - name: total_net_revenue__pop__day_365__suffix
      label: LY
      description: ""
      hidden: true
      uuid: null
      sql: CASE WHEN ${is_revenue_order} THEN ${net_revenue} END
      table: fct_shopify_orders
      type: sum
      generationType: periodOverPeriod
      baseMetricId: fct_shopify_orders_total_net_revenue
      timeDimensionId: fct_shopify_orders_order_date_day
      granularity: DAY
      periodOffset: 365
```

### Required fields

| Field | Description |
|-------|-------------|
| `name` | Unique name; convention: `<base_metric_name>__pop__day_<offset>__<suffix>` |
| `label` | Display label (use short names like `LY`) |
| `hidden` | Set `true` — this is a chart-local metric, not a first-class explore metric |
| `sql` | Must match the base metric's SQL expression |
| `table` | The explore table name |
| `type` | Must match the base metric's type (`sum`, `count`, `number`, etc.) |
| `generationType` | Always `periodOverPeriod` |
| `baseMetricId` | Full field ID of the base metric (e.g., `fct_shopify_orders_total_net_revenue`) |
| `timeDimensionId` | The time dimension field ID used for the offset |
| `granularity` | `DAY`, `WEEK`, `MONTH`, etc. |
| `periodOffset` | Number of granularity units to offset (e.g., `365` for YoY with DAY granularity) |

### Metric ID convention

The metric referenced in `metrics:` list uses the **full prefixed form**:
```
<table>_<additionalMetric.name>
```
Example: table `fct_shopify_orders` + name `total_net_revenue__pop__day_365__abc` = `fct_shopify_orders_total_net_revenue__pop__day_365__abc`

### Wiring the series in chartConfig

Add the PoP metric to `yField` and add a matching series entry:

```yaml
chartConfig:
  type: cartesian
  config:
    layout:
      yField:
        - fct_shopify_orders_total_net_revenue
        - fct_shopify_orders_total_net_revenue__pop__day_365__abc
    eChartsConfig:
      series:
        - type: line
          color: "#C4956A"
          encode:
            yRef:
              field: fct_shopify_orders_total_net_revenue
          smooth: true
        - type: line
          color: "#c4956a47"
          encode:
            yRef:
              field: fct_shopify_orders_total_net_revenue__pop__day_365__abc
          smooth: true
```

### Don't forget

1. Add the PoP metric to `tableConfig.columnOrder` as well.
2. Add a `metricOverrides` entry for the PoP metric with `label` and `formatOptions` — otherwise tooltips show raw unformatted values.
3. Use the [Lola Color Palette](./lola-color-palette.md) convention: TY = `#C4956A` (solid), LY = `#c4956a47` (28% opacity).

### Works with ratio/number metrics too

PoP works on `type: number` metrics (like AOV, margin %, UPT) — Lightdash re-executes the SQL expression against the offset time window. Just ensure the `sql` field matches the base metric definition exactly.
