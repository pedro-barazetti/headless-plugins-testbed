FROM scrapinghub/splash:3.5

USER root

COPY headless-proxy/setup/ca.crt /usr/local/share/ca-certificates/crawlera-ca.crt
COPY splash/docker-entrypoint.sh /usr/local/bin/splash-crawlera-entrypoint

RUN update-ca-certificates \
    && chmod 0755 /usr/local/bin/splash-crawlera-entrypoint \
    && mkdir -p /etc/splash/proxy-profiles \
    && chown splash:splash /etc/splash/proxy-profiles

USER splash

ENTRYPOINT ["/usr/local/bin/splash-crawlera-entrypoint"]
CMD ["--max-timeout", "120"]
