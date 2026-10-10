#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo 'Run this script as root on the deployment server.' >&2
  exit 1
fi
. /etc/os-release
if [ "$ID" != ubuntu ] || [ "$VERSION_ID" != 24.04 ]; then
  echo 'This bootstrap is for Ubuntu 24.04.' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
task_arch=$(dpkg --print-architecture)
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $task_arch
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

# Open SSH before enabling the default-deny firewall.
ufw allow 22/tcp
ufw default deny incoming
ufw default allow outgoing
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 7881/tcp
ufw allow 3478/udp
ufw allow 50000:50100/udp
ufw allow 50101:50200/udp
# LiveKit's host API is reachable only through the application's private bridge.
ufw allow in on wangxu0 to any port 7880 proto tcp
ufw --force enable

install -d -m 0700 /opt/wangxu/deploy /opt/wangxu/.local/backups
docker version --format '{{.Server.Version}}'
docker compose version
ufw status
