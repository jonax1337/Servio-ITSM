# Stand-in for the Servio image in the updater end-to-end test (CI job
# updater-e2e): a release version label, a HEALTHCHECK, uid 1000, and a
# file-backed "database" on /data that every version "migrates" when it starts.
# HEALTHY=false builds a broken release whose health check always fails; the
# build target sets how soon that shows (see the HEALTHCHECKs below).
FROM busybox:1.37.0 AS base
ARG VERSION
ARG HEALTHY=true
LABEL org.opencontainers.image.version=$VERSION
ENV APP_VERSION=$VERSION \
    HEALTHY=$HEALTHY
RUN mkdir -p /data /www && echo ok > /www/index.html && chown 1000:1000 /data
COPY start.sh health.sh /
USER 1000:1000
ENTRYPOINT ["/bin/sh", "/start.sh"]

# Healthy within one 2 s interval; a broken build is unhealthy after about 10 s.
FROM base AS release
HEALTHCHECK --interval=2s --timeout=2s --retries=5 CMD ["/bin/sh", "/health.sh"]

# A broken build stays "starting" for 40 s before failures count: long enough to
# act on the updater while it waits for the health check.
FROM base AS slow-to-fail
HEALTHCHECK --interval=2s --timeout=2s --start-period=40s --retries=5 CMD ["/bin/sh", "/health.sh"]
