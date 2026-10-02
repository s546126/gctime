# GC Time 根域名迁移与回滚

目标：把现有根域名和 www 从旧足球站切换到 GC Time，保留 `gc` 和旧 Pages 项目；无强制跳转，无档案迁移或清理。

## 绑定映射

| 名称 | 迁移前 Pages 项目 / CNAME | 迁移后 Pages 项目 / CNAME |
| --- | --- | --- |
| `bracketboss2026.com` | `bracket-boss-2026` / `bracket-boss-2026.pages.dev` | `gctime` / `gctime.pages.dev` |
| `www.bracketboss2026.com` | `bracket-boss-2026` / `bracket-boss-2026.pages.dev` | `gctime` / `gctime.pages.dev` |
| `gc.bracketboss2026.com` | `gctime` / `gctime.pages.dev` | 不变 |

记录均使用 Cloudflare 代理，TTL Auto。同名的历史 Worker 不是 Pages 站点，不修改它。

## 前向顺序

1. 在受信分支通过完整 CI，合并 main；等待 Cloudflare Pages 发布成功。
2. 对照 `gctime.pages.dev/version.json` 与发布 commit，验证旧 `gc` 地址仍可用。
3. 逐个解除旧 Pages 项目的根域名、www 自定义域名绑定，只删除精确绑定，不删除项目。
4. 在 `gctime` 的 Custom domains 中加入相同域名，将对应 CNAME 从旧目标改为 `gctime.pages.dev`。如果界面自动更新 DNS，核对后勿重复操作。
5. 等待两个域名的证书／绑定 Active，验证 HTTPS 200、页面标题 GC Time、`version.json` 和指纹资源一致。
6. 浏览器验证主页、双表预测、语言、分享和赞助入口；不打开真实广告。检查离线 Release 仍是无广告单文件包。

已完成的绑定无需重新添加；部分失败时先查各项目绑定与 DNS 当前值，再决定继续或回滚。

## 回滚

如果域名绑定或证书失败，保留 `gc` 作为可用入口。从 `gctime` 解除失败的根域名／www 绑定，再在旧 Pages 项目重新关联这两个精确域名，将各自 CNAME 恢复到 `bracket-boss-2026.pages.dev`，保持代理和 TTL Auto。验证 HTTPS 与旧站标题。旧站代码、部署和其它 DNS 记录不删除。

若仅赞助实现需回滚，可回退相应应用 commit 并走 CI 发布，不需要调整域名或用户数据。新旧域名 localStorage 相互隔离；不承诺跨域继承用户档案或 24 小时频控。

## 验收边界

广告 Direct Link 是旧项目公开路由，不是私密 API key。复用不代表 Adsterra 认可新内容、域名或流量。账户所有者须核验广告平台审批／收益；自动化验收禁止产生真实广告点击。
