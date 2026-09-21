## 2024-05-15 - Performance Optimization Journal
**Learning:** Found an endpoint (`/api/quotes`) that was synchronously reading and regex parsing a file on every single request. Caching this result at the module level significantly decreased response times.
**Action:** Always look for static file reads inside request handlers and hoist/cache them when the content doesn't change during the process lifecycle.
