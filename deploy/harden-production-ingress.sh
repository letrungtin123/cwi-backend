#!/usr/bin/env bash
set -Eeuo pipefail

# Run as root after Nginx has been tested. This script is intentionally
# idempotent: it removes the obsolete 80 -> 8080 redirect and only blocks
# external traffic on the server's primary network interface.

interface="$(ip -o -4 route show to default | awk '{print $5; exit}')"
[[ -n "$interface" ]] || { echo 'Cannot determine default IPv4 interface.' >&2; exit 1; }

ensure_rule() {
  local table="$1"
  local chain="$2"
  shift 2
  if [[ -n "$table" ]]; then
    iptables -t "$table" -C "$chain" "$@" 2>/dev/null || iptables -t "$table" -I "$chain" 1 "$@"
  else
    iptables -C "$chain" "$@" 2>/dev/null || iptables -I "$chain" 1 "$@"
  fi
}

# Retire only the exact legacy redirect. Nginx owns public port 80 now.
while iptables -t nat -C PREROUTING -i "$interface" -p tcp --dport 80 -j REDIRECT --to-ports 8080 2>/dev/null; do
  iptables -t nat -D PREROUTING -i "$interface" -p tcp --dport 80 -j REDIRECT --to-ports 8080
done

# Node routers and internal backend remain private even if a future config
# accidentally binds them to all interfaces.
ensure_rule '' INPUT -i "$interface" -p tcp -m multiport --dports 8080,8088,8180 -j DROP

# Docker publishes before UFW's INPUT chain. Block every service port that is
# not a public ingress in DOCKER-USER, which Docker preserves across restarts.
ensure_rule '' DOCKER-USER -i "$interface" -p tcp -m multiport --dports 8000,55320:55327 -j DROP
