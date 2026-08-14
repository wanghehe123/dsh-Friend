## MODIFIED Requirements

### Requirement: 队列与缓存
系统 SHALL 以并发上限 3、按会话保序的队列执行合成；结果按 `provider+voice+text` 哈希缓存（LRU 500 条 / TTL 1 小时，落盘 `cache/tts/`）；音频经**前缀路由** `/friend/tts/audio`（`kind: 'prefix'`）提供，音频 id 由 handler 从 pathname 解析——rc.6 的 `WebRoute` 只有 `exact` / `prefix` 两种匹配，不支持 `:param` 占位符。handler SHALL 只接受 GET，其余 method 返回 405。

#### Scenario: 缓存命中
- **WHEN** 同一句话第二次触发朗读
- **THEN** 不再请求 provider（日志证明命中），播放正常

#### Scenario: 顺序保证
- **WHEN** 连续 5 条回复入队
- **THEN** 播放顺序与生成顺序一致

#### Scenario: 音频按 id 取回
- **WHEN** 请求 `GET /friend/tts/audio/<id>`
- **THEN** 返回该 id 对应的音频；未知 id 返回 404；非 GET 返回 405
