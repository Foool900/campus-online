# 缺口 5 实现备注（举报限流 + 敏感词）

1. **evidence_json 结构**：v1 按纯文本做敏感词过滤。若前端传结构化 JSON（含图片 url），需改为只过滤文本字段、跳过 url，避免对整个 JSON 字符串 includes 误伤。

2. **month_key 时区**：用服务端 `new Date()` 的 **UTC** 时间生成 `YYYY-MM`，不用客户端时间或本地时区，防改时区跨月重置。

3. **月次数语义**：`report_counters(user_id, month_key)` 不区分举报类型，所有举报（item / order / blindbox）合计计入同一配额，默认 `config.market.reportMonthlyLimit = 3`。
