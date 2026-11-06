# Stand-in for the Servio image in the updater end-to-end test (CI job
# updater-e2e): a release version label, a HEALTHCHECK, uid 1000, and a
# file-backed "database" on /data that every version "migrates" when it starts.
# HEALTHY=false builds a broken release whose health check always fails.
FROM busybox:1.37.0
ARG VERSION
ARG HEALTHY=true
LABEL org.opencontainers.image.version=$VERSION
ENV APP_VERSION=$VERSION \
    HEALTHY=$HEALTHY
RUN mkdir -p /data /www && echo ok > /www/index.html && chown 1000:1000 /data
COPY start.sh /start.sh
USER 1000:1000
HEALTHCHECK --interval=2s --timeout=2s --retries=1 \
  CMD [ "$HEALTHY" = true ] && wget -q -O /dev/null http://127.0.0.1:3000/
ENTRYPOINT ["/bin/sh", "/start.sh"]
