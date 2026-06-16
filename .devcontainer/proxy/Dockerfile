# Egress-filtering forward proxy for the Iris sandbox.
# Built from the same trusted ubuntu base (no third-party proxy image) + tinyproxy.
# It allows HTTPS CONNECT / HTTP only to hosts matching /etc/tinyproxy/allowlist
# (FilterDefaultDeny), and only on CONNECT ports 443/563 — so SMTP and friends
# are refused outright.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends tinyproxy ca-certificates \
    && rm -rf /var/lib/apt/lists/*
EXPOSE 8888
# Config + allowlist are bind-mounted at run time so the allowlist can be edited
# and applied with a simple `docker restart iris-proxy` (no rebuild).
ENTRYPOINT ["tinyproxy", "-d", "-c", "/etc/tinyproxy/tinyproxy.conf"]
