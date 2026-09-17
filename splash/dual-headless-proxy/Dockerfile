FROM scrapinghub/splash:3.5

USER root

COPY headless-proxy/setup/ca.crt /usr/local/share/ca-certificates/zyte-headless-proxy-ca.crt
COPY splash/dual-headless-proxy/proxy-profiles/ /etc/splash/proxy-profiles/

RUN update-ca-certificates \
    && chown -R splash:splash /etc/splash/proxy-profiles

USER splash

ENTRYPOINT ["python3", "-m", "splash.server"]
CMD ["--proxy-profiles-path=/etc/splash/proxy-profiles", "--max-timeout", "180"]
