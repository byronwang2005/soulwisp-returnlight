FROM caddy:2.11.7-builder AS builder
# Fixed source revision: https://github.com/mholt/caddy-l4
RUN xcaddy build v2.11.7 --with github.com/mholt/caddy-l4@42db5690dea199f930a6f08005fe2e4aab10dcc9
FROM caddy:2.11.7
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
