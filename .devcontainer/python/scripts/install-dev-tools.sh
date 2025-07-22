#!/usr/bin/bash

# Update package list and install Docker CLI
sudo apt-get update
# sudo apt-get install -y docker-ce-cli

# Install awscli-local for LocalStack testing
# Use pipx for isolated environment to avoid breaking system packages
pipx install awscli-local
pip install marker-pdf

# claude firewall
# Copy and set up firewall script
# XXX TODO
# COPY scripts/init-firewall.sh /usr/local/bin/
# USER root
# RUN chmod +x /usr/local/bin/init-firewall.sh &&
#   echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" >/etc/sudoers.d/node-firewall &&
#   chmod 0440 /etc/sudoers.d/node-firewall
