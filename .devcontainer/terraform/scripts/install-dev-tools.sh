#!/usr/bin/bash

go install github.com/synfinatic/aws-sso-cli/cmd/aws-sso@latest
go install github.com/mikefarah/yq/v4@latest
go install sigs.k8s.io/kustomize/kustomize/v5@latest
go install oss.terrastruct.com/d2@v0.6.9
# opentofu:
curl --proto '=https' --tlsv1.2 -fsSL https://get.opentofu.org/install-opentofu.sh -o install-opentofu.sh
chmod +x install-opentofu.sh
./install-opentofu.sh --install-method standalone --opentofu-version 1.9.0
rm install-opentofu.sh

# Install Docker CLI for act using official Docker repository
# Add Docker's official GPG key and repository
sudo apt-get update
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

# Update package list and install Docker CLI
sudo apt-get update
# sudo apt-get install -y docker-ce-cli

# Install awscli-local for LocalStack testing
# Use pipx for isolated environment to avoid breaking system packages
pipx install awscli-local

# XXX TODO
# claude firewall
# Copy and set up firewall script
# COPY scripts/init-firewall.sh /usr/local/bin/
# USER root
# RUN chmod +x /usr/local/bin/init-firewall.sh && \
#   echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall && \
#   chmod 0440 /etc/sudoers.d/node-firewall
